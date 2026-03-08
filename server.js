const express = require("express");
const fs      = require("fs");
const path    = require("path");

const { createEngine }         = require("./lib");
const { loadArtifactsFromDir } = require("./lib/loader-fs");
const { Operators }            = require("./lib/operators");
const { CompilationError }     = require("./lib/compiler/compilation-error");
const mountDocs                = require("./docs-routes");

// ---- config
const PORT  = Number(process.env.PORT || 3000);
const TRACE = (process.env.TRACE || "0") === "1";

// Режим определяется по NODE_ENV:
//   development (default) — fs-режим: сканирует ./rules при старте.
//                           Используется локально разработчиком и аналитиком.
//   production / test     — snapshot-режим: грузит SNAPSHOT_PATH.
//                           Используется в любом деплое (прод, тест, канарейка).
//                           Если SNAPSHOT_PATH не задан или файл не найден — падает.
const NODE_ENV     = process.env.NODE_ENV || "development";
const IS_DEV       = NODE_ENV === "development";
const SNAPSHOT_PATH = process.env.SNAPSHOT_PATH || null;
const RULES_DIR     = process.env.RULES_DIR      || path.join(__dirname, "rules");

// ---- hot-reload (dev-mode only) ────────────────────────────────────────────
//
// Следит за изменениями *.json файлов в RULES_DIR.
// При изменении — пересобирает правила и заменяет ctx.compiled.
// Если компиляция упала — логирует все ошибки и оставляет старую версию.
//
// Debounce 150ms: fs.watch на macOS стреляет дважды на одно сохранение.

function startHotReload(engine, rulesDir, ctx) {
  let debounceTimer = null;
  let lastFile = null;

  function reload(changedFile) {
    const rel = path.relative(rulesDir, changedFile);
    console.log(`\n[hot-reload] changed: ${rel}`);
    console.log(`[hot-reload] recompiling...`);

    try {
      const { artifacts, sources } = loadArtifactsFromDir(rulesDir);
      const compiled = engine.compile(artifacts, { sources });
      ctx.compiled = compiled;
      console.log(`[hot-reload] OK — ${artifacts.length} artifacts loaded`);
    } catch (err) {
      console.error(`[hot-reload] COMPILATION ERROR — keeping previous version`);
      if (err.name === "CompilationError" && Array.isArray(err.errors)) {
        err.errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}`));
      } else {
        console.error(`  ${err.message}`);
      }
    }
  }

  fs.watch(rulesDir, { recursive: true }, (event, filename) => {
    if (!filename || !filename.toLowerCase().endsWith(".json")) return;

    const fullPath = path.join(rulesDir, filename);
    lastFile = fullPath;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => reload(lastFile), 150);
  });

  console.log(`[hot-reload] watching ${rulesDir}`);
}

// ---- bootstrap engine
function bootstrap() {
  const engine = createEngine({ operators: Operators });

  if (IS_DEV) {
    // ── development: fs-режим ────────────────────────────────────────────────
    if (!fs.existsSync(RULES_DIR)) {
      throw new Error(`[dev] RULES_DIR not found: ${RULES_DIR}`);
    }
    const { artifacts, sources } = loadArtifactsFromDir(RULES_DIR);
    const compiled = engine.compile(artifacts, { sources });
    console.log(`[engine] mode     : development (fs)`);
    console.log(`[engine] rules dir: ${RULES_DIR}`);
    console.log(`[engine] artifacts: ${artifacts.length}`);

    // Контейнер — мутабельная обёртка над compiled.
    // Все обработчики запросов читают из ctx.compiled.
    // Hot-reload меняет ctx.compiled не трогая обработчики.
    const ctx = { compiled, rulesDir: RULES_DIR };
    startHotReload(engine, RULES_DIR, ctx);
    return { engine, ctx, meta: { mode: "development", rulesDir: RULES_DIR } };

  } else {
    // ── production / test: snapshot-режим ───────────────────────────────────
    if (!SNAPSHOT_PATH) {
      throw new Error(
        `[${NODE_ENV}] SNAPSHOT_PATH is required when NODE_ENV=${NODE_ENV}. ` +
        `Set SNAPSHOT_PATH=./snapshot.json`
      );
    }
    if (!fs.existsSync(SNAPSHOT_PATH)) {
      throw new Error(
        `[${NODE_ENV}] Snapshot file not found: ${SNAPSHOT_PATH}`
      );
    }

    let snapshot;
    try {
      snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
    } catch (e) {
      throw new Error(`[${NODE_ENV}] Failed to parse snapshot: ${e.message}`);
    }

    const { artifacts, version, createdAt, createdBy, description } = snapshot;

    if (!Array.isArray(artifacts) || artifacts.length === 0) {
      throw new Error(`[${NODE_ENV}] Snapshot contains no artifacts: ${SNAPSHOT_PATH}`);
    }

    const compiled = engine.compile(artifacts);
    console.log(`[engine] mode     : ${NODE_ENV} (snapshot)`);
    console.log(`[engine] file     : ${SNAPSHOT_PATH}`);
    console.log(`[engine] version  : ${version  || "n/a"}`);
    console.log(`[engine] created  : ${createdAt || "n/a"} by ${createdBy || "n/a"}`);
    if (description) console.log(`[engine] desc     : ${description}`);
    console.log(`[engine] artifacts: ${artifacts.length}`);
    const ctx = { compiled };
    return { engine, ctx, meta: { mode: NODE_ENV, version, createdAt, createdBy, description } };
  }
}

const { engine, ctx, meta } = bootstrap();

// ---- http app
const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, ...meta });
});

/**
 * POST /v1/validate
 *
 * Body:
 * {
 *   "context": {
 *     "pipelineId": "checkout_main",   // required
 *     "merchantId": "demo-merchant",   // доступно в правилах как $context.merchantId
 *     ...
 *   },
 *   "payload": { ... }                 // вложенный JSON или flat-map — оба принимаются
 * }
 */
app.post("/v1/validate", (req, res) => {
  const body = req.body ?? {};

  if (!body.context || typeof body.context !== "object") {
    return res.status(400).json({ error: true, message: 'Request body must contain "context" object' });
  }

  const context    = body.context;
  const pipelineId = context.pipelineId;

  if (!pipelineId || typeof pipelineId !== "string") {
    return res.status(400).json({ error: true, message: "context.pipelineId is required (string)" });
  }

  if (body.payload !== undefined && typeof body.payload !== "object") {
    return res.status(400).json({ error: true, message: '"payload" must be an object if provided' });
  }

  const payload         = body.payload ?? {};
  const enrichedPayload = Object.assign({}, payload, { __context: context });

  try {
    const result   = engine.runPipeline(ctx.compiled, pipelineId, enrichedPayload);
    const response = Object.assign({ context }, result);

    if (!TRACE && response.trace) {
      const { trace, ...rest } = response;
      return res.json(rest);
    }
    return res.json(response);
  } catch (err) {
    return res.status(500).json({ error: true, message: err?.message || String(err), pipelineId });
  }
});


// ── Documentation UI (dev-mode only) ─────────────────────────────────────
if (IS_DEV) mountDocs(app, ctx);

app.listen(PORT, () => {
  console.log(`[rules-engine] listening on http://localhost:${PORT}`);
  console.log(`[rules-engine] endpoint: POST /v1/validate`);
  console.log(`[rules-engine] trace: ${TRACE ? "on" : "off"} (set TRACE=1 to include trace)`);
});
