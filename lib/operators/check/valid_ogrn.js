const { deepGet } = require("../../utils");
// OGRN (13): control digit = (number % 11) % 10
// OGRNIP (15): control digit = (number % 13) % 10
module.exports = function(rule, ctx) {
  try {
    const got = deepGet(ctx.payload, rule.field);
    if (!got.ok) return { status: "FAIL" };
    const s = String(got.value ?? "");
    if (!/^\d+$/.test(s)) return { status: "FAIL" };
    if (s.length === 13) {
      const n = BigInt(s.slice(0, 12));
      const cd = Number((n % 11n) % 10n);
      return { status: cd === Number(s[12]) ? "OK" : "FAIL" };
    }
    if (s.length === 15) {
      const n = BigInt(s.slice(0, 14));
      const cd = Number((n % 13n) % 10n);
      return { status: cd === Number(s[14]) ? "OK" : "FAIL" };
    }
    return { status: "FAIL" };
  } catch (e) { return { status: "EXCEPTION", error: e }; }
};
