//! Dönem bordrosuna ödeme.
//!
//! Her ödeme tek gider ve (nakitse) tek kasa çıkışı yazar; ayrı kasa satırı yazan eski
//! yol bordro ödemesini genel giderlerde göstermiyordu. Nakit çıkışı kasa bakiyesini
//! kontrol etmez: bakiye negatife düşebilir ama açık vardiya yoksa ödeme reddedilir.
//! Para çıkışı olduğu için müdür yalnız işletme sahibi onay jetonuyla yapabilir.

use sqlx::SqliteConnection;

use crate::approval_service::operation;
use crate::id_generator::generate_id;
use crate::services::audit_service::{self, AuditContext, AuditLock, AuditService};
use crate::services::expense_service::{insert_expense, NewExpense};
use crate::services::staff360::payroll_gate::{self, authorize_money_out};
use crate::services::staff360::staff_settlement::{PayActor, EXPENSE_CATEGORY};

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

/// Bordro satırına ödeme yazar ve kalan bordro borcunu (kuruş) döndürür.
pub async fn pay_run(
    conn: &mut SqliteConnection,
    audit_lock: &AuditLock<'_>,
    tenant_id: &str,
    actor: &PayActor<'_>,
    payroll_run_id: &str,
    amount_cents: i64,
    payment_method: &str,
    now_iso: &str,
) -> Result<i64, String> {
    if amount_cents <= 0 || !matches!(payment_method, "CASH" | "BANK_TRANSFER") {
        return Err("VALIDATION: ödeme tutarı veya kanalı geçersiz".to_string());
    }
    let row: Option<(i64, i64, String, String)> = sqlx::query_as(
        "SELECT r.net_cents,
                COALESCE((SELECT SUM(p.amount_cents) FROM payroll_payments p
                           WHERE p.tenant_id = r.tenant_id AND p.payroll_run_id = r.id), 0),
                r.period, u.name
           FROM payroll_runs r
           JOIN users u ON u.id = r.user_id AND u.tenant_id = r.tenant_id
          WHERE r.tenant_id = ? AND r.id = ?",
    )
    .bind(tenant_id)
    .bind(payroll_run_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    let Some((net, paid, period, full_name)) = row else {
        return Err("NOT_FOUND: bordro kaydı bulunamadı".to_string());
    };
    let remaining = net.saturating_sub(paid).max(0);
    if amount_cents > remaining {
        return Err(format!("CONFLICT: kalan bordro borcu {remaining} kuruş"));
    }

    let resource = payroll_gate::resource(operation::PAYROLL_PAY, payroll_run_id);
    let authorized = authorize_money_out(
        conn,
        audit_lock,
        tenant_id,
        actor.id,
        actor.role,
        operation::PAYROLL_PAY,
        &resource,
        amount_cents,
        actor.approval_token,
    )
    .await?;

    let description = format!("Bordro ödemesi: {full_name} · {period}");
    let (expense_id, _) = insert_expense(
        conn,
        tenant_id,
        &NewExpense {
            category: EXPENSE_CATEGORY,
            amount_cents,
            payment_method,
            directory_id: None,
            recurring_id: None,
            actor_id: actor.id,
            description: Some(&description),
            expense_date: now_iso,
        },
    )
    .await?;
    sqlx::query(
        "INSERT INTO payroll_payments
             (id, tenant_id, payroll_run_id, amount_cents, payment_method, actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(generate_id("ppay"))
    .bind(tenant_id)
    .bind(payroll_run_id)
    .bind(amount_cents)
    .bind(payment_method)
    .bind(actor.id)
    .bind(now_iso)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    let context = AuditContext::new(
        tenant_id.to_string(),
        actor.id.to_string(),
        actor.role.to_string(),
        audit_service::category::PERSONEL,
        "payroll:payment",
        payroll_run_id.to_string(),
        serde_json::json!({
            "period": period,
            "amountCents": amount_cents,
            "paymentMethod": payment_method,
            "expenseId": expense_id,
            "approverId": authorized.approver_id,
        }),
        now_iso.to_string(),
    )?;
    AuditService::append(conn, audit_lock, &context).await?;
    Ok(remaining - amount_cents)
}
