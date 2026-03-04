#!/usr/bin/env node
/*
 * Small demo runner for the prototype.
 * Uses the public CLI entry (index.js) composition via loadAndCompile().
 */

const path = require("path");
const fs = require("fs");
const { loadAndCompile } = require("../index");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function main() {
  const rulesDir = path.join(__dirname, "..", "rules");
  const pipelineId = "pipeline_main";
  const payloadPath = path.join(
    __dirname,
    "..",
    "payloads",
    "checkout.fail.strict.json",
  );

  const { compiled, engine } = loadAndCompile(rulesDir, pipelineId);
  const payload = readJson(payloadPath);
  const res = engine.runPipeline(compiled, pipelineId, payload);
  console.log(JSON.stringify(res, null, 2));
}

if (require.main === module) {
  main();
}
