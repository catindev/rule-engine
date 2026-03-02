const { deepGet } = require("../../utils");

function normalizePattern(p) {
  return String(p ?? "").replace(/\\\\/g, "\\");
}

module.exports = function(rule, ctx) {
  try {
    const got = deepGet(ctx.payload, rule.field);
    if (!got.ok) return { status: "UNDEFINED" };
    const s = String(got.value ?? "");
    const pattern = normalizePattern(rule.value);
    const re = new RegExp(pattern);
    return { status: re.test(s) ? "OK" : "FAIL" };
  } catch (e) { return { status: "EXCEPTION", error: e }; }
};
