/**
 * Compilation context — инкапсулирует sources для диагностических сообщений.
 *
 * Вместо глобальной переменной уровня модуля предоставляет явный контекст,
 * который создаётся на время одного вызова compile() и передаётся явно.
 * Это устраняет состояние гонки при гипотетических параллельных компиляциях
 * и гарантирует очистку через паттерн try/finally в index.js.
 */

function createContext(sources) {
  const src = sources instanceof Map ? sources : null;

  function fileOf(id) {
    if (!src || !id) return "<unknown source>";
    const meta = src.get(id);
    return meta && meta.file ? meta.file : "<unknown source>";
  }

  function where(a) {
    const id = a && a.id ? a.id : "<unknown id>";
    return `${id} (${fileOf(id)})`;
  }

  return { fileOf, where, sources: src };
}

module.exports = { createContext };
