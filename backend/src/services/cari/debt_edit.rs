//! Açık cari kaydın düzeltilmesi ve silinmesi.
//!
//! Yalnız hiç ödeme görmemiş, elle açılmış kayıt değişir: ödeme varsa kalan tutar geçmişe
//! bağlıdır, siparişten gelen kayıt da adisyonun tutarıdır.

use super::ops::validate_iso_date;
use super::ApplyError;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Row, SqliteConnection};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditDebtInput {
    pub debt_id: String,
    pub amount_cents: i64,
    pub due_date: Option<String>,
    pub description: Option<String>,
}

fn rejected(message: &str) -> ApplyError {
    ApplyError::Rejected(message.to_string())
}

async fn require_untouched(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    debt_id: &str,
) -> Result<(), ApplyError> {
    let row = sqlx::query(
        "SELECT deb.order_id,
                (SELECT COUNT(*) FROM debt_payments dp
                  WHERE dp.debt_id = deb.id AND dp.tenant_id = deb.tenant_id) AS payments
           FROM debts deb WHERE deb.id = ? AND deb.tenant_id = ?",
    )
    .bind(debt_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| rejected("NOT_FOUND: borç kaydı bulunamadı"))?;
    let payments: i64 = row.try_get("payments")?;
    let order_id: Option<String> = row.try_get("order_id")?;
    if payments > 0 {
        return Err(rejected("CONFLICT: ödeme alınmış kayıt değiştirilemez"));
    }
    if order_id.is_some() {
        return Err(rejected("CONFLICT: siparişten gelen kayıt değiştirilemez"));
    }
    Ok(())
}

pub(super) async fn apply_edit(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    input: &EditDebtInput,
) -> Result<Value, ApplyError> {
    if input.amount_cents <= 0 {
        return Err(rejected("VALIDATION: tutar 0'dan büyük olmalıdır"));
    }
    validate_iso_date(input.due_date.as_deref())?;
    require_untouched(conn, tenant_id, &input.debt_id).await?;
    sqlx::query(
        "UPDATE debts SET total_amount_cents = ?, remaining_amount_cents = ?, due_date = ?,
                          description = ?
          WHERE id = ? AND tenant_id = ?",
    )
    .bind(input.amount_cents)
    .bind(input.amount_cents)
    .bind(&input.due_date)
    .bind(&input.description)
    .bind(&input.debt_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await?;
    Ok(json!({ "debtId": input.debt_id, "totalAmountCents": input.amount_cents }))
}

pub(super) async fn apply_delete(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    debt_id: &str,
) -> Result<Value, ApplyError> {
    require_untouched(conn, tenant_id, debt_id).await?;
    sqlx::query("DELETE FROM debts WHERE id = ? AND tenant_id = ?")
        .bind(debt_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await?;
    Ok(json!({ "debtId": debt_id }))
}
