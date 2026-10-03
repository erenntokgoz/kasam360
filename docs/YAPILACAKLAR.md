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
- `src/print_commands.rs:319` fiş tarihini `SELECT date('now')` ile alıyor.
  SQLite UTC yazdığı için **gece yarısından sonra basılan fişe dünkü tarih**
  basılır. Aynı sınıf hata Faz 14'te iki yerde bulundu ve düzeltildi
  (`inventory360/pricing/bulk.rs`, `inventory360/shelf_life.rs`); buradaki
  örnek **düzeltilmedi**, çünkü bu fazın konusu değil ve ilgili test yok.
  Ayrıca UTC/yerel tarih ayrımı için tek bir yardımcı (`services::is_tarih`)
  yok; her modül kendi çevrimini yapıyor.

---

## Diğer fazlardan kalanlar

(Her faz sonunda kendi maddesi buraya eklenir.)