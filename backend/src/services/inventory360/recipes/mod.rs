//! Yarı mamul reçete ve maliyet çözümü (Spec §2.12).
//!
//! Neden gerekli: "kruasan" tek başına satılmayan bir yarı mamuldür; un, yağ,
//! maya ve tuzdan yapılır. Reçetesiz satış, ürünün maliyetini ve fireyi
//! görünmez kılar — %35 sabit katsayı AGENTS.md §2 tarafından yasaklanmıştır.
//!
//! Sessizlik yasağı: bir malzemenin maliyeti bilinmiyorsa sonuç **sıfır** değil
//! `bilinmiyor` olur. Reçetesiz ve fiyatsız malzemeyle hesaplanan sahte sıfır
//! maliyet, tüm P&L'i yanlış kılar (AGENTS.md §3.4).
//!
//! Dosya 500 satır sınırını aşmasın diye `types` (sözleşme + CRUD) ve `cost`
//! (maliyet çözümleyici) olarak bölündü.

pub mod cost;
pub mod types;

pub use cost::{calculate_recipe_cost, cost_for_active_recipe};
pub use types::{
    create_recipe, deactivate_recipe, list_recipes, ComponentCost, Recipe, RecipeCost, RecipeInput,
    RecipeItem, RecipeItemInput,
};
