# Как писать валидацию на DSL движке правил

---

## 1. Что это вообще такое?

Этот DSL это способ описывать проверки (валидацию) **в JSON**, без
написания кода.

Вы описываете:

- какие поля обязательны
- какие значения допустимы
- какие проверки включаются при определенных условиях
- в каком порядке выполняются проверки

Движок читает JSON‑файлы и сам выполняет все это. Вам нужно только понимать JSON.

---

# 2. Базовые сущности

В системе есть 3 типа объектов:

Тип Что делает

---

rule Проверяет одно условие
condition Выполняет проверки только если условие истинно
pipeline Последовательность шагов (главный сценарий проверки)

---

# 3. Rule простая проверка

Самая базовая единица правило.

Пример: поле обязательно.

```json
{
  "id": "rule_inn_required",
  "type": "rule",
  "description": "ИНН обязателен",
  "role": "check",
  "operator": "not_empty",
  "level": "ERROR",
  "code": "ERR_INN_REQUIRED",
  "message": "Не указан ИНН",
  "field": "beneficiary.inn"
}
```

Что здесь важно:

- `operator` тип проверки
- `field` какое поле проверяется
- `level` насколько серьезна ошибка

---

# 4. Уровни ошибок

level Что означает

---

WARNING Неприятно, но можно продолжать
ERROR Валидация не прошла
EXCEPTION Останавливает выполнение пайплайна

Важно: ERROR не останавливает проверку. EXCEPTION останавливает.

---

# 5. Основные операторы

operator Что делает

---

not_empty Поле не пустое
equals Равно значению
matches_regex Соответствует регулярному выражению
in_dictionary Значение есть в справочнике
valid_inn Проверка контрольной суммы ИНН
valid_ogrn Проверка ОГРН
any_filled Заполнено хотя бы одно поле

---

# 6. Predicate логическое условие

Predicate это правило, которое возвращает true/false и используется
внутри condition.

```json
{
  "id": "pred_is_foreign_tax_yes",
  "type": "rule",
  "role": "predicate",
  "operator": "equals",
  "field": "tax.foreign",
  "value": true
}
```

У predicate нет level/code/message.

---

# 7. Condition условная логика

Condition включает проверки только если условие выполняется.

```json
{
  "id": "cond_foreign_tax_fields",
  "type": "condition",
  "description": "Если есть иностранное налогообложение",
  "when": { "all": ["pred_is_foreign_tax_yes"] },
  "steps": [
    { "rule": "rule_tax_country_required" },
    { "rule": "rule_tax_tin_required" }
  ]
}
```

when может быть:

```json
{ "all": ["pred1", "pred2"] }
{ "any": ["pred1", "pred2"] }
"pred1"
```

---

# 8. Pipeline сценарий проверки

Pipeline главный сценарий.

```json
{
  "id": "ul_resident_pre_abs",
  "type": "pipeline",
  "description": "ЮЛ резидент до АБС",
  "flow": [
    { "rule": "rule_inn_required" },
    { "condition": "cond_foreign_tax_fields" }
  ]
}
```

Пайплайн это просто список шагов.

---

# 9. Library переиспользуемые правила

Если правило используется в разных пайплайнах, оно кладется в library.

В пайплайне пишется:

```json
{ "rule": "library.inn.checksum" }
```

Это означает: файл лежит в `rules/library/inn/checksum.json`

---

# 10. Структура проекта

    rules/
      pipeline/
        ul_resident_pre_abs/
          pipeline.json
          rules/
          conditions/
      library/
      dictionary/

---

# 11. Как писать новую валидацию (пошагово)

### Шаг 1. Определить обязательные поля

Создаем rule с operator not_empty.

### Шаг 2. Добавить форматные проверки

Например matches_regex или valid_inn.

### Шаг 3. Добавить условные проверки

Создаем predicate → condition → подключаем в pipeline.

### Шаг 4. Добавить правило в pipeline

В нужном порядке.

---

# 12. Как читать диаграмму

Диаграмма PlantUML показывает:

- Красные блоки ERROR
- Желтые WARNING
- Серые predicate
- Жирные красные EXCEPTION
- Голубые library правила
- Разделение по секциям (FATCA, Address, Status и т.д.)

---

# 13. Частые ошибки

Ошибка Причина

---

Missing artifact Неверный id правила
Duplicate id Два файла с одинаковым id
Predicate treated as false Поле отсутствует

---

# 14. Принцип проектирования

1.  Rule атомарная проверка
2.  Condition бизнес‑логика ветвления
3.  Pipeline сценарий
4.  Library переиспользуемое
5.  ERROR копится
6.  EXCEPTION останавливает

---

# 15. Главное правило

Если можно сделать проверку отдельным rule делайте отдельным rule.

Мелкие атомарные правила легче читать, поддерживать и переиспользовать.

---

Готово.
