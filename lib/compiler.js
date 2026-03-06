const { assert, isObject, normalizeWhenExpr, stepKind } = require("./utils");
const { resolveRef } = require("./resolver");

const LEVELS = new Set(["WARNING", "ERROR", "EXCEPTION"]);

function where(a) {
  const id = a && a.id ? a.id : "<unknown id>";
  const file = fileOf(id);
  return `${id} (${file})`;
}

function fileOf(id) {
  if (!CURRENT_SOURCES || !id) return "<unknown source>";
  const meta = CURRENT_SOURCES.get(id);
  return meta && meta.file ? meta.file : "<unknown source>";
}

// NOTE: internal helper to avoid threading sources through every function signature.
// compile() sets it for the duration of compilation.
let CURRENT_SOURCES = null;

function compile(artifacts, options = {}) {
  assert(Array.isArray(artifacts), "compile: artifacts must be an array");
  const operators = options.operators;
  assert(
    isObject(operators) &&
      isObject(operators.check) &&
      isObject(operators.predicate),
    "compile: options.operators with {check,predicate} is required",
  );
  const sources = options.sources instanceof Map ? options.sources : null;
  CURRENT_SOURCES = sources;

  const registry = new Map();
  for (const a of artifacts) {
    assert(
      a && typeof a.id === "string" && a.id.length > 0,
      "Artifact must have non-empty id",
    );
    assert(a && typeof a.type === "string", `Artifact ${a.id} must have type`);
    assert(
      typeof a.description === "string",
      `Artifact ${a.id} must have description`,
    );
    assert(!registry.has(a.id), `Duplicate artifact id: ${a.id}`);
    registry.set(a.id, a);
  }

  const dictionaries = new Map();
  for (const a of artifacts)
    if (a.type === "dictionary") dictionaries.set(a.id, a);

  // schema + operator existence
  for (const a of artifacts) {
    if (a.type === "pipeline") {
      assert(
        Array.isArray(a.flow) && a.flow.length > 0,
        `Pipeline ${where(a)}: flow must be non-empty array`,
      );

      // strict must be explicitly set by pipeline author to avoid implicit behavior
      assert(
        typeof a.strict === "boolean",
        `Pipeline ${where(a)}: strict must be explicitly set to true|false`,
      );
      if (a.strict === true) {
        assert(
          typeof a.message === "string" && a.message.length > 0,
          `Pipeline ${where(a)}: message is required when strict=true`,
        );
        if (a.strictCode !== undefined) {
          assert(
            typeof a.strictCode === "string" && a.strictCode.length > 0,
            `Pipeline ${where(a)}: strictCode must be non-empty string if provided`,
          );
        }
      }

      for (const s of a.flow) {
        assert(isObject(s), `Pipeline ${a.id}: each flow step must be object`);
        stepKind(s);
      }
    } else if (a.type === "condition") {
      assert(
        Array.isArray(a.steps) && a.steps.length > 0,
        `Condition ${where(a)}: steps must be non-empty array`,
      );
      normalizeWhenExpr(a.when);
      for (const s of a.steps) {
        assert(isObject(s), `Condition ${where(a)}: each step must be object`);
        stepKind(s);
      }
    } else if (a.type === "rule") {
      assert(
        a.role === "check" || a.role === "predicate",
        `Rule ${where(a)}: role must be check|predicate`,
      );
      assert(
        typeof a.operator === "string" && a.operator.length > 0,
        `Rule ${where(a)}: operator required`,
      );

      if (a.role === "check") {
        assert(
          LEVELS.has(a.level),
          `Check rule ${where(a)}: level must be WARNING|ERROR|EXCEPTION`,
        );
        assert(
          typeof a.code === "string" && a.code.length > 0,
          `Check rule ${where(a)}: code required`,
        );
        assert(
          typeof a.message === "string" && a.message.length > 0,
          `Check rule ${where(a)}: message required`,
        );
        assert(
          !!operators.check[a.operator],
          `Check rule ${where(a)}: unknown operator ${a.operator}`,
        );
      } else {
        assert(
          a.level === undefined &&
            a.code === undefined &&
            a.message === undefined,
          `Predicate rule ${where(a)}: must not have level/code/message`,
        );
        assert(
          !!operators.predicate[a.operator],
          `Predicate rule ${where(a)}: unknown operator ${a.operator}`,
        );
      }

      if (a.operator === "any_filled") {
        assert(
          Array.isArray(a.paths) && a.paths.length > 0,
          `Rule ${where(a)}: any_filled requires paths[]`,
        );
      }
      if (a.operator === "in_dictionary") {
        assert(
          a.dictionary &&
            a.dictionary.type === "static" &&
            typeof a.dictionary.id === "string",
          `Rule ${where(a)}: in_dictionary requires dictionary{type:static,id}`,
        );
        assert(
          dictionaries.has(a.dictionary.id),
          `Rule ${where(a)}: dictionary not found: ${a.dictionary.id}`,
        );
      }
      if (
        a.operator === "field_less_than_field" ||
        a.operator === "field_greater_than_field"
      ) {
        assert(
          typeof a.value_field === "string" && a.value_field.length > 0,
          `Rule ${where(a)}: ${a.operator} requires value_field`,
        );
      }
      if (a.operator === "matches_regex") {
        assert(
          typeof a.value === "string" && a.value.length > 0,
          `Rule ${a.id}: matches_regex requires value (regex string)`,
        );
      }

      // Optional meta: any JSON object with additional context for analysts.
      // Kept schema-loose on purpose, but must be an object if provided.
      if (a.meta !== undefined) {
        assert(
          isObject(a.meta),
          `Rule ${where(a)}: meta must be an object if provided`,
        );
      }

      // Optional aggregate: used mainly with wildcard fields to define aggregation behavior.
      // Schema is intentionally light, but validate basic shape to avoid silent typos.
      if (a.aggregate !== undefined) {
        assert(
          isObject(a.aggregate),
          `Rule ${where(a)}: aggregate must be an object if provided`,
        );
        if (a.aggregate.mode !== undefined) {
          assert(
            typeof a.aggregate.mode === "string" && a.aggregate.mode.length > 0,
            `Rule ${where(a)}: aggregate.mode must be non-empty string`,
          );
        }
        if (a.aggregate.onEmpty !== undefined) {
          assert(
            typeof a.aggregate.onEmpty === "string" && a.aggregate.onEmpty.length > 0,
            `Rule ${where(a)}: aggregate.onEmpty must be non-empty string`,
          );
        }
      }
    } else if (a.type === "dictionary") {
      // ok
    } else {
      throw new Error(
        `Unknown artifact type: ${a.type} (id=${a.id}, source=${fileOf(a.id)})`,
      );
    }
  }

  // check code uniqueness: code acts as a stable checkId for orchestrators,
  // so duplicates are a contract violation regardless of rule id.
  const codes = new Map();
  for (const a of artifacts) {
    if (a.type === "rule" && a.role === "check") {
      if (codes.has(a.code)) {
        throw new Error(
          `Duplicate check code "${a.code}": already used by ${codes.get(a.code)}, conflict with ${where(a)}`,
        );
      }
      codes.set(a.code, where(a));
    }
  }
  // references validation with scope

  for (const a of artifacts) {
    if (a.type === "pipeline") {
      const scopePipelineId = a.id;
      for (const s of a.flow)
        validateStepRef(
          s,
          registry,
          `pipeline:${a.id} (${fileOf(a.id)})`,
          scopePipelineId,
        );
    }
    if (a.type === "condition") {
      const scopePipelineId = inferPipelineFromId(a.id);
      assert(
        scopePipelineId,
        `Condition ${where(a)}: cannot infer pipeline scope from id`,
      );
      const w = normalizeWhenExpr(a.when);
      assert(
        w.preds.length > 0,
        `Condition ${where(a)}: when predicate list must be non-empty`,
      );
      for (const predRef of w.preds) {
        const predId = resolveRef("rule", predRef, scopePipelineId);
        const pred = registry.get(predId);
        assert(
          pred,
          `Condition ${where(a)}: when references missing id ${predId} (from ${predRef})`,
        );
        assert(
          pred.type === "rule" && pred.role === "predicate",
          `Condition ${where(a)}: when ${predId} must be rule(role=predicate)`,
        );
      }
      for (const s of a.steps)
        validateStepRef(
          s,
          registry,
          `condition:${a.id} (${fileOf(a.id)})`,
          scopePipelineId,
        );
    }
  }

  // === Step-4: compile-time normalization of steps and when-expressions ===
  const compiledConditions = new Map();
  for (const a of artifacts) {
    if (a.type !== "condition") continue;
    const scopePipelineId = inferPipelineFromId(a.id);
    const w = normalizeWhenExpr(a.when);
    const predIds = w.preds.map((predRef) =>
      resolveRef("rule", predRef, scopePipelineId),
    );
    const compiledWhen = { mode: w.mode, predIds };

    const steps = compileSteps(a.steps, scopePipelineId);
    compiledConditions.set(a.id, {
      when: compiledWhen,
      steps,
      scopePipelineId,
    });
  }

  const compiledPipelines = new Map();
  for (const a of artifacts) {
    if (a.type !== "pipeline") continue;
    compiledPipelines.set(a.id, {
      steps: compileSteps(a.flow, a.id),
      scopePipelineId: a.id,
    });
  }

  validatePipelineDAG(registry, compiledPipelines, compiledConditions);

  const compiled = {
    registry,
    dictionaries,
    sources,
    operators,
    pipelines: compiledPipelines,
    conditions: compiledConditions,
  };
  CURRENT_SOURCES = null;
  return compiled;
}

function inferPipelineFromId(id) {
  // pipeline-scoped artifacts have id like "<pipelineId>.<name>"
  // where pipelineId itself can contain dots (nested pipelines)
  const idx = id.lastIndexOf(".");
  return idx > 0 ? id.slice(0, idx) : null;
}

function compileSteps(steps, scopePipelineId) {
  assert(Array.isArray(steps), "compileSteps: steps must be an array");
  const out = [];
  for (const step of steps) {
    const kind = stepKind(step);
    const stepId = step.stepId;

    if (kind === "rule") {
      const ruleId = resolveRef("rule", step.rule, scopePipelineId);
      out.push({ kind: "rule", stepId, ruleId, ref: step.rule });
      continue;
    }

    if (kind === "condition") {
      const conditionId = resolveRef(
        "condition",
        step.condition,
        scopePipelineId,
      );
      out.push({ kind: "condition", stepId, conditionId, ref: step.condition });
      continue;
    }

    if (kind === "pipeline") {
      out.push({ kind: "pipeline", stepId, pipelineId: step.pipeline });
      continue;
    }
  }
  return out;
}

function validateStepRef(step, registry, scope, scopePipelineId) {
  const k = stepKind(step);
  const ref = step[k];
  if (k === "pipeline") {
    // pipelines are global ids (no scoping)
    assert(
      typeof ref === "string" && ref.length > 0,
      `Invalid pipeline ref in ${scope}`,
    );
    const a = registry.get(ref);
    assert(
      a && a.type === "pipeline",
      `Invalid ref in ${scope}: pipeline=${ref} must be type=pipeline`,
    );
    return;
  }

  const id = resolveRef(k, ref, scopePipelineId);
  const a = registry.get(id);
  assert(
    a,
    `Missing artifact referenced in ${scope}: ${k}=${ref} (resolved to ${id})`,
  );

  if (k === "rule")
    assert(
      a.type === "rule",
      `Invalid ref in ${scope}: rule=${id} must be type=rule`,
    );
  if (k === "condition")
    assert(
      a.type === "condition",
      `Invalid ref in ${scope}: condition=${id} must be type=condition`,
    );

  // Visibility / isolation:
  // - rules & conditions must be local to the current pipeline
  //   OR come from library.
  // - pipelines are allowed to reference other pipelines freely.
  if (k === "rule" || k === "condition") {
    const isLibrary = typeof a.id === "string" && a.id.startsWith("library.");
    if (!isLibrary) {
      const isLocal =
        typeof a.id === "string" && a.id.startsWith(scopePipelineId + ".");
      assert(
        isLocal,
        `Invalid ref in ${scope}: ${k}=${id} is not visible from pipeline ${scopePipelineId}`,
      );
    }
  }
}

function validatePipelineDAG(registry, compiledPipelines, compiledConditions) {
  const pipelines = [];
  for (const a of registry.values())
    if (a.type === "pipeline") pipelines.push(a);

  const adj = new Map();
  for (const p of pipelines) {
    const called = [];

    const compiled = compiledPipelines.get(p.id);
    const flow = compiled ? compiled.steps : [];

    for (const s of flow) {
      if (s.kind === "pipeline") called.push(s.pipelineId);
      if (s.kind === "condition") {
        const condCompiled = compiledConditions.get(s.conditionId);
        if (condCompiled) {
          for (const st of condCompiled.steps)
            if (st.kind === "pipeline") called.push(st.pipelineId);
        }
      }
    }
    adj.set(
      p.id,
      called.filter((x) => registry.get(x)?.type === "pipeline"),
    );
  }

  const visiting = new Set();
  const visited = new Set();

  function dfs(node, stack) {
    if (visiting.has(node)) {
      const idx = stack.indexOf(node);
      const cycle =
        idx >= 0 ? stack.slice(idx).concat([node]) : stack.concat([node]);
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
