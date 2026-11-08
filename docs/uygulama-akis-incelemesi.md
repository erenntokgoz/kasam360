# Üç uygulamanın ekran ve akış incelemesi

İnceleme tarihi: 5 Kasım 2026 — yerel geliştirme ortamı.

Bu rapor mevcut uygulamaların bağımsız incelemesidir. Önceki planlar, tamamlanma iddiaları ve eski raporlar doğruluk kanıtı olarak kullanılmadı. Uygulama kodu değiştirilmedi. 6 Kasım 2026'da bu inceleme, aşağıdaki ayrıntılı uygulama planıyla tamamlandı.

## Raporun devamı: yapılacaklar ve uygulama sırası

**İşi devralacak Claude/Codex önce [Ürünü tamamlama ve satışa hazırlama planını](uygulama-tamamlama-plani.md) okumalı.** Bu rapor mevcut durumun kanıt kaydıdır; ana plan ise yeni ürün kararlarını, bağımlılıkları ve tamamlanma koşullarını belirler.

Kullanıcının kesin kararı: **defter/adisyon kâğıdı/el yazısı görsel teması uygulanmayacak.** Önceki tasarım değerlendirmesindeki defter diline dönme iması geri çekildi. Web, desktop ve 360 Labs frontend'leri yeni bir tasarım sistemiyle yeniden kurulacak; mevcut backend'in doğrulanmış iş kuralları korunarak eksikleri tamamlanacak. Sonrasında aynı ürün ailesinde mobil geliştirilecek.

- [Tasarım, kullanıcı hissi ve tüm ekranların görsel kabulü](tasarim-ve-deneyim-plani.md)
- [Ortak veri, ödeme, abonelik, lisans ve backend sözleşmeleri](sozlesmeler-ve-backend-plani.md)
- [360 Labs yönetim, paket, müşteri, gelen kutusu ve güvenlik işleri](labs-tamamlama-plani.md)
- [Yeni web sitesi, müşteri portalı, SEO/GEO ve satın alma akışı](web-tamamlama-plani.md)
- [Desktop giriş/kilit, POS ve tüm yönetim ekranları](desktop-tamamlama-plani.md)
- [Mobil, mağazalar, imzalı yükleyici ve production hazırlığı](mobil-ve-yayin-plani.md)
- [Test matrisi, iş bölümü sınırları ve görev teslim şablonu](kabul-ve-is-devri.md)

Bu planlar uygulanmış iş değildir. B01–B23 bulgularının hangi görev ve testle kapatılacağı kabul belgesinde eşlenmiştir. B23 planın bağımsız kontrolü sırasında yapılan ek kaynak okumasından geldi; fiziksel cihazda yeniden üretilmiş olay değildir. Yeni bulunan eksikler aynı listeye eklenir; aşağıdaki gözlemler tüm hataların bulunduğu iddiası taşımaz.

## Sonuç

Üç uygulamada kullanılabilir parçalar var; ancak müşteri edinme, paket satın alma, lisanslama, cihaz etkinleştirme ve işletme yönetimi henüz tek, tamamlanmış hizmet akışı oluşturmuyor. Mevcut durum üretime hazır kabul edilemez. Öncelikli eksik yeni veritabanı açılması değil, uygulamalar arasındaki sözleşmelerin ve kullanıcıya gösterilen durumların tutarlı hale gelmesidir.

Web sitesi şu anda tanıtım ve hesap açma işini yapıyor. 360 Labs ürün, işletme, destek, posta ve paket yönetiminin bir bölümünü sağlıyor. Masaüstünde geniş bir operasyon arayüzü bulunuyor. Bir ekranın açılması, arkasındaki finansal veya dağıtık işlemin doğrulandığı anlamına gelmiyor.

## İncelemenin kapsamı ve kanıt düzeyi

| İşaret | Anlamı |
|---|---|
| Ekran | Çalışan uygulamada açıldı, görünen durum okundu. |
| Aksiyon | Gezinme, form açma/kapatma, boş form doğrulaması veya geri alınabilir gösterim etkileşimi denendi. |
| Kaynak | Mevcut kaynak dosyaları okunarak saptandı; çalışan sürümde yeniden üretilmiş hata sayılmaz. |
| Bekliyor | İşlemin gerçek sonuçları bu incelemede doğrulanmadı. |

İncelenen ortamlar:

- `360labs`: çalışan Rust uygulaması, `http://localhost:3600`.
- KASAM360 web: `http://localhost:3000`, açık Google hesabı oturumu.
- KASAM360 desktop: açık, yerel Tauri uygulaması, arayüz sürümü `0.2.0`.
- KASAM360 hesap/bulut API: kaynak incelemesi; yerel servis 4000 portunda açık.

Ekranlarda yeni destek mesajı veya e-posta gönderilmedi; paket, hesap, ürün, sipariş, ödeme, stok hareketi ya da personel kaydı oluşturulmadı. Silme, engelleme, anahtar yenileme, yedekten geri yükleme ve gerçek ödeme yapılmadı. Mevcut oturumlar kullanıldı; Google girişinin baştan sona yeni oturumla testi yapılmadı.

Derleme, tam otomatik test paketi, fiziksel yazıcı, ikinci cihaz, gerçek ağ kesintisi ve mobil cihaz testi yapılmadı. Bu rapor ayrıntılı ekran/akış incelemesidir; tüm aksiyonların uçtan uca kabul testi değildir.

## Öncelikli bulgular

Öncelikler: **P0** yayın öncesi engel; **P1** temel akış veya güvenilirlik eksikliği; **P2** kullanım ve sunum sorunu. P0 işareti her zaman veri kaybı yaşandığı anlamına gelmez.

| No | Öncelik | Bulgu | Kanıt ve etkisi |
|---|---|---|---|
| B01 | P0 | Paket → web → satın alma → lisans zinciri tamamlanmamış. | Ekran/Kaynak: Labs paket listesi boş. Web abonelik ekranı sabit “Yakında”; hesap ekranında da aynı ifade var. Webde paket kataloğu veya satın alma akışı yok. |
| B02 | P0 | Çalışan masaüstü bulutla eşit değil. | Ekran: Ayarlar → Bu Cihaz → Cihaz Bağlantıları altında “Lisans reddedildi · 2 işlem bekliyor” ve “Bulut bu lisans anahtarını reddetti.” görüldü. Bu gözlem veri kaybını kanıtlamaz; bulut aktarımının tamamlanmadığını gösterir. |
| B03 | P0 | Lisans zorunluluğu varsayılan olarak açık değil. | Kaynak: `licenseStore.ts` yalnız `VITE_LICENSE_ENFORCED === 'true'` olduğunda lisansı zorunlu tutuyor. Değişken yoksa paket kesişimi atlanıyor. Ekranda Labs hesabı paketsizken POS açık. Üretim derlemesinin bu açıdan doğrulandığına dair kanıt yok. |
| B04 | P0 | Lisans bitişi için web vaadi ile masaüstü davranışı çelişiyor. | Web: açık adisyon kapatma, rapor, yedek ve dışa aktarma açık kalacak deniyor. Kaynak: lisans zorunluyken `App.tsx` kullanılamayan lisansı tüm uygulamayı örten `LicenseGate` ile durduruyor. Ayrı salt okunur/kapanış erişimi görünmüyor. |
| B05 | P0 | Paket hakları tüm erişim yollarında aynı şekilde uygulanmıyor. | Kaynak: KDS menü görünürlüğü özellik bayrağına bağlı; F3 geçişi ve ana içerikte KDS açılması aynı kontrolü taşımıyor. Salon ve Cari girişleri de ortak paket erişim kapısından geçmiyor. Paket kapalı senaryoları ayrıca çalıştırılmalı; mevcut paketsiz ortamda bu bir kaynak bulgusudur. |
| B06 | P0 | Güncelleme ve dağıtım yapılandırması tamamlanmamış. | Kaynak: NSIS hedefi var; updater açık anahtarı `YOUR_UPDATE_PUBLIC_KEY_BASE64`. `lib.rs` içindeki eklenti kaydında updater başlatılması bulunmadı. İmzalı kurulum/güncelleme testi yapılmış sayılmaz. |
| B07 | P1 | Çalışan 360 Labs ile kaynak dosyalar aynı sürüm değil. | Dosya/süreç: exe 05.11.2026 03:14, süreç başlangıcı 03:14; `pages.rs` ve `variants.rs` değişiklikleri 11:01. Kaynakta bulunan Hesabım bağlantısı ve ödeme eşlemesindeki Paket alanı incelenen çalışan ekranda görünmüyor. |
| B08 | P1 | Vardiya durumu ekranlar arasında çelişiyor. | Ekran: sol menü sürekli “Vardiya kapalı”; Kasa → Defter “Vardiya Açık”; Yönetim → Pano da açık gösteriyor. Birden fazla gezinmeden sonra tekrar görüldü. Kök neden bu incelemede kesinleştirilmedi. |
| B09 | P1 | Bulut hatası ortak uyarı akışına taşınmıyor. | Ekran: bulut lisans reddi mevcutken Pano “Şu an bekleyen iş yok” ve yerel eşitleme “Hazır” gösteriyor. Kaynak: sol menü eşitleme göstergesi yerel ağ durumunu izliyor; bulut hatası ayrı ayar ekranında. |
| B10 | P1 | Paket modeli satış kataloğu ihtiyacını karşılamıyor. | Ekran/Kaynak: paket formu ad, cihaz limiti ve özelliklerden oluşuyor. Fiyat, para birimi, dönem, yayımlanma durumu ve müşteri açıklaması burada yok. Ödeme varyant eşlemesi ayrı; web için ortak ticari katalog bulunmuyor. |
| B11 | P1 | Ödeme test ortamı akışı eksik. | Kaynak: Labs `billing.rs` test modundaki abonelik olaylarını doğrudan atlıyor. Bu davranış üretim verisini korur; ancak mevcut uç üzerinden sağlayıcının test olayıyla paket/lisans etkinleşmesini doğrulamak mümkün değil. Ayrı test ortamı sözleşmesi gerekli. |
| B12 | P1 | Web hesabı işletme yönetim paneli değil. | Ekran: profil, hesap silme, çıkış ve destek bağlantısı var. İşletme/cihaz listesi, paket, lisans bitişi, ödeme geçmişi, kurulum indirme ve etkinleştirme durumu yok. Google girişinden sonra kullanıcı hizmeti kullanmaya yönlendirilmiyor. |
| B13 | P1 | QR menü işlevi kullanıcı yoluna bağlı görünmüyor. | Kaynak: `QrMenuPanel` bileşeni var; kaynak taramasında bileşenin başka bir ekran tarafından kullanıldığı bulunmadı. Gezilen Menü/Ayarlar içinde QR menü girişi görülmedi. Web bunu mevcut işlev olarak sunuyor. |
| B14 | P1 | Stok sayımı için görünür işlem yolu eksik. | Ekran: stok sekmeleri Mevcut Stok, Reçeteler, Zayiat ve Fire, Hareketler. Sayım başlatma yolu görülmedi. Kaynakta eski sayım paneli silinmiş; hareket türünde sayım hâlâ var. Web özellik sayfasında sayım mevcut deniyor. |
| B15 | P1 | Merkezi konsol işletmenin operasyon sağlığını bir araya getirmiyor. | Ekran: Labs işletme ayrıntısında hesap, abonelik, cihaz ve olay geçmişi var. Son bulut aktarımı, bekleyen işlem, yedek sağlığı, istemci sürümü ve çözülemeyen çakışmaların ortak görünümü yok. |
| B16 | P1 | Bildirimler yalnız sınırlı bir olay grubunu kapsıyor. | Kaynak: Labs bildirim sunumu yeni destek, müşteri devam mesajı ve doğrulama durumlarına odaklı. Ödeme hatası, lisans bitişi, cihaz sınırı, yedek/bulut arızası için ortak yaşam döngüsü görülmedi. |
| B17 | P2 | Veri olmayan menü analizi teknik hata gibi sunuluyor. | Ekran: Pano “Menü analizi okunamadı” ve “BCG icin en az bir urunun maliyeti bilinmeli” uyarısı gösteriyor. Kullanıcıya hangi ürünün maliyetini tamamlayacağı söylenmiyor. |
| B18 | P2 | Giriş yapılmış web kullanıcısına hâlâ Giriş/Kayıt menüsü gösteriliyor. | Ekran/Kaynak: Hesabım açıkken başlık aynı; kayıt sayfası da açılabiliyor. `SiteHeader` oturum durumuna göre menü değiştirmiyor. |
| B19 | P2 | Yükleme ile boş durum bazı ekranlarda ayrışmıyor. | Ekran/Kaynak: yedek sayfası ilk anda “Henüz yok / Klasör: Okunamadı” gösterdi; yükleme bitince yedekler geldi. Gerçek yedek arızası saptanmadı; ilk gösterim yanıltıcı. |
| B20 | P2 | Uzun ürün formunda temel işlemler ilk görünümün dışında kalıyor. | Ekran: yaklaşık 1200×800 pencerede Yeni Ürün formunun Vazgeç/Oluştur düğmeleri alt görünür alan dışında. Üstte Ürünler ile geri dönüş çalışıyor. Dar ekran tasarımında kaydetme/geri dönüş düzeni gözden geçirilmeli. |
| B21 | P1 | Hesap silme, lisans ve işletme verisi birlikte ele alınmalı. | Kaynak: hesap silme sonrası lisans anahtarları, cihaz kayıtları ve bulut işletme verisi temizleniyor. Hesap ve işletme veritabanları arasında tek transaction yok. Kullanıcı ekranındaki kısa silme açıklaması bu kapsamı anlatmıyor. Silme ve yarım kalmış temizleme senaryoları denenmedi. |
| B22 | P1 | MASTER yönlendirmesi hedef yönetim konsoluyla tamamlanmamış. | Kaynak: masaüstü MASTER için “Platform hesabı” açıklaması ve Çıkış düğmesi gösteriyor; 360 Labs’a yönlendirme yok. Proje kuralındaki doğrudan platform paneli akışı sağlanmıyor. |
| B23 | P0 | LAN bölünmesinde ada yazması, aynı siparişin çift tahsilatını baştan engelleyen politika değildir. | Ek kaynak kontrolü, 6 Kasım: `lan_sync/write_tx.rs` otorite/çoğunluk kaybında ada commit'ine geçiyor; `merge.rs` aynı sipariş üzerindeki iki taraflı değişikliği sonradan `ORDER_CONFLICT` olarak sınıflandırıyor. Sonradan çakışma göstermek iki gerçek tahsilatı önlemez. Fiziksel iki cihazla yeniden üretim yapılmadı. Yeni planda internet kesintisi ile LAN bölünmesi ayrıldı ve üretim için tek işlem otoritesi önerildi. |

## 360 Labs: ekran bazlı değerlendirme

| Ekran | Yapılan kontrol | Mevcut durum / eksik |
|---|---|---|
| Giriş | Ekran; mevcut oturumla erişim | `127.0.0.1` giriş isterken `localhost` mevcut oturumu açtı. Farklı origin/cookie davranışı; tek başına giriş hatası değildir. Başarılı/başarısız parola denemesi yapılmadı. |
| Ürünler | Ekran/Aksiyon | KASAM360 aktif görünüyor. Ürün yönetimi mevcut; arşivleme denenmedi. |
| İşletmeler | Ekran/Aksiyon | Bir hesap görünüyor; paket yok, abonelik yok, hesap aktif. İşletme adı eksikken kişi adı işletme listesinde görünüyor. Hesap ile gerçek işletme ayrımı belirsizleşiyor. |
| İşletme ayrıntısı | Ekran | Paket seçimi, bitiş tarihi, engelleme ve e-posta yazma var. Paket yok seçeneği nedeniyle hazır lisans atama senaryosu yok. Bağlı cihaz bulunmuyor. |
| Paketler | Ekran/Aksiyon | Liste boş. Paket Ekle açıldı/kapatıldı; 11 özellik ve cihaz limiti görüldü. Kaydetme, paket değişiminin mevcut işletmeye etkisi denenmedi. |
| Abonelikler | Ekran | Boş durum açılıyor. Başarılı, gecikmiş, iptal edilmiş ve yenilenmiş abonelik örneği yok. Finansal yaşam döngüsü doğrulanamadı. |
| Teknik Ayarlar | Ekran | API anahtarı durumu tanımlı; özellik kataloğu, arşivleme, ödeme eşlemesi var. Sırlar yenilenmedi veya iptal edilmedi. Kaynak/çalışan sürüm farkı burada belirgin. |
| Özellik kataloğu | Ekran/Kaynak | 11 özellik düzenlenebilir. Bir kodun tanımlı olması uygulandığı anlamına gelmiyor; teslim edilmemiş özelliğin satılmasını önleyen yayın durumu görünmüyor. |
| Ödeme eşlemesi | Ekran/Kaynak | Çalışan ekranda ad/mağaza/varyant; kaynakta ayrıca paket bağlantısı var. Satış kataloğu ve checkout yönetimiyle tamamlanması gerekiyor. |
| Gelen Kutusu | Ekran/Aksiyon | IMAP gelen kutusu dolu açılıyor; tek `noreply` hesabı görünüyor. Taslak, istenmeyen, gönderilen ve çöp klasörü bağlantıları var; klasörlerin tamamı ve ileti taşıma/silme denenmedi. |
| Yeni E-posta | Ekran/Aksiyon | Gönderen, alıcı, konu, ileti ve Vazgeç çalışıyor. Gönderim yapılmadı. Taslak kaydetme ve ek dosya kontrolü görünmüyor. |
| Destek | Ekran | Liste boş. Gerçek talep atama, cevaplama, yeniden açma ve çözüm süreleri ölçülemedi. |
| Asistan Ayarları | Ekran | Ürüne özel talimat ve otomatik taslak seçeneği var. Talimat kaydetme/taslak üretme/gönderme denenmedi. |
| Bildirimler | Ekran/Kaynak | “Okunmamış bildirim yok.” Okundu aksiyonu kaynakta var; olay türleri destek odaklı. Kritik olayların öncelik, sorumlu ve çözüm takibi eksik. |
| Ekip | Ekran | Kapalı bir ekip hesabı ve destek yetkisi yönetimi görüldü. Paket/finans/işletme yönetimi için ayrıntılı görev ayrımı bu ekranda görünmüyor; farklı rolle test edilmedi. |
| Olay Geçmişi | Ekran | Ürün bazında gerçek geçmiş geliyor. Yönetilen nesnenin son durumu ve hata/yeniden deneme ilişkisi ayrıca ele alınmalı. |
| İşlem Geçmişi | Ekran | Zaman, işlem, ürün, ayrıntı ve yapan sütunları var. Uzun geçmiş, filtreleme ve sayfalama yük altında denenmedi. |
| Hesabım / şifre | Kaynak; çalışan menüden ulaşılamadı | Kaynakta rota ve bağlantı bulunuyor. Eski çalışan sürüm nedeniyle arayüz doğrulaması yapılmadı; oturum kapatılıp test edilmedi. |

Konsolun hedefi açısından açık kalanlar: işletme sahipliği ve üyeler, bir hesabın birden fazla işletmesi, şube/cihaz ilişkisi, lisans yaşam döngüsü, gerçek cihaz sağlığı, eşitleme/backup durumları, ödeme sorunlarının çözümü, ortak destek geçmişi ve sürüm dağıtımı. Bunların hepsi bugün varmış gibi kabul edilmemeli.

## Web: sayfa bazlı değerlendirme

Mevcut görsel tasarım yeni sitenin referansı olarak alınmamalı. Aşağıdaki değerlendirme mevcut işlevleri ve boşlukları kayda geçirir; yeni tasarım onayı değildir.

| Sayfa | Yapılan kontrol | Sonuç / ihtiyaç |
|---|---|---|
| Ana sayfa `/` | Ekran/Aksiyon | Tanıtım, bölüm bağlantıları, kayıt çağrıları açılıyor. İnternet kesinti demosu açılıp eski durumuna döndürüldü; bu gerçek ağ testi değildir. Ana mesaj belirgin; ilk görünümde geniş boş alan ve uzun anlatım var. Ziyaretçinin paket/başlangıç kararı tamamlanmıyor. |
| Özellikler `/ozellikler` | Ekran/Kaynak | Statik işlev listesi var. Özellik–paket–teslim durumu bağlantısı yok. QR ve sayım gibi görünür yolu eksik işlevlerle içerik yeniden eşleştirilmeli. |
| Abonelik `/abonelik` | Ekran/Kaynak | Sabit işletme başına abonelik açıklaması; fiyat “Yakında”. Aylık/yıllık seçim, paket karşılaştırma, ödeme ve yükseltme yok. Süre bitişi vaadi masaüstüyle çelişiyor. |
| Sorular `/sorular` | Ekran/Aksiyon | Akordeon açılıyor; abonelik bitişi cevabı doğrulandı. Çevrimdışı çalışma, internetin ilk etkinleştirmede gerekmesi ve lisans yenileme sınırı birlikte netleştirilmeli. |
| İletişim `/iletisim` | Ekran/Aksiyon | E-posta bağlantısı, destek ve kayıt bağlantısı var. Satıcı “KASAM360” olarak yazıyor. Ticari kimlik ve erişim bilgileri yayın öncesi tamamlanmalı; hukuki uygunluk denetimi yapılmadı. |
| Giriş `/giris` | Ekran/Aksiyon | Açık oturum Hesabım’a yönleniyor. Google oturumu mevcut ve hesap ekranında doğrulandı. Yeni OAuth giriş, ret/iptal ve oturum süresi sonu testi yapılmadı. |
| Kayıt `/kayit` | Ekran/Aksiyon | Form açılıyor; boş gönderimde ad, işletme ve onay hataları gösterildi. Yeni hesap yaratılmadı. Sayfa, ürün kullanımı yerine ileride bilgilendirilmeyi vadediyor. Giriş yapmış kullanıcıya yeniden kayıt gösteriliyor. |
| Şifremi unuttum `/sifremi-unuttum` | Ekran/Aksiyon | Boş e-posta gönderimi engelleniyor. Gerçek kurtarma e-postası gönderilmedi. Google hesabı ile parola hesabı ayrımı ürün akışında anlaşılır olmalı. |
| Şifre yenile `/sifre-yenile` | Ekran/Aksiyon | Tokensız bağlantı “geçersiz veya süresi dolmuş” mesajı ve yeni bağlantı iste yolunu gösteriyor. Geçerli bağlantıyla parola değiştirilmedi. |
| Hesabım `/hesabim` | Ekran/Kaynak | Google hesabı, profil, çıkış, silme ve destek mevcut. Paket ve cihaz yönetimi yok. Boş işletme adıyla hesap kullanılabiliyor; kurulumun tamamlanma durumu gösterilmiyor. |
| Destek `/destek` | Ekran/Aksiyon | Yeni talep formu ve boş talepler listesi açılıyor. Boş form gönderimi engellendi. Talep → Labs bildirimi → cevap → müşterinin cevabı görmesi zinciri gönderim yapılmadığı için bekliyor. |
| Gizlilik `/gizlilik` | Ekran | Hesap ve sağlayıcı açıklamaları var. Yeni bulut işletme verisi, destek içeriği, cihaz verisi ve silme davranışıyla kapsam karşılaştırılmalı. Bu rapor metnin hukuken yeterli olduğunu söylemez. |
| KVKK `/kvkk` | Ekran | Hesap verisi ve silme açıklaması var. MongoDB işletme verisi, yerel kayıtlar, yedekler ve denetim kaydının yaşam döngüsü tek açıklamada tutarlı olmalı. |
| Kullanım şartları `/kullanim-sartlari` | Ekran | Erken erişim ve ödeme/indirme olmadığı açıkça yazıyor. Ücretli hizmet başladığında mevcut metin bu akışı anlatmayacak. |
| İade `/iade` | Ekran | Şu an ödeme alınmadığını söylüyor. Gerçek iade başvurusu, durum takibi ve abonelik üzerindeki etki yok. |
| Bulunamadı ekranı | Kaynak | `not-found.tsx` var; rastgele URL ve kurtarma bağlantıları bu turda denenmedi. |

Webde eksik müşteri yolları: paket seçimi, ödeme dönüşü/başarısızlığı, abonelik yönetimi, lisans/cihazlar, uygulama indirme ve kurulum yönlendirmesi, işletme seçimi, bildirim merkezi. Bunlar yalnız yeni görsel tasarımla çözülmez; Labs ve API karşılıkları da gerekir.

## Desktop: ekran bazlı değerlendirme

Tüm ana modüller açık kullanıcı oturumuyla dolaşıldı. Bu tur farklı personel rolleriyle yetki testi değildir. Veritabanı sıfırlanmadı; ilk kurulum ve oturum kapıları kaynak üzerinden incelendi.

| Ekran / bölüm | Yapılan kontrol | Sonuç / açık kalan |
|---|---|---|
| Sol menü / kabuk | Ekran/Aksiyon | Yedi ana modül erişilebilir. Vardiya etiketi diğer ekranlarla çelişiyor. Lisans ve bulut problemi ortak uyarıda görünmüyor. |
| Salon | Ekran/Aksiyon | 32 boş masa, Salon/Teras, durum filtreleri ve kart/kroki seçenekleri var. Masa 1 açıldı, kişi sayısı soruldu; işlem başlatılmadan kapatıldı. |
| Rezervasyon | Ekran/Kaynak | Salon aksiyonu ve ayar alanı var. Yeni rezervasyon, çakışma, saat sınırı ve masa müsaitliği denenmedi. |
| Sipariş | Ekran/Aksiyon | Masa seçilmediyse “Önce masa seçin”, salon ve tezgâh satış yolları var. Ürün ekleme, mutfağa gönderme, fiyat dondurma ve sipariş kapanışı denenmedi. |
| Mutfak | Ekran/Aksiyon | “Bekleyen fiş yok”; istasyon filtresi ve ses denetimi var. Hazırlanıyor/hazır/teslim akışı için sipariş verisi yok. |
| Kasa / Defter | Ekran | Açık vardiya, işlem ekleme, kapatma, toplamlar ve gider alanları görünüyor. Yeni hareket oluşturulmadı. Sol menüyle çelişen durum B08. |
| Kasa / Fişler | Ekran/Aksiyon | Arama, tarih aralığı, sayfalama ve değişiklik talepleri girişi var; bu aralıkta fiş yok. Fiş ayrıntısı, iade ve basım doğrulanmadı. |
| Kasa / Gün Sonu | Ekran | Z raporu düğmesi pasif; sayımla kapanış açıklaması var. “Kapanmış vardiya yok” görüldü. Kritik kayıtlarda aynı gün kapanış olayları bulunduğu için geçmiş görünümünün filtre/kayıt ilişkisi ayrıca araştırılmalı; tek başına veri kaybı kanıtı değil. |
| Tahsilat / bölme / iade | Kaynak; işlem bekliyor | Gerçek adisyon üzerinde denenmedi. Nakit/kart ayrımı, tekrarlı gönderim, stok düşümü, ödenmiş sipariş iptali ve iade kabul testi açık. |
| Yönetim / Pano | Ekran | Sıfır satış göstergeleri ve canlı işletme durumu var. Maliyeti bilinmeyen ürün için teknik menü analizi hatası çıkıyor. Bulut sorunu uyarılarla bütünleşmiyor. |
| Yönetim / Kâr ve Sabit Gider | Ekran/Aksiyon | Ay seçimi, kâr kalemleri, cari özeti ve gider ekleme girişi var. Görünen sıfırların finansal doğruluğu bağımsız veriyle hesaplanmadı. |
| Yönetim / Raporlar | Ekran/Aksiyon | Satış, vardiya/kasa, iptal/iade/fire, personel ve kâr seçenekleri var. Satış boş durumu açıldı; tüm rapor varyantları ve Excel dosyası doğrulanmadı. |
| Yönetim / Cari | Ekran/Aksiyon | Müşteri/tedarikçi sekmeleri, arama ve Yeni Kart; müşteri listesi boş. Borç/alacak, ödeme, ekstre ve belge eşlemesi denenmedi. |
| Personel / Kişiler | Ekran | Pasif personel kartı ve ekleme aksiyonu var. Aktif personel düzenleme ve rol yetkileri test edilmedi. |
| Personel / Bordro | Ekran/Aksiyon | Günlük/haftalık/aylık ve dönem seçimleri var. Bordroyu Hesapla pasif; aktif personel üzerinden hesap/ödeme denenmedi. |
| Personel / İzin Onayları | Ekran/Aksiyon | Bekleyen talep yok; boş durum düzgün açılıyor. Talep, onay ve ret denenmedi. |
| Personel / Bahşiş Havuzu | Ekran/Aksiyon | Toplanan/dağıtılan/kalan, nakit/kart ve dağıtım alanları var. Para eklenmedi veya dağıtılmadı. |
| Kritik Kayıtlar | Ekran | İşlem/personel/tarih filtreleri ve gerçek olaylar geliyor. Zincir doğrulaması veya değiştirilemezlik testi bu turda yapılmadı. |
| Menü / Ürünler | Ekran/Aksiyon | Bir satış ürünü, üç kategori, arama ve durum filtreleri var. Yeni Ürün açıldı, Ürünler bağlantısıyla geri dönüldü. Ürün oluşturulmadı. |
| Menü / Yeni Ürün | Ekran/Aksiyon | Ad, kategori, fiyat, KDV, birim, barkod, açıklama mevcut. İstasyon tanımlı değil. Uzun formun son aksiyonları ilk görünümün altında. |
| Menü / ürün ayrıntısı ve seçenekler | Kaynak; ayrıntılı aksiyon bekliyor | Fiyat, seçenek ve reçete bileşenleri var. Mevcut ürünün tüm düzenleme alt ekranları ve toplu fiyat güncellemesi çalıştırılmadı. |
| Stok / Mevcut Stok | Ekran/Aksiyon | Espresso “Stok Yok” olarak görünüyor; yeni kalem ve stok girişi yolları var. FIFO lot girişi yapılmadı. |
| Stok / Reçeteler | Ekran/Aksiyon | Espresso “Reçete Eklenmemiş”. Satış ürünü hazır görünürken maliyet/reçete hazırlık eksikleri ortak kurulum kontrolünde gösterilmiyor. |
| Stok / Zayiat ve Fire | Ekran/Aksiyon | Fire ekleme ve boş geçmiş var. Fire kaydı oluşturulmadı. |
| Stok / Hareketler | Ekran/Aksiyon | Boş hareket listesi. Sayım işlemi için ayrı görünür giriş bulunamadı. |
| Tarifeler | Ekran/Aksiyon | Tarife ekle; mevcut kayıt üzerinde Aç/Düzenle/Sil var. Etkinleştirme ve fiyat etkisi denenmedi. Elle tarife ile otomatik dinamik fiyat ayrı işlevler; yalnız tarife görünmesi bayrak ihlali kanıtı değildir. |
| Ayarlar / Oturum ve Görünüm | Ekran | İşletme oturumu, hatırlama, kilit süresi ve tema var. Tercihler değiştirilmedi. Lisans paketi ve yenileme burada görünmüyor. |
| Ayarlar / Cihaz Bağlantıları | Ekran | Yerel ağ hazır ve tek cihaz; bulut lisans reddi, iki bekleyen işlem. İkinci fiziksel cihaz eşleştirilmedi. |
| Ayarlar / Masalar ve Kroki | Ekran | Kısımlar, masa düzenleme/ekleme ve kroki girişi var. Masa taşıma, silme veya kroki kaydetme yapılmadı. |
| Ayarlar / Mutfak İstasyonları | Ekran/Aksiyon | Tanımlı istasyon yok; ekleme düğmesi var. Siparişin istasyona yönlendirilmesi doğrulanmadı. |
| Ayarlar / Rezervasyon | Ekran/Aksiyon | Rezervasyonun önceden görünme süresi ayarı var. Değer değiştirilmedi. |
| Ayarlar / Yedek ve Kurtarma | Ekran | Liste ve klasör sonunda yükleniyor; son yedek 05.11.2026 11:33. Otomatik, elle ve gün sonu kayıtları var. Dosya bütünlüğü, yeniden yedekleme ve kurtarma denenmedi. |
| Kurulum / Google / hesap girişi | Kaynak | Yeni işletme, mevcut cihaza katılma, yedekten kurulum ve buluttan dönüş yolları var. Temiz cihaz üzerinde tekrar edilmedi. |
| PIN / kilit / zorunlu PIN değişimi | Kaynak | Bileşenler mevcut. Açık oturum kullanıldığı için yeni PIN oturumu, başka personelle açma ve beş hatalı giriş kilidi denenmedi. |
| Lisans kapısı | Kaynak | Durumlar tanımlı; geçersiz lisans için bağlama/yenileme var. Üretim zorunluluğu, süre dolması, cihaz iptali ve çevrimdışı tolerans testi açık. |

## Uygulamalar arası akışların durumu

| Akış | Bugün doğrulanan | Eksik doğrulama / bağlantı |
|---|---|---|
| Google hesabı → web hesabı | Açık Google oturumu Hesabım ekranında tanınıyor. | Yeni giriş, iptal, hesap birleştirme, oturum süresi sonu. |
| Web hesabı → Labs işletme listesi | Aynı kullanıcı Labs listesinde görünüyor. Kaynakta hesap eşitleme köprüsü var. | Yeni kayıt oluşturup görünme gecikmesini, hata ve tekrar denemeyi ölçmek. |
| Labs paket → web fiyat/özellikler | Paket formu mevcut. | Kataloğun webde tüketilmesi yok; fiyat ve yayın modeli eksik. |
| Ödeme → abonelik → lisans | Kaynakta webhook, varyant eşlemesi ve lisans süresi güncellemesi var. | Checkout, test olayları, tahsilat doğrulaması, iptal/iade/yenileme ve müşteri görünümü. |
| Labs lisans → API → masaüstü | Kaynakta imzalı belge ve cihaz limiti yolu var. | Mevcut hesapta paket yok; gerçek etkinleştirme zinciri gösterilemedi. |
| Özellik kapatma → desktop | Bayrak deposu ve bazı bileşen kontrolleri var. | Menü, kısayol, açık ekran ve backend komutlarının tamamında tutarlı engelleme. |
| Desktop → bulut → yeni cihaz | Kaynakta kuyruk ve geri yükleme var. | Mevcut ortam bulut lisans reddinde; aktarım ve ikinci cihaza dönüş doğrulanamadı. |
| Web destek → Labs → müşteriye yanıt | Her iki tarafta ekranlar; API köprüsü mevcut. | Yeni talep/yanıt gönderimi, bildirim, sahiplik, okunma ve kapanış. |
| Lisans süresi dolması → veri erişimi | Web vaadi ve kapı kodu okunabildi. | Tek bir davranış kararı ve bitmiş abonelikle kapanış/rapor/yedek testi. |
| Hesap silme → cihaz/bulut/Labs | Kaynakta temizleme ve Labs hesap yansıtma var. | Aktif abonelik, açık cihaz, yerel kayıt, yedek ve yarım kalan temizleme senaryoları. |

## Veri sahipliği ve MongoDB

Mevcut kaynakta görülen ayrım:

| Veri | Mevcut sahibi | İnceleme sonucu |
|---|---|---|
| Kullanıcı, oturum, doğrulama, masaüstü lisans anahtarı | KASAM360 API / MongoDB hesap veritabanı | `kasam360_account` varsayılan adı; yapı kaynakta mevcut. Atlas yönetim ayarları denetlenmedi. |
| İşletme eşitleme kaydı, satırlar, cihaz imleçleri | KASAM360 API / MongoDB işletme veritabanı | `kasam360_business` varsayılan adı. Kullanıcı başına tenant tekilliği var; çok işletme hedefiyle birlikte değerlendirilmesi gerekir. |
| Ürünler, paketler, özellikler, işletme yansımaları, abonelik/lisans, destek | 360 Labs / SQLite | `data/360labs.sqlite`. MongoDB kurulmuş olması bu verinin otomatik taşındığı anlamına gelmiyor. |
| Satış ve yerel işletme kayıtları | Desktop / SQLite | Çevrimdışı çalışmanın yerel kaynağı; bulut aktarımı ayrı süreç. |

Bu rapora dayanarak ek veritabanı açmak için somut bir gereksinim çıkmadı. Önce hesap, işletme, kiracı, şube, cihaz, paket ve abonelik kimliklerinin ilişkisi kesinleştirilmeli. Labs’ın mevcut SQLite yapısının üretimde nasıl barındırılacağı ve yedekleneceği ayrıca karara bağlanmalı. Kaç küme veya veritabanı gerektiği, bu sahiplik ve test/üretim ayrımından sonra belirlenebilir.

## Uyarı sistemi için saptanan boşluklar

Bugün Labs bildirimleri, desktop işlem bildirimleri, Pano uyarıları ve yerel/bulut eşitleme durumları birbirinden ayrı. Web hesap alanında ortak bildirim kutusu yok.

Eksik kapsamın somut örnekleri:

- Lisans reddedildiğinde kullanıcıya nedeni, etkilenen işlev ve doğru düzeltme yolu birlikte gösterilmiyor.
- Bulutta bekleyen işlem, genel işletme panosunda bekleyen iş olarak görünmüyor.
- Lisans bitişi, ödeme başarısızlığı ve cihaz sınırı için ortak görünüm yok.
- Ürün maliyeti/reçetesi/istasyonu eksik olduğunda kurulum tamamlanma durumu oluşmuyor.
- Yedek yok, yedek okunamadı ve yedek yükleniyor durumları ilk gösterimde karışabiliyor.
- Bildirimin görülmesi, sorunun çözülmesi ve tekrar oluşması birbirinden ayrı izlenmiyor.

Her uyarı için olayın sahibi, önem derecesi, hangi uygulamada görüleceği, hangi işletme/cihaza ait olduğu ve çözüm aksiyonu belirlenmeli. Aynı hata tekrarlandığında sınırsız bildirim üretmemeli; kritik hata yalnız geçici bir mesajla kaybolmamalı.

## Yayın ve mobil öncesi açık kabul testleri

Bu liste tamamlanmış test iddiası değil; mevcut rapordan çıkan açık kabul ölçütleridir.

| Alan | Gerekli sonuç |
|---|---|
| Sürüm eşitliği | Test edilen ekranlar ile kaynak commit/derleme kimliği eşleşmeli. |
| Paket | Labs’ta paket değişikliği webde doğru fiyat/özellik ve masaüstünde doğru erişim üretmeli. |
| Ödeme | Başarılı, başarısız, tekrarlı ve sırası değişmiş bildirimler; yenileme, iptal, iade ve test ortamı doğrulanmalı. |
| Lisans | Paket yok, aktif, tolerans, bitmiş, engelli ve cihaz limiti durumları; çevrimdışıyken davranış ve rapor/yedek erişimi doğrulanmalı. |
| Yetkiler | OWNER, MANAGER, CASHIER, WAITER, KITCHEN ve MASTER ile ekran/kısayol/komut erişimi ayrı ayrı denenmeli. |
| Finans | Bölünmüş tahsilat, iki cihazın aynı siparişi kapatması, tekrar gönderim, fiyat/KDV dondurma, iade ve vardiya farkı gerçek test verisiyle doğrulanmalı. |
| Stok | Gerçek FIFO lotları, reçete, kısmi tahsilatta tek düşüm, iptal/fire ve sayım mutabakatı doğrulanmalı. |
| Dayanıklılık | İnternet kesintisi, yerel ağ bölünmesi, cihaz kapanması, yeniden katılma ve çözülemeyen çakışma senaryoları çalıştırılmalı. |
| Kurtarma | Yedekten temiz kurulum ve buluttan başka cihazda dönüş, kayıt sayısı/tutar mutabakatıyla doğrulanmalı. |
| Destek | Web talebi Labs’a düşmeli; yetkili yanıt müşteriye dönmeli; bildirim/okunma/kapanış tutarlı olmalı. |
| Kurulum/güncelleme | Temiz Windows cihazında imzalı kurulum; sürüm yükseltme; veri korunması; başarısız güncelleme ve geri dönüş denenmeli. |
| Mobil | Desktop ekranlarını kopyalamadan önce dokunma alanı, küçük ekran, sanal klavye, arka plan/kapanma, yerel veri ve cihaz eşitleme sınırları doğrulanmalı. |
| Mağaza hazırlığı | Mobil paket kimlikleri, imza, dağıtım, satın alma/lisans ilişkisi ve mağazaya özgü teslim gereksinimleri ayrı çalışma olarak ele alınmalı. Bu incelemede mağaza kuralları araştırılmadı. |

Çalışma sırası açısından ilk çözülmesi gerekenler sürüm eşitliği, paket/lisans sözleşmesi ve bulut reddidir. Ardından web müşteri yolculuğu ile Labs yönetim işlemleri birlikte tamamlanabilir. Masaüstünün finansal ve çok cihazlı kabul testlerinden sonra mobil uyarlama ve yayın hazırlığına geçilmesi, mevcut kopuklukların yeni istemciye taşınmasını önler.

## Kaynak dayanakları

Aşağıdaki dosyalar uygulama davranışını karşılaştırmak için okundu; önceki dokümanlar tamamlanmış iş kanıtı olarak alınmadı.

- [Web abonelik içeriği](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/web/src/app/abonelik/page.tsx:12>) ve [hesap ekranı](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/web/src/components/account/AccountPanel.tsx:201>).
- [Web başlık menüsü](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/web/src/components/SiteHeader.tsx:9>) ve [destek ekranı](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/web/src/components/account/SupportPanel.tsx:25>).
- [Masaüstü lisans zorunluluğu](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/desktop/src/stores/licenseStore.ts:29>), [lisans kapısı](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/desktop/src/app/App.tsx:144>) ve [F3 geçişi](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/desktop/src/app/App.tsx:114>).
- [Sol menü vardiya/özellik görünümü](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/desktop/src/features/shell/SidebarNav.tsx:20>) ve [yerel eşitleme göstergesi](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/desktop/src/features/shell/SyncStatusChip.tsx:21>).
- [Bulut durum ekranı](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/desktop/src/features/patron/settings/CloudSyncSettings.tsx:37>) ve [yedek yükleme/boş durumları](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/desktop/src/features/patron/BackupPanel.tsx:47>).
- [Stok sekmeleri](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/desktop/src/features/stock/StockHub.tsx:9>) ve [QR menü bileşeni](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/desktop/src/features/patron/QrMenuPanel.tsx:18>).
- [İmzalı lisans üretimi](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/backend/api/src/license.ts:105>) ve [masaüstü lisans durum hesabı](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/backend/src/services/license.rs:118>).
- [Kurulum/güncelleme yapılandırması](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/backend/tauri.conf.json>) ve [uygulama eklenti başlatma](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/backend/src/lib.rs:103>).
- [MongoDB sahiplik, indeks ve temizleme yolları](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/backend/api/src/lib/mongo.ts>) ve [hesap silme sonrası işlem](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/backend/api/src/lib/auth.ts:70>).
- [Labs paket modeli](<C:/Users/Eren Tokgöz/Desktop/Projects/360labs/src/packages.rs:24>), [ödeme olayları](<C:/Users/Eren Tokgöz/Desktop/Projects/360labs/src/billing.rs:107>) ve [ödeme varyant eşlemesi](<C:/Users/Eren Tokgöz/Desktop/Projects/360labs/src/variants.rs>).
- [Labs bildirim kapsamı](<C:/Users/Eren Tokgöz/Desktop/Projects/360labs/src/notifications.rs:15>), [menü kabuğu](<C:/Users/Eren Tokgöz/Desktop/Projects/360labs/src/pages.rs:27>) ve [hesap köprüsü](<C:/Users/Eren Tokgöz/Desktop/Projects/360labs/src/customer_accounts.rs>).
- Ek kaynak kontrolü: [yerel yazma ve adaya geçiş](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/backend/src/services/lan_sync/write_tx.rs>), [ada birleşimi ve sipariş çakışması](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/backend/src/services/lan_sync/merge.rs>) ve [stok lot düzeltmesi](<C:/Users/Eren Tokgöz/Desktop/Projects/kasam360/backend/src/services/lan_sync/merge_stock.rs>). Bu yolların yeni politika ve maliyet mutabakatı C07/C09/Q05 kapsamında doğrulanacak.

Bu raporda görülen boş listeler, ilgili modülün hiç uygulanmadığını tek başına kanıtlamaz. Kaynakta bulunan fakat çalıştırılmayan yollar da başarıyla test edilmiş sayılmaz. Bulguların bu iki sınır korunarak ele alınması gerekir.

## Frontend ve görsel tasarım incelemesi — 6 Kasım 2026

Bu ek, önceki turdaki ekran gözlemleri ve güncel ortak bileşen/CSS okumalarına dayanır. Tüm modalların görselleri kaydedilmiş değildir; açılmamış modalların değerlendirmesi ortak bileşen koduyla sınırlıdır. Animasyonların gerçek cihazdaki akıcılığı ölçülmedi.

Genel değerlendirme: masaüstünün yapay/şablon hissinin başlıca nedeni fazla animasyon değil, zayıf görsel hiyerarşi ve aynı kutu dilinin farklı işler için tekrarlanması. Genel beyaz/gri panel düzeni ile eski defter sınıflarının karışımı tutarlı bir marka kimliği üretmiyor. Çözüm eski defter diline dönmek değil; görev odaklı kompozisyonlar ve yeni, ortak bir görsel sistem kurmak.

| Alan | Somut gözlem / kaynak | Tasarım üzerindeki etkisi | Öncelik |
|---|---|---|---|
| Yüzeyler | `index.css`: panel, kart, yükseltilmiş yüzey aynı `--surface`; border/subtle/strong aynı `--line`. | İç içe gruplar birbirinden ayrışmıyor; hiyerarşi için tekrar kutu ve boşluk ekleniyor. | Yüksek |
| Marka dili | Açık tema beyaz/gri ve koyu yeşilimsi aksiyon rengine dayanıyor; notebook sınıfları bunu izliyor. | Kullanıcı defter temasını iptal etti. Eski kâğıt/kalem dili geri getirilmeyecek; yeni tasarım sistemi bütün ekranlarda uygulanacak. | Yüksek |
| Sayfa kompozisyonu | Yeni Ürün formu dar bir sütunda uzarken sağ taraf geniş ölçüde boş; aksiyonlar ilk görünümün altında. Ayarlarda küçük tercih grupları geniş kutulara yayılıyor. | Ekran alanı işlemin önceliğine göre kullanılmıyor; masaüstü uygulaması bir web formu gibi hissediliyor. | Yüksek |
| Kartlar | `RecordCard` bir secondary Button; başlık, kısa açıklama, değer ve ok aynı kalıpta. Açıklama `truncate`. | Kayıt, gezinme ve işlem düğmesi birbirine benziyor; uzun açıklamanın tam görünürlüğü bu bileşende sağlanmıyor. | Orta |
| Sekme/aksiyon ayrımı | `BarTab` ve `BarAction` aynı `bar-item` görünümünü paylaşıyor; iç içe ana/alt sekme şeritleri var. | “Neredeyim?” ve “Ne yapabilirim?” görsel olarak ayrışmıyor. | Yüksek |
| Dokunma hedefi | `notebook.css` içinde `.bar-item` minimum yüksekliği 44px; ortak Button en az 48px. | Projenin 48px kuralı ortak şerit bileşeninde tutarlı uygulanmıyor. Dış margin tıklama alanını büyütmez. | Yüksek |
| Toast yaşam süresi | `OperationNotice.tsx`: hata 12sn, uyarı 8sn sonra kapanıyor. `ErrorToast` görünür satır yerine global bildirim üretiyor. | Sorun sürerken açıklama kaybolabilir; form alanı ile hata ilişkisi kopar. Başarı mesajı ile kalıcı arıza farklı davranmalı. | Yüksek |
| Toast yerleşimi | Sağ alt, en çok 24rem genişlik, z-index 90; modal 50, drawer 40. | Dar ekranda işlem alanının üzerine gelme riski var; modal bağlamından bağımsız üstte görünür. Tüm ekranlarda çakışma ölçülmedi. | Orta |
| Modal/drawer tutarlılığı | Modal zemini siyah %75, drawer %60. Modalda giriş odaktayken Escape önce blur yapıyor; drawer Escape ile doğrudan kapanıyor ve dış tıklamayı kabul ediyor. | Aynı uygulamada iki farklı kapatma kuralı var. Karartma özellikle kısa, sık işlemleri gereğinden ağır hissettirebilir. | Yüksek |
| Modal boyutlandırma | Modal genişlik seçenekleri çok; ortak sabit işlem altlığı yok. Drawer isteğe bağlı footer taşıyor. | Uzun/kısa form davranışı çağıran ekranlara kalıyor; kaydetme ve kapatma konumları için tek bir düzen oluşmuyor. | Orta |
| Animasyon | `motion.css`: sekme fade 120ms, modal/drawer 180ms, öğe hareketi 160ms; toast hafif dönerek giriyor. `.motion-swap > *` bütün doğrudan çocukları kapsıyor. | Hareket var fakat birçok nesneye aynı efekt dağıtılıyor. POS için hareketin görevi seçim, açılma ve sonuç ilişkisini anlatmak olmalı; dekoratif hareket kapsamı dar tutulmalı. | Orta |
| Tipografi | Çok sayıda başlık/etiket benzer kalınlıkta; küçük ikincil metin ve kesilen açıklamalar var. | İşlem başlığı, değer, açıklama ve yardımcı metin aynı ağırlığa yaklaşınca tarama zorlaşıyor. Kontrast oranı ölçülmedi. | Orta |
| Durum tasarımı | Yedek yüklenirken önce “yok/okunamadı”; veri eksikliğinde BCG hata metni; farklı ekranlarda vardiya çelişkisi. | Boş, yüklenen, eksik kurulum ve arızalı durumlar ayrı tasarlanmamış. Görsel kaliteyi en çok bu tutarsızlıklar düşürüyor. | Yüksek |

Yeniden yazımda korunacak davranışlar: ortak bileşen yaklaşımı, en az 48px hedef, toast tekrarlarının gruplanması, odak/fare üzerindeyken sürenin durması, doğru modal odak yönetimi, `prefers-reduced-motion` ve kısa işlevsel animasyonlar. Bunların varlığı eski frontend'i koruma kararı değildir. Kullanıcı yeni frontend istiyor; bu kazanımlar yeni tasarıma taşınacak, doğrulanmış backend iş kuralları gereksiz yere yeniden yazılmayacak.

360 Labs'ın görsel sorunu farklı: tablo/form ağırlıklı teknik yönetim hissi, boş ekranlarda sonraki adımın zayıf olması ve ticari/operasyonel özetin eksikliği. Konsol için gösterişli hareketten önce işletme durumu, sorun ve yapılacak işlem sırası netleşmeli.

Mevcut site teknik vaat ve uzun anlatım ağırlıklı; gerçek ürün kanıtı, paket karşılaştırması ve hizmete başlama yolu zayıf. Webin sıfırdan frontend tasarımı, hesap/satın alma/abonelik akışları ve SEO/GEO işleri artık bağlı uygulama planının kapsamındadır. Görsellik, dönüşüm, içerik bulunabilirliği ve performans ayrı ölçülür. Bu gözlem kaydı SEO/GEO denetimi veya sıralama/görünürlük garantisi değildir.

Kontrol çerçevesi: [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). Form hatalarının alan yanında gösterilmesi, odak davranışı ve azaltılmış hareket desteği açısından kullanıldı; estetik değerlendirmeler ekranlara ilişkin tasarım yargısıdır.
