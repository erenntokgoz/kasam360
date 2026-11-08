# v5: web ve 360 Labs

Durum: **değerlendirmede**. Kapsam yalnız web sitesi, web müşteri hesabı ve 360 Labs; masaüstü uygulaması kapsam dışı. Sayfalar sabit fixture kullanır, işlem yapmaz. Önceki örneklere (v1–v4) dokunulmadı.

Açmak için depo kökünde `python -m http.server 4610` çalıştırın, sonra `http://127.0.0.1:4610/docs/design/specimens/v5/web-home.html` adresini açın. Tema sağ üstteki düğmeyle değişir; adrese `?theme=light` veya `?theme=dark` de eklenebilir. Ana sayfada `?mode=cutaway|stations|order` makineyi o modda açar.

## Ekranlar

| Ekran | Dosya | İçerik |
|---|---|---|
| Ana sayfa | `web-home.html` | Sağda döndürülebilir 3D restoran makinesi, solda başlık. Altında siparişin beş istasyonu (sütuna basınca makine o istasyona döner) ve paket. |
| Müşteri hesabı | `web-account.html` | Kasa yuvaları (dolu kasa, kurulum kodlu boş hak), abonelik, fatura okuma hatası. |
| Labs giriş | `labs-login.html` | E-posta, şifre, doğrulama kodu; hatalı giriş ve kalan deneme. |
| Labs gelen kutusu | `labs-inbox.html` | Kutular, mail listesi, konuşma, ek dosya, yanıt kutusu, sağda işletme bağlamı. "Yeni mail" penceresi (`?compose=1`). |
| Labs işletmeler | `labs-businesses.html` | Filtreler (sorunlu, deneme, ödeme bekleyen, askıda), işletme tablosu, sayfalama. |
| Labs işletme | `labs-business.html` | Düzenle / askıya al / sil, eşitleme uyarısı, sekmeler, satır işlemli cihaz ve ödeme tabloları, olay geçmişi. |
| Labs hesaplar | `labs-accounts.html` | Doğrulanmamış ve kilitli hesaplar; düzenleme çekmecesi; e-posta yazarak onaylanan silme penceresi (`?confirm=1`). |
| Labs paket | `labs-package.html` | Paket = özellik seti: ad, fiyat, kasa hakkı, 11 özellik bayrağı, kaydedilmemiş değişiklik, kullanılan paket silinemez. |
| Labs ödemeler | `labs-payments.html` | Test modu şeridi, ay özeti (aynı listeden toplanır), sonuç filtreleri, iade. |
| Labs cihazlar | `labs-devices.html` | Bütün kasalar: eşitleme, sürüm, lisans durumu; eşitleme kaydı isteme, güncellemeye zorlama, hakkı geri alma. |
| Labs güncellemeler | `labs-updates.html` | Sürümler, kasaların sürüm dağılımı (14 + 38 + 6 = 58), kademeli dağıtım oranı, durdurma, sürüm notu. |
| Labs olay kaydı | `labs-events.html` | Değiştirilemez kayıt; kaynak filtresi; açılan satırda cihaz ve sunucu saati, kayıt özeti. |
| Labs teknik ayarlar | `labs-settings.html` | Ödeme sağlayıcısı (test modu, maskeli anahtar, webhook), paket eşlemesi, mail, lisans imza anahtarı, Labs kullanıcıları. |
| Labs durumları | `labs-states.html` | Boş gelen kutusu, yükleniyor iskeleti, sunucuya ulaşılamadı (son veri saatiyle), yetkisiz. |

Labs sol menüsü `labs-shell.js` dosyasından tek yerden çizilir; ürün seçici menüsü de oradadır. Örnek veri sayfalar arasında tutarlı: TEST_A Lokanta'nın Kasa 1 sorunu gelen kutusunda, işletmede, cihazlarda ve olay kaydında aynı saat ve nedenle görünür.

## 3D restoran makinesi

Kullanıcının verdiği three.js "Agentic Factory" sahnesinden uyarlandı. Plaka, bant, kesit ve istasyon açılımı mantığı korundu; beş istasyon restorana çevrildi:

1. **Salon:** masa, dört sandalye, salon terminali. Masadan adisyon kalkar.
2. **Mutfak:** ocak, tencereler, buhar, davlumbaz, süre sayan mutfak ekranı.
3. **Depo:** raf ve sandıklar. En eski parti (Lot A) önce dışarı kayar (FIFO).
4. **Kasa:** tezgâh, ekran, tuş takımı, çekmece, fiş ve düşen lira.
5. **Bulut:** sunucu ve anten halkaları. Çevrimdışıyken turuncu "2 kayıt sırada", eşitlenince yeşil.

Bant üstündeki kart istasyon geçtikçe yüz değiştirir: adisyon → tabak → stok kaydı → fiş → eşitleme kaydı. "Bir sipariş" modu Masa 12'yi kamerayla izler. Bütün tutarlar tek fixture'dan hesaplanır ve tutmazsa sahne çizilmez: 4 × 125,00 = 500,00 TL = nakit 200,00 + kart 300,00; FIFO maliyet 2 × 2,00 + 2 × 5,00 = 14,00 TL.

Tema değişince malzeme renkleri, ışık ve gölge birlikte değişir. Açık temada makine paslanmaz çelik, koyu temada gece servisi tonunda. Hareket azaltma açıksa sahne dönmez ve mod geçişleri anında olur.

Dosyalar: `scene-kit.js` (malzeme ve parça yardımcıları), `scene-stations.js` (istasyonlar ve ekran dokuları), `restaurant-scene.js` (kamera, bant, akış, tema), `scene.css` (sahne üstü arayüz).

## Kanıt

`renders/` klasörü: masaüstü görüntüleri headless Edge ile (yazılımsal WebGL), 390px görüntüleri uygulamanın tarayıcı panelinden alındı. 390px'te bütün sayfalarda sayfa genişliği 390; Labs tabloları kendi içinde yana kayıyor.

Headless yazılımsal WebGL saniyede birkaç kare çizebildiği için "Bir sipariş" görüntüsü yolculuğun yalnız ilk adımını gösterir; gerçek tarayıcıda akış 24 saniyede tamamlanır.

## Üretime taşırken

- `three` paketi web projesine yeni bağımlılık olarak eklenmeli (örnekte jsDelivr'den `three@0.170.0` yükleniyor). Bu karar onay ister.
- Sahne Next.js'e bir istemci bileşeni olarak, verilen React sarmalayıcısındaki gibi taşınır.
- Labs ekranları için Codex'ten sözleşme gerekiyor: mail kutuları ve ekler, eşitleme kaydı isteme, cihaza güncelleme zorlama, kademeli dağıtım oranı, lisans imza anahtarı döndürme, Labs kullanıcı yetkileri, hesap silme kuralları. Örneklerde bu davranışlar yalnız görünüm olarak var; hangi kuralın geçerli olduğu (deneme hakkı, imza süresi gibi) varsayılmadı.

## Not: v4 klasörü

`v4/` klasöründeki dosyalar (`pos.html`, `salon.html`, `tahsilat.html`, `kitchen-scene.js`, `panel.css`, `desk.css`, `web-home.html`) başka bir oturumun işi. Bu çalışma sırasında `v4/web-home.html` yanlışlıkla üzerine yazıldı; Claude Code dosya geçmişindeki yedekten bayt bayt aynı haliyle geri yüklendi.
