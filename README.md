# DSL-движок валидации (прототип)

Это прототип движка правил для валидации JSON-пэйлоадов через набор декларативных артефактов (rules/conditions/pipelines/predicates).

Идея:

- **Rule** описывает одну проверку поля (оператор, поле, ожидаемое значение/регэксп/словарь, текст ошибки и т.п.).
- **Predicate** (предикат) булева проверка, которую можно использовать в `when` у условий.
- **Condition** ветка `if/else`: если предикат `true`, выполняем `steps`.
- **Pipeline** последовательность шагов (`rule | condition | pipeline`), которую можно импортировать в другой pipeline.

Движок:

1. загружает артефакты из `rules/**`,
2. компилирует их в единый registry,
3. исполняет выбранный pipeline для указанного payload,
4. возвращает `status`, `issues` и `trace`.

## Быстрый старт

```bash
node server.js
# или
PORT=3001 RULES_DIR=./rules TRACE=1 node server.js
```

Запрос для теста:

```bash
curl -X POST http://localhost:3000/pipeline_main \
  -H "Content-Type: application/json" \
  -d @payloads/checkout.fail.strict.json | jq
```

## Структура правил (файлы)

Движок ожидает дерево вида:

```
rules/
  library/
    rules/
    conditions/
    predicates/
    dictionaries/
  pipeline/
    <pipelineId>/
      pipeline.json
      rules/
      conditions/
      predicates/
      dictionaries/
```

Разрешено ссылаться на артефакты:

- локально: `rule_xxx` / `cond_xxx` / `pred_xxx`
- из библиотеки: `library.inn.checksum` и т.п.

Примечание: **id артефакта должен быть уникален** (на уровне всего registry).

## Артефакты

### Rule

Минимальная идея: проверь поле оператором, а если не прошло добавь issue.

Схема (упрощенно):

- `id` уникальный идентификатор
- `type: "rule"`
- `description` опционально
- `field` путь до поля в payload (dot-notation)
- `operator` имя оператора (например `not_empty`, `matches_regex`, `equals`)
- `expected` опционально (зависит от оператора)
- `level` `ERROR | WARNING | EXCEPTION` (что добавляем в issues)
- `code` машинный код ошибки
- `message` человекочитаемое сообщение

### Predicate

Булево выражение для `when` в Condition.

Схема (упрощенно):

- `id`
- `type: "predicate"`
- `field` / `operator` / `expected` (как у rule)

### Condition

Ветка `if`.

Схема (упрощенно):

- `id`
- `type: "condition"`
- `description` опционально
- `when` ссылка на predicate (`pred_xxx` или `library.xxx`)
- `steps` массив шагов (rule/condition/pipeline)

### Pipeline

Последовательность шагов.

Схема (упрощенно):

- `id`
- `type: "pipeline"`
- `description` опционально
- `strict` **обязательный** boolean (`true` или `false`)
- `message` сообщение для strict-исключения (обязательно при `strict: true`)
- `strictCode` код strict-исключения (опционально, по умолчанию `STRICT_PIPELINE_FAILED`)
- `flow` массив шагов

#### Strict pipelines (строгий режим)

Если pipeline помечен как:

```json
{
  "type": "pipeline",
  "strict": true,
  "message": "Найдены ошибки при проверке документов",
  "strictCode": "STRICT_PIPELINE_FAILED",
  "flow": [ ... ]
}
```

то после выполнения `flow` движок проверит: появились ли внутри этого pipeline **хотя бы одна** issue уровня `ERROR` или `EXCEPTION`.

Если да движок добавит _boundary issue_:

- `level: "EXCEPTION"`
- `code: strictCode || "STRICT_PIPELINE_FAILED"`
- `message: pipeline.message`
- `ruleId: "pipeline:<pipelineId>"`
- `pipelineId: <pipelineId>`

и прервет дальнейшее выполнение (control → `STOP`). В результате `status` всего запуска будет `EXCEPTION`.

Зачем:

- можно завернуть набор проверок в импортируемый pipeline и контролировать поток на границе,
- при этом не превращать каждую внутреннюю ошибку в исключение,
- и не терять единый `trace` на уровне главного пайплайна.

Валидация схемы:

- `strict` **обязан быть задан** автором пайплайна (нет неявного дефолта),
- при `strict: true` поле `message` **обязательное**.

## Результат выполнения

CLI возвращает:

- `status`: `OK | EXCEPTION | ABORT`
  - `OK` дошли до конца без stop
  - `EXCEPTION` выполнение остановлено (EXCEPTION-rule или strict boundary)
  - `ABORT` упали с runtime exception (баг/неожиданная ошибка)
- `control`: `CONTINUE | STOP`
- `issues`: массив найденных проблем
- `trace`: техническая трассировка выполнения

## Типовые ошибки компиляции (когда движок ругается)

Это ошибки _в правилах/пайплайнах_, которые ловятся до исполнения.

### Duplicate artifact id

`Duplicate artifact id: <id>`

В `rules/**` нашлись два артефакта с одинаковым id. Нужно переименовать один из них или удалить дубль.

### Missing artifact referenced in condition / when references missing id

Примеры:

- `Condition X: when references missing id Y`
- `Missing artifact referenced in condition:...: rule=...`

В `condition.when` указан предикат, которого нет в registry, или в `condition.steps` указан `rule/condition/pipeline`, которого нет.

### Pipeline strict must be explicitly set

`Pipeline <id>: strict must be explicitly set to true|false`

В пайплайне не указан `strict`. По правилам проекта он должен быть явно задан.

### Pipeline message is required when strict=true

`Pipeline <id>: message is required when strict=true`

При строгом режиме сообщение обязательно.

### Unknown operator

Если rule/predicate ссылается на оператор, которого нет в движке (или опечатка), компиляция упадет.

## PlantUML диаграмма пайплайна

Скрипт генерации диаграммы:

```bash
node scripts/pipeline2puml.js --pipeline ul_resident_pre_abs
```

Скрипт читает pipeline из `rules/`, строит activity-диаграмму PlantUML и сохраняет результат рядом (одноименный `.puml`).
