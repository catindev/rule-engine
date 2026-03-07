# Работа с массивами и wildcard [*]

## Общая идея

Движок использует **flat-map модель payload**: все данные представлены как плоский набор ключей `key → value`. Вложенный JSON автоматически конвертируется при входе — см. [flat_payload_spec.md](./flat_payload_spec.md).

Чтобы писать правила для массивов используется специальный шаблон **wildcard `[*]`**.

## Wildcard [*]

Wildcard используется в поле `field` правила и означает:

> применить правило ко всем элементам массива.

Пример:

```
field: "checkout.items[*].qty"
```

Этот шаблон совпадёт с ключами:

```
checkout.items[0].qty
checkout.items[1].qty
checkout.items[2].qty
```

Движок автоматически расширяет wildcard и выполняет правило для каждого совпавшего поля.

## Вложенные массивы — несколько [*]

Поддерживается **любое количество `[*]`** в одном поле. Это позволяет писать правила для двух и более уровней вложенных массивов:

```json
{
  "field": "accounts[*].transactions[*].amount",
  "operator": "greater_than",
  "value": 0
}
```

Такой паттерн совпадёт со всеми комбинациями:

```
accounts[0].transactions[0].amount
accounts[0].transactions[1].amount
accounts[1].transactions[0].amount
...
```

Сортировка результатов — лексикографическая по индексам слева направо (внешний индекс первый).

## Полный путь обязателен

Wildcard сопоставляется с ключами по **точному совпадению** префикса и суффикса.

```
items[*].qty
```

НЕ совпадёт с:

```
checkout.items[0].qty
```

Всегда указывайте полный путь:

```
checkout.items[*].qty
```

**Важно:** если структура payload изменится (например `checkout.items` переименуют в `items`), wildcard просто не найдёт ни одного поля и тихо пройдёт. Чтобы защититься от этого — добавьте перед wildcard-правилом проверку наличия родительского поля с уровнем EXCEPTION. Тогда при изменении контракта вы получите явную ошибку вместо молчаливого игнорирования.

## Проверка каждого элемента (режим EACH)

По умолчанию check-rules работают в режиме **EACH**: правило применяется к каждому элементу и issue создаётся для каждого провалившегося.

```json
{
  "type": "rule",
  "role": "check",
  "field": "checkout.items[*].qty",
  "operator": "greater_than",
  "value": 0,
  "level": "ERROR",
  "code": "ITEM_QTY_INVALID",
  "message": "Количество товара должно быть больше 0"
}
```

В `issues` будет точный ключ провалившегося элемента:

```json
{
  "field": "checkout.items[1].qty",
  "actual": 0,
  "meta": { "pattern": "checkout.items[*].qty" }
}
```

## Агрегация результатов

Для wildcard-правил можно указать блок `aggregate`:

```json
"aggregate": { "mode": "ALL" }
```

Поддерживаемые режимы:

| mode  | описание                                           |
| ----- | -------------------------------------------------- |
| EACH  | проверять каждый элемент отдельно (по умолчанию)   |
| ALL   | все элементы должны пройти проверку                |
| COUNT | проверка количества элементов прошедших правило    |
| MIN   | агрегировать минимальное значение и проверить его  |
| MAX   | агрегировать максимальное значение и проверить его |

### COUNT

```json
{
  "field": "checkout.items[*].qty",
  "operator": "greater_than",
  "value": 5,
  "aggregate": { "mode": "COUNT", "op": ">=", "value": 2 }
}
```

Семантика: "минимум два товара имеют qty > 5".

### MIN / MAX

```json
{
  "field": "checkout.items[*].qty",
  "operator": "greater_than",
  "value": 0,
  "aggregate": { "mode": "MIN" }
}
```

Семантика: `min(items.qty) > 0`.

## Политика для пустого массива

Если wildcard не нашёл ни одного поля, используется параметр `onEmpty`:

```json
"aggregate": { "mode": "ALL", "onEmpty": "PASS" }
```

| значение  | поведение                                             |
| --------- | ----------------------------------------------------- |
| PASS      | правило считается пройденным (по умолчанию для check) |
| FAIL      | правило считается проваленным                         |
| TRUE      | predicate = TRUE (по умолчанию для predicate)         |
| FALSE     | predicate = FALSE                                     |
| UNDEFINED | результат неопределён                                 |
| ERROR     | генерируется ошибка выполнения                        |

## Trace выполнения wildcard

При включённом `TRACE=1` движок добавляет в ответ сводную запись о каждом wildcard-правиле:

```json
{
  "message": "wildcard aggregate",
  "data": {
    "patternField": "checkout.items[*].qty",
    "aggregateMode": "MAX",
    "matchedCount": 3,
    "matchedSample": [
      "checkout.items[0].qty",
      "checkout.items[1].qty",
      "checkout.items[2].qty"
    ],
    "pickedField": "checkout.items[1].qty",
    "pickedValue": 101,
    "result": "FAIL"
  }
}
```

Отфильтровать только wildcard-записи:

```bash
TRACE=1 curl -s -X POST http://localhost:3000/v1/validate \
  -H 'Content-Type: application/json' -d @payload.json \
  | jq '.trace[] | select(.message=="wildcard aggregate")'
```

Поле `matchedCount` позволяет убедиться что правило применилось ко всем элементам массива.
