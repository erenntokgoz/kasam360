// 360 Labs sol menüsü tek yerden çizilir; her sayfa yalnız <aside class="rail" data-page="..."> bırakır.
// Önce ürün (KASAM360), sonra o ürünün kayıtları. Sayılar örnek fixture'dır.
(function () {
  var NAV = [
    ['inbox', 'labs-inbox.html', 'Gelen kutusu', '7', 'hot'],
    ['businesses', 'labs-businesses.html', 'İşletmeler', '42'],
    ['accounts', 'labs-accounts.html', 'Hesaplar', '51'],
    ['packages', 'labs-package.html', 'Paketler', '2'],
    ['payments', 'labs-payments.html', 'Ödemeler', ''],
    ['devices', 'labs-devices.html', 'Cihazlar', '2', 'hot'],
    null,
    ['updates', 'labs-updates.html', 'Güncellemeler', ''],
    ['events', 'labs-events.html', 'Olay kaydı', ''],
    ['settings', 'labs-settings.html', 'Teknik ayarlar', ''],
  ];
  var LOGO = '../../../../desktop/src/assets/brand/kasam360-ikon-kucuk-renkli.svg';
  document.querySelectorAll('aside.rail[data-page]').forEach(function (rail) {
    var page = rail.dataset.page;
    var links = NAV.map(function (n) {
      if (!n) return '<span class="gap"></span>';
      var cur = n[0] === page ? ' aria-current="page"' : '';
      var count = n[3] ? '<span class="count num' + (n[4] ? '' : ' mute') + '">' + n[3] + '</span>' : '';
      return '<a href="' + n[1] + '"' + cur + '>' + n[2] + count + '</a>';
    }).join('');
    rail.innerHTML =
      '<div class="org">360 Labs</div>' +
      '<div class="switcher"><button class="product" aria-haspopup="menu" aria-expanded="false"><img src="' + LOGO + '" alt=""><span><b>KASAM360</b><small>Ürün değiştir</small></span></button>' +
      '<div class="menu" role="menu" hidden><button role="menuitem" aria-current="true"><img src="' + LOGO + '" alt="">KASAM360<span class="muted">Şu an</span></button><button role="menuitem">Ürün ekle</button></div></div>' +
      '<nav aria-label="KASAM360">' + links + '</nav>' +
      '<div class="me">Mert D.<button class="btn btn-ghost" data-theme-toggle>Tema</button></div>';
    var btn = rail.querySelector('.product'), menu = rail.querySelector('.menu');
    btn.addEventListener('click', function () { var open = menu.hidden; menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  });
  // Kaydırılabilir tablolar: devamı varken sağ kenarda gölge.
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.tbl').forEach(function (t) {
      var upd = function () { t.classList.toggle('more', t.scrollLeft + t.clientWidth < t.scrollWidth - 1); };
      t.addEventListener('scroll', upd, { passive: true }); window.addEventListener('resize', upd); upd();
    });
  });
})();
