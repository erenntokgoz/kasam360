# FAZ 9 (FRONTEND) — DETAYLI ANALİZ VE GÖREV LİSTESİ

> Bağlam: `docs/FAZ-9-HANDOVER.md` backend teslimini kanıtlar. Bu belge
> **arayüz** işinin analizini ve adım adım görev listesini içerir.
> Kural: her adımda kapı kanıtı alınır, bir sonraki adıma geçilir.

---

## A. ANALİZ

### A.1 Mevcut arayüz envanteri

| Dosya | Satır | Durum |
|---|---|---|
| `endofday/EndOfDayContainer.tsx` | 1650 | ❌ 500 sınırını 3,3× aşıyor |
| `endofday/ui/DirectoriesTab.tsx` | 413 | ⚠️ 5 rehber tek dosyada |
| `endofday/ui/DebtsBalanceTab.tsx` | 448 | ⚠️ yeni ekstre eklenince sınırı aşar |
| `endofday/ui/ExpensesTab.tsx` | 233 | ✓ |
| `endofday/ui/FinancialReportsTab.tsx` | 331 | ⚠️ yeni export + mutabakat eklenince aşar |
| `endofday/ui/QuickTransactionModal.tsx` | 354 | ✓ |
| `ledger/ReceiptViewerModal.tsx` | 394 | ✓ |
| `ledger/LedgerReceiptMovements.tsx` | 192 | ✓ |

### A.2 Kritik kısıt: `endOfDayGlassUi.test.ts` render zinciri

Bu test **kaynak dosyayı değil, render edilmiş HTML'i** doğrular
(`renderToString(EndOfDayContainer)` → `html`). Bu, bölme işlemini güvenli
kılar: bileşen ağacı aynı sırada render edildiği sürece HTML değişmez.
Buna karşılık **type export'ları dosyadan okunuyor**: test
`DailySummaryDto, OpenShiftDto, ShiftHistoryDto, CloseDayResultDto`
tipini `EndOfDayContainer`'dan import ediyor. Tipler ayrı dosyaya taşınırsa
bu import kırılır → **public API korunmalı, `export type` ile yeniden
yayınlanmalı.**

### A.3 Backend sözleşmesi (hazır, 9 komut)

`get_net_balance`, `record_veresiye_settlement`, `get_directory_statement`,
`print_payment_receipt`, `get_budget_status`, `get_recurring_expenses`,
`get_financial_report`, `export_financial_report`, `record_owner_personal`.

`tauriInvoke` `actor_role`/`actorId`/`tenant_id` alanlarını otomatik enjekte
eder → frontend'de `tenantId` geçirmek zorunlu değil, geçirilirse tutarlı olmalı.

### A.4 Kararlar (kullanıcıdan bağımsız alınan)

| # | Karar | Gerekçe |
|---|---|---|
| K-1 | Excel/PDF yerine **CSV** | XLSX ek bağımlılık; muhasebe programları CSV içe alır |
| K-2 | Kasa mutabakatı + açılış bakiyesi Faz 9'a dahil | Faz 10 rapor merkezi bu veriye dayanıyor; sonraya bırakılırsa çift iş |
| K-3 | WhatsApp ekstre **kapsam dışı** | Plan "kapsam dışı bırakılabilir" diyor; ayrı entegratör gerektirir |
| K-4 | Patron Şahsi P&L'e girmez, DTO `excludedFromProfit` taşır | UI'da rozet zorunlu; aksi hâlde şahsi çekim zarar sanılır |
| K-5 | Makbuz metni frontend'de **düzenlenmez** | `lines` dizisi veritabanından türetilmiş kanıttır |

---

## B. GÖREV LİSTESİ (adım adım, atlama yok)

### B0 — Bölme (bloklayıcı, diğer her adım buna bağlı)

| # | Adım | Kabul kriteri |
|---|---|---|
| 0.1 | `types.ts`: DTO'lar + `TabType` + `Props` taşınır | `EndOfDayContainer` `export type` ile yeniden yayınlar; `tsc` 0 |
| 0.2 | `helpers.ts`: `formatCurrency`, `formatDateTime`, `isSameCalendarDay`, DTO alan okuyucuları | Davranış bit düzeyinde aynı; `vitest` 386 PASS |
| 0.3 | `ui/HeaderActions.tsx`: 585-746 (eylem butonları + segment sekmeler) | Render sırası korunur |
| 0.4 | `ui/ScoreCards.tsx`: 751-827 (4 skor kartı + fiş hareketleri) | Aynı sınıflar |
| 0.5 | `ui/PaymentDistribution.tsx`: 830-927 | Aynı sınıflar |
| 0.6 | `ui/ShiftBoard.tsx`: 928-1077 | Aynı sınıflar |
| 0.7 | `ui/DayClosePanel.tsx`: 1078-1190 | Aynı sınıflar |
| 0.8 | `ui/ArchivePanel.tsx`: 1191-1337 | Aynı sınıflar |
| 0.9 | `ui/CloseDayModal.tsx`: 1358-1456 | Aynı sınıflar |
| 0.10 | `ui/ZReportModal.tsx`: 1457-1635 | Aynı sınıflar |
| 0.11 | Container ≤ 400 satır | `wc -l` kanıtı |
| 0.12 | Kapı: `tsc` 0 + `vitest` 386 PASS + **emoji/gradient taraması 0** | Konsol çıktısı |

### B1 — Beş ayrıştırılmış rehber

| # | Adım |
|---|---|
| 1.1 | `DirectoryGuide.tsx`: `directory.type` → 5 dal (CUSTOMER/SUPPLIER/STAFF/FIXED_EXPENSE/OWNER_PERSONAL) |
| 1.2 | Her dalın alan listesi ayrı sabit tablosunda (alan kaydırma testi için) |
| 1.3 | `DirectoriesTab.tsx` 413 → rehber başına bölünür, 500 altı |
| 1.4 | Test: 5 tipin her biri doğru alanları gösterir |

### B2 — Net bakiye şeridi + vade rozetleri

| # | Adım |
|---|---|
| 2.1 | `NetBalanceStrip.tsx`: `get_net_balance` → tek sayı + 5 hesap sütunu |
| 2.2 | Patron Şahsi sütunu "Sermaye çekimi" etiketi (alacak değil) |
| 2.3 | `tabular-nums` zorunlu (AGENTS.md §4.6) |
| 2.4 | `DueBadge.tsx`: renk + Lucide ikon + **metin**. Emoji yasak (Ç-1) |
| 2.5 | Rozet metni tek başına bilgi taşır; renk tek başına asla |
| 2.6 | Test: emoji yok, metin var |

### B3 — Ekstre + makbuz + tahsilat

| # | Adım |
|---|---|
| 3.1 | `DirectoryStatement.tsx`: açılış → satırlar → kapanış |
| 3.2 | İmzalı tutarlar DTO'nun `*Label` alanından gelir; frontend yeniden biçimlemez |
| 3.3 | `print_payment_receipt` → `lines` **olduğu gibi** basılır |
| 3.4 | Kısmi tahsilat / tam kapatma akışı `pay_debt` üzerinden |
| 3.5 | Test: ekstresi olan müşteride satır sırası ve kapanış bakiyesi |

### B4 — Bütçe + tekrarlayan işlemler

| # | Adım |
|---|---|
| 4.1 | `BudgetAlerts.tsx`: `isNearLimit` (%80) ve `isExceeded` |
| 4.2 | Aşımda kalan bakiye **negatif** gösterilir, gizlenmez |
| 4.3 | `RecurringSchedule.tsx`: `isOverdue` / `isDueToday` |
| 4.4 | `dueDay` backend'de sıkıştırılmış gelir; frontend tekrar hesaplamaz |
| 4.5 | Test: %80 eşiği ve ay sonu sıkıştırma değerleri |

### B5 — P&L + export + kasa mutabakatı

| # | Adım |
|---|---|
| 5.1 | `ProfitAndLoss.tsx`: gelir/gider/net + kategori kırılımı + aylık trend |
| 5.2 | **Trend ile dönem toplamı aynı sayıyı göstermeli** (çift sayım düzeltmesi bunu garanti eder) |
| 5.3 | Sahte sparkline/anlamsız SVG wave yasak (AGENTS.md §3.2) |
| 5.4 | `export_financial_report` → CSV; dosya kaydetme Tauri dialog ile kullanıcıda |
| 5.5 | `CashReconciliation.tsx`: **dürüst** mutabakat — beklenen vs sayılan, fark açıkça |
| 5.6 | Mutabakat backend komutu gerektirir → önce backend, sonra UI |

### B6 — Patron Şahsi

| # | Adım |
|---|---|
| 6.1 | `OwnerPersonalPanel.tsx`: `SERMAYE_CEKIMI` / `BORC` |
| 6.2 | `excludedFromProfit` rozeti **zorunlu** |
| 6.3 | Yalnız `OWNER` rolüne görünür |

### B7 — Faz kapıları

| # | Adım |
|---|---|
| 7.1 | `npx tsc --noEmit` → 0 |
| 7.2 | `npx vitest run` → 100% PASS |
| 7.3 | Emoji taraması → 0 |
| 7.4 | Gradient taraması → 0 |
| 7.5 | Satır sayısı denetimi → hiçbiri > 500 |
| 7.6 | Faz raporu |