const { assert, isLibraryRef, scopeKeyFor } = require("./utils");

function resolveRef(kind, ref, scopePipelineId) {
  assert(typeof ref === "string" && ref.length > 0, `${kind} ref must be non-empty string`);

  // absolute library ref
  if (isLibraryRef(ref)) return ref;

  // if it contains dot but isn't library.* => treat as absolute id (advanced use)
  if (ref.includes(".")) return ref;

  // scoped lookup (pipeline-local)
  assert(scopePipelineId, `Cannot resolve scoped ${kind} ref "${ref}" without pipeline scope`);
  return scopeKeyFor(scopePipelineId, ref);
}

module.exports = { resolveRef };
