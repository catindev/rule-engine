/**
 * validate-dag.js
 *
 * Фаза 3: проверка отсутствия циклов в графе зависимостей пайплайнов.
 * Полностью самодостаточный модуль — зависит только от registry
 * и скомпилированных шагов.
 *
 * Экспортирует:
 *   validatePipelineDAG(registry, compiledPipelines, compiledConditions)
 */

// ---------- internal ----------

/**
 * Строит граф смежности: pipelineId → [pipelineId, ...]
 * Учитывает вызовы pipeline как из flow, так и из шагов condition.
 */
function buildAdjacency(pipelines, compiledPipelines, compiledConditions, registry) {
  const adj = new Map();

  for (const p of pipelines) {
    const called = [];
    const compiled = compiledPipelines.get(p.id);
    const flow = compiled ? compiled.steps : [];

    for (const s of flow) {
      if (s.kind === "pipeline") {
        called.push(s.pipelineId);
      }
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

  return adj;
}

/**
 * DFS-обход с отслеживанием текущего пути (stack).
 * При обнаружении обратного ребра бросает ошибку с циклом.
 */
function dfs(node, adj, visiting, visited, stack) {
  if (visiting.has(node)) {
    const idx = stack.indexOf(node);
    const cycle =
      idx >= 0 ? stack.slice(idx).concat([node]) : stack.concat([node]);
    throw new Error(`Pipeline cycle detected: ${cycle.join(" -> ")}`);
  }
  if (visited.has(node)) return;

  visiting.add(node);
  stack.push(node);

  for (const next of adj.get(node) || []) dfs(next, adj, visiting, visited, stack);

  stack.pop();
  visiting.delete(node);
  visited.add(node);
}

// ---------- public ----------

function validatePipelineDAG(registry, compiledPipelines, compiledConditions) {
  const pipelines = [];
  for (const a of registry.values())
    if (a.type === "pipeline") pipelines.push(a);

  const adj = buildAdjacency(pipelines, compiledPipelines, compiledConditions, registry);

  const visiting = new Set();
  const visited  = new Set();

  for (const p of pipelines) dfs(p.id, adj, visiting, visited, []);
}

module.exports = { validatePipelineDAG };
