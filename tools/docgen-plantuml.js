const fs = require('fs');
const path = require('path');
const { assert, normalizeWhenExpr } = require('../lib/utils');
const { resolveRef } = require('../lib/resolver');

/**
 * Auto-generates a single PlantUML diagram for the ENTRY pipeline.
 *
 * Vladimir's requirements:
 * - Markdown generation is disabled for now.
 * - Only ONE diagram per run: for the entry pipeline (--pipeline).
 * - The entry pipeline diagram must include ALL nested pipelines inline.
 * - Child pipelines must NOT generate their own standalone diagrams.
 */

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/**
 * Экранирует текстовую часть для PlantUML: слэши, кавычки, переносы строк.
 * НЕ трогает разделители \n — они добавляются уже после.
 */
function escapeText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/"/g, '\\"');
}

/**
 * Собирает многострочный label из частей.
 * Каждая непустая часть экранируется отдельно и соединяется через \n.
 * Пустая строка '' — явный разделитель (пустая строка в выводе).
 * Несколько подряд идущих пустых строк схлопываются в одну.
 * Пустые строки в начале и конце обрезаются.
 */
function buildLabel(parts) {
  const escaped = parts
    .filter((p) => p !== null && p !== undefined)
    .map((p) => (p === '' ? '' : escapeText(p)));

  // схлопываем соседние пустые строки
  const collapsed = escaped.filter((p, i) => !(p === '' && escaped[i - 1] === ''));

  // обрезаем пустые с краёв
  let start = 0;
  let end = collapsed.length - 1;
  while (start <= end && collapsed[start] === '') start++;
  while (end >= start && collapsed[end] === '') end--;

  return collapsed.slice(start, end + 1).join('\\n');
}

// ---------- value rendering ----------

/**
 * Возвращает строку с информацией о сравниваемом значении/словаре/поле.
 */
function valueLabel(rule, compiled) {
  const op = rule.operator;

  if (
    op === 'field_equals_field' ||
    op === 'field_not_equals_field' ||
    op === 'field_less_than_field' ||
    op === 'field_greater_than_field'
  ) {
    return rule.value_field ? `сравнить с полем: ${rule.value_field}` : '';
  }

  if (op === 'in_dictionary') {
    const dictId = rule.dictionary && rule.dictionary.id;
    if (!dictId) return '';
    const dict = compiled.dictionaries.get(dictId);
    if (!dict) return `словарь: ${dictId}`;
    const entries = Array.isArray(dict.entries) ? dict.entries : [];
    const labels = entries.map((e) =>
      typeof e === 'string' ? e : (e.code || e.value || JSON.stringify(e))
    );
    if (labels.length === 0) return `словарь: ${dictId}`;
    if (labels.length <= 6) return `словарь: ${dictId} [${labels.join(', ')}]`;
    return `словарь: ${dictId} [${labels.slice(0, 5).join(', ')} …+${labels.length - 5}]`;
  }

  if (op === 'any_filled') {
    const paths = Array.isArray(rule.paths) ? rule.paths : [];
    return paths.length > 0 ? `любое из: [${paths.join(', ')}]` : '';
  }

  if (op === 'matches_regex') {
    return rule.value != null ? `regex: ${rule.value}` : '';
  }

  if (rule.value !== undefined) {
    return `значение: ${rule.value}`;
  }

  return '';
}

// ---------- label builders ----------

function labelForRule(rule, compiled) {
  const isLib = String(rule.id || '').startsWith('library.');
  const val   = valueLabel(rule, compiled);
  const technical = [
    rule.field    ? `поле: ${rule.field}`        : '',
    rule.operator ? `оператор: ${rule.operator}` : '',
    val,
    isLib         ? 'из библиотеки'             : '',
  ].filter(Boolean);
  return buildLabel([rule.description || rule.id, '', ...technical]);
}

function labelForPredicate(rule, compiled) {
  return buildLabel([
    'PRED',
    rule.description || rule.id,
    rule.field    ? `поле: ${rule.field}`         : '',
    rule.operator ? `оператор: ${rule.operator}`  : '',
    valueLabel(rule, compiled),
  ]);
}

/**
 * Заголовок partition: сначала описание, потом id на новой строке.
 * Кавычки для partition экранируем отдельно через escapeText.
 */
function pipelineTitle(pipeline) {
  const desc = escapeText(pipeline.description || pipeline.id);
  const id   = escapeText(pipeline.id);
  return `${desc}\\nсценарий: ${id}`;
}

function severityStereo(level) {
  if (level === 'ERROR')     return '<<ERR>>';
  if (level === 'WARNING')   return '<<WARN>>';
  if (level === 'EXCEPTION') return '<<EXC>>';
  return '';
}

// ---------- rendering ----------

function renderFlow(compiled, flow, lines, indent, scopePipelineId) {
  for (const step of flow) {
    renderStep(compiled, step, lines, indent, scopePipelineId);
  }
}

function renderStep(compiled, step, lines, indent, scopePipelineId) {
  const pad = '  '.repeat(indent);

  if (step.rule) {
    const ruleId = resolveRef('rule', step.rule, scopePipelineId);
    const rule   = compiled.registry.get(ruleId);
    assert(rule, `Missing rule artifact: ${ruleId}`);

    if (rule.role === 'predicate') {
      lines.push(`${pad}:${labelForPredicate(rule, compiled)};<<PRED>>`);
      return;
    }

    const sev = severityStereo(rule.level);
    // stereotype в PlantUML ставится после закрывающей ;
    lines.push(`${pad}:${labelForRule(rule, compiled)};${sev}`);
    return;
  }

  if (step.pipeline) {
    let pipelineId = step.pipeline;
    let p = compiled.registry.get(pipelineId);
    if (!p) {
      pipelineId = resolveRef('pipeline', step.pipeline, scopePipelineId);
      p = compiled.registry.get(pipelineId);
    }
    assert(p && p.type === 'pipeline', `Missing pipeline artifact: ${pipelineId}`);

    lines.push(`${pad}partition "${pipelineTitle(p)}" {`);
    renderFlow(compiled, p.flow || [], lines, indent + 1, p.id);
    lines.push(`${pad}}`);
    return;
  }

  if (step.condition) {
    const conditionId = resolveRef('condition', step.condition, scopePipelineId);
    const c = compiled.registry.get(conditionId);
    assert(c && c.type === 'condition', `Missing condition artifact: ${conditionId}`);

    const w          = normalizeWhenExpr(c.when);
    const whenMode   = w.mode;
    const predLabels = w.preds
      .map((ref) => {
        const predId = resolveRef('rule', ref, scopePipelineId);
        const pr = compiled.registry.get(predId);
        return escapeText(pr ? (pr.description || pr.id) : predId);
      });

    const condDesc = escapeText(c.description || c.id);
    const modeStr  = whenMode !== 'single' ? ` [${whenMode.toUpperCase()}]` : '';
    const ifLabel  = `${condDesc}${modeStr}\\n${predLabels.join(', ')}`;

    lines.push(`${pad}if ("${ifLabel}") then (да)`);

    renderFlow(compiled, c.steps || [], lines, indent + 1, scopePipelineId);

    lines.push(`${pad}else (нет)`);
    if (Array.isArray(c.elseSteps) && c.elseSteps.length > 0) {
      renderFlow(compiled, c.elseSteps, lines, indent + 1, scopePipelineId);
    }

    lines.push(`${pad}endif`);
    return;
  }

  lines.push(`${pad}:UNKNOWN_STEP ${escapeText(JSON.stringify(step))};`);
}

function renderPipelinePuml(compiled, entryPipelineId) {
  const entry = compiled.registry.get(entryPipelineId);
  assert(entry && entry.type === 'pipeline', `Entry pipeline not found: ${entryPipelineId}`);

  const lines = [];
  lines.push('@startuml');
  const titleDesc = escapeText(entry.description || entry.id);
  const titleId   = escapeText(entry.id);
  lines.push(`title ${titleDesc}\\nСценарий ${titleId}`);
  lines.push('skinparam shadowing false');
  lines.push('skinparam roundcorner 14');
  lines.push('skinparam ActivityBorderColor #444444');
  lines.push('skinparam ActivityFontColor #111111');
  lines.push('skinparam ActivityBackgroundColor #F7F7F7');
  lines.push('skinparam ActivityBackgroundColor<<ERR>> #FFB3B3');
  lines.push('skinparam ActivityBorderColor<<ERR>> #B30000');
  lines.push('skinparam ActivityBackgroundColor<<WARN>> #FFE8A3');
  lines.push('skinparam ActivityBorderColor<<WARN>> #A07A00');
  lines.push('skinparam ActivityBackgroundColor<<EXC>> #FF6B6B');
  lines.push('skinparam ActivityBorderColor<<EXC>> #7A0000');
  lines.push('skinparam ActivityFontColor<<EXC>> #111111');
  lines.push('skinparam ActivityFontStyle<<EXC>> bold');
  lines.push('skinparam ActivityBackgroundColor<<PRED>> #DDDDDD');
  lines.push('skinparam ActivityBorderColor<<PRED>> #777777');

  lines.push('start');
  renderFlow(compiled, entry.flow || [], lines, 0, entry.id);
  lines.push('stop');
  lines.push('@enduml');
  return lines.join('\n');
}

function generatePumlForEntryPipeline(compiled, rulesDir, entryPipelineId) {
  assert(compiled && compiled.registry, 'compiled must contain registry');
  assert(typeof rulesDir === 'string' && rulesDir.length > 0, 'rulesDir must be a string');
  assert(typeof entryPipelineId === 'string' && entryPipelineId.length > 0, 'entryPipelineId must be a string');

  const entry = compiled.registry.get(entryPipelineId);
  assert(entry && entry.type === 'pipeline', `Entry pipeline not found: ${entryPipelineId}`);

  const stamp   = nowStamp();
  const puml    = renderPipelinePuml(compiled, entryPipelineId);
  const src     = compiled.sources instanceof Map ? compiled.sources.get(entryPipelineId) : null;
  const outDir  = src && src.file ? path.dirname(src.file) : rulesDir;
  const outPath = path.join(outDir, `${entryPipelineId}.${stamp}.puml`);
  fs.writeFileSync(outPath, puml, 'utf8');
  return { outPath };
}

module.exports = {
  generatePumlForEntryPipeline,
  renderPipelinePuml,
};
