# API sözleşmesi — ticari zincir ve mevcut uyumluluk

Durum: `kasam360.commercial.v1-draft.2`. C02 işletme oluşturma/OWNER üyelik, C03 Labs tenant bağı/etkin hak okuma ve C06 tenant cihaz/V2 lisans/scope'lu sync uçları uygulanmıştır. Gerçek provider checkout, ödeme ve abonelik yaşam döngüsü uygulanmamıştır. JSON alanları camelCase, kalıcı SQL alanları snake_case olur.

## Ticari zincir işlemleri — request/response ve durum

| İşlem | Durum / gerçek servis | Request → response | Yetki, tenant ve veri sahibi |
|---|---|---|---|
| Hesap oluşturma/giriş/doğrulama | Mevcut: `POST /api/auth/sign-up/email`, `sign-in/email`, e-posta doğrulama Better Auth yolları | Kayıt request `{name,email,password,businessName,consent,callbackURL?}` (profile validator ek alanları koşula göre kabul eder); giriş `{email,password,callbackURL?}`. Better Auth cevapları sağlayıcı biçimindedir, session cookie tarayıcıda tutulur. Parola/oturum gövdesi loglanmaz. | İzinli Origin; Better Auth oran sınırı ve e-posta doğrulaması. Hesap/credential/session sahibi account Mongo. Daha önce kayıtlı hesap tekrar kayıt olamaz; giriş aynı hesaba bağlanır. |
| İşletme oluşturma | Mevcut: `POST /v1/tenants` (C02) | Request `{businessName,country:'TR',currency:'TRY'|'USD'|'EUR',timeZone:'Europe/Istanbul'}` + `Idempotency-Key` UUIDv4. İlk: `201 {tenant:{tenantId,name,country,currency,timeZone,status:'active',version:1,createdAt},membership:{membershipId,userId,tenantId,role:'OWNER',status:'active',version:1,createdAt}}`; replay `200` aynı kimlikler. | E-posta doğrulanmış oturum. `userId` session’dan; istemci tenant/role gönderemez. Tenant, OWNER üyelik ve idempotency account Mongo transaction’ında. Tek hesap birden fazla tenant oluşturabilir; yeni key yeni işletme demektir. |
| İşletme listesi/detay | Mevcut: `GET /v1/tenants`, `GET /v1/tenants/:tenantId` (C02) | Liste: `200 {tenants:[{tenant,membership}]}`; detay `200 {tenant,membership}`. Tenant wire alanı `tenantId`, membership wire alanı `membershipId`; Mongo `_id` dışarı verilmez. | Session kullanıcısının aktif üyeliklerine göre sorgulanır. Liste başka hesapların kaydını içermez. Detayda üyelik yoksa `404 NOT_FOUND` ile varlık gizlenir. |
| Paket/katalog listeleme | Uygulandı (C03/L03/W02 ilk dilimi) | Web `GET /v1/catalog?productId=kasam360` → `200 CatalogResponse={productId,revision:'sha256-<64 hex>',packages:PackageResponse[]}`. Her paket: `{packageId,packageVersion,productId,name,description,sortOrder,highlighted,featureKeys,features:[{key,name,description}],deviceLimit,status:'published',price:{priceId,amountCents,currency,interval,taxBehavior,version,effectiveAt}}`. | Public read-only katalog. API server Labs `GET /api/v1/urunler/kasam360/katalog` çağrısına Labs ürün entegrasyon anahtarını ekler; credential web'e dönmez. Labs SQLite ticari kayıt otoritesidir; yalnız `published` paketler ve satışa hazır feature'lar gelir. Labs/API hata veya şema uyuşmazlığında boş/sıfır katalog dönmez, `UPSTREAM_UNAVAILABLE` ile fail-closed olur. Paket yayımlamak hak vermez. |
| Ticari tenant eşleme | Mevcut: `PUT /v1/tenants/:tenantId/commercial-link` | OWNER session üzerinden istenir; istemci body alanı kullanılmaz. `200 {tenantId,linked:true}`. API tenant adını kendi tenant kaydından alır; Labs `PUT /api/v1/urunler/:slug/kiracilar/:tenantId/bagla` için `{name}` alır ve aynı `(productId,tenantId)` eşlemesini tekrar istekte çoğaltmaz. | API'de aktif OWNER üyeliği zorunlu; tenant adı API Mongo kaydına aittir. Labs mapping'i ticari ilişki kaydıdır, tek başına entitlement vermez. Bozuk upstream yanıtı `502`, ulaşılamayan Labs `503` ile reddedilir. |
| Etkin hak okuma | Mevcut: `GET /v1/tenants/:tenantId/entitlement` | `200 EffectiveEntitlementResponse={tenantId,productId,status:'active'|'inactive'|'conflict',source:'subscription'|'manual'|'none',packageId:string|null,packageVersion:number|null,featureKeys:string[],deviceLimit:number,validFrom:string|null,validUntil:string|null,revision:number}`. Etkin örnek: `{tenantId:'tnt_…',productId:'prd_…',status:'active',source:'subscription',packageId:'pkg_…',packageVersion:1,featureKeys:['feat_kds'],deviceLimit:2,validFrom:'2026-11-07T00:00:00Z',validUntil:'2030-01-01T00:00:00Z',revision:1794009600000}`. | Yalnız aktif OWNER; başka tenant `404`. Labs SQLite kaydı otoritedir; yalnız eşlenmiş tenant için doğrulanmış abonelik veya actor/reason/expiry bilgili yetkili süreli manuel hak okunur. Published paket tek başına hak değildir. Çakışan kaynak veya tutarsız paket sürümü `conflict`/sıfır hak olur. Test ortamı production okumasına karışmaz. Labs ve API aynı DTO'yu taşır; geçersiz cevap `502`, upstream kesintisi `503` olur. |
| Teklif | Yeni; C04 | `POST /v1/tenants/:tenantId/quotes`, `QuoteRequest={priceId,billingCountry:'TR',currency}` → `201 QuoteResponse={quoteId,tenantId,priceId,priceVersion,subtotalCents,taxCents,totalCents,currency,expiresAt}`. | Doğrulanmış tenant OWNER. Tenant path’i session üyeliğiyle doğrulanır. Labs fiyat/vergi sürümünden sunucu hesaplar; istemci tutarı kabul edilmez. Tax/rounding ticari karar olmadan sabitlenmiş değildir. |
| Checkout intent / bağlama | Mevcut: `POST /v1/tenants/:tenantId/checkout-intents` (C04 ilk dilimi) | Request `{priceId}` + `Idempotency-Key: <UUIDv4>` → `201 {checkoutIntentId,tenantId,productId,packageId,packageVersion,priceId,status:'awaiting_provider'|'completed'}`. Aynı tenant/key/price aynı intent’i döndürür; aynı key farklı price `409 IDEMPOTENCY_CONFLICT`. Örnek: `{priceId:'prc_…'}`. | Aktif OWNER ve tenant üyeliği doğrulanır; Labs published/current exact price sürümünü ve tenant/package/version/price/key bağını SQLite transaction’ında saklar. Bu kayıt ödeme başlatmaz, redirect URL vermez, hak üretmez. Yalnız doğrulanmış provider webhook'u aynı tenant, price ve intent'e bağlı aboneliği ilişkilendirip intent’i `completed` yapar. Test webhook’u yalnız test çevresinde hak verir. |
| Checkout/satın alma | Yeni; C04 (sağlayıcı) | `POST /v1/tenants/:tenantId/checkouts`, `CheckoutRequest={quoteId}` + `Idempotency-Key` UUIDv4 → `201 CheckoutResponse={checkoutId,status:'pending',redirectUrl,expiresAt}`; aynı anahtar/payload aynı checkout; aynı anahtar farklı payload `409 IDEMPOTENCY_CONFLICT`. | Tenant OWNER, teklif aynı tenant’a ait ve süresi geçmemiş olmalı. Labs idempotency/inbox ve ödeme sağlayıcı asıl işlem kaydıdır. Tarayıcı dönüşü hak vermez; yalnız doğrulanmış live webhook aboneliği aktive edebilir. Test webhook’u live hak üretemez. |
| Abonelik okuma/iptal | Yeni; C05 | `GET /v1/tenants/:tenantId/subscription` → `200 SubscriptionResponse|null`. İptal: `POST /v1/tenants/:tenantId/subscription/cancel`, body `{cancelAtPeriodEnd:boolean}` + idempotency key → `200 SubscriptionResponse`. | Tenant OWNER; tenant filtresi her sorguda. Labs ticari kayıt sahibi. Aynı idempotency payload aynı durum; eski/geç webhook geçişi geri alamaz. |
| Tenant cihaz aktivasyonu | Uygulandı; `POST /api/desktop/tenants/:tenantId/activate` | Bearer lisans anahtarı + `x-device-id`; body kesin `{tenantName,label,platform:'windows'}` → Labs `TenantDevice={deviceId,tenantId,label,platform,status,registeredAt,version}`. Cihaz kimliği API tarafından değiştirilmez. | E-posta doğrulanmış hesap sahibi; tenant OWNER üyeliği zorunlu veya aynı hesap için yeni yerel tenant atomik olarak oluşturulur. Labs `BEGIN IMMEDIATE` ile etkin abonelik/süreli manuel hak ve cihaz slotunu doğrular. Aynı cihaz/tenant tekrarı idempotenttir; başka tenant'a device ID taşıma ve iptal edilmiş cihazı canlandırma `409`; son slot yarışı tek kazanır. |
| Tenant cihaz listeleme/iptal | Uygulandı: `GET /v1/tenants/:tenantId/devices`, `POST /v1/tenants/:tenantId/devices/:deviceId/revoke`; desktop bearer adaptörleri `/api/desktop/tenants/:tenantId/devices` ve `POST .../:deviceId/revoke` | Liste `{tenantId,devices:DeviceResponse[]}`; iptal `DeviceResponse` (`status:'revoked'`, artan `version`). Desktop adaptörleri `Authorization: Bearer lk_…`, `x-device-id` kullanır. | Web oturumunda aktif OWNER; desktop'ta e-posta doğrulanmış lisans sahibi + OWNER üyeliği. Labs tenant filtresi uygular; tekrar iptal aynı revoked sürümü döndürür; başka tenant/eksik cihaz `404`. API tenant-device sync yetkisi iptalde kapatılır. |
| Lisans V1 yenileme | Mevcut: `GET /api/license` veya `GET /api/desktop/license`; sonuncusu `Authorization: Bearer lk_…`, `x-device-id`, `x-device-name` alır. | `200 {token,claims:{v:1,product:'kasam360',sub,email,deviceId,validUntil,blocked,plan:{name,features,deviceLimit}|null,issuedAt,graceHours:72}}`; hata `{message,device?}`. Claims Ed25519 imzalı. | Web route doğrulanmış, e-postası onaylı oturum; desktop route hash’i saklı lisans anahtarı sahibini bulur. Labs `/api/v1/urunler/kasam360/lisans`’a `{email,account,device:{id,name}}` yollar. Bu eski modelde tenant üyeliği lisans kimliği değildir. |
| Lisans V2 | Uygulandı: `POST /api/desktop/tenants/:tenantId/license/refresh` | Bearer lisans anahtarı + `x-device-id` → `DeviceLicenseResponse={version:2,keyId,tenantId,deviceId,productId,entitlementRevision,featureKeys,issuedAt,refreshAfter,offlineUntil,paidUntil,mode:'active',signature}`. `productId`, Labs etkin hak kaydındaki `prd_<26 karakter ULID>` değeridir; katalog sorgusundaki `kasam360` ürün anahtarı değildir. Ed25519 imzası claims'in JSON alan sırası korunarak serialize edilmiş gövdesi üzerindedir; offline süre en fazla 72 saat ve `paidUntil` sınırını aşmaz; yenileme aralığı en fazla 24 saattir. Sync bitişi tam `min(paidUntil, offlineUntil)` anıdır; V1 gün sonu +72 saat toleransı V2'ye uygulanmaz. |

`PackageResponse`, `CatalogResponse`, quote, checkout, subscription, device, license ve `ApiError` alanlarının çalıştırılabilir TypeScript validator’ları ile TEST_A geçerli/geçersiz fixture’ları `backend/api/src/contracts/commercialChain.ts` / `.test.ts` içindedir. Katalog proxy testleri `backend/api/src/catalog.test.ts`; web render doğrulayıcısı `web/src/lib/catalogApi.test.ts` içindedir. Ortak TEST_A/TEST_B kimlik kaynağı `backend/api/src/acceptanceIds.ts` olup Labs ve web testleri bu sabitleri kullanır. Yalnız quote ve sonrası hâlâ hedef DTO'dur; bunlar için uygulanmayan route varmış gibi sunulmaz.

## Hata, retry ve idempotency

| HTTP | Kod | Retry davranışı |
|---:|---|---|
| 400/422 | `INVALID_REQUEST`, `INVALID_MONEY`, `UNKNOWN_FEATURE` | Girdi düzeltilmeden tekrar yok. Kuruşlar nonnegative safe integer; overflow/float reddedilir. |
| 401/403 | `UNAUTHENTICATED`, `EMAIL_NOT_VERIFIED`, `TENANT_FORBIDDEN`, `NO_ENTITLEMENT`, `DEVICE_REVOKED`, `LICENSE_BLOCKED`, `DEVICE_NOT_LICENSED`, `LICENSE_INACTIVE`, `NEW_OPERATION_AFTER_EXPIRY` | Oturum/üyelik yenile; hak/cihaz reddinde otomatik mutasyon retry yok. İptal/engel push ve release dahil tüm erişimi kapatır. Lisans yenileme reddi saklı V2 token'ı kapatır; bitişten önceki kuyruk istisnası yalnız süre sonuna uygulanır. |
| 404 | `NOT_FOUND` | Tekrar etme; tenant kaynak varlığını sızdırmaz. |
| 409 | `CONFLICT`, `IDEMPOTENCY_CONFLICT`, `QUOTE_EXPIRED`, `DEVICE_LIMIT` | Payload düzelt/yeni quote veya OWNER cihaz çözümü; aynı device/tenant aktivasyonu güvenle tekrarlanır, farklı tenant ve iptal edilmiş ID reddedilir. |
| 429 | `RATE_LIMITED` | `Retry-After` varsa bekle, yalnız safe/idempotent istek tekrar edilir. |
| 502/503 | `OUTCOME_UNKNOWN`, `UPSTREAM_UNAVAILABLE`, `LICENSE_UNAVAILABLE` | Checkout sonucu belirsizse yeni tahsilat başlatma; aynı idempotency key ile sorgula/uzlaştır. Lisans yenileme son geçerli belgeyi silmez ve yeni offline süre üretmez. |

Error wire biçimi hedef `{code,message,correlationId,retryable,fieldErrors?}`; geçersiz girişte parola, token, PHC veya provider payload’u yansıtılmaz. Mevcut legacy yolların bazıları yalnız `{message}`/Better Auth gövdesi döndürür; bu C01 yeni error DTO’su geriye dönük cevap değişikliği değildir.

## Mevcut HTTP yüzeyi

| Yüzey | Mevcut yol | Kimlik / yetki | Gözlenen davranış |
|---|---|---|---|
| API sağlık | `GET /health` | Yok | `{ "ok": true }` |
| Hesap | `GET, POST /api/auth/*` | Better Auth oturumu; POST izinli Origin | Auth sağlayıcısının mevcut JSON biçimi |
| Desktop web bağı | `GET /api/desktop-link/:code/google`, `/:code/finish`, `/:code` | Site oturumu, tek kullanımlı kod | Kısa süreli hesap özeti ve varsa lisans anahtarı; kod bellek içi |
| Lisans | `GET /api/license` | Doğrulanmış web oturumu + cihaz başlıkları | İmzalı mevcut lisans V1 veya `{message}` hatası |
| Desktop lisans | `POST /api/desktop/license-key`, `GET /api/desktop/license` | Parola doğrulama / bearer lisans anahtarı + cihaz | Anahtar veya imzalı lisans V1 |
| Müşteri hesabı iç eşitleme | `GET, POST /internal/labs/customers` | `LABS_CUSTOMER_SECRET` bearer | E-posta ve hesap özeti listesi / idempotent hesap provision; tenant üyeliği değil |
| Destek köprüsü | `GET, POST /api/support`, `/api/support/:ticket` | Doğrulanmış hesap; yazmada Origin ve `Idempotency-Key` | Labs destek uçlarına proxy; hata alanı yalnız `message` |
| Bulut sync V1 | `POST /api/desktop/sync/push`, `GET /pull`, `GET /snapshot`, `POST /release` | Desktop lisans anahtarı, e-posta doğrulaması ve cihaz lisansı | Geriye uyumlu tek-kiracı yolları; çoklu üyelikte tenant belirsizse kapalı. |
| Tenant sync | `POST /api/desktop/sync/tenants/{tenantId}/push`, `GET .../pull?after=&limit=`, `GET .../snapshot?asOf=&cursor=&limit=`, `POST .../release` | Desktop lisans anahtarı + e-posta doğrulaması + tenant/device eşleşmesi; push için aktif OWNER üyeliği. Pull/snapshot yalnız etkin cihaz. Süresi dolmuş cihaz yalnız bitişten önce oluşmuş, kendi cihaz kimliğini taşıyan eski kuyruğu push edebilir; yeni işlem reddedilir. İptal/engel tüm işlemleri reddeder. | Desktop IPC tenant yolunu kurulumdaki `app_setup.tenant_id` üzerinden kurar. Her operation tenant ve cihazla doğrulanır; path/body mismatch `403 TENANT_MISMATCH`; üyelik dışı `404`; replay aynı seq, farklı içerik `409`. Yeni işlem lisans sonrasında yaratılmışsa `403 NEW_OPERATION_AFTER_EXPIRY`; iptalde `403 DEVICE_REVOKED`; engelde `403 LICENSE_BLOCKED`. Release yeni işletme verisi üretmez. V1 gün sonu +72 saat kuralı yalnız V1’e aittir. |
| Labs lisans iç API | `POST /api/v1/urunler/{slug}/lisans` | Labs entegrasyon anahtarı | KASAM360 API'nin beklediği mevcut alanlar snake_case |
| Labs posta hesabı (`kasam360.mail.v1`) | `GET /api/v1/urunler/{slug}/posta-hesabi` | Labs ürün entegrasyon anahtarı (`LABS_CATALOG_TOKEN`) | `200 {contract,accountId,source:'product'\|'default',host,port,security:'ssl'\|'starttls'\|'none',username,password,fromName,fromAddress}`; hesap yoksa `404 {contract,code:'MAIL_ACCOUNT_NOT_CONFIGURED'}`; Labs şifreleme anahtarı yoksa/yanlışsa `503 {contract,code:'MAIL_SECRET_UNAVAILABLE'}`; `Cache-Control: no-store`. Parola yalnız bu yanıttadır, Labs arayüzüne dönmez. `none` yalnız `localhost`/`127.0.0.1`. API (`lib/mail.ts`) önce bu hesabı kullanır (60 sn önbellek, Labs kesilirse en çok 15 dk son doğrulanmış hesap); Labs "hesap yok" derse veya ulaşılamaz ve önbellek yoksa tam `SMTP_*` env yedeği, o da yoksa yalnız `DEV_MAIL_DIR` + üretim dışı sink, aksi halde hata. Labs hesabı geçersiz/yanlış parolalıysa env yedeğine kayılmaz, gönderim hata döner; bozuk 200 yanıtı hata sayılır. |
| Labs müşteri destek API | `GET, POST /api/v1/urunler/{slug}/destek`, `GET, POST .../{ticket}` | Ürüne bağlı müşteri bearer | Ticket ve mesaj JSON'u |
| Labs ödeme olayı | `POST /api/v1/webhooks/lemonsqueezy` | İmzalı ham provider body | Mevcut provider olayı; test/sandbox semantiği ayrıca sözleşmeye bağlanmalı |

Labs yönetim arayüzünün HTML/form POST yolları (ürün, paket, abonelik, ekip, müşteri, cihaz, bildirim, posta ve destek) müşteri API'si değildir. Tam mevcut route/handler haritası [360 Labs kaynak kodunda](../../../360labs/src/main.rs) tutulur. API ve IPC komutlarının gözlenen ad envanteri [IPC listesinde](ipc-current.md) bulunur.

## Hedef v1 DTO'ları

Aşağıdaki alanlar ana plandaki hedef sözleşmeden alınmıştır. Kabul edilene dek yeni yol veya çalışan davranış gibi tüketilmemelidir.

| Tür | Alanlar |
|---|---|
| `Money` | `amountCents: integer >= 0`, `currency: ISO 4217` |
| `TenantMembership` | `userId, tenantId, role, status, version` |
| `PackageVersion` | `packageId, version, productId, name, featureKeys[], deviceLimit, status` |
| `PriceVersion` | `priceId, packageId, packageVersion, amountCents, currency, interval, taxBehavior, version` |
| `Quote` | `quoteId, tenantId, priceId, priceVersion, subtotalCents, taxCents, totalCents, currency, expiresAt` |
| `Subscription` | `subscriptionId, tenantId, packageId, packageVersion, priceId, status, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, provider, providerRef, environment, version` |
| `Entitlement` | `tenantId, productId, packageVersion, featureKeys[], deviceLimit, status, paidUntil, revision, source, effectiveAt` |
| `Device` | `deviceId, tenantId, label, platform, status, registeredAt, lastSeenAt` |
| `DeviceLicenseV2` | `version=2, keyId, tenantId, deviceId, productId, entitlementRevision, featureKeys[], issuedAt, refreshAfter, offlineUntil, paidUntil, mode, signature` |
| `ApiError` | `code, message, correlationId, retryable, fieldErrors?` |

Tüm para alanları integer cents ve JavaScript safe integer sınırındadır. `1.5`, `NaN`, sonsuz ve `Number.MAX_SAFE_INTEGER` üstü tutar reddedilir; taşma hata olur. Para hesapları float kullanmaz. Bilinmeyen enum/feature anahtarı fail-closed reddedilir. Tarihler UTC RFC3339'dur; rapor saat dilimi tenant ayarıdır. API çağrılarında `tenantId` doğrulanmış oturum üyeliğinden çözülür; istemci alanı tek başına yetki değildir.

## Hedef yollar ve örnekler

`POST /v1/tenants` (oturum + doğrulanmış hesap + idempotency):

```json
{
  "businessName": "TEST_A Kafe",
  "country": "TR",
  "currency": "TRY",
  "timeZone": "Europe/Istanbul"
}
```

Önerilen başarı gövdesi:

```json
{
  "tenant": { "tenantId": "tnt_01J00000000000000000000000", "name": "TEST_A Kafe", "status": "active", "version": 1 },
  "membership": { "userId": "usr_01J00000000000000000000000", "tenantId": "tnt_01J00000000000000000000000", "role": "OWNER", "status": "active", "version": 1 }
}
```

`POST /v1/tenants/{tenantId}/quotes` (`OWNER`; gövde `priceId` ve fatura bağlamı):

```json
{
  "quoteId": "qte_01J00000000000000000000000",
  "tenantId": "tnt_01J00000000000000000000000",
  "priceId": "prc_01J00000000000000000000000",
  "priceVersion": 1,
  "subtotalCents": 100000,
  "taxCents": 0,
  "totalCents": 100000,
  "currency": "TRY",
  "expiresAt": "2026-11-06T12:00:00Z"
}
```

Bu yalnız biçim örneğidir; vergi oranı/yuvarlama C01'de kararlaştırılmadan `taxCents: 0` ticari kural sayılmaz.

`POST /v1/tenants/{tenantId}/checkouts` gövdesi `{ "quoteId": "qte_…" }`; aynı işlem `Idempotency-Key: <UUID>` ile aynı `checkoutId/status` sonucunu döndürür. Tarayıcı başarı dönüşü ödeme veya entitlement kanıtı değildir. `GET /v1/tenants/{tenantId}/subscription` yalnız yetkili üyeye durum döndürür. `POST .../subscription/cancel` OWNER yetkilidir ve tekrarlandığında aynı sonucu verir. Bu yollar henüz kodda uygulanmış değildir.

## Yetki ve hata biçimi

| İşlem | Asgari yetki |
|---|---|
| Tenant listeleme/üyelik okuma | Oturum sahibi, yalnız üye olduğu tenant'lar |
| Tenant oluşturma | E-posta doğrulanmış hesap; idempotency zorunlu |
| Teklif, checkout, abonelik değişimi/iptali, cihaz yönetimi | Aynı tenant'ın `OWNER` üyeliği |
| Labs ticari yazma | Sadece internal servis kimliği veya yetkili Labs platform rolü; tarayıcı servis anahtarı alamaz |
| POS mutasyonu | Yerel oturum rolü + tenant + lisans/feature; UI gizleme yetki sayılmaz |

Örnek standart hata:

```json
{ "code": "TENANT_FORBIDDEN", "message": "Bu işletme için yetkiniz yok.", "correlationId": "cor_01J00000000000000000000000", "retryable": false }
```

Hedef kod kataloğu: `INVALID_REQUEST`, `INVALID_MONEY`, `UNKNOWN_FEATURE`, `UNAUTHENTICATED`, `TENANT_FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `IDEMPOTENCY_CONFLICT`, `RATE_LIMITED`, `OUTCOME_UNKNOWN`, `UPSTREAM_UNAVAILABLE`. Alan hataları `fieldErrors` altında güvenli alan adı ve sabit kod taşır; sır/PHC/token içermez. `OUTCOME_UNKNOWN` yeni tahsilat retry'si yaptırmaz. HTTP status ve her hata kodunun retry politikası kodlu C01 şemasında sabitlenmelidir.

## Geçiş

`/api/auth/*`, `/api/license`, `/api/desktop/*`, `/api/desktop/sync/*`, `/api/support*`, Labs `/api/v1/*` ve Tauri IPC mevcut tüketicileri taşınana dek uyumluluk yüzeyi olarak kalır. `/v1/*` eklendiğinde eski cevaplar sessizce yeniden şekillendirilmez. Kaldırma ancak yeni sürüm, telemetri/çağıran listesi ve ayrı geçiş kabulüyle yapılır.
