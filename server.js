const express = require("express");
const fs = require("fs");
const path = require("path");

const { createEngine } = require("./lib");
const { loadArtifactsFromDir } = require("./lib/loader-fs");
const { Operators } = require("./lib/operators");

// ---- config
const PORT = Number(process.env.PORT || 3000);
const RULES_DIR = process.env.RULES_DIR || path.join(__dirname, "rules");
const TRACE = (process.env.TRACE || "0") === "1";

// ---- bootstrap engine
function bootstrap() {
  if (!fs.existsSync(RULES_DIR)) {
    throw new Error(`RULES_DIR not found: ${RULES_DIR}`);
  }
  const { artifacts, sources } = loadArtifactsFromDir(RULES_DIR);
  const engine = createEngine({ operators: Operators });
  const compiled = engine.compile(artifacts, { sources });
  return { engine, compiled };
}

const { engine, compiled } = bootstrap();

// ---- http app
const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, rulesDir: RULES_DIR, compiled: true });
});

/**
 * POST /v1/validate
 *
 * Body:
 * {
 *   "context": {
 *     "pipelineId": "checkout_main",   // required — определяет пайплайн
 *     "merchantId": "demo-merchant",   // любые поля доступны в правилах как $context.*
 *     "currentDate": "2026-03-06",
 *     "rulesetVersion": "draft-1"
 *   },
 *   "payload": {
 *     "beneficiary.type": "UL_RESIDENT",
 *     "...": "..."
 *   }
 * }
 *
 * Все поля context доступны в правилах/предикатах через field: "$context.<key>".
 * payload — flat-map данных заявки (как раньше).
 */
app.post("/v1/validate", (req, res) => {
  const body = req.body ?? {};

  // --- validate request shape
  if (!body.context || typeof body.context !== "object") {
    return res.status(400).json({
      error: true,
      message: 'Request body must contain "context" object',
    });
  }

  const context = body.context;
  const pipelineId = context.pipelineId;

  if (!pipelineId || typeof pipelineId !== "string") {
    return res.status(400).json({
      error: true,
      message: "context.pipelineId is required (string)",
    });
  }

  if (body.payload !== undefined && typeof body.payload !== "object") {
    return res.status(400).json({
      error: true,
      message: '"payload" must be an object if provided',
    });
  }

  const payload = body.payload ?? {};

  // Inject context under reserved __context key so deepGet can resolve
  // "$context.*" references inside rules and predicates.
  const enrichedPayload = Object.assign({}, payload, { __context: context });

  try {
    const result = engine.runPipeline(compiled, pipelineId, enrichedPayload);

    // Echo context back for traceability
    const response = Object.assign({ context }, result);

    if (!TRACE && response.trace) {
      const { trace, ...rest } = response;
      return res.json(rest);
    }

    return res.json(response);
  } catch (err) {
    return res.status(500).json({
      error: true,
      message: err?.message || String(err),
      pipelineId,
    });
  }
});

app.listen(PORT, () => {
  console.log(`[rules-engine] listening on http://localhost:${PORT}`);
  console.log(`[rules-engine] endpoint: POST /v1/validate`);
  console.log(`[rules-engine] rules dir: ${RULES_DIR}`);
  console.log(
    `[rules-engine] trace: ${TRACE ? "on" : "off"} (set TRACE=1 to include trace)`,
  );
});
