# D02 görsel örnekleri

Durum: **değerlendirmeye hazır, onaylanmadı**. Bunlar ürün kodu değildir. Ekranlar sabit fixture verisi kullanır ve hiçbir işlem yapmaz. Her ekranda "Tasarım örneği · sabit test verisi" etiketi vardır. C01/C02 kontratı varsayılmadı; KDV satırında bu nedenle "C01'de sabitlenecek" yazar.

Açmak için depo kökünden yerel sunucu başlatın (`python -m http.server 4610`) ve `http://127.0.0.1:4610/docs/design/specimens/<dosya>.html` adresine gidin. Koyu tema için adrese `?theme=dark` ekleyin.

## Yedi örnek

| Örnek | Dosya | Kompozisyon | Gösterilen durum |
|---|---|---|---|
| Web ana sayfa + paket | `web-home.html` | İri tipografik giriş; sağda Masa 12 siparişinin masa → mutfak → kasa akışı (bir kez oynayan hareket); tek paket bloğu; üç güven maddesi | Normal |
| Web hesap | `web-account.html` | İşletme seçici + "sonraki adım" şeridi + abonelik/cihaz/fatura bölümleri | Boş cihaz hakkı, fatura okuma hatası |
| Desktop giriş | `desktop-login.html` | Marka alanı yaklaşık %38, form odakta; Google ve e-posta yolu ayrı; parola göster | Sunucu hatası ve alan hatası |
| Kilit | `desktop-lock.html` | İşletme ve personel bağlamı, PIN, 72px tuşlar; "Kilidi aç" ile "Kasayı kapat" ayrı yerlerde | Hatalı PIN, kalan deneme |
| POS | `desktop-pos.html` | Metinli menü + kategori + 32 ürün + sabit genişlikte sipariş paneli, her zaman görünen tahsilat düğmesi | Bağlantı yok, tükenmiş ürün, 7 haneli açık sipariş, mutfak durumları |
| Ürün formu | `desktop-product-form.html` | Solda form, sağda kâr/etki özeti, altta sabit işlem çubuğu | Kaydedilmedi + alan hatası, eksik maliyet ("Hesaplanamıyor") |
| Labs işletme | `labs-business.html` | Kimlik başlığı + durum şeridi + sekmeler + cihaz/ödeme tabloları + zaman çizelgesi | Eşitleme durdu, reddedilen test ödemesi |

## Kanıt

`renders/` klasöründe 21 görüntü var. Adlandırma: `ekran-tema-genişlik`. Masaüstü örnekleri 1280×800'de açık ve koyu temada, POS ayrıca 1024×768'de açık temada alındı. Web ve Labs örnekleri 1440'ta açık ve koyu temada alındı. 390px görüntüleri uygulamanın tarayıcı panelinden alındı, çünkü headless Edge bu genişlikte ekranı daha geniş çizip kırpıyor. Ölçümle doğrulandı: 390px'te `scrollWidth` = 390, yani yatay taşma yok.

Kontrast ölçümü `renders/contrast.txt` dosyasında: 13 renk çifti × 2 tema, 26/26 eşiği geçti (metin 4.5:1, arayüz bileşeni 3:1). Ölçmek için iki başlangıç tokenı değişti: açık temada `border-strong` #9AA8B8 → #7A889A (2.42 → 3.61) ve `accent` #D79A31 → #B07A1C (2.45 → 3.72). Durum rozetlerinin kenarları ve hover renkleri ölçülmedi.

## Değerlendirmede bakılacak açık sorular

1. **Tabular rakamlar:** Schibsted Grotesk'te tabular rakam açıldığında nokta ve virgül de sabit genişliğe geçiyor ("1 . 290 , 00" gibi açık görünüyor). Seçenekler: (a) yalnız hizalı sütunlarda tabular, tek değerlerde orantılı rakam; (b) tutarlar için ikinci bir yazı tipi; (c) olduğu gibi kabul etmek. AGENTS.md tutarlarda `tabular-nums` istediği için karar sizin.
2. **Marka rengi:** Logodaki turuncu (#FF5A1F) yalnız küçük vurgularda kullanıldı, etkileşim rengi mavi (#174EA6). Tek renk ailesi isteniyorsa palet yeniden ölçülecek.
3. **Web başlık dili:** "adisyon" kelimesi tema değil, ürün dili olarak kullanıldı; defter veya kâğıt görseli yok.
4. **Logo testi:** Logoyu kapatınca POS ile Labs'in hâlâ farklı ürünler gibi okunup okunmadığı değerlendirilmeli.

Onaydan sonra D03'e geçilir: tokenlar `desktop/src` ve `web/src` içine tek kaynaktan taşınır. Labs tarafı Codex'in alanında.
