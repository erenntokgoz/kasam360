//! Faz 12 servis regresyon testleri.
//!
//! Kapsam daraltılırsa sessiz sıfırlama ve çapraz kiracı sızıntısı geri gelir.
//! Testler özellikle `0` dönmesi gereken yerde `None`/`Err` döndüğünü
//! kanıtlar (AGENTS.md §3.4).
//!
//! Dosya 500 satır sınırını aştığı için alan alan bölündü: `support` ortak
//! şema ve bağlantıyı taşır, kalan modüller yalnız kendi alanının
//! regresyonlarını yazar.

mod price_lists_windows;
mod pricing;
mod recipes;
mod shelf_life;
mod suppliers;
mod support;
mod units;
mod waste;
