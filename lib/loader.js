const fs = require("fs");
const path = require("path");
const { assert } = require("./utils");

/**
 * Loads *.json under rulesDir and assigns canonical ids according to the
 * filesystem contract:
 *
 * rules/
 *   library/                  reusable artifacts (global scope)
 *     <any>.json               id = "library." + <relativePathDots>
 *
 *   dictionaries/             dictionaries are global and available everywhere
 *     <any>.json               id = <relativePathDots>
 *
 *   pipelines/                pipelines tree (supports nesting via subfolders)
 *     <pipelineId>/
 *       pipeline.json          id = <pipelineId>
 *       <ruleId>.json          id = <pipelineId>.<ruleId>
 *       <conditionId>.json     id = <pipelineId>.<conditionId>
 *       <nestedPipelineId>/
 *         pipeline.json        id = <pipelineId>.<nestedPipelineId>
 *         <ruleId>.json        id = <pipelineId>.<nestedPipelineId>.<ruleId>
 *
 * Important:
 * - In pipelines folders we do NOT use extra subfolders like rules/ or conditions/.
 * - Rules/conditions are considered pipeline-local (scope = exact __pipelineId).
 *   Compile-time validation enforces that a pipeline can reference only its own
 *   local rules/conditions or any artifact from library.
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
    if (!e.isFile() || !e.name.toLowerCase().endsWith(".json")) continue;

    const raw = fs.readFileSync(full, "utf8");
    const obj = JSON.parse(raw);
    obj.__file = full;

    const rel = path.relative(root, full).replace(/\\/g, "/"); // windows-safe

    // library (global)
    if (rel.startsWith("library/")) {
      const relNoExt = rel.slice("library/".length).replace(/\.json$/i, "");
      obj.__scope = "library";
      obj.id = "library." + relNoExt.split("/").join(".");
      out.push(obj);
      continue;
    }

    // dictionaries (global)
    if (rel.startsWith("dictionaries/")) {
      const relNoExt = rel.slice("dictionaries/".length).replace(/\.json$/i, "");
      obj.__scope = "dictionary";
      obj.id = relNoExt.split("/").join(".");
      out.push(obj);
      continue;
    }

    // pipelines tree
    if (rel.startsWith("pipelines/")) {
      const tail = rel.slice("pipelines/".length);
      const segs = tail.split("/");

      // expect at least: <pipeline...>/<file>.json
      if (segs.length >= 2) {
        const fileName = segs[segs.length - 1];
        const fileNoExt = fileName.replace(/\.json$/i, "");
        const pipelinePathSegs = segs.slice(0, segs.length - 1);
        const pipelineId = pipelinePathSegs.join(".");

        obj.__scope = "pipeline";
        obj.__pipelineId = pipelineId;

        if (fileNoExt === "pipeline") {
          obj.id = pipelineId;
          out.push(obj);
          continue;
        }

        obj.id = pipelineId + "." + fileNoExt;
        out.push(obj);
        continue;
      }
    }

    // default (keeps id as-is)
    out.push(obj);
  }
}

module.exports = { loadArtifactsFromDir };
