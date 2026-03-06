const { deepGet } = require("../../utils");

module.exports = function (rule, ctx) {
  try {
    const a = deepGet(ctx.payload, rule.field);
    const b = deepGet(ctx.payload, rule.value_field);

    if (!a.ok || !b.ok) return { status: "FAIL" };

    return {
      status: a.value !== b.value ? "OK" : "FAIL",
    };
  } catch (e) {
    return { status: "EXCEPTION", error: e };
  }
};
