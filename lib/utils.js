function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function isObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function deepGet(obj, path) {
  // Flat-only payload mode: keys are stored as exact strings (may contain dots).
  // Example: payload['beneficiary.inn'] => '4823...'
  if (!path) return { ok: false, value: undefined };
  if (obj === null || typeof obj !== "object") return { ok: false, value: undefined };
  const key = String(path);
  if (!(key in obj)) return { ok: false, value: undefined };
  return { ok: true, value: obj[key] };
}

function isEmptyValue(v) {
  return v === null || v === undefined || v === "";
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

function parseStrictYMD(s) {
  if (typeof s !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toComparable(value) {
  const n = toNumber(value);
  if (n !== null) return { kind: "number", value: n };
  const d = parseStrictYMD(value);
  if (d) return { kind: "date", value: d.getTime() };
  return null;
}

function normalizeWhenExpr(when) {
  if (typeof when === "string") return { mode: "single", preds: [when] };
  if (isObject(when) && Array.isArray(when.all)) return { mode: "all", preds: when.all };
  if (isObject(when) && Array.isArray(when.any)) return { mode: "any", preds: when.any };
  throw new Error(`Invalid condition.when: expected string or {all:[..]} or {any:[..]}`);
}

function stepKind(step) {
  const keys = Object.keys(step);
  const allowed = ["rule", "pipeline", "condition"];
  const present = keys.filter((k) => allowed.includes(k));
  assert(present.length === 1, `Step must contain exactly one of rule|pipeline|condition. Got keys: ${keys.join(",")}`);
  return present[0];
}

function makeTrace(traceArr, scope) {
  return function trace(message, data) {
    traceArr.push({
      kind: "TRACE",
      message,
      data: Object.assign({ scope }, data || {}),
      ts: new Date().toISOString()
    });
  };
}

function isLibraryRef(ref) {
  return typeof ref === "string" && ref.startsWith("library.");
}

function scopeKeyFor(pipelineId, localName) {
  return `${pipelineId}.${localName}`;
}

module.exports = {
  assert,
  isObject,
  deepGet,
  isEmptyValue,
  toComparable,
  normalizeWhenExpr,
  stepKind,
  makeTrace,
  isLibraryRef,
  scopeKeyFor
};
