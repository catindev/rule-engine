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

// Tabs
document.addEventListener('click', function (e) {
  var btn = e.target.closest('.tab-btn');
  if (!btn) return;
  var tab = btn.dataset.tab;
  var container = btn.closest('.main');

  container.querySelectorAll('.tab-btn').forEach(function (b) {
    b.classList.toggle('tab-btn--active', b.dataset.tab === tab);
  });
  container.querySelectorAll('.tab-pane').forEach(function (p) {
    p.classList.toggle('tab-pane--active', p.id === 'tab-' + tab);
  });
});
