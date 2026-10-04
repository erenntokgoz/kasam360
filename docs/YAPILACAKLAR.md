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
- Repo-geneli `cargo fmt --check` de temiz değil: **736** sapma var, tamamı Faz 14
  öncesi dosyalarda. Neden bu fazda düzeltilmedi: `cargo fmt` kıtadaki tüm
  dosyaları yeniden biçimlendirir ve 108 dosyada yalnızca satır kaydırma
  değişikliği üretir — Faz 14'ün konusu olmayan kalabalık bir diff. Bu
  biçimlendirme kasıtlı olarak **geri alındı**; Faz 14 dosyalarının kendisi
  biçimden temizdir.
- ~~`src/print_commands.rs:319` fiş tarihi UTC alınıyordu~~ **Düzeltildi**
  (`67154b1`). Aynı sınıf hata üç yerdeydi ve üçü de giderildi:
  `inventory360/pricing/bulk.rs`, `inventory360/shelf_life.rs`,
  `print_commands.rs`. Kalan borç: UTC/yerel çevrimi hâlâ her modülde ayrı
  ayrı yazılıyor; tek bir yardımcı (`services::is_tarih` gibi) yok. Üçüncü
  düzeltmede `created_at` değerleri artık fişte yerel zamana çevriliyor, ama
  **rapor gruplama** sorgularında başka UTC gün sınırları aranabilir — tarama
  yapılmadı, bilinçli kapsam dışı bırakıldı.

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

`print_commands.rs:319` UTC → localtime maddesi **zaten giderildi** (`67154b1`)
ve `BUGUN_SQL` / `GUN_BASI_SQL` sabitleri bu dosyada yerel zaman kullanıyor;
`:319` artık `pool` parametresi. Bu faza yeni bir UTC maddesi yazılmadı çünkü
yazılsa **var olmayan bir borç** kaydedilmiş olurdu.

Aynı sınıftan kalan borç, §Faz 14'te yazılan tek yardımcı eksikliği:
UTC/yerel çevrimi (`localtime`) hâlâ modül modül ayrı yazılıyor, tek bir
`services::is_tarih` gibi yardımcı yok.

Aşağıdaki backend dosyaları §10'un 500 satır tavanını aşıyor (ölçüm 2026-10-05):

| Satır | Dosya |
|---|---|
| 861 | `platform_commands.rs` |
| 612 | `services/modifier_service_tests.rs` |
| 554 | `services/approval_service.rs` |
| 541 | `services/payment_approval_tests.rs` |
| 517 | `services/audit_service_tests.rs` |
| 512 | `services/reservation_service.rs` |
| 505 | `services/modifier_service.rs` |

Not: `services/audit_service.rs` **309** satırdır; 724 satır değildir. 500'ü
aşan dosya onun test eşidir (`audit_service_tests.rs`, 517).

---

## Diğer fazlardan kalanlar

(Her faz sonunda kendi maddesi buraya eklenir.)