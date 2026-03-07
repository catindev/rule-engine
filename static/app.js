document.addEventListener('DOMContentLoaded', function () {
  // Вешаем обработчик на document и фильтруем по data-accordion
  // чтобы не было проблем с bubbling между вложенными аккордеонами
  document.addEventListener('click', function (e) {
    var header = e.target.closest('[data-accordion]');
    if (!header) return;
    e.stopPropagation();
    var item = header.closest('.flow-item');
    if (item) item.classList.toggle('is-open');
  });
});
