//! Modifier DTO'ları ve doğrulama yardımcıları.
//!
//! Neden ayrı modül: modifier_service.rs 500 satır tavanını aştığı için
//! veri modelleri ve dönüştürücüler bu alt modüle ayrıldı.

use sqlx::Row;

/// Seçenek fiyat farkı (kuruş). Ürün temel fiyatından ayrı tutulur.
#[derive(Debug, serde::Deserialize, serde::Serialize, Clone, PartialEq, Eq)]
pub struct ModifierOptionDto {
    pub id: String,
    pub name: String,
    #[serde(rename = "priceCents")]
    pub price_cents: i64,
}

#[derive(Debug, serde::Deserialize, serde::Serialize, Clone)]
pub struct ModifierGroupDto {
    pub id: String,
    pub name: String,
    #[serde(rename = "isRequired")]
    pub is_required: bool,
    #[serde(rename = "minSelections")]
    pub min_selections: i64,
    #[serde(rename = "maxSelections")]
    pub max_selections: Option<i64>,
    /// Şablonun bağlı olduğu kategori. `None` ise grup serbesttir (bir ürüne
    /// doğrudan atanır).
    #[serde(rename = "categoryId")]
    pub category_id: Option<String>,
    pub options: Vec<ModifierOptionDto>,
}

/// Negatif fiyat farkı bir veri hatasıdır; ekstra indirim olamaz.
pub(crate) fn validate_option_price(price_cents: i64) -> Result<(), String> {
    if price_cents < 0 {
        return Err("INVALID_MODIFIER_PRICE: Seçenek fiyat farkı negatif olamaz.".to_string());
    }
    Ok(())
}

pub(crate) fn row_to_group(
    row: &sqlx::sqlite::SqliteRow,
    options: Vec<ModifierOptionDto>,
) -> ModifierGroupDto {
    ModifierGroupDto {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        is_required: row.try_get("is_required").unwrap_or(false),
        min_selections: row.try_get("min_selections").unwrap_or(0),
        max_selections: row.try_get("max_selections").ok().flatten(),
        category_id: row.try_get("category_id").ok().flatten(),
        options,
    }
}
