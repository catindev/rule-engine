/**
 * docs-routes.js
 *
 * Браузерная документация движка — только для dev-режима.
 * Шаблоны: views/*.ejs   Статика: static/
 *
 * Монтируется в server.js:
 *   if (IS_DEV) require('./docs-routes')(app, ctx);
 *
 * Маршруты:
 *   GET /                     — список корневых пайплайнов
 *   GET /pipelines/:id(*)     — страница пайплайна
 *   GET /rules/:id(*)         — страница правила
 *   GET /conditions/:id(*)    — страница условия
 *   GET /dictionaries/:id(*)  — страница справочника
 *   GET /static/*             — CSS, JS, иконки
 */

'use strict';

const path    = require('path');
const fs      = require('fs');
const ejs     = require('ejs');
const express = require('express');

const VIEWS_DIR  = path.join(__dirname, 'views');
const STATIC_DIR = path.join(__dirname, 'static');

// Иконки — загружаем один раз при старте
const ICON_NAMES = [
  'big-logotype',
  'big-pipline', 'big-pipline-library',
  'big-rule',    'big-rule-library',
  'big-condition', 'big-condition-library',
  'big-dictionary',
  'pipeline-list-icon', 'rule-list-icon', 'condition-list-icon',
  'pipeline-list-icon-library', 'rule-list-icon-library', 'condition-list-icon-library',
  'check-icon', 'check-icon-library',
  'predicate-icon', 'predicate-icon-library',
  'level-icon', 'level-icon-library',
  'field-icon', 'field-icon-library',
  'operator-icon', 'operator-icon-library',
  'value-icon', 'value-icon-library',
  'dictionary-icon', 'dictionary-icon-library',
];
const icons = {};
for (const name of ICON_NAMES) {
  const file = path.join(STATIC_DIR, 'icons', name + '.svg');
  icons[name] = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

// Манифест пакета правил — загружается при старте, перечитывается при hot-reload
function loadManifest(rulesDir) {
  const file = path.join(rulesDir || path.join(__dirname, 'rules'), 'manifest.json');
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch(e) { console.warn('[docs] manifest parse error:', e.message); return {}; }
}

function render(res, view, locals, manifest) {
  const file = path.join(VIEWS_DIR, view + '.ejs');
  ejs.renderFile(file, { ...locals, icons, manifest: manifest || {} }, { views: VIEWS_DIR }, (err, html) => {
    if (err) {
      console.error('[docs] render error:', err.message);
      return res.status(500).send('<pre>' + err.message + '</pre>');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });
}

module.exports = function mountDocs(app, ctx) {
  // Путь к rules/ — берём из ctx если есть, иначе рядом с docs-routes.js
  const rulesDir = ctx.rulesDir || path.join(__dirname, 'rules');
  // dev: читаем с диска + hot-reload; prod: берём из ctx.manifest (встроен в снэпшот)
  let manifest = ctx.manifest || loadManifest(rulesDir);
  console.log('[docs] manifest:', manifest.name ? `loaded "${manifest.name}"` : 'not found (using empty)');

  if (ctx.on) {
    ctx.on('reload', () => { manifest = loadManifest(rulesDir); });
  }

  app.use('/static', express.static(STATIC_DIR));

  // Главная — только корневые пайплайны (id без точки)
  app.get('/', (req, res) => {
    const pipelines = [];
    for (const [id, a] of ctx.compiled.registry) {
      if (a.type === 'pipeline' && !id.includes('.')) pipelines.push(a);
    }
    pipelines.sort((a, b) => a.id.localeCompare(b.id));
    render(res, 'home', { pipelines }, manifest);
  });

  // Пайплайн
  app.get('/pipelines/:id', (req, res) => {
    const a = ctx.compiled.registry.get(req.params.id);
    if (!a || a.type !== 'pipeline')
      return res.status(404).send('Pipeline not found: ' + req.params.id);
    const cmp   = ctx.compiled.pipelines && ctx.compiled.pipelines.get(a.id);
    const steps = cmp ? cmp.steps : [];
    render(res, 'pipeline', { pipeline: a, steps, compiled: ctx.compiled }, manifest);
  });

  // Правило
  app.get('/rules/:id', (req, res) => {
    const a = ctx.compiled.registry.get(req.params.id);
    if (!a || a.type !== 'rule')
      return res.status(404).send('Rule not found: ' + req.params.id);
    render(res, 'rule', { rule: a }, manifest);
  });

  // Условие
  app.get('/conditions/:id', (req, res) => {
    const a = ctx.compiled.registry.get(req.params.id);
    if (!a || a.type !== 'condition')
      return res.status(404).send('Condition not found: ' + req.params.id);
    render(res, 'condition', { condition: a, compiled: ctx.compiled }, manifest);
  });

  // Справочник
  app.get('/dictionaries/:id', (req, res) => {
    const a = ctx.compiled.registry.get(req.params.id);
    if (!a || a.type !== 'dictionary')
      return res.status(404).send('Dictionary not found: ' + req.params.id);
    render(res, 'dictionary', { dictionary: a }, manifest);
  });

  console.log('[docs] UI available at http://localhost:' + (process.env.PORT || 3000) + '/');
};
