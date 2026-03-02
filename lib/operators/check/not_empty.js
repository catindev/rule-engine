const { deepGet, isEmptyValue } = require("../../utils");
module.exports = function(rule, ctx) {
  try {
    const got = deepGet(ctx.payload, rule.field);
    if (!got.ok) return { status: "FAIL" };
    return { status: !isEmptyValue(got.value) ? "OK" : "FAIL" };
  } catch (e) { return { status: "EXCEPTION", error: e }; }
};
