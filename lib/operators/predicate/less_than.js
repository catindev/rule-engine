const { deepGet, toComparable } = require("../../utils");

module.exports = function(rule, ctx) {
  try {
    const got = deepGet(ctx.payload, rule.field);
    if (!got.ok) return { status: "UNDEFINED" };
    const left = toComparable(got.value);
    const right = toComparable(rule.value);
    if (!left || !right || left.kind !== right.kind) return { status: "UNDEFINED" };
    return { status: left.value < right.value ? "TRUE" : "FALSE" };
  } catch (e) {
    return { status: "EXCEPTION", error: e };
  }
};
