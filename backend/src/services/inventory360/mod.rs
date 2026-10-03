//! Faz 12 · Menü & stok derinleştirme servisleri.
//!
//! Kapsam: birim çevrim, yarı mamul reçete, tedarikçi karşılaştırma, raf ömrü,
//! fire ve kör sayım, fiyat listesi/dinamik tarife/fiyat dondurma/86'd.
//!
//! Bu modül bilinçli olarak Tauri komutu değildir; komut katmanı
//! (`commands/inventory360/`) yalnızca yetki sınatır ve buraya delegasyon yapar.
//! Böylece iş mantığı testlerde komut altyapısı olmadan doğrulanabilir.

pub mod pricing;
pub mod recipes;
pub mod shelf_life;
pub mod suppliers;
pub mod units;
pub mod waste;

use sqlx::Row;

pub use pricing::{
    bulk_update_prices, create_price_freeze, create_price_list, delete_price_list, effective_price,
    list_price_lists, list_pricing_rules, set_product_86d, upsert_pricing_rule,
};
pub use recipes::{
    calculate_recipe_cost, cost_for_active_recipe, create_recipe, deactivate_recipe, list_recipes,
    Recipe, RecipeCost,
};
pub use shelf_life::{
    expiring_batches, list_shelf_life_policies, set_batch_expiry, upsert_shelf_life_policy,
    ExpiryReport, ShelfLifePolicy, ShelfLifePolicyInput,
};
pub use suppliers::{
    compare_supplier_prices, create_purchase_order, list_suppliers, receive_purchase_order,
    set_supplier_product, upsert_supplier,
};
pub use units::{
    convert_quantity, delete_unit_conversion, list_unit_conversions, upsert_unit_conversion,
};
pub use waste::{
    close_stock_count, get_stock_count, list_stock_counts, list_waste_records, open_stock_count,
    record_count_line, record_waste,
};

/// Nullable metin kolonunu güvenli okur.
///
/// Neden gerekli: sqlx SQLite'da NULL bir kolonu `String` olarak çekmek yerine
/// **boş dize** döndürür. Bu, "tanımsız" ile "boş" ayrımını yok eder ve sessiz
/// hata üretir: fiyat kuralında `product_ids` NULL iken "tüm menüye uygulanır"
/// demektir, boş dizeye dönüşürse "hiçbir ürüne uygulanmaz" olur — kural
/// kaydedilir, çalışmaz ve nedenini kimse bilemez. Aynı tuzak `notes`,
/// `stockout_reason`, `expected_at` gibi alanlarda da metin olarak sızar.
///
/// Boş dize de "tanımsız" sayılır: kullanıcı alanı boş bırakmış demektir.
pub(crate) fn optional_text(
    row: &sqlx::sqlite::SqliteRow,
    column: &str,
) -> Result<Option<String>, String> {
    let deger: Option<String> = row.try_get(column).map_err(|e| e.to_string())?;
    Ok(deger.filter(|metin| !metin.trim().is_empty()))
}

/// Nullable tam sayı kolonunu güvenli okur. Boş metin yerine `None` döner.
pub(crate) fn optional_i64(
    row: &sqlx::sqlite::SqliteRow,
    column: &str,
) -> Result<Option<i64>, String> {
    row.try_get::<Option<i64>, _>(column)
        .map_err(|e| e.to_string())
}

/// Nullable ondalık kolonunu güvenli okur.
pub(crate) fn optional_f64(
    row: &sqlx::sqlite::SqliteRow,
    column: &str,
) -> Result<Option<f64>, String> {
    row.try_get::<Option<f64>, _>(column)
        .map_err(|e| e.to_string())
}

/// Faz 12 yazma işlemlerinin tamamı bu kategoriyle denetim defterine düşer.
///
/// Neden yeni `STOK` kategorisi açılmıyor: `audit_service::category::ALL` donmuş bir
/// kümedir ve `is_valid("STOK")` false olduğu bir testle korunuyor. Mali etkisi
/// olan stok hareketleri (fire, sayım farkı, reçete maliyeti) `FINANS`, menü
/// görünürlüğünü etkileyen değişiklikler (86'd, fiyat) `MENU` altında tutulur.
/// Böylece kategori kümesi değişmeden fazın tüm yazma yolları denetlenebilir.
pub mod audit_category {
    pub const MALIYET: &str = "FINANS";
    pub const MENU: &str = "MENU";
}
