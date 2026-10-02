# FAZ 9 — HESAP DEFTERİ DERİNLEŞTİRME (Backend Teslim + Frontend Görev Listesi)

> Bu belge backend'in bittiğini kanıtlar ve frontend'in başlayacağı noktayı
> belirler. **Frontend henüz yazılmadı.** Aşağıdaki görev listesi yarınki
> frontend oturumunun sözleşmesidir.

---

## 1. Backend Durumu: TAMAMLANDI

| Kontrol | Sonuç |
|---|---|
| `cargo check --all-targets` | 0 hata, 0 uyarı |
| `cargo test` | **276 passed / 0 failed** |
| 500 satır kuralı (bu fazda üretilen tüm dosyalar) | Geçti |

### 1.1 Adım 1 — Dosya bölme

`commands.rs` ve `ledger_commands.rs` facade yapısına dönüştürüldü.
`crate::commands::*`, `crate::ledger_commands::*` ve
`tauri::generate_handler!` yolları **hiç değişmedi** — 160+ komut yolu bozulmadan.

### 1.2 Adım 4/5 — Net bakiye motoru

`services/ledger_service.rs` + `AccountClass` ile beş hesap türü tek sayıda
birleşiyor. Her tür için ayrı test:

| Hesap türü | Yön | Test |
|---|---|---|
| Toptancı (`TAKEN`) | negatif (borç) | `supplier_debt_counts_as_payable` |
| Müşteri veresiye (`GIVEN`) | pozitif (alacak) | `customer_veresiye_counts_as_receivable` |
| Personel | hakediş negatif, avans pozitif | `staff_advance_is_receivable_and_unpaid_salary_is_payable` |
| Sabit gider (`TAKEN`) | negatif | `fixed_expense_invoice_counts_as_payable` |
| Patron Şahsi | **sermaye çekimi** — alacak değil | `owner_personal_is_equity_withdrawal_not_receivable` |

### 1.3 Adım 6 — Veresiye masa kapatma

`record_veresiye_settlement` yalnız `debts` yazar. Kullanıcının talebi doğrultusunda
`cash_out` **yazılmadı** (kullanıcı talebine uygun davranış).
Kanıt: `veresiye_settlement_does_not_touch_cash_drawer` — kasa hareketi sayısı
kapanmadan önce ve sonra **aynı**.

### 1.4 Adım 5b — Bütçe + tekrarlayan gider

`services/budget_service.rs` (12 test). %80 uyarı eşiği, ay filtresi, kiracı
izolasyonu, artık yıl farkında 31 → 28/29 sıkıştırma.

### 1.5 Adım 7 — Cari ekstre + 80mm makbuz

`services/ledger_statement.rs` (11 test). İşaret kuralı `net_balance` ile
**birebir aynı** (GIVEN = +). 80mm = 32 sütun sınırı testle doğrulandı.

### 1.6 Adım 8 — P&L çift sayım düzeltmesi + export

`services/pnl_service.rs` (12 test).

**Bulunan ve düzeltilen çift sayım yolu:**
1. Adisyon peşin kapatıldı → `orders.status = 'PAID'`
2. Aynı adisyon için cari borç açıldı (`debts.order_id` dolu)
3. Müşteri borcu kapattı → `debt_payments` yazıldı → **para ikinci kez sayıldı**

Düzeltme: bağlı siparişi `orders`ta zaten `PAID` olan borçların tahsilatı
gelir toplamına **girermez**. Kanıt: `debt_payment_of_a_paid_order_is_not_counted_twice`
(100 TL + 100 TL = 200 TL olmaz) ve aşırıya kaçmayı engelleyen
`genuine_veresiye_collection_is_still_counted`.

### 1.7 Adım 9 — Patron Şahsi

`ledger_commands/owner_personal.rs`. `record_owner_personal`:
* yalnız `OWNER` rolü,
* kart tipi `OWNER_PERSONAL` değilse hata,
* `general_expenses`a **dokunmaz** (P&L'e girmez),
* `cash_movements`a **dokunmaz** (şahsi para kasa gibi gösterilmez),
* audit ledger'a `owner_personal:recorded` yazar,
* DTO `excludedFromProfit: true` ve `ledgerLabel` döner — arayüz bu rozeti
  **göstermekle yükümlü**, aksi hâlde patron şahsi çekimini zarar sanar.

---

## 2. Frontend Sözleşmesi — Hazır Komutlar

Tümü `tauriInvoke('komut_adi', { ... })` ile çağrılır. `actor_role`, `actorId`,
`tenant_id` `tauriInvoke` tarafından **otomatik enjekte edilir**; ayrı IPC
wrapper katmanı yoktur.

| Komut | Girdi | Çıktı |
|---|---|---|
| `get_net_balance` | `{ includeZero?: bool }` | `NetBalanceReport` |
| `record_veresiye_settlement` | `{ directoryId, orderId, amountCents, description? }` | `{ debtId, directoryName, amountCents }` |
| `get_directory_statement` | `{ directoryId, from, to }` | `DirectoryStatementDto` |
| `print_payment_receipt` | `{ paymentId }` | `PaymentReceiptDto` |
| `get_budget_status` | `{ asOf? }` | `BudgetStatusDto[]` |
| `get_recurring_expenses` | `{ asOf? }` | `RecurringDueDto[]` |
| `get_financial_report` | `{ startDate?, endDate? }` | `FinancialReportDto` |
| `export_financial_report` | `{ startDate?, endDate? }` | `FinancialExportDto` |
| `record_owner_personal` | `{ directoryId, amountCents, movementKind, note? }` | `OwnerPersonalDto` |

---

## 3. Frontend Görev Listesi (yarın)

### Önce — bölme (bloklayıcı)

**GÖREV-0. `EndOfDayContainer.tsx` bölme (1650 satır)**
AGENTS.md §5: dosya max 500 satır. Bölme sırası ve kabul kriteri:
1. `useEndOfDayData` (veri çekme + state) — `hooks/`
2. `PayDebtModal` (kısmi tahsilat/tam kapatma) — `ui/`
3. `VeresiyeCloseModal` (veresiye ile masa kapatma) — `ui/`
4. Kalan container ≤ 300 satır
Kabul: `npx tsc --noEmit` 0 hata + `npx vitest run` 100% PASS + **hiçbir görsel
değişiklik yok** (DOM ve sınıf adları aynen korunur).

### Sıra 1 — Beş ayrıştırılmış rehber

**GÖREV-1. `DirectoryGuide` bileşeni**
Tek bileşen, `directory.type` ile dal gösterir: `CUSTOMER` / `SUPPLIER` /
`STAFF` / `FIXED_EXPENSE` / `OWNER_PERSONAL`. Her dal yalnız kendi alanlarını
gösterir. Kabul: `directories.type` CHECK değerlerinin beşi de test edilir.

**GÖREV-2. `DirectoriesTab.tsx` (413 satır) → 5 sekmeye ayrıştır**
Kabul: dosya 500 altında, sekme başına ayrı bileşen, görsel değişiklik yok.

### Sıra 2 — Net bakiye

**GÖREV-3. Net bakiye şeridi**
`get_net_balance` → tek sayı. Altında beş hesap sütunu: Toptancı / Müşteri /
Personel / Sabit Gider / Patron Şahsi. **Patron Şahsi sütunu "Sermaye çekimi"
etiketiyle** gösterilir, "Alacak" değil. `tabular-nums` zorunlu.

**GÖREV-4. Vade rozetleri (emoji yok)**
Ç-1 kararı: renk + ikon (Lucide) + metin. Rozet metni tek başına bilgi taşır
(renk tek başına asla). Kabul: `grep -rP "[\x{1F300}-\x{1F9FF}]" desktop/src/` → 0.

### Sıra 3 — Hareketler

**GÖREV-5. `DirectoryStatement` görünümü**
`get_directory_statement` → açılış bakiyesi, tarih sıralı satırlar, kapanış
bakiyesi. Satır sonu bakiyesi **imzalı** (`signedAmountLabel` DTO'dan gelir;
frontend'de yeniden biçimlendirme yok).

**GÖREV-6. 80mm makbuz yazdırma**
`print_payment_receipt` → `lines: string[]` dizisini **olduğu gibi** basar.
Frontend metni yeniden düzenlemez; yeniden düzenlerse makbuz veritabanından
türetilmiş kanıt olmaktan çıkar. Kopyalama öncesi kırpmaya izin verilmez.

**GÖREV-7. Kısmi tahsilat / tam kapatma**
Mevcut `pay_debt` akışı korunur. Tam kapatmada `remaining = 0` ve kasa hareketi
**yalnız gerçekten nakit girdiyse** yazılır.

### Sıra 4 — Bütçe ve tekrarlayan işlemler

**GÖREV-8. Bütçe uyarı şeridi**
`get_budget_status` → kategori, harcama, kalan, `usedPercent`, `isNearLimit`
(%80), `isExceeded`. Aşımda `remaining` negatif gösterilir, gizlenmez.

**GÖREV-9. Tekrarlayan gider takvimi**
`get_recurring_expenses` → `isOverdue` / `isDueToday`, `dueDay` **ay sonuna
sıkıştırılmış** gelir. Arayüz tekrar hesaplamaz; backend `daysInMonth`
kuralını uygulamıştır.

### Sıra 5 — Rapor

**GÖREV-10. P&L ekranı**
`get_financial_report` → gelir/gider/net + kategori kırılımı + aylık trend.
**Aylık trend ile dönem toplamı aynı sayıyı göstermek zorunda** (çift sayım
düzeltmesi bunu garanti ediyor). Aylık grafikte **sahte sparkline yasak**
(AGENTS.md §3.2).

**GÖREV-11. Dışa aktarım**
`export_financial_report` → `csv` + `fileName`. Frontend **kaydetme** işlemini
kullanıcıya yaptırır (Tauri dialog), Rust dosya yazmaz.

**GÖREV-12. Dürüst kasa mutabakatı + açılış bakiyesi sihirbazı**
⚠️ **Bu görev backend desteği olmadan yapılamaz.** Bkz. §5-Açık Karar 1.

### Sıra 6 — Patron Şahsi

**GÖREV-13. Patron Şahsi ekranı**
`record_owner_personal` → `SERMAYE_CEKIMI` / `BORC`. DTO'nun
`excludedFromProfit` alanı **arayüzde rozet olarak gösterilir**. Aksi hâlde
patron şahsi çekimini zarar sanar.

---

## 4. Frontend için yasaklar (AGENTS.md)

- Emoji, gradient, sahte sparkline, ham hash, turuncu buton, İngilizce metin
- Emoji dışı tüm ikonlar Lucide/Phosphor, 1.5px stroke
- Görsel değişiklik: bu fazda **hiçbir** yeniden tasarım yok
- Her sayı `font-variant-numeric: tabular-nums`

## 5. Açık Kararlar (yarın netleştirilecek)

**KARAR-1. `EndOfDayContainer` açılış bakiyeleri sihirbazı ve kasa mutabakatı
backend desteği istiyor.** Bu fazda `get_net_balance` borç defterini toplar,
kasa mutabakatı (`cash_movements` vs `shifts`) karşılaştırması yeni bir komut
gerektirir. Karar: (a) Faz 9'a ekle, (b) Faz 10'a bırak.

**KARAR-2. Excel/PDF.** Plan "P&L + Excel/PDF" diyor; uygulama **CSV** üretiyor
(muhasebe programları CSV'yi doğrudan içe alır, XLSX için ek bağımlılık gerekir).
XLSX isteniyorsa ayrı bir faz işi.

**KARAR-3. WhatsApp ekstre.** Planda "kapsam dışı bırakılabilir" yazıyor;
backend'de karşılığı yok, karar bekliyor.

---

## 6. 500 Satır Kuralı — Kalan Borç (bu fazın dışında, kayıt altında)

Faz 9'da üretilen hiçbir dosya 500 satırı geçmiyor. Aşağıdakiler önceki
fazlardan kalan dosyalar; Faz 10 öncesi ele alınmalı:

| Satır | Dosya |
|---|---|
| 944 | `backend/src/db.rs` |
| 914 | `backend/src/platform_commands.rs` |
| 720 | `backend/src/services/audit_service.rs` |
| 695 | `backend/src/management_commands.rs` |
| 611 | `backend/src/services/modifier_service_tests.rs` |
| 534 | `backend/src/services/payment_approval_tests.rs` |
| 511 | `backend/src/services/reservation_service.rs` |
| 504 | `backend/src/services/modifier_service.rs` |
