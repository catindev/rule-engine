/**
 * compiler/validate-dag.js
 *
 * Фаза 7 валидации: проверяет что граф вызовов пайплайнов — DAG (нет циклов).
 * Возвращает string[] ошибок вместо бросания исключений.
 */

'use strict';

function validatePipelineDAG(registry, compiledPipelines, compiledConditions) {
  const pipelines = [];
  for (const a of registry.values()) {
    if (a.type === 'pipeline') pipelines.push(a);
  }
  const adj = buildAdjacencyMap(pipelines, compiledPipelines, compiledConditions, registry);
  return detectCycles(pipelines, adj);
}

function buildAdjacencyMap(pipelines, compiledPipelines, compiledConditions, registry) {
  const adj = new Map();
  for (const p of pipelines) {
    const compiled = compiledPipelines.get(p.id);
    const steps    = compiled ? compiled.steps : [];
    const called   = collectCalledPipelines(steps, compiledConditions);
    adj.set(p.id, called.filter(x => registry.get(x)?.type === 'pipeline'));
  }
  return adj;
}

function collectCalledPipelines(steps, compiledConditions) {
  const called = [];
  for (const s of steps) {
    if (s.kind === 'pipeline') {
      called.push(s.pipelineId);
    }
    if (s.kind === 'condition') {
      const condCompiled = compiledConditions.get(s.conditionId);
      if (condCompiled) {
        for (const st of condCompiled.steps) {
          if (st.kind === 'pipeline') called.push(st.pipelineId);
        }
      }
    }
  }
  return called;
}

function detectCycles(pipelines, adj) {
  const errors   = [];
  const visiting = new Set();
  const visited  = new Set();

  function dfs(node, stack) {
    if (visiting.has(node)) {
      const idx   = stack.indexOf(node);
      const cycle = idx >= 0 ? stack.slice(idx).concat([node]) : stack.concat([node]);
      errors.push(`Pipeline cycle detected: ${cycle.join(' -> ')}`);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const next of adj.get(node) || []) {
      dfs(next, stack);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const p of pipelines) {
    dfs(p.id, []);
  }
  return errors;
}

module.exports = { validatePipelineDAG };
