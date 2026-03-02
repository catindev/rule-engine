const { deepGet, isEmptyValue } = require("../../utils");
module.exports = function(rule, ctx) {
  try {
    const got = deepGet(ctx.payload, rule.field);
    if (!got.ok) return { status: "UNDEFINED" };
    return { status: !isEmptyValue(got.value) ? "TRUE" : "FALSE" };
  } catch (e) { return { status: "EXCEPTION", error: e }; }
};
