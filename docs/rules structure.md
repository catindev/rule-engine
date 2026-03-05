# Структура файлов и папок

```
rules/
 library/
      rule1.json          // подключается { rule: "library.rule1" }
      condition1.json     // подключается { condition: "library.condition1" }
      pipeline1.json      // подключается { pipeline: "library.pipeline1" }
      folder/
        rule1.json        // подключается { rule: "library.folder.rule1" }
        condition1.json   // подключается { condition: "library.folder.condition1" }
        pipeline1.json    // подключается { pipeline: "library.folder.pipeline1" }
  dictionaries/
    dictionary1.json      // доступен в любом правиле подключаемом в любом пайплайне или в библиотеке на любом уровне вложенности (глобальная доступность)
    folder/
      dictionary2.json    // так же глобально доступен во всех правилах. подключается как "folder.dictionary2"
  pipelines/            // теперь во множественном числе
    <pipelineId>/
      pipeline.json     // главный пайплайн для pipelineId
      rule11.json       // правило доступно только для pipelineId
      condition11.json  // условие доступно только для pipelineId
      <nestedPipelineId>/
        pipeline.json             // главный пайплайн для nestedPipelineId
        rule22.json               // правило доступно только для nestedPipelineId
        condition22.json          // условие доступно только для nestedPipelineId
        <subNestedPipelineId>/
          pipeline.json             // главный пайплайн для subNestedPipelineId
          rule33.json               // правило доступно только для subNestedPipelineId
          condition33.json          // условие доступно только для subNestedPipelineId
```

Как это работает:

- Пайплайн `rules/library/pipeline1.json` может подключать только правила и условия из папки `rules/library/`
- Пайплайн `rules/library/folder/pipeline1.json` может подключать только правила и условия из папки `rules/library/folder/`
- Пайплайны из библиотеки или из папки в библиотеке не могут содержать вложенных пайплайнов
- Пайплайны в папке `rules/pipelines` могут вкладываться в друг друга. Движок рекурсивно пробегает по ним и строит вложеннусю структуру из пайплайнов
- Пайплайн `rules/pipelines/<pipelineId>` может подключать правила, условия и пайплайны только лежащие либо в его папке либо в библиотеке
- Никаких подпапок для разделения правил, условий и пайплайнов больше не используется
- Правила и условия из вложенных пайплайнов доступны только этим пайплайнам и "не видны" пайплайнам-родителям и пайплайнам-потомкам
- Для переиспользования правил используется библиотека
- Для отделения и группировки по смыслу правил, условий и пайплайнов в библиотеке использутся обычные папки
