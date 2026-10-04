# YAPILACAKLAR — FAZ 17

Bu dosya, backend-only fazlarda **kapsam dışı bırakılan** işlerin tek
adresidir. Buraya yazılan madde, faz kapısından geçmiştir; uygulanmamıştır.

Kural: bu dosyadaki hiçbir madde, ait olduğu fazın kapısı geçmeden uygulanamaz.
Aynı şekilde bu dosyaya yazılmamış bir iş, kapsam dışı sayılamaz.

---

## Faz 14'den kalanlar

### Frontend (arayüz)

Faz 14 yalnız backend + şema + test uyguladı. Aşağıdaki ekranlar **yok**:

- Yasal belgeler ekranı (CRUD + denetim takvimi + süresi geçenler rozeti)
- Özel gün ekranı (yıllık tekrarlar + indirim yüzdesi)
- Kampanya ekranı (kural editörü, kupon üretimi, istatistik kartları)
- Kupon girişi (POS kasada kupon alanı, kalan tutar güncellemesi)
- Sigorta poliçeleri ekranı (prim, teminat, süresi geçenler)
- Telif lisansları ekranı (MESAM / MSG / Bilgi Sistemi, ödeme tarihi)
- e-Arşiv ekranı (kuyruk listesi + durum makinesi, gönderim butonu **yok**:
  AGENTS.md §3.1 harici bulutu yasaklar)

Ekran kuralları: FloatingSidebar + FloatingTopBar, cam yüzeyler, koyu ve açık
mod, Türkçe metin, emoji ve gradient yok, tutarlar `tabular-nums`.

### Genel temizlik

- `campaign_tests.rs` 500 satır sınırını aştığı için `coupon_tests.rs`
  ayrıldı. Bu bir sonuç değil, izlenen kuralın uygulanmasıdır: benzer
  büyüme gösteren test dosyaları da bölünmeli.
- `kural_indirimi` ve `parse_campaign_rule` hâlâ `apply` alt modülünden
  dışarı açık; ikisi de yalnız test tarafından kullanılıyor. Gerekirse
  `campaigns/mod.rs` içine taşınmalı.
- Repo-geneli `cargo clippy --all-targets -- -D warnings` sıfır değil. Faz 14
  öncesi dosyalardaki uyarılar (satır sonu boşlukları, `digit_separators`,
  `doc_lazy_continuation`, fazla argüman) **bu fazda** düzeltilmedi. Kapı
  yalnız Faz 14 dosyaları için ölçüldü.
- Repo-geneli `cargo fmt --check` de temiz değil: **760** sapma var (ölçüm
  2026-10-05), tamamı Faz 14 öncesi dosyalarda. Neden bu fazda düzeltilmedi:
  `cargo fmt` kıtadaki tüm dosyaları yeniden biçimlendirir ve 108 dosyada
  yalnızca satır kaydırma değişikliği üretir — Faz 14'ün konusu olmayan
  kalabalık bir diff. Bu biçimlendirme kasıtlı olarak **geri alındı**; Faz 14
  dosyalarının kendisi biçimden temizdir.

---

## Faz 15'den kalanlar

Faz 15 (giriş güvenliği, KVKK maskeleme) yalnız backend + şema + test uyguladı.
Aşağıdakiler bilinçli olarak dışarıda bırakıldı.

### Faz 17 — arayüz (Faz 15 backend'i hazır, ekranları yok)

- **Oturum arayüzü.** `services/security360/session.rs` jeton üretiyor, doğruluyor,
  kapatıyor ve `session_policies.is_enforced` ile kiracı bazında zorunluluk
  ayarlıyor. Eksik olan: giriş sonrası jetonun **saklanması ve her komuta
  gönderilmesi**. `cashier_commands.rs` (`cash_out`) ve
  `day_close_commands.rs` (`close_day`) `session_token` argümanını bekliyor;
  arayüz göndermediği için bu iki komut bugün oturumsuz çalışıyor. Arayüz
  jetonu göndermeye başlayınca işletme sahibi `zorunlu_kil_ayarla` ile kapıyı
  **fail-closed** olarak açabilecek. Bu madde kapanmadan `is_enforced = 1`
  yapılmamalı: kapı açılırsa jeton göndermeyen çağrılar hata alır ve kasa durur.
- **2FA arayüzü.** `services/security360/two_factor.rs` hazır: gizli anahtar
  üretimi, Base32 kod üretimi, doğrulama, başarısız deneme sayacı (5) ve kilit
  (300 sn), kilitli hesaplar için kurtarma yolu. Eksik olan: kurulum sihirbazı
  (`pending_secret` → QR/manuel anahtar → ilk doğrulama) ve giriş ekranındaki
  ikinci alan.
- **Onay modalı (approval).** `approval_service` + iki taraflı onay akışı
  (`payment_approval_tests.rs`) hazır. AGENTS.md §6 gereği void/indirim/ikram
  **anlık PIN modalı** açmalı; modal yoksa bu işlemler yalnız API üzerinden
  yapılabiliyor.
- **Maskeleme arayüzü.** `services/security360/mask.rs` telefon/TCKN/e-posta
  maskeler; sunucu tarafı hazır. Eksik olan: personeller ve cari ekranlarında
  maskeli alanların kullanılması (bugün çıplak değer yazdırılıyor).

### 500 satır tavanı — gerçek borç

Aşağıdaki backend dosyaları §10'un 500 satır tavanını aşıyor (ölçüm 2026-10-05):

| Satır | Dosya |
|---|---|
| 860 | `platform_commands.rs` |
| 611 | `services/modifier_service_tests.rs` |
| 554 | `approval_service.rs` |
| 540 | `services/payment_approval_tests.rs` |
| 516 | `services/audit_service_tests.rs` |
| 511 | `services/reservation_service.rs` |
| 504 | `services/modifier_service.rs` |

Not: `services/audit_service.rs` **276** satırdır; 500'ü aşan dosya onun test
eşidir (`audit_service_tests.rs`, 516).

### UTC/yerel tarih çevrimi — tek yardımcı yok

`print_commands.rs:319` UTC → localtime maddesi **giderildi** (`67154b1`) ve
aynı sınıf hata üç modülde birden düzeltildi: `inventory360/pricing/bulk.rs`,
`inventory360/shelf_life.rs`, `print_commands.rs`. Bu yüzden bu başlığa
ayrı bir "fiş tarihi UTC alınıyordu" maddesi **yazılmaz** — yazılsa var
olmayan bir borç kaydedilmiş olur.

Kalan borç tek kalemdir: UTC/yerel çevrimi (`localtime`) hâlâ modül modül
ayrı yazılıyor, tek bir `services::is_tarih` gibi yardımcı yok. Ölçüm
2026-10-05: `rg "localtime" backend/src` → **8 eşleşme, 2 dosya**
(`print_commands.rs`, `services/external360/accountant.rs`).

Ayrıca **rapor gruplama** sorgularında başka UTC gün sınırl aranıyor
olabilir; tarama yapılmadı, bilinçli kapsam dışı bırakıldı.

---

## Faz 17'den kalanlar (2026-10-05 düzeltme turu)

Bu tur dört P0 düzeltmesi yaptı. Aşağıdaki kalemler o turda **kasıtlı olarak
kapsam dışı** bırakıldı; hiçbiri uygulanmamış bir iş sayılmaz, borç olarak
kayıtlıdır.

### Rapor merkezi — tenant filtresi borcu (yeni, bu tur bulundu)

`services/report_service.rs` içindeki dört rapor (`sales_report`,
`shift_report`, `receipts_report`, `adjustments_report`) tenant filtresi
uygular ama bazı alt sorguları `tenant_id` **bağlamadan** birleşim yapar.
Ayrıntı ve düzeltme için bkz. `docs/OZELLIK-RAPORU.md` §Bölüm 6 madde 1
(rapor gruplama sorgularındaki UTC gün sınırları dahil).

### Arayüz sözleşmesi — yeni parametreler (kapandı)

Rol ve bayrak kapıları eklendiği için komut imzaları değişti:
`get_shift_summary`, `get_stations`, `create_station`, `update_kds_item_status`,
`get_product_modifiers`, `get_table_ready_status`, `get_all_table_statuses`
artık `actor_role` bekliyor; QR menü komutları ise `active_modules`.

`tauriInvoke.ts` bu alanları oturumdan (`user.role`, `user.activeModules`)
otomatik enjekte eder. Doğrulandı: ilgili çağrı yüzeylerinin tamamı
`tauriInvoke`'u kullanıyor — `useFloorStore.ts`, `KdsContainer.tsx`,
`KdsOverviewPanel.tsx`, `TauriPOSRepository.ts`, `CashierWorkstationContainer.tsx`.
Ham `@tauri-apps/api/core` `invoke` kullanan yer yok.

Not: QR menü komutları masaüstünde çağrılmaz (müşteri QR'ı üzerinden
`external360` üzerinden gider); bu yüzden bayrak listesi tarayıcı modunda
mock'a düşmez ve tarayıcıda QR menü açılmaz.

Tarayıcı mocku da aynı kapıları uygular (`requireShiftGate`,
`requireKitchenGate`, `requireTableReadGate`, `requireOrderGate`) — aksi hâlde
mock yeşil kalırken üretim reddeder. Ölçüt:
`desktop/tests/integration/unguardedCommandsFrontend.test.ts` (11 test).

### AI slop taraması — hâlâ sıfır değil (bu tur buldu)

AGENTS.md §3.2 tarama kapıları repo-genelinde sıfır değil; ölçüm 2026-10-05:

- Emoji: `desktop/src/presentation/components/platform/PlatformSetupWizard.tsx` → 3 eşleşme
- Gradient: 4 dosyada 1'er eşleşme — `kds/KdsContainer.tsx`,
  `platform/PlatformSetupWizard.tsx`, `platform/ImpersonationBanner.tsx`,
  `platform/MasterVaultModal.tsx`

Hepsi Faz 14 öncesi dosyalarda; bu turun konusu değildi, bilinçli olarak
dokunulmadı. Yeni kodda emoji ve gradient yok (bu turun diff'i tarandı).

---

## Diğer fazlardan kalanlar

(Her faz sonunda kendi maddesi buraya eklenir.)