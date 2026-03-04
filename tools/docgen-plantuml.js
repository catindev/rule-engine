const fs = require('fs');
const path = require('path');
const { assert, normalizeWhenExpr } = require('./utils');
const { resolveRef } = require('./resolver');

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

function escapePuml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\"/g, '\\"');
}

function labelForRule(rule) {
  const desc = rule.description ? rule.description : rule.id;
  const field = rule.field ? `field: ${rule.field}` : '';
  const op = rule.operator ? `op: ${rule.operator}` : '';
  return escapePuml([desc, field, op].filter(Boolean).join(' | '));
}

function labelForPredicate(rule) {
  const desc = rule.description ? rule.description : rule.id;
  const field = rule.field ? `field: ${rule.field}` : '';
  const op = rule.operator ? `op: ${rule.operator}` : '';
  return escapePuml(['PRED', desc, field, op].filter(Boolean).join(' | '));
}

function pipelineTitle(pipeline) {
  const id = pipeline.id;
  const desc = pipeline.description ? ` — ${pipeline.description}` : '';
  return escapePuml(`${id}${desc}`);
}

function severityStereo(level) {
  if (level === 'ERROR') return '<<ERR>>';
  if (level === 'WARNING') return '<<WARN>>';
  if (level === 'EXCEPTION') return '<<EXC>>';
  return '';
}

function renderFlow(compiled, flow, lines, indent, scopePipelineId) {
  for (const step of flow) {
    renderStep(compiled, step, lines, indent, scopePipelineId);
  }
}

function renderStep(compiled, step, lines, indent, scopePipelineId) {
  const pad = '  '.repeat(indent);

  if (step.rule) {
    const ruleId = resolveRef('rule', step.rule, scopePipelineId);
    const rule = compiled.registry.get(ruleId);
    assert(rule, `Missing rule artifact: ${ruleId}`);

    if (rule.role === 'predicate') {
      lines.push(`${pad}:${labelForPredicate(rule)} <<PRED>>;`);
      return;
    }

    const sev = severityStereo(rule.level);
    const lib = String(rule.id || '').startsWith('library.') ? '<<LIB>>' : '';
    const st = [sev, lib].filter(Boolean).join(' ');
    lines.push(`${pad}:${labelForRule(rule)} ${st};`);
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

    const w = normalizeWhenExpr(c.when);
    const whenMode = w.mode;
    const preds = w.preds;
    const predLabels = preds
      .map((ref) => {
        const predId = resolveRef('rule', ref, scopePipelineId);
        const pr = compiled.registry.get(predId);
        return pr ? (pr.description || pr.id) : predId;
      })
      .map(escapePuml);

    lines.push(
      `${pad}if ("${escapePuml(c.id)} | whenMode: ${escapePuml(whenMode)} | when: ${escapePuml(predLabels.join(', '))}") then (true)`
    );

    renderFlow(compiled, c.steps || [], lines, indent + 1, scopePipelineId);

    lines.push(pad + 'else (false)');
    if (Array.isArray(c.elseSteps) && c.elseSteps.length > 0) {
      renderFlow(compiled, c.elseSteps, lines, indent + 1, scopePipelineId);
    }

    lines.push(pad + 'endif');
    return;
  }

  lines.push(`${pad}:UNKNOWN_STEP ${escapePuml(JSON.stringify(step))};`);
}

function renderPipelinePuml(compiled, entryPipelineId) {
  const entry = compiled.registry.get(entryPipelineId);
  assert(entry && entry.type === 'pipeline', `Entry pipeline not found: ${entryPipelineId}`);

  const lines = [];
  lines.push('@startuml');
  lines.push(`title ${pipelineTitle(entry)}`);
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
  lines.push('skinparam ActivityBackgroundColor<<LIB>> #C9F0EA');
  lines.push('skinparam ActivityBorderColor<<LIB>> #0F6B62');

  lines.push('start');
  lines.push(`partition "${pipelineTitle(entry)}" {`);
  renderFlow(compiled, entry.flow || [], lines, 1, entry.id);
  lines.push('}');
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

  const stamp = nowStamp();
  const puml = renderPipelinePuml(compiled, entryPipelineId);

  const src = compiled.sources instanceof Map ? compiled.sources.get(entryPipelineId) : null;
  const outDir = src && src.file ? path.dirname(src.file) : rulesDir;
  const outPath = path.join(outDir, `${entryPipelineId}.${stamp}.puml`);
  fs.writeFileSync(outPath, puml, 'utf8');
  return { outPath };
}

module.exports = {
  generatePumlForEntryPipeline,
};
