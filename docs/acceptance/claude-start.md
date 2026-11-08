# Frontend entegrasyon notu

Q01 başlangıç kanıtı: [baseline](baseline.md). Ortak sentetik veri tanımı: [fixtures](fixtures.md).

## Şimdiki durum

- `kasam360` dalı `develop`, HEAD `56c8224ac93b1f2420369a5b8cf74b9e768976cb`; çalışma ağacında kullanıcıya ait kapsamlı değişiklikler var. Bu dosyalar değiştirilmemeli veya reset/stash edilmemelidir.
- `360labs` dalı `develop`, HEAD `b3d33c57305f5fe2002844b33c8e8203946e9db8`; başlangıçta temizdi.
- Baseline test sonuçları ve tek backend testi hatası `baseline.md` içinde kaydedildi.
- API TEST_A/B hesabı ve sync tenant fixture'ı yalnız geçici Mongo replica set'te kurulabilir; tekrar komutu ve kapsamı `fixtures.md` içindedir. Bu, yerel POS fixture'ı veya Labs rol fixture'ı değildir.
- POS TEST_A/B fixture'ı yalnız Rust testlerinde ayrı SQLite in-memory havuzlarında kurulur; rol/Argon2id özeti/cihaz/ürün/FIFO verisi içerir. Tekrar komutu ve reset sınırı `fixtures.md` içindedir; sipariş/finans verisi C01 kuralları gelmeden seed edilmez.
- Labs için geçici DATA_DIR klasör izolasyon testi var (`cd ../360labs; cargo test data_dir_ayri_test_koklerini_izole_edebilir`); uygulama süreci veya DB migration kabulü değildir. Labs'te ayrı billing/auditor platform rolleri mevcut olmadığından bu yetkiler UI'da varsayılmamalıdır.
- Labs, API, desktop, web için ortak, sürümlenmiş API/IPC kontrat revision'ı henüz yok.

## Güncel çalışma biçimi — 7 Kasım 2026

Kullanıcı Claude’u sınırlı kalan haftalık kotasıyla yeniden dahil etti. Bu teslimde Claude yalnız herkese açık web sayfaları, ortak görsel kabuk ve SEO/erişilebilirlik düzeltmelerini yürütür; yeni tema başlatmaz. Codex cihaz aktivasyonu, V2 lisans ve tenant kapsamlı sync akışını backend/API, Labs ve desktop üzerinde tamamlar; bu teslim sırasında web dosyalarını değiştirmez. Claude hesap/auth/destek iş mantığına, backend/API, Labs, desktop, bağımlılık ve kilit dosyalarına dokunmaz. Ortak CSS değişikliklerinde hesap/auth/destek ekranlarının görsel kontrolü yapılır. Mevcut değişiklikler korunur. İlerleme tablosunun tek yazarı Codex; Claude teslim kanıtını kullanıcıya sunar. İki teslim sonrası ortak kabul yapılmadan bütünleşik tamamlanma iddiasında bulunulmaz.

Mevcut gerçek servisler aşağıda belirtilmiştir. Eksik endpoint gerektiğinde Codex ilgili kontrat ve backend'i aynı akış içinde geliştirir; Claude veya bütün IPC envanterinin bitmesini beklemez. Mock ile gerçek servis kabulü ayrı tutulur; mevcut kullanıcı değişiklikleri korunur.

## Mevcut hesap ve işletme akışı (C02)

Kontrat: [`../contracts/api.md`](../contracts/api.md), revizyon `kasam360.commercial.v1-draft.1`; işletme oluşturma ve OWNER üyeliği çalışan API davranışıdır. Kayıt/giriş/doğrulama Better Auth'ın mevcut `/api/auth/*` gerçek servisine bağlanabilir. İşletme oluşturma ve yetkili tenant okuma `POST/GET /v1/tenants` gerçek API servisine bağlanabilir; request/response, `Idempotency-Key`, 401/403/404/409 ve tenant kontrolü kontratta yazılıdır. Bunlar API test replica set'i ile doğrulandı.

Bu sürümde paket/quote/checkout/abonelik/cihaz yönetimi/V2 lisans endpoint'leri uygulanmamıştır. Paket seçici, teklif özeti, satın alma/ödeme, abonelik yönetimi, cihaz hakları ve V2 lisans ekranları yalnız kontrat tiplerini kullanan tipli mock ile hazırlanabilir; gerçek servis entegrasyonu iddia edilemez. Legacy `/api/license`, `/api/desktop/license` ve desktop `account_*` IPC akışları mevcut V1/local-device modelidir; V2 tenant ekranlarının backend'i değildir. Ödeme sandbox olmadan checkout doğrulanamaz. Mock ekran entegrasyonu tamamlanmış sayılmaz.

### Yerel web entegrasyon API'si

Çalışma dizini `backend/api`: `npm run start:local-test`. Adres `http://127.0.0.1:4178`; sağlık `GET /health`. Süreç her açılışta kendi MongoMemory replica set'ini ve iki TEST hesabını açar; kapanışta DB yok olur. Mail bellek içi sink'tir; SMTP/Google/ödeme dış servisi çağrılmaz. Kullanıcı/parola: `owner.a@kasam360.invalid` / `owner.b@kasam360.invalid`; varsayılan yerel parola `KasaTest-2026!` (başlatmadan önce `LOCAL_TEST_PASSWORD` ile değiştirilebilir). Yalnız `.invalid` e-posta ve test verisi kullanın.

Gerçek servisle bağlanabilir: `/api/auth/sign-in/email`, `/api/auth/get-session`, `POST /v1/tenants` (OWNER oluşturma), `GET /v1/tenants` (yalnız oturum kullanıcısının üyelikleri), `GET /v1/tenants/:tenantId` (üyelik doğrulamalı). POST create için `Idempotency-Key` UUIDv4 zorunlu; başarılı JSON biçimleri `../contracts/api.md` içindedir. `GET/POST /api/support*` bu profilde yalnız bellekteki test adapter'ına gider; kalıcı Labs desteği değildir. Normal API konfigürasyonu destek origin/token tanımlı değilse aynı uç `503` döndürür.

### Hesabım ekranı entegrasyon kanıtı

`web/src/components/account/AccountPanel.tsx` tenant paneli yukarıdaki çalışan oturum ve `/v1/tenants` servislerini kullanır. İşletme oluşturma, üyelik listesi ve yetkili tenant ayrıntısı gerçek yerel API'ye bağlanmıştır. Seçili tenant sayfa içi bağlamdır; hesap kimliği değişince temizlenir. Profildeki `businessName` etiketi tenant kaydı değildir. Bu teslim tarayıcıda TEST_A/TEST_B ile oluşturma, çoklu listeleme, seçim, hesap değişimi ve çapraz tenant 404 senaryolarıyla doğrulandı. UI tüketicisi için POST/GET şemaları ve yetki/hata kuralları `../contracts/api.md` içindedir.

Paket, teklif, checkout, ödeme, abonelik, cihaz ve lisans ekranları çalışan servis değildir; yalnız tipli mock ile hazırlanabilir ve mock entegrasyonu tamamlanmış sayılmaz. Hesabım'daki “Abonelik: Yakında” metni değişmemiştir.
