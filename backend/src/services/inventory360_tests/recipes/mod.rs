//! Reçete maliyeti testleri (facade).
//!
//! Kapsam: randıman ve fire payı, malzeme fiyatı bilinmediğinde `0` yerine
//! bilinmiyor (`None`) sayılması, ikinci aktif reçetenin reddi, özyinelemeli alt
//! reçete çözümü, ürün kimliğinden yol bulan giriş noktası ve döngüsel reçete
//! reddinin bozulmaması.

use super::support::*;
use crate::services::inventory360::*;

pub const KIRACI_A: &str = "tnt_a";
pub const KIRACI_B: &str = "tnt_b";
pub const AKTOR: &str = "usr_1";

/// Reçete kalemi kurar. `fire_payi` verilmemişse işleme kaybı yoktur.
pub fn malzeme(
    urun_id: &str,
    miktar: f64,
    birim: &str,
    fire_payi: Option<f64>,
) -> recipes::RecipeItemInput {
    recipes::RecipeItemInput {
        component_product_id: urun_id.into(),
        quantity: miktar,
        unit: birim.into(),
        waste_percent: fire_payi,
        notes: None,
    }
}

/// Reçete girdisi kurar.
pub fn recete_girdisi(
    urun_id: &str,
    ad: &str,
    randiman: f64,
    cikti_miktar: f64,
    kalemler: Vec<recipes::RecipeItemInput>,
) -> recipes::RecipeInput {
    recipes::RecipeInput {
        product_id: urun_id.into(),
        name: ad.into(),
        yield_percent: randiman,
        output_quantity: cikti_miktar,
        output_unit: "adet".into(),
        notes: None,
        items: kalemler,
    }
}

/// Reçeteyi açar ve dönen kaydı verir. Aynı uzun çağrıyı yedi testte tek
/// yerden kurmak, asıl konudan (maliyet) önce kalem kalabalığını okunur kılar.
pub async fn recete_olustur(
    conn: &mut sqlx::SqliteConnection,
    kiraci: &str,
    girdi: recipes::RecipeInput,
) -> Recipe {
    create_recipe(conn, kiraci, AKTOR, girdi).await.unwrap()
}

/// Dökümdeki malzemeyi ürün kimliğiyle bulur. Kalem sırası `created_at`'e bağlı
/// ve aynı saniyede yazılan kalemler arasında garanti olmadığı için sıraya
/// göre indekslemek teste yalan başarısızlık yazdırır.
pub fn bilesen<'a>(maliyet: &'a RecipeCost, urun_id: &str) -> &'a recipes::ComponentCost {
    maliyet
        .components
        .iter()
        .find(|b| b.component_product_id == urun_id)
        .unwrap_or_else(|| panic!("maliyet dökümünde {urun_id} yok"))
}

mod basic_tests;
mod recursive_tests;
