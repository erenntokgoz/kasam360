//! Borç/alacak tahsilat ve tediye hareketi.

use super::ApplyError;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Row, SqliteConnection};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordPaymentInput {
    pub payment_id: String,
    pub debt_id: String,
    pub amount_cents: i64,
    pub payment_method: String,
    pub actor_id: String,
    pub notes: Option<String>,
    /// Ekranın gördüğü ödeme sayısı; eski görünümle yapılan ödeme reddedilir.
    pub expected_version: i64,
    /// Nakitte kasa hareketi kimliği, açık vardiya ile birlikte taşınır.
    pub cash_movement_id: Option<String>,
    pub shift_id: Option<String>,
    pub created_at: String,
}

fn rejected(message: impl Into<String>) -> ApplyError {
    ApplyError::Rejected(message.into())
}

pub(super) async fn apply_payment(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    input: &RecordPaymentInput,
) -> Result<Value, ApplyError> {
    if input.amount_cents <= 0 {
        return Err(rejected("VALIDATION: ödeme tutarı 0'dan büyük olmalıdır"));
    }
    if !["CASH", "CREDIT_CARD", "BANK_TRANSFER"].contains(&input.payment_method.as_str()) {
        return Err(rejected("VALIDATION: geçersiz ödeme yöntemi"));
    }
    let debt = sqlx::query(
        "SELECT deb.type, deb.remaining_amount_cents, dir.name AS directory_name,
                (SELECT COUNT(*) FROM debt_payments dp
                 WHERE dp.debt_id = deb.id AND dp.tenant_id = deb.tenant_id) AS version
         FROM debts deb
         JOIN directories dir ON dir.id = deb.directory_id AND dir.tenant_id = deb.tenant_id
         WHERE deb.id = ? AND deb.tenant_id = ?",
    )
    .bind(&input.debt_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| rejected("NOT_FOUND: borç kaydı bulunamadı"))?;

    let version: i64 = debt.try_get("version")?;
    if version != input.expected_version {
        return Err(rejected(
            "CONFLICT: bu kayıt başka bir işlemle değişti; güncel bakiyeyi görüp yeniden deneyin",
        ));
    }
    let remaining: i64 = debt.try_get("remaining_amount_cents")?;
    if input.amount_cents > remaining {
        return Err(rejected(format!(
            "CONFLICT: ödeme tutarı ({}) kalan tutarı ({}) aşamaz",
            input.amount_cents, remaining
        )));
    }
    let debt_type: String = debt.try_get("type")?;
    let directory_name: String = debt.try_get("directory_name")?;
    let new_remaining = remaining - input.amount_cents;
    let status = if new_remaining == 0 {
        "PAID"
    } else {
        "PARTIAL"
    };

    let updated = sqlx::query(
        "UPDATE debts SET remaining_amount_cents = ?, status = ?
         WHERE id = ? AND tenant_id = ? AND remaining_amount_cents = ?",
    )
    .bind(new_remaining)
    .bind(status)
    .bind(&input.debt_id)
    .bind(tenant_id)
    .bind(remaining)
    .execute(&mut *conn)
    .await?;
    if updated.rows_affected() != 1 {
        return Err(ApplyError::Internal(
            "Borç bakiyesi güncellenemedi".to_string(),
        ));
    }

    if input.payment_method == "CASH" {
        let (Some(movement_id), Some(shift_id)) = (&input.cash_movement_id, &input.shift_id) else {
            return Err(rejected(
                "VALIDATION: nakit hareket için açık vardiya gerekir",
            ));
        };
        let (movement_type, reason) = if debt_type == "GIVEN" {
            ("IN", format!("Cari Alacak Tahsilatı: {directory_name}"))
        } else {
            ("OUT", format!("Cari Borç Tediyesi: {directory_name}"))
        };
        sqlx::query(
            "INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents,
                                         reason, actor_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(movement_id)
        .bind(tenant_id)
        .bind(shift_id)
        .bind(movement_type)
        .bind(input.amount_cents)
        .bind(&reason)
        .bind(&input.actor_id)
        .bind(&input.created_at)
        .execute(&mut *conn)
        .await?;
    }

    sqlx::query(
        "INSERT INTO debt_payments (id, tenant_id, debt_id, amount_cents, payment_method,
                                    shift_id, actor_id, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&input.payment_id)
    .bind(tenant_id)
    .bind(&input.debt_id)
    .bind(input.amount_cents)
    .bind(&input.payment_method)
    .bind(&input.shift_id)
    .bind(&input.actor_id)
    .bind(&input.notes)
    .bind(&input.created_at)
    .execute(&mut *conn)
    .await?;

    Ok(json!({
        "paymentId": input.payment_id,
        "debtId": input.debt_id,
        "amountCents": input.amount_cents,
        "remainingAmountCents": new_remaining,
        "status": status,
        "cashMovementId": input.cash_movement_id,
    }))
}
