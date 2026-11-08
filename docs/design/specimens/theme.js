// Örneklerde tema adres satırından seçilir (?theme=dark); böylece aynı dosya iki temada kanıtlanır.
(function () {
  var theme = new URLSearchParams(location.search).get('theme');
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
})();
