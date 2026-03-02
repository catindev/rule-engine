# DSL rule engine prototype (vanilla Node.js)

This repo contains a small **JSON‑DSL** driven validation engine.

## What it does

- Loads **artifacts** (pipelines / rules / conditions / dictionaries) from the `./rules` folder
- Compiles references (`rule`, `condition`, `pipeline`) into fully-qualified ids
- Executes a selected **pipeline** against a **flat payload** (dot-keys) and returns:
  - `status`: `OK | WARNING | ERROR | EXCEPTION`
  - `issues`: accumulated `WARNING`/`ERROR` items
  - `trace`: optional execution trace (enabled by `--pretty` currently prints it too)

> Levels are engine-level only: **WARNING / ERROR / EXCEPTION**.  
> Business interpretation (e.g. compliance blocks) is expected to be done upstream by analyzing returned issues.

## Quick start

```bash
# run main pipeline against sample payload
node index.js --payload ./payload.sample.json --pipeline pipeline_main --pretty
```

### CLI

`node index.js --payload <file.json> --pipeline <pipelineId> [--rules <rulesDir>] [--pretty]`

- `--payload` – path to JSON file with **flat fields**
- `--pipeline` – pipeline id (folder name under `rules/pipeline/<id>/pipeline.json`)
- `--rules` – optional rules directory (defaults to `./rules`)
- `--pretty` – pretty JSON output

## Payload format (flat)

The engine reads fields by **exact key**, e.g.

```json
{
  "beneficiary.type": "UL_RESIDENT",
  "beneficiary.inn": "4823057200",
  "tax.foreign": false
}
```

No nested objects are traversed in this prototype.

## Directory layout

```
index.js
/lib
  loader.js        # loads artifacts from rules dir
  resolver.js      # resolves relative refs to fully-qualified ids
  compiler.js      # validates and compiles artifacts, detects duplicates
  runner.js        # executes pipelines / rules / conditions
  utils.js
  /operators
    check/         # check-role operators
    predicate/     # predicate-role operators
/rules
  /pipeline
    <pipelineId>/
      pipeline.json
      /rules         # rules local to this pipeline (referenced as "rule_x")
      /conditions    # conditions local to this pipeline (referenced as "cond_x")
  /library
    <pack>/<ruleId>.json   # reusable rules referenced as "library.pack.ruleId"
    /common
    /inn
  /dictionary
    *.json          # dictionaries for in_dictionary operator
```

## DSL

### Rule

```json
{
  "id": "rule_x",
  "type": "rule",
  "description": "…",
  "role": "check",
  "operator": "not_empty",
  "level": "ERROR",
  "code": "ERR_SOMETHING",
  "message": "Human readable message",
  "field": "some.field",
  "value": "optional operator arg"
}
```

- `role: "check"` produces issues when it fails.
- `role: "predicate"` is allowed in `condition.when` and **never** produces issues.

### Condition

```json
{
  "id": "cond_x",
  "type": "condition",
  "description": "…",
  "when": { "all": ["pred_a", "pred_b"] },
  "steps": [ { "rule": "rule_1" }, { "pipeline": "other_pipeline" } ]
}
```

- `when` supports:
  - `"pred_id"` (single predicate)
  - `{ "all": ["pred1", "pred2"] }`
  - `{ "any": ["pred1", "pred2"] }`
- Predicates that evaluate to `UNDEFINED` are treated as **FALSE** and logged in trace.
- Any runtime exception inside predicate/check/operator escalates to **EXCEPTION** and stops execution.

### Pipeline

```json
{
  "id": "pipeline_main",
  "type": "pipeline",
  "description": "…",
  "flow": [
    { "rule": "rule_x" },
    { "condition": "cond_y" },
    { "pipeline": "another_pipeline" }
  ]
}
```

## Output model

Example:

```json
{
  "status": "ERROR",
  "control": "CONTINUE",
  "issues": [
    {
      "kind": "ISSUE",
      "level": "ERROR",
      "code": "ERR_TAX_TIN_REQUIRED",
      "field": "tax.tin",
      "ruleId": "ul_resident_pre_abs.rule_tax_tin_required"
    }
  ],
  "trace": [ ... ]
}
```

- `status` is the **max** observed level:
  - `OK` (no issues)
  - `WARNING` (warnings only)
  - `ERROR` (at least one error)
  - `EXCEPTION` (an exception occurred)
- `control` is reserved for future orchestration (currently always `CONTINUE`).

## Adding operators

Operators are plain JS modules under `lib/operators/<role>/`.

Each operator exports a function:

```js
module.exports = function operator(ctx, spec) {
  // ctx.payload, ctx.get(field), …
  // return { ok: true } or { ok: false, expected, actual }
}
```

See existing operators for examples.

## Generating PlantUML for a pipeline

```bash
node scripts/pipeline2puml.js --pipeline pipeline_main
# creates: rules/pipeline/pipeline_main/pipeline_main.puml
```

Optional:
- `--rules <dir>` to point to a different rules folder
- `--out <file>` to override output path
- `--expand 1` to inline one level of nested pipelines (default 0)

