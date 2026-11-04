//! Gider yazma, iptal ve personel avansı.
//!
//! Neden iptal satırı silip arşive taşıyor: gider toplamları P&L, bütçe, panorama ve
//! kasa mutabakatı dahil çok yerden okunur. Satırda "iptal" bayrağı tutmak her okuyucuya
//! filtre eklemeyi gerektirirdi; biri unutulursa iptal edilen gider kârdan düşmeye devam
//! ederdi. İz `voided_expenses` ve denetim defterinde kalır.

use sqlx::{Row, SqliteConnection};

use crate::id_generator::generate_id;

pub struct NewExpense<'a> {
    pub category: &'a str,
    pub amount_cents: i64,
    pub payment_method: &'a str,
    pub directory_id: Option<&'a str>,
    pub recurring_id: Option<&'a str>,
    pub actor_id: &'a str,
    pub description: Option<&'a str>,
    pub expense_date: &'a str,
}

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

async fn open_shift(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Option<String>, String> {
    sqlx::query_scalar(
        "SELECT id FROM shifts WHERE tenant_id = ? AND status = 'OPEN'
         ORDER BY opened_at DESC LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)
}

async fn cash_movement(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    shift_id: &str,
    direction: &str,
    amount_cents: i64,
    reason: &str,
    actor_id: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO cash_movements
             (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
    )
    .bind(generate_id("csh"))
    .bind(tenant_id)
    .bind(shift_id)
    .bind(direction)
    .bind(amount_cents)
    .bind(reason)
    .bind(actor_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| format!("Kasa hareketi işlenemedi: {e}"))?;
    Ok(())
}

/// Gideri yazar; nakitse açık vardiyanın kasasından düşer.
pub async fn insert_expense(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    expense: &NewExpense<'_>,
) -> Result<(String, Option<String>), String> {
    let id = generate_id("exp");
    let shift_id = open_shift(conn, tenant_id).await?;
    if expense.payment_method == "CASH" {
        let reason = format!("Gider: {}", expense.description.unwrap_or("-"));
        let shift = shift_id
            .as_deref()
            .ok_or_else(|| "SHIFT_REQUIRED: nakit gider için açık vardiya gerekir.".to_string())?;
        crate::commands::cashier_commands::ensure_drawer_covers(
            conn,
            tenant_id,
            shift,
            expense.amount_cents,
        )
        .await?;
        cash_movement(
            conn,
            tenant_id,
            shift,
            "OUT",
            expense.amount_cents,
            &reason,
            expense.actor_id,
        )
        .await?;
    }
    sqlx::query(
        "INSERT INTO general_expenses
             (id, tenant_id, category, amount_cents, payment_method, directory_id, shift_id,
              actor_id, description, expense_date, recurring_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(expense.category)
    .bind(expense.amount_cents)
    .bind(expense.payment_method)
    .bind(expense.directory_id)
    .bind(&shift_id)
    .bind(expense.actor_id)
    .bind(expense.description)
    .bind(expense.expense_date)
    .bind(expense.recurring_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| format!("Gider kaydı oluşturulamadı: {e}"))?;
    Ok((id, shift_id))
}

/// Gideri iptal eder. Kapanmış vardiyanın gideri iptal edilemez: Z raporu değişirdi.
pub async fn void_expense(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    expense_id: &str,
    actor_id: &str,
    reason: &str,
) -> Result<(i64, String), String> {
    if reason.trim().is_empty() {
        return Err("VALIDATION: iptal nedeni zorunludur.".to_string());
    }
    let row = sqlx::query(
        "SELECT e.category, e.amount_cents, e.payment_method, e.description, e.expense_date,
                e.shift_id, s.status AS shift_status
         FROM general_expenses e
         LEFT JOIN shifts s ON s.id = e.shift_id AND s.tenant_id = e.tenant_id
         WHERE e.tenant_id = ? AND e.id = ?",
    )
    .bind(tenant_id)
    .bind(expense_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?
    .ok_or_else(|| format!("NOT_FOUND: gider bulunamadı: {expense_id}"))?;

    let category: String = row.try_get("category").map_err(text_error)?;
    let amount_cents: i64 = row.try_get("amount_cents").map_err(text_error)?;
    let method: String = row.try_get("payment_method").map_err(text_error)?;
    let shift_id: Option<String> = row.try_get("shift_id").map_err(text_error)?;
    let shift_status: Option<String> = row.try_get("shift_status").map_err(text_error)?;

    if shift_id.is_some() && shift_status.as_deref() != Some("OPEN") {
        return Err("INVALID_STATE: kapanmış vardiyanın gideri iptal edilemez.".to_string());
    }
    if method == "CASH" {
        let target = match &shift_id {
            Some(id) => Some(id.clone()),
            None => open_shift(conn, tenant_id).await?,
        };
        let target = target
            .ok_or_else(|| "SHIFT_REQUIRED: nakit iade için açık vardiya gerekir.".to_string())?;
        cash_movement(
            conn,
            tenant_id,
            &target,
            "IN",
            amount_cents,
            &format!("Gider iptali: {reason}"),
            actor_id,
        )
        .await?;
    }

    sqlx::query(
        "INSERT INTO voided_expenses
             (id, tenant_id, category, amount_cents, payment_method, description, expense_date,
              shift_id, void_reason, voided_by, voided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
    )
    .bind(expense_id)
    .bind(tenant_id)
    .bind(&category)
    .bind(amount_cents)
    .bind(&method)
    .bind(
        row.try_get::<Option<String>, _>("description")
            .map_err(text_error)?,
    )
    .bind(
        row.try_get::<String, _>("expense_date")
            .map_err(text_error)?,
    )
    .bind(&shift_id)
    .bind(reason.trim())
    .bind(actor_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    sqlx::query("DELETE FROM staff_advances WHERE tenant_id = ? AND expense_id = ?")
        .bind(tenant_id)
        .bind(expense_id)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    sqlx::query("DELETE FROM general_expenses WHERE tenant_id = ? AND id = ?")
        .bind(tenant_id)
        .bind(expense_id)
        .execute(&mut *conn)
        .await
        .map_err(text_error)?;
    Ok((amount_cents, category))
}

/// Avans gider olarak yazılır ve döneminin bordrosundan düşülür.
pub async fn record_staff_advance(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: &str,
    period: &str,
    amount_cents: i64,
    payment_method: &str,
    actor_id: &str,
    expense_date: &str,
) -> Result<String, String> {
    if amount_cents <= 0 {
        return Err("VALIDATION: avans tutarı 0'dan büyük olmalıdır.".to_string());
    }
    let name: String = sqlx::query_scalar("SELECT name FROM users WHERE tenant_id = ? AND id = ?")
        .bind(tenant_id)
        .bind(user_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(text_error)?
        .ok_or_else(|| "NOT_FOUND: personel bulunamadı".to_string())?;
    let description = format!("Avans: {name}");
    let (expense_id, _) = insert_expense(
        conn,
        tenant_id,
        &NewExpense {
            category: "STAFF_ADVANCE",
            amount_cents,
            payment_method,
            directory_id: None,
            recurring_id: None,
            actor_id,
            description: Some(&description),
            expense_date,
        },
    )
    .await?;
    let id = generate_id("adv");
    sqlx::query(
        "INSERT INTO staff_advances
             (id, tenant_id, user_id, period, amount_cents, expense_id, actor_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(user_id)
    .bind(period)
    .bind(amount_cents)
    .bind(&expense_id)
    .bind(actor_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(id)
}

/// Sütun sonradan geldi: eski kurulumda sabit gider ödemesi başlıkla eşleşiyordu.
pub async fn ensure_column(pool: &sqlx::SqlitePool) -> Result<(), sqlx::Error> {
    let present: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('general_expenses') WHERE name = 'recurring_id'",
    )
    .fetch_one(pool)
    .await?;
    if present == 0 {
        sqlx::query("ALTER TABLE general_expenses ADD COLUMN recurring_id TEXT")
            .execute(pool)
            .await?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "expense_service_tests.rs"]
mod tests;
