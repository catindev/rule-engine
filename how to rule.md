# Руководство по использованию движка правил для пользователей

Руководство о том как описывать бизнес‑валидацию в JSON, не изменяя код сервиса.

Главная идея движка:

> Бизнес‑правила описываются аналитиками в DSL, а не реализуются разработчиками в коде.

Это позволяет:

- менять правила без релиза сервиса
- хранить бизнес‑логику в JSON‑артефактах
- делать проверки прозрачными и трассируемыми
- уменьшать нагрузку на разработчиков

# Зачем нужен DSL

Обычный сценарий разработки:

1. аналитик формулирует правило, согласовывает описание
2. разработчик пишет код, проходит ревью
3. релиз согласовывается, сервис пересобирается
4. если правило меняется, то всё повторяется снова

И это всё даже не продакшен, а обычный тестовый контур.. DSL решает эту проблему.

Аналитик сразу описывает правило в такой схеме:

```json
{
  "operator": "not_empty",
  "field": "customer.email"
}
```

Движок выполняет проверку формируя код для нее вместо разработчика.

# Основные сущности DSL

| Тип       | Назначение          |
| --------- | ------------------- |
| rule      | атомарная проверка  |
| predicate | логическое условие  |
| condition | условная логика     |
| pipeline  | сценарий выполнения |

---

# Структура проекта

Пример структуры каталога правил:

```
rules/

  pipelines/
    checkout/
      pipeline.json
      rule_email_required.json
      rule_email_format.json
      rule_phone_required.json
      cond_foreign_customer.json

  library/
    email/
      email_format.json

  dictionary/
    countries.json
    currencies.json
```

Что где лежит:

| Каталог           | Назначение                             |
| ----------------- | -------------------------------------- |
| pipelines         | сценарии проверок                      |
| pipeline/checkout | локальные правила конкретного pipeline |
| library           | переиспользуемые правила               |
| dictionary        | справочники значений для правил        |

# Rule (атомарная проверка)

Rule это самая маленькая единица проверки.

Пример: email обязателен.

```json
{
  "id": "rule_email_required",
  "type": "rule",
  "role": "check",
  "operator": "not_empty",
  "field": "customer.email",
  "level": "ERROR",
  "code": "EMAIL_REQUIRED",
  "message": "Email обязателен"
}
```

# Predicate (логическое условие)

Predicate возвращает **true** или **false**.

Используется для ветвления логики.

```json
{
  "id": "pred_is_foreign",
  "type": "rule",
  "role": "predicate",
  "operator": "equals",
  "field": "customer.country",
  "value": "DE"
}
```

# Condition (условное выполнение)

Condition выполняет шаги (steps) только если predicate вернул true.

```json
{
  "id": "cond_foreign_customer",
  "type": "condition",
  "when": {
    "all": ["pred_is_foreign"]
  },
  "steps": [{ "rule": "rule_passport_required" }]
}
```

# Pipeline (сценарий проверки)

Pipeline объединяет все проверки в последовательность.

```json
{
  "id": "checkout_validation",
  "type": "pipeline",
  "strict": false,
  "flow": [
    { "rule": "rule_email_required" },
    { "condition": "cond_foreign_customer" }
  ]
}
```

# Library (переиспользуемые правила)

Library содержит правила, которые используются в разных pipeline.

Пример:

```
rules/library/email/email_format.json
```

```json
{
  "id": "library.email.format",
  "type": "rule",
  "role": "check",
  "operator": "matches_regex",
  "field": "customer.email",
  "value": "^[^@]+@[^@]+$",
  "level": "ERROR",
  "code": "EMAIL_INVALID",
  "message": "Некорректный email"
}
```

Подключение:

```json
{ "rule": "library.email.format" }
```

# Dictionaries (справочники)

Справочники используются оператором `in_dictionary`.

Пример dictionary:

```
rules/dictionary/countries.json
```

```json
["DE", "FR", "IT", "ES"]
```

Rule:

```json
{
  "operator": "in_dictionary",
  "field": "customer.country",
  "dictionary": "countries"
}
```

# 10. Scoping

Scope показывает **где выполняется правило**.

Примеры scope:

```
pipeline:checkout
condition:checkout.cond_foreign
pipeline:checkout:steps
```

Это важно для:

- trace
- диагностики
- понимания контекста выполнения

---

# 11. Trace выполнения

Trace позволяет увидеть **как движок исполнил правила**.

Запуск сервера:

```bash
TRACE=1 node server.js
```

Ответ будет содержать:

```json
"trace": []
```

Trace показывает:

- какие правила выполнялись
- какие условия сработали
- какие значения были проверены

---

# 12. Бизнес‑кейс: интернет‑магазин

Представим задачу.

Аналитик должен описать правила проверки заказа:

1. email обязателен
2. телефон обязателен
3. если клиент иностранный → нужен паспорт
4. валюта заказа должна быть из списка
5. количество товаров не должно превышать лимит

Раньше для этого нужен разработчик.

Теперь аналитик пишет DSL.

---

## Правило email

```json
{
  "id": "rule_email_required",
  "type": "rule",
  "role": "check",
  "operator": "not_empty",
  "field": "customer.email",
  "level": "ERROR",
  "code": "EMAIL_REQUIRED",
  "message": "Email обязателен"
}
```

---

## Проверка валюты

```json
{
  "id": "rule_currency_valid",
  "type": "rule",
  "role": "check",
  "operator": "in_dictionary",
  "field": "order.currency",
  "dictionary": "currencies",
  "level": "ERROR",
  "code": "CURRENCY_INVALID"
}
```

---

## Условие иностранного клиента

Predicate:

```json
{
  "id": "pred_foreign_customer",
  "type": "rule",
  "role": "predicate",
  "operator": "not_equals",
  "field": "customer.country",
  "value": "RU"
}
```

Condition:

```json
{
  "id": "cond_foreign_passport",
  "type": "condition",
  "when": { "all": ["pred_foreign_customer"] },
  "steps": [{ "rule": "rule_passport_required" }]
}
```

---

## Pipeline заказа

```json
{
  "id": "checkout",
  "type": "pipeline",
  "strict": false,
  "flow": [
    { "rule": "rule_email_required" },
    { "rule": "rule_phone_required" },
    { "rule": "rule_currency_valid" },
    { "condition": "cond_foreign_passport" }
  ]
}
```

---

# 13. Что получает аналитик

DSL даёт:

✔ контроль над правилами

✔ возможность быстро менять бизнес‑логику

✔ прозрачность выполнения

✔ trace диагностику

✔ отсутствие зависимости от разработчиков

---

# 14. Принципы проектирования

1. правила должны быть атомарными
2. условия должны быть простыми
3. pipeline должен отражать бизнес‑процесс
4. library использовать для повторяющихся правил

---

# 15. Главное правило

> Если правило можно вынести в отдельный rule — выносите.

Это делает систему:

- проще
- прозрачнее
- безопаснее
