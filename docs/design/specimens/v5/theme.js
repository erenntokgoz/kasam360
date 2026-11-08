// Tema sırası: adres (?theme=), kullanıcının son seçimi, işletim sistemi. 3D sahne 'themechange' olayını dinler.
(function () {
  var root = document.documentElement;
  var stored = null;
  try { stored = localStorage.getItem('k360-theme'); } catch (e) { /* gizli pencere: seçim hatırlanmaz */ }
  var param = new URLSearchParams(location.search).get('theme');
  var system = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  root.dataset.theme = param === 'dark' || param === 'light' ? param : stored || system;
  window.setTheme = function (next) {
    root.dataset.theme = next;
    try { localStorage.setItem('k360-theme', next); } catch (e) { /* yok sayılır */ }
    window.dispatchEvent(new CustomEvent('themechange', { detail: next }));
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      b.textContent = next === 'dark' ? 'Açık tema' : 'Koyu tema';
    });
  };
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      b.textContent = root.dataset.theme === 'dark' ? 'Açık tema' : 'Koyu tema';
      b.addEventListener('click', function () { window.setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'); });
    });
  });
})();
