# KASAM360 Ürün Akışı

## Amaç

Restoranın masaya servis öncelikli günlük işini, internet olmasa da aynı yerel ağdaki cihazlarda kesintisiz yürütmek. Tezgâh satışı aynı ödeme ve stok kurallarını kullanır. Ekranlar yalnızca gerçek işlemleri sunar; yol haritası ve tanıtım sayfaları uygulamada yer almaz.

## Günlük akış

1. İlk açılışta `Yeni işletme kur` işletme bilgilerini ve OWNER hesabını oluşturur, `Mevcut işletmeye cihaz bağla` tek kullanımlık kodla mevcut kiracıya katılır. Fabrika kullanıcısı yoktur. İşletme sahibi cihazları, kullanıcıları, menüyü, reçeteleri, hammaddeleri ve tedarikçileri tanımlar.
2. Yönetici vardiyayı açar; cihazlar menü, fiyat, stok ve açık işlemleri eşitler.
3. Garson masayı açar, ürün ve seçenekleri ekler, mutfağa gönderir. Tezgâh satışı masa seçmeden aynı akışı kullanır.
4. Mutfağa gönderilen kalemler reçetelerinden gerçek parti sırasıyla bir kez stok düşer. Hazırlık öncesi iptal stoğu geri bırakır; hazırlık sonrası kayıp gerekçeli fire olur.
5. Mutfak hazırlık durumunu günceller; garson hazır kalemleri görür.
6. Kasiyer adisyonu tam, tutara göre, kaleme göre veya aynı satırın adetlerine göre böler. Nakit, kart ve müşteri carisi birlikte kullanılabilir. Her ödeme yalnızca bir kez işlenir.
7. Bahşişte ödeme yöntemi ve ortak havuz veya personel seçimi belirtilir. Ortak havuz çalışılan süre ve personel kartındaki bahşiş payına göre dağıtılır.
8. Kapanmış adisyonda çalışan değişiklik talep eder; müdür onaylar. Müdürün kendi değişikliği ayrıca onay beklemez. Önceki kayıt korunur ve bütün değişiklikler sahibin kritik işlemler geçmişinde görünür.
9. Gün sonunda açık adisyon, eşitlenmemiş hareket ve açıklanmamış kasa farkı varsa kapanış tamamlanmaz.

## Yönetim ekranları

- **Menü:** Kategori, ürün, seçenek, fiyat listesi, toplu fiyat güncellemesi, satışta/tükendi durumu ve reçete.
- **Stok:** Hammadde, yarı mamul, hazır ürün, mal kabulü, parti ve son kullanma tarihi, gerçek FIFO maliyeti, üretim, sayım, fire ve kritik stok.
- **Cari Hesaplar:** Müşteriler ve tedarikçiler ayrı sekmelerdir. Kişi/kurum kartı, borç/alacak, vade, kısmi/tam ödeme, ekstre ve bağlı belge/adisyon görülür. Arama Türkçe karakter ve harf büyüklüğü farklarını tolere eder; kayıtlar adla değil benzersiz kimlikle bağlanır. Benzer ad yeni kart açılışında gösterilir, otomatik birleştirilmez.
- **Personel:** Rol, PIN, vardiya, bahşiş payı ve hak ediş. Bahşiş payındaki değişiklik geçmiş vardiyayı değiştirmez.
- **Kritik İşlemler:** Kapanmış adisyon değişiklikleri, iptal, iade, finansal düzeltme ve bunları yapan kişi ile gerekçe.

## Tedarik ve cari bağlantısı

Mal kabulü gerçek teslim miktarını stoğa ekler. Tedarikçi belgesi daha sonra gelebilir; bu durumda giriş "Belge bekleniyor" görünür. Belge tutarı kontrol edilip onaylanınca tedarikçi borcu doğar. Farklar sessizce düzeltilmez. Ödemeler ayrı hareketlerle bakiyeyi azaltır.

## Yedek ve geri dönüş

- Değişiklik varsa saatte bir, her gün sonunda ve elle yedek alınır. Yedek önce geçici dosyaya yazılır, `integrity_check` ve SHA-256 ile doğrulanır, sonra yayınlanır; yarım yedek listelenmez. Tür başına son 30 kopya kalır.
- Varsayılan klasör veritabanının yanındadır ve disk arızasına karşı korumaz. Ayarlar'dan ikinci klasör (harici disk, ağ paylaşımı) tanımlanır; kopyalanamazsa hata ekranda görünür.
- Geri dönüşü yalnız patron, hesap şifresiyle yapar. Mevcut veri önce yedeklenir, uygulama yeniden açılır ve dönüş açılışta uygulanır. Eski dosyalar `<veritabanı>.before-restore-<zaman>` klasöründe kalır.
- Geri dönen cihazda hesap oturumu kapanır, küme kayıtları silinir ve dönüş kritik işlem listesine yazılır. Çok cihazlı modda geri dönüş kapalıdır: geride kalan üye diğer cihazların günlüğünü geri saramaz.
- Yeni cihaz kurulum ekranındaki `Yedekten Geri Dön` ile harici diskteki `.db` dosyasından (yanında `.sha256` ile) açılır. İşaretli yedek açılışta doğrulanamazsa uygulama mevcut veriyle açılır ve hatayı gösterir.

## Fiyat, KDV ve stok

- Menü fiyatı KDV dahildir; müşteri yazan fiyatı öder. KDV satış ekranlarında görünmez, yalnız fişte ve Z raporunda ayrılır. Ürün formundaki KDV oranı bu ayrım için tutulur.
- Stok kalem mutfağa gönderilince düşer. Hazırlık başlamadan iptal edilirse aynı partilere geri döner; hazırlık başladıysa veya gerekçe `Mutfak Zayi` ise dönmez, maliyetiyle fire yazılır. İkram edilen kalem stoktan düşmüş kalır. Tahsilat stoğa dokunmaz.
- Yükseltmeden önce mutfağa gitmiş açık kalemin stoğu adisyon kapanırken bir kez düşer.

## İlk kurulum, giriş ve kilit

- Kurulum durumu `app_setup` satırındadır ve cihaza özeldir. Kullanıcısı olan mevcut veritabanı ilk yükseltmede tamamlanmış sayılır; sihirbaza düşmez.
- Yeni işletme tek transaction'da açılır. Yarıda kesilirse kayıt kalmaz; seçim ve işletme bilgileri taslakta durur, PIN ve eşleştirme kodu diske yazılmaz.
- Kurulum tamamlanmadan giriş, kilit açma, sipariş ve tahsilat komutları `SETUP_REQUIRED` ile reddedilir. Durum okunamazsa kurulum tamamlanmış sayılmaz.
- Ürüne ilk giriş işletme hesabıyladır: e-posta ve şifre. Hesap oturumu cihaza özeldir (`device_session`), personel PIN'i bu oturum açılmadan çalışmaz (`ACCOUNT_REQUIRED`). Sırayla: kurulum, hesap, personel PIN'i.
- `Kayıt Ol` web sitesine yönlendirilecek. Web gelene kadar işletmeyi bu cihazda kurar; hesap yerelde Argon2id ile doğrulanır ve internet gerekmez. Bu yüzden yeni cihaz şimdilik e-postayla değil, kurulu cihazın verdiği eşleştirme koduyla bağlanır; hesap bilgisi bağlanınca gelir.
- Hesabı olmayan eski işletme kuruluma düşmez: sahip PIN'iyle e-posta ve şifre belirler.
- Personel oturumu geçicidir: PIN ile açılır, hareketsizlikte kilitlenir (varsayılan 2 dakika). Ayarlar > Oturum bu cihaz için 2, 5, 15 dakika veya kalıcı oturum seçer; hesap oturumu da kapatılabilir, o zaman her açılışta şifre sorulur. Ayarı yalnız sahip ve müdür değiştirir.
- Giriş oturum yokken, kilit ekranı mevcut oturum hareketsizlikten kilitlendiğinde kullanılır. Başka personelin PIN'i kilitli oturumu açmaz; `Kullanıcı Değiştir` oturumu kapatıp girişe döner.
- İptal, ikram ve iadede kasiyer yetkili PIN'i ister. Patron, müdür ve patronun Ayarlar'dan onay yetkisi verdiği personel kendi işlemini kendi PIN'iyle onaylar; onaylayan denetim kaydına yazılır. Geri alınan yetki bekleyen onayı da durdurur.
- Cihaz bağlama yalnız kurulum sihirbazından yapılır: kayıtlı işletmesi olan cihaz başka işletmeye katılmaz.

## Cihaz ve bağlantı davranışı

- İnternet gerekli değildir; aynı WLAN/LAN'daki cihazlar birbirleriyle çalışır. Tek cihazlı kurulumda satış mümkündür. Çok cihazlı kurulumda ani cihaz kaybından sonraki finansal yazmalar kalıcı çoğunluk varsa sürer; iki cihazdan biri aniden kaybolduğunda çoğunluk kalmaz ve finansal yazma güvenli biçimde durur.
- Yerel ağdan tamamen kopmuş cihaz yeni işlem açmaz. Açık ekranı ve kayıtları korur; yeniden bağlanınca eşitlenir.
- Her işlem, ödeme, stok ve cari hareketi benzersiz kimlik ve tekrar uygulamayı engelleyen işlem anahtarı taşır. Finansal çatışmalarda son yazan kazanır kuralı kullanılmaz.
- Cihaz aktif/pasif yapılabilir. Pasiften dönüşte veri karşılaştırması tamamlanmadan satış açılmaz.
- İnternet varken yedekleme yapılır; durumu ve geri yükleme sonucu yönetimde görünür. Tek cihazın fiziksel veri ve yedek kaybı yazılımla telafi edilemez.

## Uygulama sırası

1. Mevcut kod ve veri sözleşmesini çıkar; çalışan işlevleri koru, sahte ve kullanılmayan ekranları ayıkla.
2. Cihaz kaydı, eşitleme, tekrar işleme koruması ve ödeme çakışması kurallarını doğrula.
3. Menü yönetimini gerçek backend komutlarıyla tamamla.
4. Stok ve reçete akışını mal kabulünden satış maliyetine kadar tamamla.
5. Müşteri ve tedarikçi carisini satış ve mal kabulüyle bağla.
6. Personel, bahşiş, yönetici onayı ve kritik işlemleri tamamla.
7. Masa, mutfak, tezgâh, bölünmüş ödeme, iade ve gün sonunu uçtan uca doğrula.
8. Cihaz kaybı, bağlantı kesilmesi, tekrar deneme, yedekleme ve geri yükleme senaryolarını üretim kapısı olarak çalıştır.

## Üretim kapısı

Derleme ve birim testlerine ek olarak gerçek cihazlarda iki terminalin aynı masaya eşzamanlı erişimi, ödeme sırasında cihaz kapanması, internet kesintisi, tek cihazla çalışma, stok/maliyet mutabakatı, cari ekstre ve yedekten geri yükleme doğrulanmadan üretime çıkılmaz.
