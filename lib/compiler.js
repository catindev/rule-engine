const { assert, isObject, normalizeWhenExpr, stepKind } = require("./utils");
const { Operators } = require("./operators");
const { resolveRef } = require("./resolver");

const LEVELS = new Set(["WARNING", "ERROR", "EXCEPTION"]);

function where(a) {
  const id = a && a.id ? a.id : "<unknown id>";
  const file = a && a.__file ? a.__file : "<unknown file>";
  return `${id} (${file})`;
}

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
      assert(Array.isArray(a.flow) && a.flow.length > 0, `Pipeline ${where(a)}: flow must be non-empty array`);

      // strict must be explicitly set by pipeline author to avoid implicit behavior
      assert(typeof a.strict === "boolean", `Pipeline ${where(a)}: strict must be explicitly set to true|false`);
      if (a.strict === true) {
        assert(typeof a.message === "string" && a.message.length > 0, `Pipeline ${where(a)}: message is required when strict=true`);
        if (a.strictCode !== undefined) {
          assert(typeof a.strictCode === "string" && a.strictCode.length > 0, `Pipeline ${where(a)}: strictCode must be non-empty string if provided`);
        }
      }

      for (const s of a.flow) {
        assert(isObject(s), `Pipeline ${a.id}: each flow step must be object`);
        stepKind(s);
      }
    } else if (a.type === "condition") {
      assert(Array.isArray(a.steps) && a.steps.length > 0, `Condition ${where(a)}: steps must be non-empty array`);
      normalizeWhenExpr(a.when);
      for (const s of a.steps) {
        assert(isObject(s), `Condition ${where(a)}: each step must be object`);
        stepKind(s);
      }
    } else if (a.type === "rule") {
      assert(a.role === "check" || a.role === "predicate", `Rule ${where(a)}: role must be check|predicate`);
      assert(typeof a.operator === "string" && a.operator.length > 0, `Rule ${where(a)}: operator required`);

      if (a.role === "check") {
        assert(LEVELS.has(a.level), `Check rule ${where(a)}: level must be WARNING|ERROR|EXCEPTION`);
        assert(typeof a.code === "string" && a.code.length > 0, `Check rule ${where(a)}: code required`);
        assert(typeof a.message === "string" && a.message.length > 0, `Check rule ${where(a)}: message required`);
        assert(!!Operators.check[a.operator], `Check rule ${where(a)}: unknown operator ${a.operator}`);
      } else {
        assert(a.level === undefined && a.code === undefined && a.message === undefined, `Predicate rule ${where(a)}: must not have level/code/message`);
        assert(!!Operators.predicate[a.operator], `Predicate rule ${where(a)}: unknown operator ${a.operator}`);
      }

      if (a.operator === "any_filled") {
        assert(Array.isArray(a.paths) && a.paths.length > 0, `Rule ${where(a)}: any_filled requires paths[]`);
      }
      if (a.operator === "in_dictionary") {
        assert(a.dictionary && a.dictionary.type === "static" && typeof a.dictionary.id === "string", `Rule ${where(a)}: in_dictionary requires dictionary{type:static,id}`);
        assert(dictionaries.has(a.dictionary.id), `Rule ${where(a)}: dictionary not found: ${a.dictionary.id}`);
      }
      if (a.operator === "field_less_than_field" || a.operator === "field_greater_than_field") {
        assert(typeof a.value_field === "string" && a.value_field.length > 0, `Rule ${where(a)}: ${a.operator} requires value_field`);
      }
      if (a.operator === "matches_regex") {
        assert(typeof a.value === "string" && a.value.length > 0, `Rule ${a.id}: matches_regex requires value (regex string)`);
      }
    } else if (a.type === "dictionary") {
      // ok
    } else {
      throw new Error(`Unknown artifact type: ${a.type} (id=${a.id}, file=${a.__file || "<unknown file>"})`);
    }
  }

  // references validation with scope
  for (const a of artifacts) {
    if (a.type === "pipeline") {
      const scopePipelineId = a.id;
      for (const s of a.flow) validateStepRef(s, registry, `pipeline:${a.id} (${a.__file || "<unknown file>"})`, scopePipelineId);
    }
    if (a.type === "condition") {
      const scopePipelineId = a.__pipelineId || inferPipelineFromId(a.id);
      const w = normalizeWhenExpr(a.when);
      assert(w.preds.length > 0, `Condition ${where(a)}: when predicate list must be non-empty`);
      for (const predRef of w.preds) {
        const predId = resolveRef("rule", predRef, scopePipelineId);
        const pred = registry.get(predId);
        assert(pred, `Condition ${where(a)}: when references missing id ${predId} (from ${predRef})`);
        assert(pred.type === "rule" && pred.role === "predicate", `Condition ${where(a)}: when ${predId} must be rule(role=predicate)`);
      }
      for (const s of a.steps) validateStepRef(s, registry, `condition:${a.id} (${a.__file || "<unknown file>"})`, scopePipelineId);
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
