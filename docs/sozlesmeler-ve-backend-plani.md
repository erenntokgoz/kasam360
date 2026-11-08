# Ortak sözleşmeler ve backend tamamlama planı

> Uygulayıcı: `executing-plans`, hata bulunduğunda `systematic-debugging`, davranış değişikliğinde `test-driven-development`, teslimde `verification-before-completion`. Ana belge: [tamamlama planı](uygulama-tamamlama-plani.md).

**Amaç:** Üç uygulamanın aynı müşteri, işletme, abonelik ve erişim gerçeğini kullanması; finans ve verinin güvenle korunması.

**Mimari/teknoloji:** Labs Rust/SQLite ticari kayıt sahibi; Hono/MongoDB hesap ve bulut sınırı; Rust/SQLite cihaz operasyon motoru. Servisler arası tek transaction varmış gibi davranılmaz: outbox/inbox, idempotency, sürüm ve mutabakat kullanılır. Mevcut altyapı genişletilir; baştan backend yazımı hedef değildir.

**Dosya yolu kuralı:** “API yeni” `.ts` dosyalarının kökü `kasam360/backend/api/src/`; “Labs yeni” `.rs` dosyalarının kökü kardeş depo `360labs/src/`. Rust cihaz servisleri `kasam360/backend/src/services/`, komutlar `kasam360/backend/src/commands/` altında kalır. Yeni test dosyası ilgili modülün yanında; Rust test modülü mevcut crate test kaydına eklenir.

## Bağlayıcı veri sahipliği

| Veri | Tek yazma otoritesi | Diğer tarafların görevi |
|---|---|---|
| Hesap, doğrulama, Google bağlantısı, web session | Hesap API / account MongoDB | Labs API üzerinden görür; ikinci parola deposu oluşturmaz |
| İşletme kimliği ve kullanıcı üyeliği | Hesap API | Labs'ta `tenantId` ile ticari işletme karşılığı; yerel cihaz aynı kimliği taşır |
| Ürün, paket sürümü, fiyat, ödeme eşlemesi, abonelik, manuel hak | Labs | API yetkili projeksiyonu sunar; web bağımsız fiyat üretmez |
| Cihaz tahsisi/sınırı/iptali ve ticari entitlement | Labs, API üzerinden | API kimlik ve üyeliği denetler, sonucu cache/projeksiyona alır |
| İmzalı cihaz lisansı | Hesap API; Labs entitlement kaynağından | Rust imzayı, cihazı, tenant'ı, zamanı ve politikayı doğrular |
| Sipariş, ödeme, stok, vardiya, audit | Yerel Rust transaction motoru | Bulut replika/yedek/aktarım; Labs finans satırını doğrudan değiştiremez |
| Personel, PIN PHC, yerel rol, ürün/reçete, masa, işletme ayarları | İşletmenin yerel işlem otoritesindeki Rust motoru | Yetkili cihazlara güvenli replika; web hesabından bağımsız ikinci personel kaydı oluşturulmaz |
| Destek ticket ve müşteri mesajı | Labs | API müşteri tenant/hesap yetkisini doğrulayarak köprü olur |
| Bildirim | Kaynak olayı üreten servis | Her uygulama kendi alıcısının görünümünü/okunmasını tutar; çözülme kaynakta |

Mongo işletme verileri içinde mevcut sync şemasının hangi parçasının ana kayıt, hangisinin replika olduğu C02'de belgelenir. Labs SQLite'tan API Mongo'ya doğrudan sorgu yapılmaz. E-posta iletişim adresidir; tenant/abonelik eşleme anahtarı değildir.

## Yeni ortak kontrat: v1

Yeni sınır DTO'ları JSON'da camelCase; DB ve Rust kalıcı alanlar snake_case. `tenantId` API JSON, `tenant_id` SQL filtre alanıdır. Mevcut endpoint'ler bir geçiş adaptörüyle korunur; sessizce kırılmaz.

| Kontrat | Zorunlu alanlar / sınır |
|---|---|
| `Money` | `amountCents: integer >= 0`, `currency: ISO kodu`; signed düzeltmeler ayrı tip. JS safe integer ve Rust checked arithmetic; taşma hata |
| `TenantMembership` | `userId, tenantId, role, status, version`; web OWNER üyeliği ile yerel personel PIN hesabı ayrı |
| `PackageVersion` | `packageId, version, productId, name, featureKeys[], deviceLimit, status`; draft/published/retired |
| `PriceVersion` | `priceId, packageId, packageVersion, amountCents, currency, interval: month|year, taxBehavior, version`; yayınlandıktan sonra değişmez |
| `Quote` | `quoteId, tenantId, priceId, priceVersion, subtotalCents, taxCents, totalCents, currency, expiresAt`; tüm tutarlar sunucudan |
| `Subscription` | `subscriptionId, tenantId, packageId, packageVersion, priceId, status, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, provider, providerRef, environment, version` |
| `Entitlement` | `tenantId, productId, packageVersion, featureKeys[], deviceLimit, status, paidUntil, revision, source, effectiveAt`; manuel hak neden/bitiş taşır |
| `Device` | `deviceId, tenantId, label, platform, status, registeredAt, lastSeenAt`; iptal ayrı durum, fiziksel cihaz güvenliği ayrıca değerlendirilir |
| `DeviceLicenseV2` | `version:2, keyId, tenantId, deviceId, productId, entitlementRevision, featureKeys[], issuedAt, refreshAfter, offlineUntil, paidUntil, mode, signature` |
| `DomainEvent` | `eventId, schemaVersion, tenantId, type, entityId, entityVersion, occurredAt, correlationId, environment`; hassas içerik loglanmaz |
| `ApiError` | `code, message, correlationId, retryable, fieldErrors?`; bilinmeyen finansal sonuç için `OUTCOME_UNKNOWN`, otomatik yeni işlem yok |

Tarih/süreler UTC RFC3339; işletme raporu timezone ayrı. Paket fiyatı üzerinde floating arithmetic yok. Vergi yuvarlama yöntemi sunucu sözleşmesinde örnekli; satır ve toplam kuralları karışmaz. `keyId` anahtar rotasyonunu, `version` şema geçişini sağlar; v1 lisanslar geçiş süresince açık uyumluluk politikasıyla doğrulanır.

## Önerilen API yüzeyi

Bu yollar **yeni hedef sözleşmedir**; mevcut oldukları varsayılmaz. C01 mevcut route haritasını çıkarıp çakışan adları tek kez uyumlaştırır. Müşteri çağrıları API'ye gider; Labs servis anahtarı tarayıcıya verilmez.

| Yol | Yetki / sonuç |
|---|---|
| `GET /v1/catalog?productId=kasam360` | Yalnız published fiyat ve özellikler, ETag/revision; secret yok |
| `GET /v1/me/tenants` | Oturum üyelikleri; e-posta ile tenant tahmini yok |
| `POST /v1/tenants` | Doğrulanmış hesap + idempotency; OWNER üyeliği atomik/onarılabilir |
| `POST /v1/tenants/:tenantId/quotes` | OWNER; priceId + fatura bağlamı → kısa ömürlü sunucu teklifi |
| `POST /v1/tenants/:tenantId/checkouts` | OWNER; quoteId + idempotency key → checkoutId/url/status |
| `GET /v1/tenants/:tenantId/subscription` | Yetkili hesap; sunucu mutabakat durumu, ödeme bekleniyor dahil |
| `POST /v1/tenants/:tenantId/subscription/change` | OWNER; yeni fiyat ve zamanlama; preview/confirm iki adım |
| `POST /v1/tenants/:tenantId/subscription/cancel` | OWNER; dönem sonu iptal; aynı istek aynı sonuç |
| `GET /v1/tenants/:tenantId/devices` | OWNER; maskelemiş cihazlar; limit/kullanım |
| `POST /v1/device-authorizations` | Cihazın oluşturduğu challenge → süreli kullanıcı kodu, henüz hak yok |
| `POST /v1/device-authorizations/:id/approve` | Web oturumunda OWNER + tenant; tek kullanımlı onay |
| `POST /v1/device-authorizations/:id/exchange` | Cihaz challenge kanıtı → cihaz kimliği/lisans; rate limit |
| `POST /v1/tenants/:tenantId/devices/:deviceId/revoke` | OWNER veya yetkili Labs; denetimli iptal |
| `GET /v1/tenants/:tenantId/notifications` | Alıcı + tenant kapsamı; görülme/çözülme ayrı |
| `POST /v1/tenants/:tenantId/support/tickets` | Yetkili hesap; idempotency; açık müşteri mesajı |
| `GET /v1/tenants/:tenantId/support/tickets` | Yetkili hesap; cursor pagination, durum filtresi; sadece müşteri görünür alanlar |
| `GET /v1/tenants/:tenantId/support/tickets/:ticketId` | Aynı tenant; müşteri mesajları, durum ve görünür ekler; iç not yok |
| `POST /v1/tenants/:tenantId/support/tickets/:ticketId/messages` | Yetkili hesap; idempotency, doğrulanmış metin/ek referansı; iç not türü kabul edilmez |

Labs iç uçları `internal/v1` altında ayrı auth/mTLS veya rotasyonlu servis kimliği ile korunur. Webhook route sağlayıcıya özgü olur; raw body imzası, ortam ve replay kontrolü uygulanır. Adlar C01 sözleşme dosyasında dondurulur; iki ajan birbirinden farklı yol üretemez.

## Erişim ve lisans politikası

**Önerilen başlangıç politikası; canlı yayından önce ticari kabul gerekir.** İmza geçerliği, yerel personel rolü, tenant, özellik ve lisans modu birlikte değerlendirilir. Offline grace abonelik ödeme borcuna otomatik ek süre değildir.

| Durum | Yeni satış | Açık siparişi tamamlama | Rapor/yedek/dışa aktarma | Bulut ve kullanıcı mesajı |
|---|---|---|---|---|
| Aktif, çevrimiçi | Paket/rol izin veriyorsa | Evet | Yetkiye göre | Son başarılı senkron bilgisi |
| Aktif, internet yok; `now <= offlineUntil` ve `now <= paidUntil` | Evet | Evet | Evet | Yerel kayıt açık, bulut bekliyor |
| Yenileme doğrulanamadı; offline süresi bitti | Hayır | Önceden açılmış siparişler, yetkili kullanıcı | Evet | İnternet/lisans yenileme yolu; tüm ekranları kapatan gate yok |
| Ücretli dönem bitti / paket yok | Hayır | Önceden açılmış siparişler, yerel yetkiyle | Evet | Yenileme; ilk kurulumda hazır olmayan POS'a geçiş yok |
| Özellik düşürüldü | O özelliğe yeni işlem yok | Başlamış işlemi güvenli sonlandırma politikası | Geçmiş veriye salt okunur erişim | Etki listesi; kayıt silinmez |
| Güvenlik nedeniyle cihaz iptal edildi | Hayır, iptal cihazca öğrenilince | İnceleme/kurtarma akışı; otomatik işlem yetkisi yok | Güvenli yerel OWNER kurtarma politikası C06'da | İptal offline cihaza anında ulaşamaz; bunun aksi vaat edilmez |
| Sahte/bozuk imza veya yanlış tenant | Hayır | Genel POS yetkisi verilmez | Yerel kimliği kanıtlayan ayrı kurtarma akışı | Veri silinmez, destek ve tanılama |

Başlangıç offline bütçesi son başarılı yenilemeden en fazla 72 saat; `offlineUntil=min(issuedAt+72h, paidUntil)`. Aktif lisans 6 saatte bir ve bağlantı geri geldiğinde yenilenir; jitter/backoff eklenir. Değişiklik yayılımı online cihazda hedef 60sn; lease yenilenmesi bunu ayrıca desteklemelidir. Saat geriye alınması ve timezone farkı C06 testiyle kapatılır; offline iptalin mutlak anlık garantisi verilmez.

Online cihaz 60sn aralıkla küçük entitlement revision kontrolü yapar; revision değişirse 6 saatlik normal yenileme zamanını beklemeden yeni lisansı ister. İstekler jitter/backoff taşır. Labs erişilemiyorsa API eski projeksiyondan her seferinde yeni 72 saat üretemez: mevcut imzalı lease'in son tarihi korunur, yeni hak verilmez. 72 saat hesabının başlangıcı kaynağı doğrulanmış grant yenilemesidir; salt API cache okuması değildir.

**Kapanış modu:** Yetki bittiği anda daha önce commit edilmiş açık sipariş satırları ve tutarları üst sınırdır. Yeni masa/sipariş/satır açılmaz, mevcut satır miktarı veya toplamı artırılamaz. Yetkili iptal/azaltma, mevcut kalan tutarı tahsil etme, fiş ve kayıt okuma mümkündür; fiyat snapshot'ı değişmez. Başlamış ödeme aynı operationId ile tamamlanır/sorgulanır, yeni tahsilat gibi tekrar edilmez. Bu mod sınırsız yeni satış için eski siparişi kullanma yolu olamaz. Bozuk imza veya güvenlik iptali kapanış modunu otomatik açmaz; güvenli kurtarma ayrı yetki sınırıdır.

**Kapalı feature ve geçmiş:** AGENTS'teki kapalı modül rotasının reddi korunur. Cari/tarife/KDS gibi kapalı modülün kendi rotası salt okunur gerekçesiyle açılmaz. Geçmiş kayıtlar ayrı, rol korumalı `Geçmiş ve Veri Dışa Aktarımı` yüzeyinden ve yalnız allowlist rapor/export komutlarıyla okunur. Bu yüzey modül mutasyonunu veya kapalı feature'ın çalışma ekranını açamaz. Süresi bitmiş lisansın veri erişimi de aynı sınırlı yüzeyi kullanır.

## Yerel ağ bölünmesinde üretim politikası

**Yeni önerilen üretim kararı:** İnternet kesilse yerel kasa çalışır. Cihazların birbirinden kopması halinde aynı işletme için birden fazla bağımsız finansal yazıcı çalıştırılmaz. İlk ücretli sürümde işletmenin bir cihazı **işlem otoritesi** olarak kayıtlıdır; diğer cihazlar sipariş/ödeme/stock/personel mutasyonunu bu cihaz üzerinden yürütür. Mobil istemci sürekli arka plan sunucusu sayılmaz.

Mevcut `lan_sync/write_tx.rs` otorite/çoğunluk yokken ada yazmasına geçebiliyor; `merge.rs` iki taraftaki aynı sipariş çakışmasını birleşmede sınıflandırıyor. Bu mekanizma iki gerçek tahsilatı önceden engellemez. Mevcut ada günlüğü/kurtarma verileri korunur, fakat “her ada finansal olarak bağımsız yazabilir” davranışı üretimde yukarıdaki politika kabul edilmeden kullanılamaz. Bu yeni plan kararıdır; mevcut kodun zaten böyle çalıştığı iddia edilmez.

| Bağlantı durumu | İşlem otoritesi | Diğer cihaz |
|---|---|---|
| İnternet yok, LAN var | Yerel DB'de normal transaction; bulut kuyruğa | Otorite üzerinden normal operasyon |
| LAN bölündü, otorite çalışıyor | Kendi yerel verisinde çalışır; offline lisans sınırı geçerli | Salt okunur son durum + gönderilmemiş taslak; ödeme/stock/rol/menü mutasyonu yok |
| Otorite kapandı/ulaşılamıyor | Kendisi çalışmıyorsa yeni commit yok | Yeni tahsilat başlatmaz; bekleyen işlem opId ile çözülmeyi bekler |
| LAN geri geldi | Commit sırasını ve sonuçları paylaşır | Taslakları güncel fiyat/stok/yetkiyle yeniden onaya sunar; otomatik tahsilat yok |

`transactionAuthorityDeviceId` ve monoton `authorityEpoch` tenant/cluster metadata'sında tutulur; bütün write gateway'leri bunları kontrol eder. İlk sürümde ağ kesildi diye otomatik bağımsız finansal lider yükseltme yok. Mevcut consensus mekanizması replika için korunabilir; onun lider seçimi tek başına finansal otorite devri değildir. Tek cihaz kipinde kayıtlı otorite o cihazdır.

Planlı otorite devri: OWNER yetkisi → eski otoritede yeni yazmaları durdur → bekleyen işlemleri çöz → son commit/hash'i hedefe aktar ve doğrula → eski otoriteyi kalıcı olarak writer olmaktan çıkar → yeni epoch ile hedefi aç. Eski cihaz onayı veya fiziksel olarak devre dışı bırakıldığına dair kontrollü operasyon olmadan timeout ile ikinci writer açılmaz. Kalıcı cihaz kaybında geri yükleme ve eksik commit mutabakatı gerekir; otomatik “sıfır kayıp” devralma iddiası yok.

Bağımsız adalarda satış gelecekte mutlaka istenirse cihazlara önceden ayrılmış sipariş/stock hakları ve ayrı tahsilat kapsamı gibi ek bir model gerekir; bu doğrulanmadan satış vaadi yapılmaz. Mevcut ada kayıtları migration sırasında silinmez, mutabakat kuyruğuna alınır. Bu sınır web/desktop yardımında açık anlatılır. Yeni `docs/offline-conflict-policy.md` C07 çıktısıdır; mevcutmuş gibi referans verilmez.

## Yerel OWNER, personel ve kurtarma sınırı

- Yeni işletmede ilk OWNER personel kaydı **bir kez** oluşturulur; `tenantId + ownerAccountId` bağlantısı kalıcıdır. E-posta değil değişmez web hesap ID'si kullanılır. İşlem idempotent; ikinci cihaz aynı işletmeye yeni OWNER yaratmaz.
- Mevcut işletmeye katılan cihaz, yetkili eşleme ve lisans sonrası otoriteden veya doğrulanmış yedekten personel/rol/ürün/masa snapshot'ını alır. PIN PHC'leri yalnız kimliği doğrulanmış, şifreli backend replikasyon kanalında taşınır; frontend IPC cevabına/loglara açılmaz. Düz PIN hiçbir zaman aktarılmaz.
- Web OWNER üyeliği fatura/abonelik/cihaz yönetimi yetkisidir; kendiliğinden herhangi bir yerel personelin PIN'iyle oturum açmaz. Yerel OWNER kaydıyla bağ C02'de açık tutulur. Diğer personelin web hesabı olması zorunlu değildir.
- Personel rol/PIN/pasiflik değişikliği otoritede sürümlenir, bağlı cihazda eski session iptal edilir. Otoriteye erişemeyen ikincil cihaz eski cached rolle finansal yazamaz; replika geç gelince yeni yetkiyi uygulamadan yazma açılmaz. İnternetsiz mevcut otoritede yerel personel yönetimi çalışabilir.
- Sahiplik devri ayrı ve ilk sürümde online koordine işlemdir: mevcut web OWNER yeniden kimlik doğrular, yerel OWNER onayı alınır, yeni sahip daveti kabul eder, otoritede bağ/rol güncellenir, ACK sonrası portal tamamlandı der. Eski sahip ve cihaz session'ları iptal edilir. OWNER kaybında normal üyelik ekranı ile kestirme terfi yok; denetimli kurtarma gerekir.

| Kurtarma hali | Kabul edilen kanıt | İzin verilen işlem |
|---|---|---|
| Lisans süresi bitti; mevcut yerel tenant/cihaz bağı güvenilir | O tenant'ın aktif yerel OWNER PIN'i | Rapor, export, yedek; yeni satış/hak yok |
| Aynı cihazda lisans bozuldu, yerel tenant bağı doğrulanabiliyor | Online güncel web OWNER yeniden doğrulaması + device challenge; tenant/device/DB fingerprint'e bağlı tek kullanımlı 15dk grant | Yalnız belirtilen export/yedek; yazma/PIN reset/tenant değiştirme yok |
| Temiz cihaz veya farklı tenant lisansı | O tenant için web üyeliği + normal cihaz onayı + doğru tenant yedeği | Yeni yetkili cihaza normal restore; başka yerel DB'ye erişim yok |
| Güvenlik nedeniyle iptal edilmiş cihaz | O cihazda yerel PIN tek başına yeterli değil | Uygulama içi finans/export kapalı; güncel web OWNER yeni onaylı cihazda doğrulanmış yedeğini kurtarır. Eski dosyalar otomatik silinmez |

Lisans kurtarma grant'i operasyonel session veya yeni OWNER yaratmaz. Kayıp PIN sıfırlama ayrı, online bağlı OWNER yeniden doğrulaması ve hedef staffId kapsamıyla denetlenir; ilk kurulum sihirbazını tekrar açarak OWNER oluşturma kaçışı yok. Kimlik yeterince doğrulanamıyorsa veri saklanır ve denetimli destek süreci gerekir; “internet yok” diye güvenlik iptali kaldırılmaz.

## C01 — Mevcut sözleşmeleri çıkar ve yenilerini dondur

Bağımlılık: Q01. Dosyalar: `backend/api/src/{app,index,license,desktopLicense,customerProvisioning}.ts`, `backend/src/commands.rs`, `360labs/src/main.rs`; yeni `docs/contracts/{api,events,ownership}.md`, `backend/api/src/contracts/`.

- [ ] Mevcut route/IPC/DTO ve çağıranlarını listele; yukarıdaki hedeflerle alan ve yetki farklarını yaz. Sessiz API değişikliği yapma.
- [ ] Para, kimlik, saat, hata, idempotency ve pagination kurallarını şema halinde tanımla; geçerli/geçersiz örnek ekle. TypeScript `any` kullanma.
- [ ] Yeni route'a geçişte eski tüketiciyi adaptörle koru; kaldırma sürümünü kaydet. Kontrat fixture'ı hem API hem Labs testinde kullanılır.
- [ ] Kabul testi: `contract_rejects_fractional_cents_and_unknown_feature`; 1.5 cents, taşan sayı, bilinmeyen enum ve tenant'sız mutasyon reddedilir. Eklenmiş schemaVersion tüketicide yanlış yorumlanmaz.

## C02 — Hesap, işletme ve üyelik ayrımını tamamla

Bağımlılık: C01. Dosyalar: `backend/api/src/lib/{mongo,auth}.ts`, `customerProvisioning.ts`, `sync/store.ts`; yeni `tenantMembership.ts`, `tenantMembership.test.ts`.

- [ ] `user_id` unique sync tenant varsayımını üyelik modeliyle karşılaştır. Bir hesap→birden fazla işletme ve bir işletme→birden fazla yetkili için migration tasarla; çoklu şube özelliğiyle üyelik modelini karıştırma.
- [ ] Mevcut hesabı ve lisansı yeni `tenantId`'ye bağla; e-posta değişince üyelik kaybolmasın. OWNER oluşturma tekrarı tek tenant döndürsün.
- [ ] Her API isteğinde tenant üyeliğini sunucuda doğrula; istemciden gelen role güvenme. Google ve e-posta hesabı bağlama akışında doğrulanmış kimlik ve yeniden kimlik doğrulama kuralı uygula.
- [ ] Test: `tenant_a_cannot_read_or_write_tenant_b`, `email_change_keeps_membership`, `provision_retry_creates_one_owner`, `second_device_reuses_staff_identity`, `owner_transfer_waits_for_local_ack`. Eski kurulum migration'ında tenant ve kayıt sayıları aynı kalır.

## C03 — Sürümlü paket ve entitlement modeli

Bağımlılık: C01/C02. Dosyalar: `360labs/src/{packages,features,licenses,variants}.rs`, yeni migration ve paket test modülü; API yeni `catalog.ts`, `entitlements.ts`.

- [ ] Draft/published/retired paket ve değişmez fiyat sürümleri; 11 feature key için desteklenen platform ve hazır olma bilgisi ekle. Kapalı/geliştirilmemiş özellik satılamaz.
- [ ] Paket yayını için fiyat, dönem, vergi davranışı, cihaz limiti, feature anahtarları ve ödeme mapping doğrula. Eksik mapping varsa yalnız önizleme; satın alınabilir yayın yok.
- [ ] Abonelik satın aldığı sürüme bağlı kalır; yeni fiyat eski müşteriyi sessizce değiştirmez. Manuel hak süre/neden/veren aktörle ayrı kayıttır; billing olayı manuel hakkı yanlışlıkla silmez.
- [ ] Tek entitlement hesaplayıcı kullan; global güvenlik kapaması > ürün kullanılabilirliği > abonelik/manuel hak birleşimi > kullanıcı rolü. Bilinmeyen bayrak deny; cihaz limiti politikası tek yerde.
- [ ] Test: `published_package_is_immutable`, `new_price_keeps_existing_subscription`, `manual_grant_survives_renewal`, `unknown_feature_denied`. Katalogdan Labs secret'ı sızmaz.

## C04 — Ödeme ve webhook işleme

Bağımlılık: C03; sağlayıcı kararı canlı için gerekli. Dosyalar: `360labs/src/{billing,variants,integrations}.rs`; yeni `billing_events.rs`, `billing_reconciliation.rs`; API yeni `checkout.ts`, `checkout.test.ts`.

- [ ] Mevcut sağlayıcı adaptörünü incele; checkout yaratma/iptal/iade/portal kabiliyetlerini doğrula. Ödeme sayfasını sağlayıcıda tut; kart verisi uygulama logu/DB'sine girmez.
- [ ] Quote sunucuda hesaplanır; kısa ömürlü ve tenant'a bağlıdır. İstemcinin fiyatı/plan adı kabul edilmez. Checkout idempotency anahtarı `tenantId+operation+key`, payload hash'i ile saklanır; aynı anahtar/farklı payload 409.
- [ ] Webhook raw body imzası doğrulanır; sağlayıcı olayı durable inbox'a yazılır; `provider+environment+eventId` unique. Test olayı production entitlement değiştiremez (B11).
- [ ] Inbox işleyicisi abonelik, entitlement ve outbox kaydını aynı Labs transaction'ında değiştirir. Retry/backoff, dead-letter görünümü ve yetkili replay bulunur. Kabul yanıtından sonra süreç kapanırsa olay kaybolmaz.
- [ ] Sırası değişen olaylarda sağlayıcı revision/updatedAt ve gerekirse sağlayıcıdan son durum sorgusu kullan; geç gelen eski olay durumu geriye alamaz. Sadece webhook'a güvenmeyen periyodik mutabakat ekle.
- [ ] Test: `duplicate_webhook_creates_one_subscription`, `old_event_cannot_reactivate_cancelled`, `test_event_cannot_grant_production`, `checkout_price_tamper_rejected`, `crash_after_inbox_recovers`. Sağlayıcı sandbox gerçek akışı ayrıca kaydet.

## C05 — Abonelik yaşam döngüsü

Bağımlılık: C04. Dosyalar: Labs yeni `subscription_policy.rs`, ilgili billing modülleri; API yeni `subscriptions.ts`; yeni `docs/contracts/subscription-policy.md`.

- [ ] Durumlar: pending/active/past_due/canceled/expired/refunded/suspended; provider raw durumu ayrı sakla. Durum geçişini olay/neden/zamanla tabloya dök.
- [ ] Önerilen ilk sürüm: yükseltme ve düşürme dönem sonunda; anında oransal ücretlendirme ancak ayrı hesap ve iade testleri tamamlanırsa açılır. Portal etki ve yürürlük tarihini satın almadan önce gösterir.
- [ ] Düşük cihaz limitine geçişte kullanıcı aktif tutulacak cihazları seçer; kendiliğinden rastgele cihaz silinmez. Kapanacak özellikler ve devam eden işler önizlenir.
- [ ] Yenileme başarısız, iptal talebi, dönem sonu, geri ödeme ve chargeback için erişim politikasını ayrı tanımla; manuel iade asıl provider işlemiyle mutabık olmalı.
- [ ] Test: `cancel_preserves_access_until_period_end`, `downgrade_requires_device_resolution`, `refund_does_not_duplicate_or_delete_sales`, `pending_return_does_not_activate`. Web/Labs/desktop aynı UTC sınırında aynı statüyü üretir.

## C06 — Cihaz ve lisansın gerçek güvenlik sınırı

Bağımlılık: C03/C05. Dosyalar: `backend/api/src/{license,desktopLicense}.ts`, `backend/src/services/license.rs`, `backend/src/commands/license_commands.rs`, `desktop/src/stores/licenseStore.ts`; yeni backend erişim politika modülü/testleri.

- [ ] Cihaz eşleme kodu kısa ömürlü, tek kullanımlı, tahmin denemesi sınırlı; tarayıcı dönüş URL'si allowlist. Device token güvenli yerel depoda; frontend/log/URL içinde kalıcı token yok.
- [ ] Cihaz limiti tahsisini Labs transaction'ında yap; eşzamanlı iki kayıt son slotu birlikte alamaz. İptal ve yeniden kurulum politikasını cihaz detayı ekranıyla bağla.
- [ ] Lisans v2 imza/tenant/device/keyId/zaman doğrula; mevcut v1 için süreli uyumluluk planı yaz. Anahtar rotasyonunda eski geçerli cihaz bir anda kilitlenmez.
- [ ] `VITE_LICENSE_ENFORCED` üretimde bypass sağlayamaz. Yetki kontrolünü Rust komut/servis sınırına koy; menü, route, kısayol ve IPC aynı kararı uygular.
- [ ] Kapanış/salt okunur modunu tek dev LicenseGate yerine işlem bazlı uygula. Saati geriye alma için son güvenilir server zamanı ve monotonic elapsed yaklaşımını test et; yeniden başlatma belirsizliğinde fail-closed yazma politikası.
- [ ] Test: `last_device_slot_is_atomic`, `wrong_tenant_license_rejected`, `disabled_feature_ipc_denied`, `clock_rollback_does_not_extend_license`, `expired_license_allows_authorized_export`, `closure_mode_cannot_increase_order`, `upstream_failure_cannot_extend_lease`, `v1_to_v2_upgrade_preserves_device`. B02 için correlationId ile gerçek reddin nedeni ayrıca bulunur.

## C07 — Yerel ağ, bulut ve kurtarma tutarlılığı

Bağımlılık: C02/C06. Dosyalar: `backend/src/services/{cloud_sync,lan_sync}/`, `backend/api/src/sync/`, `desktop/src/features/patron/settings/CloudSyncSettings.tsx`.

- [ ] LAN eşitlemesi, bulut aktarımı, lisans erişimi ve yedek durumunu ayrı sözleşmelerle göster. “Yerelde hazır” bulutta güncel demek değildir.
- [ ] Outbox kalıcı, opId unique, retry idempotent; sunucu kabulünden önce yerel kaydı düşürme. Cursor kaybı/yeniden başlatma/tekrarlı batch senaryolarını işle.
- [ ] Yukarıdaki tek işlem otoritesi politikasını `write_tx`, cari execute, bütün write gateway'leri ve UI'da uygula; `NO_AUTHORITY/QUORUM_LOST` doğrudan bağımsız finansal ada commit'ine dönüşemez. `docs/offline-conflict-policy.md` oluştur; eski ada kayıtları için kayıpsız geçiş/mutabakat yolu ekle. Ana kasa internetsiz çalışırken otoriteden kopan ikincil cihaz yeni tahsilat yapamaz.
- [ ] Offline cihaz başka tenant'a geçerken eski kuyruk yeni tenant'a gönderilemez. Cihazdan bulut snapshot'a ve temiz cihaza dönüş şema/sürüm kontrolü taşır.
- [ ] Test: `retry_sync_does_not_duplicate_payment`, `partition_secondary_cannot_collect`, `authority_keeps_selling_without_internet`, `authority_transfer_fences_old_writer`, `legacy_island_conflict_keeps_both_audit_trails`, `tenant_switch_cannot_flush_old_queue`, `restore_matches_totals_and_hash_chain`. Testte gerçek süreç kapanması ve bağlantı kesintisi kullan; sadece mock success yeterli değil.

## C08 — Ortak uyarı sistemi

Bağımlılık: C01. Dosyalar: Labs `notifications.rs`, `desktop/src/services` yerine mevcut store/feature yapısına uygun yeni `desktop/src/stores/notificationStore.ts`; API yeni `notifications.ts`; `docs/contracts/events.md`.

- [ ] Olay kodları: payment_failed, subscription_expiring, device_limit, license_denied, sync_blocked, backup_failed, setup_incomplete, support_reply. Her biri severity/recipient/CTA/dedupKey/resolutionOwner taşır.
- [ ] `seenAt`, `acknowledgedAt`, `resolvedAt` ayrı; kaynak olay çözülürse ilgili uyarı kapanır. Tekrar oluşum yeni occurrence; aynı sürekli arıza spam üretmez.
- [ ] OWNER mali uyarıları, CASHIER işlem uyarılarını, platform ekibi kendi yetkili ürün/tenant olaylarını görür. Bildirim hedef URL'si izinli uygulama route'larından üretilir.
- [ ] E-posta kanalı için transactional outbox, gönderildi/başarısız ve retry; pazarlama izni ayrı. Kritik operasyon uyarısı yalnız e-postaya bırakılmaz.
- [ ] Test: `repeat_fault_deduplicates`, `read_does_not_resolve`, `resolved_source_closes_alert`, `waiter_cannot_read_billing_alert`. Geçici toast ile kalıcı arıza aynı kayıt türü değildir.

## C09 — Finans, stok ve audit regresyonları

Bağımlılık: Q01; frontend yeniden yazımından önce temel testler kaydedilir. Dosyalar: `backend/src/commands/{pos_commands,payment_commands,cashier_commands}/` mevcut karşılıkları, `backend/src/services/{inventory360,audit_service,refund_service,report_service}*`.

- [ ] Komut→rol/tenant→transaction→audit zincirini ödeme, iptal, iade, stok giriş/fire/sayım, kasa aç/kapat için denetle. Dosya adını mevcut `rg --files` ile doğrula; bulunmayan modülü varsayma.
- [ ] Integer cents ve checked arithmetic; DB hatasını sıfır toplam yapma. Transaction yarıda kesilirse sipariş/ödeme/stok/audit tutarlı geri alınır.
- [ ] Gerçek FIFO, reçete birimleri ve tek stok düşümü; satış fiyat/KDV snapshot'ı; PAID/CLOSED iptal engeli; iade ayrı ters kayıt.
- [ ] Test verisi Q04: 50000 cents tahsilatın nakit 20000/kart 30000 ayrımı; tekrar tahsilat toplamı değiştirmez; iki lotun maliyeti 1400 cents; satış sonrası fiyat değişimi açık kalemi etkilemez.
- [ ] Kabul: yeni testler önce eksik davranışı yakalar, sonra geçer; audit zinciri ve finans toplamı bağımsız sorguyla karşılaştırılır. Mevcut yeşil testler silinerek başarı elde edilmez.

## C10 — Silme, dışa aktarım ve veri yaşam döngüsü

Bağımlılık: C02/C07. Dosyalar: API `lib/{mongo,auth}.ts`; yeni `accountDeletion.ts`, `accountDeletion.test.ts`; backend yedek/dışa aktarım servisleri.

- [ ] Profil silme, işletmeden ayrılma, abonelik iptali ve işletme kapatma ayrı akış. Son OWNER hesabının silinmesi sahiplik devri/işletme kapanış kararı olmadan işletmeyi sahipsiz bırakmaz.
- [ ] Mongo hesap ve işletme kümeleri arasında tek transaction yok; silme iş akışı durum/milestone/retry ile tutulur. Her adım tekrar güvenli; başarısız cleanup gözlenebilir.
- [ ] Saklama gerektiren finans kayıtları ve yerel cihaz verisi için ürün/satıcı kararı al; uygulama “hesap silindi, her veri her yerde silindi” diyemez. Export tenant doğrulamalı ve kısa ömürlü indirme ile sunulur.
- [ ] Test: `last_owner_cannot_orphan_tenant`, `delete_retry_resumes_after_second_cluster_failure`, `export_excludes_other_tenant`, `account_deletion_does_not_silently_erase_local_ledger`.

## C11 — Güvenlik sertleştirmesi

Bağımlılık: C01/C02. Dosyalar: API auth/config/middleware; Labs `main.rs`, `team.rs`, `account.rs`, integrations; yeni `docs/security-threat-model.md`.

- [ ] Gerçek saldırı yüzeyi çıkar: web auth, OAuth redirect, cihaz eşleme, webhook, Labs session, IMAP/SMTP, attachment, LAN keşfi, güncelleme, yedek. Bulgu/şüphe ayrımını koru.
- [ ] Labs yönetici MFA, kurtarma kodu, oturum iptali ve riskli işlemde yeniden doğrulama; login rate limit hesap+IP, ölçeklenince paylaşılan store. Cookie/CORS/CSRF/origin/HTTPS politikaları testle doğrulanır.
- [ ] Tenant ve platform RBAC server-side; SQL parametreli, output escaping, e-posta HTML sanitization, dosya türü/boyutu, path traversal, SSRF ve secret redaction kontrolleri.
- [ ] Secret'lar frontend/env bundle'a girmez; anahtar rotasyonu, least-privilege DB kullanıcıları, bağımlılık taraması ve CI secret scan kurulur.
- [ ] Test: `support_role_cannot_change_billing`, `cross_origin_mutation_denied`, `mail_html_cannot_execute_script`, `logs_redact_tokens`, `mfa_required_for_admin`. Statik inceleme penetrasyon testi yerine sunulmaz; açık yüksek riskler G4'ü bloklar.

## C12 — Migration ve üretim gözlenebilirliği

Bağımlılık: C02–C11. Dosyalar: mevcut SQL migration'ları, API `migrate.ts`, yeni migration testleri; yeni `docs/operations/migration-runbook.md`.

- [ ] Eski paket/abonelik/tenant/device kayıtlarını dry-run raporuyla dönüştür; bilinmeyen e-posta eşlemelerini otomatik birleştirme. Preflight yedek, kayıt sayısı, tutar ve referans tutarlılığı çıkar.
- [ ] Schema migration numarası mevcut sırayı izler; destructive değişiklik yerine expand/backfill/verify/contract. Geri dönüşün DB şemasıyla uyumluluğu açıkça yazılır.
- [ ] CorrelationId, sürüm, tenant/cihaz için maskeli kimlik, hata kodu; queue age, webhook başarısızlığı, sync gecikmesi, lisans red oranı, backup age metrikleri. Parola/PIN/token/ham ödeme payload loglama yok.
- [ ] Kabul: eski kopya veriden yeni sürüme yükseltme ve yedekten geri dönüş denenir; başarısız migration hizmeti yanlışlıkla boş DB ile açmaz. Sağlık kontrolü bağımlılık bozukken sahte yeşil dönmez.
