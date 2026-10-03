# FAZ 15 — GÜVENLİK SERTLEŞTİRME

Durum: **B0 analiz ve kapsam kararları tamamlandı.** B1 (açık kapatma) →
B2 (kaba kuvvet + şifre politikası) → B3 (çift onay eşiği + KVKK maskeleme)
→ B4 (oturum yönetimi) sırayla uygulanır.

Amaç (kaynak: `docs/PLAN-SPEC-IMPLEMENTATION.md:311-315`): çok katmanlı giriş
(mevcut + 2FA + RFID), şifre politikası, oturum yönetimi, cihaz kaydı, kaba
kuvvet, çift onay (>5.000₺), KVKK/GİB/HACCP/İSG.

> Not: "Spec §15-22" diye atıf yapılan belge **repo içinde yok**. Bu plan
> yalnız `PLAN-SPEC-IMPLEMENTATION.md` §4'teki faz tanımına dayanır; §15-22
> içeriği uydurulmamıştır.

Kapsam bu fazda, Faz 14'te olduğu gibi **yalnız backend + şema + testtir**
(frontend kararı bölüm 4, D2). Genel temizlik Faz 17'ye bırakılmıştır
(bkz. `docs/YAPILACAKLAR.md`).

---

## 1. MEVCUT DURUM: 7 GEREKSİNİM

| # | Gereksinim | Durum | Kanıt |
|---|---|---|---|
| 1 | 2FA | **YOK** | `totp\|otp\|2fa\|mfa\|challenge` → 22 isabet, hepsi yorum veya cihaz tablosu |
| 2 | Cihaz kaydı | **KISMİ** | `devices` tablosu var (`schema.sql:388-395`), ama parmak izi/güven bağı yok |
| 3 | Çift onay >5.000₺ | **KISMİ** | Mekanizma var, tutar eşiği **yok** (`approval_service.rs:38-39`) |
| 4 | KVKK maskeleme | **YOK** | Maske fonksiyonu sıfır; `national_id` çıplak (`staff_types.rs:45`) |
| 5 | Oturum yönetimi | **YOK** | `sessions` tablosu yok, logout yok, `AppState` 3 mutex (`lib.rs:40-44`) |
| 6 | Şifre politikası | **KISMİ** | PIN 4-8 hane var (`user_credentials.rs:16`), şifre yolunda politika yok |
| 7 | Kaba kuvvet | **KISMİ** | 5 deneme/300 sn **RAM**'de (`auth_commands.rs:13-14`), şifre yolu throttle'suz |

### 1.1 Kritik mimari tespit: yetki çağrıya güveniyor

AGENTS.md §9'daki 13 P0 kilidin gerçek karşılığı **çift onay akışıdır**, oturum
değildir. Şu an her ayrıcalıklı komut rolü **istemciden gelen bir metin**
olarak alır:

```rust
get_devices(caller_role: String, ...)          // platform_commands.rs:443
VerifyManagerPinPayload { actor_role, ... }    // approval_commands.rs:21
```

`rbac::require_master_present` (`rbac.rs:115`) yalnız metnin **varlığını ve
yazımını** denetler. IPC'yi çağıranın gerçekten oturum açtığını doğrulayan
hiçbir katman yoktur. `localStorage['kasam360_terminal_session']` yalnız
**yazılır**, hiç okunmaz (`useAuthStore.ts:72`). Kısacası: rol matrisi
düzgün çalışır, ama **çağıranın kim olduğu kanıtlanmaz**.

Bu, 5 numaralı gereksinimi (oturum) listedeki en pahalı kalem yapar: oturum
eklenirse her komutun imzası değişir. Kapsam kararı D1'e bırakıldı.

### 1.2 Kaba kuvvet: iki ayrı mekanizma, ikisi de eksik

| | Giriş PIN'i | Onay PIN'i | Şifre |
|---|---|---|---|
| Nerede | `auth_commands.rs:13-14` (RAM) | `approval_service.rs:42` (DB) | **yok** |
| Eşik | 5 / 300 sn | 5 / 300 sn | — |
| Kapsam | **global** (tüm personel) | tenant+terminal+surface | — |
| Restart dayanıklı | **hayır** | evet | — |
| Denetleniyor | hayır | evet (`approval:lockout`) | — |

`check_pin_rate_limit` yalnız `authenticate_by_pin:151` içinde çağrılır.
`authenticate_by_identifier:77` (e-posta + şifre) **hiç** çağırmaz → sınırsız
parola denemesi. AGENTS.md §9/13'teki "busy_timeout(5000)" ise giriş kısıtı
değil, SQLite kilit beklemesidir (`db/mod.rs:45`); metin yanıltıcıdır.

---

## 2. FAZ 15 ÖNCESİ BULUNAN AÇIKLAR

Bunlar Faz 15'in konusu değil ama **bu fazda düzeltilmemesi** durumunda
AGENTS.md ihlali olarak kalır. B1'de kapatıldı.

| # | Açık | Kanıt | Durum |
|---|---|---|---|
| A1 | `change_self_pin` eski PIN'i doğrulamadan yeni PIN yazıyordu | `auth_commands.rs:257` — `if let Some(...)`; `None` gelince doğrulama yok. Arayüz alanı boş bırakılınca `undefined` gönderiyor (`UserProfileModal.tsx:77`) | **Kapandı.** `mevcut_pin_zorunlu` kapısı; tipin `String` olması Faz 17'de |
| A2 | `get_devices` filtresiz SQL | `platform_commands.rs:446` — `WHERE` yok | **Açık DEĞİL.** B0'da yanlış sınıflandırılmıştı: MASTER platform hesabıdır ve tüm işletmelerin cihazlarını görmek görevidir. Gerçek eksiklik "kapsamın kodda adıyla durmaması"ydı; `CihazKapsam` enum'ı ile platform/kiracı kapsamı ayrıştırıldı ve testlendi |
| A3 | `record_device_heartbeat` yetki denetimi yok | `platform_commands.rs:460` — rol yok, kiracı filtresi yok, sıfır satır güncellenince bile başarı | **Kapandı.** Rol + kiracı kapsamı; hedef yoksa `NOT_FOUND` |
| A4 | `register_device` UUID v4 kullanıyordu | `platform_commands.rs:470` | **Kapandı.** `generate_id("dev")` |
| A5 | Parola yolunda kaba kuvvet koruması yok | `auth_commands.rs:77` — `check_pin_rate_limit` yalnız `:151`'de çağrılıyordu | **Kapandı** (geçici). Parola yolu da kilide bağlandı; sayacın DB'ye ve kullanıcı bazına taşınması B2'de |
| A6 | Arayüz denetim kaydının maskelendiğini **yanlış** söylüyor | `OwnerAuditLogDetailModal.tsx:16` — "payload zaten backend'de maskelenerek yazıldı" | **Faz 17'ye** (D2: backend-only) |

### 2.1 B1'de kapsam dışı bırakılan iki bulgu

- **`platform_commands.rs` hâlâ 742 satır** (AGENTS.md §10 tavanı 500). Cihaz
  bloğu ayrılınca 914 → 742 düştü; kalanı tenant/personel yönetimi. Tam bölme
  Faz 17'de — bu fazda yalnız cihaz bloğu taşındı.
- **Komutların çoğu hâlâ `caller_role: String` alıyor.** Oturum D1'de yalnız
  yüksek riskli komutlara eklenecek; tamamı B4'te.

---

## 3. DENETİM KATEGORİSİ

Yeni kategori **açılmaz**: AGENTS.md §4.1'deki 8 kategori üç yerde donmuştur
(`audit_service::category::ALL`, `schema.sql:120-121` tetikleyicisi, testler).
Faz 15'in tüm güvenlik olayları `GUVENLIK` kategorisine yazılır.

Tek normalizasyon: `system:device_registered` şu anda `SISTEM` kullanıyor
(`platform_commands.rs:478`) → `GUVENLIK`'a taşınır.

---

## 4. VERİLEN KARARLAR

| # | Karar | Sonuç |
|---|---|---|
| **D1** | Oturum **katmanlı**: `sessions` tablosu + token + logout + süre sonu; `caller_role` **kaldırılmaz**. Oturum isteyen komutlar: PIN değiştirme, kasa çıkışı, gün sonu, personel silme, cihaz yönetimi, parola sıfırlama | B4'te uygulanır. Mevcut imzalar bozulmaz |
| **D2** | **Backend-only.** 2FA kayıt ekranı, giriş doğrulama kodu, oturum listesi ve maskeleme görünümü Faz 17'ye | Backend hazır, kapalı kalır |
| **D3** | Çift onay eşiği **kiracı başına DB kaydı**; kapsam **tüm para çıkışları**: ödeme toplamı, kasa çıkışı (`cash_out`), gün sonu (`close_day`) | İşletme eşiği kod değiştirmeden değişir |

### D3 uygulama notu

Eşik tek satırda tutulur (`approval_thresholds`): `tenant_id`, `amount_cents`,
`updated_at`. Satır yoksa **kapalı** sayılır (fail-closed değil, mevcut davranış
korunur) — ilk açılışta mevcut `LARGE_DISCOUNT_CENTS` mantığı çalışmaya devam
eder. Eşik `cash_out` ve `close_day` için de aynı `approval` altyapısını
kullanır; ikisi bugün onaysızdır (`cashier_commands.rs:103-112`).

---

## 5. BATCH PLANI

- **B1 — Açık kapatma**: A1, A3, A4, A5. **Tamamlandı** — 13 test (10 cihaz + 3
  auth), `cargo test` 653 geçti, yeni dosyalarda 0 clippy uyarısı.
  Cihaz komutları `platform_commands/devices.rs` alt modülüne taşındı; mantık
  `&mut SqliteConnection` alır (Tauri `State` test edilemez), sarmalayıcılar
  yalnız yetki + denetim ekler. Cihaz olayları `GUVENLIK` kategorisine alındı
  (`system:device_*` → `security:device_*`).
  **A2 yeniden sınıflandırıldı** (bkz. bölüm 2), **A6 Faz 17'ye** (D2).
- **B2 — Kaba kuvvet ve şifre politikası**: kilit DB'ye taşınır (per-user +
  per-tenant), `authenticate_by_identifier` artık throttle alır (A5 kalıcı
  çözüm), şifre politikası ve PIN geçmişi.
- **B3 — Çift onay eşiği + KVKK maskeleme**: D3 eşiği ve maske katmanı.
- **B4 — Oturum yönetimi**: D1 kapsamı.
- 2FA: D2 gereği kayıt/doğrulama servisleri kurulur; girişe **zorunluluk**
  ve arayüz Faz 17'ye.

## 6. KAPILAR (B4)

- `cargo check --all-targets` → 0 hata
- `cargo test` → 100% pass
- `cargo clippy` → Faz 15 dosyalarında 0 uyarı
- `cargo fmt --check` → Faz 15 dosyaları temiz
- Emoji / gradient → 0
- Dosya boyutu ≤ 500 satır
- Yeni denetim kategorisi **0** (§3)

## 7. FAZ 17'YE BIRAKILANLAR

- 2FA arayüzü (QR kayıt, giriş doğrulama ekranı)
- Oturum yönetimi ekranı (aktif oturumlar, cihaz listesi)
- Maskeleme görünümü ve "kişisel veriyi göster" onay akışı
- `OwnerAuditLogDetailModal.tsx:16` yorumunun düzeltilmesi