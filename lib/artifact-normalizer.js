/**
 * Нормалайзер артефактов. Проверяет наличие явного id и добавляет минимальные метаданные источника.
 * Не зависит от fs, path или внутренних утилит прототипа.
 */

function normalizeFsArtifact({ obj, relPath, fullPath }) {
  if (!obj || typeof obj !== "object") {
    throw new Error("normalizeFsArtifact: obj must be an object");
  }

  if (typeof relPath !== "string" || relPath.length === 0) {
    throw new Error("normalizeFsArtifact: relPath must be a non-empty string");
  }

  if (typeof fullPath !== "string" || fullPath.length === 0) {
    throw new Error("normalizeFsArtifact: fullPath must be a non-empty string");
  }

  if (typeof obj.id !== "string" || obj.id.length === 0) {
    throw new Error(
      `Artifact in ${fullPath} is missing required string field "id"`,
    );
  }

  const rel = relPath.replace(/\\/g, "/");

  const scope = scopeFromRelPath(rel);
  const pipelineId = pipelineIdFromRelPath(rel);

  return {
    artifact: obj,
    sourceMeta: { file: fullPath, rel, scope, pipelineId },
  };
}

function scopeFromRelPath(rel) {
  if (rel.startsWith("library/")) return "library";
  if (rel.startsWith("dictionaries/")) return "dictionary";
  if (rel.startsWith("pipelines/")) return "pipeline";
  return "unknown";
}

function pipelineIdFromRelPath(rel) {
  if (!rel.startsWith("pipelines/")) return null;

  const tail = rel.slice("pipelines/".length);
  const segs = tail.split("/");

  if (segs.length < 2) return null;

  const pipelinePathSegs = segs.slice(0, segs.length - 1);
  return pipelinePathSegs.join(".");
}

module.exports = { normalizeFsArtifact };
