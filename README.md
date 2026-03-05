# DSL-движок валидации (прототип)

Это прототип движка правил для валидации JSON-пэйлоадов через набор декларативных артефактов в `rules/**`.

Движок выполняет:

1. загрузку артефактов из файловой системы (`rules/**.json`)
2. компиляцию в единый registry (валидация схем, ссылок и видимости)
3. исполнение выбранного pipeline для заданного payload
4. возврат результата: `status`, `control`, `issues`, `trace`

## Быстрый старт (HTTP)

```bash
node server.js
# или
PORT=3001 RULES_DIR=./rules TRACE=1 node server.js
```

Запуск пайплайна (pipelineId берется из URL):

```bash
curl -X POST http://localhost:3000/pipeline_main \
  -H "Content-Type: application/json" \
  -d @payloads/checkout.fail.strict.json
```

По умолчанию `trace` в ответе скрывается. Чтобы вернуть `trace` в ответе запустите сервер с `TRACE=1`.

## Публичный API (как библиотека)

Основной API в `createEngine({ operators })`.

- `compile(artifacts, { sources })` → `compiled`
- `runPipeline(compiled, pipelineId, payload)` → результат выполнения

В сервере это выглядит так:

1. загрузка: `loadArtifactsFromDir(RULES_DIR)` → `{ artifacts, sources }`
2. компиляция: `engine.compile(artifacts, { sources })`
3. запуск: `engine.runPipeline(compiled, pipelineId, payload)`

## Формат данных (payload)

В прототипе используется **flat-only** доступ к данным.

Это значит:

- `field` это **буквальный ключ** в payload
- точки в ключах (`order.id`) часть имени ключа
- навигации по вложенным объектам (`payload.order.id`) нет

Пример payload:

```json
{
  "order.id": "A100",
  "order.amount": 1200,
  "customer.phone": "+491234567890"
}
```

> **wildcard `[*]` сейчас не поддержан** в рантайме (в `deepGet()` используется точное совпадение ключа).

## Структура `rules/` и области видимости

Loader читает **все** `*.json` рекурсивно из `rules/`.

Текущая структура (актуально по коду `artifact-normalizer.js`):

```
rules/
  library/                 # переиспользуемые артефакты (id начинаются с library.)
  dictionaries/            # справочники (глобально доступны)
  pipelines/               # пайплайны и их локальные артефакты
    <pipelinePath>/
      pipeline.json
      rule_x.json
      condition_y.json
      pred_z.json
      <nestedPipelinePath>/
        pipeline.json
        ...
```

### Как формируется `pipelineId`

Путь пайплайна определяется директориями внутри `rules/pipelines/` и объединяется точками.

Пример:

- файл: `rules/pipelines/checkout_main/base_validate/pipeline.json`
- pipelineId: `checkout_main.base_validate`

### Локальные артефакты и их id

Движок изолирует видимость правил и условий между пайплайнами.

- Артефакты **внутри pipeline** должны иметь id с префиксом `"<pipelineId>."`.
  - пример: `checkout_main.base_validate.rule_amount_positive`

- Ссылки внутри pipeline/condition можно писать коротко:
  - `{ "rule": "rule_amount_positive" }`
  - движок развернет это в `checkout_main.base_validate.rule_amount_positive`

- Библиотечные артефакты указываются явно:
  - `{ "rule": "library.common.email_required" }`

Правила видимости (валидируются на compile-time):

- `rule` / `condition` должны быть **локальными** для текущего pipeline **или** из `library.*`
- `pipeline`-шаги могут ссылаться на другие пайплайны по их глобальному `pipelineId`

## Артефакты (JSON)

### 1) Rule

Rule — атомарная проверка одного поля.

Обязательные поля (по коду компилятора):

- `id` (string, уникальный)
- `type: "rule"`
- `description` (string, обязателен)
- `role: "check" | "predicate"`
- `operator` (string)
- `field` (string)

Дополнительно для `role: "check"`:

- `level: "WARNING" | "ERROR" | "EXCEPTION"`
- `code` (string)
- `message` (string)

Для `role: "predicate"` запрещены: `level`, `code`, `message`.

Опционально:

- `meta` (object) — любые вспомогательные данные (почему/ссылка на БТ/подсказка и т.п.)

#### Пример check-rule

```json
{
  "type": "rule",
  "description": "Сумма заказа должна быть положительной",
  "role": "check",
  "field": "order.amount",
  "operator": "greater_than",
  "value": 0,
  "level": "ERROR",
  "code": "ERR_AMOUNT_POSITIVE",
  "message": "Сумма заказа должна быть больше нуля",
  "meta": { "why": "Транспортная проверка", "hint": "amount > 0" },
  "id": "checkout_main.base_validate.rule_amount_positive"
}
```

#### Пример predicate-rule

```json
{
  "type": "rule",
  "role": "predicate",
  "description": "Признак необходимости 3DS",
  "field": "threeDS.requested",
  "operator": "equals",
  "value": true,
  "meta": { "why": "3DS-проверки нужны только при включенном флаге" },
  "id": "checkout_main.threeds_validate.pred_is_3ds_required"
}
```

> В рантайме `UNDEFINED` у предиката трактуется как `FALSE`.

### 2) Condition

Condition - условная ветка: выполняет `steps`, если условие `when` истинно.

Обязательные поля:

- `id`
- `type: "condition"`
- `description` (string, обязателен)
- `when`:
  - строка: `"pred_x"`
  - или объект: `{ "all": ["pred1", "pred2"] }` / `{ "any": [...] }`

- `steps` (non-empty array)

Пример:

```json
{
  "type": "condition",
  "description": "Выполнять 3DS-проверки только если threeDS.requested=true",
  "when": "pred_is_3ds_required",
  "steps": [
    { "rule": "rule_3ds_method_required" },
    { "rule": "rule_3ds_method_allowed" }
  ],
  "id": "checkout_main.threeds_validate.condition_3ds_required"
}
```

---

### 3) Pipeline

Pipeline — последовательность шагов. Шаги могут быть:

- `{ "rule": "..." }`
- `{ "condition": "..." }`
- `{ "pipeline": "..." }`

Обязательные поля:

- `id`
- `type: "pipeline"`
- `description` (string, обязателен)
- `strict` (boolean, **обязательно указан явно**)
- `flow` (non-empty array)

Если `strict: true`, дополнительно:

- `message` (string, обязателен)
- `strictCode` (string, опционально; по умолчанию `STRICT_PIPELINE_FAILED`)

Пример:

```json
{
  "id": "checkout_main.risk.strict",
  "type": "pipeline",
  "description": "Критический блок риск-проверок",
  "strict": true,
  "message": "Найдены критические ошибки",
  "strictCode": "RISK_BLOCK_FAILED",
  "flow": [{ "rule": "rule_sanctions_country_block" }]
}
```

#### Strict pipelines (строгий режим)

Если pipeline помечен как `strict: true`, то после выполнения его `flow` движок проверит: появились ли внутри этого pipeline **хотя бы одна** issue уровня `ERROR` или `EXCEPTION`.

Если да — добавляется boundary-issue и выполнение останавливается (`control=STOP`, `status=EXCEPTION`).

---

### 4) Dictionary

Справочник (`type: "dictionary"`) доступен глобально из операторов `in_dictionary`.

Для `in_dictionary` сейчас поддерживается только:

```json
"dictionary": { "type": "static", "id": "<dictionaryId>" }
```

Компилятор проверяет, что такой dictionary действительно загружен.

## Операторы

Операторы определены в `lib/operators/*` и разделены на два набора:

- `operators.check` для `role: check`
- `operators.predicate` для `role: predicate`

Список (как в `lib/operators/index.js`):

**check**:

- `not_empty`, `is_empty`
- `length_equals`, `length_max`
- `matches_regex`
- `in_dictionary`
- `equals`, `not_equals`
- `contains`
- `greater_than`, `less_than`
- `field_less_than_field`, `field_greater_than_field`
- `any_filled`
- `valid_inn`, `valid_ogrn`

**predicate**:

- `equals`, `not_equals`
- `not_empty`, `is_empty`
- `matches_regex`
- `in_dictionary`
- `contains`

## Результат выполнения

`runPipeline()` возвращает объект:

- `status`: `OK | EXCEPTION | ABORT`
  - `OK` — дошли до конца
  - `EXCEPTION` — остановились по EXCEPTION-rule или strict boundary
  - `ABORT` — runtime exception (баг/неожиданная ошибка)

- `control`: `CONTINUE | STOP` (присутствует для OK/EXCEPTION)
- `issues`: массив найденных проблем
- `trace`: техническая трассировка (может быть скрыта сервером)

Пример issue (формируется рантаймом при `FAIL` check-rule):

```json
{
  "kind": "ISSUE",
  "level": "ERROR",
  "code": "ERR_AMOUNT_POSITIVE",
  "message": "Сумма заказа должна быть больше нуля",
  "field": "order.amount",
  "ruleId": "checkout_main.base_validate.rule_amount_positive",
  "expected": 0,
  "actual": 1200,
  "stepId": null
}
```

## PlantUML диаграммы пайплайнов

В репозитории есть генератор диаграмм в `tools/docgen-plantuml.js`, который умеет строить **одну** activity-диаграмму для entry pipeline, включая все вложенные пайплайны inline.

В текущем виде удобнее вызывать его напрямую (с правильной сигнатурой):

```bash
node -e "const path=require('path'); const {loadArtifactsFromDir}=require('./lib/loader-fs'); const {createEngine}=require('./lib/engine'); const {Operators}=require('./lib/operators'); const {generatePumlForEntryPipeline}=require('./tools/docgen-plantuml'); const rulesDir=path.join(__dirname,'rules'); const {artifacts,sources}=loadArtifactsFromDir(rulesDir); const engine=createEngine({operators:Operators}); const compiled=engine.compile(artifacts,{sources}); const r=generatePumlForEntryPipeline(compiled, rulesDir, 'pipeline_main'); console.log('Wrote:', r.outPath);"
```

## Важные ограничения прототипа

- payload читается только в **flat-only** режиме (точное совпадение ключа)
- wildcard/массовые проверки по массивам не реализованы
- справочники поддержаны только в статическом виде (`dictionary.type = static`)

## Версия

`package.json`: `0.6.1`
