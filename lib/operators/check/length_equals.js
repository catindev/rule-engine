const { deepGet } = require("../../utils");
module.exports = function(rule, ctx) {
  try {
    const got = deepGet(ctx.payload, rule.field);
    if (!got.ok) return { status: "FAIL" };
    const s = String(got.value ?? "");
    return { status: s.length === Number(rule.value) ? "OK" : "FAIL" };
  } catch (e) { return { status: "EXCEPTION", error: e }; }
};
