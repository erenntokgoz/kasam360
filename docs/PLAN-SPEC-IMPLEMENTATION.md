# KASAM360 — Spesifikasyon Uygulama Planı (v1, onay bekliyor)

> Bu belge uygulama yapmaz. Yalnızca fazları, bağımlılıkları ve mevcut kodla
> çelişkileri tanımlar. Onay olmadan kod değişikliği yapılmayacaktır.

## 0. Ölçülen Taban Durum (Baseline — 2026-10-01)

| Kapı | Sonuç | Not |
| :--- | :--- | :--- |
| `cargo check` | ✅ 0 hata | Derleme temiz |
| `npx vitest run` | ✅ 27 dosya / 268 test PASS | |
| `npx tsc --noEmit` | ❌ **1471 hata** | Tamamı `tests/**` altında; `src/**` içinde **0** hata. Neden: `tsconfig.json` `include: ["src","tests"]` ama vitest global tipleri (`describe/it/expect`) tsconfig'e tanımlı değil. **Bu, koddan değil yapılandırmadan kaynaklanan mevcut bir borçtur.** |
| Emoji taraması | ✅ 0 | |
| Gradient taraması | ⚠️ **37 ihlal** | `bg-gradient-*` / `from-*` / `via-*` kalıpları mevcut. Spec bunlara dokunmayan ekranlar yazıyor; temizlik ayrı faza alınmalı. |
| `any` taraması | ✅ 0 (src) | |
| `unwrap()/expect()` | ✅ 0 | |

**Doğrulama komutları** (her faz sonunda çalıştırılacak):
```
cd backend && cargo check
cd backend && cargo test
cd desktop && npx tsc --noEmit
cd desktop && npx vitest run
```

**Karar gereken (Faz 0):** 1471 tip hatası mevcut tabanı kirletiyor. Aşağıdaki fazlar
boyunca "hata sayısı artmadı" yerine "hata sayısı **azaldı**" kapısı uygulanacak;
`tests/**` tipleri `tsconfig`e vitest `types` ile dahil edilerek kapatılacak.

---

## 1. Kritik Çelişkiler (Spec ↔ AGENTS.md ↔ Mevcut Kod)

AGENTS.md "en üst otorite" ilan edildiği için bunlar **kod yazılmadan** çözülmeli.

### C-1 — Emoji yasağı ↔ Spec emoji talebi (BLOKLAYICI)
Spec'te emoji şart: vade rozetleri `🔴🟡🟢`, `"🛡️ Mühürlü"` rozeti.
AGENTS.md §3.2 emoji'yi UI'da **kesin yasaklar**.
→ Öneri: rozetler Apple sistem renkleriyle **renk + ikon + metin** olarak yeniden
tasarlansın (`Mühürlü` rozeti zaten mevcut AGENTS.md'de metin olarak tanımlı;
emoji değil). Bu, AGENTS.md'ye aykırı değildir.

### C-2 — Renk yasağı ↔ Spec buton renkleri (BLOKLAYICI)
Spec §2.3: `[+ Gelir]` zümrüt, `[- Gider]` gül, `[Borç Ekle]` **kehribar turuncusu**,
`[Alacak Ekle]` gök mavisi; §1.8 turuncu destek banner'ı.
AGENTS.md §3.2 turuncu butonu yasaklar; §4.2 dışında renk kullanmayı yasaklar.
→ Öneri: `[Borç Ekle]` turuncu yerine **warning #FF9F0A / #FF9500** tonu (palet içi),
diğerleri mevcut `success/danger/info` tokenları. Banner turuncu yerine
`warning` tokenı. Bu palet içidir, yeni renk gerekmez.

### C-3 — Çift yönetim yüzeyi (BLOKLAYICI)
Spec §2.6 "Onaylar sekmesi KALDIRILDI", §2.7 "Modifier sekmesi KALDIRILDI",
§2.8 "Şubeler sekmesi MASTER'A KİLİTLENDİ", §2.4 "Satışlar + Operasyonel Raporlar
BİRLEŞTİRİLDİ", §2.9 "Geçmiş Fişler Hesap Defteri'ne taşındı".
Mevcut `OwnerDashboardContainer.tsx:73-85` bu beş sekmeyi **hepsini** içeriyor ve
`ApprovalsPanel`/`OwnerModifiersTab`/`OwnerBranchesTab` dosyaları bu sekmelere bağlı.
→ Bu bir **kaldırma + birleştirme** işi; dosya silme değil, önce içerik
`CategoryForm`/`ProductForm`/Hesap Defteri'ne **taşınacak**, sonra sekme kaldırılacak.

### C-4 — Ham hash UI'da (mevcut ihlal)
`OwnerAuditLogsTab.tsx:371,433` ham `current_hash` gösteriyor ve kopyalatıyor.
AGENTS.md §3.2 bunu zaten yasaklıyor; Spec §2.5 de gizlenmesini söylüyor.
→ Düzeltme Faz 2'de. Hash gösterimi yalnız MASTER'a açık kalacak.

### C-5 — `kasam360eski` taşınamaz kod (BLOKLAYICI)
`kasam360eski/backend` = **Node + Express + Mongoose** (`server.js`, `*.js`,
ObjectId, MongoDB aggregate pipeline). Hedef = **Rust + Tauri + SQLite**.
Spec §2.3 "her şey buraya taşınacak" diyor, ancak **kod kopyalanamaz**; yalnızca
**iş kuralları/hesap formülleri** taşınabilir.
→ Öneri: eski dosyalar **salt-okunur referans** sayılır; taşınacak olan
`directoryService` net bakiye (AR−AP) formülü, `debtService` kısmi tahsilat,
`recurringTransactionService` tekrarlayan kayıtlar, `budgetAlertService` bütçe
uyarısı, `reportService` finansal rapor üretimi, `dashboardService` KKP kartları,
`debtReminderService` vade hatırlatması, `auditLogService` (eski→yeni değer
gösterimi) ve `monthlyArchiveService`. Hepsi Rust/SQLite'a **yeniden** yazılacak.

### C-6 — Kasa mutabakatı mevcut yapıyla çelişiyor
Spec §3.3 "Z-Raporu mühürleme", §4.6 "Z-Raporu" var; `close_day` AGENTS.md kilidi #3
gereği açık sıfırlama yapmamalı. Mevcut `EndOfDayContainer` (1600 satır) Z-Raporu
içeriyor. → Yeni özellik **sıfırlamayı genişletmemeli**, mevcut korumayı korumalı.

### C-7 — Feature flag / route 404 kuralı
Spec §2.8 şube yönetimi MASTER'a; AGENTS.md §8 `feat_multi_branch` **KAPALI**,
kapalıyken route 404 dönmeli. → Master panelindeki şube sekmesi
`feat_multi_branch` ve MASTER rolüyle çift korumaya alınacak.

### C-8 — Dış bağımlı modüller (QR Menü, Paket Servis, WhatsApp Bot, Kiosk,
Müşteri uygulaması, Tedarikçi/Mali Müşavir/Teknik Servis portalları)
Spec bunları ayrı kullanıcı tipleri olarak istiyor. **Ama** AGENTS.md §1 yapıyı
`desktop + backend + mobile (boş)` olarak tanımlıyor ve §3.1 harici bulut/OCR
yasak.
→ 2 ayrı karar gerekiyor (aşağıda "Kullanıcı Kararları" #1 ve #2).

---

## 2. Mevcut Kod ile Şimsiyet Eşlemesi

| Spec maddesi | Mevcut durum | Dosya |
| :--- | :--- | :--- |
| §2.3 Hesap Defteri 5 sekme | ✅ Zaten var (+ `GECMIS_ARSIV` 6.) | `endofday/EndOfDayContainer.tsx:133` |
| §2.5 Denetim log | ⚠️ Var ama hash sızıyor | `owner/ui/OwnerAuditLogsTab.tsx:371` |
| §2.10 Personel 360° (6 sekme) | ⚠️ Kısmi (5 maaş modeli yok) | `owner/ui/OwnerStaffTab.tsx` |
| §2.11 Menü yönetimi | ⚠️ Var; modifier ayrı sekmede | `owner/ui/OwnerMenuTab.tsx`, `OwnerModifiersTab.tsx` |
| §2.12 FIFO / reçete | ✅ Var (`inventory_batches`) | `schema.sql:287`, `domain/usecases/inventory/FifoCostCalculator.ts` |
| §11 Rezervasyon | ❌ **Çelişki**: `Rezerve Et` DOLU masada var | `floor/FloorPlanContainer.tsx:180`, `floor/ui/TableActionModal.tsx` |
| §11 Hareketsizlik 35dk | ⚠️ Var (mevcut süre?) | `floor/ui/TableTimer.tsx` |
| §11 Eşzamanlı adisyon kilidi | ✅ Var | `try_lock_table` komutu |
| §12 Kroki çizim | ❌ Yok | — |
| §2.2 Şube yönetimi | ⚠️ OWNER erişebiliyor (ihlal) | `owner/ui/OwnerBranchesTab.tsx` |
| §2.16 WhatsApp Bot | ❌ Yok (kabul: harici API bağımlı) | — |
| §2.14 e-Arşiv / ÖKC | ⚠️ İskelet var | `data/ebilge/*`, `data/fiscal/*` |
| §34 Yetki matrisi | ⚠️ `App.tsx:41-74` view bazlı, ince yetki | `App.tsx`, `GlobalNav.tsx:22-28` |

**Eksik şema tabloları** (spec'in gerektirdiği, `schema.sql`'de olmayan):
`reservations`, `staff_profiles` (maaş modeli/bahşiş/zimmet), `shifts_handover`,
`campaigns`, `legal_documents` (denetim takvimi), `support_tickets`,
`two_factor`, `audit_log_categories`, `personal_withdrawals`,
`dynamic_pricing_rules`, `kitchen_prep_lists`, `waiter_kpi`,
`campaign_templates`, `special_days`.

---

## 3. Bağımlılık Grafiği

```
Faz 0  Test/tsconfig temizliği  (bağımsız, diğer her şeyin önünde)
  └─> Faz 1  Yetki çekirdeği (RBAC + ince yetki + role-view matrisi)
        └─> Faz 2  Denetim Logu kapsam genişletme + hash gizleme  [C-4]
              └─> Faz 3  Anlık PIN onay modalı + 2sn toast  → Onaylar sekmesini SİL  [C-3]
                    └─> Faz 4  Modifier gömme  → Modifier sekmesini SİL
                          └─> Faz 5  Satış + Operasyonel birleşik rapor merkezi
                                └─> Faz 6  Şube kilidi (OWNER'dan kaldır)  [C-7]
                                      └─> Faz 7  Geçmiş Fişler → Hesap Defteri
                                            └─> Faz 8  Rezervasyon düzeltmesi  [§11]
                                                  └─> Faz 9  Hesap Defteri derinleştirme (kasam360eski)
                                                        └─> Faz 10 Rapor analiz merkezi
                                                              └─> Faz 11 Personel 360°
                                                                    └─> Faz 12 Menü/Stok derinleştirme
                                                                          └─> Faz 13 Kroki çizim
                                                                                └─> Faz 14 Yasal/Özel Gün
                                                                                      └─> Faz 15 Güvenlik sertleştirme
Faz 16 Dış aktörler (müşteri/tedarikçi/mali müşavir/teknik servis)  [C-8 kararına bağlı]
```

**Kritik yol:** Faz 0 → 1 → 3. Bunlar diğer tüm fazların ön şartıdır çünkü
sekme kaldırma işlemleri (3,4,6,7) testlere ve yetkiye bağlıdır.

---

## 4. Fazlar

### Faz 0 — Test & Yapılandırma Temizliği (bağımsız)
**Amaç:** 1471 tip hatasını kapatarak sonraki fazlarda regresyon görünürlüğü sağlamak.
- `tsconfig.json`: vitest global tipleri (`"types": ["vitest/globals"]`)
- `tsconfig` içine `src` ve `tests` ayrımı; `tests/**` için ayrı `tsconfig.test.json`
- 3 adet `.bak` test dosyası (`ownerManagementAppleHigUi.test.ts.bak`,
  `globalNavGlassmorphism.test.ts.bak`, `floorPlanGlassmorphism.test.ts.bak`) —
  bunlar vitest'e girmiyor, silinmeli veya `__fixtures__` altına alınmalı
- Gradient 37 ihlalinin envanteri (fazlara dağıtılacak, tek pakette değil)
**Kapı:** `npx tsc --noEmit` → 0 hata, `vitest run` → 268 PASS, `cargo check` → 0.
**Bağımlılık:** yok. **Bağımlı olan:** her şey.

---

### Faz 1 — Yetki Çekirdeği (RBAC)
**Amaç:** Spec §34 matrisini tek kaynaktan yönetmek; `App.tsx:41-74` ve
`GlobalNav.tsx:22-28` içindeki dağınık rol kontrollerini tek yere toplamak.
- `domain/permissions/roleMatrix.ts`: 6 rol × 18 özellik matrisi (spec §34 birebir)
- `usePermission(key)` kancası; menü görünürlüğü + route guard tek kaynaktan
- Backend: her komut giriş noktasında tablo bazlı rol kontrolü (`platform_commands.rs`
  ve `management_commands.rs` hâlihazırda `actorRole` parametresi alıyor —
  bunlar merkezileştirilecek)
**Kapı:** `roleNavigationMatrix.test.ts` güncellenir, yeni tablo-bazlı testler.
**Not:** Bu faz spec'in en değerli ve en az görünür yatırımıdır; sonraki tüm
kaldırma işlemlerinin güvenlik ağı buradan gelir.

---

### Faz 2 — Denetim Logu (8 kategori + hash gizleme)
**Amaç:** Spec §2.5 / §18.
- Şema: `audit_ledger` kategori sütunu (`action` zaten var; 8 kategori sabiti)
- Backend: eksik işlemler loglanır — sipariş/masa taşıma, ödeme iptal-kısmi-iade,
  finans, personel, menü, yetki, sistem, güvenlik
- UI: ham hash **kaldırılır**, yerine `Mühürlü` rozeti (metin + ikon, emoji değil)
- "Eski Değer → Yeni Değer" sütunu; filtreler (personel, kategori, tarih, arama)
- Excel/CSV/PDF dışa aktarma
- **Hash görünürlüğü:** yalnız MASTER (`get_platform_audit_logs` ayrı komutta kalır)
**Çelişki:** C-4, C-1 (rozet tasarımı)

---

### Faz 3 — Anlık PIN Onayı (Onaylar sekmesi yerine)
**Amaç:** Spec §2.6, §3.2, AGENTS.md §6.
- Void / indirim / ikram → `GlassModal` anlık PIN (mevcut `ApprovalsPanel.tsx:255-331`
  PIN dialog mantığı yeniden kullanılacak; sekme değil, modal olacak)
- Uzak onay → toast bildirimi, toplam 2 saniye, Onayla/Reddet
- Gün sonu listesi İptal/İade/Zayi raporuna düşer
- `OwnerDashboardContainer` 'approvals' sekmesi **kaldırılır**;
  `ApprovalsPanel` yeniden adlandırılıp `InstantPinApprovalModal` olur
**Çelişki:** C-3. `ownerManagementAppleHigUi.test.ts:99` (`expect(html).toContain('Onaylar')`)
bu fazda **kaldırılacak** — test değişikliği spec gereğidir.

---

### Faz 4 — Modifier Gömme (Modifier sekmesi yerine)
**Amaç:** Spec §2.7, §13.
- `CategoryForm` → "Seçenekler & Ekstralar" sekmesi
- `ProductForm` → aynı sekme + fiyat farkı
- Kategori bazlı modifier şablonları (Burgerler → Pişme Derecesi, Kahveler → Süt)
- `OwnerModifiersTab.tsx` (652 satır) içeriği forma taşınır, sonra dosya silinir
**Çelişki:** C-3. `zeroGapFeatureMatrix.test.ts:324-346` backend komut testleri
korunur (UI sekmesi kaldırılıyor, komutlar yaşıyor).

---

### Faz 5 — Birleşik Rapor Merkezi
**Amaç:** Spec §2.4, §10.2.1.
- `OwnerSalesTab` (550 satır) + `ReportsPanel` (563 satır) → tek `ReportsHub`
- Alt yapılar: Zaman filtresi, İptal/İade/Zayi (kim onayladı), Denetim Log
- Dışa aktarma: Excel/CSV (UTF-8 BOM) + PDF
**Çelişki:** C-3.

---

### Faz 6 — Şube Kilidi (MASTER'a)
**Amaç:** Spec §2.8, AGENTS.md §6.
- `OwnerDashboardContainer` 'settings' sekmesi (şu an `OwnerBranchesTab`) kaldırılır
- OWNER'e yalnız **şube geçiş dropdown** verilir (TopHeader'a)
- `OwnerBranchesTab.tsx` → Platform modülüne taşınır
- `feat_multi_branch` kapalıyken route 404
**Çelişki:** C-3, C-7.

---

### Faz 7 — Geçmiş Fişler → Hesap Defteri
**Amaç:** Spec §2.9.
- `ReceiptsContainer.tsx` (1181 satır) → Hesap Defteri'ne sağ panel termal fiş detayı
- Tekrar yazdırma + iade/iptal hareketleri
- Bağımsız `RECEIPTS` görünümü kaldırılır (GlobalNav'dan çıkar)
**Çelişki:** C-3.

---

### Faz 8 — Masa / Rezervasyon Düzeltmesi
**Amaç:** Spec §11.
- DOLU masada `Rezerve Et` **kaldırılır** (`FloorPlanContainer.tsx:180` +
  `TableActionModal.tsx`)
- Boş masada sağ üstte "Hızlı Rezerve Et" ikonu
- Rezerve masada: "Rezervasyonu Kaldır" / "Müşteri Geldi"
- Hareketsizlik 35dk sarı pulse (mevcut `TableTimer`'a eklenir)
- Şema: yeni `reservations` tablosu (tümü `tenant_id` zorunlu)
- Eşzamanlı adisyon kilidi korunur/güçlendirilir
**Çelişki:** §11 "Dolu masada kaldırılacak" doğrudan mevcut davranışı tersine çevirir.

---

### Faz 9 — Hesap Defteri Derinleştirme (kasam360eski)
**Amaç:** Spec §2.3. **Bu fazın büyüklüğü spec'e göre en yüksek fazdır.**
- 4 cam aksiyon butonu (renk çelişkisi C-2 uygulanarak)
- 5 ayrıştırılmış rehber (Tedarikçi / Müşteri / Personel / Sabit Gider / Patron Şahsi)
- **Net bakiye motoru:** kayıt yığmak yerine birleştirme (AR−AP)
- Vade rozetleri (emoji yerine renk+i̇kon+metin, C-1)
- WhatsApp ekstre (kapsam dışı bırakılabilir — bkz. karar #3)
- Kısmi tahsilat/ödeme, tam kapatma
- Dürüst kasa mutabakatı, açılış bakiyeleri sihirbazı, bütçe uyarıları,
  tekrarlayan işlemler (kira, stopaj), P&L + Excel/PDF
- 80mm termal tediye makbuzu (imzalı çift nüsha)
- Veresiye ile masa kapatma (nakit kasaya dokunmaz); nakit çıkışı otomatik `cash_out`
- `recurring_expenses` ve `budget_limits` tabloları **zaten var** → genişletilecek
**Çelişki:** C-5 (kod kopyalanamaz), C-2 (renk), C-1 (emoji)
**Not:** Bu faz AGENTS.md §5 dosya boyutu kuralı (max 500 satır) ile birlikte
`ledger/` modülüne bölünmeli. `EndOfDayContainer.tsx` zaten **1600 satır** —
faz 9 öncesi bölünmesi gerekir.

---

### Faz 10 — Rapor & Analiz Merkezi
**Amaç:** Spec §2.4. BCG matrisi, ürün kâr marjı, kombinasyon, yoğun saat,
aylık hedef, rakip fiyat, kategori hacim, ödeme yöntemi kırılımı, garson karnesi,
masa devir süresi, iptal/zayi oranı.

---

### Faz 11 — Personel 360°
**Amaç:** Spec §2.10. 6 sekme, 5 maaş modeli, bahşiş havuzu (katsayılı),
garson KPI, şüpheli işlem radarı (>%30 kuralı), doğum günü, vardiya planlama,
izin, zimmet, tutanak sicili, soft-delete.

---

### Faz 12 — Menü & Stok Derinleştirme
**Amaç:** Spec §2.11, §2.12. Dinamik tarife, happy hour, 86'd, fiyat dondurma,
öğle/akşam menü, toplu fiyat güncelleme, yarı mamul reçete, randıman/fire,
kör sayım, birim çevrim, raf ömrü, tedarikçi karşılaştırma.

---

### Faz 13 — Kroki Çizim
**Amaç:** Spec §12. Görünüm seçici (Kroki/Kart), snap-to-grid sürükle-bırak,
masa döndürme, sandalye ekleme, mimari objeler, 4 hazır şablon, salon ısı haritası.
**Bağımlılık:** `tables` şemasına `x, y, rotation, seats, zone` sütunları.

---

### Faz 14 — Yasal & Özel Gün
**Amaç:** Spec §2.14, §2.15. Denetim takvimi (30/7/1 gün), e-Arşiv (mevcut iskelet),
KDV, müzik telif, sigorta, e-Adisyon + özel gün/kampanya yönetimi.

---

### Faz 15 — Güvenlik Sertleştirme
**Amaç:** Spec §15-22. Çok katmanlı giriş (mevcut + 2FA + RFID), şifre politikası,
oturum yönetimi, cihaz kaydı, kaba kuvvet, çift onay (>5.000₺), KVKK/GİB/HACCP/İSG.
**Not:** Mevcut P0 kilitlerin 13'ü zaten uygulanmış durumda; bu faz **yeni** olanları
(2FA, cihaz kaydı, çift onay eşiği, maskeleme) ekler.

---

### Faz 16 — Dış Aktörler (opsiyonel, karara bağlı)
**Amaç:** Spec §7 müşteri, §8 tedarikçi, §9 mali müşavir, §10 teknik servis.
**Engel:** Bunlar **ayrı uygulama/portallar** ister. Mevcut `mobile/` klasörü boş
ve AGENTS.md §1 yapıyı `desktop + backend + mobile` olarak tanımlıyor.
**Kapsam kararı gerekiyor** (aşağıda).

---

## 5. Kullanıcı Kararları (Onaydan Önce Cevaplanmalı)

1. **C-1/C-2 (emoji + turuncu):** Spec'teki emoji rozetleri ve kehribar turuncu
   buton yerine AGENTS.md paletine uygun **renk + ikon + metin** kullanılsın mı?
   *(Önerim: evet — AGENTS.md üst otorite.)*

2. **C-8 (dış aktörler):** Müşteri QR Menü / Tedarikçi / Mali Müşavir /
   Teknik Servis için **ayrı web portalı** mı, yoksa `mobile/` altında
   Tauri Mobile muhtelif mi? Bu, Faz 16'nın kapsamını tamamen belirler
   ve muhtemelen ayrı bir mimari kararıdır.

3. **WhatsApp/SMS/e-Arşiv entegrasyonları** gerçek API çağrısı mı, yoksa
   **arayüz + kuyruk + sahte sağlayıcı** mı? AGENTS.md §3.1 harici bulutu
   yasaklıyor; spec §2.14 GİB entegratörü istiyor. Bu karar Faz 9 ve Faz 14'ü
   doğrudan etkiler.

4. **Faz sırası onayı:** Yukarıdaki sırayla mı ilerleyelim, yoksa
   "en görünür değer" (Hesap Defteri + Raporlar) önce mi gelsin?

5. **`masterManagement`/`OwnerDashboardContainer` yeniden adlandırılsın mı?**
   Spec §2.2 patron panelinin "reddedildiğini" söylüyor; mevcut yapı
   `OwnerDashboardContainer` adını taşıyor. Tam yeniden yazım mı, kademeli mi?

---

## 6. Her Faz İçin Zorunlu Teslim Standardı

```
cd backend && cargo check           # 0 hata
cd backend && cargo test            # 100% pass
cd desktop && npx tsc --noEmit      # 0 hata (Faz 0'dan sonra)
cd desktop && npx vitest run       # 100% pass
Emoji taraması → 0
Gradient taraması → 0 (Faz 0'da envanterlenenler tek tek)
any taraması → 0
Dosya boyutu ≤ 500 satır, bileşen ≤ 300 satır
```

Her faz sonunda **duruş + onay** beklenir (AGENTS.md §11).
