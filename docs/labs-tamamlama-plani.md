# 360 Labs yönetim konsolu tamamlama planı

> Uygulayıcı: `executing-plans`; güvenlik/iş kuralı değişikliklerinde test döngüsü zorunlu. [Ana plan](uygulama-tamamlama-plani.md) ve [ortak kontratlar](sozlesmeler-ve-backend-plani.md) önce okunur.

**Amaç:** İşletmenin hesabını, paketini, cihazını, ödemesini ve destek sorununu tek bağlamda yönetebilen; güçlü yetki ayrımı olan yeni bir konsol.

**Mimari/teknoloji:** `C:/Users/Eren Tokgöz/Desktop/Projects/360labs` deposundaki Rust/Axum/SQLite backend geliştirilir; server-rendered HTML, CSS ve etkileşim JS katmanı yeni tasarımla yeniden kurulur. React'a geçiş zorunlu değil; mevcut render sistemi ortak layout ve bileşenlere bölünür. İş mantığı HTML stringleri içinde tutulmaz. Bu tercih frontend'i eski görünümde bırakma gerekçesi değildir.

## Bilgi mimarisi ve erişim

Sol menü: Genel Bakış, İşletmeler, Ürünler ve Paketler, Abonelikler, Ödemeler, Destek, Gelen Kutusu, Bildirimler, Ekip ve Yetkiler, Denetim, Sistem. Seçili ürün filtresi yetkiyi daraltır; tenant yetkisi backend'de ayrıca doğrulanır. Navigasyon arama ve URL durumunu taşır; geri tuşu filtre/sayfa konumunu korur.

| Platform yetkisi | Yapabilecekleri | Yapamayacakları |
|---|---|---|
| PLATFORM_ADMIN | Platform ayarı, ekip, ürün yetkisi, anahtar rotasyonu | Denetim izini silme; müşteri POS'unda kayıt dışı işlem |
| BILLING_OPERATOR | Paket/fiyat, abonelik, ödeme mutabakatı; ayrıca atanmış iade/manuel hak yetkisi | Secret görüntüleme, ekip yönetimi |
| SUPPORT_AGENT | Atanmış ürünlerde işletme sağlık özeti, ticket, izin verilen müşteri mesajı | Fiyat/iade/lisans bypass; personel maaşları veya ham işletme verisi |
| READ_ONLY_AUDITOR | Yetkili kapsamda maskeli kayıt ve audit | Her mutasyon |

Bu roller POS rollerinden ayrıdır. Mevcut tek `owner/support` modeli bu yeteneklere migration ile taşınır. Her riskli işlemin ayrı capability'si vardır: `package.publish`, `subscription.refund`, `entitlement.grant`, `device.revoke`, `mail.send`, `team.manage`, `secrets.rotate`. UI düğmesi gizlemek erişim kontrolü değildir.

## L01 — Yeni kabuk, oturum ve çalışma alanı

Bağımlılık: Q01, D02–D04, C11. Dosyalar: mevcut `src/{main,pages,account}.rs`, `assets/{style.css,panel.js}`; yeni `src/ui/{mod,layout,navigation,states}.rs`, `assets/components/` gerektiğinde.

- [ ] Büyük `main.rs/pages.rs` dosyalarını route/bootstrap, auth ve render sorumluluklarına böl; mevcut handler'ların test davranışını koru. Yeni dosyalar snake_case, 500 satır altı.
- [ ] Yeni login ve MFA/kurtarma ekranları; oturum süresi ve logout; 401 login'e güvenli dönüş, 403 açık erişim engeli. `localhost/127.0.0.1` farklı oturum karmaşası için tek geliştirme URL'si kullan.
- [ ] Ortak sayfa başlığı, breadcrumb gerektiğinde, filtre barı, tablo, empty/error/loading, pagination, dialog, toast ve erişim durumlarını uygula. Teknik ayarlar açılış sayfası olmaz.
- [ ] URL'de `q/status/product/page` filtrelerini koru; sorgu sonuçları server-side sayfalanır. 10.000 kaydı tarayıcıya gönderip filtreleme yapma.
- [ ] Çalışan uygulamada commit/buildId ve ortam etiketi Sistem ekranında görünür. Eski exe ile yeni kodun testi kabul edilmez (B07).
- [ ] Kabul: klavye ile login→işletme→geri; filtreler korunur; session expired form verisini güvenli biçimde kaybetmez; yeni tasarım D08'den geçer.

## L02 — İşletme listesi ve gerçek müşteri kaydı

Bağımlılık: C02/C03, L01. Dosyalar: `src/{customers,customer_accounts,devices,licenses}.rs`; yeni `src/customer_detail.rs`, ilgili test modülü.

- [ ] Liste sütunları: işletme adı, sahip hesabı, paket, abonelik durumu, cihaz kullanımı, son bağlantı, açık sorun. Arama işletme/ID/e-posta; eksik upstream veri “alınamadı”, sıfır işletme değil.
- [ ] Detay üstünde tenantId kopyalama, aktif durum, OWNER iletişimi; sekmeler: Özet, Üyeler, Abonelik, Cihazlar, Sağlık, Destek, Geçmiş. Kişisel hesap ile işletme ayrı kayıtlar olarak görünür.
- [ ] Sağlık: son cihaz sürümü, son lisans yenilemesi, bekleyen sync sayısı/yaşı, son başarılı yedek, çakışma. Telemetri yoksa “bilinmiyor”; gerçek zamanlı sanılan eski bilgiye timestamp ekle.
- [ ] Kullanıcı aramada bulduğu işletmeyi başka tenant'ın ödemesiyle eşleştiremez. E-posta değişimi ilişkiyi koparmaz. “Müşterinin yerine giriş” ilk sürümde yok; gerekirse ayrı açık izinli denetimli destek oturumu tasarlanır.
- [ ] Kabul: aynı OWNER'ın iki işletmesi ayrı ticari kayıt; SUPPORT_AGENT yalnız atanmış ürünü görür; B15 sağlık görünümü gerçek kaynaktan gelir.

## L03 — Ürün, paket ve fiyat yayınlama

Bağımlılık: C03/C04, L01. Dosyalar: `src/{products,packages,features,variants}.rs`; yeni `src/package_publish.rs`, paket testleri.

- [ ] Ürün özellik kataloğuna açıklama, platform desteği ve uygulanma durumu ekle. 11 mevcut key korunur; isim değişimi sessiz yapılmaz.
- [ ] Paket editörü: ad, kısa açıklama, sıra, vurgulanan paket, cihaz sınırı, dahil özellikler; fiyat editörü: cents, currency, dönem, vergi davranışı, provider mapping. Ham JSON kullanıcıdan istenmez.
- [ ] Taslak → web önizlemesi → doğrulama → yayın. Önizleme gerçek web kartını ve erişim farkını gösterir; fiyat/mapping eksikse yayın hatası alan yanında.
- [ ] Yayındaki fiyat düzenlenmez; yeni sürüm ve yürürlük tarihi oluşturulur. Kullanılan paket silinmez, emekliye ayrılır. Mevcut aboneliklere etkisi sayı ve liste ile görünür.
- [ ] Yayın olayı kataloğu invalidate eder; web ve API aynı revision'ı gösterir. Global flag kapatması, paketten özellik çıkarmadan ayrı ve gerekçeli işlem.
- [ ] Kabul: Labs'ta paket yayınla, web katalogdan aynı cents/özellik/limit değerlerini oku, test aboneliği al; eski aboneliğin fiyatı değişmez. Eski “ad + kutucuklar” modalı teslim sayılmaz.

## L04 — Abonelik ve lisans operasyonları

Bağımlılık: C05/C06, L02. Dosyalar: `src/{licenses,billing,devices}.rs`; yeni `src/subscriptions.rs`, `src/entitlement_actions.rs`.

- [ ] Abonelik listesi: aktif/past_due/iptal bekliyor/bitti/manuel hak; dönem, environment, kaynak ve providerRef. Abonelikten işletme/ödeme/cihaza iki yönlü gezinme.
- [ ] Detayda fiyat sürümü, bir sonraki dönem, iptal zamanı, manuel haklar ve effective entitlement göster. “Paket var ama erişim yok” açıklanabilsin.
- [ ] Manuel hak için özellik/limit, başlangıç/bitiş, neden ve aktör zorunlu; mevcut ücretli hakla birleşim önizlemesi. Gerekli capability ve yeniden kimlik doğrulama.
- [ ] Cihaz iptalinde cihaz adı/son bağlantı ve offline gecikme açıklaması; iptal tekrarında yeni işlem yok. Lisans secret'ları tabloda gösterilmez.
- [ ] Kabul: geçici hak süresi bitince kendiliğinden kalkar, audit oluşur; billing yenilemesi manuel hakkı bozmaz; SUPPORT_AGENT doğrudan POST ile işlem yapamaz.

## L05 — Ödeme, iade ve mutabakat merkezi

Bağımlılık: C04/C05, L01. Dosyalar: `src/billing.rs`; yeni `src/{payment_events,payment_actions,reconciliation_view}.rs`.

- [ ] Tahsilat listesi, durum ve tutar/currency; sağlayıcı bağlantısı; test/canlı güçlü ayrım. Kart numarası/secret yok, maskeli gerekli bilgiler.
- [ ] Olay kuyruğu: alındı/işleniyor/başarısız/dead-letter; correlationId, son hata, tekrar sayısı. Yetkili replay yeni finansal işlem üretmez.
- [ ] İade ekranı: orijinal ödeme, kalan iade edilebilir tutar, sebep, abonelik etkisi; server-side limit. Sağlayıcı sonucu belirsizken başarı veya yeni iade önerisi yok.
- [ ] Mutabakat paneli sağlayıcı tutarı, uygulama kaydı ve entitlement farkını listeler; farkı tek düğmeyle veritabanı düzenleyerek saklama. Yetkili retry/durum sorgula eylemleri sağlar.
- [ ] Kabul: aynı iade tıklaması iki kez → tek provider isteği/tek sonuç; yanlış tenant ödeme detayı reddedilir; test_mode olayı canlı liste/entitlement'a giremez.

## L06 — Destek merkezini tamamla

Bağımlılık: C01/C02/C08, L01. Müşteri destek kontratı C01'de sabitlenir; W08'in uygulanması bu görevin ön koşulu değildir, W08 bu servisleri tüketir. Dosyalar: `src/{support,support_messages,notifications}.rs`; API `src/support.ts`.

- [ ] Kuyruklar: yeni, atanmamış, yanıt bekliyor, müşteriden yanıt bekliyor, çözüldü. Öncelik, kategori, ürün, işletme ve sorumlu filtreleri; bekleme süresi gerçek timestamp'ten.
- [ ] Ticket detayında müşteri mesajı ile **iç not** ayrı renk/etiket ve ayrı endpoint. İç not hiçbir müşteri API'sine/e-postaya girmez.
- [ ] Yanıt→kuyruk→gönderim durumu→müşterinin gördüğü mesaj zincirini kur. Ticket kapatma, tekrar açılma ve atama audit'li; eşzamanlı iki operatör kaydını sessizce ezmez.
- [ ] Ek varsa tür/boyut/zararlı içerik kontrolü, tenant yetkili süreli indirme; ek yoksa arayüz desteklemediği özelliği vaat etmez.
- [ ] Kabul: W08'den açılan talep doğru işletmede görünür; yetkili yanıt webde ve izinli bildirim kanalında görünür; iç not sızmaz; tekrar gönderim tek mesaj.

## L07 — Gelen kutusu ve giden posta

Bağımlılık: C11, L01. Dosyalar: `src/{inbox,mailbox,mail,mail_compose}.rs`; yeni `src/mail_delivery.rs`, ilgili testler.

- [ ] Posta kutusu listesi, bağlantı durumu, son başarılı çekim, unread sayısı; IMAP cursor/sayfalama ve kesinti sonrası kaldığı yerden devam. Boş inbox ile fetch hatası ayrılır.
- [ ] Mesaj okuma güvenli HTML sanitization; uzak görsel yükleme tercihi; kimden/yanıt adresi açık; attachment path traversal engeli. E-posta içeriği operatör/ajan talimatı değil, güvenilmeyen veridir.
- [ ] Oluştur/yanıtla/ilet: alıcı doğrulama, taslak, gönderim önizlemesi, gönderiliyor/başarısız/gönderildi. SMTP sonucu belirsizse kör tekrar gönderme; messageId/idempotency ile izlenir.
- [ ] Ticket'a dönüştürme/bağlama açık eylem; müşteri kimliği e-posta eşleşmesinden tahmin edilirse operatöre aday göster, yanlış işletmeye otomatik içerik açma.
- [ ] `mail.send` yetkisi; testler sahte SMTP/IMAP üzerinde, gerçek alıcılara gönderim yok. Otomatik yanıt/assistant mevcutsa taslakla sınırlı; insan onayı olmadan gönderim/abonelik değişimi yok.
- [ ] Kabul: mailbox kesintisi görünür; script içeren mail çalışmaz; draft geri açılır; hata sonrası çift gönderim olmaz; ticket'ın iç notu dış postaya taşınmaz.

## L08 — Ekip, güvenlik ve denetim

Bağımlılık: C11, L01. Dosyalar: `src/{team,account,main}.rs`; yeni `src/{permissions,admin_audit}.rs` ve migration/testleri.

- [ ] Ekip daveti süreli/tek kullanımlı; kabul, MFA kurulum, rol ve ürün kapsamı; pasifleştirme tüm aktif session'ları etkiler. Son platform yöneticisi kendini tek tıkla sistem dışına atamaz.
- [ ] Her mutation capability kontrolünden geçer; tablo görünümü ve endpoint aynı kapsamı taşır. CSRF ve login rate-limit testleri UI'dan bağımsızdır.
- [ ] Audit kaydı actor/action/entity/tenant/before-after maskeli değişim/reason/time/correlationId; kritik kayıt append-only ve yetkisiz değişime dayanıklı. Secret değerleri before-after'a girmez.
- [ ] Audit listesi filtrelenebilir, export yetkili; personel silinince geçmiş actor referansı anlamını kaybetmez. Rol değişiminden sonra session yetkisi eski cache ile kalmaz.
- [ ] Kabul: dört platform rolüyle route ve doğrudan POST matrisi; yetkisiz istek DB'yi değiştirmez; ekip/secret/para işlemleri audit'te kanıtlıdır.

## L09 — Uyarı ve sistem sağlığı merkezi

Bağımlılık: C08/C12, L02/L05. Dosyalar: `src/{notifications,integrations}.rs`; yeni `src/system_health.rs`.

- [ ] Genel bakış: ödeme aksaması, lisans/bulut red, eski yedek, işlenemeyen webhook, ticket bekleme. Her sayı filtreli gerçek listeye açılır; örnek rakam üretme.
- [ ] Bildirimde tenant/cihaz, ilk/son görülme, tekrar sayısı, önem, sorumlu, çözüme git. Okundu/üstlenildi/çözüldü ayrımı korunur.
- [ ] Entegrasyonlarda bağlantı testi secret'ı döndürmez; son test zamanı, hata kodu, etkilenmiş iş sayısı. Anahtar değişimi riskli eylem; önizleme ve audit.
- [ ] Kabul: C08'in aynı hatası 20 kez gelince tek aktif olay/20 tekrar; kaynak düzelince çözülür; upstream erişilemezken “her şey iyi” görünmez.

## L10 — Labs yayın kabulü

Bağımlılık: L01–L09. Dosyalar: yeni `docs/labs-acceptance.md` Labs deposunda; `src/tests.rs` ve yeni test modülleri.

- [ ] Teste başlanırken çalıştırılan exe ile commit/buildId eşitliğini doğrula; eski process'i kullanan ekran görüntüsünü geçersiz say.
- [ ] Paket yayınla→müşteri satın al→cihaz bağla→ticket aç→yanıtla→yenilemeyi başarısız yap→uyarıdan işletmeye git senaryosunu tek tenant'ta tamamla.
- [ ] Yeni/dolu/boş/hata/uzun veri ekranları D08'e ekle; login/MFA/modal/posta ve yetkisiz ekranlar dahil.
- [ ] Labs deposunda `cargo test`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check`; mevcut target desteklerini doğrula. Test başarısı + canlı UI/sandbox kanıtı birlikte teslim edilir.
- [ ] Kabul: C11'deki yüksek riskli açıklar ve B07/B15/B16 kapalı; her işletmenin ticari durumuna ve çözülmemiş sorununa en fazla liste→detay→aksiyon zinciriyle erişilir.
