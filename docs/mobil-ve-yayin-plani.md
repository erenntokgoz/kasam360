# Mobil, dağıtım ve üretim uygulama planı

> Uygulayıcı: `executing-plans`, `verification-before-completion`. [Ana plan](uygulama-tamamlama-plani.md) ve [kabul matrisi](kabul-ve-is-devri.md) birlikte uygulanır. Bu dosya mağaza onayı veya production'a çıkış yetkisi vermez; hazırlık görevlerini tanımlar.

**Amaç:** Aynı iş kuralları ve marka dilini mobilde güvenli çalıştırmak; Windows ve mobil için imzalı, geri kazanılabilir ve desteklenebilir dağıtım yapmak.

**Mimari/teknoloji:** Öncelikli aday Tauri 2 mobil + paylaşılabilen Rust domain çekirdeği ve React tasarım token'larıdır. Bu bir uygulanmış fizibilite sonucu değildir; M01 kanıtı mimariyi kesinleştirir. Uzak Hono API'sini kullanmak yerel POS motorunu telefona otomatik taşımış olmaz.

## M01 — Mobil fizibilite ve mimari kararı

Bağımlılık: C01/C07; G3 öncesi erken yapılabilir. Dosyalar: yeni `docs/mobile/feasibility.md`; teknik deneme için ayrı dal/izole çalışma alanı, gerekli Tauri mobile config ve platform adapter'ları.

- [ ] Rust bağımlılıklarını Android/iOS derlemesi açısından tarayarak tablo çıkar: SQLite/sqlx, crypto, dosya/yedek, LAN keşfi, socket, print, updater, pencere/tray/single-instance. Desktop-only çağrılar platform adapter'ına alınır.
- [ ] Gerçek Android cihazda ve gerçek iPhone/iPad üzerinde build→kurulum→SQLite transaction→restart→aynı kaydı oku denemesi. iOS için gerekli Mac/Xcode/imza ortamı yoksa bu açık engel; simülatör tek başına final kanıt değil.
- [ ] Internet yok/LAN var, ikisi de yok, arka plana al/OS kapatsın, ekran kilitle/aç, ağ değiştir, büyük kuyruk yeniden gönder senaryolarını dene. Background'da sürekli server/leader çalışma varsayma.
- [ ] Yazıcı/terminal aday cihazlarıyla en az bir gerçek bağlantı denemesi; desteklenmeyeni “desktop ile aynı” diye listeleme. Dosya export/share ve güvenli token depolama kanıtı.
- [ ] Karar: testler geçerse Tauri mobil ve ortak Rust çekirdeği. Geçmeyen zorunlu kabiliyet varsa yalnız gerekli adapter native yapılır; mimari engel sürerse React Native/native istemci + aynı API/domain kontratı maliyeti kullanıcıya somut farkla sunulur. Tüm motoru TS'ye sessizce yeniden yazma.
- [ ] Kabul: cihaz/OS/sürüm, çalışan ve çalışmayan kabiliyetler, offline sınırları ve mimari karar kaydı. M02 bu karar olmadan tam ekran üretimine başlamaz.

## M02 — Paylaşılan kod ve mobil uygulama kabuğu

Bağımlılık: M01, G3, D03. Dosyalar: M01 sonucuna göre yeni `mobile/`; yeni `docs/mobile/module-map.md`; ortak kontrat/token kaynağı ve platform adapter'ları.

- [ ] Paylaşılacakları açık ayır: domain tipleri, erişim politikası testleri, para/tarih formatı, token'lar, mümkün olan Rust servisleri. Paylaşılmayacaklar: pencere, yazıcı, dosya seçici, safe-area, mobile navigation.
- [ ] Telefon navigasyonu: rolüne göre en fazla 4 ana sekme + Diğer; tablet: desktopa yakın yan menü. Aynı işi aynı terim/ikon/hiyerarşiyle sun, desktop kolonlarını telefona sıkıştırma.
- [ ] Safe area, sanal klavye, orientation, büyük yazı, ekran okuyucu, 48px+ dokunma hedefi; touch hover'a bağlı bilgi yok. Offline/license durum merkezi korunur.
- [ ] Android Back: önce iç seçim/dialog, sonra route; kaydedilmemiş form uyarısı; uygulamadan çıkış finansal işlemi yarım bırakmaz. iOS gezinme jestiyle aynı koruma.
- [ ] Kabul: ortak fixture'lar desktop/mobile aynı cents/rol/feature kararını verir; tema ve tipografi aynı aile, gerçek telefon görevleri kullanılabilir.

## M03 — Mobil kurulum, kimlik ve günlük operasyon

Bağımlılık: M02, C06. Dosyalar: mobile auth/setup/floor/pos/payment/kds modülleri; backend platform adapter'ları.

- [ ] Web hesabı→işletme→cihaz yetkisi→yerel PIN→personel akışını mobilde kur. Biometric eklenirse cihaz kilidi kolaylığıdır; yanlış personel rolünü otomatik devralma yöntemi değildir.
- [ ] Telefon sipariş akışı: masa seç→ürün/arama→modifier→sepet→gönder. Sepet özeti sabit; geri dönünce kaydedilmiş sipariş kaybolmaz. Tablet iki kolon kullanabilir.
- [ ] Tahsilatta kalan tutar, kanal, onay ve sonuç tek odakta; sanal klavye toplamı/CTA'yı örtmez. Fiziksel terminal desteği ayrı yetenek bayrağı.
- [ ] KDS tablet yatay kullanımı, yeni sipariş görünürlüğü, bağlantı geri geldiğinde tek bilet; telefon için odaklı bilet listesi. Personel rolü cihaz UI seçimiyle değişmez.
- [ ] Kabul: Q04 mobilde de aynı finans sonuçları; internet yokken sipariş/ödeme sonrası uygulama kill/relaunch veriyi korur; lisans/tenant/rol doğrudan komut testleri geçer.

## M04 — Mobil yönetim modülleri ve veri dayanıklılığı

Bağımlılık: M03, P07–P12. Dosyalar: mobile menu/stock/cari/staff/reports/settings modülleri, sync/backup platform adapter'ları.

- [ ] Desktop kapsamındaki ürün/reçete/stock/cari/personel/rapor/ayar görevleri için birebir yetenek matrisi çıkar. Telefon çok adımlı form, tablet geniş düzen; özellikler sessizce atlanmaz.
- [ ] Büyük tabloyu kart listesine çevirirken tutar/tarih/durum/filtre ve ayrıntı erişimini koru; tüm kayıtları tek ekranda yükleme. Bordro/finans rol maskesi aynı backend'de.
- [ ] Güvenli export/share ve yedek konumu; OS uygulama verisini kaldırınca ne olacağı kullanıcıya açık. Anahtar Keychain/Keystore; platform yedeğine secret sızması kontrol edilir.
- [ ] Offline kuyruk arka plana geçerken durable; foreground'da yeniden doğrula/senkronla. Push bildirimi bilgilendirme sinyalidir; parasal olayın doğruluk kaynağı değildir.
- [ ] Kabul: LAN bölünmesi, farklı cihazda aynı sipariş, düşük disk/izin reddi, OS kill, saat değişimi, update migration; veri ve audit mutabakatı. Mobil test matrisi her modülü kapsar.

## M05 — Mobil satın alma ve mağaza kuralları kararı

Bağımlılık: C05, satıcı/ülke/dağıtım kararı. Dosyalar: yeni `docs/mobile/store-policy-decision.md`; karara göre purchase adapter/webhook ve entitlement köprüsü.

- [ ] Ürünün dijital özellik aboneliği, işletmelere dağıtım, mevcut web aboneliğiyle kullanım, uygulama içi satın alma ve bölgesel istisnalarını güncel resmi kurallara göre değerlendir. Web checkout linkini uygulamaya koymanın otomatik serbest olduğunu varsayma.
- [ ] Apple multiplatform/enterprise istisnaları ve IAP koşulları kullanım ve dağıtım modeline göre incelenir; Google Play dijital özellik ödemeleri ve istisnaları ayrı. [Apple inceleme kuralları](https://developer.apple.com/app-store/review/guidelines/), [Google Play Payments](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en).
- [ ] Karar seçenekleri: kurala uygun mevcut abone giriş uygulaması; IAP ile satış; uygun özel işletme dağıtımı. Seçim, desteklenen ülkeler ve mağaza açıklaması yazılmadan ödeme yönlendirmesi uygulanmaz.
- [ ] IAP gerekiyorsa server verification, store notification signature, purchaseToken/originalTransactionId idempotency, restore purchases, family/ownership durumu, refund/revoke ve entitlement birleştirmesi. Aynı tenant'a web+store iki abonelik varsa sessiz çift ücretlendirme yok; açık çözüm yolu.
- [ ] Kabul: sandbox satın al/yenile/iptal/iade/restore, store hesabı değişimi, tekrar bildirim ve cihaz değiştirme; Labs kaynağı Apple/Google/web ayrımıyla aynı entitlement'ı açıklar.

## M06 — Mağaza teslimi ve mobil kabul

Bağımlılık: M01–M05, R03/R04. Dosyalar: mobile platform config/manifest/assets; yeni `docs/mobile/store-submission.md`.

- [ ] Bundle/package ID, signing sahipliği, sürüm/build numarası, ikon/splash, izin açıklamaları, destek URL'si, gizlilik URL'si ve hesap silme akışı; test/prod ayrımı.
- [ ] Mağaza ekran görüntülerini gerçek son tasarımdan üret; Android/iOS telefon/tablet doğru boyutlar. Çalışmayan platform özelliğini mağaza metninde vaat etme.
- [ ] Privacy/Data safety bildirimleri gerçek SDK/telemetri/veri işleme ile eşleşir; kullanılan SDK ve izinler güncel gereksinime göre tekrar kontrol edilir. Ajan uydurma beyan doldurmaz.
- [ ] İncelemeye özel veri içermeyen demo tenant ve rol hesabı, erişim yönergesi ve offline senaryosu hazırla; production fabrika PIN'i oluşturma. TestFlight/internal testing ve gerçek kullanıcı pilotu.
- [ ] Kabul: mağazaya hazır paket + gerekli dış hesap/ücret/sertifika listesi + gerçek cihaz kabul kanıtı. Mağaza “onaylandı” yalnız mağazadan sonuç gelince yazılır; submission başarı değildir.

## R01 — İmzalı ve düzgün Windows yükleyici

Bağımlılık: Q01, D02 marka yönü. İlk test yükleyicisi mevcut doğrulanmış baz sürümle ve aynı DB şemasıyla üretilir; P13/C12 tamamlanması bu göreve başlama koşulu değildir. C12/P13 sonrasında, R05 öncesinde aynı kurulum ve migration testleri son ürün sürümünde tekrarlanır. Dosyalar: `backend/tauri.conf.json`, Tauri bundle/NSIS assets/config, build pipeline; yeni `docs/operations/windows-install.md`.

- [ ] Yayıncı adı, uygulama adı/ikon, sürüm, Türkçe/İngilizce gerektiği kadar, kurulum dizini/kısayol/kaldırma davranışı; eski kurulum tanıma. NSIS markalı sade akış, ikinci özel installer motoru yazma.
- [ ] Kod imzalama sertifikası ve güvenli CI secret işlemi; executable ve installer imza doğrulama. İmza SmartScreen uyarısının her cihazda yok olacağını garanti etmez; gerçek temiz Windows testinde durum kaydedilir.
- [ ] Kurulum standard user/admin sınırını ve veri dizinini belirle; yükseltmede işletme DB'si korunur. Kaldırma varsayılan olarak kullanıcı verisini otomatik silmez; ayrı açık veri silme işlemi.
- [ ] Yeni sürüm manifesti web `/indir` ile tek kaynaktan; doğru OS/arch, checksum, release note. Debug build müşteriye verilmez, secrets bundle'a girmez.
- [ ] Kabul: temiz Windows, eski sürüm üstüne, disk dolu, yetkisiz dizin, yarıda kesilme, yeniden kurulum; her senaryoda mevcut DB korunur ve kullanıcı sonraki adımı bilir.

## R02 — Güvenli otomatik güncelleme

Bağımlılık: R01/C12. Önce updater servis kontratı ve güvenli paket davranışı tamamlanır; P12 daha sonra bu kontratı Ayarlar'a bağlar. P12 bu göreve başlama koşulu değildir. Dosyalar: `backend/tauri.conf.json`, `backend/src/lib.rs`, updater plugin entegrasyonu, desktop update adaptörü; yeni updater test/operasyon belgesi.

- [ ] Placeholder public key kaldırılır; updater plugin gerçekten initialize edilir. İmzalı update manifest/payload ve TLS; stable/beta kanalı ayrılır. Özel anahtar repo/istemcide yok.
- [ ] Kontrol→indir→doğrula→uygun zamanda kur akışı. Aktif ödeme, açık DB migration veya kritik operasyon sırasında otomatik restart yok; kullanıcı uygun zaman seçer.
- [ ] Upgrade öncesi doğrulanmış yedek; şema uyumluluğu kontrolü. Eski binary yeni şemayı okuyamıyorsa kör rollback yasak; forward fix veya kontrollü restore ve aradaki yeni işlemlerin korunması planlanır.
- [ ] Kabul: bozuk/imzasız paket reddi, yarım indirme retry, migration hatası, ağ kesintisi, eski sürüm→yeni sürüm; finans/audit kayıt sayısı ve tutarlar aynı. B06 kanıtla kapatılır.

## R03 — Production altyapısı ve işletilebilirlik

Bağımlılık: C11/C12, Q05. Dosyalar: servis deployment/config/CI; yeni `docs/operations/{deployment,backup,incident-response}.md`.

- [ ] Dev/staging/prod ayrı DB ve sağlayıcı anahtarları; environment payload doğrulaması. Domain, TLS, CORS, cookie, OAuth callback, DNS/mail SPF-DKIM-DMARC gereken hesaplarda doğrulanır.
- [ ] Mongo hesap/işletme ve Labs SQLite için erişim/backup/restore; SQLite çalışırken dosya kopyalamayı tutarlı yedek sanma, uygun snapshot yöntemi kullan. Tek sunucu sınırı/yatay ölçek ve session/rate limit etkisi belgelenir.
- [ ] Kuyruk, worker, scheduler, health/readiness, structured log ve alarm yönlendirmesi. Finans/webhook dead-letter ve yedek başarısızlığı sorumluya ulaşır; alarmı görmek birinin işi.
- [ ] Kapasite testi gerçekçi katalog/sipariş/tenant yüküyle; ölçülen servis süreleri ve kaynak kullanımı. Başlangıç hedefleri: API olağan okuma p95 <500ms, yerel temel aksiyon p95 <150ms; ortam/yük koşulları belirtilmeden SLA yazılmaz.
- [ ] Kurtarma hedefi önerisi: sunucu arızasında en geç 4 saat işlev geri dönüş; backup RPO seçilen altyapıyla belirlenir. Yerel committed transaction kaybı hedefi sıfırdır; cihaz fiziksel kaybında offline kuyruğun bulutta bulunduğu varsayılmaz.
- [ ] Kabul: staging'de DB yedeğinden yeni instance aç, servis anahtarını döndür, webhook kuyruğunu sürdür; ölçülmüş RTO/RPO ve runbook kaydedilir.

## R04 — Satış ve destek hazırlığı

Bağımlılık: W09/W10, L10, satıcı/vergi kararı. Dosyalar: yeni `docs/operations/{launch-checklist,support-runbook}.md`, satış/kurulum yardım içerikleri.

- [ ] Gerçek fiyat, dahil özellik, cihaz/OS sınırları, abonelik/iptal/vergi, fatura süreci, veri saklama ve destek kanalları tutarlı. Yasal metinler ve mali belge iddiaları yetkili değerlendirmeye hazır/doğrulanmış.
- [ ] Kurulum videosu veya kısa adımlı rehber, ilk satış, personel/PIN, backup/restore, internet kesintisi ve ödeme başarısızlığı yardımı. Rehber ekranları yeni sürümle eşleşir.
- [ ] Labs ekibinin ticket/ödeme/lisans/cihaz iptali eğitim senaryosu; müşteri verisine erişim politikası; destek saatleri ve eskalasyon sahibi gerçek kişilerce belirlenir.
- [ ] Ürün ölçümü yalnız gerekli olaylar; hata/performans verisinde PII minimizasyonu. Satış hunisinde checkout confirmed ve first_setup_complete ayrı ölçülür.
- [ ] Kabul: bir test müşterisi rehberle destek almadan kurulum yapabilir; yardım gerektiğinde ticket doğru kişiye düşer; uydurma güven rozeti veya müşteriyi yanıltan “anında destek” vaadi yok.

## R05 — Kontrollü pilot ve üretime geçiş

Bağımlılık: G4, Q01–Q06; mobil için ayrıca M06. Dosyalar: yeni `docs/operations/pilot-results.md` ve yayın kontrol kaydı.

- [ ] Önce sentetik test tenant'ı, sonra izinli küçük pilot işletme grubu; gerçek müşteri üzerinde deneme silme/iade çalıştırma. Pilot verisi ve gerçek mali akış sorumluluğu açık.
- [ ] En az bir tam iş döngüsü: açılış, yoğun sipariş, vardiya değişimi, gün sonu, yedek, sonraki gün yeniden açılış; bağlantı kesintisi güvenli test ortamında ayrıca.
- [ ] P0/P1 sınıfındaki finans/yetki/lisans/veri kaybı/görev tamamlayamama sorunları kapalı. P2 görsel kusurlar owner ve tarih ile takip edilir; kritik sayfalarda D08 sıfır puan yok.
- [ ] Yayın paketi: sürüm, DB migration, etkilenen servisler, feature açılış sırası, rollback/forward-fix, sağlık göstergeleri, sorumlu ve durdurma ölçütü. Production değişikliğinden önce kullanıcı somut paketi değerlendirebilir.
- [ ] Kabul: canlıya çıkış açık yetkilendirme ile; gerçek ödeme akışı yalnız onaylı işlemle doğrulanır. İlk satış başarı ekranı değil tahsilat/entitlement/cihaz/operasyon mutabakatıdır.

## R06 — Yayın sonrası izleme ve genişleme

Bağımlılık: R05. Dosyalar: incident/runbook ve sürüm kayıtları.

- [ ] İlk 24–72 saat için insan sorumluluğu ve kontrol listesi: webhook hata, lisans red, sync backlog, update hata, destek bekleme ve checkout terk. Bu plan kendi kendine otomasyon kurma yetkisi değildir.
- [ ] Durdurma koşulları: tenant sızıntısı, çift tahsilat, doğrulanmış finans/veri kaybı, update ile açılmama. Yeni satış/dağıtım gerektiği kadar durdurulur; müşteri verisi koruma ve bildirim prosedürü işler.
- [ ] Aylık restore tatbikatı ve periyodik yetki/anahtar incelemesi için işletim takvimi belirle; hatalardan yeni regresyon testi çıkar.
- [ ] Mobil ve yeni entegrasyonlar aynı feature/sözleşme kapılarından geçer. Test edilmemiş bayrakları satış için topluca açma.
- [ ] Kabul: alarmı kimin, ne sürede, hangi runbook ile ele aldığı belli; olay raporu kök neden/etki/düzeltme/tekrar engelini içerir. Kullanıcıya kanıtsız “artık kusursuz” denmez.

## İlk mobil uygulama kaydı — 8 Kasım 2026

- Mobil arayüzün ayrı giriş noktası `mobile/src/main.tsx`, rol/lisans tabanlı telefon alt sekmeleri `mobile/src/MobileNavigation.tsx`, mobil/tablet ölçüleri `mobile/src/mobile.css` altındadır. `mobile/package.json` ve Vite ayarı mevcut desktop React ekranlarını/stores/IPC erişimini kaynak olarak paylaşır; Rust/SQLite çekirdeği kopyalanmaz.
- Android Tauri projesi `backend/gen/android` altında üretilir. Makinedeki SDK 35/36, NDK 27.1.12297006, Microsoft JDK 17 ve kurulu Rust/Node/Tauri sürümleri kullanılır; sürüm yükseltmesi yapılmaz. `tauri.android.conf.json` / `tauri.ios.conf.json` mobil bundle kimliğini `com.kasam360.mobile` olarak ayırır ve web girdisini `mobile/` build çıktısına bağlar.
- Android’de yalnız masaüstü tek örnek eklentisi kapalıdır. Android/iOS LAN listener başlatmaz; mobil uygulama yerel SQLite ve bulut kuyruğu istemcisidir, işletim sistemi uygulamayı askıya aldığında sürekli görev/leader varsayılmaz. Mevcut account/business/PIN, tenant/role/license ve POS modülleri aynı IPC/store ve iş kuralları üzerinden çalışır.
- Geliştirici servisleri yalnız loopback’te tutulur; test cihazı USB ile bağlandığında mevcut yerel servise `adb reverse tcp:3000 tcp:3000` uygulanır. APK içine servis sırrı yazılmaz. Gradle’ın Windows loopback sorunu için süreçte `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\Windows\Temp`; Türkçe kullanıcı yolu için yalnız üretilen Gradle projesinde `android.overridePathCheck=true` kullanılır. Güvenlik ayarı değiştirilmez.
- Mac iOS adımları: Xcode’u açıp kurulum/lisansı tamamlayın; Node/npm ve Rust kurun; `rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim`; `brew install cocoapods`; kaynak kökünde `cd backend && cargo tauri ios init`. `com.kasam360.mobile` için Apple Developer hesabında App ID kaydedin, bağlı iPhone UDID’sini Xcode Devices and Simulators ile takıma ekleyin. Ad Hoc testinde Apple Distribution sertifikası ve kayıtlı cihazları içeren Ad Hoc provisioning profile gerekir; Xcode otomatik imzayı yönetebilir. Ardından `cd backend && cargo tauri ios build --open`, Xcode’da Team/signing seçimi, iPhone’a kurulum ve gerçek cihaz açılış kabulü. Apple hesabı/sertifika yokluğu yalnız iOS imzalama adımını bekletir; Windows iOS build’i sağlamaz.
- Gerçek cihazda askıya alma/OS kill, yeniden açılış, internet/LAN kopması, disk/izin hatası ve yinelenen gönderim kabulü burada ayrı kanıtlanmadan mobil pilot tamamlandı sayılmaz. Kaynak ve kurulu geliştirme ortamı için adımlar: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), [iOS signing](https://v2.tauri.app/distribute/sign/ios/), [Apple Ad Hoc profile](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile/).
