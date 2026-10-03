//! Fiyatlandırma ve menü görünürlüğü (Spec §2.11).
//!
//! Kapsam: 86'd, fiyat listeleri, dinamik tarife ve happy hour, fiyat dondurma,
//! toplu fiyat güncelleme, öğle/akşam menü pencereleri.
//!
//! Çözümleme sırası (`effective::effective_price`): fiyat dondurma → dinamik kural
//! → fiyat listesi → ürün fiyatı. Dondurma en üsttedir çünkü bir taahhüttür:
//! patron zam geldiğinde "bu fiyat korunacak" dediyse, indirim kampanyası bu
//! taahhüdü sessizce delmemelidir.
//!
//! `feat_dynamic_pricing` bayrağı KAPALI olduğu için dinamik kural ve happy hour
//! arayüzü 404 döner. Servis katmanı bayrağı göremez, bu yüzden kapı komut
//! katmanındadır.
//!
//! Dosya 500 satır sınırını aşmasın diye konulara bölündü: `eighty_six`,
//! `price_lists`, `rules`, `effective`, `price_freeze`, `bulk`, `windows`.

pub mod bulk;
pub mod effective;
pub mod eighty_six;
pub mod price_freeze;
pub mod price_lists;
pub mod rules;
pub mod windows;

use serde::{Deserialize, Serialize};

pub use bulk::{bulk_update_prices, BulkPriceChange, BulkPriceInput, BulkPriceResult};
pub use effective::effective_price;
pub use eighty_six::set_product_86d;
pub use price_freeze::{create_price_freeze, PriceFreezeInput};
pub use price_lists::{
    create_price_list, delete_price_list, list_price_lists, PriceList, PriceListInput,
    PriceListItem, PriceListItemInput,
};
pub use rules::{list_pricing_rules, upsert_pricing_rule, PricingRuleInput};
pub use windows::{
    list_service_windows, set_window_product, upsert_service_window, ServiceWindow,
    ServiceWindowInput,
};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PricingRule {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub discount_percent: i64,
    pub start_time: String,
    pub end_time: String,
    pub days_of_week: Option<String>,
    pub product_ids: Option<String>,
    pub category_ids: Option<String>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub is_active: bool,
    pub priority: i64,
}

/// Fiyatın nasıl çözüldüğünü açıklayan döküm. Rapor "fiyat neden bu?" sorusunu
/// yanıtlamak zorundadır; indirim görünmeden uygulanırsa kasiyer müşteriyle
/// tartışamaz.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct EffectivePrice {
    pub product_id: String,
    pub base_price_cents: i64,
    pub final_price_cents: i64,
    pub source: PriceSource,
    /// Uygulanan indirim tutarı (kuruş). Dondurma ve temel fiyatta 0'dır.
    pub discount_cents: i64,
    pub rule_id: Option<String>,
    pub rule_name: Option<String>,
    /// Ürün 86'da mı.
    pub is_86d: bool,
    pub stockout_reason: Option<String>,
    /// Ürünün geçerli menü penceresi (`OGLE`, `AKSAM` gibi). `None` = kısıt yok.
    pub service_window: Option<String>,
}

/// Fiyatın kaynağı. Kasa ekranı bu değeri göstererek indirimin meşruiyetini
/// açıklar; kaynak bilinmezse kasiyer fiyatı savunamaz.
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PriceSource {
    /// Fiyat dondurma taahhüdü.
    Frozen,
    /// Happy hour veya zamanlı dinamik kural.
    DynamicRule,
    /// Fiyat listesi.
    PriceList,
    /// Ürünün kendi fiyatı, indirim yok.
    ProductPrice,
}
