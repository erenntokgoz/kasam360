# FAZ 7 — FINAL RAPORU

**Kapsam:** Fişin ayrı bir varlık olmaktan çıkarılması — tek finansal gerçekliği
`events` tablosundaki `SALE_SETTLED` tahsilat kaydıdır. Hesap Defteri'ne
"Fişi Görüntüle" akışı eklenmesi ve bağımsız **Fişler ekranının kaldırılması**.
Fiş dışı termal basımların (Z-Rapor, kasa fişi, adisyon, void) keyfi JSON yerine
veritabanı kaynaklı komutlara taşınması.

**Tarih:** 2026-10-02
**Durum:** B1–B6 tamamlandı, tüm zorunlu kapılar geçti.

---

## 1. Ne değişti

### 1.1 Fiş = tahsilat kaydının görünümü

| Önce | Sonra |
|---|---|
| `orders` + paralel `events` türetimi, `fetch_receipts_for_tenant` | tek kaynak: `aggregate_type='SALE'` + `event_type='SALE_SETTLED'` |
| Tahsilatı olmayan sipariş listede "COMPLETED" görünüyordu | Tahsilatı olmayan sipariş **fişsizdir** ve listede gelmez |
| Alt toplam/KDV istemcide `total * 100/110` ve `total * 0.1` ile uyduruluyordu | Kalem satırlarından **toplanır**; kalem yoksa `has_items = false` ve alt toplam/KDV `0` |

- Fiş numarası (`fiscal_receipt_no`) tahsilat kimliğinden türetilir:
  `FISC-` + `transaction_id` ilk 6 karakteri. İstemci numarayı değiştiremez.
- `ReceiptDto` genişletildi: `transaction_id`, `fiscal_receipt_no`, `order_id`,
  `has_items`, `tendered_cents`, `change_cents`, `payment_method`.
- Kalem kaydı olmayan tahsilatta termal çıktı
  “Kalem kaydı yok; yalnız tahsilat toplamı geçerlidir.” der; oran uydurmaz.

### 1.2 Backend

```
backend/src/services/receipt_service.rs        (491 satır — tek fiş kaynağı)
backend/src/services/receipt_service_tests.rs  (488 satır — 15 test)
backend/src/print_commands.rs                  (432 satır — 5 basım komutu)
backend/src/print_commands_tests.rs           (142 satır — 4 test)
```

`receipt_service` API'si:

| Fonksiyon | Sözleşme |
|---|---|
| `list` | tenant + tarih aralığı + limit (varsayılan 200, maks. 500) |
| `find` | tek tahsilat; başka tenant'ta `None` |
| `exists` | yalnız "var mı" kontrolü (bulunmayan kayıt `false`) |
| `fiscal_receipt_no` | `FISC-<6 karakter>` türetimi |
| `list_financial_movements` | `SALE_PAYMENT` / `CASH_MOVEMENT` / `DEBT_PAYMENT` ayrımı |

Ledger sınıflandırması:

| Hareket | `receipt_id` | `fiscal_receipt_no` |
|---|---|---|
| `SALE_SETTLED` → `SALE_PAYMENT` | dolu | dolu |
| Kasa giriş/çıkış → `CASH_MOVEMENT` | `null` | `null` |
| Cari tahsilat → `DEBT_PAYMENT` | `null` | `null` |

### 1.3 Basım komutları: keyfi JSON yasaklandı

**Önceki `print_receipt(order)` imzası**, çağıranın gönderdiği serbest alanları
yazıcıya aktarıyordu; bu hem yetkisiz hem de veritabanında karşılığı olmayan mali
belge üretmeye yol açıyordu. Fiş artık yalnız tahsilattan basılır:

| Komut | İmza | Kaynak |
|---|---|---|
| `print_receipt` | `receipt_id, actor_role, tenant_id` | tahsilat kaydı (`SALE_SETTLED`) |
| `print_z_report` | `shift_id, actor_role, tenant_id` | `shifts` + `audit_ledger` |
| `print_day_z_report` | `actor_role, tenant_id` | günlü `orders` + `audit_ledger` + `cash_movements` |
| `print_cash_slip` | `movement_id, actor_role, tenant_id` | `cash_movements` |
| `print_order_slip` | `order_id, actor_role, tenant_id` | `orders` + `order_items` |
| `print_void_slip` | `table_id, actor_role, tenant_id` | masanın iptal edilmiş siparişi |
| `get_active_order_id` | `table_id, tenant_id` | masanın açık siparişi |

- Tümü `OWNER / MANAGER / CASHIER` rolleriyle sınırlıdır; `tenant_id` zorunludur
  (fail-closed), başka işletmenin kaydı `NOT_FOUND` döner.
- Tutar biçimlendirme tam sayı kuruş üzerinden yapılır (`fmt_cents`); basım
  satırlarında float aritmetiği yoktur.
- ESC/POS düzeni (başlık / kalem tablosu / toplam / barkod / “MALİ DEĞERİ YOKTUR”)
  korundu; yalnız **veri kaynağı** değişti.

Migre edilen çağrı noktaları: `CashierWorkstationContainer` (Z, X, kasa, void,
adisyon, tahsilat, kopya fiş), `EndOfDayContainer` (gün ve vardiya Z-Raporu),
`FloorPlanContainer` (adisyon), `ReportTables` (rapor fişi),
`TauriPOSRepository.printReceipt(receiptId)` + `IPOSRepository` imzası.

### 1.4 Frontend

| Dosya | Satır | Rol |
|---|---|---|
| `presentation/types/ledger.ts` | 90 | Faz 7 DTO sözleşmesi (`ReceiptDto`, `FinancialMovementDto`, `formatCents`) |
| `presentation/components/ledger/LedgerReceiptMovements.tsx` | 192 | Hesap Defteri'ndeki hareket tablosu + “Fişi Görüntüle” |
| `presentation/components/ledger/ReceiptViewerModal.tsx` | 394 | Fiş penceresi (sipariş & kalemler / 80mm termal önizleme) |

- Panelde her satır ya **“Fişi Görüntüle”** düğmesi ya da **“Fiş yok”** yazar;
  fişi olmayan hareket sessizce geçmez.
- Tarih aralığı (Bugün / Son 7 gün / Son 30 gün) `buildPresetRange` ile **yerel
  gün sınırlarından** üretilir; UTC'ye kayma yoktur.
- Rol ve tenant oturumdan (`useAuthStore`) gönderilir; bileşen kendi kafasında
  tenant taşımaz.

### 1.5 Bağımsız Fişler ekranı kaldırıldı

| Silinen | Değişiklik |
|---|---|
| `presentation/components/receipts/` (1.265 satır) | klasör tamamen silindi |
| `App.tsx` | `currentView === 'RECEIPTS'` dalı kaldırıldı |
| `GlobalNav.tsx` | “Fişler” gezinme öğesi ve `Receipt` ikonu kaldırıldı |
| `useCartStore.ts` | `RECEIPTS` görünüm birliğinden çıkarıldı |
| `navigationMatrix.ts` | `RECEIPTS` yetkileri ve öncelik listesinden çıkarıldı |

Fişe erişim artık `ledgerAccess` yetkisi olan Hesap Defteri içinden
tahsilat satırı üzerinden yapılır.

### 1.6 Bulunan ve düzeltilen güvenlik/işlev hataları

| Bulgu | Düzeltme |
|---|---|
| `matchesTenant` tenant bilinmiyorsa `true` dönüyordu (fail-open sızıntı) | `matchesTenantStrict` eklendi; fiş/ledger/sipariş/kasa yolları katı eşleşme kullanıyor |
| `get_order_items` filtresiz SQL ile çalışıyordu | `tenant_id` zorunlu parametre + tenant filtresi |
| Ledger bileşenleri rol/tenant göndermiyordu (fail-closed komutlar reddediyordu) | `useAuthStore` üzerinden oturumdan gönderiliyor |
| Tüm basım çağrıları keyfi JSON gönderiyordu | 6 komuta geçirildi, `print_receipt` yalnız tahsilat |
| `cash_in`/`cash_out` mock'u hareket kimliği döndürmüyordu | mock artık kaydeder ve kimlik döndürür (`print_cash_slip` çalışır) |
| EndOfDay Z-Raporu ekranda hesaplanan tutarları basıyordu | vardiya/gün belgesi DB'den basılır |

---

## 2. Testler ve kapılar

```
backend:  cargo check --all-targets   →  0 hata, 0 uyarı
backend:  cargo test                 →  193 passed; 0 failed
desktop:  npx tsc --noEmit            →  0 hata
desktop:  npx vitest run              →  33 dosya, 372 passed; 0 failed
playwright: ledger-receipt.spec.ts    →  2 passed (chromium)
```

Yeni test kapsamı:

- `receipt_service_tests.rs` (15 test): tenant izolasyonu, tek tahsilat → tek fiş,
  tahsilatsız sipariş → fiş yok, KDV/ödeme yöntemi uydurmama, ledger hareket
  ayrımı, servisin değişmezliği.
- `print_commands_tests.rs` (4 test): kuruş biçimlendirme, kasa hareketi tenant
  izolasyonu, günlük Z-Rapor türetimi, kapı sırası (rol → tenant, fail-closed).
- `ledgerReceiptContract.test.ts` (7 test): tarih aralığı zorunluluğu, tenant
  izolasyonu, `has_items = false` durumunda oran uydurmama, biçimlendirme.
- `cashierWorkstation.test.ts`: basım komutları kayıt + rol + tenant kapılarıyla.
- `zeroGapFeatureMatrix.test.ts`: C4 artık keyfi belge reddini, C5 günlük defter
  Z-Raporu basımını doğruluyor.

Statik taramalar (yeni/k touched dosyalarda): emoji `0`, `bg-gradient` `0`,
`: any` `0`. Kalan emoji eşleşmeleri Faz 7 kapsamı dışındaki mevcut dosyalardadır
(`platform/PlatformSetupWizard.tsx`, `endofday/ui/DirectoriesTab.tsx`).

---

## 3. Kanıtlar

| Dosya | İçerik |
|---|---|
| `docs/evidence/faz7-ledger-movements.png` | Hesap Defteri'ndeki “Finansal Hareketler ve Fişler” paneli: tahsilat satırı **Fişi Görüntüle**, kasa satırı **Fiş yok** |
| `docs/evidence/faz7-receipt-viewer.png` | Açılan fiş penceresi: sipariş özeti, kalem tablosu, genel toplam |
| `docs/evidence/faz7-receipt-thermal.png` | Aynı fişin 80mm termal önizlemesi (`FISC-…` numarasıyla) |

Playwright kanıtı (`tests/e2e-playwright/ledger-receipt.spec.ts`):

1. Gezinme çubuğunda **Fişler** öğesi yoktur (ayrı ekran kaldırıldı).
2. Hesap Defteri'nde panel görünür; tam olarak 1 adet “Fişi Görüntüle” ve
   1 adet “Fiş yok” satırı bulunur (tohumlanmış tahsilat + kasa hareketi).
3. Fiş penceresi açılır, `185,00 ₺` toplamı görünür, termal sekmede
   `FISC-txn_l` numarası görünür, pencere kapatılır.

---

## 4. Bilinen borç (Faz 7 dışı, dokunulmadı)

- `platform/PlatformSetupWizard.tsx` ve `endofday/ui/DirectoriesTab.tsx` içinde
  emoji içeren metinler var (AGENTS.md §3.2 ihlali, önceki fazlardan kalma).
- `EndOfDayContainer.tsx` hâlâ 500 satır sınırının üzerinde (1650 satır); Faz 7
  eklenen panel ayrı bileşen olarak tutuldu, ileride bölünme gerekiyor.
- `tauriInvoke` mock'unun `get_daily_summary` çıktısı hâlâ ödeme dağılımını
  oranla üretir (`%40/%60`); bu değer Faz 7'de kullanılmıyor ancak kaynak
  veriden türetilmelidir.