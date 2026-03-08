const fs = require("fs");
const path = require("path");
const { normalizeFsArtifact } = require("./artifact-normalizer");
const { assert } = require("./utils");

/**
 * Prototype loader: reads *.json from filesystem under rulesDir.
 * Returns { artifacts, sources } where:
 *  - artifacts: array of normalized artifacts
 *  - sources: Map<artifactId, sourceMeta>
 */
function loadArtifactsFromDir(rulesDir) {
  assert(
    typeof rulesDir === "string" && rulesDir.length > 0,
    "loadArtifactsFromDir: rulesDir must be a non-empty string",
  );
  const root = path.resolve(rulesDir);

  const artifacts = [];
  const sources = new Map();

  walk(root, root, artifacts, sources);

  return { artifacts, sources };
}

function walk(root, dir, artifacts, sources) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const e of entries) {
    // ignore dot-files
    if (e.name.startsWith(".")) continue;

    const full = path.join(dir, e.name);

    if (e.isDirectory()) {
      walk(root, full, artifacts, sources);
      continue;
    }

    if (!e.isFile()) continue;
    if (!e.name.toLowerCase().endsWith(".json")) continue;
    if (e.name.toLowerCase() === "manifest.json") continue; // package manifest, not an artifact

    const raw = fs.readFileSync(full, "utf-8");
    const obj = JSON.parse(raw);

    // normalize based on path relative to rules dir
    const rel = path.relative(root, full).replace(/\\/g, "/"); // windows-safe
    const { artifact, sourceMeta } = normalizeFsArtifact({
      obj,
      relPath: rel,
      fullPath: full,
    });

    artifacts.push(artifact);
    if (artifact && typeof artifact.id === "string" && artifact.id.length > 0) {
      sources.set(artifact.id, sourceMeta);
    }
  }
}

module.exports = { loadArtifactsFromDir };
