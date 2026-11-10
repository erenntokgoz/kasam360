# QR menü sözleşmesi — `kasam360.qrmenu.v1`

Durum: API ve Labs tarafı uygulandı (`backend/api/src/qrMenu/`, `360labs/src/qr_menu.rs`). Masaüstü yayınlama istemcisi ve public menü sayfası (`menu.kasam360.com.tr/{slug}`) bu sözleşmeyi kullanacak ayrı işlerdir; henüz yoktur. İlk sürüm yalnız gösterimdir: sipariş, sepet, ödeme veya müşteri verisi yoktur.

Kararlar:

- Masaüstü local-first kalır; menüyü API'ye yayınlar. Ürün açıklaması ve görseli masaüstünden düzenlenir.
- Public adres `menu.kasam360.com.tr/{slug}`. Slug'ı yalnız Labs yöneticisi atar; işletme (OWNER dahil) değiştiremez, API'de işletme tarafı slug yazan uç yoktur.
- Menü ancak üç koşul birlikte sağlanırsa görünür: slug atanmış ve açık, menü yayınlanmış, işletmenin etkin hakkında `feat_qr_menu` var. Biri eksikse public uç `404` verir (fail-closed). Hak doğrulanamıyorsa da `404`.
- Tutarlar tamsayı kuruştur (`priceCents`); float yoktur.

Kimlik kuralları: JSON alanları camelCase. Tüm Mongo kayıtları `tenant_id` taşır ve her sorgu `tenant_id` ile süzülür (business kümesi; koleksiyonlar `qr_menu_slug`, `qr_menu_publication`, `qr_menu_image`).

## Uçlar

| Uç | Kimlik | Amaç |
|---|---|---|
| `PUT /api/desktop/tenants/{tenantId}/menu` | Masaüstü | Menü anlık görüntüsünü yayınla (idempotent) |
| `GET /api/desktop/tenants/{tenantId}/menu/status` | Masaüstü | Adres, hak ve yayın sürümü |
| `PUT /api/desktop/tenants/{tenantId}/menu/images` | Masaüstü | Görsel yükle (içerik-adresli) |
| `GET /public/menu/{slug}` | Yok | Yayınlanmış menü |
| `GET /public/menu/{slug}/images/{sha256}.webp` | Yok | Yayınlanmış menünün görseli |
| `PUT /internal/labs/qr-menu/{tenantId}/slug` | Labs | Slug ata / değiştir / kapat |

### Masaüstü kimliği

Mevcut tenant sync / cihaz lisansı mekanizması aynen kullanılır, atlama yoktur:

- `Authorization: Bearer lk_…` (lisans anahtarı) ve `x-device-id`.
- Anahtar sahibi e-postası doğrulanmış olmalı; geçersiz anahtar `401 INVALID_KEY`, doğrulanmamış e-posta `403 EMAIL_NOT_VERIFIED`, geçersiz cihaz kimliği `400 INVALID_DEVICE`.
- Cihaz bu `tenantId` için lisanslanmış ve `active` olmalı (`assessForTenant`): `DEVICE_REVOKED`, `DEVICE_NOT_LICENSED`, `LICENSE_BLOCKED`, süresi dolmuşsa `LICENSE_INACTIVE` (hepsi `403`). Cihaz başka işletmeye bağlıysa o işletmeye yazamaz; bu yüzden başka tenant'a yazma `403 DEVICE_NOT_LICENSED` ile reddedilir.
- `feat_qr_menu` yayınlama ve görsel yükleme için de gerekir: yoksa `403 FEATURE_NOT_ENTITLED`; Labs hak okuması başarısızsa `503 UPSTREAM_UNAVAILABLE`.
- Tüm yanıtlar `Cache-Control: no-store`. Hata gövdesi `{code,message}`.

### Menü yayınlama — `PUT /api/desktop/tenants/{tenantId}/menu`

İstek (`Content-Type: application/json`, en çok 1 MiB):

```json
{
  "schema": "kasam360.qrmenu.v1",
  "businessName": "Kafe Güzel",
  "categories": [ { "id": "cat_…", "name": "İçecekler", "sortOrder": 10 } ],
  "products": [
    {
      "id": "prd_…", "name": "Türk Kahvesi", "description": "Orta şekerli, lokumla." ,
      "priceCents": 12500, "categoryId": "cat_…", "sortOrder": 10,
      "imageKey": "<64 hane küçük hex sha256>" ,
      "active": true, "inStock": true
    }
  ]
}
```

Kurallar (ihlal `422 INVALID_MENU`, ayrıntı `{field}`):

- `businessName` isteğe bağlı: yok/`null` veya 1-120 karakter (kırpılmış). Menünün içeriğine dahildir (değişirse sürüm artar). Tam anlık görüntüdür; kısmi güncelleme yoktur. Önceki yayının yerini alır. En çok 100 kategori, 2.000 ürün.
- `id`: `^[A-Za-z0-9_-]{1,64}$`, kendi listesinde tekil. `name` 1-120, kategori adı 1-80 karakter (kırpılmış). `description` yok/`null` veya en çok 1.000 karakter. `sortOrder` 0..1.000.000 tamsayı.
- `priceCents` negatif olmayan güvenli tamsayı, en çok 10.000.000 (100.000,00); float reddedilir.
- `categoryId` listedeki bir kategoriye işaret etmelidir. `imageKey` yok/`null` veya bu işletmeye daha önce yüklenmiş bir görselin sha256'sı; yoksa `422 UNKNOWN_IMAGE`.
- `active:false` ürün public menüde hiç görünmez. `inStock:false` ürün görünür, `inStock:false` ile işaretlenir. Ürünü olmayan kategori public menüde çıkmaz.
- Bilinmeyen alan reddedilir.

Yanıt `200` (değişsin ya da değişmesin):

```json
{ "tenantId": "tnt_…", "version": 7, "etag": "\"sha256-…\"", "changed": true, "slug": "kafe-x", "publicPath": "/kafe-x" }
```

Idempotency: sunucu görselleri dışındaki içeriği kanonik JSON'a (kategori ve ürünler `sortOrder` sonra `id` ile sıralı, anahtar sırası sabit) çevirip sha256 alır; `etag` budur. Aynı içerik tekrar yayınlanırsa `changed:false` döner, `version` ve yayın zamanı değişmez. Farklıysa `version` +1 olur. Sürüm artışı Mongo transaction'ında tek `qr_menu_publication` belgesinin (`tenant_id` tekil) güncellenmesidir; iki cihaz yarışırsa son transaction kazanır ve sürümler tekil artar. `slug` henüz atanmamışsa `null`; menü saklanır, public yok.

### Durum — `GET /api/desktop/tenants/{tenantId}/menu/status`

`200 { "tenantId", "slug": string|null, "enabled": boolean, "entitled": boolean, "version": number|null, "etag": string|null, "publishedAt": ISO|null }`. Masaüstü adresi ve yayın durumunu buradan gösterir; slug'ı değiştiremez.

### Görsel yükleme — `PUT /api/desktop/tenants/{tenantId}/menu/images`

- Gövde ham görsel baytlarıdır, `Content-Type: image/webp`. Masaüstü görseli önce WebP'ye çevirir ve en uzun kenarı 1.600 px'e küçültür; sunucu yeniden kodlamaz.
- En çok 1.572.864 bayt (1,5 MiB); aşarsa `413 PAYLOAD_TOO_LARGE`. Boş gövde `422`.
- Sunucu içerik türü başlığına güvenmez: RIFF/WEBP sihirli baytlarını, RIFF boyut alanını ve VP8/VP8L/VP8X başlığındaki boyutu okur. WebP değilse `415 UNSUPPORTED_IMAGE`; herhangi bir kenar 1.600 px'i aşarsa veya boyut okunamazsa `422 INVALID_IMAGE`. Başlık `image/webp` değilse `415`.
- Anahtar `sha256` (küçük hex) içerik-adreslidir ve işletmeye bağlıdır: `(tenant_id, sha256)` tekildir. Aynı bayt aynı işletmeye yeniden yüklenirse `200` (idempotent), yeni ise `201`. İşletme başına en çok 500 görsel (`422 IMAGE_QUOTA`).
- Yanıt: `{ "key": "<sha256>", "size": number, "width": number, "height": number }`. Kullanılmayan görseller silinmez (ilk sürüm).
- Depolama arkasında soyut arayüz vardır; ilk gerçekleme sunucu diskidir: `MENU_MEDIA_DIR` (tanımsızsa görsel yükleme `503 MEDIA_UNAVAILABLE`), dosya `{MENU_MEDIA_DIR}/{tenantId}/{sha[0..2]}/{sha}.webp`, geçici dosyaya yazıp atomik yeniden adlandırma.

### Public okuma — `GET /public/menu/{slug}`

Kimlik yoktur. `404` (gövde `{code:'NOT_FOUND'}`, `Cache-Control: public, max-age=15`) şu durumların hepsinde aynıdır: slug biçimsiz/atanmamış, slug kapalı, menü hiç yayınlanmamış, işletmenin etkin hakkında `feat_qr_menu` yok, hak doğrulanamıyor (Labs ulaşılamaz ve son doğrulanmış olumlu sonuç 10 dakikadan eski). Neden ayırt edilmez.

`200`:

```json
{
  "schema": "kasam360.qrmenu.v1", "slug": "kafe-x", "name": "Kafe Güzel", "version": 7, "publishedAt": "2026-11-10T09:00:00.000Z",
  "currency": "TRY",
  "categories": [ { "id": "cat_…", "name": "İçecekler", "sortOrder": 10, "products": [
    { "id": "prd_…", "name": "Türk Kahvesi", "description": "…"|null, "priceCents": 12500, "sortOrder": 10, "inStock": true, "image": "/public/menu/kafe-x/images/<sha256>.webp"|null }
  ] } ]
}
```

- `name`: yayındaki `businessName`, yoksa işletmenin kayıtlı adı (tenant adı).
- Gizli alan yoktur: `tenantId`, cihaz, yayıncı, `active`, etkin hak bilgisi dönmez. Yalnız `active:true` ürünler, kategori ve ürünler `sortOrder` sonra `id` sıralıdır. `currency` işletme kaydındandır.
- Başlıklar: `ETag` (yayın etag'i), `Cache-Control: public, max-age=30, stale-while-revalidate=60`, `Access-Control-Allow-Origin: *`, `X-Content-Type-Options: nosniff`. `If-None-Match` eşleşirse `304`.
- Görsel: `GET /public/menu/{slug}/images/{sha256}.webp` aynı üç koşulu denetler ve yalnız **yayınlanmış menüde kullanılan** görseli verir (yüklenip yayına girmemiş görsel `404`). `Content-Type: image/webp`, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`. İçerik-adresli olduğu için immutable güvenlidir; hak sonradan kapanırsa önbelleğe girmiş kopyalar süresi dolana kadar görünebilir (bilinen sınır).

### Slug ataması — `PUT /internal/labs/qr-menu/{tenantId}/slug`

Labs ↔ API kanalı: mevcut `/internal/labs/customers` ile aynı sır (`LABS_CUSTOMER_SECRET`, `Authorization: Bearer`), sabit zamanlı karşılaştırma; sır yoksa/32 karakterden kısaysa uç hiç bağlanmaz. Gövde en çok 1 KiB.

İstek: `{ "slug": "kafe-x", "enabled": true }`.

- Slug kuralı: `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$` yani 3-40 karakter, yalnız `a-z 0-9 -`, baş/son tire yok, `--` yok. Rezerve adlar reddedilir: `www api admin menu labs app mail smtp imap ftp web panel portal desk kasam kasam360 360labs support destek login giris kayit static assets cdn status health public internal test dev staging demo` ve `xn-` ile başlayanlar. Aynı liste Labs'ta da uygulanır (iki yerde savunma).
- Tenant API'de aktif olmalı (`tenant` kaydı), yoksa `404 TENANT_NOT_FOUND`.
- Tek işletme tek slug: yeni slug eskisini serbest bırakır (basılı QR'lar eski adreste `404` verir; Labs bunu uyarır). `enabled:false` slug'ı işletmede tutar ama public'i kapatır. Aynı slug başka işletmedeyse `409 SLUG_TAKEN` (tekil dizin son otoritedir). Aynı istek tekrarı idempotenttir.
- `200 { "tenantId", "slug", "enabled" }`. Geçersiz gövde/slug `422 INVALID_SLUG`, rezerve `422 SLUG_RESERVED`.

### Labs

Yönetici panelinde `İşletme Hakları` sayfasındaki işletme kartında "QR menü adresi" bölümü: ata/değiştir (`POST /urunler/{id}/kiracilar/{tenant}/qr-menu`, alanlar `slug`, `enabled` = `on`/`off`). Labs önce API'ye iletir (benzersizlik otoritesi API'dir); başarı olursa kendi kaydını (`qr_menu_addresses`, ürün+işletme tekil, ürün+slug tekil) ve denetim kaydını (`audit_events`, eylem `qr_menu.slug_set`) tek işlemde yazar. API ulaşılamıyor/reddediyorsa Labs kaydı değişmez ve hata sayfada gösterilir. Çakışma, rezerve ad ve biçim hataları kullanıcıya ayrı ayrı bildirilir. Labs, API adresini `KASAM_CUSTOMER_ORIGIN` ve `KASAM_CUSTOMER_SECRET` ile bulur.

## Sınırlar ve bilinen eksikler

- Yalnız gösterim: sipariş, sepet, ödeme, garson çağırma yok.
- Public sayfa (Next.js) ve masaüstü yayınlama düğmesi/görsel küçültme bu sözleşmeyle yazılacaktır; bu belge onları uygulanmış göstermez.
- Kullanılmayan görseller ve silinen işletmenin görsel dosyaları diskten temizlenmez (ilk sürüm); yayın belgeleri hesap silinince `removeUserData` ile düşer.
- Önbellek: hak sonucu API belleğinde 60 sn tutulur; çok süreçli kurulumda her süreç ayrı okur.
