# Структура файлов и папок

```
rules/
  library/
    rule1.json          // подключается как { rule: "library.rule1" }
    condition1.json     // подключается как { condition: "library.condition1" }
    pipeline1.json      // подключается как { pipeline: "library.pipeline1" }
    folder/
      rule1.json        // подключается как { rule: "library.folder.rule1" }
      condition1.json   // подключается как { condition: "library.folder.condition1" }
      pipeline1.json    // подключается как { pipeline: "library.folder.pipeline1" }
  dictionaries/
    dictionary1.json    // глобально доступен во всех правилах
    folder/
      dictionary2.json  // глобально доступен, подключается как "folder.dictionary2"
  pipelines/
    <pipelineId>/
      pipeline.json           // главный пайплайн
      rule11.json             // правило доступно только для pipelineId
      condition11.json        // условие доступно только для pipelineId
      <nestedPipelineId>/
        pipeline.json         // вложенный пайплайн
        rule22.json           // правило доступно только для nestedPipelineId
        condition22.json      // условие доступно только для nestedPipelineId
        <subNestedPipelineId>/
          pipeline.json
          rule33.json
          condition33.json
```

## Правила видимости

- Правила и условия видны только в своём пайплайне или в `library.*`
- Пайплайны из `library/` не могут содержать вложенных пайплайнов
- Пайплайн может вызывать любой другой пайплайн по полному id
- Словари глобально доступны на любом уровне вложенности
- Правила вложенных пайплайнов не видны ни родителям, ни потомкам — только своему пайплайну
- Для переиспользования правил используется `library/`
- Папки внутри `library/` используются для группировки по смыслу

## Идентификаторы

id артефакта формируется автоматически из пути файла относительно `rules/`:

```
rules/pipelines/checkout_main/base_validate/rule_amount.json
→ id: "checkout_main.base_validate.rule_amount"

rules/library/common/email_format.json
→ id: "library.common.email_format"
```

В файле поле `id` можно не указывать - движок проставит его сам при загрузке.
