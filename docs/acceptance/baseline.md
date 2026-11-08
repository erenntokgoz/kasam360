# Q01 Başlangıç ve test ortamı kaydı

Tarih: 6 Kasım 2026 (Europe/Istanbul). Bu kayıt Q01 başlangıç durumunu gösterir; temiz HEAD'in veya yayımlanmış ürünün doğrulaması değildir. Testler mevcut kullanıcı çalışma ağacında çalıştırılmıştır.

## Depo ve kullanıcı değişiklikleri

| Depo | Dal / HEAD | Başlangıç durumu |
|---|---|---|
| `kasam360` | `develop`, `56c8224ac93b1f2420369a5b8cf74b9e768976cb`, origin'den 38 commit önde | Kirli; çok sayıda izlenen ve yeni dosya. Tam başlangıç listesi [working-tree-kasam360.txt](working-tree-kasam360.txt) içinde. |
| `360labs` | `develop`, `b3d33c57305f5fe2002844b33c8e8203946e9db8`, origin'den 7 commit önde | Temiz. Tam başlangıç kaydı [working-tree-360labs.txt](working-tree-360labs.txt) içinde. Depoda `AGENTS.md` yok. |

Hiçbir dosya resetlenmedi, stash edilmedi veya topluca silinmedi. Q01 kapsamında değiştirilen tek izlenen dosya yok; Q01 kayıtları yeni dokümanlardır. Her iki dal da ürün değişikliği içermeden mevcut kullanıcı durumunda bırakılmıştır.

## Servis, build ve veri şeması

- Kontrol sırasında KASAM360/API, Labs, Vite/Next geliştirme sunucusu, MongoDB ve Tauri uygulamasına ait süreç ya da `3000`, `3001`, `3600`, `4173`, `5173`, `8787`, `27017` portlarında dinleyici bulunmadı. Görülen Node süreçleri Codex/MCP araçlarıydı; ürün servisi sayılmadı.
- 360 Labs kaynak HEAD'inden `cargo build` başarılı oldu. Oluşan yerel debug ikilisi `labs360 v0.1.0`, SHA-256 `3D9AF0A68AD9333FD6CFE38ADFB9D7B26C5F8C27742270036A6519B6CE35FE6F`; derleme zamanı 2026-11-06 13:02:31. Bu ikili çalıştırılmadı ve dağıtılmadı.
- Desktop `npm run build` başarılı; Vite 6.4.4 üretim bundle'ı oluştu. JS build etiketi `index-DZjPWEby.js`; 654.76 kB chunk için mevcut boyut uyarısı var.
- Web `npm run build` başarılı; Next.js 16.4.3 build ID `5AzUN4E68aHCNcdhMKTSa`. Build `.env.local` dosyasının varlığını bildirdi; değerler okunmadı veya kayda alınmadı.
- API için yayımlanmış derleme çıktısı yok; paket `0.1.0`, çalışma biçimi `tsx`, `npm run typecheck` başarılı.
- Rust çekirdek paketi `kasam360-core v0.2.0`. Migration kaynağında ana sürüm 18 kayıtlı. Çalışan KASAM360 DB'si yoktu; gerçek yerel DB şeması bu nedenle doğrulanmadı.
- Labs `data/360labs.sqlite` dosyası var. Salt-okunur SQLite metadata sorgusunda `PRAGMA user_version=0`, başarılı SQLx migration sürümü `18` bulundu; kaynakta migration dosyaları `0021`'e kadar. Bu dosya test DB'si değildir ve kullanılmadı. Kaynak uygulama açılışta migration çalıştırır; dosya üzerinde uygulama başlatılmadı.
- API gerçek `.env` dosyası var; Labs `.env` dosyası var. Değerleri/secret'ları açılmadı. API `.env.example` yalnız değişken adları için incelendi. Bunlar sandbox onayı veya sandbox kimlik bilgisi kanıtı değildir.
- Çalışan build'ler arasında ortak, sürümlenmiş API/IPC kontrat revision'ı veya test ekranı `buildId`'si yok. Bu uyum Q01'de doğrulanamadı; C01/C02'nin donduracağı kontrat revision'ı ve sürüm etiketi bu açığı kapatmalıdır.

## Başlangıç testleri

Komutlar 6 Kasım 2026'da birer kez, mevcut kirli `kasam360` çalışma ağacında çalıştırıldı. Bu sonuçlar clean HEAD'e atfedilmez. Hiçbir test DB'si Labs'in kalıcı `data/360labs.sqlite` dosyasına bağlanmadı.

| Klasör | Komut | Gerçek sonuç |
|---|---|---|
| `backend` | `cargo test --lib` | Başarısız: 1.205 test, 1.204 geçti, 1 kaldı. `services::lan_sync::network_tests::iki_kurulum_eslesir_para_cogunlukla_yazilir_cihaz_kaybinda_durur` beklenen son işlem yerine `Pending` (`op_lost`) döndürdü; `src/services/lan_sync/network_tests.rs:206`. Bu test Q01 öncesi mevcut kodda ilk çalıştırmada başarısız gözlendi; kullanıcı değişikliklerinin hangisinin sebep olduğu kanıtlanmadı. |
| `backend/api` | `npm run test` | Başarılı: 4 dosya, 41 test. Testler `MongoMemoryReplSet` ile geçici replica set kullanıyor; uygulama `.env`'ine bağlanmıyor. |
| `backend/api` | `npm run typecheck` | Başarılı: `tsc --noEmit`. |
| `desktop` | `npm run test` | Başarılı: 43 dosya, 187 test. İki testte SSR `useLayoutEffect` uyarısı çıktı; testler geçti. |
| `desktop` | `npm run build` | Başarılı; Vite büyük chunk uyarısı (654.76 kB). |
| `web` | `npm run test` | Başarılı: 1 dosya, 1 test. |
| `web` | `npm run build` | Başarılı; 22 statik sayfa üretildi. |
| `360labs` | `cargo test` | Başarılı: 25 test. Testler geçti; canlı servis başlatılmadı. |
| `360labs` | `cargo build` | Başarılı; yukarıdaki yerel debug build'i üretildi. |

Backend LAN testlerindeki yeşil sonuçlar gerçek ağ bölünmesi/iki cihaz kabulü değildir. Adadaki kayıt yaklaşımının çift tahsilatı önlediği sonucu çıkarılamaz. Backend tek başarısız testi ve Labs DB migration farkı yeni bulgu olarak açık kalır; bu Q01 kaydı bunları düzeltmez.

## Güvenli test ortamı durumu

- API birim testleri her çalışma için geçici Mongo replica set açıp kapatıyor; auth testlerinde mail gönderimi enjekte edilen bellek içi fonksiyondur. Harici SMTP çağrısı yapılmadı.
- Desktop/web testleri yerel Vitest'tir; sandbox ödeme sağlayıcısı veya SMTP sunucusuna bağlanan kabul testi çalıştırılmadı.
- Ortak `TEST_A`/`TEST_B` kayıtları ve tenant allowlist'li fixture geri yükleme aracı mevcut değil. [Fixture kaydı](fixtures.md) test veri sözleşmesini belirler; tenant'lar halen veritabanlarında provision edilmedi.
- API/Labs için teyit edilmiş e-posta sandbox'ı ve ödeme sandbox'ı yapılandırması yok. KASAM360 API'de ödeme sağlayıcı entegrasyonu/ödeme sandbox'ı doğrulanmadı. Labs `.env` ve mevcut SQLite kullanıcı ortamına ait olabilir; ikisi de açılmadı/değiştirilmedi. Gerçek e-posta, ödeme, iade, DB reseti, production dağıtımı yapılmadı.
- Labs DB migration 18'de; güncel kaynakta 21 migration dosyası bulunuyor. Güvenli test için ayrı `DATA_DIR` ve izole sandbox env gerekir. Default `data/` ile Labs çalıştırılmamalı.

## Claude için başlangıç

1. Başlangıç referansı bu belge ve [fixture kaydı](fixtures.md); `kasam360` kullanıcı çalışma ağacı kirli ve korunmalıdır.
2. Claude `desktop/src/` ve `web/src/` dışındaki backend/Labs dosyalarına, ayrıca bu deponun ortak kontrat/kabul belgelerine yazmamalıdır. Kullanıcı arayüzü API/IPC alanlarına dair ihtiyaçlarını kontrat sahibi Codex'e iletmelidir.
3. API/IPC/veri sahipliği sözleşmeleri henüz dondurulmadı; C01/C02 tamamlanmadan UI tarafında endpoint, DTO veya IPC adı varsayılmamalıdır. Bu nedenle Claude'a şu an uygulanabilir frontend endpoint işi verilmemiştir.
4. Güvenli fixture verisi yalnız `.invalid` test kimlikleri ve izole test DB'siyle kullanılmalıdır. Mail/ödeme gerçek işlemi yoktur; `test_mode` olayı canlı hak üretemez.

## Q01 çıkışı

Baseline kanıtı ve fixture tanımı hazırlandı, başlangıç testleri kaydedildi ve yerel Labs build'i kaynak HEAD'inden alındı. API için geçici Mongo kabul fixture seed/reset aracı eklendi. Q01 **tamamlandı** sayılmıyor: SQLite POS işletme/rol fixture'ı ile Labs platform rol fixture'ı provision edilmedi; ikinci geliştirici için ortak/persistent kabul DB'si yok; SMTP ve ödeme provider sandbox'ları doğrulanmadı; frontend/backend aynı kontrat revision'ına bağlı değil. Bu kanıtla mevcut Labs DB'yi migrate etmek güvenli olmadığı için yapılmadı.

## Q01 takip kanıtı — 6 Kasım 2026

- `backend/api/src/acceptanceFixtures.ts` TEST_A/B için sabit ULID kullanıcı ve eşitleme tenant kayıtlarını geçici replica set'te tekrar üretir. `resetAcceptanceTenant()` yalnız allowlist anahtarlarını kabul eder; seçilen tenant'ın sync satırları, işlem/cursor kayıtları ve ona ait test hesabını tek replica-set transaction'ında temizler. Yalnız `startTestDatabases()` tarafından açılan DB nesnesinde çalışır.
- `backend/api/src/acceptanceFixtures.test.ts` seed idempotency, TEST_A temizliğinde TEST_B'nin tenant/satır/işlem/cursor verisinin korunması, prototype ve bilinmeyen allowlist anahtarlarının reddi, geçici olmayan DB nesnesinin reddini doğrular.
- Tekrar: `cd backend/api; npm run test -- src/acceptanceFixtures.test.ts` → 1 dosya, 3 test geçti. Tam suite `npm run test` → 5 dosya, 44 test geçti. `npm run typecheck` geçti.
- 360 Labs geçici SQLite testi eşleşen sentetik müşteri, paket ve varyant varken `test_mode=true` webhook'unun abonelik, lisans ve paket yazmadığını doğrular. `cargo test` 25/25, `cargo clippy --all-targets -- -D warnings` ve `cargo fmt --check` geçti. Lemon Squeezy sandbox hesabı/ağı kullanılmadı.
- API fixture yalnız hesap/sync Mongo modelini kapsar; yerel POS kullanıcı/rol/stok/ödeme verisi veya Labs platform rolleri değildir. Test replica set kapanınca kayıtlar silinir. Test mail sink'i bellek içindedir; gerçek SMTP sandbox'ı doğrulanmış değildir. Gerçek ödeme sağlayıcı sandbox'ı da bu turda doğrulanmamıştır.

## Q01 takip kanıtı — POS fixture doğrulaması — 6 Kasım 2026

- `backend/src/db/acceptance_fixtures.rs` yalnız `#[cfg(test)]` altında derlenen POS kabul fixture'ı ekler. TEST_A ve TEST_B ayrı SQLite `:memory:` havuzlarında provision edilir; her birinde OWNER/MANAGER/CASHIER/WAITER/KITCHEN aktif personeli, pasif WAITER, Argon2id PHC PIN özeti, cihaz, 12500 cents ürün ve iki gerçek FIFO lotu bulunur.
- `reset_tenant()` yalnız TEST_A/TEST_B anahtarlarını kabul eder ve seçilen fixture havuzunu kapatıp yeniden kurar; dosya yolu almaz, disk DB'sine bağlanmaz ve audit satırlarını silmez. Test, A'yı yenilerken B'deki değişikliğin kaldığını ve üretim anahtarının reddini doğrular.
- `cargo test test_tenant_fixturelari_rolleri_fifo_partilerini_ve_secilen_resetini_korur` → 1 geçti.
- Tam tekrar `cargo test --lib` → 1206 geçti, 0 kaldı (83.30 sn). İlk baseline çalıştırmasındaki LAN testi bu çalıştırmada geçti. Önceki başarısızlık tarihsel başlangıç kanıtı olarak yukarıda korunuyor; kök neden veya kalıcı düzeltme sonucu çıkarılmadı.
- `cargo clippy --lib --tests -- -D warnings` geçti; `cargo fmt --check` geçti.
- Bu fixture henüz satış, vergi/KDV, parçalı tahsilat veya vardiya finans kayıtları seed etmez. C01 kararları olmadan finans beklenenleri varsayılmadı. Ayrıca bu DB'ler test sürecinin belleğinde geçicidir; ortak/kalıcı kabul DB'si değildir.
- `../360labs/src/tests.rs` içindeki `data_dir_ayri_test_koklerini_izole_edebilir` iki ayrı TEST_A/TEST_B veri kökünün farklı DB dosyalarına çözüldüğünü ve marker verilerinin birbirinden ayrı kaldığını doğrular. Test yalnız kendi ULID isimli temp kökünü siler; mevcut Labs `data/` konumuna dokunmaz. `cargo test` → 26/26, `cargo fmt --check` ve `cargo clippy --all-targets -- -D warnings` geçti.
- Bu Labs testi `main` sürecini başlatmaz ve gerçek SQLite migration/HTTP akışını doğrulamaz; yalnız `DATA_DIR` kök izolasyonunu kanıtlar. Tam süreç kabul testi ayrıca gerekir.

## Q01 kalan kabul kapıları

- Q01 kabul ölçütleri `docs/kabul-ve-is-devri.md` güncellemesiyle yeniden eşleştirildi. Ortak revision C01 çıktısıdır; yeni Labs rolleri C11/L08'e, gerçek ödeme sandbox'ı C04/Q02'ye, SMTP teslim doğrulaması L07/R03'e, Labs süreç/migration/HTTP kabulü L01/L10 ve migration güvenliği C12'ye, paylaşılan staging R03'e taşındı. Bunlar Q01 blokajı değildir.
- Q01 kapsamında geçici TEST_A/TEST_B fixture'ları API replica set ve POS SQLite `:memory:` ortamlarında doğrulandı; POS fixture reset ve tenant ayrımı test edildi. Labs'te mevcut yetki modelini inceledik, yeni rol varsayılmadı. Dış mail/ödeme/müşteri DB işlemi yapılmadı.
- Q01 için mevcut servis/build/şema kaydı, başlangıç testleri ve önceki hata kaydı yukarıda mevcut. Servisler çalışmıyordu; kaynak-build eşleşmesi canlı servis üstünde doğrulanmış değildir. Labs DATA_DIR unit testi ayrı kökleri doğrular, process/migration/HTTP kabulü olarak sunulmaz.

Q01'in güncel ölçütlerine göre başlangıç ve güvenli yerel fixture kanıtları kayıtlıdır. **Q01 tamamlandı; C01'e geçiş serbesttir.** Bu, aşağıdaki entegrasyon/staging kabul işlerinin tamamlandığı anlamına gelmez. Gerçek mail, ödeme, müşteri DB reseti veya production işlemi yapılmadı.
