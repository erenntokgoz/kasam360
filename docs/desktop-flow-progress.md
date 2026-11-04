# Masaüstü akışları — çalışma kaydı

## Bağlayıcı ürün kuralı

İşlemde gereken kayıt eksikse bulunduğu ekrandan oluşturulur. Üst işlem kapanmaz; miktar, fiyat, satırlar ve seçimler korunur. Sunucudan dönen kimlikle yeni kayıt otomatik seçilir. Yetki ve LAN yazma kapıları korunur. Form başarısızsa başarı gösterilmez.

## 3 Kasım 2026 — ilk uygulama dilimi

- Ana `develop` çalışma ağacındaki mevcut değişiklikler korunarak ilerleniyor; bu dosya bütün çalışma ağacının teslim raporu değildir.
- Stok girişine ürün arama, mevcut ürün seçimi ve yeni stok kalemi oluşturma eklendi.
- Yeni stok kalemi mevcut ürün tablosuna, mevcut `create_product` komutuyla yazılır. Hammadde/satış ayrımı için stoktan açılan kalem başlangıçta satışa kapalıdır; sıfır fiyatlı ürün kendiliğinden POS'a açılmaz.
- Yeni kalem formunda kategori seçilebilir veya aynı form içinde oluşturulabilir. Kategori başarıyla açılıp ürün reddedilirse oluşturulan kategori seçili tutulur; tekrar denemede yeniden kategori açılmaz.
- Stok ve satın alma ekranında tedarikçi aynı yerden oluşturulup kimliğiyle otomatik seçilir.
- Hızlı stok girişi artık listedeki ilk tedarikçiyi keyfi seçmez veya “Genel Alım” oluşturmaz; kullanıcı tedarikçi seçer/oluşturur.
- Satın alma boş ürün kataloğuyla da kalem ekleyebilir; her kalemde aynı ürün oluşturma akışı kullanılabilir.
- Reçetede hiç malzeme yokken de malzeme satırı eklenebilir; aynı satırdan stok kalemi oluşturulabilir. Yeni malzeme seçilince stok birimi kullanılır.
- Reçeteden oluşturma ana ürün deposunu yenilemez: bu yenileme üstteki kaydedilmemiş ürün formunu sıfırlayabileceğinden stok deposu üzerinden birleştirilir.
- Türkçe karakter/barkod araması mevcut `matchesProduct` yardımcısını kullanır.

## Doğrulama

- Yeni davranışlar için testler önce başarısız koşuldu, ardından düzeltmelerle geçti.
- Frontend: 128/128 test ve build geçti. SSR testlerinde mevcut NumberInput useLayoutEffect uyarısı ve build'de büyük paket uyarısı var.
- Backend fmt kontrolü ve clippy geçti.
- Güncel backend tam test: 1145 geçti, 3 LAN testi başarısız. Hatalar: `network_tests::iki_kurulum_eslesir_para_cogunlukla_yazilir_cihaz_kaybinda_durur`, `replication_fault_tests::iki_cihazda_biri_kaybolunca_yazma_durur_donunce_surer`, `replication_fault_tests::sahip_kaybolan_cihazi_birakip_tek_cihazla_devam_edebilir`. Bunlar frontend değişikliğiyle düzelmiş sayılmaz.
- Tek test iş parçacığıyla LAN yeniden doğrulaması: 57/57 geçti (77,20 saniye). Bu sonuç paralel tam koşudaki üç başarısızlığı ortadan kaldırmaz; yük altında kararlılık sorusu açık.
- Yeni formların gerçek Tauri penceresinde uçtan uca denenmesi henüz tamamlanmadı. Birim test/build sonucu saha testi değildir.

## Kalan akışlar

- Kategori/istasyon/modifier ve diğer seçimlerde aynı yerden oluşturma kuralının tamamlanması.
- Satın alma tedarikçisi ile cari kartın tek kimlik ve belge akışında bağlanmasının doğrulanması.
- Sayım önizleme/onay, stok birimleri, yinelenen kayıt uyarıları ve başarısı belirsiz yazma sonrası tekrar deneme güvenliği.
- Personel/maaş/izin, bütçe/gider ve ayarların ürün denetimindeki kabul şartlarına göre tamamlanması.
- Hesap–işletme–cihaz, bulut aktarımı/geri yükleme ve güvenli ayrılma; bu işler ilk dilimde uygulanmadı.
- Tüm roller, fiziksel LAN, ağ/elektrik kesintisi, yazıcı ve dolu cari ekstre/iade doğrulaması.

Gece bitirme hedefi ürünün hazır olduğu iddiası değildir; üretim kararı bu açıklar kapandığında verilir.

## Genişletilmiş uygulama dilimi

- Ürün formundan kategori, kategori formundan istasyon oluşturma açıldı. Sunucunun döndürdüğü kimlik korunur; kategori/ürün listesi değişince üstteki ürün taslağı sıfırlanmaz.
- Kategori oluşturulup üst kategori bağlantısı başarısız olursa aynı kategoriyle yeniden denenir; ada göre kayıt arama kaldırıldı.
- Hızlı stok girişinde sipariş oluşturma yanıtı doğrudan kullanılır. Liste yenilemesi başarısızsa oluşturulmuş sipariş kimliği kaybolmaz ve hata, kaydın tamamlanmış olduğunu belirtir.
- Sipariş oluşup teslim reddedilirse hızlı giriş alanları sabitlenir; yeniden deneme aynı siparişin teslimine gider. Farklı miktar/ürünle sessizce ikinci sipariş açılamaz. Bekleyen kimlik kiracıyla eşleştirilir.
- Bu koruma yalnız oluşturma yanıtının alındığı ve uygulama belleğinin korunduğu durum içindir. Süreç kapanırsa bekleyen sipariş satın alma listesindedir; otomatik devam için kalıcı istemci işlem kimliği ve sonuç sorgulaması henüz tamamlanmadı. Yanıtı kaybolan yazmanın güvenli yeniden denenmesi çözülmüş sayılmaz.
- Aynı ürünün satın almada yinelenmesi ortak store sınırında da reddedilir. Sipariş/teslim sürerken aynı store yazması yeniden başlatılmaz.
- Satın almadaki ikinci tedarikçi oluşturma paneli kaldırıldı. Tedarikçi oluşturma penceresinde Türkçe karaktere dayanıklı benzer kayıtlar seçilebilir; otomatik birleştirme yapılmaz.
- Sayım ve firede ortak ürün arama/oluşturma akışı kullanılır. Sayım ve fire yazmaları sürerken alanlar ve işlem düğmeleri kilitlenir. Sayımı stoğa uygulama ayrı onay ister; boş sayım kapanışa gönderilmez.
- Seçenek grubu oluşturulduğu halde ürüne bağlama reddedilirse pencere kapanmaz; oluşturulmuş grupla bağlantı yeniden denenir. Grup kimliği listenin son sırasından tahmin edilmez. Seçim sınırları tam sayı olarak doğrulanır.
- Seçenek penceresi ortak Modal bileşenine taşındı. Ortak onay penceresi, işlem sürerken kapanmayı ve aynı onayın tekrar gönderilmesini engeller.

### Bu dilimin doğrulaması

- Frontend 138/138 test geçti; son build geçti. Yeni stok hata senaryoları ve seçenek grubu sözleşmesi testleri önce başarısız, uygulama sonrasında başarılı koşuldu.
- Backend fmt ve clippy temiz. Tam test 1147/1148: `network_tests::iki_kurulum_eslesir_para_cogunlukla_yazilir_cihaz_kaybinda_durur` ödeme sırasında `QUORUM_LOST` ile başarısız oldu. Aynı test tek başına yeniden koşulunca geçti (4,78 saniye). Yük altında LAN kararlılığı hâlâ açık; bu turda LAN motoru değiştirilmedi.
- SSR NumberInput uyarıları ve yaklaşık 610 kB frontend paket uyarısı sürüyor. Yeni bağımlılık eklenmedi.
- Gerçek uygulama yeniden görüntülendi; PIN ekranında kaldığı için bu dilimin tıklayarak uçtan uca doğrulaması yapılmadı. Kimlik doğrulama ekranına otomasyonla müdahale edilmedi.

## Gerçek uygulama kontrolü — oturum izni sonrasında

- Kullanıcının bu oturum için açık giriş izniyle yalnız ayrılmış test veritabanındaki test hesabı kullanıldı.
- Ürün taslağına ad yazıldı; aynı ekrandan kategori, onun içinden istasyon oluşturuldu. İstasyon ve kategori seçildi; üstteki ürün adı korundu. Ürün 25 TL olarak kaydedilip tekrar açıldı.
- Üründen seçenek grubu oluşturuldu; grubun ürüne bağlı kutusu işaretli geldi. Ürün yeniden açıldığında bağlantı korundu.
- Hızlı stok girişine önce 2,5 miktar ve 40 TL fiyat girildi. Tedarikçi ve kg birimli hammadde oluşturulup otomatik seçildi; miktar/fiyat korundu.
- Hızlı giriş sonrası ekran 2,5 kg ve 100 TL gösterdi. Test SQLite dosyasında parti miktarı 2,5, birim maliyet 4000 kuruş ve hammaddenin `is_active=0` olduğu okundu.
- Kör sayımda aynı hammadde 2 kg olarak kaydedildi; kapanış öncesi beklenen miktar gösterilmedi. Ayrı kapanış onayı açıldı. Onay sonrası fark −0,5 ve maliyet −20 TL çıktı; partinin kalan miktarı veritabanında 2 kg olarak doğrulandı.
- Aynı ürünün reçetesine 0,1 kg hammadde seçildi; birim otomatik kg oldu. Reçete kaydedildi ve FIFO maliyeti 4 TL göründü.
- Ana veritabanındaki bu iki test ürününün sayısı sıfır; test kayıtları inceleme kopyasında kaldı.
- Ekranda saptanan sayım/fire düğmesi ve seçim alanlarının satır yüksekliğine gereksiz yayılması `items-start` ile düzeltildi; ekranda yeniden görüldü. Satın alma kalemlerine de aynı düzeltme uygulandı. Sayım/reçete/stok miktarları mevcut Türkçe sayı biçimleyicisine geçirildi.
- Kod kontrolünde menüden fiyatsız ürünün önce aktif oluşturulup ikinci istekle kapatıldığı saptandı. Yeni ürün oluşturma isteği artık sıfır fiyat için doğrudan `isActive=false` gönderir; ikinci kapatma kaldırıldı. Regresyon testi önce başarısız, düzeltmeyle başarılı oldu.

### Son doğrulama ve üretim engeli

- Frontend 139/139 test geçti; son build geçti. Son fiyat tipi doğrulamasından sonra menü testleri ayrıca 25/25 geçti.
- Backend fmt/clippy temiz; son tam test 1144/1148. Başarısızlar: `uc_cihazda_otorite_kaybolunca_kalan_ikisi_devam_eder`, `ayni_kalemi_iki_kasa_ayni_anda_tahsil_edemez`, `sahip_kaybolan_cihazi_birakip_tek_cihazla_devam_edebilir`, `denetim_zinciri_iki_cihazda_birebir_ayni_kalir`.
- **Kritik:** Eş zamanlı tahsilat testinde iki çağrı da `Ok(())` döndü; beklenen tek başarıydı. Test satış/stok sayısı denetimine ulaşmadan durduğundan bu çıktı tek başına iki kalıcı tahsilat yapıldığını kanıtlamaz. Yine de güvenli kabul edilemez ve yalnız zaman aşımı diye geçiştirilemez.
- Aynı eş zamanlı tahsilat testi tek başına 1/1 geçti (1,62 saniye). Bu, tam koşudaki ihlali kapatmaz. Sonraki öncelik çoğaltılan yazmanın kabul/uygulama sonucu, durum sürümü ve gerçek satış/stok kayıtlarıyla bu senaryoyu teşhis etmektir. Bu turda LAN motoruna varsayımsal düzeltme yapılmadı.
- Yeni formların tüm iptal/hata dalları, tüm roller, gerçek fiziksel cihazlar ve ağ kesintisi bu masaüstü kontrolünde kapsamlı sınanmadı.

## LAN üyeliği geçişinde yazma koruması

- Bekleyen üyelik kaydı ile yazma tetikleyicilerinin kurulması arasındaki açıklık iki ayrı testte yerel yazmaya izin verdi. Üçüncü test, diskteki çoklu üyelik ile eski ekran önbelleğinin farklı yazma yolları seçtiğini gösterdi.
- Yazma yolu artık kilit altındaki kalıcı üyeliği ve durum sürümünü kullanır. Üyelik onaylanana kadar yazma `SYNC_RETRY` ile durur ve cihaz hazır görünmez. Başlangıçta tetikleyiciler tek veritabanı işlemi içinde yenilenir.
- Üç yeni regresyon testi geçti. LAN paketi 60/60, normal paralellikle iki tam backend koşusu 1151/1151 geçti. Clippy, format, 139 frontend testi ve frontend derlemesi geçti. Windows uygulaması derlendi. Fiziksel cihazlarla saha doğrulaması bekliyor.
