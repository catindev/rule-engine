/**
 * build-steps.js
 *
 * Фаза 4: compile-time нормализация шагов и when-выражений.
 * Трансформирует JSON-шаги в нормализованные объекты с разрешёнными id.
 *
 * Экспортирует:
 *   compileSteps(steps, scopePipelineId)   → CompiledStep[]
 *   buildConditions(artifacts)             → Map<id, CompiledCondition>
 *   buildPipelines(artifacts)              → Map<id, CompiledPipeline>
 *
 * inferPipelineFromId реэкспортируется из validate-refs, чтобы
 * не дублировать реализацию.
 */

const { assert, normalizeWhenExpr, stepKind } = require("../utils");
const { resolveRef } = require("../resolver");
const { inferPipelineFromId } = require("./validate-refs");

// ---------- internal ----------

function compileSteps(steps, scopePipelineId) {
  assert(Array.isArray(steps), "compileSteps: steps must be an array");
  const out = [];

  for (const step of steps) {
    const kind   = stepKind(step);
    const stepId = step.stepId;

    if (kind === "rule") {
      const ruleId = resolveRef("rule", step.rule, scopePipelineId);
      out.push({ kind: "rule", stepId, ruleId, ref: step.rule });
      continue;
    }

    if (kind === "condition") {
      const conditionId = resolveRef("condition", step.condition, scopePipelineId);
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

// ---------- public ----------

function buildConditions(artifacts) {
  const compiledConditions = new Map();

  for (const a of artifacts) {
    if (a.type !== "condition") continue;

    const scopePipelineId = inferPipelineFromId(a.id);
    const w = normalizeWhenExpr(a.when);
    const predIds = w.preds.map((predRef) =>
      resolveRef("rule", predRef, scopePipelineId),
    );

    compiledConditions.set(a.id, {
      when: { mode: w.mode, predIds },
      steps: compileSteps(a.steps, scopePipelineId),
      scopePipelineId,
    });
  }

  return compiledConditions;
}

function buildPipelines(artifacts) {
  const compiledPipelines = new Map();

  for (const a of artifacts) {
    if (a.type !== "pipeline") continue;
    compiledPipelines.set(a.id, {
      steps: compileSteps(a.flow, a.id),
      scopePipelineId: a.id,
    });
  }

  return compiledPipelines;
}

module.exports = { compileSteps, buildConditions, buildPipelines };
