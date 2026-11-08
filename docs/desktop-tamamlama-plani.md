# Desktop frontend ve operasyon tamamlama planı

> Uygulayıcı: `executing-plans`; davranış değişikliklerinde anlamlı test; finans/RBAC değişikliğinde backend testi zorunlu. [Ana plan](uygulama-tamamlama-plani.md), [tasarım](tasarim-ve-deneyim-plani.md), [kontratlar](sozlesmeler-ve-backend-plani.md) birlikte uygulanır.

**Amaç:** Açılıştan gün sonuna kadar hızlı, tutarlı, yeni tasarımlı ve ağ kesilse de güvenilir bir masaüstü ürünü.

**Mimari/teknoloji:** Yeni React/Tailwind frontend; mevcut Rust motoruna tipli IPC adaptörleri. Store'lar domain verisi ile geçici UI durumunu ayırır. Yeniden yazım modül modül yapılır; test edilmiş operasyon tamamlanmadan eski yol silinmez. Bir modül için aynı anda tek mutasyon sahibi bulunur.

**Dosya yolu kuralı:** Bu dosyadaki kısaltılmış `features/`, `stores/`, `ui/` yollarının kökü `kasam360/desktop/src/` dizinidir. `backend/` yolları KASAM360 depo köküne göredir. Süslü parantezli dosya listesi ayrı ayrı dosyaları belirtir; uygulayıcı glob adıyla yeni dosya oluşturmaz.

## Kabuk ve ekran sahipliği

Sol menü önerisi: Salon, Sipariş, Mutfak, Kasa; Yönetim altında Pano, Raporlar, Menü, Stok, Cari, Personel, Finans; Ayarlar ayrı. Rollere göre görünürlük azalır. Lisans/rol erişimi yalnız menüde değil route/kısayol/IPC'de de denetlenir. MASTER, işletme POS'una alınmaz; güvenli Labs bağlantısı ve oturum değişimi sunulur.

Her modül başlığında işle ilgili durum bulunur; genel uyarılar için açılabilir durum merkezi vardır. Normal durumda ekranı kaplayan bir servis panosu yok. Aktif personel, işletme ve kilitle eylemi kabukta bulunur; logout, kilit ve vardiya kapatma ayrı işlemlerdir.

| Alan | Alt ekran/yüzey kapsamı | Görev |
|---|---|---|
| Giriş/kurulum | Web hesabı, Google eşleme, işletme oluştur/seç, ilk OWNER PIN, kurulum adımları, mevcut cihaz eşleme, cloud restore, PIN değişimi | P02 |
| Oturum | Yerel PIN giriş, lock, kullanıcı değişimi, hareketsizlik, yetki onayı, MASTER yönü | P03 |
| Salon | Bölge/masa/kroki, kişi sayısı, masa detayı, rezervasyon, taşı/birleştir | P04 |
| Sipariş/ödeme | Arama/kategori/ürün/modifier, satır işlemleri, not, mutfağa gönder, indirim/ikram/iptal, parçalı nakit/kart/bahşiş, fiş | P04/P05 |
| Mutfak | İstasyon, bekleyen/hazırlanan/hazır, süre, teslim, yeni bilet uyarısı | P06 |
| Kasa | Vardiya aç/kapat, nakit hareket/gider, değişiklik talepleri, iade, makbuzlar, vardiya geçmişi/gün sonu | P05 |
| Ürün | Kategori, ürün temel/fiyat/modifier/reçete/menü, toplu işlemler, tarife | P07 |
| Stok | Genel görünüm, ürün/stok kartı, giriş/lot, tedarikçi/bekleyen alış, reçete, fire, hareket, sayım | P08 |
| Cari | Kart, açılış borcu, işlem, tahsilat/ödeme, ekstre, bekleyen alış | P09 |
| Personel | Kart/rol/PIN, vardiya planı, izin, avans, bordro kuralları/dönem, bahşiş, personel hareketleri | P10 |
| Finans/rapor | Pano/uyarılar/hedefler/menü analizi, kar-zarar, gider/tekrarlayan gider, rapor sekmeleri, export/audit | P11 |
| Ayarlar | Hesap/tema/oturum, masa/kroki/istasyon, cihaz/LAN/bulut, yazıcı, yedek/restore, lisans/güncelleme, arşiv/QR | P12 |

Bu tablo minimumdur; D01 taramasında başka giriş noktası bulunursa ilgili göreve eklenir. Yetki veya paket nedeniyle görünmeyen ekran “yok” sayılmaz. Eski deneysel ekranlar referansı ve amacı incelendikten sonra kaldırılır ya da açık geliştirme araçlarına alınır; üretim menüsünde unutulmaz.

## P01 — Yeni kabuk ve kontrollü frontend geçişi

Bağımlılık: D02–D04, C01/C06. Dosyalar: `desktop/src/app/{App,access,ErrorBoundary}.tsx/ts`, `features/shell/{SidebarNav,SyncStatusChip}.tsx`, `stores/{uiStore,shiftStore,licenseStore}.ts`.

- [ ] Route/modül erişimini tek policy üzerinden çağır; F3 ve diğer kısayollar aynı kontrolden geçer. Gizli mount edilmiş yetkisiz modül veri çekemez.
- [ ] Menü/sekme/aksiyon ayrımını yeni tasarımla kur; metinli nav, aktif durum ve başlık. Responsive'de menü daralır fakat adlara klavye ile erişilir.
- [ ] Vardiya tek yetkili kaynaktan beslenir; salon/kasa/pano/sidebar aynı shiftId/status kullanır. B08 kök nedenini ölçmeden sadece etiketi değiştirme.
- [ ] Yerel bağlantı, bulut, lisans ve yedek için açılır durum merkezi; kritik hata ilgili ekranda kalıcı. B09/B19 durumları ortak DataState ile ayrılır.
- [ ] Yeni modül geçişleri adaptör arkasında; mutasyon double dispatch testi. App seviyesinde beklenmeyen hata veri silmez, yeniden dene/tanılama yolu sunar.
- [ ] Kabul: OWNER/WAITER/KITCHEN/MASTER farklı menü; doğrudan route ve F3 deny; shift etiketi üç ekranda aynı; yeni kabuk D08 ekran matrisiyle doğrulanır.

## P02 — Temiz kurulum, web hesabı ve cihaz aktivasyonu

Bağımlılık: C02/C06/C07, W07. Dosyalar: `features/setup/{SetupGate,SetupWizard,NewBusinessForm,WebAccountForms,GoogleSetupButton}.tsx`, `features/setup/cloudRestore.ts`, `features/auth/{AccountGate,AccountLogin,GoogleDeviceButton}.tsx`, backend setup/account/device komutları.

- [ ] İlk açılış durumunu ayır: temiz cihaz, yarım kurulum, mevcut yerel DB, güncelleme sonrası, buluttan geri dönüş. Boş DB sanıp mevcut veriye yeni tenant yazma.
- [ ] İlk lisanslı etkinleştirme internet gerektirir; bunu açık anlat. Sonraki offline çalışmayı bununla karıştırma. Kullanıcı web hesabına tarayıcı üzerinden bağlanır; parola yerel PIN yerine geçmez.
- [ ] İşletme seç/yeni oluştur; cihaz limiti ve paket durumunu göster; cihaz bağlanmadan satış hazır sayılmaz. Mevcut işletme restore/eşleme ile yeni işletme oluşturma ayrı seçenek.
- [ ] Yalnız yeni işletmede ilk OWNER PIN kullanıcı tarafından belirlenir, tekrar doğrulanır; Argon2id; varsayılan hesap/PIN yok. Mevcut işletmeye ek cihaz mevcut personel kimliklerini güvenli snapshot'tan alır, ikinci OWNER yaratmaz. Kurulum ilerlemesi güvenli şekilde kalıcı, tekrar açılışta aynı tenant'tan devam.
- [ ] Sonraki adımlar: işletme para birimi/saat dilimi, masa alanı, ilk ürün, mutfak istasyonu gerekiyorsa, yazıcı denemesi, ilk yedek. Zorunlu ve sonra tamamlanabilir adımlar açık.
- [ ] Kabul: temiz kurulumdan ilk vardiyaya ulaşılır; yarıda kapanıp açılınca ikinci OWNER/tenant oluşmaz; yanlış restore tenant'ı reddedilir; stok/finans mevcutsa üzerine yazma uyarısız yapılamaz.

## P03 — Login, lock ve personel yetkisi

Bağımlılık: D02/D04, C06/C11. Dosyalar: `features/auth/{LoginOverlay,LockScreen,MustChangePinModal}.tsx`, `features/payment/ManagerPinPrompt.tsx`, `stores/authStore.ts`, backend `commands/auth_commands/`, `services/staff_session.rs`.

- [ ] Login/lock'ı yeni kompozisyonla yeniden yaz; büyük ve net PIN tuşları, fiziksel klavye, maskeli giriş, hata ve bekleme sayacı; hassas rapor arka planda görünmez.
- [ ] Hareketsizlik kilidi, elle kilit ve kullanıcı değişimi; lock'ta kimin geçerli PIN'i girildiyse onun yeni session'ı açılır. Önceki rol/store/veri cache'i temizlenir.
- [ ] Beş yanlış deneme geçici kilit; yeniden başlatma/çok istek bypass denemesi. Başka tenant PIN'i ve pasif kullanıcı reddedilir; eski fabrika PIN'i olan hesap zorunlu değişimden kaçamaz.
- [ ] Yönetici onayı işlem kapsamına ve kısa süreye bağlı tek kullanımlı grant; PIN doğrulaması çalışan personeli kalıcı yönetici yapmaz. Toplam/kalem değişince önceki onay yeniden kullanılamaz.
- [ ] Kabul: WAITER→OWNER→WAITER geçişinde maaş/ödeme sızmaz; kilitlenirken açık formın güvenli korunma/iptal davranışı belirli; brute force ve grant replay backend testi geçer.

## P04 — Salon ve sipariş alma

Bağımlılık: P01/P03, C09, D03–D06. Dosyalar: `features/floor/{FloorModule,TableSlideOver,ReservationModal}.tsx`, `features/pos/{PosModule,ProductCatalog,OrderTicket,OrderTicketLineItem,SmartAuthModal}.tsx`; ilgili floor/pos store ve Rust komutları.

- [ ] Masa durumu boş/açık/ödeme bekliyor/rezerve renk+metin; seçili masa özeti, kişi sayısı, süre ve tutar. Yanlış masaya sipariş vermeyi önleyen görünür masa başlığı.
- [ ] Kategori/arama ve ürün alanı, sabit sipariş kolonuyla yeni POS. Uzun ürün/modifier adı, sold-out, fiyat farkı, not ve miktar kontrolleri; klavye odağı arama sonuçlarında kararlı.
- [ ] Masa seçilmemişse seçenek sun; tezgahtan satış desteklenecekse ayrı sipariş türü/backend sözleşmesi gerekir. Kullanıcıyı yalnız hata metninde bırakma; olmayan walk-in işlevi uydurma.
- [ ] Sipariş oluştur/güncelle/gönder eylemleri idempotent; düğme tekrarında kopya kalem yok. Mutfak gönderiminden sonra değişiklik yeni olay olarak izlenir.
- [ ] Taşı/birleştir/rezervasyon: kaynak ve hedef önizlemesi, yetki, aktif ödeme/diğer cihaz değişikliği çatışması; geri bildirim doğru masaya döner.
- [ ] Kabul: ürün ekle→modifier→not→gönder→başka masaya dön→yeniden aç; fiyat/KDV snapshot aynı. İki cihaz düzenlemesinde sessiz kayıp yok; kapatıp açınca kaydedilmiş sipariş geri gelir.

## P05 — Ödeme, kasa ve gün sonu

Bağımlılık: P04/C09, D04/D05. Dosyalar: `features/payment/{PaymentModal,PaymentChannelSection,TipDialog}.tsx`, `features/cashier/*`, `features/shift/ShiftGateModal.tsx`, `features/receipt/ReceiptPreviewModal.tsx`; backend ödeme/kasa/vardiya/iade komutları.

- [ ] Tahsilat ekranı: toplam/ödenen/kalan, nakit/kart, girilen tutar/para üstü, bölme ve bahşiş. Fiziksel kart terminal entegrasyonu yoksa “kart tahsilatı kaydı” olarak açık, otomatik çekim yapılıyor izlenimi yok.
- [ ] İşlem sürerken çift gönderim kapalı; belirsiz sonuçta transaction ID üzerinden durum sorgula. Başarı yerel commit sonrası; hata formda kalır; modaldan çıkınca ödeme sessiz tekrar edilmez.
- [ ] İndirim/ikram/iptal için doğru rol/grant ve sebep; PAID/CLOSED iptal olmaz, iade ayrı akış. Parçalı iade kalan iade edilebilir tutarı aşamaz.
- [ ] Vardiya açılış nakdi, kasa giriş/çıkış/gider, fiş, değişiklik talebi ve hareket geçmişi aynı kayıt kaynağına bağlı. Açık vardiya varken ikinci vardiya kontrolü backend'de.
- [ ] Kapanış: beklenen nakit/kart ayrı, kör sayım politikasına uygun giriş, fark ve açıklama; açık sipariş/bekleyen ödeme/print işlerinin etkisi. Vardiya kapanınca tüm modüller yenilenir.
- [ ] Kabul: Q04 tutar fixture'ı; iki cihaz aynı ödeme, double-click, timeout, süreç crash, kısmi tahsilat ve iade. Gün sonu kaydı ile audit ve rapor tutarları/tarih aralığı eşleşir; B08 anomalisinin gerçek nedeni kapatılır.

## P06 — Mutfak ekranı ve servis teslimi

Bağımlılık: P04/C06. Dosyalar: `features/kds/KdsModule.tsx`, KDS store/komutları, `features/patron/settings/StationSettings.tsx`.

- [ ] İstasyon filtresi ve bekleyen/hazırlanan/hazır durumları; bilette masa, süre, kişi gerekiyorsa, modifier/not, yeni/değişen/iptal edilen satır ayrımı.
- [ ] İstasyonu olmayan ürün için kurulum eylemi; boş mutfak ile veri/bağlantı hatası ayrı. Sipariş alınmış ama mutfağa iletilmemişse kaybolmuş gibi gösterme.
- [ ] Durum değişikliği tek olay; aynı bilete iki cihaz aksiyonu idempotent/çatışma kontrollü. KITCHEN yalnız izinli akışa erişir, fiyat/maaş gereksiz gösterilmez.
- [ ] Ses tercihi ve görünür karşılık; ses kapalıyken bilgi kaybolmaz. Uzun süre uyarısı renge ek süre etiketiyle.
- [ ] Kabul: POS gönderimi KDS'de tek görünür; hazırlama→hazır→teslim; ağ kopup gelince bilet tekrarı yok; `feat_kds` kapalıyken F3/route/IPC deny.

## P07 — Menü, ürün, modifier ve tarifeler

Bağımlılık: D03/D04, C09. Dosyalar: `features/menu/{MenuModule,MenuCatalogTab,MenuDetailPanel,MenuDetailTemel,MenuDetailModifiye,MenuFiyatTab,MenuRecipeTab,MenuCategoryTree,MenuCategoryModal,MenuModifierModal,TariffPanel,TariffFormModal,ProductMenuSettings,CatalogBulkBar,ProductActions}.tsx`.

- [ ] Liste arama/kategori/durum/fiyat, toplu seçim; ürün kartı ile düzenleme aksiyonu ayrı. Uzun ad tam erişilebilir, liste/filtre dönüşü korunur.
- [ ] Yeni ürün formunu iki dengeli sütun ve sabit kaydet/iptal altlığıyla kur; temel bilgiler, satış fiyat/KDV, kategori, modifier, istasyon ve reçete bağlamlı sekmeler. Hata hangi sekmedeyse görünür özet ve bağlantı.
- [ ] Fiyat integer cents; negatif modifier yasak; zorunlu/min/max modifier seçimi ve satışa kapalı ürün kuralları. Ürün silmek geçmiş sipariş ad/fiyat snapshot'ını bozmaz.
- [ ] Tarife/dinamik fiyat özelliği kapalıysa modül rotası ve mutasyon reddedilir; geçmiş yalnız ayrı rol korumalı Geçmiş ve Veri Dışa Aktarımı yüzeyinden okunur. Saat aralığı/çakışma/para birimi server-side doğrulanır; açık sipariş fiyatı güncellenmez.
- [ ] Kabul: yeni ürün→modifier→POS satışı→fiyat değiştir→eski sipariş aynı; uzun formda aksiyon görünür; kaydet hatasında veri kaybolmaz; B20 kapanır.

## P08 — Stok, reçete, lot ve sayım

Bağımlılık: C09/P07. Dosyalar: `features/stock/{StockHub,StockOverview,StockItemEditor,StockItemDetails,StockEntryModal,StockRecipes,StockWastePanel,StockTrailPanel,PendingStockReceipts,ReceiptOptions}.tsx`; yeni `features/stock/StockCountPanel.tsx` yalnız yeni doğrulanmış akışla; Rust inventory servisleri.

- [ ] Stok kartı, satış ürünü ve reçete ilişkisini anlaşılır yap. Miktar birimleri ve dönüşüm ölçekleri açık; miktar hesabı sabit ölçek/rasyonel, maliyet cents. Kullanıcı stok ürününü yanlışlıkla menü ürünü sanmasın.
- [ ] Giriş: tedarikçi/belge/lot/miktar/birim maliyet/tarih; tekrar kaydet aynı belgeyi iki kez işlemez. Bekleyen alışın onay etkisi cari ve stock'ta birlikte görünür.
- [ ] Reçete versiyonu, maliyet eksik kalem, döngüsel reçete ve geçersiz birim; FIFO lot tüketim izi. Eksik maliyet raporu hata gibi değil tamamlanacak veri olarak görünür.
- [ ] Fire: miktar/neden/rol/audit; iade/iptal stok etkisi tanımlı. Negatif stok politikasını mevcut motorla belgeleyip test et; eksi stok izni varsa uydurma FIFO maliyeti üretme, maliyet belirsizliği açık ve finansal raporda görünür olmalı.
- [ ] Sayım: oturum başlat, sayılan miktar, arada oluşan hareketleri ayır, fark önizle, yetkili onay, düzeltme hareketi. Sayım “stok değerini overwrite et” işlemi değildir. B14'te silinen eski paneli kör geri yükleme.
- [ ] Kabul: Q04 iki lot maliyeti, parçalı ödemede tek düşüm, sayım sırasında satış ve iptal/fire senaryoları; stok hareketi/cari/audit bağımsız mutabık.

## P09 — Cari ve tedarikçi işlemleri

Bağımlılık: C09/P08. Dosyalar: `features/patron/{CariCardDetail,CariCardModal,CariOpenDebtModal,CariEditDebtModal,CariOperationForm,CariPaymentModal,CariStatement,CariPendingReceipts,DebtsTab}.tsx`; `backend/src/services/cari/`.

- [ ] Cari listesi borç/alacak anlamı, para birimi ve dönem; müşteri/tedarikçi türü; detayda hareket ve belge. Bakiye sorgusu hatası sıfır bakiye olmaz.
- [ ] Açılış bakiyesi, alış, tahsilat/ödeme, iade ve düzeltme ayrı hareket türleri. Kaydedilmiş finansal kaydı gerekçesiz değiştir/sil yerine izinli ters kayıt/düzeltme yolu.
- [ ] Ödeme kanalının kasa etkisini önizle; aynı para hem kasa hem cari tarafından ayrı ayrı çekilmiş gibi kaydedilmez. Bekleyen alış onayı transaction sınırı C09 ile ortak.
- [ ] Kabul: tedarikçi alış→kısmi ödeme→iade→ekstre toplamı; retry aynı hareketi iki kez oluşturmaz; `feat_ledger_cari` kapalıyken cari rotası/IPC mutasyonu reddedilir, geçmiş yalnız ayrı izinli rapor/export yüzeyinde okunur.

## P10 — Personel, bordro ve bahşiş

Bağımlılık: P03/C09. Dosyalar: `features/patron/{StaffFormModal,TipPoolPanel}.tsx`, `features/patron/{staff,payroll}/`, backend `services/staff360/`.

- [ ] Personel oluştur/rol/aktiflik/PIN yenile; ücret alanları OWNER'a özel. MANAGER için sadece UI gizleme değil IPC response alanlarının da korunması.
- [ ] Vardiya planı, çalışma kayıtları, izin, avans ve bordro kural editörü; tarih aralığı/gece yarısı/timezone ve çakışma. Pasif personele yeni yetki verilmez, geçmiş hareket silinmez.
- [ ] Bordro taslak→hesapla→gözden geçir→kesinleştir; değişiklik etkisi açık, tekrar ödeme engelli. Hukuki bordro/mevzuat uyumu yetkili değerlendirme olmadan iddia edilmez.
- [ ] Bahşiş havuzu/paylaşım kuralları, dahil çalışanlar ve yuvarlama; dağıtılan cents toplamı havuzla tam eşit. Artık kuruş deterministik kuralla dağıtılır.
- [ ] Kabul: MANAGER maaşı doğrudan komutla da okuyamaz; pasif çalışan lock açamaz; aynı dönem/avans retry çift ödeme yaratmaz; plan/izin/bahşiş boş ve dolu ekranları D08'de.

## P11 — Pano, finans ve raporlar

Bağımlılık: C08/C09, P05/P08. Dosyalar: `features/patron/{panorama,finance,reports}/`, `CriticalLogTab.tsx`; backend analytics/report servisleri.

- [ ] Pano karar odaklı: gerçek satış/ödeme/kar verisi, çözülmemiş operasyon uyarısı, eksik maliyet/setup. BCG teknik kısaltması ve ham hata yerine menü karlılığı açıklaması (B17).
- [ ] Dönem filtresi tek timezone ve iş günü tanımı; sıfır/hesaplanamıyor/önceki dönem yok ayrımı. Kâr maliyet eksikken kesin rakam gibi sunulmaz.
- [ ] Finans: gelir/gider, tekrarlayan gider, hedef/bütçe ve kar-zarar; otomatik gider tekrar üretimi idempotent. Tahsilat ile gelir kavramları tanımlı, nakit/kart ayrı izlenir.
- [ ] Rapor sekmeleri satış/vardiya/iptal/iade/fire/personel/kâr; rol filtresi server-side; satırdan kaynağa drill-down. Export ekrandaki dönem/filtre/tenant ile aynı; CSV/Excel formül enjeksiyonu önlenir.
- [ ] Audit ekranı append-only kayıt gösterir; teknik hata audit yok anlamına gelmez. Uzun listeler sayfalı, büyük export işi bekliyor/başarısız durum taşır.
- [ ] Kabul: Q04/Q05 verileriyle ekran→export→DB toplamları eşit; B08 tarih/shift farkı giderilir; WAITER rapor/maaş export alamaz; “bekleyen uyarı yok” cloud blocked iken gösterilmez.

## P12 — Ayarlar, QR, yedek, yazıcı ve güncelleme

Bağımlılık: C06/C07, R01/R02 sözleşmeleri. Dosyalar: `features/patron/{BackupPanel,SessionSettingsTab,QrMenuPanel}.tsx`, `features/patron/settings/`, backend backup/print/update komutları.

- [ ] Ayarlar yeni kategori düzeni: işletme, oturum/tema, salon/istasyon, cihazlar/LAN, bulut, yazıcı, yedek, lisans/güncelleme. Her tercih otomatik mi Kaydet ile mi açık; bekleyen değişiklik kaybolmaz.
- [ ] Bulut reddinin nedenini correlationId ile çöz; queued sayısı/son başarı/son hata/tekrar dene/çakışma listesi. LAN ready ile bulut synced aynı badge değil.
- [ ] Yedek loading/none/error/ready ayrı; tarih/boyut/konum/integrity; restore öncesi mevcut DB yedeği, tenant/schema kontrolü, sonuç mutabakatı ve yeniden başlatma. Sadece “yedek alındı” toast'ı test değil.
- [ ] Yazıcı seç/test baskısı/kağıt genişliği/kopya/istasyon; yazıcı offline, kâğıt bitti, kuyruk ve tekrar baskı. Tekrar baskı yeni satış oluşturmaz; adisyon mali belge olarak etiketlenmez.
- [ ] QR menüyü gerçek navigasyona bağla (B13): yalnız yayınlanmış müşteri alanları, stok/maaş/maliyet yok. Sipariş özelliği ayrıca doğrulanmadıysa görüntüleme ile sınırlı ve fiyat sayfası buna uygun. Public menü tenant token/slug, rate limit, sürüm/cache ve unavailable ürün davranışı taşır.
- [ ] Legacy archive salt okunur ve yetkili; test araçları production'da görünmez. Güncelleme ekranı sürüm/imza/yedek/uygun zaman bilgisiyle R02'ye bağlanır.
- [ ] Kabul: bozuk yedek reddedilir, temiz cihaza restore tutar/kayıt/hash eşleşir; QR başka tenant'a sızmaz; yazıcı kesintisinde tahsilat bozulmaz; başarısız update veri silmez.

## P13 — Masaüstü tam kullanım kabulü

Bağımlılık: P01–P12, D08, Q03–Q05. Dosyalar: yeni `docs/desktop-acceptance.md`, ekran/test kanıtları.

- [ ] Temiz kurulum→OWNER→personel→menü/reçete/masa→vardiya→sipariş→mutfak→nakit/kart→iade→sayım→gün sonu→yedek zincirini gerçek yerel uygulamada test et.
- [ ] Aynı zinciri internet yokken; sonra internet/LAN kesintisi ve yeniden katılma altında kritik alt senaryolarla çalıştır. UI mock'u gerçek Tauri/SQLite kabulünün yerine geçmez.
- [ ] Her rol/paket kombinasyonunda ana ekran/kısayol/doğrudan komut denetimi. Eski UI kalıntıları, orphan bileşenler ve çelişen durumlar için D01 listesi son kez karşılaştırılır.
- [ ] B02–B06/B08–B09/B13–B14/B17/B19–B22 kanıtla kapatılır; kapatılamayan “çalışıyor” yazılmaz. Donanım yoksa yazıcı/terminal testleri bekliyor kalır.
- [ ] Kabul: test komutları ve Q matrisi geçmiş; tüm kritik ekranlar D08'den geçmiş; ürünün offline/lisans/satış vaatleri gerçek davranışla aynı.
