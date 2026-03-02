const fs = require("fs");
const path = require("path");
const { loadArtifactsFromDir } = require("./lib/loader");
const { compile } = require("./lib/compiler");
const { runPipeline } = require("./lib/runner");

function loadAndCompile(rulesDir) {
  const dir = rulesDir || path.join(__dirname, "rules");
  const artifacts = loadArtifactsFromDir(dir);
  const compiled = compile(artifacts);
  return { artifacts, compiled };
}

function printUsageAndExit(code) {
  const msg = `
Usage:
  node index.js --payload <file.json> [--pipeline <pipelineId>] [--rules <rulesDir>] [--pretty]
  node index.js <payload.json> [--pipeline <pipelineId>] [--rules <rulesDir>] [--pretty]

Defaults:
  --pipeline pipeline_main
  --rules    ./rules

Output:
  JSON to stdout (result of runPipeline).
`;
  console.error(msg.trim());
  process.exit(code);
}

function parseArgs(argv) {
  const out = {
    payloadPath: null,
    pipelineId: "pipeline_main",
    rulesDir: path.join(__dirname, "rules"),
    pretty: false
  };
  const args = argv.slice(2);
  if (args.length > 0 && !args[0].startsWith("--")) out.payloadPath = args[0];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--payload") { out.payloadPath = args[i + 1]; i++; continue; }
    if (a === "--pipeline") { out.pipelineId = args[i + 1]; i++; continue; }
    if (a === "--rules") { out.rulesDir = args[i + 1]; i++; continue; }
    if (a === "--pretty") { out.pretty = true; continue; }
    if (a === "--help" || a === "-h") printUsageAndExit(0);
  }
  return out;
}

function cliMain() {
  const { payloadPath, pipelineId, rulesDir, pretty } = parseArgs(process.argv);
  if (!payloadPath) printUsageAndExit(2);

  const absPayload = path.isAbsolute(payloadPath) ? payloadPath : path.join(process.cwd(), payloadPath);
  const absRules = path.isAbsolute(rulesDir) ? rulesDir : path.join(process.cwd(), rulesDir);

  const raw = fs.readFileSync(absPayload, "utf8");
  const payload = JSON.parse(raw);

  const { compiled } = loadAndCompile(absRules);
  const result = runPipeline(compiled, pipelineId, payload);

  const jsonOut = JSON.stringify(result, null, pretty ? 2 : 0);
  process.stdout.write(jsonOut + "\n");
}

if (require.main === module) {
  cliMain();
}

module.exports = { loadAndCompile, compile, runPipeline };
