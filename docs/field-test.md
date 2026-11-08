> Belge kapsamı: mevcut teknik uygulama/inceleme kaydıdır; yeni ürün kararları ve teslim sırası için [ana plan](uygulama-tamamlama-plani.md) geçerlidir. Buradaki tamamlanma ifadeleri güncel kabul testlerinin yerine geçmez.

# Saha Testi Talimatı

Bu testler gerçek donanım ister; yazılım testleri ve aynı bilgisayardaki çok uygulamalı testler bunların yerine geçmez. Hepsi geçmeden ürün üretime hazır sayılmaz. Her satıra gözlenen sonucu ve tarihi yazın.

## Hazırlık

Yerel geliştirme ortamını proje kökündeki `start-dev.cmd` ile açın (çift tıklama veya terminal). Betik Labs, API, web, Vite ve native Tauri uygulamasını başlatır. Dolu portlar atlanır; adresler `.dev-servers/addresses.json`, servis logları `.dev-servers/*.log` içinde tutulur. İkinci çalıştırma yeni kopyalar açmaz. Ctrl+C yalnız betiğin açtığı süreçleri kapatır; terminali zorla kapatmak yerine bunu kullanın.

Varsayılan MongoDB `.dev-servers/mongo` altında kalıcı ve yereldir; mevcut Atlas verisine bağlanmaz. `start-dev.cmd --configured-db` API `.env` içindeki Mongo adreslerini kullanır. Labs kendi mevcut `.env`/DATA_DIR ayarını kullanır. Hesaplar ve Labs entegrasyon anahtarları otomatik uydurulmaz. `.env` dosyaları değiştirilmez.

Google ayrı bir sunucu değildir: API `.env` içindeki GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET ve ekrana basılan tam `/api/auth/callback/google` adresinin Google Console kaydı gerekir. Web portu değişirse o callback ayrıca izinli olmalıdır; başlatıcı Google Console ayarlarını değiştirmez. Native geliştirme derlemesi seçilen web adresini `KASAM360_DEV_SITE_URL` ile alır; release adresi değişmez.

`start-dev.cmd --check` yalnız port/bağımlılık kontrolü yapar. `start-dev.cmd --no-desktop` native pencereyi açmadan sunucuları ve Vite önizlemesini başlatır. Önkoşullar: Node.js 24, Rust/cargo-tauri, her JS uygulamasında kurulmuş node_modules. İlk Mongo indirmesi ve Rust derlemesi uzun sürebilir.

`start-dev.cmd --stop` çalışan başlatıcının servislerini başka terminalden kapatır. Bir uygulamanın derleme/başlangıç hatası diğerlerini kapatmaz; her uygulama için HAZIR/BAŞLATILAMADI ayrı gösterilir. Eksik Google veya Labs entegrasyon anahtarları sunucu açılışından ayrı yapılandırma gereksinimleridir.

- Aynı sürümü iki Windows cihaza (A, B) kurun. Üç cihaz testi için üçüncü cihaz (C) gerekir.
- Cihazlar aynı Wi-Fi veya kablolu ağda olsun. Windows Güvenlik Duvarı 47360 numaralı TCP portuna izin versin.
- A'da Kayıt Ol ile işletme kurun, ürün ve masa ekleyin. Ayarlar > Cihazlar'dan eşleştirme kodu üretin.
- B'de ilk ekranda Cihazı Bağla'yı seçip kodu girin, sonra aynı e-posta ve şifreyle giriş yapın.
- Üst çubukta iki cihazda da `Hazır` görünmeli.

## İki cihaz

| No | Adım | Beklenen | Gözlenen |
|---|---|---|---|
| 1 | B'den sipariş girin | A'da masa 1 saniyede dolu görünür | |
| 2 | A ve B'de aynı masanın tahsilat ekranını açın, ikisinde aynı anda Tamamla'ya basın | Yalnız bir tahsilat yazılır, diğer ekran kapalı hesap hatası verir | |
| 3 | Menüde fiyat değiştirin | Diğer cihazda görünür, açık adisyonun fiyatı değişmez | |
| 4 | Vardiya aç, nakit satış yap, kör sayımla kapat | Kasa farkı iki cihazda aynı | |
| 5 | Wi-Fi'yi B'de kapatın | B `Bağlantı yok` der, yazmaz, okur. A da yazmayı durdurur | |
| 6 | Wi-Fi'yi açın | İki cihaz 10 saniye içinde `Hazır` olur | |
| 7 | A'nın IP'sini değiştirin (modemden yeni adres veya başka ağ) | Cihazlar yeniden bağlanır, yeni kod gerekmez | |
| 8 | Cihazlar ekranından B'yi pasife alın | A tek başına satışa devam eder, B yazamaz | |

## Elektrik kesintisi

| No | Adım | Beklenen | Gözlenen |
|---|---|---|---|
| 9 | Tahsilat tamamlandıktan hemen sonra A'nın fişini çekin | Açılınca tahsilat kayıtlı, adisyon kapalı | |
| 10 | Tamamla'ya basar basmaz A'nın fişini çekin | Açılınca tahsilat ya tam vardır ya hiç yoktur; yarım kayıt olmaz | |
| 11 | 3 cihazda otorite cihazın fişini çekin | Diğer ikisi 5 saniye içinde satışa döner | |
| 12 | Fişi çekilen cihazı açın | Eksikleri kendi tamamlar, `Hazır` olur | |
| 13 | Her testten sonra Yönetim'den denetim zincirini doğrulayın | Zincir sağlam | |

Madde 11 ve 12 için üç cihaz gerekir. İki cihazda otoritenin fişi çekilirse kalan cihazın durması doğrudur.

## Yedek ve geri yükleme

| No | Adım | Beklenen | Gözlenen |
|---|---|---|---|
| 14 | Ayarlar'dan yedek alın, USB belleğe aynalayın | Yedek listede doğrulanmış görünür | |
| 15 | Yeni satış yapın, yedeğe dönün | Yedek anındaki duruma döner, dönüş öncesi durum ayrıca yedeklenir | |
| 16 | Temiz bilgisayara kurup USB'deki yedekten açın | İşletme, personel ve fişler gelir | |
| 17 | Eşleşmiş cihazda yedeğe dönün | Cihaz kümeden ayrılır, tek başına açılır; diğer cihazda onu pasife alın ve boş kurulumla yeniden eşleştirin | |

## Kalıcı cihaz kaybı

| No | Adım | Beklenen | Gözlenen |
|---|---|---|---|
| 18 | İki cihazda A'yı kapalı bırakın, B'de Cihazlar > Bu Cihazla Tek Başına Devam Et, sahip PIN'i | B satışa döner, eski kayıtlar durur | |
| 19 | A'yı yeniden açın | A kümeye dönmez ve yazamaz; temiz kurulumla yeniden eşleştirilmelidir | |

Madde 18 yalnız cihaz gerçekten kayıpsa yapılır. Cihazlar açık ama ağ kopuksa iki tarafta devralma yapmak kayıtları ayırır ve birleştirilemez.

## Sonuç yazımı

Başarısız satırda ekran görüntüsü, işlem kimliği ve iki cihazın saatini not edin.

## Son masaüstü kabul testleri

**Durum:** Fiziksel cihazlarda bekliyor. Denemeleri ayrı test işletmesinde, test adisyonlarıyla yapın. Her satıra sürümü, cihazları, gözlenen sonucu ve tarihi yazın.

| No | Adım | Beklenen | Gözlenen |
|---|---|---|---|
| 20 | A satışa hazırken B'yi eşleştirin. Üyelik onaylanırken A'da bir test tahsilatı deneyin | Üyelik onayı bekleniyorsa işlem reddedilir. Bu sırada yerel tahsilat, stok düşümü veya kapanmış adisyon oluşmaz. Üyelik tamamlanınca yeni deneme çalışır | |
| 21 | A ve B hazırken aynı açık adisyonun tamamını iki kasadan eş zamanlı tahsil etmeyi birkaç kez, her seferinde yeni test adisyonuyla deneyin | Her adisyonda yalnız bir işlem başarılı olur. Her iki cihazda tek tahsilat, tek stok düşümü ve aynı kasa toplamı görünür | |
| 22 | Modemin internet bağlantısını kesin. Yerel ağ ve iki cihazın bağlantısı açık kalsın. B'den sipariş alın ve A'dan tahsil edin | Sipariş ve ödeme yerel ağda tamamlanır. İki cihaz aynı adisyon ve kasa sonucunu gösterir | |
| 23 | İki cihaz bağlıyken bir test tahsilatı sırasında B'nin yerel ağını kesin. Bağlantıyı açınca işlemi sorgulayın | Sonuç belirsizse önce adisyonu, tahsilat kaydını ve stok hareketini kontrol edin. İşlem tamamlanmışsa ikinci kez tahsil edilmez. Sonuç iki cihazda aynı görünür | |
| 24 | Gerçek termal yazıcıyla bir test fişi ve vardiya sonu Z raporu basın | Türkçe karakterler, tutarlar, ödeme yöntemi ve rapor toplamları ekrandaki kayıtlarla eşleşir | |
| 25 | Garson sipariş açsın, mutfak hazırlayıp teslim etsin, kasiyer tahsil etsin. Müdür ve patronla yetkili işlemleri ayrıca deneyin | Her rol kendi ekranından işi tamamlar. Yetkisiz işlem engellenir, gerekli onaylar ve işlem sahibi denetim kaydında görünür | |

Son UI/UX düzeltmeleri bittikten sonra tam otomatik testleri ve masaüstü derlemesini çalıştırın. Saha sonuçlarını ayrıca bu dosyaya işleyin.
