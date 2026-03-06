# DSL Rule Engine

Движок декларативной валидации JSON-пэйлоадов через набор артефактов в `rules/**`.

Версия: `0.6.1`

## Что делает движок

1. Загружает артефакты из файловой системы (`rules/**/*.json`)
2. Компилирует их в единый registry - проверяет схемы, ссылки и видимость на старте
3. Исполняет выбранный pipeline для заданного payload
4. Возвращает результат: `status`, `issues`, `trace`

## Быстрый старт

```bash
node server.js
# или с параметрами
PORT=3001 RULES_DIR=./rules TRACE=1 node server.js
```

По умолчанию `trace` в ответе скрыт. Чтобы включить — запустите с `TRACE=1`.

## HTTP API

### `POST /v1/validate`

Единственный рабочий эндпоинт.

**Тело запроса:**

```json
{
  "context": {
    "pipelineId": "checkout_main",
    "merchantId": "demo-merchant",
    "currentDate": "2026-03-06",
    "rulesetVersion": "draft-1"
  },
  "payload": {
    "order.id": "ORD-1001",
    "order.amount": 1999.99,
    "order.currency": "RUB"
  }
}
```

- `context.pipelineId` обязателен, определяет какой пайплайн запускается
- остальные поля `context` произвольные, доступны в правилах через `$context.<key>`
- `payload` flat-map данных заявки (подробнее смотри в разделе "Формат payload")

**Ответ:**

```json
{
  "context": { "pipelineId": "checkout_main", "merchantId": "demo-merchant" },
  "status": "OK",
  "control": "CONTINUE",
  "issues": []
}
```

`context` возвращается эхом для трейсабилити.

### Примеры

```bash
# Успешная валидация
curl -s -X POST http://localhost:3000/v1/validate \
  -H "Content-Type: application/json" \
  -d @payloads/checkout.ok.json | jq '.status, .issues'

# Мерчант не в белом списке → EXCEPTION
curl -s -X POST http://localhost:3000/v1/validate \
  -H "Content-Type: application/json" \
  -d @payloads/checkout.fail.merchant.json | jq '.status, .issues'

# Много ошибок, strict pipeline → EXCEPTION
curl -s -X POST http://localhost:3000/v1/validate \
  -H "Content-Type: application/json" \
  -d @payloads/checkout.fail.strict.json | jq '.status, .issues[].code'
```

## Формат payload

Движок использует **flat-map**: все данные на верхнем уровне объекта, вложенности нет.

```json
{
  "order.id": "A100",
  "order.amount": 1200,
  "customer.phone": "+79001234567"
}
```

Точка в ключе — часть имени, не навигация. `order.id` это буквальный ключ, а не `payload.order.id`.

### Массивы

Элементы массива кодируются через индексы:

```json
{
  "docs[0].type": "21",
  "docs[0].series": "4510",
  "docs[1].type": "31",
  "docs[1].series": ""
}
```

В правилах для применения проверки ко всем элементам используется wildcard `[*]`:

```json
{ "field": "docs[*].type" }
```

Движок раскрывает wildcard в конкретные ключи и применяет правило к каждому. Подробнее — в `docs/wildcart.md`.

### Доступ к контексту из правил

Любое поле `context` доступно в правилах через префикс `$context.`:

```json
{ "field": "$context.merchantId" }
```

Это позволяет писать правила, зависящие от мерчанта, даты запроса, типа операции и других системных параметров без смешивания их с данными заявки.

## Структура `rules/`

```
rules/
  library/              # переиспользуемые артефакты (id начинаются с library.)
  dictionaries/         # справочники, глобально доступны
  pipelines/
    <pipelineId>/
      pipeline.json     # обязателен
      rule_x.json       # локален для этого пайплайна
      condition_y.json  # локален для этого пайплайна
      <nestedId>/
        pipeline.json
        ...
```

### Как формируется id

Путь внутри `rules/pipelines/` транслируется в id через точку:

- `rules/pipelines/checkout_main/base_validate/pipeline.json` → `checkout_main.base_validate`
- `rules/pipelines/checkout_main/base_validate/rule_amount_positive.json` → `checkout_main.base_validate.rule_amount_positive`

### Видимость

- `rule` / `condition` видны только в своём пайплайне **или** через `library.*`
- `pipeline` может ссылаться на любой другой pipeline по полному id
- Компилятор проверяет все ссылки при старте — ошибки обнаруживаются до первого запроса

Ссылки внутри пайплайна можно писать коротко (без префикса пайплайна):

```json
{ "rule": "rule_amount_positive" }
```

Движок автоматически разворачивает в `checkout_main.base_validate.rule_amount_positive`.

## Артефакты

### Rule

Атомарная проверка одного поля.

**Обязательные поля:**

| Поле          | Тип                        | Описание                            |
| ------------- | -------------------------- | ----------------------------------- |
| `id`          | string                     | уникальный идентификатор            |
| `type`        | `"rule"`                   | —                                   |
| `description` | string                     | —                                   |
| `role`        | `"check"` \| `"predicate"` | —                                   |
| `operator`    | string                     | см. раздел «Операторы»              |
| `field`       | string                     | ключ в payload или `$context.<key>` |

Для `role: "check"` дополнительно обязательны: `level`, `code`, `message`.  
Для `role: "predicate"` поля `level`, `code`, `message` **запрещены**.

**Опционально:**

- `value` — константа для сравнения (для большинства операторов)
- `value_field` — второй ключ payload (для `field_less_than_field`, `field_greater_than_field`)
- `paths` — массив ключей (только для `any_filled`)
- `dictionary` — ссылка на справочник (только для `in_dictionary`)
- `aggregate` — настройка агрегации для wildcard-полей
- `meta` — произвольный объект с пояснениями (почему, ссылка на БТ, подсказка)

**Пример check-rule:**

```json
{
  "id": "checkout_main.base_validate.rule_amount_positive",
  "type": "rule",
  "description": "Сумма заказа должна быть положительной",
  "role": "check",
  "operator": "greater_than",
  "field": "order.amount",
  "value": 0,
  "level": "ERROR",
  "code": "ERR_AMOUNT_POSITIVE",
  "message": "Сумма заказа должна быть больше нуля",
  "meta": { "why": "Транспортная проверка", "hint": "amount > 0" }
}
```

**Пример predicate-rule:**

```json
{
  "id": "checkout_main.threeds_validate.pred_is_3ds_required",
  "type": "rule",
  "role": "predicate",
  "description": "Признак необходимости 3DS",
  "operator": "equals",
  "field": "threeDS.requested",
  "value": true
}
```

> Если предикат вернул `UNDEFINED` (поле отсутствует в payload) — трактуется как `FALSE`.

### Condition

Условная ветка: выполняет `steps` только если `when` истинно.

```json
{
  "id": "checkout_main.threeds_validate.condition_3ds_required",
  "type": "condition",
  "description": "3DS-проверки только если threeDS.requested=true",
  "when": "pred_is_3ds_required",
  "steps": [
    { "rule": "rule_3ds_method_required" },
    { "rule": "rule_3ds_method_allowed" }
  ]
}
```

`when` может быть:

```json
"pred_x"                          // один предикат
{ "all": ["pred_x", "pred_y"] }   // все должны быть TRUE
{ "any": ["pred_x", "pred_y"] }   // хотя бы один TRUE
```

---

### Pipeline

Последовательность шагов. Шаги могут быть:

```json
{ "rule": "rule_x" }
{ "condition": "condition_y" }
{ "pipeline": "other.pipeline.id" }
```

**Обязательные поля:**

| Поле          | Тип          | Описание                    |
| ------------- | ------------ | --------------------------- |
| `id`          | string       | —                           |
| `type`        | `"pipeline"` | —                           |
| `description` | string       | —                           |
| `strict`      | boolean      | **обязательно указан явно** |
| `flow`        | array        | непустой список шагов       |

Если `strict: true` — дополнительно обязателен `message` (string).  
Опционально: `strictCode` (string, по умолчанию `STRICT_PIPELINE_FAILED`).

#### Strict pipeline

Если pipeline помечен `strict: true`, движок после выполнения его `flow` проверяет: появилась ли внутри хотя бы одна issue уровня `ERROR` или `EXCEPTION`. Если да — добавляется итоговый EXCEPTION-issue с `strictCode` и выполнение останавливается.

Используется для логических границ процесса — блок проверки документов, FATCA, риск-проверки и т.д.

```json
{
  "id": "checkout_main.risk.strict",
  "type": "pipeline",
  "description": "Критический блок риск-проверок",
  "strict": true,
  "message": "Риск-проверки не пройдены",
  "strictCode": "STRICT_RISK_FAILED",
  "flow": [
    { "pipeline": "checkout_main.risk.geo" },
    { "pipeline": "checkout_main.risk.velocity" },
    { "pipeline": "checkout_main.risk.device" }
  ]
}
```

### Dictionary

Справочник для оператора `in_dictionary`. Доступен глобально.

```json
{
  "id": "merchants_allowed",
  "type": "dictionary",
  "description": "Белый список merchantId",
  "entries": ["demo-merchant", "acme-corp", "rocket-work"]
}
```

`entries` может содержать строки или объекты с полями `code` / `value`.

Ссылка из правила:

```json
"dictionary": { "type": "static", "id": "merchants_allowed" }
```

Компилятор проверяет существование словаря при старте.

## Операторы

### check (role: "check")

| Оператор                   | Параметры                             | Описание                                               |
| -------------------------- | ------------------------------------- | ------------------------------------------------------ |
| `not_empty`                | —                                     | поле заполнено (не null / undefined / "")              |
| `is_empty`                 | —                                     | поле пустое                                            |
| `equals`                   | `value`                               | строгое равенство (`===`)                              |
| `not_equals`               | `value`                               | строгое неравенство                                    |
| `contains`                 | `value`                               | строка содержит подстроку                              |
| `matches_regex`            | `value` (regex string)                | соответствует регулярному выражению                    |
| `greater_than`             | `value` (число или дата `YYYY-MM-DD`) | поле > value                                           |
| `less_than`                | `value` (число или дата `YYYY-MM-DD`) | поле < value                                           |
| `field_greater_than_field` | `value_field`                         | payload[field] > payload[value_field]                  |
| `field_less_than_field`    | `value_field`                         | payload[field] < payload[value_field]                  |
| `length_equals`            | `value` (число)                       | длина строки равна value                               |
| `length_max`               | `value` (число)                       | длина строки ≤ value                                   |
| `in_dictionary`            | `dictionary: {type, id}`              | значение есть в справочнике                            |
| `any_filled`               | `paths` (array of strings)            | хотя бы одно из перечисленных полей заполнено          |
| `valid_inn`                | —                                     | контрольный разряд ИНН (10 цифр — ЮЛ, 12 цифр — ФЛ/ИП) |
| `valid_ogrn`               | —                                     | контрольный разряд ОГРН (13 цифр) или ОГРНИП (15 цифр) |

> Операторы сравнения (`greater_than`, `less_than`, `field_*`) поддерживают числа и даты в формате `YYYY-MM-DD`.

### predicate (role: "predicate")

| Оператор        | Параметры                |
| --------------- | ------------------------ |
| `equals`        | `value`                  |
| `not_equals`    | `value`                  |
| `not_empty`     | —                        |
| `is_empty`      | —                        |
| `contains`      | `value`                  |
| `matches_regex` | `value`                  |
| `in_dictionary` | `dictionary: {type, id}` |
| `greater_than`  | `value`                  |
| `less_than`     | `value`                  |

## Wildcard и агрегации

Для правил по массивам используется `[*]` в поле:

```json
{ "field": "docs[*].series" }
```

Поддерживается только один `[*]` на поле. Движок ищет совпадающие ключи в payload по числовым индексам.

### Блок `aggregate`

Определяет как объединять результаты по элементам массива:

| mode    | Семантика                                                         |
| ------- | ----------------------------------------------------------------- |
| `EACH`  | issue для каждого провалившегося элемента (default для check)     |
| `ALL`   | все должны пройти; одна сводная issue при провале                 |
| `COUNT` | проверяет количество прошедших элементов (требует `op` и `value`) |
| `MIN`   | агрегирует минимум и применяет оператор к нему                    |
| `MAX`   | агрегирует максимум и применяет оператор к нему                   |

Для predicate default — `ANY` (хотя бы один TRUE).

### `onEmpty`

Поведение если wildcard не нашёл ни одного ключа:

| значение         | поведение                                    |
| ---------------- | -------------------------------------------- |
| `PASS` / `TRUE`  | считается успехом (default для check — PASS) |
| `FAIL` / `FALSE` | считается провалом                           |
| `ERROR`          | бросает runtime-ошибку                       |

**Пример:**

```json
{
  "id": "...",
  "type": "rule",
  "role": "check",
  "description": "qty каждого товара должен быть > 0",
  "operator": "greater_than",
  "field": "checkout.items[*].qty",
  "value": 0,
  "aggregate": { "mode": "EACH", "onEmpty": "FAIL" },
  "level": "ERROR",
  "code": "ERR_ITEM_QTY_POSITIVE",
  "message": "Количество товара должно быть больше 0"
}
```

Подробнее в `docs/wildcart.md`.

## Уровни ошибок

| level       | Поведение                                       |
| ----------- | ----------------------------------------------- |
| `WARNING`   | накапливается в issues, выполнение продолжается |
| `ERROR`     | накапливается в issues, выполнение продолжается |
| `EXCEPTION` | немедленно останавливает выполнение             |

`WARNING` и `ERROR` не останавливают пайплайн сами по себе. Остановка происходит только от `EXCEPTION`-rule или от `strict`-границы.

## Результат выполнения

`runPipeline()` / HTTP ответ:

```json
{
  "context": { "pipelineId": "...", "merchantId": "..." },
  "status": "OK",
  "control": "CONTINUE",
  "issues": []
}
```

| Поле      | Значения                       | Описание                                                           |
| --------- | ------------------------------ | ------------------------------------------------------------------ |
| `status`  | `OK` \| `EXCEPTION` \| `ABORT` | итог выполнения                                                    |
| `control` | `CONTINUE` \| `STOP`           | внутренний сигнал (есть при OK и EXCEPTION)                        |
| `issues`  | array                          | найденные проблемы                                                 |
| `trace`   | array                          | техническая трассировка (скрыта по умолчанию, включить: `TRACE=1`) |

- `OK` — выполнение дошло до конца
- `EXCEPTION` — остановлено EXCEPTION-rule или strict-границей
- `ABORT` — runtime-ошибка в самом движке (баг)

**Структура issue:**

```json
{
  "kind": "ISSUE",
  "level": "ERROR",
  "code": "ERR_CURRENCY_UNSUPPORTED",
  "message": "Валюта не поддерживается",
  "field": "order.currency",
  "ruleId": "checkout_main.base_validate.rule_currency_supported",
  "expected": { "type": "static", "id": "currencies_supported" },
  "actual": "XYZ",
  "stepId": null
}
```

## Публичный API (как библиотека)

```js
const { createEngine } = require("./lib");
const { loadArtifactsFromDir } = require("./lib/loader-fs");
const { Operators } = require("./lib/operators");

// 1. Загрузка
const { artifacts, sources } = loadArtifactsFromDir("./rules");

// 2. Компиляция (одноразово при старте)
const engine = createEngine({ operators: Operators });
const compiled = engine.compile(artifacts, { sources });

// 3. Запуск (на каждый запрос)
const payload = { ...flatPayload, __context: context };
const result = engine.runPipeline(compiled, "checkout_main", payload);
```

`__context` в движке это зарезервированный ключ в enrichedPayload, через который движок передаёт context внутрь операторов. В правилах и предикатах доступ к контексту всегда пишется как `$context.<key>` это единственный синтаксис для аналитика. Wildcard-расширение ключ `__context` игнорирует.
