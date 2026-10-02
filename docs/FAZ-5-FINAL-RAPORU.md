# FAZ 5 — FINAL RAPORU

**Kapsam:** `OwnerSalesTab` ve `ReportsPanel` yüzeylerinin kaldırılması; tenant'a
daraltılmış, tarih aralığı zorunlu **tek rapor merkezinin** (`ReportsHub`)
kurulması; iptal/iade/zayi + onaylayan kayıtlarının rapora girmesi ve
CSV/Excel/yazdırma dışa aktarımının tek çekirdekten yürütülmesi.

**Tarih:** 2026-10-02
**Durum:** B1–B6 tamamlandı, tüm zorunlu kapılar geçti.

---

## 1. Ne değişti

### 1.1 İki rapor yüzeyi yerine tek merkez

| Silinen dosya | Satır | Yerine |
|---|---|---|
| `owner/ui/OwnerSalesTab.tsx` | 592 | `reports/ReportsHub.tsx` |
| `management/ui/ReportsPanel.tsx` | 603 | `reports/ReportsHub.tsx` |

- `OwnerDashboardContainer`: `sales` ve `reports` sekmeleri **tek `reports`
  sekmesine** indirgendi ("Satışlar" ve "Operasyonel Raporlar" ayrı ekranlarda
  aynı veriyi farklı filtrelerle gösteriyordu).
- `ManagementContainer`: `reports` sekmesi doğrudan `ReportsHub`.
- Patron Portalı gösterge paneli artık `get_analytics_dashboard_data`'yı
  **"bugün" aralığıyla** çağırır; tarih seçimi olan her rapor `ReportsHub`'tadır.

### 1.2 Backend: tek veri katmanı, tek komut kapısı

```
backend/src/services/report_service.rs        (447 satır — dört rapor bölümü)
backend/src/services/report_service_tests.rs  (494 satır — 13 test)
backend/src/report_commands.rs                (181 satır — 4 komut + 6 test)
```

| Komut | İçerik | Kapı |
|---|---|---|
| `get_sales_report` | ciro, sipariş, ortalama sepet, iptal toplamı, ödeme yöntemi, kategori hacmi | `require_reporting` + tenant + aralık |
| `get_shift_report` | vardiya satırları (kasiyer adı JOIN ile) | aynı + `limit` 1..500 |
| `get_receipts_report` | fiş satırları, kalem sayısı ve kalem toplamı **tek sorguda** | aynı + `limit` 1..500 |
| `get_adjustments_report` | iptal/iade/zayi + **kim onayladı** + kaydı bulunmayan türler | aynı |

- Aralık **zorunludur**: "tüm zamanlar" filtresiz tarama demektir, kabul edilmez.
  Ters aralık reddedilir (sessizce "0 satır" dönmek yerine hata verilir).
- MASTER rapor merkezine giremez (`require_reporting` yalnız OWNER/MANAGER).

### 1.3 Frontend: tek veri katmanı, tek dışa aktarım

```
presentation/components/reports/
  ├── ReportsHub.tsx              (200) orkestratör: aralık + sekmeler + dışa aktarım
  ├── ReportRangeBar.tsx          (137) hazır aralıklar + özel tarih aralığı
  ├── ReportSummaryCards.tsx      (110) ciro / sipariş / ortalama sepet / fiş
  ├── ReportDistributions.tsx     (124) ödeme yöntemi + kategori hacmi
  ├── ReportTables.tsx            (258) fiş + vardiya tabloları
  ├── ReportAdjustmentsTable.tsx  (169) iptal/iade/zayi + onaylayan
  ├── reportTypes.ts              (190) backend DTO'ları + tarih yardımcıları
  ├── useReportsHub.ts            (148) tek kanca, dört komut paralel
  └── export/
      ├── reportExport.ts         (121) kuruş→metin, CSV kaçışı, BOM, dosya adı
      └── reportExportActions.ts  (211) dört bölümün kolon tanımları
```

- Dışa aktarım: **CSV** (`;` değil, `,`), **Excel** (`;` ayraç + `,` ondalık),
  **Yazdır/PDF** (`@media print` + tarayıcı "PDF olarak kaydet"). PDF kütüphanesi
  eklenmedi.
- Dört bölüm tek tuşla dışa aktarılır (4 dosya); boş bölüm "durum" satırıyla
  indirilir, uydurma satır üretilmez.
- `AppleGlassCard` `forwardRef` + `displayName` aldı (AGENTS.md §10): rapor ekranı
  ref hedefi olarak kullanılıyordu ve kart ref'i iletemiyordu.

---

## 2. Güvenlik bulguları

### 2.1 Çözülen açıklar

| # | Açık | Etki | Sonuç |
|---|---|---|---|
| 1 | `get_receipts` rol **ve** tenant almıyordu; `orders`, `users`, `tables`, `events` filtresiz okunuyordu | Herhangi bir oturum tüm işletmelerin fişlerini, kasiyer adlarını ve ödeme yöntemini görebiliyordu | `fetch_receipts_for_tenant` tek tenant'a daraltıldı; komut `require_any_present(OWNER, MANAGER, CASHIER)` + fail-closed tenant |
| 2 | `get_shift_history` parametresiz tüm vardiyaları döküyordu (beklenen/gerçek kasa tutarları) | Kasa beklenen ve gerçek nakit tüm işletmeler için açıktı | Tenant zorunlu + rol kapısı + `WHERE tenant_id = ?` |
| 3 | `get_analytics_dashboard_data` tenant'sızdı **ve** `popular_categories` sabit sayılarla dolduruluyordu (`Ana Yemekler: 12`, `İçecekler: 8`) | Çapraz işletme sızıntısı **+** uydurma veri (AGENTS.md §12 ihlali) | Komut yeniden yazıldı: tenant + zorunlu aralık + gerçek `order_items → products → categories` dağılımı |
| 4 | Rapor ekranları `get_daily_summary` / `get_receipts` / `get_shift_history` karışımıyla besleniyordu | Tek ekranda üç farklı kapsam, üç farklı filtre | Dördü de tek sözleşmeye (`report_commands`) bağlandı |
| 5 | `get_receipt_details` tüm fişleri okuyup tek tek arıyordu | Her çağrıda sınırsız tablo taraması | Tenant-scoped `fetch_receipts_for_tenant` üzerinden filtreleme |

### 2.2 Derinleştirme (deletion test / locality / leverage)

- Fiş raporunda **N+1 kaldırıldı**: `COUNT(oi.id)` ve `SUM(oi.total_cents)` tek
  sorguda geliyor (`order_items` JOIN), fiş başına ayrı sorgu yok.
- Kategori hacmi SQL'de hesaplanıyor; arayüz yalnız gösteriyor (aynı hesabı iki
  yerde yapma riski kalktı).
- Ödeme yöntemi yüzdesi raporun kendi hesabından geliyor; arayüz yeniden
  hesaplamıyor ve `totalMethodsSum || 1` gibi sıfır bölen kısaltmalarını kullanmıyor.

### 2.3 Kalan değerlendirme

**HIGH güvenle doğrulanmış açık yok.** Tüm rapor sorguları `tenant_id` ile
daraltılmış, tüm rapor komutları `require_reporting` kapılı, aralık zorunlu ve
satır sayısı sınırlı. Kasiyer için `get_shift_history` kendi vardiyasıyla
sınırlı değildir (gün sonu mutabakatı bu yüzden `ALL` istiyor); çapraz işletme
sızıntısı kapatıldı, kapsam daraltması ayrı yetki kararı olarak bırakıldı.

---

## 3. Test kanıtı

### Backend

```
cargo check --all-targets   → Finished `dev` profile (uyarısız)
cargo test                  → 153 passed; 0 failed
```

Faz 4: 131 → Faz 5: **153** (+13 rapor servisi, +6 rapor komutu, +3 gösterge).

`report_service_tests.rs` bu turda bulunan dört test/şema uyumsuzluğunu düzeltti
(hepsi test altyapısıydı, üretim kodu değil):

1. `audit_ledger` trigger'ları `previous_hash`'in **zincir ucuyla aynı** ve 64
   karakter SHA-256 onaltılık olmasını zorunlu tutuyor; seed artık ucu okuyup
   bağlıyor.
2. `order_items` test kimliği `it_<order>` idi → iki kalem aynı `id` ile üst
   üste yazılıyordu; kalem kimliği ayrıştırıldı.
3. `shifts` INSERT'inde `shf_1` tırnaksız yazılmıştı (kolon sanılıyordu).
4. Kategori SQL'inde `GROUP BY name` belirsiz kolondu (`products.name` ile
   `categories.name`); ifade açık yazıldı ve `category_name` alias'ı alındı.

### Desktop

```
npx tsc --noEmit            → temiz
npx vitest run              → 31 dosya / 352 test passed
```

`tests/integration/reportsHub.test.ts` (17 test) kapsamı: yerel gün sınırları,
ters/eksik aralık reddi, Türkçe para biçimi, CSV kaçışları, Excel ayracı, dosya
adı, **kapı testleri** (rol/tenant/aralık zorunluluğu, CASHIER ve MASTER reddi,
ters aralık reddi) ve **tenant izolasyonu** (başka tenant'ta 0 sipariş).

### Gerçek Chromium (Playwright, `owner.spec.ts`)

```
8 passed (5.1s)
```

Kritik testler: **"OWNER: birleşik rapor merkezi"** (Satışlar düğmesi yok, Raporlar
merkezi var, dört bölüm sekmesi görünür) ve **"OWNER: rapor dışa aktarma
düğmeleri görünür"** (CSV / Excel / Yazdır-PDF).

### Gerçek ekran görüntüleri

`docs/evidence/` altında, `capture_reports.py` ile **gerçek Chromium** çıktısı
alındı (mockup yok):

| Dosya | Ekran |
|---|---|
| `faz5-reports-01-ozet.png` | Özet (metrik kartları + iki dağılım) |
| `faz5-reports-02-fisler.png` | Fişler tablosu |
| `faz5-reports-03-vardiyalar.png` | Vardiya geçmişi |
| `faz5-reports-04-iptal-iade.png` | İptal / iade / zayi + onaylayan |
| `faz5-reports-05-son7gun.png` | "Son 7 gün" aralığı uygulanmış hâli |

---

## 4. Statik taramalar

| Tarama | Sonuç (Faz 5 dosyaları) |
|---|---|
| `any` / `as any` / `<any>` | 0 |
| Üretimde `unwrap/expect/panic!` | 0 (yalnız `mod tests` içinde) |
| Emoji (`reports/**`) | 0 |
| Gradient (`bg-gradient`) | 0 (`linearGradient` yalnızca açıklama metninde) |
| Dosya sınırı (500) / bileşen sınırı (300) | Tümü sınır içinde |
| `tenant_id` sayımı | `report_service.rs` 28, `report_commands.rs` 13 |

---

## 5. Uydurma veri ve sahte görsel temizliği

| Önceki | Şimdi |
|---|---|
| `popular_categories` = `{Ana Yemekler: 12, İçecekler: 8}` (sabit) | Gerçek satırlardan hesaplanır; kategori yoksa boş liste |
| Metrik kartlarında sabit noktalı `linearGradient` sparkline | Trend çizgisi **kaldırıldı**; kartlar düz değer gösterir |
| `payment_methods` için uydurma 40/60 oranı (mock) | Yalnız gerçek kayıttan; yoksa boş liste + açıklama |
| Arayüzde yeniden hesaplanan yüzdeler | Yüzde raporun kendi hesabından gelir |

---

## 6. Skill kullanımı

| Skill | Nerede | Sonuç |
|---|---|---|
| `webapp-testing` | Gerçek Chromium kanıtı | `docs/evidence/*.png` üretildi (5 ekran) |
| `web-design-guidelines` | Form/tablo erişilebilirliği | `aria-pressed`, `aria-current`, `aria-label`, `sr-only`, odaklı güncelleme yerine doğrudan veri yükleme |

---

## 7. Kapsam dışı bırakılan teknik borç

1. **Diğer Playwright spec'lerinin giriş akışı bayat.** `manager`, `cashier`,
   `waiter`, `kitchen`, `master`, `security` spec'leri var olmayan hızlı giriş
   düğmesini (`4444 Kasiyer`, `6666 Mutfak`) arıyor; hepsi giriş adımında
   kırılıyor (Faz 4 öncesinden beri). Bu fazda yalnız `owner.spec.ts` güncellendi;
   kalanlar aynı kalıbı bekliyor. `npx playwright test` → 8 passed / 22 failed,
   22 failed'ın tamamı bu bayat giriş adımından kaynaklanıyor (Faz 5'ten bağımsız).
2. **Mock tohum verisinde emoji** (`tauriInvoke.ts` kategori ikonları) ve
   **KDS/Platform ekranlarında gradient** — AGENTS.md ihlali ama Faz 5
   dosyaları dışında, dokunulmadı.
3. **İade ve zayi yazma yolları yok.** `payment:refund` ve `stock:waste`
   hareketlerini üreten komut bulunmadığı için rapor bu iki türde "kayıt yok"
   der. Sıfır tutar uydurmak yanlış olurdu; `kinds_without_records` listesi bu
   yüzden ayrı taşınıyor ve arayüzde açıkça gösteriliyor.
4. **`EndOfDayContainer` hâlâ `get_daily_summary` kullanıyor.** Gün sonu ekranı
   kendi vardıya muhasebesi için bu komutu kullanmaya devam ediyor (tenant'ı
   zaten alıyor, tenant'sız değil); rapor merkezine taşınmadı çünkü gün sonu
   akışının kapsamı farklı.
5. **Kategori hacmi mock modunda boş.** `mockReceipts` kategori alanı taşımadığı
   için tarayıcı modunda liste boş gelir; gerçek modda `order_items` üzerinden
   dolar. Uydurma kategori üretmek yerine boş bırakıldı.
