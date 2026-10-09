# Katkı Rehberi (Contributing)

Kasam360'a katkı sunduğun için teşekkür ederiz. Bu belge, bir PR açmadan önce
beklenen adımları listeler.

## PR Öncesi Kontrol Listesi

1. `AGENTS.md`'i oku — proje anayasasıdır, değiştirilemez.
2. Kod yorumları **Türkçe** yazılır (neden yapıldığı, ne değil).
3. Identifiers İngilizce, dosya UTF-8 (BOM'suz), max 500 satır.
4. `cargo check`, `cargo test`, `cargo clippy -D warnings`, `cargo fmt --check`.
5. Desktop: `npx tsc --noEmit`, `npx vitest run`.
6. Emoji / gradient / `unwrap()` / `any` yok.

## Test Protokolü

- `cd backend && cargo test` → %100 geçmeli.
- `cd desktop && npx vitest run` → %100 geçmeli.
- Yeni feature varsa feature bayrağı eklenmeli.

## Batch Onay

Her batch tamamlandıktan sonra DUR, onay bekle. Batch onaylanmadan sonraki
batch'e GEÇİLMEZ.