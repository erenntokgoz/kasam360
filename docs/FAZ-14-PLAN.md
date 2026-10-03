# FAZ 14 — YASAL & ÖZEL GÜN

Durum: **tamamlandı.** B0 analiz/plan, B1 şema, B2 komutlar, B3 testler ve
B4 kapılar bitti. Kanıt: 635 test geçti, Faz 14 dosyalarında 0 clippy uyarısı,
`cargo fmt --check` temiz, emoji/gradient 0, dosya boyutu ≤ 500 satır.

Beklenenden sapan tek nokta: `campaign_tests.rs` 500 satırı aştığı için kupon
uygulama senaryoları `coupon_tests.rs` dosyasına ayrıldı (bkz.
`docs/YAPILACAKLAR.md`).

Kapsam bu fazda **yalnız backend + şema + testtir**. Frontend ve genel temizlik
Faz 17'ye bırakılmıştır (bkz. `docs/YAPILACAKLAR.md`).

---

## 1. MEVCUT DURUM ANALİZİ

### 1.1 Uyulacak mimari

| Öğe | Konum | Faz 14 için anlamı |
|---|---|---|
| Güvenlik katmanı şablonu | `inventory360_commands/mod.rs` | Aynı üç adım: `rbac::require_any` → `require_tenant` → `audit_mutex` + `record_audit` |
| Servis mantığı | `services/inventory360/**` | İş mantığı komuttan ayrılır, komutsuz testlenir |
| Test şeması | `services/inventory360_tests/support.rs` | `include_str!("migrations/schema.sql")` — kopyalanmış şema yok |
| Denetim kategorileri | `services/audit_service::category::ALL` | 8 kategori **donmuş**. Yeni kategori açılmaz |
| Kimlik | `id_generator::generate_id(prefix)` | Prefixed ULID. AUTOINCREMENT yok |
| Kiracı sahipliği | `management_commands::ensure_owned` | `SELECT 1 FROM t WHERE id=? AND tenant_id=?` |
| Nullable okuma | `services::inventory360::{optional_text, optional_i64}` | `Row::try_get` ile `?`; `unwrap_or(0)` yok |

### 1.2 Önceki taslaktan düzeltilen iki ihlal

Bu plan, çalışma ağacında bulunan önceki taslağı **iki noktada düzeltir**:

1. **`kdv_rate REAL` ihlali.** AGENTS.md §2 float'u yasaklar. KDV oranı para
   değil orandır ama oranı float'ta tutmak, KDV hesabını kuruşta değil
   ondalıkta yuvarlamaya davet eder. Bunun yerine oran **tam sayı yüzde**
   (`kdv_rate_percent INTEGER CHECK IN (1,10,20)`) olarak tutulur ve KDV
   kuruş cinsinden **tam sayı aritmetiğiyle** hesaplanır.
2. **Şema yorumlarında bozuk karakterler** (`ürün范围si`, `Telif沅`) düzeltildi.

### 1.3 Bu fazda açılmayanlar

- Feature flag: AGENTS.md §8'deki 11 bayrak **donmuştur**. Yasal modül
  bayrağa bağlanmaz; yetki OWNER/MANAGER ile sınırlanır.
- GİB e-Arşiv **gönderimi**: AGENTS.md §3.1 harici bulutu yasaklar. Bu faz
  yalnızca yerel kuyruk ve durum makinesi yapar; dışa giden istek yoktur.
- `campaign_templates` **kiracısızdır**: sistem şablonları tüm işletmelerin
  görebileceği tek katalogdur. Kiracı verisi taşımadığı için `tenant_id`
  kolonu yoktur ve `ALL` kiracılara açıktır (Faz 13 `campaign` şablonuyla aynı
  gerekçe).

---

## 2. TABLO TASARIMI (6 + 1)

| # | Tablo | Amaç | Tutarlar |
|---|---|---|---|
| 1 | `legal_documents` | Ruhsat, yangın, HACCP, vergi, SGK takvimi | — |
| 2 | `special_days` | Özel gün + yıllık tekrarlar | `discount_percent` tam sayı |
| 3 | `campaigns` | Kural + kupon + kullanım sayacı | `min_total_cents`, `usage_count` |
| 4 | `campaign_templates` | 10 hazır sistem şablonu | — |
| 5 | `insurance_policies` | İşyeri, sorumluluk, SGK, kasko | `premium_cents`, `coverage_cents` |
| 6 | `music_licenses` | MESAM / MSG / Bilgi Sistemi telifi | `amount_cents` |
| +1 | `e_invoices` | e-Arşiv kuyruğu ve durum | `total_cents`, `kdv_cents`, `matrah_cents` |

### 2.1 Dikkat edilmesi gereken kolon kararları

- **Tarihler metin (`TEXT`), `YYYY-AA-GG`.** ISO-8601 metni sözlüksel olarak
  sıralanır; `expiry_date < ?` karşılaştırması doğrudur. `DATETIME` tipi
  saat dilimi karışıklığı getirir ve bu modülde gün hassasiyeti yeterlidir.
- **`reminder_days`** her tabloda ayrı kolondur. Ortak bir "denetim ayarı"
  tablosu yerine satır başına tutulur: ruhsat için 60 gün, kasko için 15 gün
  farklıdır ve işletme bunu belge bazında değiştirir.
- **`is_active` soft-delete.** Belgeler silinmez; denetim izi bozulmasın diye
  pasife alınır (AGENTS.md §6 personel ilkesinin aynısı).
- **`coverage_cents` NULL olabilir.** "Teminat bilinmiyor" ile "teminat yok"
  farklıdır; ikisi de `0`'a çevrilmez (§3.4).

---

## 3. KOMUT MODÜLÜ TASARIMI

Dizin yapısı Faz 12'yi izler: komutlar ince, mantık serviste.

```
backend/src/legal360_commands/
  mod.rs                        ortak güvenlik katmanı
  legal_commands.rs             CRUD + upcoming_reminders + expiring
  campaign_commands.rs          CRUD + kupon + apply + istatistik
  special_day_commands.rs       CRUD + upcoming
  insurance_commands.rs         CRUD + expiring
  music_license_commands.rs     CRUD + expiring
  e_invoice_commands.rs         generate + queue + status
  tests.rs                      kapı regresyon testleri

backend/src/services/legal360/
  mod.rs, legal.rs, campaigns.rs, special_days.rs,
  insurance.rs, music_license.rs, e_invoice.rs
```

### 3.1 Yetki matrisi

| Modül | Okuma | Yazma |
|---|---|---|
| legal_documents | OWNER, MANAGER | OWNER |
| special_days | OWNER, MANAGER | OWNER |
| campaigns | OWNER, MANAGER | OWNER |
| insurance_policies | OWNER, MANAGER | OWNER |
| music_licenses | OWNER, MANAGER | OWNER |
| e_invoices | OWNER | OWNER |

**MASTER hiçbir kapıdan geçmez.** Gerekçe: MASTER platform hesabıdır;
bir işletmenin ruhsat veya poliçe kaydına erişmesi doğru değildir. Bu kural
`rbac::require_any(&role, &[Role::Owner, ...])` listelerinde MASTER'in hiç
bulunmamasıyla **yapısal** olarak garanti edilir, ayrı bir kontrolle değil.

Yazma neden yalnız OWNER: prim, KDV ve kampanya indirimi doğrudan **para**
etkisidir. Müdür bu kayıtları görür (şeffaflık) ama değiştiremez (hesap
sahibinin imzası).

### 3.2 KDV aritmetiği (tam sayı)

`orders.total_cents` KDV **dahil** toplamdır. Oran `r` (`1`, `10`, `20`):

```
kdv_cents   = total_cents * r / (100 + r)   // tam sayı bölme, aşağı yuvarlar
matrah_cents = total_cents - kdv_cents
```

Neden `r / (100 + r)`: `total = matrah * (100 + r) / 100` olduğundan matrah
ve KDV toplamdan **geri** çözülür. İleri yönde hesap (`total * r / 100`)
KDV'yi matrahın üstüne katar ve iki kuruş kaydırır.

---

## 4. TEST STRATEJİSİ

Her modül için zorunlu üç eksen:

1. **Mutlu yol** — kayıt oluştur, listele, hatırlatma listesinde bul.
2. **Kiracı izolasyonu** — A işletmesinin kimliğiyle B işletmesinin kaydına
   erişim `NOT_FOUND` verir; güncelleme/silme A'nın satırını değiştirmez.
3. **Sınır durum** — süresi geçmiş belge, kullanım limiti dolmuş kupon,
   boş kupon kodu, geçersiz oran, negatif prim.

Ek olarak her modülde **sessiz hata** testi: para/ sayaç okuması `Err`
yükseltir, `0` dönmez (AGENTS.md §3.4).

Testler `services/legal360_tests/` altında istenen adlarla yaşar:
`legal_tests.rs`, `campaign_tests.rs`, `special_day_tests.rs`,
`insurance_tests.rs`, `music_license_tests.rs`, `e_invoice_tests.rs`.

---

## 5. KAPILAR (B4)

- `cargo check --all-targets` → 0 hata
- `cargo test` → 100% pass
- `cargo clippy -- -D warnings` → 0 uyarı **Faz 14 dosyalarında** (repo geneli
  temiz değil; gerekçe `docs/YAPILACAKLAR.md`)
- `cargo fmt --check` → Faz 14 dosyaları temiz (repo genelinde 736 sapma var,
  tamamı Faz 14 öncesi dosyalarda; `cargo fmt` çalıştırıldığında 108 dosyada
  yalnızca satır kaydırma değişikliği çıkardığı için geri alındı)
- Emoji / gradient taraması → 0
- Dosya boyutu ≤ 500 satır

## 6. FAZ 17'YE BIRAKILANLAR

- Tüm Faz 14 ekranları (arayüz, route, feature flag görünümü)
- Genel temizlik: dosya bölme, yorum standardizasyonu, ölü kod tarama