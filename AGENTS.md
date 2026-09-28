# KASAM360 — REPOSITORY CONSTITUTION & AGENTS.md

> **ANAYASA TALİMATI:** Bu doküman KASAM360 repository'sinde çalışan tüm AI agent'lar (Claude, Gemini, Codex, Antigravity vb.) ve yazılım geliştiriciler için **en üst otorite proje anayasasıdır**. Kod yazmadan veya değiştirmeden önce bu doküman okunmalı, burada tanımlanan source of truth, business invariants, yetki sınırları ve IPC sözleşmelerine **kesinlikle uyulmalıdır.** Uydurma, varsayım yapma ve kanıtsız kural değiştirme **YASAKTIR.**

---

## 1. GENEL MİMARİ VE SİSTEM AKIŞI

KASAM360; hibrit multi-tenant mimarisine sahip, yerel SQLite veritabanı üzerinde çalışan, Tauri (Rust) backend tabanlı ve React + TypeScript (Vite + TailwindCSS + Zustand) frontend sunum katmanlı bir **POS, KDS & Restoran/Platform Yönetim Sistemidir.**

Proje klasörü 3 ana bölüme ayrılmıştır:
1. **`desktop/`**: Masaüstü istemci uygulaması (React + Vite + TailwindCSS + Zustand sunum katmanı, POS/KDS/Kasa/Patron/Platform ekranları).
2. **`backend/`**: Tauri Rust çekirdeği, SQLite veritabanı, finansal ödeme motoru, FIFO envanter servisi ve IPC komut işleyicileri.
3. **`mobile/`**: Gelecekteki mobil garson terminali, QR menü ve kurye uygulaması için ayrılmış boş dizin.

### Sistem Katman Haritası (Architecture Flow)

```text
+-----------------------------------------------------------------------------------+
|                        1. DESKTOP (REACT FRONTEND)                                |
|   AppShell / Views (POS, KDS, Floor, Management, Cashier, Owner, Platform)       |
|   Zustand Stores (useAuthStore, useCartStore, useFloorStore)                     |
+----------------------------------------+------------------------------------------+
                                         | (Tauri IPC Wrapper / tauriInvoke)
                                         v
+-----------------------------------------------------------------------------------+
|                        2. BACKEND (TAURI RUST & SQLITE)                           |
|   IPC Command Handlers (commands.rs, platform_commands, cashier_commands, etc.)   |
|   Services (PaymentService, InventoryService, AuditService)                       |
|   Repositories (PaymentRepository)                                                |
|   State & Mutex Locks (AppState.payment_mutex)                                    |
|   SQLite DB & Immutability Triggers (audit_ledger append-only SHA-256 validation) |
+-----------------------------------------------------------------------------------+

+-----------------------------------------------------------------------------------+
|                        3. MOBILE (FUTURE PLACEHOLDER)                             |
|   Garson Terminali, QR Menü & Kurye (Şu an boş tutulmaktadır)                     |
+-----------------------------------------------------------------------------------+
```

---

## 2. SOURCE OF TRUTH (GERÇEK SİSTEM HAKİKATİ)

1. **Parasal Hesaplamalar ve Fiyat Otoritesi (Financial Truth):**
   * Frontend görüntüleme katmanı yalnızca formatlayıcıdır.
   * Sipariş toplamı, kalan bakiye, KDV ve indirim tutarları **backend Rust / SQLite üzerinde kuruş (cents / INTEGER)** cinsinden hesaplanır.
   * `UI value ≠ authoritative business value` kuralı esastır.
   * Evidence: [payment_service.rs](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/src/services/payment_service.rs#L25-L34)

2. **Kimlik ve Rol Otoritesi (Identity & Auth Truth):**
   * Kullanıcı şifre/PIN bilgileri veritabanında Argon2 PHC hash biçiminde saklanır.
   * Yetki kontrolleri hem frontend UI rotalarında (`App.tsx`) hem de Rust IPC handler'larında (`actor_role` / DB sorgusu) çift taraflı doğrulanır.
   * Evidence: [auth.rs](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/src/auth.rs#L8-L29), [App.tsx](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/desktop/src/App.tsx#L33-L77)

3. **Stok ve FIFO Maliyet Otoritesi (Inventory Truth):**
   * Ürün stok düşümleri ve FIFO COGS (Satılan Malın Maliyeti) hesaplaması ödeme anında `InventoryService` ve `stock_movements` üzerinden yürütülür.
   * Evidence: [inventory_service.rs](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/src/services/inventory_service.rs#L8-L46)

4. **Değiştirilemez Denetim İzleri (Audit Truth):**
   * `audit_ledger` tablosu SHA-256 hash zinciriyle korunur. UPDATE ve DELETE işlemleri SQLite trigger'ları ile kesin olarak engellenmiştir.
   * Evidence: [schema.sql](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/migrations/schema.sql#L67-L80), [audit_service.rs](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/src/services/audit_service.rs#L12-L29)

---

## 3. BUSINESS DOMAIN HARİTASI

### 3.1 Authentication & Authorization
* **Amacı:** Kullanıcı girişi, rol ayrıştırma, PIN kilitleme ve oturum yönetimi.
* **Ana Varlıklar:** `User`, `SecurityPrincipal`.
* **Veritabanı Tablosu:** `users`.
* **Kritik Invariant'lar:**
  * PIN değerleri benzersizdir (`idx_users_pin`).
  * Şifre/PIN ham metin olarak asla döndürülmez veya loglanmaz. Argon2 tek yönlü hash kullanılır.
  * `MASTER` rolü restoran içi POS/Floor/KDS rotalarına erişemez, doğrudan `PLATFORM` ekranına yönlendirilir.
* **Evidence:** [auth.rs](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/src/auth.rs#L8-L29), [useAuthStore.ts](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/desktop/src/presentation/store/useAuthStore.ts#L68-L103)

### 3.2 Tenancy (Multi-Tenant İzolasyon)
* **Amacı:** İşletmelerin veri ve cihaz izolasyonunu sağlamak.
* **Ana Varlıklar:** `Tenant`, `Plan`, `Subscription`, `License`, `Device`.
* **Veritabanı Tabloları:** `tenants`, `plans`, `subscriptions`, `licenses`, `devices`.
* **Kritik Invariant'lar:**
  * `MASTER` dışındaki tüm roller sadece kendi `tenant_id` verilerine erişebilir.
  * Cihaz kilidi açılırken farklı tenant'a ait PIN ile işlem yapılması engellenir.
* **Evidence:** [platform_commands.rs](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/src/platform_commands.rs#L37-L64), [useAuthStore.ts](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/desktop/src/presentation/store/useAuthStore.ts#L124-L128)

### 3.3 Orders & Order Items
* **Amacı:** Masa siparişlerinin oluşturulması, ürün notları, opsiyon/modifier yönetimi ve tutar hesaplaması.
* **Ana Varlıklar:** `Order`, `OrderItem`, `Table`.
* **Veritabanı Tabloları:** `orders`, `order_items`, `tables`.
* **Kritik Invariant'lar:**
  * `total_cents` alanları INTEGER tamsayıdır.
  * Sipariş durumu: `OPEN` -> `IN_PROGRESS` -> `PAID` / `VOID` / `CANCELLED`.
  * Masa doluysa (`OCCUPIED`) yeni sipariş açılırken açık sipariş `getOrderItems` ile sepet durumuna yuklenir (Hydration).
* **Evidence:** [commands.rs](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/src/commands.rs#L134-L146), [TauriPOSRepository.ts](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/desktop/src/data/ipc/TauriPOSRepository.ts#L188-L239)

### 3.4 Payments & Settlements
* **Amacı:** Tekli/Parçalı ödeme alma, fiş basımı, kasa kapanışları ve sipariş kapatma.
* **Ana Varlıklar:** `PaymentPayload`, `PaymentResult`, `SplitPaymentDetail`.
* **Veritabanı Tabloları:** `orders`, `events`, `outbox`, `audit_ledger`.
* **Kritik Invariant'lar:**
  * Sunucu tarafındaki hesaplanan toplam ile istemcinin bildirdiği toplam arasındaki fark 1 kuruştan fazla olamaz (`TOTAL_MISMATCH`).
  * `transaction_id` ile eş etkililik (idempotency) kontrolü yapılır. İkinci defa aynı ödeme işlenemez.
  * Ödeme anında `AppState.payment_mutex` tutularak eşzamanlı işlem çatışmaları ve audit_ledger phantom read'leri engellenir.
* **Evidence:** [payment_service.rs](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/src/services/payment_service.rs#L18-L34), [commands.rs](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/src/commands.rs#L91-L132)

### 3.5 Cashier Shifts & Cash Operations
* **Amacı:** Kasiyer vardiya takibi, nakit giriş/çıkış (Cash In/Out) operasyonları ve vardiya sonu kasa sayım eşleştirmesi (Z-Summary).
* **Ana Varlıklar:** `Shift`, `CashMovement`, `ShiftSummary`.
* **Veritabanı Tabloları:** `shifts`, `cash_movements`.
* **Kritik Invariant'lar:**
  * Beklenen bakiye: `expected = opening_balance + total_sales + cash_in - cash_out`.
  * Fark (`discrepancy`): `actual_closing_balance - expected_balance`.
* **Evidence:** [cashier_commands.rs](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/src/cashier_commands.rs#L116-L190)

### 3.6 Kitchen Display System (KDS) & Stations
* **Amacı:** Mutfak biletlerinin istasyonlara (Sıcak, Soğuk, İçecek, Izgara, Tatlı) göre yönlendirilmesi ve durum güncellemeleri.
* **Ana Varlıklar:** `Station`, `OrderTicket`, `TicketStatusTransition`.
* **Veritabanı Tabloları:** `stations`, `order_items`, `events`.
* **Kritik Invariant'lar:**
  * Siparişe ait tüm kalemler `Ready` / `Completed` / `Served` olduğunda otomatik olarak `TICKET_STATUS_UPDATED` olayı tetiklenir.
* **Evidence:** [kitchen_commands.rs](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/src/kitchen_commands.rs#L97-L171)

### 3.7 Manager Approvals & Inventory Management
* **Amacı:** İptal (Void) isteklerinin onaylanması, stok seviyeleri ve şube yönetimi.
* **Ana Varlıklar:** `Approval`, `InventoryItem`, `StockMovement`, `Branch`.
* **Veritabanı Tabloları:** `approvals`, `inventory_items`, `stock_movements`, `branches`.
* **Kritik Invariant'lar:**
  * Kasiyer veya garson tarafından başlatılan Sipariş İptali (Void), Müdürü/Patron PIN doğrulaması olmadan tamamlanamaz.
  * Stok artırma/azaltma işlemleri `stock_movements` tablosuna audit kaydı oluşturur.
* **Evidence:** [commands.rs](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/src/commands.rs#L1318-L1350), [approval_commands.rs](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/src/approval_commands.rs#L81-L128), [inventory_commands.rs](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/src/inventory_commands.rs#L57-L98)

---

## 4. ROLE MATRIX & YETKİ SINIRLARI

Repository'de 6 temel rol bulunmaktadır. Her rolün yetkileri strict olarak kısıtlanmıştır:

| Yetki / İşlem | MASTER (1111) | OWNER (2222) | MANAGER (3333) | CASHIER (4444) | WAITER (5555) | KITCHEN (6666) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Platform / Tenant Yönetimi** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Menü Fiyatı Değiştirme** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Ürün Aktif/Pasif Yapma** | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Sipariş Oluşturma / Masa Açma** | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Ödeme Al / Fiş Bas** | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Vardiya Aç / Kapa (Cash Shift)** | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Void (İptal) Onaylama** | ❌ | ✅ | ✅ | ❌ (Req Only)| ❌ | ❌ |
| **KDS Mutfak Ekranı Yönetimi** | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |

*Evidence for Role Boundaries:* [App.tsx](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/desktop/src/App.tsx#L36-L66), [management_commands.rs](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/src/management_commands.rs#L211-L213), [commands.rs](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/src/commands.rs#L1318-L1334)

---

## 5. FEATURE MATRIX

| Domain | Feature | Roles | Frontend Component | IPC Command | Backend Implementation | Related DB Tables | Test File |
|---|---|---|---|---|---|---|---|
| **Auth** | Credential / PIN Login | ALL | `LoginPage`, `PinScreen` | `auth_login`, `auth_login_credentials` | `commands.rs` | `users` | `authService.test.ts` |
| **Platform** | Tenant & Plan Mgmt | MASTER | `PlatformContainer` | `get_tenants`, `create_tenant`, `get_plans` | `platform_commands.rs` | `tenants`, `plans`, `subscriptions` | `zeroGapFeatureMatrix.test.ts` |
| **POS** | Catalog & Cart | WAITER, CASHIER, MANAGER, OWNER | `CatalogContainer`, `CartContainer` | `pos_get_products`, `get_product_modifiers` | `commands.rs`, `waiter_commands.rs` | `products`, `categories`, `modifier_groups` | `cartStore.test.ts` |
| **Orders** | Submit & Hydrate Order | WAITER, CASHIER, MANAGER, OWNER | `FloorPlanContainer`, `CartContainer` | `submit_order`, `get_order_items` | `commands.rs` | `orders`, `order_items`, `tables` | `kdsWorkflow.test.ts` |
| **Payment** | Payment Settlement | CASHIER, OWNER | `PaymentModalContainer` | `process_payment`, `process_split_payment` | `commands.rs` -> `PaymentService` | `orders`, `events`, `audit_ledger` | `paymentEngine.test.ts` |
| **Cashier** | Shift & Cash Movements | CASHIER, OWNER | `CashierWorkstationContainer` | `open_shift`, `close_shift`, `cash_in`, `cash_out` | `cashier_commands.rs` | `shifts`, `cash_movements` | `cashierWorkstation.test.ts` |
| **Kitchen** | KDS Ticket Progression | KITCHEN, MANAGER, OWNER | `KdsContainer` | `get_active_tickets`, `update_kds_item_status` | `kitchen_commands.rs` | `order_items`, `stations`, `events` | `kdsBackendContainer.test.ts` |
| **Approval** | Manager PIN Void Approval | MANAGER, OWNER | `ApprovalsPanel`, `CartContainer` | `void_order`, `process_approval` | `commands.rs`, `approval_commands.rs` | `approvals`, `audit_ledger` | `criticalFixes.test.ts` |
| **Inventory**| FIFO Cost & Stock Adjust | OWNER | `OwnerInventoryTab` | `get_inventory`, `adjust_stock` | `inventory_commands.rs` | `inventory_items`, `stock_movements` | `fifoCost.test.ts` |

---

## 6. VERİTABANI VE ŞEMA KURALLARI

1. **Finansal Tamsayı Şartı (Money Representation Invariant):**
   * Tüm para birimleri veritabanında `INTEGER` (kuruş/cents) olarak tutulur. `REAL` veya `FLOAT` parasal sütun kullanımı **YASAKTIR.**
   * Evidence: [schema.sql](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/migrations/schema.sql#L111-L140)

2. **Multi-Tenant Kolon Şartı:**
   * Tüm operasyonel tablolarda `tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT'` kolonu bulunmak zorundadır.
   * Evidence: [schema.sql](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/migrations/schema.sql#L3-L56)

3. **Veri Değiştirilemezliği ve Audit Ledger:**
   * `audit_ledger` tablosunda `trg_audit_ledger_prevent_update` ve `trg_audit_ledger_prevent_delete` trigger'ları aktiftir. Bu tabloya müdahale edilemez.
   * Evidence: [schema.sql](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/backend/migrations/schema.sql#L67-L80)

---

## 7. TAURI IPC CONTRACT & BOUNDARY

* İstemci katmanı doğrudan Tauri Rust API'sini çağırmak yerine `desktop/src/data/ipc/TauriPOSRepository.ts` ve `desktop/src/data/ipc/tauriInvoke.ts` soyutlamasını kullanmalıdır.
* Browser / Mock ortamında `window.__TAURI_INTERNALS__` yoksa `tauriInvoke` otomatik olarak bellek içi mock yanıtlar döndürerek uygulamanın ve Vitest testlerinin çökmesini engeller.
* Evidence: [tauriInvoke.ts](file:///c:/Users/Eren%20Tokg%C3%B6z/Desktop/Projects/kasam360/desktop/src/data/ipc/tauriInvoke.ts#L1-L40)

---

## 8. KOD YORUMU VE YAZIM STANDARTLARI (TÜRKÇE YORUM KURALI)

1. **Yorum Dili:**
   * Kod tabanına yeni eklenecek veya güncellenecek **tüm kod yorumları kesinlikle Türkçe olacaktır.**
   * Yorumlar kısa, teknik, **"neden"** yapıldığını açıklayan nitelikte olmalıdır. Bariz kod işlemlerini tekrar eden gereksiz yorumlar yazılmayacaktır.
   * Örnek İYİ Yorum: `// Audit ledger sırasını korumak için ödeme işlemlerini serileştir.`
   * Örnek KÖTÜ Yorum: `// Increment quantity by 1`

2. **İsimlendirme (Identifiers):**
   * Class, interface, function, variable, database column, Rust struct ve IPC command isimleri mevcut **İngilizce codebase convention'ına** uygun kalacaktır. Sırf Türkçeleştirmek için identifier adı değiştirilmeyecektir.

---

## 9. TEST ANAYASASI & COMPLETION PROTOCOL

Gelecekte KASAM360 üzerinde çalışan herhangi bir agent bir görevi tamamladığını beyan etmeden önce aşağıdaki doğrulama adımlarını eksiksiz çalıştırmalıdır:

1. **TypeScript Typecheck:**
   ```bash
   # desktop dizininde
   npx tsc --noEmit
   ```
   *Sonuç 0 Hata olmalıdır.*

2. **Rust Compilation Check:**
   ```bash
   # backend dizininde
   cargo check
   ```
   *(backend dizininde) Sonuç 0 Derleme Hatası olmalıdır.*

3. **Vitest Unit & Integration Suite:**
   ```bash
   # desktop dizininde
   npx vitest run --exclude "**/tests/e2e-playwright/**"
   ```
   *Tüm unit ve entegrasyon testleri (263 test) PASS olmalıdır.*

*Not: `NO REGRESSION COVERAGE FOUND` durumu kabul edilemez. Değiştirilen her alan ilgili entegrasyon veya birim testi ile doğrulanmalıdır.*

---

## 10. FORBIDDEN PATTERNS (YASAKLI PATTERN'LER)

1. ❌ **Client-Authoritative Financial Calculations:** İstemci tarafında fiyat/toplam hesaplayıp veritabanına doğrudan yazmak.
2. ❌ **Swallowed Exceptions / Fake Fallbacks:** Hataları sessizce yutmak veya `catch { return true; }` gibi sahte basarı dönmek.
3. ❌ **Plaintext Credential Storage:** PIN veya şifreleri veritabanında veya loglarda açık metin olarak saklamak.
4. ❌ **MASTER Role POS Access:** MASTER rolünün restoran içi satış/masalar ekranına girmesine izin vermek.
5. ❌ **Float Money Representation:** Parasal değerlerde float/double tipi kullanmak (Her zaman INTEGER kuruş kullanılacaktır).
6. ❌ **Arbitrary Refactoring:** Görev kapsamı dışındaki ilgisiz dosyaları yeniden düzenlemek.
7. ❌ **AI Slop & Generic Tropes:** Büyücü yıldızları (`✨`), anlamsız düzensiz SVG eğrileri/sparkline'ları, ham kripto hash metinleri veya yapay zeka klişesi görsel öğeler kullanmak KESİNLİKLE YASAKTIR.
8. ❌ **Flat Mud-Gray Fake Glass:** Düz zifiri siyah zemin üzerine ışık refraksiyonu ve specular highlight olmadan çamur gibi mat koyu gri kutular (`bg-white/[0.04]`) çizmek YASAKTIR. Her cam panel gerçek Apple ışık kırılmasına (`inset 0 1px 1px 0 rgba(255,255,255,0.18)`) ve arkasındaki ambiyans ışımasına sahip olmalıdır.

---

## 11. KNOWN DEBT & VERIFICATION STATUS

* **Device Guard Middleware (`NEEDS VERIFICATION`):** Cihaz lisanslama tablosu ve IPC komutları mevcuttur ancak geliştirme ortamını engellememek adına sıkı lisans kontrolü pasif bırakılmıştır.
* **Playwright E2E Runner Setup (`LOW`):** Playwright E2E testleri `@playwright/test` runner'ı yerine yanlışlıkla Vitest runner'ına dahil edildiğinde `test.describe` hatası vermektedir. Playwright testleri `npx playwright test` komutuyla bağımsız çalıştırılmalıdır.

---

## 12. AGENT ÇALIŞMA PROTOKOLÜ (WORKFLOW)

1. **BEFORE CHANGE:**
   * AGENTS.md anayasasını ve ilgili domain invariant'larını okuyun.
   * `npx tsc --noEmit` çalıştırarak baseline'ı kontrol edin.

2. **DURING CHANGE:**
   * Yalnızca istenen değişikliği yapın.
   * Kod yorumlarını Türkçe yazın.
   * Sorumluluk sınırlarını ve yetki matrisini ihlal etmeyin.

3. **AFTER CHANGE:**
   * Typecheck (`npx tsc --noEmit`), Rust check (`cargo check`) ve Vitest testlerini (`npx vitest run --exclude "**/tests/e2e-playwright/**"`) çalıştırın ve konsol çıktılarına göre `PASS` doğrulamasını yapın.

---

## 13. UI/UX VE GÖRSEL MİMARİ ANAYASASI (APPLE iOS / VISIONOS GERÇEK CAM VE SAF TASARIM)

1. **Saf Apple iOS / visionOS Felsefesi:**
   * KASAM360 görsel dili; ucuz yapay zeka klişelerinden (büyücü yıldızları `✨`, anlamsız rastgele SVG dalgaları, anlamsız kripto hash kodları) tamamen arındırılmıştır.
   * Tüm arayüz; Apple Human Interface Guidelines (macOS Sequoia & iOS 18) ve visionOS Glassmorphism standartlarına uygun olmalıdır.
2. **Fiziksel Işık Kırılması (Specular Lighting) & Ambiyans Zorunluluğu:**
   * Zifiri siyah `#060609` üzerine doğrudan mat saydamlık koymak YASAKTIR.
   * Zemin katmanında daima derin ve zarif bir atmosferik ambiyans ışıması (subtle ambient glow) yer almalıdır.
   * Tüm cam panellerin (`GlassCard`, `GlassModal`, `GlassButton`) üst kenarında fiziksel ışık kırılması pahı (`inset 0 1px 1px 0 rgba(255, 255, 255, 0.18)` ve `border: 1px solid rgba(255, 255, 255, 0.12)`) bulunmalıdır.
3. **Ekran Bileşen Standartları:**
   * **Lock Screen / PIN:** Birebir iPhone kilit ekranı cam numerik tuşları (yuvarlak, basınca ışığı parlatıp içeri çeken butonlar, cam altı harfler).
   * **Üst Bar:** Bağımsız yüzen gerçek **macOS Sequoia Floating Glass Capsule**; sekmeler arasında akıcı kayan Apple Segmented Control.
   * **Rakamlar & Tablolar:** Titremeyen `SF Pro / font-mono tabular-nums`, Apple Finance seviyesinde temiz hiyerarşi.
4. **Donanım Emülatörleri İzolasyonu:**
   * Banka POS / ÖKC emülatörleri ve sanal test makineleri kesinlikle canlı prodüksiyon kodunu kirletemez; `desktop/tests/emulators/` klasörüne izole edilmelidir.

