/**
 * compiler/context.js
 *
 * Инкапсулирует глобальное состояние compile-сессии.
 *
 * Публичный API:
 *   setContext(sources)   — вызвать в начале compile()
 *   clearContext()        — вызвать в finally compile()
 *   where(artifact)       — "<id> (<file>)" для сообщений об ошибках
 *   fileOf(id)            — путь к файлу артефакта или "<unknown source>"
 */

'use strict';

let _sources = null;

function setContext(sources) {
  _sources = sources instanceof Map ? sources : null;
}

function clearContext() {
  _sources = null;
}

function fileOf(id) {
  if (!_sources || !id) return '<unknown source>';
  const meta = _sources.get(id);
  return meta && meta.file ? meta.file : '<unknown source>';
}

function where(a) {
  const id = a && a.id ? a.id : '<unknown id>';
  return `${id} (${fileOf(id)})`;
}

module.exports = { setContext, clearContext, where, fileOf };
