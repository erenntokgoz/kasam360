use serde::Deserialize;
use sqlx::SqliteConnection;

use crate::id_generator::generate_id;
use crate::management_commands::ensure_owned;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceFreezeInput {
    pub product_id: String,
    pub frozen_price_cents: i64,
    pub reason: Option<String>,
    pub valid_from: String,
    pub valid_to: String,
}

/// Fiyat dondurma kaydı açar. Donmuş fiyat ürün fiyatından **yüksek** olamaz:
/// bu bir zam değil, taahhüt kaydıdır. Yüksek fiyat "fiyat arttı" izlenimi
/// üretir ve kasada kavga çıkarır.
pub async fn create_price_freeze(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    input: PriceFreezeInput,
) -> Result<String, String> {
    if input.frozen_price_cents < 0 {
        return Err("VALIDATION: dondurulacak fiyat negatif olamaz".into());
    }
    if input.valid_to < input.valid_from {
        return Err("VALIDATION: dondurma bitişi başlangıcından önce olamaz".into());
    }
    ensure_owned(conn, "products", &input.product_id, tenant_id).await?;

    let mevcut: i64 =
        sqlx::query_scalar("SELECT price_cents FROM products WHERE id = ? AND tenant_id = ?")
            .bind(&input.product_id)
            .bind(tenant_id)
            .fetch_one(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    if input.frozen_price_cents > mevcut {
        return Err(format!(
            "VALIDATION: dondurulacak fiyat ({}) ürün fiyatından ({}) yüksek, bu zam olarak yorumlanır",
            input.frozen_price_cents, mevcut
        ));
    }

    let id = generate_id("frz");
    sqlx::query(
        "INSERT INTO price_freezes
             (id, tenant_id, product_id, frozen_price_cents, reason, valid_from, valid_to, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(&input.product_id)
    .bind(input.frozen_price_cents)
    .bind(&input.reason)
    .bind(&input.valid_from)
    .bind(&input.valid_to)
    .bind(actor_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}
