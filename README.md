# DSL Rule Engine

Движок декларативной валидации JSON-пэйлоадов через набор артефактов в `rules/**`.

Версия: `0.7.0`

## Что делает движок

1. Загружает артефакты (правила, пайплайны, словари) из файловой системы или снэпшота
2. Компилирует их в единый registry — проверяет схемы, ссылки, коды и видимость
3. Исполняет выбранный pipeline для заданного payload
4. Возвращает результат: `status`, `issues`, `trace`

Движок **stateless** - один снэпшот пакета правил, один файл, нет БД. Это означает горизонтальное масштабирование без синхронизации состояния, простой rollback и canary-деплой через роутинг трафика между инстансами.

## Быстрый старт

```bash
# dev-режим: сканирует ./rules, hot-reload при изменении файлов
node server.js

# production / test: из снэпшота
NODE_ENV=production SNAPSHOT_PATH=./snapshot.json node server.js
```

Подробнее про режимы запуска и снэпшоты в разделе [Сборка и деплой](#сборка-и-деплой).

## HTTP API

### `POST /v1/validate`

**Тело запроса:**

```json
{
  "context": {
    "pipelineId": "checkout_main",
    "merchantId": "demo-merchant",
    "currentDate": "2026-03-06"
  },
  "payload": {
    "order": { "id": "ORD-1001", "amount": 1999.99, "currency": "RUB" },
    "customer": { "email": "user@example.com" }
  }
}
```

- `context.pipelineId` обязателен, определяет какой пайплайн запускается
- остальные поля `context` произвольные, доступны в правилах через `$context.<key>`
- `payload` вложенный JSON или flat-map, движок принимает оба формата

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

### `GET /health`

Возвращает текущий режим и мета-информацию:

```json
{
  "ok": true,
  "mode": "production",
  "version": "1.2.0",
  "createdAt": "...",
  "createdBy": "..."
}
```

В dev-режиме: `{ "ok": true, "mode": "development", "rulesDir": "..." }`

### `GET /v1/plantuml/:pipelineId`

Возвращает PlantUML-диаграмму пайплайна в виде plain text. Все вложенные пайплайны раскрываются inline.

## Формат payload

Движок принимает структурированный JSON (рекомендуется) и flat-map (для обратной совместимости). Перед проверкой payload по правилам JSON из него сконвертируется движком во flat-map.

```json
{ "order": { "id": "A100", "amount": 1200 } }
```

эквивалентно:

```json
{ "order.id": "A100", "order.amount": 1200 }
```

Подробнее в [docs/flat_payload_spec.md](./docs/flat_payload_spec.md).

## Wildcard и агрегации

В поле правила можно использовать `[*]` для применения проверки ко всем элементам массива. Поддерживается **любое количество `[*]`** — в том числе вложенные массивы:

```json
{
  "field": "accounts[*].transactions[*].amount",
  "operator": "greater_than",
  "value": 0
}
```

Режимы агрегации: `EACH` (default), `ALL`, `COUNT`, `MIN`, `MAX`.

Подробнее в [docs/wildcart.md](./docs/wildcart.md).

## Артефакты

Подробная документация по написанию правил в [docs/how to rule.md](./docs/how%20to%20rule.md).  
Структура папок и правила видимости в [docs/rules structure.md](./docs/rules%20structure.md).

### Rule

Атомарная проверка одного поля.

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
  "message": "Сумма заказа должна быть больше нуля"
}
```

Для `role: "check"` обязательны `level`, `code`, `message`.  
Для `role: "predicate"` эти поля **запрещены**.

### Condition

Выполняет `steps` только если `when` истинно.

```json
{
  "id": "checkout_main.threeds_validate.condition_3ds_required",
  "type": "condition",
  "description": "3DS-проверки только если threeDS.requested=true",
  "when": "pred_is_3ds_required",
  "steps": [{ "rule": "rule_3ds_method_required" }]
}
```

`when` поддерживает: одиночный предикат и массив в формате `{ "all": [...] }`, `{ "any": [...] }`.

### Pipeline

Последовательность шагов. Шаги: `{ "rule" }`, `{ "condition" }`, `{ "pipeline" }`.

`strict: true` — если внутри появилась хотя бы одна ERROR/EXCEPTION, движок добавляет итоговый EXCEPTION и останавливает выполнение. Используется для логических границ: блок документов, FATCA, риск-проверки.

### Dictionary

Справочник для оператора `in_dictionary`. Глобально доступен из любого правила.

```json
{
  "id": "currencies_supported",
  "type": "dictionary",
  "description": "Поддерживаемые валюты",
  "entries": ["RUB", "USD", "EUR", "CNY"]
}
```

## Операторы

### check

| Оператор                                                                                               | Параметры                | Описание                                               |
| ------------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------ |
| `not_empty`                                                                                            | —                        | поле заполнено                                         |
| `is_empty`                                                                                             | —                        | поле пустое                                            |
| `equals` / `not_equals`                                                                                | `value`                  | строгое равенство                                      |
| `contains`                                                                                             | `value`                  | строка содержит подстроку                              |
| `matches_regex`                                                                                        | `value`                  | соответствует regex                                    |
| `greater_than` / `less_than`                                                                           | `value`                  | числа и даты `YYYY-MM-DD`                              |
| `field_greater_than_field` / `field_less_than_field` / `field_equals_field` / `field_not_equals_field` | `value_field`            | сравнение двух полей payload                           |
| `length_equals` / `length_max`                                                                         | `value`                  | длина строки                                           |
| `in_dictionary`                                                                                        | `dictionary: {type, id}` | значение есть в справочнике                            |
| `any_filled`                                                                                           | `paths[]`                | хотя бы одно из полей заполнено                        |
| `valid_inn`                                                                                            | —                        | контрольный разряд ИНН (10 или 12 цифр)                |
| `valid_ogrn`                                                                                           | —                        | контрольный разряд ОГРН (13 цифр) или ОГРНИП (15 цифр) |

### predicate

Подмножество check-операторов без `valid_inn`, `valid_ogrn`, `any_filled`, `length_*`.

## Уровни ошибок

| level       | Поведение                                       |
| ----------- | ----------------------------------------------- |
| `WARNING`   | накапливается в issues, выполнение продолжается |
| `ERROR`     | накапливается в issues, выполнение продолжается |
| `EXCEPTION` | немедленно останавливает выполнение             |

## Результат выполнения

| Поле      | Значения                       | Описание                          |
| --------- | ------------------------------ | --------------------------------- |
| `status`  | `OK` \| `EXCEPTION` \| `ABORT` | итог выполнения                   |
| `control` | `CONTINUE` \| `STOP`           | внутренний сигнал                 |
| `issues`  | array                          | найденные проблемы                |
| `trace`   | array                          | трассировка (включить: `TRACE=1`) |

## Сборка и деплой

### Снэпшот

Снэпшот - единственный JSON-файл со всеми скомпилированными артефактами. Сервер в production или test окружении загрузит его при старте. Компиляция происходит при сборке, на сервер попадают только валидные правила.

```bash
node tools/build-snapshot.js \
  --version 1.2.0 \
  --author analyst@bank.ru \
  --description "Добавлена проверка мерчантов" \
  --pretty
```

Если правила содержат ошибки, то снэпшот не создаётся и выводится полный список всех проблем собранных за один прогон:

```
[build-snapshot] COMPILATION ERROR — snapshot NOT saved
[build-snapshot] 2 error(s) found:

  1. Check rule checkout_main.rule_amount (...): level must be WARNING|ERROR|EXCEPTION
  2. Duplicate check code "ERR_AMOUNT": conflict with refunds.rule_amount
```

### Режимы запуска

Режим определяется через `NODE_ENV`:

| NODE_ENV                | Источник правил | Поведение при старте                       |
| ----------------------- | --------------- | ------------------------------------------ |
| `development` (default) | `./rules` (fs)  | сканирует папку, запускает hot-reload      |
| `production` / `test`   | `SNAPSHOT_PATH` | грузит снэпшот, без `SNAPSHOT_PATH` падает |

```bash
# development
node server.js

# production
NODE_ENV=production SNAPSHOT_PATH=./snapshot.json node server.js

# test / canary
NODE_ENV=test SNAPSHOT_PATH=./snapshots/v2.json PORT=3001 node server.js
```

### Hot-reload (dev-режим)

В dev-режиме сервер следит за изменениями `*.json` в `RULES_DIR`. При сохранении файла — пересобирает правила без перезапуска:

```
[hot-reload] changed: pipelines/checkout_main/base_validate/rule_amount.json
[hot-reload] recompiling...
[hot-reload] OK — 52 artifacts loaded
```

Если новые правила не компилируются, то сервер продолжит работать со старой версией и выводит все ошибки в консоль.

### Canary и версионирование

Движок stateless, каждый инстанс несёт один снэпшот. Для canary достаточно поднять отдельный инстанс с новым снэпшотом и переключить на него часть трафика на уровне роутера. Rollback — вернуть предыдущий снэпшот.

```
клиент ──┬── 90% ──→ instance-v1 (stable)
         └── 10% ──→ instance-v2 (canary)
```

---

## Использование как библиотека

```js
const { createEngine } = require("./lib");
const { loadArtifactsFromDir } = require("./lib/loader-fs");
const { Operators } = require("./lib/operators");

const { artifacts, sources } = loadArtifactsFromDir("./rules");
const engine = createEngine({ operators: Operators });
const compiled = engine.compile(artifacts, { sources });

const result = engine.runPipeline(compiled, "checkout_main", {
  ...payload,
  __context: context, // зарезервированный ключ — контекст внутри движка
});
```

---

## Документация

| Документ                                                 | Описание                                                |
| -------------------------------------------------------- | ------------------------------------------------------- |
| [docs/how to rule.md](./docs/how%20to%20rule.md)         | Как писать правила: пошаговое руководство для аналитика |
| [docs/rules structure.md](./docs/rules%20structure.md)   | Структура папок, правила видимости, формирование id     |
| [docs/flat_payload_spec.md](./docs/flat_payload_spec.md) | Форматы входных данных: JSON и flat-map                 |
| [docs/wildcart.md](./docs/wildcart.md)                   | Wildcard `[*]`, вложенные массивы, режимы агрегации     |
| [docs/todo.md](./docs/todo.md)                           | План развития                                           |
