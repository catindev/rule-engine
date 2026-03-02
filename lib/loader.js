const fs = require("fs");
const path = require("path");
const { assert } = require("./utils");

/**
 * Loads *.json under rulesDir and assigns canonical ids:
 * - library artifacts: id = "library." + relativePathDots (no extension)
 *   example: rules/library/inn/checksum.json => library.inn.checksum
 * - pipeline-scoped rules: id = "<pipelineId>." + filenameNoExt
 *   example: rules/pipeline/p1/rules/ruleA.json => p1.ruleA
 * - pipeline artifact: id from file content or filename; recommended file: rules/pipeline/<pipelineId>/pipeline.json with id=<pipelineId>
 * - pipeline-scoped conditions: id = "<pipelineId>." + filenameNoExt
 *   example: rules/pipeline/p1/conditions/c1.json => p1.c1
 * - dictionaries: keep their id from file content (global)
 */
function loadArtifactsFromDir(rulesDir) {
  assert(typeof rulesDir === "string" && rulesDir.length > 0, "rulesDir must be a non-empty string");
  const out = [];
  walk(rulesDir, out, rulesDir);
  return out;
}

function walk(dir, out, root) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, out, root);
      continue;
    }
    if (e.isFile() && e.name.toLowerCase().endsWith(".json")) {
      const raw = fs.readFileSync(full, "utf8");
      const obj = JSON.parse(raw);
      obj.__file = full;

      const rel = path.relative(root, full).replace(/\\/g, "/"); // windows-safe
      // library
      if (rel.startsWith("library/")) {
        const relNoExt = rel.slice("library/".length).replace(/\.json$/i, "");
        obj.__scope = "library";
        obj.id = "library." + relNoExt.split("/").join(".");
        out.push(obj);
        continue;
      }

      // pipeline scoped rule/condition/pipeline
      const m = rel.match(/^pipeline\/([^\/]+)\/(.+)$/);
      if (m) {
        const pipelineId = m[1];
        const tail = m[2].replace(/\.json$/i, "");
        obj.__scope = "pipeline";
        obj.__pipelineId = pipelineId;

        if (tail === "pipeline") {
          // pipeline.json
          obj.id = pipelineId;
          out.push(obj);
          continue;
        }

        // pipeline-scoped rules or conditions
        // expect: rules/<name>.json or conditions/<name>.json
        const mm = tail.match(/^(rules|conditions)\/(.+)$/);
        if (mm) {
          const name = mm[2].split("/").join("."); // allow nested subfolders
          obj.id = pipelineId + "." + name;
          out.push(obj);
          continue;
        }

        // unknown file in pipeline folder => keep id as is
        out.push(obj);
        continue;
      }

      // default
      out.push(obj);
    }
  }
}

module.exports = { loadArtifactsFromDir };
