/**
 * lib/compiler/index.js
 *
 * Оркестратор фаз компиляции. Внешний API не меняется:
 *   const { compile } = require('./compiler');
 *
 * Порядок фаз:
 *   1. buildRegistry      — дедупликация и индексирование артефактов
 *   2. validateSchema     — схема каждого артефакта по отдельности
 *   3. validateCodeUniq   — уникальность error-кодов check-правил
 *   4. validateRefs       — межартефактные ссылки + правила видимости
 *   5. buildConditions    — compile-time нормализация conditions
 *   6. buildPipelines     — compile-time нормализация pipelines
 *   7. validateDAG        — проверка отсутствия циклов
 *
 * Фикс CURRENT_SOURCES: контекст (sources, where, fileOf) создаётся как
 * локальный объект на время одного вызова compile() и передаётся явно
 * через аргументы — никакого глобального состояния нет.
 * Файл context.js больше не хранит ничего между вызовами.
 */

const { assert, isObject } = require("../utils");
const { createContext } = require("./context");
const { validateSchema, validateCodeUniqueness } = require("./validate-schema");
const { validateRefs } = require("./validate-refs");
const { validatePipelineDAG } = require("./validate-dag");
const { buildConditions, buildPipelines } = require("./build-steps");

// ---------- internal ----------

function buildRegistry(artifacts) {
  const registry = new Map();
  const dictionaries = new Map();

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

  for (const a of artifacts)
    if (a.type === "dictionary") dictionaries.set(a.id, a);

  return { registry, dictionaries };
}

// ---------- public ----------

function compile(artifacts, options = {}) {
  assert(Array.isArray(artifacts), "compile: artifacts must be an array");

  const operators = options.operators;
  assert(
    isObject(operators) &&
      isObject(operators.check) &&
      isObject(operators.predicate),
    "compile: options.operators with {check,predicate} is required",
  );

  // ctx живёт только внутри этого вызова, никаких глобалов
  const ctx = createContext(options.sources);

  // Фаза 1
  const { registry, dictionaries } = buildRegistry(artifacts);

  // Фаза 2
  validateSchema(artifacts, dictionaries, operators, ctx);

  // Фаза 3
  validateCodeUniqueness(artifacts, ctx);

  // Фаза 4
  validateRefs(artifacts, registry, ctx);

  // Фазы 5–6
  const compiledConditions = buildConditions(artifacts);
  const compiledPipelines = buildPipelines(artifacts);

  // Фаза 7
  validatePipelineDAG(registry, compiledPipelines, compiledConditions);

  return {
    registry,
    dictionaries,
    sources: ctx.sources,
    operators,
    pipelines: compiledPipelines,
    conditions: compiledConditions,
  };
}

module.exports = { compile };
