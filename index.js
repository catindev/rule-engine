#!/usr/bin/env node

const path = require("path");
const fs = require("fs");

const { loadArtifactsFromDir } = require("./lib/loader");
const { createEngine } = require("./lib/engine");
const { generatePumlForEntryPipeline } = require("./lib/docgen");
const { Operators } = require("./lib/operators");

function parseArgs(argv) {
  const out = { pretty: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pipeline") out.pipeline = argv[++i];
    else if (a === "--payload") out.payload = argv[++i];
    else if (a === "--rules") out.rules = argv[++i];
    else if (a === "--pretty") out.pretty = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`Unknown аргумент: ${a}`);
  }
  return out;
}

function readJsonFile(p) {
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

function loadAndCompile(rulesDir, entryPipelineId) {
  const dir = rulesDir || path.join(__dirname, "rules");
  const artifacts = loadArtifactsFromDir(dir);
  const engine = createEngine({ operators: Operators });
  const compiled = engine.compile(artifacts);

  // Auto-generate ONE PlantUML diagram for the entry pipeline.
  // Child pipelines DO NOT generate standalone diagrams.
  if (entryPipelineId) {
    generatePumlForEntryPipeline(compiled, dir, entryPipelineId);
  }

  return { artifacts, compiled, engine };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.pipeline) {
    console.log(
      "Usage: node index.js --pipeline <id> [--payload <file.json>] [--rules <rulesDir>] [--pretty]",
    );
    process.exit(args.pipeline ? 0 : 1);
  }

  const rulesDir = args.rules
    ? path.resolve(args.rules)
    : path.join(__dirname, "rules");
  const { compiled, engine } = loadAndCompile(rulesDir, args.pipeline);

  const payload = args.payload ? readJsonFile(path.resolve(args.payload)) : {};
  const res = engine.runPipeline(compiled, args.pipeline, payload);

  if (args.pretty) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(JSON.stringify(res));
  }
}

if (require.main === module) {
  main();
}

module.exports = { loadAndCompile };
