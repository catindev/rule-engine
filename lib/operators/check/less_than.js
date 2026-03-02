const { deepGet, toComparable } = require("../../utils");
module.exports = function(rule, ctx) {
  try {
    const got = deepGet(ctx.payload, rule.field);
    if (!got.ok) return { status: "FAIL" };
    const left = toComparable(got.value);
    const right = toComparable(rule.value);
    if (!left || !right || left.kind !== right.kind) return { status: "FAIL" };
    return { status: left.value < right.value ? "OK" : "FAIL" };
  } catch (e) { return { status: "EXCEPTION", error: e }; }
};
