/**
 * compiler/compilation-error.js
 *
 * Ошибка компиляции с полным списком проблем.
 * Бросается один раз в конце каждой фазы если фаза нашла хотя бы одну ошибку.
 *
 * Используется в:
 *   - build-snapshot.js (вывод всех ошибок пользователю)
 *   - тестах (проверка конкретных ошибок через errors[])
 */

'use strict';

class CompilationError extends Error {
  /**
   * @param {string[]} errors — список сообщений об ошибках
   */
  constructor(errors) {
    const lines = errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n');
    super(`Compilation failed with ${errors.length} error(s):\n${lines}`);
    this.name = 'CompilationError';
    this.errors = errors; // массив строк — для программного доступа
  }
}

module.exports = { CompilationError };
