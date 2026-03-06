/**
 * validate-refs.js
 *
 * Фаза 2: валидация межартефактных ссылок и правил видимости.
 *
 * Экспортирует:
 *   validateRefs(artifacts, registry, ctx)
 */

const { assert, isObject, normalizeWhenExpr, stepKind } = require("../utils");
const { resolveRef } = require("../resolver");

// ---------- internal ----------

/**
 * Проверяет один шаг (rule/condition/pipeline ref) на существование
 * и соблюдение правил видимости.
 */
function validateStepRef(step, registry, scope, scopePipelineId, ctx) {
  const { fileOf } = ctx;
  const k = stepKind(step);
  const ref = step[k];

  if (k === "pipeline") {
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

  // Visibility: rules & conditions must be local to the pipeline OR from library.*
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

/**
 * Проверяет when-выражение condition: предикаты должны существовать
 * и иметь role=predicate.
 */
function validateConditionWhen(a, registry, scopePipelineId, ctx) {
  const { where } = ctx;
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
}

// ---------- public ----------

/**
 * Полный прогон валидации ссылок по всем артефактам.
 */
function validateRefs(artifacts, registry, ctx) {
  const { where, fileOf } = ctx;

  for (const a of artifacts) {
    if (a.type === "pipeline") {
      const scopePipelineId = a.id;
      for (const s of a.flow)
        validateStepRef(
          s,
          registry,
          `pipeline:${a.id} (${fileOf(a.id)})`,
          scopePipelineId,
          ctx,
        );
    }

    if (a.type === "condition") {
      const scopePipelineId = inferPipelineFromId(a.id);
      assert(
        scopePipelineId,
        `Condition ${where(a)}: cannot infer pipeline scope from id`,
      );
      validateConditionWhen(a, registry, scopePipelineId, ctx);
      for (const s of a.steps)
        validateStepRef(
          s,
          registry,
          `condition:${a.id} (${fileOf(a.id)})`,
          scopePipelineId,
          ctx,
        );
    }
  }
}

// Re-exported for use in build-steps.js too
function inferPipelineFromId(id) {
  const idx = id.lastIndexOf(".");
  return idx > 0 ? id.slice(0, idx) : null;
}

module.exports = { validateRefs, inferPipelineFromId };
