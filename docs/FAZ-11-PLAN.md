# Faz 11 — Personel 360° (SPEC §2.10)

> Bu doküman Faz 11'in analizini, görev listesini ve kabul kriterlerini taşır.
> Kaynak: `docs/PLAN-SPEC-IMPLEMENTATION.md` Faz 11 + AGENTS.md anayasası.

## 1. Amaç

Personel ekranını "liste + sil" ekranından **360° operasyon merkezine** dönüştürmek.
6 sekme, 5 maaş modeli, bahşiş havuzu, garson KPI, şüpheli işlem radarı, doğum günü,
vardiya planlama, izin, zimmet, tutanak sicili, soft-delete.

## 2. Mevcut Durum (keşif)

### 2.1 Var olan

| Varlık | Yer | Not |
|---|---|---|
| `users` | `schema.sql:251-262` | id, tenant_id, role, name, credential_hash, pin_hash, login_identifier, email, is_active |
| `shifts` | `schema.sql:264-274` | **kasa** vardiyası; personel vardiyası DEĞİL. `cashier_id`, `expected/actual/difference_amount_cents` |
| `tables.waiter_id` | `schema.sql:160-169` | tek "garson kim" alanı, hiçbir raporda okunmuyor |
| `audit_ledger` | `schema.sql:53-69` | `category` CHECK'inde `'PERSONEL'` **VAR** |
| `general_expenses.category` | `schema.sql:564-577` | CHECK'inde `'STAFF_ADVANCE'` **VAR** (avans/masraf yolu hazır) |
| `get_staff` / `create_staff_member` / `delete_staff_member` | `management_commands.rs:579/596/644` | `require_any(Owner, Manager)`; soft-delete `is_active = 0` |
| `OwnerStaffTab.tsx` | 563 satır | tek düz kart listesi + 3 modal |
| `StaffManagementPanel.tsx` | 568 satır | **ÖLÜ KOD** — hiçbir yerden render edilmiyor |

### 2.2 Yok olan (Faz 11'in tamamı)

Şema: `staff_profiles`, vardiya planlama, izin, maaş bordrosu, bahşiş havuzu, zimmet,
tutanak sicili, `users.birth_date`, `users.hire_date`, `users.phone`.

Backend: personel servisi **yok**. `management_commands.rs` dışında personel komutu yok.
Garson KPI için kullanılabilir kolon **yok** (`order_items.waiter_id` YOK,
`orders.cashier_id` yazılmıyor).

Frontend: 6 sekmeden **hiçbiri** mevcut değil. Personel ekranı tek sekme.

Test: `management_commands.rs` ve `shift_commands.rs` için Rust test dosyası **YOK**.

### 2.3 Faz 11'e başlamadan önce kapatılacak mevcut ihlatler

AGENTS.md §3.3 "tenant_id filtresiz sorgu YASAK" ve §6 yetki matrisi ihlalleri:

| # | İhlat | Yer | Etki |
|---|---|---|---|
| V1 | `get_active_shift` SQL'inde `tenant_id` filtresi yok | `commands/shift_commands.rs:175` | **cross-tenant vardiya sızıntısı** |
| V2 | `get_open_shifts` SQL'inde `tenant_id` filtresi yok | `commands/shift_commands.rs:202-206` | **cross-tenant vardiya sızıntısı** |
| V3 | `waiter_clock_in` RBAC çağırmıyor, `tenant_id` bağlamıyor | `waiter_commands.rs:107-121` | satır `DEFAULT_TENANT`'a düşüyor |
| V4 | `open_shift` / `close_shift` RBAC çağırmıyor | `shift_commands.rs:29/97` | yetkisiz vardiya açma |
| V5 | `orders.cashier_id` hiçbir INSERT/UPDATE yazmıyor | `pos_commands.rs:240` | garson KPI'sı imkânsız |

## 3. Tasarım Kararları

### 3.1 Personel profili `users`'tan ayrı mı?

**Karar: `staff_profiles` ayrı tablo, `users.user_id` ile 1:1.**

Gerekçe: `users` kimlik doğrulamadır (Argon2id hash, PIN, soft-delete). `staff_profiles`
ise işveren verisidir (maaş, TC, doğum günü, işe giriş). Aynı tabloda tutulsaydı
kimlik doğrulama sorguları her seferinde maaş kolonlarını da taşırdı ve yetkisiz
erişim riski doğardı. Ayrı tablo = "kim giriş yapabilir" ile "kimi istihdam ediyoruz"
ayrışır ve KVKK gereği maaş kolonları ayrı bir yetki kapısından geçer.

### 3.2 Maaş gizliliği

AGENTS.md'de maaş gizliliği kuralı **yok**. Bu faz için eklenen kural:

- Maaş/prim/bahşiş **tutarı** yalnız OWNER görür. MANAGER yalnız **toplam** görür
  (kişi bazlı kırılım görmez), çünkü müdürün kendi bonusunu görmemesi işveren
  ilişkisini zedeler.
- Yetki: `require_payroll_detail(OWNER)` ve `require_payroll_total(OWNER|MANAGER)`.
- Bu kural `navigationMatrix.ts`'e yeni capability olarak da işlenir.

### 3.3 Garson KPI verisi nereden gelir?

`order_items.waiter_id` **YOK** ve `orders.cashier_id` yazılmıyor (V5).
En küçük doğru çözüm: `submit_order` ve `orders` güncellemelerinde
`cashier_id`/`waiter_id` **yazılır**. Yeni kolon şeması eklemek yerine
mevcut `orders.cashier_id` doldurulur; kalem bazlı garson ise `order_items.waiter_id`
kolonu ile eklenir (masanın `waiter_id`'sinden devralınır).

KPI tanımları (yalnız gerçek ölçülebilen):
- **Fiş adedi**: `COUNT(DISTINCT orders.id)` — `orders.waiter_id` ile
- **Ciro**: `SUM(order_items.total_cents)`
- **Ortalama fiş**: ciro / fiş adedi
- **İptal oranı**: kişinin iptal ettiği ciro / toplam ciro (tenant genelinden ayrık)
- **Vardiya saati**: `shifts.opened_at`/`closed_at` farkı

Kâr marjı **kapsam dışı**: Faz 10'da maliyet bilinmeyen ürünler `null` döndü. Garson
karnesinde marj göstermek aynı tuzağa düşer; gösterilmez.

### 3.4 Şüpheli işlem radarı (>%30 kuralı)

AGENTS.md §2 audit ledger değiştirilemez; radar **okuma** katmanıdır, kayıt yazmaz.

Kurallar (her biri tenant + personel bazında, çapraz eşleşmez):
1. **Yüksek iptal oranı**: kişinin iptal ettiği ciro / toplam ciro > %30
2. **Yüksek indirim oranı**: kişinin verdiği indirim / toplam ciro > %30
3. **Kasa farkı**: `shifts.difference_cents` mutlak değeri > eşik
4. **Kısa vardiya anomalisi**: açık vardiya > 12 saat

Her kural tek başına raporlanır; eşik aşılmıyorsa **kural listesine girmez**
(sıfır eşik, "%0 uyarı" üretmez).

### 3.5 5 maaş modeli

Sabit + komisyon + bahşiş + vardiya saati + kâr payı. Her model `payroll_rules`
tablosunda bir satırdır; `users` başına tek satır tutulur, geçmişe dönük hesap
`payroll_runs` ile saklanır (yeniden hesaplanabilir olmalıdır).

### 3.6 Vardiya planlama `shifts`'e mi ayrı tablo mu?

**Karar: `shift_plans` ayrı tablo.** `shifts` gerçekleşen kasa hareketidir ve
`expected_amount_cents` ile finansal muhasebeye bağlıdır; planlama sütunları
eklemek bu tabloyu iki işleve sahip yapar. Plan → gerçekleşen eşleşmesi
`realized_shift_id` ile opsiyonel.

## 4. Görev Listesi

### B0 — Analiz ve plan
- [x] Mevcut durum envanteri (§2)
- [x] Keşif sırasında bulunan 5 mevcut ihlat (§2.3)
- [x] Tasarım kararları (§3)
- [x] Bu doküman

### B1 — Mevcut ihlatlerin kapatılması
- [x] V1: `get_active_shift` `tenant_id` filtresi
- [x] V2: `get_open_shifts` `tenant_id` filtresi
- [x] V3: `waiter_clock_in` RBAC + `tenant_id`
- [x] V4: `open_shift` / `close_shift` RBAC
- [x] V5: `orders.cashier_id` yazımı + `order_items.waiter_id` kolonu
- [x] Rust testleri (`src/shift_security_tests.rs`, 18 test) — 335/335 yeşil
- [x] Frontend mock'ları yeni sözleşmeye uyarlandı; 3 test yeni kapıyı yansıtacak
  şekilde güncellendi, 1 yeni test eklendi (`get_active_shift` rol reddi,
  `waiter_clock_in` KITCHEN reddi) — 414/414 yeşil

### B2 — Şema
- [x] `staff_profiles`
- [x] `payroll_rules`, `payroll_runs`
- [x] `tip_pool_entries`, `tip_distributions`
- [x] `shift_plans`
- [x] `leave_requests`
- [x] `custody_records`
- [x] `staff_incidents` (tutanak sicili)
- [x] `order_items.waiter_id` kolonu + indeks (`idx_order_items_waiter`)

### B3 — Backend servis
- [x] `staff_service.rs` — profil UPSERT, doğum günü listesi, vardiya planı, izin, zimmet, tutanak
- [x] `staff_types.rs` — tarih bilinmiyorsa `None`, boş string değil
- [x] `payroll_service.rs` — 5 model, `period_range` doğrulaması (artık yıl dahil)
- [x] `tip_service.rs` — havuz toplamı, tabanlı dağıtım, kalan kuruş denetimi
- [x] `kpi_service.rs` — `order_items.waiter_id` + `orders.cashier_id`
- [x] `suspicious_service.rs` — iptal oranı ve günlük onay yoğunluğu, asgari örneklem şartlı
- [x] `payroll_types.rs`

### B4 — Komut katmanı ve RBAC
- [x] `require_staff_admin` / `require_payroll_amounts` / `require_shift_planning` / `require_leave_request` (rbac.rs)
- [x] `staff_commands.rs` — 21 komut, hepsi fail-closed tenant kapısıyla
- [x] `lib.rs` handler kaydı

### B5 — Backend testleri
- [x] `shift_security_tests.rs` — 18 test (B1'deki 5 ihlata karşı)
- [x] `staff360_tests.rs` — 34 test (mutlu yol + kiracı izolasyonu + null kuralı)
- [x] Maaş gizliliği testi: müdüre `amounts: None` döner
- [x] Kuruş kaybı testi: 100 kuruş 3 kişiye bölünür, toplam tam 100 kalır

### B6 — Frontend 6 sekme
- [x] `staff360Types.ts` (backend alan adlarıyla birebir)
- [x] `StaffPrimitives.tsx` (panel başlığı, hata bandı, boş durum, doğum günü şeridi)
- [x] `StaffDirectoryTab.tsx` (467) — Personel
- [x] `PayrollTab.tsx` (383) — Maaş
- [x] `TipPoolTab.tsx` (329) — Bahşiş
- [x] `ShiftAndLeaveTab.tsx` (389) — Vardiya ve İzin
- [x] `PerformanceTab.tsx` (269) — Performans ve radar
- [x] `CustodyAndIncidentTab.tsx` (403) — Zimmet ve Sicil
- [x] `OwnerStaffTab.tsx` 6 sekme kabuğu (563 → 96 satır)
- [x] Ölü `StaffManagementPanel.tsx` silindi
- [x] `tauriInvoke.ts` — 21 mock komut, `resetMockStaff360`, mock kapıları backend ile aynı

### B7 — Kapılar ve commit
- [x] `cargo check --all-targets` — 0 hata, 0 uyarı
- [x] `cargo test` — 377 passed / 0 failed
- [x] `npx tsc --noEmit` — 0 hata
- [x] `npx vitest run` — 37 dosya / 446 test geçti
- [x] `staff360Contract.test.ts` — 32 sözleşme testi
- [x] Faz 11 diff satırı 1316; emoji 0, gradient 0
- [x] Tüm yeni dosyalar < 500 satır
- [x] commit

## 4bis. Ertelenenler (gerekçesiyle)

- **`tip_pool_entries` kaynağı bağlanmadı.** Ödeme ekranına bahşiş alanı
  eklemek `process_payment` sözleşmesini değiştirirdi; bu, P0 güvenlik kilitleri
  (#2 çift stok düşümü, #8 parçalı ödeme bakiyesi) ile aynı yolu paylaşıyor.
  Bu fazda havuz boş kalır ve ekranda dürüstçe "bu dönemde kayıtlı bahşiş yok"
  yazar. Sahte bahşiş üretmektense havuz boş görünür.
- **Garson vardiye saati tutulmuyor.** `shifts` tablosu kasa vardiyası için
  açıldı; garson için saat kaydı yok. Bu yüzden HOURLY modeli ve saat bazlı
  bahşiş dağıtımı garsonlara uygulanamaz; dağıtım tabanı fiş adedidir.
- **Tutanak çözümleme komutu eklenmedi.** Kayıt açılıyor ve listeleniyor,
  durum `ACIK` kalıyor; kapatma akışı sonraki faza bırakıldı.

## 5. Kabul Kriterleri

1. B1'deki 5 ihlatın **her biri** için yazan test var ve geçiyor.
2. Maaş tutarı MANAGER'a kişi bazlı dönmez; test bunu kanıtlar.
3. FIFO dışı maliyet KPI'da **gösterilmez** (Faz 10 `null` kuralıyla tutarlı).
4. Şüpheli işlem radarı eşik aşılmadığında boş liste döner, sahte uyarı üretmez.
5. Tüm personel sorguları `tenant_id` filtreli; kiracı izolasyon testi var.
6. Personel silinmez, pasife alınır (AGENTS.md §6).
7. Tüm tutarlar `*_cents` tam sayı; float yok.
8. Yeni bileşenler 300 satırın altında.