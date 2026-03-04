const express = require("express");
const fs = require("fs");
const path = require("path");

const { createEngine } = require("./lib"); // публичный API (lib/index.js)
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

  // ВАЖНО: compile принимает options (sources) — как после шага 3
  const compiled = engine.compile(artifacts, { sources });

  return { engine, compiled };
}

const { engine, compiled } = bootstrap();

// ---- http app
const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    rulesDir: RULES_DIR,
    compiled: true,
  });
});

app.post("/:pipelineId", (req, res) => {
  const pipelineId = req.params.pipelineId;

  try {
    const payload = req.body ?? {};
    const result = engine.runPipeline(compiled, pipelineId, payload);

    // Можно опционально выкинуть trace, чтобы ответы были легче
    if (!TRACE && result && typeof result === "object") {
      const { trace, ...rest } = result;
      return res.json(rest);
    }

    return res.json(result);
  } catch (err) {
    // Ошибки компиляции/валидации/исполнения
    return res.status(500).json({
      error: true,
      message: err?.message || String(err),
      pipelineId,
    });
  }
});

app.listen(PORT, () => {
  console.log(`[rules-engine] listening on http://localhost:${PORT}`);
  console.log(`[rules-engine] rules dir: ${RULES_DIR}`);
  console.log(
    `[rules-engine] trace: ${TRACE ? "on" : "off"} (set TRACE=1 to include trace)`,
  );
});
