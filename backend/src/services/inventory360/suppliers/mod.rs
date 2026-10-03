//! Tedarikçi yönetimi, fiyat karşılaştırması ve satın alma (Spec §2.12).
//!
//! Neden `directories` yetmiyor: dizin kaydı bir tedarikçinin **adını** tutar,
//! sayısal fiyatını değil. Karşılaştırma tablosu birim fiyat, minimum sipariş
//! miktarı ve teslim süresi ister; bu yüzden `suppliers` ve `supplier_products`
//! ayrı tablolardır.
//!
//! Sessizlik yasağı: en ucuz tedarikçi "fiyatı bilinmiyor" olan bir tedarikçi
//! olamaz. Fiyatı girilmemiş tedarikçiler `missing_price_suppliers` listesinde
//! görünür.
//!
//! Dosya 500 satır sınırını aşmasın diye `catalog` (tedarikçi + karşılaştırma)
//! ve `orders` (satın alma) olarak bölündü.

pub mod catalog;
pub mod orders;

pub use catalog::{
    compare_supplier_prices, list_suppliers, set_supplier_product, upsert_supplier, PriceGap,
    Supplier, SupplierInput, SupplierPriceRow, SupplierProductInput,
};
pub use orders::{
    create_purchase_order, receive_purchase_order, PurchaseOrder, PurchaseOrderInput,
    PurchaseOrderLineInput,
};
