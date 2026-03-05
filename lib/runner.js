const { assert, makeTrace, deepGet, toComparable, isWildcardField, expandWildcardKeys } = require("./utils");

function compareCount(op, left, right) {
  switch (op) {
    case "==":
    case "=":
      return left === right;
    case "!=":
      return left !== right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    default:
      throw new Error(`Unsupported COUNT operator: ${op}`);
  }
}

function onEmptyBehavior(rule, defaultBehavior) {
  const ae = rule && rule.aggregate && rule.aggregate.onEmpty;
  return ae || defaultBehavior;
}

function resolveRuleFields(rule, payloadKeys, traceFn) {
  if (!isWildcardField(rule.field)) return { pattern: rule.field, keys: [rule.field] };
  const keys = expandWildcardKeys(rule.field, payloadKeys);
  traceFn("wildcard expanded", { pattern: rule.field, matched: keys.length });
  return { pattern: rule.field, keys };
}

function runPipeline(compiled, pipelineId, payload) {
  const { registry, dictionaries, operators, pipelines, conditions } = compiled;
  assert(
    operators && operators.check && operators.predicate,
    "runPipeline: compiled.operators is missing (compile must be called with operators)",
  );
  assert(
    pipelines instanceof Map,
    "runPipeline: compiled.pipelines is missing (compile-time steps required)",
  );
  assert(
    conditions instanceof Map,
    "runPipeline: compiled.conditions is missing (compile-time steps required)",
  );

  const trace = [];
  const issues = [];
  const traceFn = makeTrace(trace, `pipeline:${pipelineId}`);

  const payloadKeys = payload && typeof payload === "object" ? Object.keys(payload) : [];
  const wildcardCache = new Map(); // pattern -> resolved keys

  const ctxBase = {
    payload,
    payloadKeys,
    wildcardCache,
    getDictionary: (id) => dictionaries.get(id) || null,
  };

  try {
    const pipeline = registry.get(pipelineId);
    assert(
      pipeline && pipeline.type === "pipeline",
      `runPipeline: ${pipelineId} is not a pipeline`,
    );

    const compiledPipe = pipelines.get(pipelineId);
    assert(
      compiledPipe,
      `runPipeline: compiled pipeline not found: ${pipelineId}`,
    );

    const control = execSteps(
      registry,
      operators,
      pipelines,
      conditions,
      compiledPipe.steps,
      pipeline.id,
      ctxBase,
      issues,
      trace,
      `pipeline:${pipelineId}`,
    );
    if (control === "STOP")
      traceFn("pipeline stopped by EXCEPTION", { pipelineId });

    // If we stopped because of an EXCEPTION-level rule or strict pipeline boundary, reflect it in status.
    const status = control === "STOP" ? "EXCEPTION" : "OK";
    return { status, control, issues, trace };
  } catch (e) {
    traceFn("pipeline ABORT (runtime exception)", {
      pipelineId,
      error: String(e && e.message ? e.message : e),
    });
    return {
      status: "ABORT",
      issues,
      trace,
      error: { message: e.message, stack: e.stack },
    };
  }
}

function execSteps(
  registry,
  operators,
  pipelines,
  conditions,
  steps,
  scopePipelineId,
  ctxBase,
  issues,
  trace,
  scope,
) {
  const t = makeTrace(trace, scope);

  for (const step of steps) {
    const kind = step.kind;
    const stepId = step.stepId;

    if (kind === "rule") {
      const rule = registry.get(step.ruleId);
      assert(rule, `Missing rule ${step.ruleId} (from ${step.ref})`);
      t("exec rule step", {
        stepId,
        ruleId: rule.id,
        ref: step.ref,
        role: rule.role,
        operator: rule.operator,
        meta: rule.meta !== undefined ? rule.meta : null,
      });

      if (rule.role === "predicate") {
        const res = evalPredicate(operators, rule, ctxBase, trace, scope);
        if (res.status === "EXCEPTION") throw res.error;
        continue;
      }

      const res = evalCheck(operators, rule, ctxBase, trace, scope);
      if (res.status === "EXCEPTION") throw res.error;

      if (res.status === "FAIL") {
        // evalCheck may return a single failure (non-wildcard or aggregated)
        // or multiple failures (wildcard per-element). Normalize to array.
        const fails = Array.isArray(res.failures) ? res.failures : [res];

        for (const f of fails) {
          const expected = Object.prototype.hasOwnProperty.call(rule, "value")
            ? rule.value
            : Object.prototype.hasOwnProperty.call(rule, "dictionary")
              ? rule.dictionary
              : undefined;
          issues.push({
            kind: "ISSUE",
            level: rule.level,
            code: rule.code,
            message: rule.message,
            field: f.field || rule.field,
            ruleId: rule.id,
            expected,
            actual: Object.prototype.hasOwnProperty.call(f, "actual")
              ? f.actual
              : (deepGet(ctxBase.payload, f.field || rule.field).ok
                ? deepGet(ctxBase.payload, f.field || rule.field).value
                : undefined),
            stepId,
            meta: f.meta || undefined,
          });
        }

        if (rule.level === "EXCEPTION") {
          t("STOP by EXCEPTION-level rule", { ruleId: rule.id, code: rule.code });
          return "STOP";
        }
      }
      continue;
    }

    if (kind === "pipeline") {
      const p = registry.get(step.pipelineId);
      assert(p && p.type === "pipeline", `Missing pipeline ${step.pipelineId}`);
      const compiledPipe = pipelines.get(p.id);
      assert(compiledPipe, `Missing compiled pipeline ${p.id}`);

      t("exec pipeline step", { stepId, pipelineId: p.id });
      const issuesStart = issues.length;
      const control = execSteps(
        registry,
        operators,
        pipelines,
        conditions,
        compiledPipe.steps,
        p.id,
        ctxBase,
        issues,
        trace,
        `pipeline:${p.id}`,
      );

      // strict pipelines: if they produced at least one ERROR/EXCEPTION issue, raise a boundary EXCEPTION
      if (p.strict === true) {
        const localIssues = issues.slice(issuesStart);
        const hasErrors = localIssues.some(
          (i) => i && (i.level === "ERROR" || i.level === "EXCEPTION"),
        );
        if (hasErrors) {
          issues.push({
            kind: "ISSUE",
            level: "EXCEPTION",
            code: p.strictCode || "STRICT_PIPELINE_FAILED",
            message: p.message,
            field: null,
            ruleId: `pipeline:${p.id}`,
            pipelineId: p.id,
            stepId,
          });
          t("STOP by strict pipeline boundary", {
            pipelineId: p.id,
            code: p.strictCode || "STRICT_PIPELINE_FAILED",
          });
          return "STOP";
        }
      }

      if (control === "STOP") return "STOP";
      continue;
    }

    if (kind === "condition") {
      const c = registry.get(step.conditionId);
      assert(
        c && c.type === "condition",
        `Missing condition ${step.conditionId}`,
      );
      const compiledCond = conditions.get(c.id);
      assert(compiledCond, `Missing compiled condition ${c.id}`);

      t("exec condition step", {
        stepId,
        conditionId: c.id,
        ref: step.ref,
      });

      const control = evalCondition(
        registry,
        operators,
        pipelines,
        conditions,
        c,
        compiledCond,
        ctxBase,
        issues,
        trace,
      );
      if (control === "STOP") return "STOP";
      continue;
    }
  }

  return "CONTINUE";
}

function evalPredicate(operators, rule, ctxBase, trace, scope) {
  const t = makeTrace(trace, `${scope}:pred:${rule.id}`);
  const op = operators.predicate[rule.operator];
  try {
    const ctx = Object.assign({}, ctxBase, { trace: (m, d) => t(m, d) });

    // Wildcard aggregation for predicates
    if (isWildcardField(rule.field)) {
      const cacheKey = `pred:${rule.field}`;
      let keys = ctx.wildcardCache.get(cacheKey);
      if (!keys) {
        keys = expandWildcardKeys(rule.field, ctx.payloadKeys || []);
        ctx.wildcardCache.set(cacheKey, keys);
      }

      if (keys.length === 0) {
        const beh = onEmptyBehavior(rule, "UNDEFINED");
        t("wildcard predicate matched 0 fields", { pattern: rule.field, onEmpty: beh });
        if (beh === "TRUE") return { status: "TRUE" };
        if (beh === "FALSE") return { status: "FALSE" };
        if (beh === "ERROR") return { status: "EXCEPTION", error: new Error(`Wildcard pattern matched 0 fields: ${rule.field}`) };
        // UNDEFINED
        t("predicate UNDEFINED treated as FALSE", { ruleId: rule.id });
        return { status: "FALSE" };
      }

      const mode = (rule.aggregate && rule.aggregate.mode) || "ANY";
      const results = [];
      for (const k of keys) {
        const rr = op(Object.assign({}, rule, { field: k, _patternField: rule.field }), ctx);
        if (rr.status === "EXCEPTION") return rr;
        // Treat UNDEFINED as FALSE (consistent with non-wildcard)
        results.push(rr.status === "TRUE");
      }

      if (mode === "ANY") {
        return { status: results.some(Boolean) ? "TRUE" : "FALSE" };
      }
      if (mode === "ALL") {
        return { status: results.every(Boolean) ? "TRUE" : "FALSE" };
      }
      if (mode === "COUNT") {
        const passCount = results.filter(Boolean).length;
        const opStr = (rule.aggregate && rule.aggregate.op) || ">=";
        const target = Number(rule.aggregate && rule.aggregate.value);
        if (!Number.isFinite(target)) throw new Error(`COUNT aggregate requires numeric aggregate.value`);
        return { status: compareCount(opStr, passCount, target) ? "TRUE" : "FALSE" };
      }

      throw new Error(`Unsupported predicate aggregate.mode: ${mode}`);
    }

    const res = op(rule, ctx);
    if (res.status === "UNDEFINED") {
      t("predicate UNDEFINED treated as FALSE", { ruleId: rule.id });
      return { status: "FALSE" };
    }
    return res;
  } catch (e) {
    return { status: "EXCEPTION", error: e };
  }
}

function evalCheck(operators, rule, ctxBase, trace, scope) {
  const t = makeTrace(trace, `${scope}:check:${rule.id}`);
  const op = operators.check[rule.operator];
  try {
    const ctx = Object.assign({}, ctxBase, { trace: (m, d) => t(m, d) });

    // Wildcard / aggregation for check-rules
    if (isWildcardField(rule.field)) {
      const cacheKey = `check:${rule.field}`;
      let keys = ctx.wildcardCache.get(cacheKey);
      if (!keys) {
        keys = expandWildcardKeys(rule.field, ctx.payloadKeys || []);
        ctx.wildcardCache.set(cacheKey, keys);
      }

      if (keys.length === 0) {
        const beh = onEmptyBehavior(rule, "PASS");
        t("wildcard check matched 0 fields", { pattern: rule.field, onEmpty: beh });
        if (beh === "FAIL") return { status: "FAIL", field: rule.field, actual: undefined, meta: { reason: "WILDCARD_EMPTY" } };
        if (beh === "ERROR") throw new Error(`Wildcard pattern matched 0 fields: ${rule.field}`);
        // PASS or UNDEFINED -> treat as OK (do not create issues)
        return { status: "OK" };
      }

      const mode = (rule.aggregate && rule.aggregate.mode) || "EACH";

      // EACH / ALL (per-element issues) as default
      if (mode === "EACH" || mode === "ALL") {
        const failures = [];
        for (const k of keys) {
          const rr = op(Object.assign({}, rule, { field: k, _patternField: rule.field }), ctx);
          if (rr.status === "EXCEPTION") return rr;
          if (rr.status === "FAIL") {
            const got = deepGet(ctx.payload, k);
            failures.push({ status: "FAIL", field: k, actual: got.ok ? got.value : undefined, meta: { pattern: rule.field } });
          }
        }
        if (failures.length === 0) return { status: "OK" };
        // Optional summaryIssue: collapse to one issue if configured.
        if (mode === "ALL" && rule.aggregate && rule.aggregate.summaryIssue === true) {
          return {
            status: "FAIL",
            field: rule.field,
            actual: failures.length,
            meta: { pattern: rule.field, failedCount: failures.length, mode: "ALL" },
          };
        }
        return { status: "FAIL", failures };
      }

      if (mode === "COUNT") {
        // Count PASS results of applying operator to each element.
        let passCount = 0;
        for (const k of keys) {
          const rr = op(Object.assign({}, rule, { field: k, _patternField: rule.field }), ctx);
          if (rr.status === "EXCEPTION") return rr;
          if (rr.status === "OK") passCount++;
        }
        const opStr = (rule.aggregate && rule.aggregate.op) || ">=";
        const target = Number(rule.aggregate && rule.aggregate.value);
        if (!Number.isFinite(target)) throw new Error(`COUNT aggregate requires numeric aggregate.value`);
        const ok = compareCount(opStr, passCount, target);
        return ok
          ? { status: "OK" }
          : { status: "FAIL", field: rule.field, actual: passCount, meta: { mode: "COUNT", op: opStr, value: target, matched: keys.length } };
      }

      if (mode === "MIN" || mode === "MAX") {
        // Aggregate the actual values (numbers or strict YMD dates) and apply the operator once to the aggregated value.
        const vals = [];
        for (const k of keys) {
          const got = deepGet(ctx.payload, k);
          if (!got.ok) continue;
          const c = toComparable(got.value);
          if (c) vals.push({ key: k, comp: c });
        }
        if (vals.length === 0) {
          const beh = onEmptyBehavior(rule, "PASS");
          t("wildcard MIN/MAX produced 0 comparable values", { pattern: rule.field, onEmpty: beh });
          if (beh === "FAIL") return { status: "FAIL", field: rule.field, actual: undefined, meta: { reason: "NO_COMPARABLE_VALUES" } };
          if (beh === "ERROR") throw new Error(`Wildcard pattern produced 0 comparable values: ${rule.field}`);
          return { status: "OK" };
        }

        // Ensure all comparable kinds are the same.
        const kind = vals[0].comp.kind;
        if (!vals.every((v) => v.comp.kind === kind)) {
          return { status: "FAIL", field: rule.field, actual: null, meta: { reason: "MIXED_TYPES_IN_MINMAX" } };
        }

        const picked = vals.reduce((best, cur) => {
          if (!best) return cur;
          if (mode === "MIN") return cur.comp.value < best.comp.value ? cur : best;
          return cur.comp.value > best.comp.value ? cur : best;
        }, null);

        // Run operator against a synthetic payload key.
        const aggKey = "__agg__";
        const syntheticCtx = Object.assign({}, ctx, { payload: { [aggKey]: deepGet(ctx.payload, picked.key).value } });
        const rr = op(Object.assign({}, rule, { field: aggKey, _patternField: rule.field }), syntheticCtx);
        if (rr.status === "EXCEPTION") return rr;
        if (rr.status === "OK") return { status: "OK" };
        return {
          status: "FAIL",
          field: rule.field,
          actual: deepGet(ctx.payload, picked.key).value,
          meta: { mode, pickedField: picked.key, kind, matched: keys.length },
        };
      }

      throw new Error(`Unsupported check aggregate.mode: ${mode}`);
    }

    return op(rule, ctx);
  } catch (e) {
    return { status: "EXCEPTION", error: e };
  }
}

function evalCondition(
  registry,
  operators,
  pipelines,
  conditions,
  condition,
  compiledCond,
  ctxBase,
  issues,
  trace,
) {
  const t = makeTrace(trace, `condition:${condition.id}`);
  const w = compiledCond.when;

  function predBool(predId) {
    const pr = registry.get(predId);
    assert(
      pr && pr.type === "rule" && pr.role === "predicate",
      `when predicate must be predicate-rule: ${predId}`,
    );

    // For observability: explicitly log predicate evaluation as a trace step.
    trace.push({
      kind: "TRACE",
      message: "exec predicate step",
      data: {
        scope: `condition:${condition.id}`,
        ruleId: pr.id,
        role: pr.role,
        operator: pr.operator,
        meta: pr.meta !== undefined ? pr.meta : null,
      },
      ts: new Date().toISOString(),
    });

    const r = evalPredicate(
      operators,
      pr,
      ctxBase,
      trace,
      `condition:${condition.id}`,
    );
    if (r.status === "EXCEPTION") throw r.error;
    return r.status === "TRUE";
  }

  let ok = false;
  if (w.mode === "single") ok = predBool(w.predIds[0]);
  else if (w.mode === "all") ok = w.predIds.every((id) => predBool(id));
  else if (w.mode === "any") ok = w.predIds.some((id) => predBool(id));

  t("condition evaluated", { whenMode: w.mode, result: ok });

  if (ok) {
    const control = execSteps(
      registry,
      operators,
      pipelines,
      conditions,
      compiledCond.steps,
      compiledCond.scopePipelineId,
      ctxBase,
      issues,
      trace,
      `condition:${condition.id}:steps`,
    );
    if (control === "STOP") return "STOP";
  }
  return "CONTINUE";
}

module.exports = { runPipeline };
