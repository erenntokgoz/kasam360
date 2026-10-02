use crate::commands::{CartItemDto, PaymentPayloadDto};
use sqlx::Row;
use uuid::Uuid;

pub struct PaymentRepository;

/// Sunucu tarafı hesabın dökümü. `total_cents` tek doğruluk kaynağıdır; indirim
/// tutarı **aynı hesaptan** türetilir, ikinci bir hesap yöntemi (ikinci gerçek)
/// yaratılmaz. Denetim defteri bu alanları okuyup "İndirim & İkram" filtresini
/// besler.
pub struct ServerTruth {
    pub subtotal_cents: i64,
    pub tax_cents: i64,
    pub discount_cents: i64,
    pub gross_cents: i64,
    pub total_cents: i64,
}

impl PaymentRepository {
    /// Aynı işlem kimliği farklı tenant'larda kullanılabilir; çakışma
    /// kontrolü bu yüzden tenant'a göre daraltılır.
    pub async fn check_idempotency(
        conn: &mut sqlx::SqliteConnection,
        transaction_id: &str,
        tenant_id: &str,
    ) -> Result<bool, String> {
        let existing: Option<sqlx::sqlite::SqliteRow> = sqlx::query(
            "SELECT id FROM audit_ledger WHERE resource_id = ? AND tenant_id = ? LIMIT 1",
        )
        .bind(transaction_id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        Ok(existing.is_some())
    }

    /// Sunucu tarafı hesabın dökümü. `total_cents` tek doğruluk kaynağıdır;
    /// indirim tutarı **aynı hesaptan** türetilir, ikinci bir hesap yöntemi
    /// (ikinci gerçek) yaratılmaz.
    ///
    /// `tenant_id` neden parametre: seçenek fiyat farkı istemciden değil
    /// `modifier_options`'tan okunur (faz 4) ve bu okuma tenant'a göre
    /// filtrelenmelidir.
    pub async fn calculate_server_truth(
        conn: &mut sqlx::SqliteConnection,
        tenant_id: &str,
        items: &[CartItemDto],
        global_discount: Option<&serde_json::Value>,
    ) -> Result<ServerTruth, String> {
        let mut subtotal_all_cents: i64 = 0;
        let mut tax_all_cents: i64 = 0;
        let mut gross_all_cents: i64 = 0;
        let mut item_discount_all_cents: i64 = 0;

        for item in items {
            let product_id = item.product.get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing product.id in cart item".to_string())?;

            // 1. Önce siparişte dondurulmuş birim fiyat var mı kontrol et (Price Drift Koruması)
            // `order_items` kendi `tenant_id` taşımaz; sahiplik `orders` üzerinden
            // doğrulanır, böylece başka işletmenin kalemi fiyat kaynağı olamaz.
            let frozen_order_item = sqlx::query(
                "SELECT oi.unit_price_cents, oi.tax_rate FROM order_items oi \
                 JOIN orders o ON o.id = oi.order_id \
                 WHERE oi.id = ? AND o.tenant_id = ?",
            )
                .bind(&item.id)
                .bind(tenant_id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;

            let (db_price_cents, db_tax_rate, frozen): (i64, f64, bool) = if let Some(r) = frozen_order_item {
                (
                    r.try_get("unit_price_cents").unwrap_or(0),
                    r.try_get("tax_rate").unwrap_or(0.0),
                    true,
                )
            } else {
                let row = sqlx::query("SELECT price_cents, tax_rate FROM products WHERE id = ? AND tenant_id = ?")
                    .bind(product_id)
                    .bind(tenant_id)
                    .fetch_optional(&mut *conn)
                    .await
                    .map_err(|e| e.to_string())?;

                match row {
                    Some(r) => (
                        r.try_get("price_cents").unwrap_or(0),
                        r.try_get("tax_rate").unwrap_or(0.0),
                        false,
                    ),
                    None => return Err(format!("Product not found in database: {}", product_id)),
                }
            };

            // Fiyat tek yerden türetilir (faz 4): donmuş fiyat modifier'ı zaten
            // içerir, üzerine eklenmez — eklenirse aynı ekstra iki kez ücretlenir.
            // Donmuş fiyat yoksa seçeneklerin **veritabanı** fiyatı eklenir;
            // istemcinin bildirdiği `priceCents` değeri kullanılmaz.
            let item_unit_price = crate::services::modifier_service::resolve_unit_price(
                conn,
                tenant_id,
                (db_price_cents, db_tax_rate),
                item.modifiers.as_ref(),
                if frozen { Some(db_price_cents) } else { None },
            )
            .await?;

            let quantity = item.quantity;
            let gross_cents = item_unit_price * quantity;
            let mut discount_amount_cents: i64 = 0;

            // Kalem bazlı indirim tutarını hesapla (yüzdelik veya sabit tutar)
            if let Some(disc) = &item.discount {
                let disc_type = disc.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let disc_val = disc.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
                if disc_val > 0.0 {
                    if disc_type == "PERCENTAGE" {
                        let pct = disc_val.min(100.0);
                        discount_amount_cents = ((gross_cents as f64) * (pct / 100.0)).round() as i64;
                    } else if disc_type == "FIXED_AMOUNT" {
                        discount_amount_cents = (disc_val.round() as i64).min(gross_cents);
                    }
                }
            }

            let subtotal_cents = (gross_cents - discount_amount_cents).max(0);
            let tax_rate_int = db_tax_rate.round() as i64;
            let tax_amount_cents = (subtotal_cents * tax_rate_int) / 100;

            subtotal_all_cents += subtotal_cents;
            tax_all_cents += tax_amount_cents;
            gross_all_cents += gross_cents;
            item_discount_all_cents += discount_amount_cents;
        }

        let mut grand_total_cents = subtotal_all_cents + tax_all_cents;
        let mut global_discount_cents: i64 = 0;

        // Sepet geneli (global) indirim tutarını uygula
        if let Some(g_disc) = global_discount {
            let disc_type = g_disc.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let disc_val = g_disc.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
            if disc_val > 0.0 {
                global_discount_cents = if disc_type == "PERCENTAGE" {
                    let pct = disc_val.min(100.0);
                    ((grand_total_cents as f64) * (pct / 100.0)).round() as i64
                } else {
                    (disc_val.round() as i64).min(grand_total_cents)
                };
                grand_total_cents = (grand_total_cents - global_discount_cents).max(0);
            }
        }

        Ok(ServerTruth {
            subtotal_cents: subtotal_all_cents,
            tax_cents: tax_all_cents,
            discount_cents: item_discount_all_cents + global_discount_cents,
            gross_cents: gross_all_cents,
            total_cents: grand_total_cents,
        })
    }

    /// Toplam tutar: `calculate_server_truth` dökümünün tek alanıdır.
    pub async fn calculate_server_truth_total(
        conn: &mut sqlx::SqliteConnection,
        tenant_id: &str,
        items: &[CartItemDto],
        global_discount: Option<&serde_json::Value>,
    ) -> Result<i64, String> {
        let truth = Self::calculate_server_truth(conn, tenant_id, items, global_discount).await?;
        Ok(truth.total_cents)
    }

    pub async fn insert_sale_event(
        conn: &mut sqlx::SqliteConnection,
        payload: &PaymentPayloadDto,
        tenant_id: &str,
    ) -> Result<(), String> {
        let sale_event_id = format!("evt_sale_{}", Uuid::new_v4());
        let payload_json = serde_json::to_string(payload).map_err(|e| e.to_string())?;

        sqlx::query(
            "INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at) \
             VALUES (?, ?, ?, 'SALE', 'SALE_SETTLED', ?, datetime('now'))",
        )
        .bind(&sale_event_id)
        .bind(tenant_id)
        .bind(&payload.transaction_id)
        .bind(&payload_json)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        let outbox_sale_id = format!("outbox_{}", Uuid::new_v4());
        sqlx::query(
            "INSERT INTO outbox (id, tenant_id, event_id, status, created_at) VALUES (?, ?, ?, 'PENDING', datetime('now'))",
        )
        .bind(&outbox_sale_id)
        .bind(tenant_id)
        .bind(&sale_event_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub async fn close_order_if_applicable(
        conn: &mut sqlx::SqliteConnection,
        order_id: Option<&str>,
        tenant_id: &str,
    ) -> Result<(), String> {
        if let Some(o_id) = order_id {
            let order_row = sqlx::query(
                "SELECT table_id FROM orders WHERE id = ? AND status = 'OPEN' AND tenant_id = ?",
            )
                .bind(o_id)
                .bind(tenant_id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;

            if let Some(row) = order_row {
                let table_id: String = row.try_get("table_id").unwrap_or_default();

                sqlx::query("UPDATE orders SET status = 'PAID' WHERE id = ? AND tenant_id = ?")
                    .bind(o_id)
                    .bind(tenant_id)
                    .execute(&mut *conn)
                    .await
                    .map_err(|e| e.to_string())?;

                sqlx::query("UPDATE tables SET status = 'AVAILABLE' WHERE id = ? AND status = 'RESERVED' AND tenant_id = ?")
                    .bind(&table_id)
                    .bind(tenant_id)
                    .execute(&mut *conn)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::CartItemDto;
    use sqlx::sqlite::SqlitePoolOptions;

    const TEST_TENANT: &str = "tenant_test";

    async fn catalog_pool() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("bellek içi veritabanı");
        // Faz 4: fiyat ve donmuş kalem okumaları tenant'a göre filtrelenir;
        // `order_items` → `orders` zinciri de kurulmalı.
        sqlx::raw_sql(
            "CREATE TABLE products (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, price_cents INTEGER NOT NULL, tax_rate REAL NOT NULL);
             CREATE TABLE orders (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL);
             CREATE TABLE order_items (id TEXT PRIMARY KEY, order_id TEXT, unit_price_cents INTEGER NOT NULL, tax_rate REAL NOT NULL);
             INSERT INTO products VALUES ('prod_1', 'tenant_test', 10000, 20.0);",
        )
        .execute(&pool)
        .await
        .expect("katalog hazırlanır");
        pool
    }

    fn item(quantity: i64, discount: Option<serde_json::Value>) -> CartItemDto {
        CartItemDto {
            id: format!("item_{}", quantity),
            product: serde_json::json!({ "id": "prod_1" }),
            quantity,
            unit_price: 0,
            tax_rate: Some(20),
            subtotal: None,
            tax_amount: None,
            total: None,
            modifiers: None,
            note: None,
            discount,
        }
    }

    /// İndirim tutarı toplamla aynı hesaptan türetilir. Denetim defterindeki
    /// "İndirim & İkram" filtresi bu alana dayanır; iki hesap ayrışırsa kayıt
    /// ekranda yanlış görünür.
    #[tokio::test]
    async fn indirim_tutari_ayni_hesaptan_turetilir() {
        let pool = catalog_pool().await;
        let mut conn = pool.acquire().await.expect("bağlantı");

        let items = vec![item(
            2,
            Some(serde_json::json!({ "type": "PERCENTAGE", "value": 10.0 })),
        )];
        let truth = PaymentRepository::calculate_server_truth(&mut conn, TEST_TENANT, &items, None)
            .await
            .expect("hesaplanır");

        // 2 x 10000 = 20000 brüt, %10 = 2000 indirim, ara toplam 18000, KDV %20 = 3600.
        assert_eq!(truth.gross_cents, 20000);
        assert_eq!(truth.discount_cents, 2000);
        assert_eq!(truth.subtotal_cents, 18000);
        assert_eq!(truth.tax_cents, 3600);
        assert_eq!(truth.total_cents, 21600);
    }

    /// Sepet geneli indirim kalem indirimine eklenir; toplam alanı tek yerde
    /// hesaplanmaya devam eder.
    #[tokio::test]
    async fn sepet_geneli_indirim_toplam_indirime_eklenir() {
        let pool = catalog_pool().await;
        let mut conn = pool.acquire().await.expect("bağlantı");

        let items = vec![item(
            1,
            Some(serde_json::json!({ "type": "FIXED_AMOUNT", "value": 2000.0 })),
        )];
        let global = serde_json::json!({ "type": "PERCENTAGE", "value": 10.0 });
        let truth = PaymentRepository::calculate_server_truth(&mut conn, TEST_TENANT, &items, Some(&global))
            .await
            .expect("hesaplanır");

        // 10000 brüt - 2000 kalem = 8000, +%20 KDV = 9600, -%10 sepet geneli = 8640.
        assert_eq!(truth.discount_cents, 2000 + 960);
        assert_eq!(truth.total_cents, 8640);

        // Eski tek alanlı yardımcı da aynı sonucu vermeli (ikinci gerçek yok).
        let total = PaymentRepository::calculate_server_truth_total(&mut conn, TEST_TENANT, &items, Some(&global))
            .await
            .expect("hesaplanır");
        assert_eq!(total, truth.total_cents);
    }

    /// İndirimsiz sepette indirim tutarı sıfırdır: filtre yanlış pozitif üretmez.
    #[tokio::test]
    async fn indirimsiz_sepet_indirim_tutari_sifirdir() {
        let pool = catalog_pool().await;
        let mut conn = pool.acquire().await.expect("bağlantı");

        let items = vec![item(1, None)];
        let truth = PaymentRepository::calculate_server_truth(&mut conn, TEST_TENANT, &items, None)
            .await
            .expect("hesaplanır");
        assert_eq!(truth.discount_cents, 0);
        assert_eq!(truth.total_cents, 12000);
    }
}
