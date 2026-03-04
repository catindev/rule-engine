const { assert, normalizeWhenExpr, stepKind, makeTrace } = require("./utils");
const { resolveRef } = require("./resolver");

function runPipeline(compiled, pipelineId, payload) {
  const { registry, dictionaries, operators } = compiled;
  assert(operators && operators.check && operators.predicate, "runPipeline: compiled.operators is missing (compile must be called with operators)");
  const trace = [];
  const issues = [];
  const traceFn = makeTrace(trace, `pipeline:${pipelineId}`);

  const ctxBase = {
    payload,
    getDictionary: (id) => dictionaries.get(id) || null
  };

  try {
    const pipeline = registry.get(pipelineId);
    assert(pipeline && pipeline.type === "pipeline", `runPipeline: ${pipelineId} is not a pipeline`);
    const control = execSteps(registry, operators, pipeline.flow, pipeline.id, ctxBase, issues, trace, `pipeline:${pipelineId}`);
    if (control === "STOP") traceFn("pipeline stopped by EXCEPTION", { pipelineId });

    // If we stopped because of an EXCEPTION-level rule or strict pipeline boundary, reflect it in status.
    const status = control === "STOP" ? "EXCEPTION" : "OK";
    return { status, control, issues, trace };
  } catch (e) {
    traceFn("pipeline ABORT (runtime exception)", { pipelineId, error: String(e && e.message ? e.message : e) });
    return { status: "ABORT", issues, trace, error: { message: e.message, stack: e.stack } };
  }
}

function execSteps(registry, operators, steps, scopePipelineId, ctxBase, issues, trace, scope) {
  const t = makeTrace(trace, scope);

  for (const step of steps) {
    const kind = stepKind(step);
    const stepId = step.stepId;

    if (kind === "rule") {
      const rid = resolveRef("rule", step.rule, scopePipelineId);
      const rule = registry.get(rid);
      assert(rule, `Missing rule ${rid} (from ${step.rule})`);
      t("exec rule step", {
        stepId,
        ruleId: rule.id,
        ref: step.rule,
        role: rule.role,
        operator: rule.operator,
        // meta is optional in rule definition; we still emit it explicitly
        // so it's obvious when analysts didn't fill it.
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
        issues.push({
          kind: "ISSUE",
          level: rule.level,
          code: rule.code,
          message: rule.message,
          field: rule.field,
          ruleId: rule.id,
          expected: (Object.prototype.hasOwnProperty.call(rule, "value") ? rule.value : (Object.prototype.hasOwnProperty.call(rule, "dictionary") ? rule.dictionary : undefined)),
          actual: (ctxBase && ctxBase.payload && Object.prototype.hasOwnProperty.call(ctxBase.payload, rule.field) ? ctxBase.payload[rule.field] : undefined),
          stepId
        });

        if (rule.level === "EXCEPTION") {
          t("STOP by EXCEPTION-level rule", { ruleId: rule.id, code: rule.code });
          return "STOP";
        }
      }
      continue;
    }

    if (kind === "pipeline") {
      const p = registry.get(step.pipeline);
      assert(p && p.type === "pipeline", `Missing pipeline ${step.pipeline}`);
      t("exec pipeline step", { stepId, pipelineId: p.id });
      const issuesStart = issues.length;
      const control = execSteps(registry, operators, p.flow, p.id, ctxBase, issues, trace, `pipeline:${p.id}`);

      // strict pipelines: if they produced at least one ERROR/EXCEPTION issue, raise a boundary EXCEPTION
      if (p.strict === true) {
        const localIssues = issues.slice(issuesStart);
        const hasErrors = localIssues.some((i) => i && (i.level === "ERROR" || i.level === "EXCEPTION"));
        if (hasErrors) {
          issues.push({
            kind: "ISSUE",
            level: "EXCEPTION",
            code: p.strictCode || "STRICT_PIPELINE_FAILED",
            message: p.message,
            field: null,
            ruleId: `pipeline:${p.id}`,
            pipelineId: p.id,
            stepId
          });
          t("STOP by strict pipeline boundary", { pipelineId: p.id, code: p.strictCode || "STRICT_PIPELINE_FAILED" });
          return "STOP";
        }
      }

      if (control === "STOP") return "STOP";
      continue;
    }

    if (kind === "condition") {
      const cid = resolveRef("condition", step.condition, scopePipelineId);
      const c = registry.get(cid);
      assert(c && c.type === "condition", `Missing condition ${cid} (from ${step.condition})`);
      t("exec condition step", { stepId, conditionId: c.id, ref: step.condition });
      const control = evalCondition(registry, operators, c, scopePipelineId, ctxBase, issues, trace);
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

function evalCondition(registry, operators, condition, scopePipelineId, ctxBase, issues, trace) {
  const t = makeTrace(trace, `condition:${condition.id}`);
  const w = normalizeWhenExpr(condition.when);

  function predBool(predRef) {
    const { resolveRef } = require("./resolver");
    const predId = resolveRef("rule", predRef, scopePipelineId);
    const pr = registry.get(predId);
    assert(pr && pr.type === "rule" && pr.role === "predicate", `when predicate must be predicate-rule: ${predRef} (resolved ${predId})`);

    // For observability: explicitly log predicate evaluation as a trace step.
    trace.push({
      kind: "TRACE",
      message: "exec predicate step",
      data: {
        scope: `condition:${condition.id}`,
        ruleId: pr.id,
        ref: predRef,
        role: pr.role,
        operator: pr.operator,
        meta: pr.meta !== undefined ? pr.meta : null,
      },
      ts: new Date().toISOString(),
    });

    const r = evalPredicate(operators, pr, ctxBase, trace, `condition:${condition.id}`);
    if (r.status === "EXCEPTION") throw r.error;
    return r.status === "TRUE";
  }

  let ok = false;
  if (w.mode === "single") ok = predBool(w.preds[0]);
  else if (w.mode === "all") ok = w.preds.every((id) => predBool(id));
  else if (w.mode === "any") ok = w.preds.some((id) => predBool(id));

  t("condition evaluated", { whenMode: w.mode, result: ok });

  if (ok) {
    const control = execSteps(registry, operators, condition.steps, scopePipelineId, ctxBase, issues, trace, `condition:${condition.id}:steps`);
    if (control === "STOP") return "STOP";
  }
  return "CONTINUE";
}

module.exports = { runPipeline };
