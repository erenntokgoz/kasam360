//! Reçete talebinin partilerden nasıl karşılanacağı.
//!
//! Neden ayrı: marul adetle alınır, reçete gram ister. Bir marulun kullanılabilir
//! gramı partiden partiye değişir (dış yaprak, boy); sabit bir "1 adet = 300 g"
//! çevrimi her partide yanlış maliyet ve yanlış stok düşümü üretir. Bu yüzden gram
//! talebi her partinin kendi kullanılabilir gramıyla adede çevrilir. Parti maliyeti
//! adet başına kalır; kuruşun altına inen gram fiyatı hiç saklanmaz.

use super::units::convert_stock_quantity;
use sqlx::SqliteConnection;

/// Gram altı kalıntı: kayan nokta çıkarmasının bıraktığı tozu talep saymamak için.
const EPSILON: f64 = 1e-9;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Demand {
    /// Talep ürünün stok biriminde.
    Stock(f64),
    /// Stok birimi adet olan ürün için gram cinsinden talep.
    Grams(f64),
}

impl Demand {
    pub fn is_open(&self) -> bool {
        match self {
            Self::Stock(quantity) | Self::Grams(quantity) => *quantity > EPSILON,
        }
    }

    /// Karşılanamayan talep, kendi biriminde.
    pub fn remaining(&self) -> f64 {
        match self {
            Self::Stock(quantity) | Self::Grams(quantity) => *quantity,
        }
    }

    pub fn is_grams(&self) -> bool {
        matches!(self, Self::Grams(_))
    }

    /// Partiden alınacak stok birimi miktarını verir ve talebi o kadar azaltır.
    ///
    /// Gram talebinde kullanılabilir gramı girilmemiş parti hiç kullanılmaz: tahmini
    /// gram, gerçek FIFO maliyetinin yerine geçemez (AGENTS.md §2.5).
    pub fn take(&mut self, batch_remaining: f64, usable_grams_per_unit: Option<f64>) -> f64 {
        if batch_remaining <= 0.0 {
            return 0.0;
        }
        match self {
            Self::Stock(quantity) => {
                let taken = quantity.min(batch_remaining);
                *quantity -= taken;
                taken
            }
            Self::Grams(grams) => match usable_grams_per_unit {
                Some(per_unit) if per_unit.is_finite() && per_unit > 0.0 => {
                    let taken = (*grams / per_unit).min(batch_remaining);
                    *grams -= taken * per_unit;
                    if *grams < EPSILON {
                        *grams = 0.0;
                    }
                    taken
                }
                _ => 0.0,
            },
        }
    }
}

fn grams(unit: &str, quantity: f64) -> Option<f64> {
    match unit.trim().to_lowercase().as_str() {
        "g" => Some(quantity),
        "kg" => Some(quantity * 1000.0),
        _ => None,
    }
}

/// Reçete miktarını partilerden karşılanacak talebe çevirir.
///
/// İşletmenin kendi çevrimi varsa o kullanılır. Yoksa ve ürün adetle tutulup
/// reçete ağırlık istiyorsa talep gram olarak kalır ve partiler tek tek çözer.
pub async fn component_demand(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    recipe_unit: &str,
    stock_unit: &str,
    quantity: f64,
) -> Result<Demand, String> {
    match convert_stock_quantity(conn, tenant_id, recipe_unit, stock_unit, quantity).await {
        Ok(converted) => Ok(Demand::Stock(converted)),
        Err(error) => match (
            stock_unit.trim().to_lowercase().as_str(),
            grams(recipe_unit, quantity),
        ) {
            ("adet", Some(grams)) if grams.is_finite() && grams > 0.0 => Ok(Demand::Grams(grams)),
            _ => Err(error),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gram_talebi_her_partinin_kendi_gramiyla_adede_cevrilir() {
        // İlk partide marul 250 g, ikincide 400 g veriyor.
        let mut demand = Demand::Grams(900.0);
        let first = demand.take(2.0, Some(250.0));
        assert!((first - 2.0).abs() < 1e-9);
        let second = demand.take(5.0, Some(400.0));
        assert!((second - 1.0).abs() < 1e-9);
        assert!(!demand.is_open());
    }

    #[test]
    fn grami_girilmemis_parti_gram_talebini_karsilamaz() {
        let mut demand = Demand::Grams(100.0);
        assert_eq!(demand.take(10.0, None), 0.0);
        assert!(demand.is_open());
        assert_eq!(demand.remaining(), 100.0);
    }

    #[test]
    fn stok_birimi_talebi_parti_kalanini_asmaz() {
        let mut demand = Demand::Stock(3.0);
        assert_eq!(demand.take(1.5, Some(999.0)), 1.5);
        assert_eq!(demand.remaining(), 1.5);
    }
}
