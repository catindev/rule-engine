/**
 * compiler/validate-refs.js
 *
 * Фаза 4 валидации: проверяет ссылки между артефактами и правила видимости.
 * Возвращает string[] ошибок вместо бросания исключений.
 */

'use strict';

const { normalizeWhenExpr, stepKind } = require('../utils');
const { resolveRef } = require('../resolver');
const { where, fileOf } = require('./context');

function validateRefs(artifacts, registry) {
  const errors = [];
  for (const a of artifacts) {
    if (a.type === 'pipeline') {
      errors.push(...validatePipelineRefs(a, registry));
    } else if (a.type === 'condition') {
      errors.push(...validateConditionRefs(a, registry));
    }
  }
  return errors;
}

function validatePipelineRefs(a, registry) {
  const errors = [];
  const scopePipelineId = a.id;
  const scope = `pipeline:${a.id} (${fileOf(a.id)})`;
  for (const s of a.flow) {
    errors.push(...validateStepRef(s, registry, scope, scopePipelineId));
  }
  return errors;
}

function validateConditionRefs(a, registry) {
  const errors = [];
  const scopePipelineId = inferPipelineFromId(a.id);
  if (!scopePipelineId) {
    errors.push(`Condition ${where(a)}: cannot infer pipeline scope from id`);
    return errors;
  }
  errors.push(...validateConditionWhen(a, registry, scopePipelineId));
  const scope = `condition:${a.id} (${fileOf(a.id)})`;
  for (const s of a.steps) {
    errors.push(...validateStepRef(s, registry, scope, scopePipelineId));
  }
  return errors;
}

function validateConditionWhen(a, registry, scopePipelineId) {
  const errors = [];
  let w;
  try { w = normalizeWhenExpr(a.when); } catch (e) {
    errors.push(`Condition ${where(a)}: invalid when — ${e.message}`);
    return errors;
  }
  if (!w.preds || w.preds.length === 0) {
    errors.push(`Condition ${where(a)}: when predicate list must be non-empty`);
    return errors;
  }
  for (const predRef of w.preds) {
    const predId = resolveRef('rule', predRef, scopePipelineId);
    const pred   = registry.get(predId);
    if (!pred) {
      errors.push(`Condition ${where(a)}: when references missing id ${predId} (from ${predRef})`);
      continue;
    }
    if (pred.type !== 'rule' || pred.role !== 'predicate') {
      errors.push(`Condition ${where(a)}: when ${predId} must be rule(role=predicate)`);
    }
  }
  return errors;
}

function validateStepRef(step, registry, scope, scopePipelineId) {
  const errors = [];
  let k;
  try { k = stepKind(step); } catch (e) {
    errors.push(`${scope}: ${e.message}`);
    return errors;
  }
  const ref = step[k];

  if (k === 'pipeline') {
    if (typeof ref !== 'string' || ref.length === 0) {
      errors.push(`Invalid pipeline ref in ${scope}`);
      return errors;
    }
    const a = registry.get(ref);
    if (!a || a.type !== 'pipeline') {
      errors.push(`Invalid ref in ${scope}: pipeline=${ref} must be type=pipeline`);
    }
    return errors;
  }

  const id = resolveRef(k, ref, scopePipelineId);
  const a  = registry.get(id);
  if (!a) {
    errors.push(`Missing artifact referenced in ${scope}: ${k}=${ref} (resolved to ${id})`);
    return errors;
  }
  if (k === 'rule' && a.type !== 'rule') {
    errors.push(`Invalid ref in ${scope}: rule=${id} must be type=rule`);
  }
  if (k === 'condition' && a.type !== 'condition') {
    errors.push(`Invalid ref in ${scope}: condition=${id} must be type=condition`);
  }
  errors.push(...validateVisibility(a, k, id, scope, scopePipelineId));
  return errors;
}

function validateVisibility(a, kind, id, scope, scopePipelineId) {
  if (kind !== 'rule' && kind !== 'condition') return [];
  if (typeof a.id === 'string' && a.id.startsWith('library.')) return [];
  if (typeof a.id === 'string' && a.id.startsWith(scopePipelineId + '.')) return [];
  return [`Invalid ref in ${scope}: ${kind}=${id} is not visible from pipeline ${scopePipelineId}`];
}

function inferPipelineFromId(id) {
  const idx = id.lastIndexOf('.');
  return idx > 0 ? id.slice(0, idx) : null;
}

module.exports = { validateRefs, inferPipelineFromId };
