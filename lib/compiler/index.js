/**
 * compiler/index.js
 *
 * Оркестратор компиляции. Вызывает фазы в порядке и собирает compiled-объект.
 *
 * Фазы:
 *   1. buildRegistry          — дедупликация артефактов, сборка Map и словарей
 *   2. validateSchema         — схема каждого артефакта по типу
 *   3. validateCodeUniqueness — уникальность error-кодов check-правил
 *   4. validateRefs           — ссылки между артефактами + видимость
 *   5. buildConditions        — compile-time нормализация conditions
 *   6. buildPipelines         — compile-time нормализация pipelines
 *   7. validatePipelineDAG    — проверка отсутствия циклов
 *
 * Поведение при ошибках:
 *   Каждая фаза собирает ВСЕ найденные ошибки и возвращает их массивом.
 *   После каждой фазы: если есть ошибки — бросаем CompilationError и останавливаемся.
 *   Это даёт аналитику полный список проблем внутри фазы, но не смешивает
 *   ошибки разных фаз (например, ошибки ссылок бессмысленны если реестр сломан).
 */

'use strict';

const { assert, isObject } = require('../utils');
const { setContext, clearContext } = require('./context');
const { CompilationError } = require('./compilation-error');
const { validateSchema, validateCodeUniqueness } = require('./validate-schema');
const { validateRefs } = require('./validate-refs');
const { validatePipelineDAG } = require('./validate-dag');
const { buildConditions, buildPipelines } = require('./build-steps');

function compile(artifacts, options = {}) {
  assert(Array.isArray(artifacts), 'compile: artifacts must be an array');

  const operators = options.operators;
  assert(
    isObject(operators) &&
      isObject(operators.check) &&
      isObject(operators.predicate),
    'compile: options.operators with {check,predicate} is required',
  );

  const sources = options.sources instanceof Map ? options.sources : null;

  setContext(sources);
  try {
    // Фаза 1: реестр — fail-fast, остальные фазы зависят от него
    const { registry, dictionaries, errors: regErrors } = buildRegistry(artifacts);
    throwIfErrors(regErrors);

    // Фаза 2: схема артефактов — собираем все ошибки по всем артефактам
    const schemaErrors = validateSchema(artifacts, dictionaries, operators);
    throwIfErrors(schemaErrors);

    // Фаза 3: уникальность кодов
    const codeErrors = validateCodeUniqueness(artifacts);
    throwIfErrors(codeErrors);

    // Фаза 4: ссылки и видимость
    const refErrors = validateRefs(artifacts, registry);
    throwIfErrors(refErrors);

    // Фазы 5–6: компиляция шагов (бросают assert — структура уже проверена)
    const compiledConditions = buildConditions(artifacts);
    const compiledPipelines  = buildPipelines(artifacts);

    // Фаза 7: DAG (нет циклов)
    const dagErrors = validatePipelineDAG(registry, compiledPipelines, compiledConditions);
    throwIfErrors(dagErrors);

    return {
      registry,
      dictionaries,
      sources,
      operators,
      pipelines:  compiledPipelines,
      conditions: compiledConditions,
    };
  } finally {
    clearContext();
  }
}

function throwIfErrors(errors) {
  if (errors && errors.length > 0) throw new CompilationError(errors);
}

/**
 * Строит реестр всех артефактов и отдельный Map словарей.
 * Возвращает { registry, dictionaries, errors[] } вместо бросания исключений.
 */
function buildRegistry(artifacts) {
  const registry    = new Map();
  const dictionaries = new Map();
  const errors      = [];

  for (const a of artifacts) {
    if (!a || typeof a.id !== 'string' || a.id.length === 0) {
      errors.push('Artifact must have non-empty id');
      continue;
    }
    if (typeof a.type !== 'string') {
      errors.push(`Artifact ${a.id} must have type`);
      continue;
    }
    if (typeof a.description !== 'string') {
      errors.push(`Artifact ${a.id} must have description`);
      continue;
    }
    if (registry.has(a.id)) {
      errors.push(`Duplicate artifact id: ${a.id}`);
      continue;
    }
    registry.set(a.id, a);
    if (a.type === 'dictionary') dictionaries.set(a.id, a);
  }

  return { registry, dictionaries, errors };
}

module.exports = { compile };
