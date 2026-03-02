const { deepGet } = require("../../utils");
module.exports = function(rule, ctx) {
  try {
    const got = deepGet(ctx.payload, rule.field);
    if (!got.ok) return { status: "FAIL" };
    const dictRef = rule.dictionary;
    if (!dictRef || dictRef.type !== "static") return { status: "EXCEPTION", error: new Error("Only static dictionary supported in prototype") };
    const dict = ctx.getDictionary(dictRef.id);
    if (!dict) return { status: "EXCEPTION", error: new Error(`Dictionary not found: ${dictRef.id}`) };
    const v = got.value;
    const entries = Array.isArray(dict.entries) ? dict.entries : [];
    const ok = entries.some((e) => (typeof e === "string" ? e === v : (e.code === v || e.value === v)));
    return { status: ok ? "OK" : "FAIL" };
  } catch (e) { return { status: "EXCEPTION", error: e }; }
};
