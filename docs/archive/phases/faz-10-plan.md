# FAZ 10 — RAPOR & ANALİZ MERKEZİ (DETAYLI ANALİZ + GÖREV LİSTESİ)

> Bağlam: Faz 9 (`f9e892c`) tamamlandı. Bu belge Faz 10'un analizini ve
> adım adım görev listesini içerir.
> Spec referansı: `docs/PLAN-SPEC-IMPLEMENTATION.md` §4 Faz 10 → Spec §2.4.

---

## 1. ANALİZ

### 1.1 Mevcut rapor altyapısı

| Katman | Durum |
|---|---|
| `backend/src/services/report_service.rs` | `sales_report`, `shift_report`, `receipts_report`, `adjustments_report` **VAR** |
| `backend/src/services/pnl_service.rs` | Faz 9 P&L çift sayım düzeltmesi **VAR** |
| `backend/src/analytics_commands.rs` | `get_analytics_dashboard_data` **VAR** (tek komut) |
| `desktop/.../reports/ReportsHub.tsx` | 4 sekme (Özet/Fişler/Vardiyalar/İptaller) **VAR** |
| `desktop/src/domain/usecases/analytics/*.ts` | `IntelligenceEngine`, `AnomalyDetector`, `RollingStatsCalculator` — **BAĞLANMAMIŞ ÖLÜ KOD** |

### 1.2 Spec §2.4 istenen 11 analitik — veri kaynağı denetimi

| # | Analitik | Veri kaynağı | Karar |
|---|---|---|---|
| 1 | BCG matrisi | `order_items` (hacim) + `inventory_batches.unit_cost_cents` (marj) | **UYGULA** — yeni tablo yok |
| 2 | Ürün kâr marjı | `inventory_batches` ortalama birim maliyet + `order_items.total_cents` | **UYGULA** |
| 3 | Kombinasyon | `order_items.order_id + product_id` | **UYGULA** |
| 4 | Yoğun saat | `orders.created_at` (`strftime`) | **UYGULA** |
| 5 | Aylık hedef | **tablo YOK** | **UYGULA** — yeni tablo `monthly_targets` |
| 6 | Rakip fiyat | **tablo YOK** | **UYGULA** — yeni tablo `competitor_prices` |
| 7 | Kategori hacim | `report_service::category_volumes` | **ZATEN VAR** — yeniden kullan |
| 8 | Ödeme yöntemi kırılımı | `report_service::payment_method_shares` | **ZATEN VAR** — yeniden kullan |
| 9 | Garson karnesi | `orders.cashier_id` **yazılmıyor**, bahşiş tablosu yok | **BİR SONRAKİ FAZA BORÇ** (bkz. §3) |
| 10 | Masa devir süresi | `tables.opened_at` var, **kapanış anı kaydedilmiyor** | **BİR SONRAKI FAZA BORÇ** (bkz. §3) |
| 11 | İptal/zayi oranı | `order:voided` audit **VAR**; `stock:waste` yazma yolu **YOK** | **KISMİ** — void oranı uygula (bkz. §3) |

### 1.3 Kritik kısıt: maliyet kaynağı

`products` tablosunda `cost_cents` **yoktur**. Maliyet tek gerçek kaynaktan
gelir: `inventory_batches.unit_cost_cents` (FIFO partileri, AGENTS.md §2).
BCG ve kâr marjı bu kaynaktan türetilir; **uydurma maliyet veya `* 0.35`
formülü kullanılmayacaktır.** Ürünün partisi hiç yoksa maliyet `null` döner
ve marj "Bilinmiyor" olarak gösterilir — sıfır sanılmaz (AGENTS.md §3.4).

### 1.4 Kritik kısıt: ölü kod

`desktop/src/domain/usecases/analytics/` altındaki 3 dosya (1245 satır)
hiçbir ekran tarafından import edilmiyor ve **float `amount` + `$$` / İngilizce
metin** üretiyor (AGENTS.md §2 float yasağı, §3.2 İngilizce metin yasağı).
Bu modüller **kullanılmayacaktır**; Faz 10 mantığı Rust tarafında, kuruş
(`*_cents`) ve Türkçe metinle yeniden yazılır. Ölü kod bu fazda silinir.

### 1.5 DTO konvansiyonu kararı

`report_service` DTO'ları **snake_case**; Faz 9 ledger komutları camelCase.
Faz 10 `report_service` konvansiyonunu (snake_case) izler; frontend
`reportTypes.ts` ile birebir eşleşir. Böylece `ReportsHub` içinde iki farklı
adlandırma düzeni bir arada bulunmaz.

---

## 2. GÖREV LİSTESİ (adım adım, atlama yok)

### B0 — Temizlik (bloklayıcı)

| # | Adım | Kabul kriteri |
|---|---|---|
| 0.1 | `desktop/src/domain/usecases/analytics/` ölü kodunu sil | `tsc` 0; dosya referansı kalmaz |
| 0.2 | Rapor/analitik ağırlık merkezini `services/mod.rs` + `lib.rs` kaydet | `cargo check` 0 |

### B1 — Şema (yeni tablolar)

| # | Adım | Kabul kriteri |
|---|---|---|
| 1.1 | `monthly_targets` tablosu (`tenant_id`, `month`, `target_cents`, `category`, UNIQUE(tenant, month, category)) | `schema.sql` uygulanır |
| 1.2 | `competitor_prices` tablosu (`tenant_id`, `product_id`, `competitor_name`, `price_cents`, `observed_at`) | `schema.sql` uygulanır |

### B2 — Backend analitik servisi

| # | Adım | Kabul kriteri |
|---|---|---|
| 2.1 | `analytics_service.rs`: `product_margins` (FIFO ortalama maliyet) | Test: partisi olmayan ürün `null` marj |
| 2.2 | `bcg_matrix`: medyan eşikli 2×2 sınıflandırma | Test: 4 köşe + eşik kenarı durumu |
| 2.3 | `combinations`: aynı siparişte birlikte satılan çiftler, destek sayısı eşiği | Test: destek < eşik elenir |
| 2.4 | `peak_hours`: saatlik ciro/sipariş kova | Test: kiracı izolasyonu |
| 2.5 | `monthly_target_status`: hedef vs gerçekleşen | Test: hedef yoksa "hedef tanımlı değil" |
| 2.6 | `competitor_price_gaps`: bizim fiyat vs rakip farkı | Test: negatif fark = biz daha pahalı |
| 2.7 | `void_loss_rate`: void edilen ciro / toplam ciro | Test: void yoksa 0 değil `null` |
| 2.8 | **Sessiz hata yasağı**: her toplam `?` ile yükseltilir | Test: kırık kolon → `Err` |

### B3 — Backend komutları

| # | Adım | Kabul kriteri |
|---|---|---|
| 3.1 | `get_analytics_metrics` (tek komut, 7 metrik) | `cargo check` 0 |
| 3.2 | `set_monthly_target`, `set_competitor_price` (OWNER yetkisi) | YETKİSİZ rol → `Err` |
| 3.3 | `lib.rs` `generate_handler!` kaydı | Komut erişilebilir |

### B4 — Frontend

| # | Adım | Kabul kriteri |
|---|---|---|
| 4.1 | `reportTypes.ts`: 7 yeni DTO tipi (snake_case) | `tsc` 0 |
| 4.2 | `useReportsHub`: `get_analytics_metrics` kancası, kısmi hata politikası | Hata mesajı gösterilir |
| 4.3 | `AnalyticsTab.tsx`: BCG 2×2 + marj tablosu + kombinasyon + yoğun saat | Bileşen ≤ 300 satır |
| 4.4 | `TargetAndCompetitorPanels.tsx`: hedef + rakip fiyat yazma/okuma | ≤ 300 satır |
| 4.5 | `ReportsHub`'a "Analiz" sekmesi | Sekme çalışır |
| 4.6 | `tauriInvoke.ts` browserMock + `requireReportGate` kırılımı | Mock eşleşir |
| 4.7 | Test: DTO alan adları backend ile birebir | Test PASS |

### B5 — Faz kapıları

| # | Adım |
|---|---|
| 5.1 | `cargo check --all-targets` → 0 |
| 5.2 | `cargo test` → 100% PASS |
| 5.3 | `npx tsc --noEmit` → 0 |
| 5.4 | `npx vitest run` → 100% PASS |
| 5.5 | Emoji taraması → 0 |
| 5.6 | Gradient taraması → 0 |
| 5.7 | Yeni/uygulanan dosyalar < 500 satır |
| 5.8 | Faz raporu |

---

## 3. BİLEREK ertelenen işler (gerekçesiyle)

Spec §2.4'te istenen 3 analitik bu fazda **yapılmadı**. Gerekçe: hepsi
**yeni yazma yolu** gerektiriyor (sadece okuma değil), ve bu yollar
FIFO/ödeme/kağıt para hareketlerinin kilitlerine dokunuyor. Yanlış yazma
yolu eklemek AGENTS.md §9 kilitlerini zedeler. Borç, ilgili fazın
devamında kapatılacak:

| # | Analitik | Eksik olan | Hangi fazda |
|---|---|---|---|
| 9 | Garson karnesi | `orders.cashier_id` **yazılmıyor**; bahşiş tablosu yok | Faz 11 (Personel 360°) |
| 10 | Masa devir süresi | `tables` kapanış anı kaydedilmiyor | Faz 13 (Kroki Çizim) |
| 11 | İptal/zayi (zayi payı) | `stock:waste` yazma yolu yok | Faz 12 (Menü & Stok) |

Bu fazda #11'in **void** kısmı uygulanır (veri mevcut); **zayi** kısmı ertelenir.

---

## 4. RİSK

| Risk | Etki | Azaltma |
|---|---|---|
| `inventory_batches` boşsa tüm marj boş | BCG ve marj ekranı boş görünür | `null` gösterilir, 0 uydurulmaz; boş durum metni |
| `schema.sql` değişikliği mevcut DB'yi bozar | Açılış hatası | Yalnız `CREATE TABLE IF NOT EXISTS` eklenir |
| Ölü kod silinmesi bir ekranı kırar | Derleme hatası | 0.1'de `tsc` kapısı; import zinciri önce doğrulanır |