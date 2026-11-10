//! Yerel menüden `kasam360.qrmenu.v1` anlık görüntüsü üretir (`docs/contracts/qr-menu.md`).
//!
//! Neden saf fonksiyon: yayın tam anlık görüntüdür, kısmi güncelleme yoktur. Üretim
//! yerel veritabanından okunan satırlara bağlı kalmasın diye kurallar (aktif/stokta,
//! sıralama, kuruş) ağdan ve veritabanından bağımsız test edilir.

use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqliteConnection};
use std::collections::{BTreeMap, HashSet};

pub const SCHEMA: &str = "kasam360.qrmenu.v1";
const MAX_CATEGORIES: usize = 100;
const MAX_PRODUCTS: usize = 2_000;
const MAX_PRICE_CENTS: i64 = 10_000_000;
const MAX_SORT: i64 = 1_000_000;
const MAX_DESCRIPTION_CHARS: usize = 1_000;

#[derive(Debug, Clone)]
pub struct CategoryRow {
    pub id: String,
    pub name: String,
    pub display_order: i64,
}

#[derive(Debug, Clone)]
pub struct ProductRow {
    pub id: String,
    pub category_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub price_cents: i64,
    pub display_order: i64,
    pub is_active: bool,
    pub is_86: bool,
    pub image_url: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MenuCategory {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MenuProduct {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub price_cents: i64,
    pub category_id: String,
    pub sort_order: i64,
    pub image_key: Option<String>,
    pub active: bool,
    pub in_stock: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct MenuSnapshot {
    pub schema: &'static str,
    pub categories: Vec<MenuCategory>,
    pub products: Vec<MenuProduct>,
}

/// Anlık görüntü ve yüklenecek WebP görselleri (sha256 → bayt).
#[derive(Debug)]
pub struct BuiltMenu {
    pub snapshot: MenuSnapshot,
    pub images: BTreeMap<String, Vec<u8>>,
    /// WebP olmayan eski görseller: yüklenmez, ürün görselsiz yayınlanır.
    pub skipped_images: usize,
}

fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn clamp_sort(value: i64) -> i64 {
    value.clamp(0, MAX_SORT)
}

/// Yerel görsel `data:image/webp;base64,...` biçimindedir; yalnız WebP yayınlanır.
fn decode_webp(data_url: &str) -> Option<Vec<u8>> {
    let payload = data_url.strip_prefix("data:image/webp;base64,")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .ok()?;
    let is_webp = bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP";
    is_webp.then_some(bytes)
}

pub fn build_snapshot(
    categories: Vec<CategoryRow>,
    products: Vec<ProductRow>,
) -> Result<BuiltMenu, String> {
    if categories.len() > MAX_CATEGORIES {
        return Err(format!(
            "VALIDATION: menüde en çok {MAX_CATEGORIES} kategori yayınlanabilir"
        ));
    }
    let mut menu_categories = Vec::with_capacity(categories.len());
    for category in categories {
        let name = category.name.trim().chars().take(80).collect::<String>();
        if !valid_id(&category.id) || name.is_empty() {
            return Err("VALIDATION: geçersiz kategori kaydı, adı ve kimliği kontrol edin".into());
        }
        menu_categories.push(MenuCategory {
            id: category.id,
            name,
            sort_order: clamp_sort(category.display_order),
        });
    }
    let known: HashSet<String> = menu_categories.iter().map(|c| c.id.clone()).collect();

    let mut menu_products = Vec::new();
    let mut images = BTreeMap::new();
    let mut skipped_images = 0;
    for product in products {
        // Kategorisiz ürün (hammadde) satış menüsünde yoktur.
        let Some(category_id) = product.category_id.filter(|id| known.contains(id)) else {
            continue;
        };
        let name = product.name.trim().chars().take(120).collect::<String>();
        if !valid_id(&product.id) || name.is_empty() {
            return Err(format!(
                "VALIDATION: {} ürününün adı ya da kimliği geçersiz",
                product.name
            ));
        }
        if !(0..=MAX_PRICE_CENTS).contains(&product.price_cents) {
            return Err(format!(
                "VALIDATION: {name} ürününün fiyatı yayın sınırının dışında"
            ));
        }
        let description = product
            .description
            .map(|text| {
                text.trim()
                    .chars()
                    .take(MAX_DESCRIPTION_CHARS)
                    .collect::<String>()
            })
            .filter(|text| !text.is_empty());
        let image_key = match product.image_url.as_deref().filter(|url| !url.is_empty()) {
            None => None,
            Some(url) => match decode_webp(url) {
                Some(bytes) => {
                    let key = hex::encode(Sha256::digest(&bytes));
                    images.entry(key.clone()).or_insert(bytes);
                    Some(key)
                }
                None => {
                    skipped_images += 1;
                    None
                }
            },
        };
        menu_products.push(MenuProduct {
            id: product.id,
            name,
            description,
            price_cents: product.price_cents,
            category_id,
            sort_order: clamp_sort(product.display_order),
            image_key,
            active: product.is_active,
            in_stock: !product.is_86,
        });
    }
    if menu_products.len() > MAX_PRODUCTS {
        return Err(format!(
            "VALIDATION: menüde en çok {MAX_PRODUCTS} ürün yayınlanabilir"
        ));
    }
    menu_categories.sort_by(|a, b| (a.sort_order, &a.id).cmp(&(b.sort_order, &b.id)));
    menu_products.sort_by(|a, b| (a.sort_order, &a.id).cmp(&(b.sort_order, &b.id)));
    Ok(BuiltMenu {
        snapshot: MenuSnapshot {
            schema: SCHEMA,
            categories: menu_categories,
            products: menu_products,
        },
        images,
        skipped_images,
    })
}

/// İşletmenin satış menüsünü yerelden okur; her sorgu `tenant_id` ile süzülür.
pub async fn load_menu(conn: &mut SqliteConnection, tenant_id: &str) -> Result<BuiltMenu, String> {
    let text = |e: sqlx::Error| e.to_string();
    let categories =
        sqlx::query("SELECT id, name, display_order FROM categories WHERE tenant_id = ?")
            .bind(tenant_id)
            .fetch_all(&mut *conn)
            .await
            .map_err(text)?
            .iter()
            .map(|row| {
                Ok(CategoryRow {
                    id: row.try_get("id").map_err(text)?,
                    name: row.try_get("name").map_err(text)?,
                    display_order: row.try_get("display_order").map_err(text)?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
    let products = sqlx::query(
        "SELECT id, category_id, name, description, price_cents, display_order,
                is_active, is_86, image_url
           FROM products WHERE tenant_id = ? AND is_raw = 0",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text)?
    .iter()
    .map(|row| {
        Ok(ProductRow {
            id: row.try_get("id").map_err(text)?,
            category_id: row.try_get("category_id").map_err(text)?,
            name: row.try_get("name").map_err(text)?,
            description: row.try_get("description").map_err(text)?,
            price_cents: row.try_get("price_cents").map_err(text)?,
            display_order: row.try_get("display_order").map_err(text)?,
            is_active: row.try_get("is_active").map_err(text)?,
            is_86: row.try_get("is_86").map_err(text)?,
            image_url: row.try_get("image_url").map_err(text)?,
        })
    })
    .collect::<Result<Vec<_>, String>>()?;
    build_snapshot(categories, products)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn category(id: &str, order: i64) -> CategoryRow {
        CategoryRow {
            id: id.into(),
            name: format!(" {id} "),
            display_order: order,
        }
    }

    fn product(id: &str, category: Option<&str>, order: i64) -> ProductRow {
        ProductRow {
            id: id.into(),
            category_id: category.map(str::to_string),
            name: "Türk Kahvesi".into(),
            description: Some("  Orta şekerli.  ".into()),
            price_cents: 12_500,
            display_order: order,
            is_active: true,
            is_86: false,
            image_url: None,
        }
    }

    fn webp_url(extra: u8) -> String {
        let mut bytes = b"RIFF\x10\0\0\0WEBPVP8 ".to_vec();
        bytes.push(extra);
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        format!("data:image/webp;base64,{encoded}")
    }

    #[test]
    fn aktif_stokta_ve_kurus_alanlari_dogru_eslenir() -> Result<(), String> {
        let mut passive = product("prd_b", Some("cat_a"), 2);
        passive.is_active = false;
        let mut out_of_stock = product("prd_c", Some("cat_a"), 3);
        out_of_stock.is_86 = true;
        let built = build_snapshot(
            vec![category("cat_a", 1)],
            vec![product("prd_a", Some("cat_a"), 1), passive, out_of_stock],
        )?;
        let [a, b, c] = built.snapshot.products.as_slice() else {
            return Err("üç ürün beklenirdi".into());
        };
        assert_eq!((a.price_cents, a.active, a.in_stock), (12_500, true, true));
        assert_eq!((b.active, b.in_stock), (false, true));
        assert_eq!((c.active, c.in_stock), (true, false));
        assert_eq!(a.description.as_deref(), Some("Orta şekerli."));
        assert_eq!(built.snapshot.categories[0].name, "cat_a");
        let json = serde_json::to_value(&built.snapshot).map_err(|e| e.to_string())?;
        assert_eq!(json["products"][0]["priceCents"], 12_500);
        assert_eq!(json["products"][0]["categoryId"], "cat_a");
        assert_eq!(json["schema"], "kasam360.qrmenu.v1");
        Ok(())
    }

    #[test]
    fn siralama_sira_sonra_kimlikle_ve_kategorisiz_urun_dusurulur() -> Result<(), String> {
        let built = build_snapshot(
            vec![
                category("cat_b", 20),
                category("cat_a", 20),
                category("cat_z", 5),
            ],
            vec![
                product("prd_2", Some("cat_a"), 7),
                product("prd_1", Some("cat_a"), 7),
                product("prd_raw", None, 0),
                product("prd_0", Some("cat_yok"), 0),
                product("prd_neg", Some("cat_a"), -4),
            ],
        )?;
        let cats: Vec<_> = built
            .snapshot
            .categories
            .iter()
            .map(|c| c.id.as_str())
            .collect();
        assert_eq!(cats, ["cat_z", "cat_a", "cat_b"]);
        let prods: Vec<_> = built
            .snapshot
            .products
            .iter()
            .map(|p| p.id.as_str())
            .collect();
        assert_eq!(prods, ["prd_neg", "prd_1", "prd_2"]);
        assert_eq!(built.snapshot.products[0].sort_order, 0);
        Ok(())
    }

    #[test]
    fn fiyat_sinir_disinda_ise_yayin_reddedilir() {
        let mut high = product("prd_a", Some("cat_a"), 1);
        high.price_cents = 10_000_001;
        assert!(build_snapshot(vec![category("cat_a", 1)], vec![high]).is_err());
        let mut negative = product("prd_a", Some("cat_a"), 1);
        negative.price_cents = -1;
        assert!(build_snapshot(vec![category("cat_a", 1)], vec![negative]).is_err());
    }

    #[test]
    fn gorsel_icerik_adresli_tekillenir_webp_olmayan_atlanir() -> Result<(), String> {
        let mut a = product("prd_a", Some("cat_a"), 1);
        a.image_url = Some(webp_url(1));
        let mut b = product("prd_b", Some("cat_a"), 2);
        b.image_url = Some(webp_url(1));
        let mut c = product("prd_c", Some("cat_a"), 3);
        c.image_url = Some("data:image/jpeg;base64,/9j/4AAQ".into());
        let built = build_snapshot(vec![category("cat_a", 1)], vec![a, b, c])?;
        assert_eq!(built.images.len(), 1);
        assert_eq!(built.skipped_images, 1);
        let keys: Vec<_> = built
            .snapshot
            .products
            .iter()
            .map(|p| p.image_key.clone())
            .collect();
        assert_eq!(keys[0], keys[1]);
        assert_eq!(keys[0].as_ref().map(String::len), Some(64));
        assert_eq!(keys[2], None);
        Ok(())
    }

    #[tokio::test]
    async fn yerel_veritabanindan_okur_hammadde_ve_baska_kiraciyi_almaz() -> Result<(), String> {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .map_err(|e| e.to_string())?;
        sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
            .execute(&pool)
            .await
            .map_err(|e| e.to_string())?;
        sqlx::raw_sql(
            "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A'), ('tnt_b', 'B');
             INSERT INTO categories (id, tenant_id, name, display_order) VALUES ('cat_a', 'tnt_a', 'İçecek', 1), ('cat_b', 'tnt_b', 'Başka', 1);
             INSERT INTO products (id, tenant_id, name, price_cents, category_id, is_86) VALUES ('prd_a', 'tnt_a', 'Çay', 5000, 'cat_a', 1);
             INSERT INTO products (id, tenant_id, name, price_cents, category_id, is_raw) VALUES ('prd_raw', 'tnt_a', 'Şeker', 100, 'cat_a', 1);
             INSERT INTO products (id, tenant_id, name, price_cents, category_id) VALUES ('prd_b', 'tnt_b', 'Kahve', 900, 'cat_b');",
        )
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        let built = load_menu(&mut conn, "tnt_a").await?;
        assert_eq!(built.snapshot.categories.len(), 1);
        assert_eq!(built.snapshot.products.len(), 1);
        assert_eq!(built.snapshot.products[0].id, "prd_a");
        assert!(!built.snapshot.products[0].in_stock);
        Ok(())
    }
}
