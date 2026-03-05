const {
  assert,
  makeTrace,
  deepGet,
  isWildcardField,
  expandWildcardKeys,
} = require("./utils");

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

  const ctxBase = {
    payload,
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

  // Wildcard support is runtime-only. To avoid O(rules * keys) re-scans, keep a small cache
  // for this execution scope.
  const payloadKeys = ctxBase && ctxBase.payload ? Object.keys(ctxBase.payload) : [];
  const wildcardCache = new Map();

  function resolveFieldKeys(fieldPattern) {
    if (!isWildcardField(fieldPattern)) return [fieldPattern];
    if (wildcardCache.has(fieldPattern)) return wildcardCache.get(fieldPattern);
    const resolved = expandWildcardKeys(fieldPattern, payloadKeys);
    wildcardCache.set(fieldPattern, resolved);
    return resolved;
  }

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
        if (isWildcardField(rule.field)) {
          const keys = resolveFieldKeys(rule.field);
          t("predicate wildcard expanded", {
            ruleId: rule.id,
            fieldPattern: rule.field,
            matched: keys.length,
          });

          // ANY semantics by default:
          // - TRUE if at least one resolved field evaluates to TRUE
          // - FALSE otherwise (including zero matches)
          let anyTrue = false;
          for (const k of keys) {
            const r = evalPredicate(
              operators,
              Object.assign({}, rule, { field: k }),
              ctxBase,
              trace,
              scope,
            );
            if (r.status === "EXCEPTION") throw r.error;
            if (r.status === "TRUE") {
              anyTrue = true;
              break;
            }
          }

          t("predicate wildcard aggregated (ANY)", {
            ruleId: rule.id,
            fieldPattern: rule.field,
            result: anyTrue,
          });
        } else {
          const res = evalPredicate(operators, rule, ctxBase, trace, scope);
          if (res.status === "EXCEPTION") throw res.error;
        }
        continue;
      }

      // check-rule
      if (isWildcardField(rule.field)) {
        const keys = resolveFieldKeys(rule.field);
        t("check wildcard expanded", {
          ruleId: rule.id,
          fieldPattern: rule.field,
          matched: keys.length,
        });

        // If wildcard matched nothing, treat as a no-op.
        // Presence/requiredness can be expressed by separate rules on dedicated fields.
        for (const k of keys) {
          const res = evalCheck(
            operators,
            Object.assign({}, rule, { field: k }),
            ctxBase,
            trace,
            scope,
          );
          if (res.status === "EXCEPTION") throw res.error;

          if (res.status === "FAIL") {
            const dg = deepGet(ctxBase && ctxBase.payload, k);
            issues.push({
              kind: "ISSUE",
              level: rule.level,
              code: rule.code,
              message: rule.message,
              field: k,
              ruleId: rule.id,
              expected: Object.prototype.hasOwnProperty.call(rule, "value")
                ? rule.value
                : Object.prototype.hasOwnProperty.call(rule, "dictionary")
                  ? rule.dictionary
                  : undefined,
              actual: dg.ok ? dg.value : undefined,
              stepId,
            });

            if (rule.level === "EXCEPTION") {
              t("STOP by EXCEPTION-level rule (wildcard)", {
                ruleId: rule.id,
                code: rule.code,
                field: k,
              });
              return "STOP";
            }
          }
        }
      } else {
        const res = evalCheck(operators, rule, ctxBase, trace, scope);
        if (res.status === "EXCEPTION") throw res.error;

        if (res.status === "FAIL") {
          const dg = deepGet(ctxBase && ctxBase.payload, rule.field);
          issues.push({
            kind: "ISSUE",
            level: rule.level,
            code: rule.code,
            message: rule.message,
            field: rule.field,
            ruleId: rule.id,
            expected: Object.prototype.hasOwnProperty.call(rule, "value")
              ? rule.value
              : Object.prototype.hasOwnProperty.call(rule, "dictionary")
                ? rule.dictionary
                : undefined,
            actual: dg.ok ? dg.value : undefined,
            stepId,
          });

          if (rule.level === "EXCEPTION") {
            t("STOP by EXCEPTION-level rule", {
              ruleId: rule.id,
              code: rule.code,
            });
            return "STOP";
          }
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

    // Wildcard for predicates: ANY semantics by default.
    if (isWildcardField(pr.field)) {
      const payloadKeys = ctxBase && ctxBase.payload ? Object.keys(ctxBase.payload) : [];
      const keys = expandWildcardKeys(pr.field, payloadKeys);
      trace.push({
        kind: "TRACE",
        message: "predicate wildcard expanded",
        data: {
          scope: `condition:${condition.id}`,
          ruleId: pr.id,
          fieldPattern: pr.field,
          matched: keys.length,
        },
        ts: new Date().toISOString(),
      });

      for (const k of keys) {
        const r = evalPredicate(
          operators,
          Object.assign({}, pr, { field: k }),
          ctxBase,
          trace,
          `condition:${condition.id}`,
        );
        if (r.status === "EXCEPTION") throw r.error;
        if (r.status === "TRUE") return true;
      }
      return false;
    }

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
