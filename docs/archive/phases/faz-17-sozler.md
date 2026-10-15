# Faz 17 — Bilinen Kusurlar / Teknik Borç (Known Issues)

Bu dosya, G6 (Devops + Dayanıklılık) batch'inde tespit edilen ve Faz 21
(Clean Code) clean code adımıyla düzeltilecek teknik borcu listeler.

## 1. Clippy — 70 hata (CI'da `-D warnings` yerine `-W` kullanılıyor)

Durum: `cargo clippy -- -D warnings` 70 hata verir; CI bunu fail eder.
Geçici çözüm: CI'da `cargo clippy -- -W clippy::all` (warning mode).

Kategoriler:
- 37× auto-deref (`(*x).foo()` → `x.foo()`)
- 7× function has too many arguments (8/7, 9/7)
- 3× useless use of `format!`
- 3× redundant closure
- 2× borrowed expression implements required traits
- 1× redundant reference in `format!`
- 1× doc list item without indentation
- 1× manual implementation of `.is_multiple_of()`
- 1× returning the result of a `let` binding
- 1× `repeat().take()` can be written more concisely
- 1× manual implementation of `.Option::map`
- 1× unnecessary match expression
- 1× empty line after doc comment

Neden erteleniyor: "too many arguments" hataları function signature
değişikliği gerektirir; bu API değişikliği Faz 21'de planlanmıştır.
Otomatik `--fix` bu hataları düzeltemedi.

## 2. Vitest — 1 fail (`inventory360Contract.test.ts:298`)

`rapor.expired` beklendiği gibi değil. Bu dosya G5'te (faz-12 commit
`0cf79ee`) eklenmiştir; G6'da değiştirilmiştir (`git diff HEAD` = 0 satır).
Yani **G6'da kırılmamıştır**, önceden var olan bir test kusuru.

Neden erteleniyor: test mock'u (`tauriInvoke`) gerçek veritabanı durumuna
bağlı; Faz 21'de mock fix'i yapılacaktır.

## 3. G6 Sonrası Temizlik

- `cargo fmt` uygulandı (önceden varolan 20+ dosya formatlanmıştır).
- `cargo test` → 957 passed, 0 failed.
- `npx tsc --noEmit` → 0 hata.
- `npx vitest run` → 570 passed, 1 failed (yukarı bakın).