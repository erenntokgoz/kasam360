//! Fire (zayi) kaydı ve kör sayım (Spec §2.12).
//!
//! Neden ayrı tablo: `stock_movements` stok hareketini kaydeder ama firein
//! **gerekçesini** tutmaz. Bozulan malzeme ile sayım hatası aynı muhasebe
//! satırına girerse zararın kaynağı görülemez ve önlem alınamaz.
//!
//! Kör sayım kuralı: sayım satırında **beklenen miktar tutulmaz**. Beklenen
//! değeri gören kişi kendi ölçümüne göre yazmaz; sayımın değeri kaybolur.
//! Beklenen miktar yalnız kapanışta hesaplanır ve fark olarak denetim defterine
//! yazılır.
//!
//! Dosya 500 satır sınırını aşmasın diye `records` (fire) ve `count` (kör
//! sayım) olarak bölündü.

pub mod count;
pub mod records;

pub use count::{
    close_stock_count, get_stock_count, list_stock_counts, open_stock_count, record_count_line,
    StockCount, StockCountLine,
};
pub use records::{list_waste_records, record_waste, WasteInput, WasteRecord};
