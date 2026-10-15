# KASAM360 — ÖZELLİK RAPORU (Faz 0-16)

Ölçüm tarihi: 2026-10-05. Tüm rakamlar bu tarihte çalıştırılan komutlardan alındı.

> **Durum notu (2026-10-05, düzeltme turu):** Aşağıdaki bulgulardan üçü bu turda
> **giderildi**: §Bölüm 6 madde 3 (finansal sessiz hata), madde 4 (kapısız komut
> grupları) ve `feat_seat_split` bayrağı (AGENTS.md §8). Güncel kapılar:
> `cargo test` **884 passed / 0 failed**, `npx tsc --noEmit` **0 hata**,
> `npx vitest run` **41 dosya / 571 passed / 0 FAIL**. Bu bölümdeki satır
> numaraları ve kod parçacıkları **düzeltme öncesi** hâlin kanıtıdır; silinmedi.

## KAPILAR (rapor yazıldığı andaki doğrulanmış hâl)

| Kapı | Komut | Sonuç |
| :--- | :--- | :--- |
| `cargo check` | `cargo check` | `Finished dev profile in 3.22s` — 0 hata |
| `cargo test` | `cargo test` | **863 passed; 0 failed** |
| `npx tsc --noEmit` | `npx tsc --noEmit` | **0 hata** (çıktı boş) |
| `npx vitest run` | `npx vitest run` | **40 dosya / 553 passed / 0 FAIL** |

Ek ölçümler (bu rapor için çalıştırıldı, kapı değil):

| Ölçüm | Komut | Sonuç |
| :--- | :--- | :--- |
| Emoji | `rg -cP "[\x{1F300}-\x{1F9FF}]" desktop/src` | **3 ihlal** (hepsi `PlatformSetupWizard.tsx`) |
| Gradient | `rg -c "bg-gradient" desktop/src` | **4 ihlal** (4 dosya) |
| `unwrap()/expect()` (test dışı) | `rg "unwrap\(\)\|expect\(" backend/src` | 3 satır: `lib.rs:47,53,334` — hepsi `run()` bootstrap |
| `cargo fmt --check` | `cargo fmt --check` | **760 sapma** |
| `cargo clippy --all-targets` | `cargo clippy` | **93 uyarı** |

---

## BÖLÜM 1: TAMAMLANAN ÖZELLİKLER

| Özellik | Modül | Commit | Test | Durum |
| :--- | :--- | :--- | :---: | :--- |
| Repo yeniden yapılandırma (desktop/backend/mobile) | kök | `dea2888` | 0 | ✅ |
| Test & yapılandırma temizliği (tsconfig vitest globals) | `tsconfig.json` | `432a890` | 553 | ✅ `tsc` 0 hata |
| RBAC çekirdeği (6 rol + takma adlar + fail-closed) | `rbac.rs` | `e380739` | 13 | ✅ |
| Rol navigasyon matrisi (18 yetki satırı, 8 view) | `navigationMatrix.ts` | `e380739` | 21 | ✅ |
| Anlık PIN onayı (tek kullanımlık jeton) | `approval_service.rs`, `approval_commands.rs` | `2be1cd4` | 24 | ✅ backend |
| Modifier gömme (sekme kaldırıldı, komutlar yaşıyor) | `modifier_service.rs`, `modifier_commands.rs` | `1679615` | 61 | ✅ |
| Denetim defteri SHA-256 zinciri | `audit_service.rs` | `6316a52` | 46 | ✅ |
| Denetim kategorileri + hash gizleme | `auditCatalog.ts`, `OwnerAuditLogsTab.tsx` | `6316a52` | 12 | ✅ |
| İletişim/rapor merkezi (4 rapor tek ekran) | `report_service.rs`, `ReportsHub.tsx` | `035615c`, `c7b86ac` | 44 | ✅ |
| Şube yönetimi MASTER'a kilitli | `branch_commands.rs`, `branch_service.rs` | `0c791d7` | 19 | ✅ |
| Geçmiş fişler → Hesap Defteri | `receipt_commands.rs`, `ReceiptViewerModal.tsx` | `508873f` | 42 | ✅ |
| Rezervasyon düzeltmesi (35dk hareketsizlik) | `reservation_service.rs`, `reservation_commands.rs` | `fe3ac4d` | 32 | ✅ |
| Hesap defteri derinleştirme (net bakiye, bütçe, P&L) | `ledger_service.rs`, `pnl_service.rs`, `ledger_statement.rs` | `55dfd7f` | 34 | ✅ |
| Personel 360° (maaş 5 model, bahşiş, KPI, radar) | `services/staff360/` | `2206d63` | 46 | ✅ backend |
| Envanter 360° (reçete, tedarikçi, raf ömrü, fire, sayım) | `services/inventory360/` | `0cf79ee` | 78 | ✅ backend |
| Rapor analiz merkezi (BCG, kombinasyon, yoğun saat) | `services/analytics_service/` | `035615c` | 37 | ✅ backend |
| Kroki çizim çekirdeği (geometri, bölüm, şablon) | `services/floor360/`, `floor_plan_commands.rs` | `e7c69c7`, `0a66af7` | 29 | ✅ backend |
| Yasal & özel gün (denetim takvimi, kampanya, sigorta, telif, e-Arşiv) | `services/legal360/`, `legal360_commands/` | `8d33ff7` | 48 | ✅ backend |
| Güvenlik sertleştirme (kaba kuvvet, çift onay, KVKK, oturum, 2FA) | `services/security360/` | `9e301d1`…`479781b` | 31 | ✅ backend |
| Dış aktörler (QR menü, tedarikçi, müşavir, teknik servis) | `services/external360/`, `external360_commands.rs` | `2264bc2` | 43 | ✅ backend |
| UTC → yerel tarih (3 modül) | `print_commands.rs`, `pricing/bulk.rs`, `shelf_life.rs` | `67154b1`, `3863540` | 6 | ✅ |

**Faz 0-16 backend tarafı: 20/20 faz uygulandı.** Her fazın commit'i `git log`'da doğrulandı.

---

## BÖLÜM 2: KISMİ TAMAMLANAN

| Özellik | Ne Var | Ne Eksik | Nerede |
| :--- | :--- | :--- | :--- |
| **QR Menü** | Oturum açma/iptal, imzalı menü dosyası, bekleyen istek kuyruğu, kabul/ret, geri bildirim — 17 komut | **Frontend çağıranı yok.** `rg "qr_menu_build\|qr_customer_session" desktop/src` → 0 sonuç. `menu_file.rs` dosya üretir, hiçbir yüzey indirmez | `external360/qr_menu.rs:317`, `external360_commands.rs:87-206` |
| **Tedarikçi** | Talep oluştur, dışa aktar, kuyruk — 3 komut + `suppliers/catalog.rs` | **Portal/ekran yok.** Ayrıca `inventory360/supplier_commands.rs` (8 komut) ile **iki ayrı tedarikçi yolu** var, birleştirilmemiş | `external360/supplier.rs:280`, `supplier_commands.rs:272` |
| **Mali müşavir** | Dönem raporu üretimi + imza + "gönderildi" işaretleme — 2 komut | **Ekran yok.** Ayrıca frontend'te `data/ebilge/` (6 dosya) + `data/fiscal/` (3 dosya) kodu var, **hiçbir yerden çağrılmıyor** (yalnız `OfflineSyncQueue` ve `PeripheralDiagnostics` içinden) | `external360/accountant.rs:255`, `desktop/src/data/ebilge/` |
| **Teknik servis** | `service_tickets` tablosu + 3 komut (oluştur, durum güncelle, açık listele) | **Ekran/portal yok.** `issueReport` yetki satırı matriste 6 role de FULL ama hiçbir komut bu kapıya bağlı değil | `external360/tickets.rs:190`, `navigationMatrix.ts:103-110` |
| **Personel 360°** | 9 panel (Profil, Maaş, Bahşiş, Vardiya, İzin, Zimmet, Tutanak, KPI, Radar) | **Maskeleme UI yok** (`mask.rs:493` sunucuda hazır, paneller çıplak gösteriyor). `maaş tutarı` kapısı var ama arayüz hata mesajını yönetmiyor | `security360/mask.rs:493`, `owner/staff/*.tsx` |
| **Envanter 360°** | 7 panel (Fiyat, Reçete, Raf Ömrü, Tedarikçi, Fire, Sayım, Birim) | **Kör sayım** (`stock_count_lines` var, açık/kapalı akışı `count.rs:486` içinde), **birim çevrim UI** yok (`units.rs:290` sadece servis), **happy hour** `pricing/windows.rs:187` var ama panelde karşılığı yok | `owner/inventory/*.tsx` |
| **Rapor merkezi** | 4 rapor + 12 analitik panel + CSV/Excel dışa aktarma | **PDF dışa aktarma yok.** `rg "jsPDF\|pdf" desktop/src` → yalnız uygulama adı geçiyor. **Denetim logu ayrı sekmede** (`OwnerAuditLogsTab`), rapor merkezine taşınmadı | `ReportsHub.tsx:85-91`, `export/reportExport.ts` |
| **Kasa / KDS** | Tam akış (ödeme, vardiya, bilet, istasyon) | **Faz 15 oturum jetonu gönderilmiyor** → `cash_out`/`close_day` bugün oturumsuz çalışıyor. 2FA giriş ekranı yok. `session_policies.is_enforced` **0** | `cashier_commands.rs:116`, `day_close_commands.rs:102` |
| **Kroki çizim** | 8 komut, 4 şablon, geometri, atomiklik testleri | **Frontend `floor360Mock.ts` (449 satır)** — tarayıcı modunda mock, `save_floor_layout` gerçek IPC'ye gidiyor ama mock dairesel bağımlılığı var | `desktop/src/data/ipc/floor360Mock.ts:449` |
| **Denetim logu** | 8 kategori, filtre, arama, CSV/Excel | **Eski→Yeni değer sütunu kısmi** (`OwnerAuditLogDetailModal.tsx:24` tek satır). **Excel/PDF yok** (CSV var) | `OwnerAuditLogsTab.tsx:292` |
| **Kasa para üstü** | Para üstü hesaplanıyor ve gösteriliyor | **Akıllı para üstü paneli yok** — hazır nakit önerisi (50/100/200/500) bulunmuyor. `rg "quick_cash" desktop/src` → 0 | `PaymentModalPanel.tsx:134`, `CashierWorkstationContainer.tsx:1569` |
| **Quick modifier** | 5 hazır not listesi | **Sabit dizi**, ürün/kategori bazlı değil; merkezi bir tanım da yok | `ModifierModal.tsx:57` |
| **Masa hareketsizlik** | 35dk eşiği 3 yerde çalışıyor | **Eşik sabit kodlanmış** (`35 * 60000`), ayar/şema yok. 4 yerde tekrar edilmiş | `TableCard.tsx:155`, `TableActionModal.tsx:93`, `TableTimer.tsx:16` |
| **Offline çalışma** | `OfflineSyncQueue` (619 satır), `BackgroundSyncWorker` (691 satır) | **Komut kuyruğu bağlı değil** — bu iki sınıf e-ticaret siparişi ve cihaz telemetrisi için, POS komutları için değil. `rg "BroadcastChannel" desktop/src` → 0 (çoklu sekme senkronu yok) | `OfflineSyncQueue.ts:619`, `BackgroundSyncWorker.ts:691` |
| **Fiziki donanım** | 5 arayüz + 4 mock + 3 adapter + yazıcı kuyruğu | **Seri/USB/TCP adapter'ları hiç bağlanmıyor** — `HardwareManager` mock'u seçiyor. `PeripheralDiagnostics.ts:318` 2 sn timeout kuralına uyuyor | `data/hardware/` (18 dosya) |

---

## BÖLÜM 3: HİÇ BAŞLANMAMIŞ

| Özellik | Plan Madde | Neden Ertelendi |
| :--- | :--- | :--- |
| Koltuk bazlı sipariş (koltuk no) | Ek görev #1 | `rg "seat_number\|seatNumber" .` → **0 sonuç**. `feat_seat_split` bayrağı `useFeatureFlags.ts:70`'de AÇIK ilan edilmiş ama arkasında kod yok — **bayrak yalan söylüyor** |
| Alman usulü bölme (masa bazlı bölme) | Ek görev #2 | `rg "split_bill\|separate_bill" .` → 0. Tek ödeme yolu: `process_payment`, `process_split_payment` = taksit/parçalı ödeme, **masa bölme değil** |
| Kişi sayısı + otomatik kuver | Ek görev #3 | `rg "guest_count\|kuver" .` → 0 |
| Masa devri / bekleme listesi | Ek görev #18 | `rg "waitlist\|bekleme_listesi" .` → 0 |
| Müşteri tercih takibi | Ek görev #19 | `rg "preference\|alerji" desktop/src backend/src` → 1 sonuç, sadece bir tip yorumu (`types/index.ts:340`) |
| Denetim modu (gözden geçirme) | Ek görev #20 | `rg "audit_mode\|gözden_geçirme" .` → 0 |
| Bilgi tabanı / yardım merkezi | Ek görev #23 | `rg "knowledge_base\|bilgi_tabani" .` → 0 |
| Feature flag matrisi arayüzü | Ek görev #24 | `update_tenant_modules` komutu + `TenantManagement.tsx:462` var; 11 bayrağın **matris görünümü** yok, `TenantDetailModal.tsx:423` tek tek |
| Master tenant sağlık paneli | Ek görev #25 | `rg "health_check" backend/src` → 0. Cihaz telemetrisi var (`HeartbeatTelemetryService.ts:457`) ama kiracı sağlığı toplamı yok |
| Nakit akışı projeksiyonu | Ek görev #28 | `rg "cash_flow\|projection" .` → 0 |
| Buzdolabı sıcaklık takibi | Ek görev #29 | `rg "fridge\|temperature" .` → 0 |
| Servis süreleri takibi | Ek görev #30 | `rg "servis_suresi\|turnaround" .` → 0 |
| Yemek kartları (Multinet/Sodexo) | Ek görev #35 | `rg "multinet\|sodexo" .` → 0 |
| RFID personel geçişi | Ek görev #37 | `rg "rfid\|nfc" .` → **0 sonuç**. Faz 15 "çok katmanlı giriş (mevcut + 2FA + RFID)" diyordu; **yalnız 2FA** yapıldı |
| Local otomatik yedekleme | Ek görev #39 | `rg "auto_backup" .` → 0 |
| Bulut yedekleme | PLAN §C-8 | AGENTS.md §3.1 harici bulutu yasaklıyor. Karar #3 cevaplanmadı |
| Docker dağıtım | Faz 17 | `Get-ChildItem Dockerfile*` → **0 dosya**. Hiç başlanmamış |
| Mobil uygulama | PLAN C-8 | `mobile/` klasörü boş (`.gitkeep` yok bile) |
| Müşteri uygulaması (ayrı portal) | PLAN C-8 karar #2 | Cevaplanmadı; Faz 16 "dosya tabanlı takas" ile geçildi (`lib.rs:272`) |
| WhatsApp bot | PLAN §2.16 | `whatsapp_queue` tablosu var (`schema.sql`), komutu yok. `feat_delivery` ve `feat_caller_id` bayrakları tanımlı, arkasında kod yok |
| Klavye kısayolları (F1-F5) | Ek görev #10 | `rg "F1\|F2\|'F3'" desktop/src` → yalnız `Escape` (`useModalA11y.ts:31`) ve PIN girişi (`PinScreen.tsx:102`). Fonksiyon tuşu ataması yok |
| İşlem geri alma (30 sn Undo) | Ek görev #11 | `rg "undo\|geri_al" desktop/src backend/src` → 10 sonuç, hepsi **SQL rollback** veya **stok transferi geri alma**. Kullanıcıya görünen Undo yok |
| Kısayol çubuğu | Ek görev #12 | `rg "toolbar\|QuickBar" desktop/src` → 0 |
| Çoklu sekme | Ek görev #13 | `rg "BroadcastChannel\|storage event" desktop/src` → 0 |
| KDS gecikme alarmı | Ek görev #15 | `rg "gecikme_alarm\|late_alert" .` → 0. `KdsWorkflowManager.ts:408` iş yükü raporu veriyor ama **gecikme eşiği yok** |
| Termal fiş yönlendirme | Ek görev #16 | `rg "print_target\|kitchen_print" .` → 0. 5 print komutu var (`lib.rs:127-131`) ama hepsi tek çıktı |
| Mutfak hazırlık listesi | Ek görev #17 | `rg "prep_list\|hazirlik" .` → 0 |
| Kartla bahşiş | Ek görev #36 | `rg "tip_cents\|gratuity" backend/src` → 25 sonuç, hepsi **nakit bahşiş** (`tip_service.rs:14` açıkça "yalnız nakit bahşiş yazılır"). Terminal kart bahşişi için alan yok |
| Yazıcı durum göstergesi | Ek görev #40 | `checkHealth()` 6 sınıfta var (`MockPrinter.ts:31` dahil), **hiçbir UI bunu göstermiyor** — `rg "checkHealth" desktop/src/presentation` → 0 |

---

## BÖLÜM 4: KULLANICI ROLLERİNE GÖRE DURUM

### MASTER (platform yöneticisi)
- **Backend:** 14 komut (`lib.rs:156-204`) + cihaz komutları (4). `require_master` ve `require_master_present` ile kilitli (`rbac.rs:105,115`).
- **Frontend:** `PlatformContainer`, `PlatformSetupWizard` (950 satır), `TenantManagement` (462), `TenantDetailModal` (423), `ITOpsModals` (577), `ImpersonationBanner`, `MasterVaultModal` (453).
- **Eksik:** Sağlık paneli (yok). Feature flag matrisi görünümü (yok). `MasterVaultModal` **yalnız UI** — backend'de vault komutu yok (`rg "master_vault" backend/src` → 0). Impersonation `userId` string öneki ile yapılıyor (`ITOpsModals.tsx:91`), geri alma/izolasyon garantisi yok.
- **İhlal:** Bu 4 dosya AGENTS.md §3.2'yi ihlal ediyor: `ImpersonationBanner.tsx:33` gradient + `red-600/rose-600/amber-600` (palet dışı), `MasterVaultModal.tsx:243` gradient + `purple-600/indigo-600`, `PlatformSetupWizard.tsx:390` gradient, `:305,315,859` **emoji**.

### OWNER (işletme sahibi)
- **Backend:** En geniş kapı — ledger (16 komut), staff (20 komut), envanter (30 komut), rapor, yasal (25 komut), menu pricing, modifier, branch (get only), approval threshold (set).
- **Frontend:** `OwnerDashboardContainer`, `owner/ui/*` (5 sekme), `owner/staff/*` (6 sekme), `owner/inventory/*` (6 panel), `ReportsHub` + `AnalyticsPanel`.
- **Eksik:** Yasal/kampanya/sigorta/telif/e-Arşiv ekranları **yok** (Faz 14'ün tüm arayüzü). 2FA kurulum sihirbazı yok. Oturum jetonu saklanmıyor. `auditRead` FULL ama eski→yeni değer sütunu kısmi.

### MANAGER (müdür)
- **Backend:** `require_reporting` (OWNER+MANAGER), `require_audit_read` (PARTIAL), `require_staff_admin`, `require_shift_planning`, `require_approver`, kupon uygulama (`apply_campaign_command`).
- **Frontend:** `MANAGEMENT` view (`ManagementContainer` + 8 panel), `OWNER_DASHBOARD`'in `MANAGEMENT` dalı (`App.tsx:100`).
- **Eksik:** "Kısmi rapor" filtresi `navigationMatrix.ts:83,87`'de PARTIAL olarak tanımlı ama **hangi verinin kısıldığı kodda belirtilmemiş** — `ReportsHub.tsx` filtreleri role göre dallanmıyor. Maaş **tutarı** görememesi (`rbac.rs:158`) hata mesajı olarak dönüyor, alan gizleme değil — yani ekran açılıyor, veri reddediliyor.

### CASHIER (kasa)
- **Backend:** `process_payment`, `process_split_payment`, `cash_in`, `cash_out`, `open_shift`, `close_shift`, `get_active_shift`, `get_shift_summary`, `close_day`, `print_receipt`, `void_order` (PIN), `get_debts` (PARTIAL).
- **Frontend:** `CashierWorkstationContainer` (**1998 satır** — AGENTS.md §10 ihlali, sınır 500), `InstantPinApprovalModal`.
- **Eksik:** `session_token` gönderilmiyor (`cashier_commands.rs:116` bekliyor, UI göndermiyor). Bu yüzden `is_enforced = 1` yapılırsa **kasa durur** — doğru davranış, ama kapı kapalı kaldığı için kaba kuvvet koruması kasa çıkışında oturumla bağlı değil. `get_shift_summary` (`cashier_commands.rs:255`) **hiç rol kapısı yok** — `rg "require_" cashier_commands.rs` → 0 sonuç. Kimse CASHIER olmayan biri vardiya özetini okuyabilir (tenant filtresi var, rol filtresi yok).

### WAITER (garson)
- **Backend:** 6 komut (`waiter_commands.rs`). `update_table_status` ve `waiter_clock_in` `require_any_present` ile kilitli (`:50,:122`). `get_product_modifiers`, `get_table_ready_status`, `get_all_table_statuses` **kapısız** (`:12,:157,:191`).
- **Frontend:** `FLOOR` + `POS` view, `TableActionModal`, `CartPanel`, `ModifierModal`.
- **Eksik:** `paymentTake` CONDITIONAL (`navigationMatrix.ts:93`) — ödeme ekranı kapalı, doğru. **Karson karnesi yok** (Faz 10'da planlandı, `rg "waiter_kpi" backend/migrations/schema.sql` → 0; `staff360/kpi_service.rs:132` var ama garson bazında kasa karnesi değil).

### KITCHEN (mutfak)
- **Backend:** 4 komut (`kitchen_commands.rs`): `get_stations`, `create_station`, `update_kds_item_status`, + `commands::kds_*` (2). **`create_station` kapısız** — `rg "require_" kitchen_commands.rs` → 0 sonuç. Kimse istasyon tablosuna satır yazabilir.
- **Frontend:** `KdsContainer` (934 satır — sınır ihlali), `KdsWorkflowManager` (451, istasyon yönlendirme + iş yükü raporu).
- **Eksik:** Gecikme alarmı yok. Hazırlık listesi yok. İstasyon yönlendirme **frontend belleğinde** (`KdsWorkflowManager` singleton), DB'de `station_queue` tablosu yok — iki mutfak terminali arasında senkron yok.

### MÜŞTERİ (dış aktör)
- **Backend:** 6 komut (`lib.rs:273-279`): `qr_customer_session_open/revoke`, `qr_menu_build`, `qr_pending_requests`, `qr_request_accept/reject`, `qr_feedback_create`.
- **Frontend:** **Sıfır.** `rg "external360\|qr_menu" desktop/src` → 0.
- **Eksik:** Portal yok. QR görüntüsü üreten bir yüzey yok. `customer_sessions`, `customer_orders`, `customer_feedback` tabloları var ve kullanılıyor, ama **kimse okuyamıyor**.

### TEDARİKÇİ (dış aktör)
- **Backend:** 3 komut (`lib.rs:280-282`) + envanter tarafında 8 komut (`supplier_commands.rs`).
- **Frontend:** `owner/inventory/SupplierPanel.tsx` — **envanter tarafı** var, `external360/supplier.rs` tarafının UI'ı yok.
- **Eksik:** Tedarikçi portalı yok. `supplier_request_export` çıktısı dosya üretir ama indirme yüzeyi yok.

### MALİ MÜŞAVİR (dış aktör)
- **Backend:** 2 komut (`lib.rs:283-284`), `accountant_reports` tablosu, imza zinciri.
- **Frontend:** **Sıfır.** `rg "accountant" desktop/src` → 0.
- **Eksik:** Ekran/portal yok. `data/ebilge/` (6 dosya) ve `data/fiscal/` (3 dosya) kodu yazılmış ama **çağrılmıyor** — ölü kod.

### TEKNİK SERVİS (dış aktör)
- **Backend:** 3 komut (`lib.rs:285-287`), `service_tickets` tablosu.
- **Frontend:** **Sıfır.**
- **Eksik:** Portal yok. `issueReport` yetki satırı 6 role de FULL tanımlı (`navigationMatrix.ts:103`) ama **karşılığı olan tek bir komut yok** — ölü yetki satırı.

---

## BÖLÜM 5: ALTYAPI DURUMU

| Katman | Durum | Eksik |
| :--- | :--- | :--- |
| **Şema** | **88 tablo** (`schema.sql` 88 `CREATE TABLE`) + `schema_migrations` = 89 | PLAN §2'de "eksik" denilen 13 tablonun **tamamı** var: `reservations`, `staff_profiles`, `shifts_handover`→`shift_plans`, `campaigns`, `legal_documents`, `support_tickets`→`service_tickets`, `two_factor`→`two_factor_secrets`, `audit_log_categories`→`audit_ledger.category`, `personal_withdrawals`→`general_expenses`, `dynamic_pricing_rules`, `kitchen_prep_lists`→**yok**, `waiter_kpi`→`tip_distributions` farklı kavram, `campaign_templates`, `special_days`. 2 gerçek eksik: `kitchen_prep_lists`, `waiter_kpi` |
| **Backend komutları** | **234** kayıtlı komut (`lib.rs`) — frontend'in çağırdığı: **65** | **169 komutun frontend karşılığı yok.** Bunların çoğu Faz 11-16 (envanter, personel, yasal, dış aktörler). Komut/ekran oranı 1:0.28 |
| **Servisler** | 80 servis dosyası (test hariç), 1 repository (`payment_repository.rs:333`) | Repository katmanı **yok denecek kadar zayıf**: 225 `.rs` dosyasının 1'i repository. SQL doğrudan komutların içine gömülü |
| **Testler** | 863 backend + 553 frontend (40 dosya) = **1416** | E2E Playwright: **11 spec var, 0 çalıştırılmış** — `vite.config.ts` `exclude: ['**/e2e-playwright/**']` ile vitest'ten dışlanmış, `npm run test:playwright` çalıştırılmamış. Ayrıca `tests/e2e/systemOrchestration.test.ts` var ama vitest include'unda `tests/**` olduğu için çalışıyor |
| **Güvenlik** | 13 P0 kilidin **13'ü** doğrulandı + Faz 15'in 7 modülü (`security360/mod.rs:18-24`) | **3 kapısız komut grubu**: `get_shift_summary`, `kitchen_commands` (4 komut), `waiter_commands` içindeki 3 okuma komutu. **FID-256 yerine** Argon2id var (`AGENTS.md` güncel) |
| **Feature flags** | 11 bayrak **tanımlı** (`useFeatureFlags.ts:3-14`, `auth_commands.rs:117-120` herkese dağıtılıyor) | **4 bayrak arkasında kod yok**: `feat_seat_split`, `feat_delivery`, `feat_caller_id`, `feat_qr_menu` (backend'de `qr_menu` komutları bayrak kontrolü **yapmıyor** — `rg "feat_qr_menu" backend/src/inventory360_commands` → 0). Bayrağın AÇIK/KAPALI listesi `useFeatureFlags.ts:51-57`'deki `defaults` dizisinden geliyor, **AGENTS.md §8'deki listeden değil** — iki kaynak ayrışmış |

### Ek kapı ihlalleri

| Kural | Ölçüm | Sonuç |
| :--- | :--- | :--- |
| AGENTS.md §10 — dosya ≤ 500 satır | `backend/src` | **7 dosya** aşıyor (`platform_commands.rs` 860, `modifier_service_tests.rs` 611, `approval_service.rs` 554, `payment_approval_tests.rs` 540, `audit_service_tests.rs` 516, `reservation_service.rs` 511, `modifier_service.rs` 504) |
| AGENTS.md §10 — bileşen ≤ 300 satır | `desktop/src` | **37 `.tsx` aşıyor**. En büyük 5: `CashierWorkstationContainer.tsx` 1998, `OwnerInventoryTab.tsx` 1294, `PlatformSetupWizard.tsx` 950, `KdsContainer.tsx` 934, `sidebar.tsx` 721 |
| AGENTS.md §5 — `design-system/` klasörü | `Test-Path desktop/src/design-system` | **False** — tasarım sistemi klasörü hiç oluşturulmamış. `core/components/ui/` (23 shadcn dosyası) duruyor |
| AGENTS.md §3.4 — finansal sessiz hata | `rg "unwrap_or\(0\)" backend/src` | **2 gerçek ihlal**: `report_service.rs:148-149` (`revenue`, `order_count` — `orders` tablosundan para okuması, kapsamda), `directories.rs:116` (`credit_limit_cents` — `unwrap_or(0)` ama `try_get` zaten `?` ile yükseltilmiş, bu yüzden **ihlal değil**, `Option`→0 meşru) |
| AGENTS.md §3.1 — `unwrap()/expect()` prodüksiyonda | `rg "unwrap\(\)\|expect\(" backend/src` (test dışı) | **3 satır**: `lib.rs:47,53,334` — `run()` bootstrap. `expect("Failed to create Tokio runtime")` çalışma zamanı hatası halinde uygulamayı düşürür; AGENTS.md metnine göre ihlal |
| AGENTS.md §3.2 — emoji | `rg -cP "[\x{1F300}-\x{1F9FF}]" desktop/src` | **3** (`PlatformSetupWizard.tsx:305,315,859`) |
| AGENTS.md §3.2 — gradient | `rg -c "bg-gradient" desktop/src` | **4** (`KdsContainer.tsx:778`, `ImpersonationBanner.tsx:33`, `MasterVaultModal.tsx:243`, `PlatformSetupWizard.tsx:390`) |
| AGENTS.md §3.2 — palet dışı renk | — | `from-red-600 via-rose-600 to-amber-600` (ImpersonationBanner:33), `from-purple-600 to-indigo-600` (MasterVaultModal:243) — Apple paletinde yok |
| Kalite kapısı — `cargo fmt --check` | `cargo fmt --check` | **760 sapma** (YAPILACAKLAR.md:41 "736" yazıyor, ölçüm bugün 760) |
| Kalite kapısı — `cargo clippy --all-targets` | `cargo clippy` | **93 uyarı** |
| TS katmanları | `desktop/src` | 276 dosya: `components/`, `core/`, `data/`, `domain/`, `presentation/`. `data/ipc/tauriInvoke.ts` **4492 satır** — içinde 1000+ satır tarayıcı mock'u; üretim IPC'si ile mock aynı dosyada |

---

## BÖLÜM 6: FAZ 17 İÇİN ÖNCELİK LİSTESİ

### 1. [KRİTİK] Frontend sıfırdan — Apple HIG + Liquid Glass

En büyük borç: **169 backend komutunun ekranı yok** ve mevcut 65 ekran **tarayıcı mock'uyla** çalışıyor (`tauriInvoke.ts:4487` — `isBrowser()` → `browserMock`). Yani gerçek backend ile arayüz hiç e2e bağlı değil. `design-system/` klasörü yok.

Alt kırılım:
- 1a. `design-system/` kur: tokens (colors, spacing, radius, shadows, motion, typography) + `GlassSurface`/`FloatingSidebar`/`FloatingTopBar`/`GlassModal` (§4.3-4.7 palet ve cam fiziği birebir)
- 1b. `tauriInvoke.ts`'i 4492 → repository katmanı (`data/ipc/TauriXRepository.ts` deseni zaten `TauriPOSRepository.ts:29`'da var). Mock `tests/` altına
- 1c. **Faz 14 ekranları** (7): yasal belgeler, özel gün, kampanya, kupon girişi, sigorta, telif, e-Arşiv kuyruk
- 1d. **Faz 16 ekranları** (4): müşteri QR, tedarikçi portalı, mali müşavir, teknik servis
- 1e. **Faz 15 ekranları** (3): oturum, 2FA, onay modalı — `InstantPinApprovalModal.tsx` **var** (Faz 3), `verify_manager_pin` **var**; sadece `cash_out`/`close_day` bağlantısı ve 2FA sihirbazı eksik
- 1f. Maskeleme UI'si (`mask.rs:493` hazır, 8 personel + cari ekranı çıplak)
- 1g. Component ≤300 satır: **37 dosya** bölünmeli, `CashierWorkstationContainer.tsx` (1998) en büyüğü

### 2. [KRİTİK] Temizlik — emoji, gradient, palet, ölü kod

| İş | Dosya:satır |
| :--- | :--- |
| 3 emoji sil/kutu ikonu yap | `PlatformSetupWizard.tsx:305,315,859` |
| 4 gradient kaldır | `KdsContainer.tsx:778`, `ImpersonationBanner.tsx:33`, `MasterVaultModal.tsx:243`, `PlatformSetupWizard.tsx:390` |
| Palet dışı renk | `ImpersonationBanner.tsx:33` (`red-600/rose-600/amber-600`), `MasterVaultModal.tsx:243` (`purple-600/indigo-600`) |
| Ölü kod: e-Arşiv entegratörleri çağrılmıyor | `desktop/src/data/ebilge/` (6), `data/fiscal/` (3) |
| Ölü yetki satırı | `navigationMatrix.ts:103-110` `issueReport` → komut yok |
| Ölü bayrak: `feat_seat_split` AÇIK ilan edilmiş, kodu yok | `useFeatureFlags.ts:9,70` |
| Bayrak kaynağı çift | `useFeatureFlags.ts:51-57` `defaults` dizisi ≠ AGENTS.md §8 listesi |
| `Cargo` 760 fmt + 93 clippy | `cargo fmt`, `cargo clippy` |
| 3 `expect()` | `lib.rs:47,53,334` |

### 3. [KRİTİK] Finansal sessiz hata — `report_service.rs:148`

```rust
let total_revenue_cents: i64 = row.try_get("revenue").unwrap_or(0);   // :148
let total_orders: i64 = row.try_get("order_count").unwrap_or(0);     // :149
```

Bu ikisi `orders` tablosundan **para** okuması yapıyor ve AGENTS.md §3.4'ün tam kapsamında. SQL hatası olursa ciro `0` döner, ortalama sepet `0` olur ve P&L "zarar yok" der — sessiz, hatasız, yanlış. `cashier_commands.rs:274-286` doğru deseni gösteriyor (`map_err(|e| e.to_string())?`), `report_service.rs` o deseni kullanmıyor. `ledger_commands/security_tests.rs:292-303` bu hatanın regresyon testini zaten yazmış — `report_service.rs` için aynı test eklenmeli.

### 4. [KRİTİK] 3 kapısız komut grubu — rol kapısı borcu

| Komut | Dosya:satır | Risk |
| :--- | :--- | :--- |
| `get_shift_summary` | `cashier_commands.rs:255` | Vardiya özeti. `tenant_id` filtresi var, **rol kapısı yok**. `rg "require_" cashier_commands.rs` → 0 |
| `create_station` | `kitchen_commands.rs` | `rg "require_" kitchen_commands.rs` → **0**. İstasyon tablosuna herkes yazabilir |
| `waiter_commands` 3 okuma | `waiter_commands.rs:12,157,191` | `get_product_modifiers`, `get_table_ready_status`, `get_all_table_statuses` — rol alanı bile imzalarında yok |

`floor_plan_commands.rs:158,183,221,258,296,331,365` yedi komutta `require_any(&actor_role, ...)` kullanıyor — **doğru desen**. `platform_commands.rs` (860 satır) ve `cashier_commands.rs` bu deseni uygulamıyor.

### 5. [YÜKSEK] 500 satır borcu — backend (7 dosya)

| Satır | Dosya |
| :---: | :--- |
| 860 | `platform_commands.rs` |
| 611 | `services/modifier_service_tests.rs` |
| 554 | `approval_service.rs` |
| 540 | `services/payment_approval_tests.rs` |
| 516 | `services/audit_service_tests.rs` |
| 511 | `services/reservation_service.rs` |
| 504 | `services/modifier_service.rs` |

**Not düzeltmesi:** YAPILACAKLAR.md:102-108 bu listeyi 861/612/554/541/517/512/505 olarak yazıyor. Bugünkü ölçüm 860/611/554/540/516/511/504 — dosyalar değişmemiş, ölçüm farkı satır sonu sayımı. `audit_service.rs` **276** satır (test eşine karıştırılmamalı, YAPILACAKLAR.md:110-111 zaten uyarıyor).

### 6. [YÜKSEK] `platform_commands.rs` bölünmesi (860 satır)

Cihaz komutları zaten `platform_commands/devices.rs:335`'e taşınmış (iyi örnek). Kalan 860 satır: tenant CRUD + modül yönetimi + audit + IT ops + credential. 4 alt modüle bölünmeli.

### 7. [YÜKSEK] 37 bileşen 300 satır sınırını aşıyor

`CashierWorkstationContainer.tsx` 1998 · `OwnerInventoryTab.tsx` 1294 · `PlatformSetupWizard.tsx` 950 · `KdsContainer.tsx` 934 · `sidebar.tsx` 721 · `ITOpsModals.tsx` 577 · `InventoryManagementPanel.tsx` 564 · `DomainConflictResolver.ts` 533 · `BackgroundSyncWorker.ts` 691 · `useCartStore.ts` 621 · `OfflineSyncQueue.ts` 619 · `tauriInvoke.ts` 4492

### 8. [YÜKSEK] Tek tarih yardımcısı — `localtime` 2 dosyada, 8 satırda

YAPILACAKLAR.md:50-54, 94-96 "tek yardımcı yok" diyor. Bugünkü ölçüm: `rg "localtime" backend/src` → **8 eşleşme, 2 dosya** (`print_commands.rs`, `external360/accountant.rs`). `services::is_tarih` gibi bir yardımcı hâlâ yok (`rg "is_tarih" backend/src` → yalnız test fonksiyon adı). Bu, `print_commands.rs:319` UTC borcunun **çözülmüş hali** — YAPILACAKLAR.md:47-48, 89-92 doğru, bu madde artık var olmayan bir borcu tarif ediyor, yeniden yazılmalı.

Ayrıca: `rg "date\('now'" backend/src` → 8 eşleşme. Rapor gruplama sorguları hâlâ UTC gün sınırı arıyor olabilir (YAPILACAKLAR.md:52-54 bunu bilinçli kapsam dışı bırakmış, tarama yapılmamış).

### 9. [ORTA] Bulut yedek + Docker

- **Bulut yedek:** AGENTS.md §3.1 harici bulutu yasaklıyor. PLAN §5 karar #3 hâlâ cevapsız. Yerine **lokal şifreli yedek** (yedekleme #39) uygulanabilir — `rg "auto_backup" .` → 0, `schema.sql`'da yedek tablosu yok.
- **Docker:** `Get-ChildItem Dockerfile*` → **0 dosya**. `docker-compose*` → 0. Hiç başlanmamış.
- **`mobile/`:** boş. Faz 16 "dosya tabanlı takas" ile geçildi (`lib.rs:272` yorumu).

### 10. [ORTA] E2E testler çalıştırılmıyor

`desktop/tests/e2e-playwright/` → **11 spec** (`waiter`, `security`, `reservation-flow`, `owner`, `master`, `manager`, `ledger-receipt`, `kitchen`, `cashier`, `branch-management`, `systemOrchestration`). `vite.config.ts` bunları vitest'ten dışlıyor. `npm run test:playwright` **hiç çalıştırılmamış** — 553 vitest testinin hepsi mock katmanında. Gerçek backend'e giden tek doğrulama `cargo test`'in 863'ü.

### 11. [ORTA] Feature flag matrisi arayüzü

11 bayrak `useFeatureFlags.ts:3-14`'te tanımlı, `auth_commands.rs:117-120`'da herkese dağıtılıyor, `update_tenant_modules` komutu çalışıyor. Eksik: (a) **4 bayrak arkasında kod yok** (`feat_seat_split`, `feat_delivery`, `feat_caller_id`, `feat_qr_menu` — `qr_menu` komutları bayrak kontrolü yapmıyor), (b) tek kaynak yok (`useFeatureFlags.ts:51` `defaults` dizisi AGENTS.md §8'den ayrışmış), (c) MASTER için 11 bayraklık **matris görünümü** yok.

### 12. [DÜŞÜK] i18n ve a11y

- **i18n:** `rg "useTranslation\|i18n" desktop/src` → **0**. Tüm metinler Türkçe ve gömülü (`Intl.NumberFormat('tr-TR')` 9 dosyada). AGENTS.md §3.2 zaten İngilizce metin yasaklıyor — **i18n bir gereklilik değil, sadece tek dilliğin tescili**.
- **a11y:** Kısmi. `role="dialog"` + `aria-modal` 3 modalda (`ReceiptViewerModal.tsx:113`, `InstantPinApprovalModal.tsx:121`), `useModalA11y.ts` hook'u var ve Escape/focus yönetiyor (`:31,:70`). Eksik: `ModalContainer` tek bir a11y sarmalayıcı değil, her modal kendi yolunu yazıyor; klavye navigasyonu POS'ta yok (faz 10).

### 13. [DÜŞÜK] Ek görev listesinden kalan 20 madde

Yukarıda Bölüm 3'te "hiç başlanmamış" işaretlenen 20 özellik. Öncelik sırasıyla: koltuk bazlı sipariş (bayrak zaten AÇIK ilan edilmiş — **bu bir tutarsızlık, ilk düzeltilmeli**), Alman usulü bölme, kişi sayısı + kuver, kasa Undo (30 sn), klavye kısayolları, kısayol çubuğu, çoklu sekme, KDS gecikme alarmı, termal fiş yönlendirme, mutfak hazırlık listesi, masa devri/bekleme listesi, müşteri tercih takibi, denetim modu, bilgi tabanı, akıllı para üstü, termal yazıcı durum göstergesi, kartla bahşiş, RFID geçiş, yemek kartları, local otomatik yedekleme.

---

## ÖZET SAYILAR

| Ölçüm | Değer |
| :--- | ---: |
| Toplam commit | 29 |
| Tamamlanan faz | 20 (Faz 0-16, backend) |
| Backend komutu | 234 |
| Frontend'in çağırdığı komut | 65 |
| **Ekransız backend komutu** | **169** |
| Tablo | 88 |
| Servis dosyası | 80 |
| Repository | 1 |
| Backend test | 863 |
| Frontend test | 553 |
| **Toplam test** | **1416** |
| Playwright spec (çalıştırılmamış) | 11 |
| Backend dosya (500+ satır) | 7 |
| Frontend bileşen (300+ satır) | 37 |
| Emoji ihlali | 3 |
| Gradient ihlali | 4 |
| Palet dışı renk dosyası | 2 |
| Feature flag | 11 (4'ü arkasız) |
| `cargo fmt` sapması | 760 |
| `cargo clippy` uyarı | 93 |
| Finansal `unwrap_or(0)` ihlali | 1 (`report_service.rs:148-149`) |
| Rol kapısı olmayan komut grubu | 3 |
| Ek görev: VAR | 8 |
| Ek görev: KISMİ | 10 |
| Ek görev: YOK | 22 |
