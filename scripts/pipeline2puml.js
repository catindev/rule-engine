#!/usr/bin/env node
/**
 * pipeline2puml.js
 *
 * Generate a readable PlantUML Activity Diagram from a DSL pipeline definition.
 *
 * Usage:
 *   node scripts/pipeline2puml.js --pipeline ul_resident_pre_abs
 *   node scripts/pipeline2puml.js --pipeline ul_resident_pre_abs --rules ./rules --out ./ul_resident_pre_abs.puml
 *
 * Conventions supported:
 * - Pipeline file:
 *     rules/pipeline/<pipelineId>/pipeline.json
 * - Local rules referenced in pipeline/conditions:
 *     rules/pipeline/<pipelineId>/rules/<ruleRef>.json
 *     rules/pipeline/<pipelineId>/conditions/<conditionRef>.json
 * - Library artifacts referenced as "library.xxx.yyy":
 *     rules/library/xxx/yyy.json
 *   (supports deeper nesting: library.inn.checksum -> rules/library/inn/checksum.json)
 *
 * Styling:
 * - ERROR      -> red activity block
 * - WARNING    -> yellow activity block
 * - EXCEPTION  -> bold red activity block
 * - predicate  -> gray activity block
 * - library.*  -> different background (teal-ish), combined with severity when possible
 * - Logical grouping via PlantUML partitions (FATCA, Address, Status, etc.)
 */

const fs = require("fs");
const path = require("path");

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse JSON: ${filePath}\n${e.message}`);
  }
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function escapePumlText(s) {
  // avoid breaking PlantUML with quotes/newlines
  return String(s)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/"/g, '\\"');
}

function isLibraryRef(ref) {
  return typeof ref === "string" && ref.startsWith("library.");
}

function libraryRefToPath(rulesRoot, ref, kind /* "rule" | "condition" */) {
  // For conditions we still use the same mapping: rules/library/<segments>.json
  // e.g. library.conditions.cond_x -> rules/library/conditions/cond_x.json
  const rel = ref.replace(/^library\./, "").split(".").join(path.sep) + ".json";
  return path.join(rulesRoot, "library", rel);
}

function localRefToPath(rulesRoot, pipelineId, ref, kind /* "rule" | "condition" */) {
  const folder = kind === "condition" ? "conditions" : "rules";
  return path.join(rulesRoot, "pipeline", pipelineId, folder, `${ref}.json`);
}

function loadPipeline(rulesRoot, pipelineId) {
  const p = path.join(rulesRoot, "pipeline", pipelineId, "pipeline.json");
  if (!exists(p)) die(`Pipeline not found: ${p}`);
  const pipeline = readJson(p);
  pipeline.id = pipeline.id || pipelineId;
  pipeline.__file = p;
  return pipeline;
}

function resolveRule(rulesRoot, pipelineId, ruleRef) {
  const file = isLibraryRef(ruleRef)
    ? libraryRefToPath(rulesRoot, ruleRef, "rule")
    : localRefToPath(rulesRoot, pipelineId, ruleRef, "rule");

  if (!exists(file)) {
    throw new Error(`Missing rule file for ref "${ruleRef}" (expected ${file})`);
  }
  const r = readJson(file);
  r.id = r.id || (isLibraryRef(ruleRef) ? ruleRef : `${pipelineId}.${ruleRef}`);
  r.__ref = ruleRef;
  r.__file = file;
  r.__isLibrary = isLibraryRef(ruleRef);
  return r;
}

function resolveCondition(rulesRoot, pipelineId, condRef) {
  const file = isLibraryRef(condRef)
    ? libraryRefToPath(rulesRoot, condRef, "condition")
    : localRefToPath(rulesRoot, pipelineId, condRef, "condition");

  if (!exists(file)) {
    throw new Error(`Missing condition file for ref "${condRef}" (expected ${file})`);
  }
  const c = readJson(file);
  c.id = c.id || (isLibraryRef(condRef) ? condRef : `${pipelineId}.${condRef}`);
  c.__ref = condRef;
  c.__file = file;
  c.__isLibrary = isLibraryRef(condRef);
  return c;
}

function listPredicateRefs(cond) {
  if (!cond || cond.type !== "condition") return [];
  const when = cond.when;
  if (!when) return [];
  if (typeof when === "string") return [when];
  if (when.all && Array.isArray(when.all)) return when.all.slice();
  if (when.any && Array.isArray(when.any)) return when.any.slice();
  return [];
}

function resolvePredicate(rulesRoot, pipelineId, predRef) {
  // predicate is still a rule artifact (role: "predicate"), stored in rules/
  return resolveRule(rulesRoot, pipelineId, predRef);
}

function ruleDisplayTitle(rule) {
  // prefer description; else fallback to short id
  const desc = rule.description && String(rule.description).trim();
  if (desc) return desc;
  const short = String(rule.id || rule.__ref || "").split(".").pop();
  return short || "rule";
}

function conditionDisplayTitle(cond) {
  const desc = cond.description && String(cond.description).trim();
  if (desc) return desc;
  const short = String(cond.id || cond.__ref || "").split(".").pop();
  return short || "condition";
}

function ruleFieldLabel(rule) {
  if (rule.field) return rule.field;
  if (rule.fields && Array.isArray(rule.fields) && rule.fields.length) return rule.fields.join(", ");
  if (rule.path) return rule.path;
  return null;
}

function sectionForRule(rule) {
  const f = ruleFieldLabel(rule) || "";
  const fp = f.split(",")[0].trim(); // first field if multiple
  if (fp.startsWith("fatca.")) return "FATCA";
  if (fp.startsWith("tax.")) return "Tax";
  if (fp.startsWith("addr.") || fp.startsWith("faddr.")) return "Address";
  if (fp.startsWith("part.")) return "Status";
  if (fp.startsWith("beneficiary.")) return "Beneficiary";
  if (fp.startsWith("name.") || fp.startsWith("org.")) return "Identity";
  if (fp.startsWith("contacts.")) return "Contacts";
  return "Other";
}

function sectionForCondition(cond, resolvedPredicates) {
  // pick by first predicate field if possible; else by first step rule field
  for (const p of resolvedPredicates || []) {
    const s = sectionForRule(p);
    if (s !== "Other") return s;
  }
  // conditions may not have direct steps here (we handle steps separately), so default
  return "Other";
}

function stereotypeForRule(rule) {
  // role predicate has priority
  const role = (rule.role || "").toLowerCase();
  if (role === "predicate") return "PRED";

  const level = String(rule.level || "").toUpperCase(); // WARNING/ERROR/EXCEPTION
  const isLib = !!rule.__isLibrary;

  if (level === "EXCEPTION") return isLib ? "EXC_LIB" : "EXC";
  if (level === "ERROR") return isLib ? "ERR_LIB" : "ERR";
  if (level === "WARNING") return isLib ? "WARN_LIB" : "WARN";

  return isLib ? "LIB" : "OK";
}

function stereotypeForConditionPred() {
  return "PRED";
}

function formatRuleLine(rule) {
  const title = ruleDisplayTitle(rule);
  const op = rule.operator ? String(rule.operator) : "";
  const field = ruleFieldLabel(rule);
  const line2 = field ? `[${field}] ${op}`.trim() : `${op}`.trim();

  // Prefer 2 lines; if second is empty, single line
  const label = line2 ? `${title}\\n${line2}` : `${title}`;
  return escapePumlText(label);
}

function formatPredicateLine(pred) {
  const title = ruleDisplayTitle(pred);
  const op = pred.operator ? String(pred.operator) : "";
  const field = ruleFieldLabel(pred);
  const line2 = field ? `[${field}] ${op}`.trim() : `${op}`.trim();
  const label = line2 ? `predicate: ${title}\\n${line2}` : `predicate: ${title}`;
  return escapePumlText(label);
}

function formatConditionLabel(cond) {
  const title = conditionDisplayTitle(cond);
  const refs = listPredicateRefs(cond);
  let whenText = "";
  if (typeof cond.when === "string") {
    whenText = cond.when;
  } else if (cond.when?.all) {
    whenText = cond.when.all.join(" AND ");
  } else if (cond.when?.any) {
    whenText = cond.when.any.join(" OR ");
  } else {
    whenText = refs.join(" AND ");
  }

  const label = `${title}\\nwhen: ${whenText}`;
  return escapePumlText(label);
}

function openPartition(lines, name) {
  lines.push(`partition "${escapePumlText(name)}" {`);
}

function closePartition(lines) {
  lines.push(`}`);
}

function emitSkinParams(lines) {
  // Activity diagram stereotypes coloring
  lines.push("skinparam shadowing false");
  lines.push("skinparam roundcorner 14");
  lines.push("skinparam ActivityBorderColor #444444");
  lines.push("skinparam ActivityFontColor #111111");
  lines.push("skinparam ActivityBackgroundColor #F7F7F7");

  // Severity styles
  lines.push('skinparam ActivityBackgroundColor<<ERR>> #FFB3B3');
  lines.push('skinparam ActivityBorderColor<<ERR>> #B30000');

  lines.push('skinparam ActivityBackgroundColor<<WARN>> #FFE8A3');
  lines.push('skinparam ActivityBorderColor<<WARN>> #A07A00');

  lines.push('skinparam ActivityBackgroundColor<<EXC>> #FF6B6B');
  lines.push('skinparam ActivityBorderColor<<EXC>> #7A0000');
  lines.push('skinparam ActivityFontColor<<EXC>> #111111');
  lines.push('skinparam ActivityFontStyle<<EXC>> bold');

  // Predicate gray
  lines.push('skinparam ActivityBackgroundColor<<PRED>> #DDDDDD');
  lines.push('skinparam ActivityBorderColor<<PRED>> #777777');

  // Library distinct background
  lines.push('skinparam ActivityBackgroundColor<<LIB>> #C9F0EA');
  lines.push('skinparam ActivityBorderColor<<LIB>> #0F6B62');

  // Combined stereotypes (severity + library)
  lines.push('skinparam ActivityBackgroundColor<<ERR_LIB>> #BFECE5');
  lines.push('skinparam ActivityBorderColor<<ERR_LIB>> #B30000');

  lines.push('skinparam ActivityBackgroundColor<<WARN_LIB>> #BFECE5');
  lines.push('skinparam ActivityBorderColor<<WARN_LIB>> #A07A00');

  lines.push('skinparam ActivityBackgroundColor<<EXC_LIB>> #BFECE5');
  lines.push('skinparam ActivityBorderColor<<EXC_LIB>> #7A0000');
  lines.push('skinparam ActivityFontStyle<<EXC_LIB>> bold');

  // ok fallback
  lines.push('skinparam ActivityBackgroundColor<<OK>> #F7F7F7');
}

function generatePuml(rulesRoot, pipelineId, pipeline) {
  const title = pipeline.description ? `${pipelineId} - ${pipeline.description}` : pipelineId;

  const lines = [];
  lines.push("@startuml");
  lines.push(`title ${escapePumlText(title)}`);
  emitSkinParams(lines);
  lines.push("start");

  let currentPartition = null;

  function ensurePartition(name) {
    if (currentPartition === name) return;
    if (currentPartition) closePartition(lines);
    currentPartition = name;
    openPartition(lines, name);
  }

  function emitRuleStep(ruleRef) {
    const rule = resolveRule(rulesRoot, pipelineId, ruleRef);
    const section = sectionForRule(rule);
    ensurePartition(section);

    const stereo = stereotypeForRule(rule);
    lines.push(`:${formatRuleLine(rule)}; <<${stereo}>>`);
  }

  function emitPredicateActivities(cond, resolvedPredicates) {
    if (!resolvedPredicates || !resolvedPredicates.length) return;

    // Put predicate evaluations in same section as the condition (or their own best section)
    const sec = sectionForCondition(cond, resolvedPredicates);
    ensurePartition(sec);

    for (const p of resolvedPredicates) {
      const stereo = stereotypeForConditionPred();
      lines.push(`:${formatPredicateLine(p)}; <<${stereo}>>`);
    }
  }

  function emitConditionStep(condRef) {
    const cond = resolveCondition(rulesRoot, pipelineId, condRef);

    const predRefs = listPredicateRefs(cond);
    const preds = predRefs.map((r) => resolvePredicate(rulesRoot, pipelineId, r));

    // Show predicates as gray steps (evaluations)
    emitPredicateActivities(cond, preds);

    // Condition branching header
    const condSection = sectionForCondition(cond, preds);
    ensurePartition(condSection);

    lines.push(`if ("${formatConditionLabel(cond)}") then (true)`);

    // Steps inside condition
    const steps = Array.isArray(cond.steps) ? cond.steps : [];
    // We won't open partitions inside if; it gets messy in PlantUML.
    // Instead, keep them in the current partition.
    for (const step of steps) {
      if (step.rule) {
        const rule = resolveRule(rulesRoot, pipelineId, step.rule);
        const stereo = stereotypeForRule(rule);
        lines.push(`  :${formatRuleLine(rule)}; <<${stereo}>>`);
      } else if (step.pipeline) {
        // Flatten: represent nested pipeline as a single activity
        const p = loadPipeline(rulesRoot, step.pipeline);
        const label = p.description ? `pipeline: ${step.pipeline}\\n${p.description}` : `pipeline: ${step.pipeline}`;
        lines.push(`  :${escapePumlText(label)};`);
      }
    }

    lines.push("else (false)");
    lines.push("endif");
  }

  // Main flow
  const flow = Array.isArray(pipeline.flow) ? pipeline.flow : [];
  for (const step of flow) {
    if (step.rule) emitRuleStep(step.rule);
    else if (step.condition) emitConditionStep(step.condition);
    else if (step.pipeline) {
      const p = loadPipeline(rulesRoot, step.pipeline);
      ensurePartition("Other");
      const label = p.description ? `pipeline: ${step.pipeline}\\n${p.description}` : `pipeline: ${step.pipeline}`;
      lines.push(`:${escapePumlText(label)};`);
    }
  }

  if (currentPartition) closePartition(lines);

  lines.push("stop");
  lines.push("@enduml");

  return lines.join("\n") + "\n";
}

function main() {
  const args = parseArgs(process.argv);

  const pipelineId = args.pipeline;
  if (!pipelineId) die("Usage: node scripts/pipeline2puml.js --pipeline <pipelineId> [--rules ./rules] [--out ./file.puml]");

  const rulesRoot = path.resolve(args.rules || path.join(process.cwd(), "rules"));
  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(rulesRoot, "pipeline", pipelineId, `${pipelineId}.puml`);

  const pipeline = loadPipeline(rulesRoot, pipelineId);
  const puml = generatePuml(rulesRoot, pipelineId, pipeline);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, puml, "utf8");

  console.log(`OK: wrote ${outPath}`);
}

main();
