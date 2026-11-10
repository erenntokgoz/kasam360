# Sürüm yayınlama

Masaüstü uygulaması açılışta (ve her 6 saatte bir) GitHub Releases üzerindeki `latest.json` dosyasına bakar. Yeni sürüm varsa OWNER/MANAGER'a kapatılabilir "Güncelleme hazır" bildirimi çıkar; kullanıcı onaylamadan hiçbir şey kurulmaz. Kurulumdan önce paketin imzası `backend/tauri.conf.json` içindeki genel anahtarla doğrulanır; doğrulanamayan paket kurulmaz. Açık vardiya veya açık sipariş varken kurulum backend tarafından da reddedilir. Kurulumdan hemen önce doğrulanmış bir yerel yedek (`backups/kasam360_guncelleme_oncesi_<sürüm>_<zaman>.db`) alınır; yedek alınamazsa kurulum reddedilir ve en yeni 3 güncelleme öncesi yedek tutulur. İnternet yoksa denetim sessiz geçer.

## Bir kez yapılacaklar

1. Anahtar çiftini kendi bilgisayarınızda üretin (parolayı siz belirleyin, çıktıyı kimseyle paylaşmayın):

   ```powershell
   npx @tauri-apps/cli@2.11.4 signer generate -w "$HOME\.tauri\kasam360-update.key"
   ```

   İki dosya oluşur: `kasam360-update.key` (gizli) ve `kasam360-update.key.pub` (genel).
2. Genel anahtarın (`.pub` dosyasının tek satırlık içeriği) tamamını `backend/tauri.conf.json` içindeki `plugins.updater.pubkey` alanına yazıp commit edin. Boşken release iş akışı baştan durur.
3. GitHub > Settings > Secrets and variables > Actions altına iki secret ekleyin:
   - `TAURI_SIGNING_PRIVATE_KEY`: gizli anahtar dosyasının içeriği
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: anahtarı üretirken verdiğiniz parola
4. Gizli anahtarı ve parolayı yedekleyin (parola yöneticisi). Kaybolursa mevcut kurulumlara bir daha güncelleme gönderilemez; kurulu cihazlar yeni anahtarla elle yeniden kurulmak zorunda kalır. Gizli anahtar asla repoya girmez.

## Her sürümde

1. `backend/Cargo.toml`, `backend/tauri.conf.json` ve `desktop/package.json` içindeki `version` değerlerini aynı yeni numaraya getirip develop'a gönderin (CI geçmeli).
2. Etiketi siz atın:

   ```powershell
   git tag v0.3.0
   git push origin v0.3.0
   ```

3. `Release` iş akışı sırasıyla: etiket/sürüm tutarlılığı, backend clippy/test/fmt, desktop build ve vitest, ardından Windows'ta imzalı NSIS kurulumu, `.sig` ve `latest.json` üretip GitHub Release olarak yayınlar. Etiket sürümle uyuşmuyorsa veya secret/genel anahtar eksikse hiçbir şey yayınlanmaz.

## Notlar

- Uç nokta: `https://github.com/erenntokgoz/kasam360/releases/latest/download/latest.json`. Repo public olduğu için ek sunucu ve kimlik bilgisi gerekmez; bütünlüğü TLS değil imza sağlar. Taslak ve ön sürümler "latest" sayılmaz.
- Veri klasörü güncellemede korunur: veritabanı `app_data_dir` altındadır, NSIS güncellemesi onu silmez; şema değişiklikleri mevcut açılış migrasyonlarıyla uygulanır.
- Henüz test edilmedi: gerçek imzalı sürümle eskiden yeniye güncelleme (anahtar ve ilk yayın gerekir). İlk iki sürümle (örn. v0.3.0 → v0.3.1) uçtan uca denenmeli.
