const { deepGet } = require("../../utils");
module.exports = function(rule, ctx) {
  try {
    const got = deepGet(ctx.payload, rule.field);
    if (!got.ok) return { status: "UNDEFINED" };
    const s = String(got.value ?? "");
    return { status: s.includes(String(rule.value ?? "")) ? "TRUE" : "FALSE" };
  } catch (e) { return { status: "EXCEPTION", error: e }; }
};
