#!/usr/bin/env node
const path = require("path");
const fs = require("fs");

const { loadArtifactsFromDir } = require("../lib/loader-fs");
const { createEngine } = require("../lib/engine");
const { generatePumlForEntryPipeline } = require("../tools/docgen-plantuml");
const { Operators } = require("../lib/operators");

function parseArgs(argv) {
  const out = { pretty: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--rules") out.rulesDir = argv[++i];
    else if (a === "--pipeline") out.pipeline = argv[++i];
    else if (a === "--payload") out.payload = argv[++i];
    else if (a === "--pretty") out.pretty = true;
    else if (a === "--puml") out.puml = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadAndCompile(rulesDir) {
  const { artifacts, sources } = loadArtifactsFromDir(rulesDir);
  const engine = createEngine({ operators: Operators });
  const compiled = engine.compile(artifacts, { sources });
  return { engine, compiled };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.pipeline || !args.payload) {
    console.log(`Usage:
  checker --pipeline <pipelineId> --payload <payload.json> [--rules <rulesDir>] [--pretty] [--puml]

Examples:
  checker --pipeline pipeline_main --payload ./payloads/checkout.ok.json --pretty
  checker --pipeline pipeline_main --payload ./payloads/checkout.fail.strict.json --puml
`);
    process.exit(args.help ? 0 : 1);
  }

  const rulesDir = args.rulesDir
    ? path.resolve(args.rulesDir)
    : path.join(__dirname, "..", "rules");

  const payloadPath = path.resolve(args.payload);
  const payload = readJson(payloadPath);

  const { engine, compiled } = loadAndCompile(rulesDir);

  if (args.puml) {
    const puml = generatePumlForEntryPipeline(compiled, args.pipeline);
    const outDir = path.join(process.cwd(), "out");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${args.pipeline}.puml`);
    fs.writeFileSync(outFile, puml, "utf8");
    console.log(`Wrote: ${outFile}`);
  }

  const res = engine.runPipeline(compiled, args.pipeline, payload);

  if (args.pretty) console.log(JSON.stringify(res, null, 2));
  else console.log(JSON.stringify(res));
}

if (require.main === module) {
  main();
}

module.exports = { loadAndCompile };
