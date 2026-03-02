const { assert, isObject, normalizeWhenExpr, stepKind } = require("./utils");
const { Operators } = require("./operators");
const { resolveRef } = require("./resolver");

const LEVELS = new Set(["WARNING", "ERROR", "EXCEPTION"]);

function compile(artifacts) {
  assert(Array.isArray(artifacts), "compile: artifacts must be an array");

  const registry = new Map();
  for (const a of artifacts) {
    assert(a && typeof a.id === "string" && a.id.length > 0, "Artifact must have non-empty id");
    assert(a && typeof a.type === "string", `Artifact ${a.id} must have type`);
    assert(typeof a.description === "string", `Artifact ${a.id} must have description`);
    assert(!registry.has(a.id), `Duplicate artifact id: ${a.id}`);
    registry.set(a.id, a);
  }

  const dictionaries = new Map();
  for (const a of artifacts) if (a.type === "dictionary") dictionaries.set(a.id, a);

  // schema + operator existence
  for (const a of artifacts) {
    if (a.type === "pipeline") {
      assert(Array.isArray(a.flow) && a.flow.length > 0, `Pipeline ${a.id}: flow must be non-empty array`);
      for (const s of a.flow) {
        assert(isObject(s), `Pipeline ${a.id}: each flow step must be object`);
        stepKind(s);
      }
    } else if (a.type === "condition") {
      assert(Array.isArray(a.steps) && a.steps.length > 0, `Condition ${a.id}: steps must be non-empty array`);
      normalizeWhenExpr(a.when);
      for (const s of a.steps) {
        assert(isObject(s), `Condition ${a.id}: each step must be object`);
        stepKind(s);
      }
    } else if (a.type === "rule") {
      assert(a.role === "check" || a.role === "predicate", `Rule ${a.id}: role must be check|predicate`);
      assert(typeof a.operator === "string" && a.operator.length > 0, `Rule ${a.id}: operator required`);

      if (a.role === "check") {
        assert(LEVELS.has(a.level), `Check rule ${a.id}: level must be WARNING|ERROR|EXCEPTION`);
        assert(typeof a.code === "string" && a.code.length > 0, `Check rule ${a.id}: code required`);
        assert(typeof a.message === "string" && a.message.length > 0, `Check rule ${a.id}: message required`);
        assert(!!Operators.check[a.operator], `Check rule ${a.id}: unknown operator ${a.operator}`);
      } else {
        assert(a.level === undefined && a.code === undefined && a.message === undefined, `Predicate rule ${a.id}: must not have level/code/message`);
        assert(!!Operators.predicate[a.operator], `Predicate rule ${a.id}: unknown operator ${a.operator}`);
      }

      if (a.operator === "any_filled") {
        assert(Array.isArray(a.paths) && a.paths.length > 0, `Rule ${a.id}: any_filled requires paths[]`);
      }
      if (a.operator === "in_dictionary") {
        assert(a.dictionary && a.dictionary.type === "static" && typeof a.dictionary.id === "string", `Rule ${a.id}: in_dictionary requires dictionary{type:static,id}`);
        assert(dictionaries.has(a.dictionary.id), `Rule ${a.id}: dictionary not found: ${a.dictionary.id}`);
      }
      if (a.operator === "field_less_than_field" || a.operator === "field_greater_than_field") {
        assert(typeof a.value_field === "string" && a.value_field.length > 0, `Rule ${a.id}: ${a.operator} requires value_field`);
      }
      if (a.operator === "matches_regex") {
        assert(typeof a.value === "string" && a.value.length > 0, `Rule ${a.id}: matches_regex requires value (regex string)`);
      }
    } else if (a.type === "dictionary") {
      // ok
    } else {
      throw new Error(`Unknown artifact type: ${a.type} (id=${a.id})`);
    }
  }

  // references validation with scope
  for (const a of artifacts) {
    if (a.type === "pipeline") {
      const scopePipelineId = a.id;
      for (const s of a.flow) validateStepRef(s, registry, `pipeline:${a.id}`, scopePipelineId);
    }
    if (a.type === "condition") {
      const scopePipelineId = a.__pipelineId || inferPipelineFromId(a.id);
      const w = normalizeWhenExpr(a.when);
      assert(w.preds.length > 0, `Condition ${a.id}: when predicate list must be non-empty`);
      for (const predRef of w.preds) {
        const predId = resolveRef("rule", predRef, scopePipelineId);
        const pred = registry.get(predId);
        assert(pred, `Condition ${a.id}: when references missing id ${predId} (from ${predRef})`);
        assert(pred.type === "rule" && pred.role === "predicate", `Condition ${a.id}: when ${predId} must be rule(role=predicate)`);
      }
      for (const s of a.steps) validateStepRef(s, registry, `condition:${a.id}`, scopePipelineId);
    }
  }

  validatePipelineDAG(registry);

  return { registry, dictionaries };
}

function inferPipelineFromId(id) {
  // pipeline-scoped artifacts have id like "<pipelineId>.<name>"
  const idx = id.indexOf(".");
  return idx > 0 ? id.slice(0, idx) : null;
}

function validateStepRef(step, registry, scope, scopePipelineId) {
  const k = stepKind(step);
  const ref = step[k];
  if (k === "pipeline") {
    // pipelines are global ids (no scoping)
    assert(typeof ref === "string" && ref.length > 0, `Invalid pipeline ref in ${scope}`);
    const a = registry.get(ref);
    assert(a && a.type === "pipeline", `Invalid ref in ${scope}: pipeline=${ref} must be type=pipeline`);
    return;
  }

  const id = resolveRef(k, ref, scopePipelineId);
  const a = registry.get(id);
  assert(a, `Missing artifact referenced in ${scope}: ${k}=${ref} (resolved to ${id})`);

  if (k === "rule") assert(a.type === "rule", `Invalid ref in ${scope}: rule=${id} must be type=rule`);
  if (k === "condition") assert(a.type === "condition", `Invalid ref in ${scope}: condition=${id} must be type=condition`);
}

function validatePipelineDAG(registry) {
  const pipelines = [];
  for (const a of registry.values()) if (a.type === "pipeline") pipelines.push(a);

  const adj = new Map();
  for (const p of pipelines) {
    const called = [];
    for (const s of p.flow) {
      if (s.pipeline) called.push(s.pipeline);
      if (s.condition) {
        // condition ref may be scoped; but DAG only considers pipeline->pipeline edges.
        // We'll conservatively scan all condition artifacts and pick those referenced with scope in runtime; for prototype, we scan by resolving with p.id.
        const { resolveRef } = require("./resolver");
        const cid = resolveRef("condition", s.condition, p.id);
        const cond = registry.get(cid);
        if (cond) {
          for (const st of cond.steps) if (st.pipeline) called.push(st.pipeline);
        }
      }
    }
    adj.set(p.id, called.filter((x) => registry.get(x)?.type === "pipeline"));
  }

  const visiting = new Set();
  const visited = new Set();

  function dfs(node, stack) {
    if (visiting.has(node)) {
      const idx = stack.indexOf(node);
      const cycle = idx >= 0 ? stack.slice(idx).concat([node]) : stack.concat([node]);
      throw new Error(`Pipeline cycle detected: ${cycle.join(" -> ")}`);
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    const next = adj.get(node) || [];
    for (const n of next) dfs(n, stack);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const p of pipelines) dfs(p.id, []);
}

module.exports = { compile };
