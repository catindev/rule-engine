/**
 * validate-schema.js
 *
 * Фаза 1: валидация схемы каждого артефакта по отдельности.
 * Не знает о ссылках между артефактами — только внутренняя корректность полей.
 *
 * Экспортирует:
 *   validateSchema(artifacts, dictionaries, operators, ctx)
 *   validateCodeUniqueness(artifacts, ctx)
 */

const { assert, isObject, normalizeWhenExpr, stepKind } = require("../utils");

const LEVELS = new Set(["WARNING", "ERROR", "EXCEPTION"]);

const VALID_CHECK_AGGREGATE_MODES  = new Set(["EACH", "ALL", "COUNT", "MIN", "MAX"]);
const VALID_PRED_AGGREGATE_MODES   = new Set(["ANY", "ALL", "COUNT"]);
const VALID_ON_EMPTY_VALUES        = new Set(["PASS", "FAIL", "ERROR", "TRUE", "FALSE", "UNDEFINED"]);

// ---------- pipeline ----------

function validatePipelineSchema(a, ctx) {
  const { where } = ctx;
  assert(
    Array.isArray(a.flow) && a.flow.length > 0,
    `Pipeline ${where(a)}: flow must be non-empty array`,
  );
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
}

// ---------- condition ----------

function validateConditionSchema(a, ctx) {
  const { where } = ctx;
  assert(
    Array.isArray(a.steps) && a.steps.length > 0,
    `Condition ${where(a)}: steps must be non-empty array`,
  );
  normalizeWhenExpr(a.when); // throws on invalid shape
  for (const s of a.steps) {
    assert(isObject(s), `Condition ${where(a)}: each step must be object`);
    stepKind(s);
  }
}

// ---------- rule ----------

function validateRuleOperatorParams(a, dictionaries, ctx) {
  const { where } = ctx;

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
    a.operator === "field_greater_than_field" ||
    a.operator === "field_equals_field" ||
    a.operator === "field_not_equals_field"
  ) {
    assert(
      typeof a.value_field === "string" && a.value_field.length > 0,
      `Rule ${where(a)}: ${a.operator} requires value_field`,
    );
  }

  if (a.operator === "matches_regex") {
    assert(
      typeof a.value === "string" && a.value.length > 0,
      `Rule ${where(a)}: matches_regex requires value (regex string)`,
    );
  }
}

function validateRuleAggregate(a, ctx) {
  const { where } = ctx;
  if (a.aggregate === undefined) return;

  assert(
    isObject(a.aggregate),
    `Rule ${where(a)}: aggregate must be an object if provided`,
  );

  if (a.aggregate.mode !== undefined) {
    const validModes = a.role === "check"
      ? VALID_CHECK_AGGREGATE_MODES
      : VALID_PRED_AGGREGATE_MODES;
    assert(
      typeof a.aggregate.mode === "string" && validModes.has(a.aggregate.mode),
      `Rule ${where(a)}: aggregate.mode must be one of [${[...validModes].join(", ")}], got: ${a.aggregate.mode}`,
    );
  }

  if (a.aggregate.onEmpty !== undefined) {
    assert(
      typeof a.aggregate.onEmpty === "string" &&
        VALID_ON_EMPTY_VALUES.has(a.aggregate.onEmpty),
      `Rule ${where(a)}: aggregate.onEmpty must be one of [${[...VALID_ON_EMPTY_VALUES].join(", ")}], got: ${a.aggregate.onEmpty}`,
    );
  }
}

function validateRuleSchema(a, dictionaries, operators, ctx) {
  const { where } = ctx;

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
      a.level === undefined && a.code === undefined && a.message === undefined,
      `Predicate rule ${where(a)}: must not have level/code/message`,
    );
    assert(
      !!operators.predicate[a.operator],
      `Predicate rule ${where(a)}: unknown operator ${a.operator}`,
    );
  }

  validateRuleOperatorParams(a, dictionaries, ctx);

  // meta — schema-loose, but must be object if provided
  if (a.meta !== undefined) {
    assert(
      isObject(a.meta),
      `Rule ${where(a)}: meta must be an object if provided`,
    );
  }

  validateRuleAggregate(a, ctx);
}

// ---------- public ----------

/**
 * Валидирует схему каждого артефакта по отдельности.
 * Не проверяет ссылки между артефактами.
 */
function validateSchema(artifacts, dictionaries, operators, ctx) {
  for (const a of artifacts) {
    if (a.type === "pipeline") {
      validatePipelineSchema(a, ctx);
    } else if (a.type === "condition") {
      validateConditionSchema(a, ctx);
    } else if (a.type === "rule") {
      validateRuleSchema(a, dictionaries, operators, ctx);
    } else if (a.type === "dictionary") {
      // structure validated by loader; nothing extra needed here
    } else {
      const { fileOf } = ctx;
      throw new Error(
        `Unknown artifact type: ${a.type} (id=${a.id}, source=${fileOf(a.id)})`,
      );
    }
  }
}

/**
 * Проверяет уникальность error-кодов check-правил.
 * code — стабильный идентификатор для оркестратора, дубли — нарушение контракта.
 */
function validateCodeUniqueness(artifacts, ctx) {
  const { where } = ctx;
  const codes = new Map();
  for (const a of artifacts) {
    if (a.type !== "rule" || a.role !== "check") continue;
    if (codes.has(a.code)) {
      throw new Error(
        `Duplicate check code "${a.code}": already used by ${codes.get(a.code)}, conflict with ${where(a)}`,
      );
    }
    codes.set(a.code, where(a));
  }
}

module.exports = { validateSchema, validateCodeUniqueness };
