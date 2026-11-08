# Q01 Ortak fixture kaydı

Durum: fixture tanımları sabit. API testleri TEST_A/B hesap ve sync tenant kayıtlarını geçici Mongo replica set'te provision edip seçileni allowlist ile temizleyebilir; POS test harness'i de iki ayrı SQLite `:memory:` havuzunda yerel fixture verisini kurup seçileni yeniden yaratabilir. Her iki test süreci kapanınca veriler kaybolur. Kalıcı/paylaşılan kabul DB'sine veya Labs DB'sine yüklenmiş değildir. Bu dosya canlı tenant, hesap veya lisans oluşturmaz.

## Kiracılar ve aktörler

| Fixture etiketi | Tenant kimliği | OWNER hesabı | Cihaz |
|---|---|---|---|
| `TEST_A` | Ayrı, `tnt_` ön ekli ULID; seed sırasında fixture anahtarından deterministik atanır | `owner.a@kasam360.invalid` | `dev_a_01` |
| `TEST_B` | TEST_A'dan farklı `tnt_` ön ekli ULID | `owner.b@kasam360.invalid` | `dev_b_01` |

API geçici fixture'ındaki sabit kullanıcı/tenant ULID'leri `backend/api/src/acceptanceFixtures.ts` içinde tutulur. API fixture'ı yalnız hesap ve sync tenant kayıtlarını açar. POS fixture'ı `backend/src/db/acceptance_fixtures.rs` içinde TEST_A/B için yukarıdaki altı POS personeli, ayrı cihaz, ürün ve FIFO lotlarını seed eder. PIN yalnız Argon2id PHC özetine çevrilir. Tekrar komutları: `cd backend/api; npm run test -- src/acceptanceFixtures.test.ts` ve `cd backend; cargo test test_tenant_fixturelari_rolleri_fifo_partilerini_ve_secilen_resetini_korur`.

Fixture anahtarları ve `.invalid` e-posta alanı test içindir. Gerçek e-posta adresi, PIN, parola, Argon2 PHC değeri, lisans imza anahtarı veya ödeme belirteci fixture dosyasına yazılmaz. Seed kodu test parolası/PIN'i yalnız test ortamında üretip Argon2id PHC olarak saklamalıdır. TEST_A ve TEST_B arasında kullanıcı, cihaz, paket hakkı, sync snapshot veya veri satırı paylaşılmaz.

Her tenant'a yerel POS rolleri `OWNER`, `MANAGER`, `CASHIER`, `WAITER`, `KITCHEN` için birer aktif test personeli açılır. Ayrıca bir `WAITER` pasif personel kaydı bulunur; pasif kişinin kimliği/PIN'i rezerve kalır ve giriş reddedilir. `MASTER` platform kimliği POS personeli değildir ve POS komutlarına girememelidir. Fixture personelleri yerel işletme hesabıdır; web OWNER hesabıyla aynı kayıt değildir.

Labs uygulaması şu an dört ayrı platform rolü sunmaz. Gerçek modelde ilk admins kullanıcısı sahip hesabıdır; ek kullanıcılar `team_members` tablosunda etkin/kapalı tutulur, `team_support` ile ürün bazında destek erişimi alır. `PLATFORM_ADMIN`, `BILLING_OPERATOR`, `SUPPORT_AGENT`, `READ_ONLY_AUDITOR` adları gelecekteki kabul matrisini tarif eder; provision edilmiş veya mevcut modelde test edilebilir roller değildir. Yeni rol/yetki modeli ürün kapsamı ve migration kararı gerektirir; Q01 fixture'ı bunu taklit etmemelidir.

## Ticari ve POS verisi

Bu değerler yalnız test varsayılanıdır; canlı fiyat veya vergi kararı değildir.

| Varlık | Sabit değer / beklenen |
|---|---|
| Paket v1 | `Test Paket`, yayınlanmış v1, TRY, aylık `100000` cents, cihaz limiti 2 |
| Paket v2 | `120000` cents, cihaz limiti 1; v1 abonesi otomatik fiyat değiştirmez; downgrade cihaz fazlası çözülmeden tamamlanmaz |
| Feature set | `feat_kds`, `feat_table_order`, `feat_recipe_bom`, `feat_ledger_cari` açık; kalan feature'lar kapalı. Her feature için ayrıca açık/kapalı test durumu gerekir. |
| Ürün | Birim satış fiyatı `12500` cents; miktar 4; toplam `50000` cents. KDV oranı/yuvarlaması C01'de sabitlenmeden finans beklenenleri tamamlanmış sayılmaz. |
| FIFO lotları | A: 2 adet × 200 cents; B: 3 adet × 500 cents. 4 adet satış maliyeti `1400` cents; B'de 1 adet kalır. |
| Parçalı tahsilat | `20000` nakit + `30000` kart = `50000`; kalan 0. Aynı idempotency anahtarı retry'da aynı sonucu verir. |
| İade | Ayrı senaryoda 1 adet `12500` cents; net tahsilat `37500`. Stok iade politikası ayrıca açıkça beklenir. |
| Vardiya | Açılış nakit `10000`; satış nakit +`20000`; gider -`3000`; beklenen nakit `27000`; kart `30000`. |
| Saat | Sabit UTC saat; raporlama `Europe/Istanbul`; gece yarısı, dönem sınırı ve geri alınmış saat senaryoları. |

## Harici bağımlılık sınırı

- Test mail çıkışı yalnız bellek içi sink/capture olmalı. SMTP sandbox host/hesabı ayrıca onaylanıp doğrulanmadı; bu yüzden SMTP üzerinden hiçbir fixture çalıştırılmaz.
- Test ödeme sağlayıcısı yalnız sahte test adaptörü/provider sandbox'ı olmalı. Her olay `environment=test` ve `test_mode=true` taşır; canlı entitlement, cihaz hakkı veya yayın aboneliği oluşturması reddedilir. Gerçek sağlayıcı sandbox'ı şu an doğrulanmadı.
- Webhook fixture'ları imza, replay, duplicate, eski olay ve geç teslimi kapsar; test başarı URL'si tek başına entitlement vermez.
- API test-only `resetAcceptanceTenant()` yordamı yalnız `TEST_A`/`TEST_B` allowlist anahtarını ve `startTestDatabases()` tarafından açılmış geçici Mongo nesnesini kabul eder; sahiplik eşleşmezse fail-closed durur. POS `reset_tenant()` yalnız `TEST_A`/`TEST_B` anahtarını kabul eder ve ilgili in-memory havuzu yeniden yaratır; dosya yolu almaz. Kalıcı DB, SQL veya Labs `DATA_DIR` hedeflenemez. Genel `deleteMany({})`, SQL `DELETE` veya varsayılan `DATA_DIR` reset hedefi kabul edilmez.
- Genel API test helper'ı `TestDatabases.reset()` yalnız geçici suite DB'sini temizler; tenant-scoped kabul reseti değildir. Kabul fixture'ı kendi allowlist yordamını kullanır. Hiçbiri paylaşılan/persistent DB'ye verilmemelidir.

## İlk kabul tekrarları

1. API testinde TEST_A/B geçici Mongo DB'de provision edilir; bu kalıcı veya yerel POS tenant provision kanıtı değildir.
2. POS harness testi TEST_A/B için altı rol (bir pasif WAITER dahil), ayrı cihaz, ürün ve FIFO lotlarını doğrular. Sipariş/vergi/tahsilat fixture'ı C01 finans kuralları sabitlendikten sonra eklenmelidir.
3. TEST_A yetkisiyle TEST_B kayıtlarını listele/detayla/değiştir/export/sync etmeyi dene; tüm girişimler backend'de reddedilmeli ve TEST_B verisi değişmemelidir.
4. API auth testi mail sink'i bellek içi capture kullanır ve dış SMTP'ye çıkmaz. Labs geçici SQLite testi `test_mode` olayının canlı abonelik/lisans/paket yazmadığını kanıtlar; gerçek provider sandbox'ı ayrıca doğrulanmalıdır.
5. API ve POS reset testleri yalnız TEST_A kapsamını sıfırlayıp TEST_B verisini korur. Kalıcı/yerel DB ve Labs DB'nin byte-for-byte korunması ayrı kabul testi gerektirir; fixture araçları o DB'lere hiç bağlanmaz.
6. Labs `data_dir_ayri_test_koklerini_izole_edebilir` testi iki geçici tenant kökünü ayırır; gerçek uygulama açılış/migration/health kabulü henüz yoktur. Labs mevcut rol modeli nedeniyle destek dışı ticari/denetçi rolleriyle yetki testi çalıştıramaz.

POS fixture sipariş, vergi/KDV, parçalı tahsilat, iade veya vardiya bakiyesi seed etmez; finans beklenenleri C01 kurallarından sonra sabitlenmelidir. Labs platform rol kimlikleri yalnız kapsam tanımıdır, provision edilmiş değildir.
