#!/usr/bin/env node
/**
 * tools/build-snapshot.js
 *
 * Собирает снэпшот пакета правил из файловой системы.
 *
 * Снэпшот — единственный файл JSON содержащий все артефакты (правила,
 * пайплайны, условия, словари). Сервер при старте грузит снэпшот и
 * компилирует его в память — без обхода каталогов, без зависимости от fs.
 *
 * Использование:
 *   node tools/build-snapshot.js [options]
 *
 * Опции (env или флаги):
 *   --rules-dir  <path>   каталог с правилами (default: ./rules)
 *   --out        <path>   куда писать снэпшот  (default: ./snapshot.json)
 *   --version    <str>    версия снэпшота       (default: из package.json)
 *   --author     <str>    кто собрал            (default: $USER или 'unknown')
 *   --description <str>   описание изменений    (default: '')
 *   --pretty              красивый JSON с отступами (default: minified)
 *
 * Примеры:
 *   node tools/build-snapshot.js
 *   node tools/build-snapshot.js --rules-dir ./rules_nested --out ./snap-nested.json
 *   node tools/build-snapshot.js --version 2.4.1 --author analyst@bank.ru --pretty
 *   node tools/build-snapshot.js --description "Добавлена проверка мерчантов"
 *
 * Exit codes:
 *   0 — успех
 *   1 — ошибка компиляции или I/O
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { loadArtifactsFromDir } = require('../lib/loader-fs');
const { createEngine }         = require('../lib');
const { Operators }            = require('../lib/operators');

// ─── parse args ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--pretty') { result.pretty = true; continue; }
    if (a.startsWith('--') && i + 1 < args.length) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      result[key] = args[++i];
    }
  }
  return result;
}

const args = parseArgs(process.argv);

const RULES_DIR   = args.rulesDir   || process.env.RULES_DIR   || path.join(__dirname, '..', 'rules');
const OUT_PATH    = args.out        || process.env.SNAPSHOT_OUT || path.join(__dirname, '..', 'snapshot.json');
const PRETTY      = args.pretty     || process.env.PRETTY === '1';
const AUTHOR      = args.author     || process.env.AUTHOR       || process.env.USER || 'unknown';
const DESCRIPTION = args.description|| process.env.DESCRIPTION  || '';

// version: arg → env → package.json
let VERSION = args.version || process.env.VERSION;
if (!VERSION) {
  try {
    VERSION = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
    ).version || '0.0.0';
  } catch (_) {
    VERSION = '0.0.0';
  }
}

// ─── main ───────────────────────────────────────────────────────────────────

console.log(`[build-snapshot] rules dir : ${RULES_DIR}`);
console.log(`[build-snapshot] output    : ${OUT_PATH}`);
console.log(`[build-snapshot] version   : ${VERSION}`);
console.log(`[build-snapshot] author    : ${AUTHOR}`);
if (DESCRIPTION) console.log(`[build-snapshot] description: ${DESCRIPTION}`);
console.log('');

// 1. Загрузка артефактов из файлов
let artifacts;
try {
  ({ artifacts } = loadArtifactsFromDir(RULES_DIR));
  console.log(`[build-snapshot] loaded ${artifacts.length} artifacts`);
} catch (err) {
  console.error(`[build-snapshot] ERROR loading artifacts: ${err.message}`);
  process.exit(1);
}

// 2. Компиляция — ловим ошибки ДО сохранения снэпшота
//    Если правила не компилируются — снэпшот не создаётся
try {
  const engine = createEngine({ operators: Operators });
  engine.compile(artifacts);
  console.log(`[build-snapshot] compilation OK`);
} catch (err) {
  console.error(`[build-snapshot] COMPILATION ERROR — snapshot NOT saved`);
  if (err.name === 'CompilationError' && Array.isArray(err.errors)) {
    console.error(`[build-snapshot] ${err.errors.length} error(s) found:\n`);
    err.errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}`));
  } else {
    console.error(`[build-snapshot] ${err.message}`);
  }
  process.exit(1);
}

// 3. Сборка снэпшота
const snapshot = {
  version:     VERSION,
  createdAt:   new Date().toISOString(),
  createdBy:   AUTHOR,
  description: DESCRIPTION,
  rulesDir:    path.resolve(RULES_DIR),
  artifactCount: artifacts.length,
  artifacts,
};

// 4. Запись файла
const json = PRETTY
  ? JSON.stringify(snapshot, null, 2)
  : JSON.stringify(snapshot);

try {
  fs.mkdirSync(path.dirname(path.resolve(OUT_PATH)), { recursive: true });
  fs.writeFileSync(OUT_PATH, json, 'utf8');
} catch (err) {
  console.error(`[build-snapshot] ERROR writing file: ${err.message}`);
  process.exit(1);
}

const sizeKb = (Buffer.byteLength(json, 'utf8') / 1024).toFixed(1);
console.log(`[build-snapshot] saved → ${OUT_PATH} (${sizeKb} KB)`);
console.log(`[build-snapshot] done`);
