const { deepGet } = require("../../utils");

module.exports = function (rule, ctx) {
  try {
    const a = deepGet(ctx.payload, rule.field);
    const b = deepGet(ctx.payload, rule.value_field);

    if (!a.ok || !b.ok) return { status: "UNDEFINED" };

    return {
      status: a.value !== b.value ? "TRUE" : "FALSE",
    };
  } catch (e) {
    return { status: "EXCEPTION", error: e };
  }
};
