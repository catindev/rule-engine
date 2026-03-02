const { deepGet, isEmptyValue } = require("../../utils");
module.exports = function(rule, ctx) {
  try {
    const paths = Array.isArray(rule.paths) ? rule.paths : [];
    if (paths.length === 0) return { status: "EXCEPTION", error: new Error("any_filled requires paths[]") };
    const ok = paths.some((p) => {
      const got = deepGet(ctx.payload, p);
      return got.ok && !isEmptyValue(got.value);
    });
    return { status: ok ? "OK" : "FAIL" };
  } catch (e) { return { status: "EXCEPTION", error: e }; }
};
