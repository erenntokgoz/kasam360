//! Çıkışta kesilen personel hesabı ve personel borcu.
//!
//! Çalışma kaydı kapanınca ücret hesaplanır ve `staff_settlements` satırı olur. Ücret
//! ödenmedi ya da sorulan "ödeme yapıldı mı?" yanıtsız kaldıysa tutar personel borcu
//! olarak durur; hiçbir yol borcu kendiliğinden ödenmiş saymaz. Ödeme ayrı bir olaydır:
//! her ödeme tek gider ve (nakitse) tek kasa çıkışı yazar. Kısmi ödeme borcu azaltır,
//! kalan korunur; sonradan ödeme yalnız kalanı kapatır ve aynı istek kimliğiyle tekrar
//! gönderilirse ikinci gider yazılmaz.
//!
//! Gider ödeme anında yazılır (nakit esaslı): işletmenin kira, tedarikçi ve avans
//! giderleri de para çıktığında yazıldığı için bordro aynı kuralı izler. Tahakkuk anında
//! gider yazmak, ödeme anında ikinci bir gider yazmayı gerektirirdi.

use serde::Serialize;
use sqlx::SqliteConnection;

use crate::approval_service::operation;
use crate::id_generator::generate_id;
use crate::services::audit_service::{self, AuditContext, AuditLock, AuditService};
use crate::services::expense_service::{insert_expense, NewExpense};
use crate::services::staff360::payroll_gate::{self, authorize_money_out};
pub use crate::services::staff360::settlement_accrual::{accrue_on_close, daily_settled};

pub const KIND_HOURLY: &str = "HOURLY";
pub const KIND_DAILY: &str = "DAILY";
pub const EXPENSE_CATEGORY: &str = "STAFF_PAY";

/// Kapanan çalışma kaydı; saatler kanonik UTC metnidir.
pub struct ClosedSession<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub work_date: &'a str,
    pub worked_seconds: i64,
}

/// Hesabın sonucu. `settlement_id` yoksa `note` nedeni söyler.
#[derive(Debug)]
pub struct Accrual {
    pub settlement_id: Option<String>,
    pub note: Option<String>,
}

/// Arayüze dönen hesap satırı. Tutarlar `None` = çağıran tutarı göremiyor.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffSettlement {
    pub id: String,
    pub user_id: String,
    pub full_name: String,
    pub work_session_id: String,
    pub work_date: String,
    /// `HOURLY` | `DAILY`. Günlük ücrette arayüz saat karşılığı göstermez.
    pub kind: String,
    pub worked_seconds: i64,
    pub rate_cents: Option<i64>,
    pub earned_cents: Option<i64>,
    pub paid_cents: Option<i64>,
    pub remaining_cents: Option<i64>,
    /// `UNPAID` | `PARTIAL` | `PAID`
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSettlement {
    pub settlement: Option<StaffSettlement>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffDebt {
    pub user_id: String,
    pub full_name: String,
    pub open_count: i64,
    pub remaining_cents: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettlementPayment {
    pub payment_id: String,
    pub expense_id: String,
    pub settlement_id: String,
    pub amount_cents: i64,
    pub remaining_cents: i64,
    /// Aynı istek kimliği daha önce işlendi; yeni gider ya da kasa hareketi yazılmadı.
    pub replayed: bool,
}

pub(super) fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

pub(super) async fn paid_total(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    settlement_id: &str,
) -> Result<i64, String> {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM staff_settlement_payments
          WHERE tenant_id = ? AND settlement_id = ?",
    )
    .bind(tenant_id)
    .bind(settlement_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)
}

type SettlementRow = (
    String,
    String,
    String,
    String,
    String,
    String,
    i64,
    i64,
    i64,
    i64,
    String,
);

const SELECT_SETTLEMENT: &str =
    "SELECT s.id, s.user_id, u.name, s.work_session_id, s.work_date, s.kind,
        s.worked_seconds, s.rate_cents, s.earned_cents,
        COALESCE((SELECT SUM(p.amount_cents) FROM staff_settlement_payments p
                   WHERE p.tenant_id = s.tenant_id AND p.settlement_id = s.id), 0),
        s.created_at
   FROM staff_settlements s
   JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id";

fn to_dto(row: SettlementRow, can_see_amounts: bool) -> StaffSettlement {
    let (id, user_id, full_name, work_session_id, work_date, kind, seconds, rate, earned, paid, at) =
        row;
    let remaining = earned - paid;
    let status = if remaining <= 0 {
        "PAID"
    } else if paid == 0 {
        "UNPAID"
    } else {
        "PARTIAL"
    };
    let shown = |value: i64| can_see_amounts.then_some(value);
    StaffSettlement {
        id,
        user_id,
        full_name,
        work_session_id,
        work_date,
        kind,
        worked_seconds: seconds,
        rate_cents: shown(rate),
        earned_cents: shown(earned),
        paid_cents: shown(paid),
        remaining_cents: shown(remaining.max(0)),
        status: status.to_string(),
        created_at: at,
    }
}

pub async fn get(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    settlement_id: &str,
    can_see_amounts: bool,
) -> Result<StaffSettlement, String> {
    let row: Option<SettlementRow> = sqlx::query_as(&format!(
        "{SELECT_SETTLEMENT} WHERE s.tenant_id = ? AND s.id = ?"
    ))
    .bind(tenant_id)
    .bind(settlement_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    row.map(|value| to_dto(value, can_see_amounts))
        .ok_or_else(|| "NOT_FOUND: personel hesabı bulunamadı".to_string())
}

/// Kişinin (verilmezse tüm işletmenin) hesapları, yeniden eskiye. `only_open` yalnız
/// borcu kalanları getirir.
pub async fn list(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: Option<&str>,
    only_open: bool,
    can_see_amounts: bool,
) -> Result<Vec<StaffSettlement>, String> {
    let rows: Vec<SettlementRow> = sqlx::query_as(&format!(
        "{SELECT_SETTLEMENT} WHERE s.tenant_id = ?1 AND (?2 IS NULL OR s.user_id = ?2)
         ORDER BY s.work_date DESC, s.created_at DESC LIMIT 200"
    ))
    .bind(tenant_id)
    .bind(user_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(rows
        .into_iter()
        .filter(|row| !only_open || row.8 > row.9)
        .map(|row| to_dto(row, can_see_amounts))
        .collect())
}

/// Kişi başına açık personel borcu.
pub async fn debts(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    can_see_amounts: bool,
) -> Result<Vec<StaffDebt>, String> {
    let rows: Vec<(String, String, i64, i64)> = sqlx::query_as(
        "SELECT user_id, name, COUNT(*), SUM(remaining) FROM (
             SELECT s.user_id AS user_id, u.name AS name,
                    s.earned_cents - COALESCE((SELECT SUM(p.amount_cents)
                        FROM staff_settlement_payments p
                       WHERE p.tenant_id = s.tenant_id AND p.settlement_id = s.id), 0) AS remaining
               FROM staff_settlements s
               JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
              WHERE s.tenant_id = ?1)
          WHERE remaining > 0
          GROUP BY user_id, name
          ORDER BY name ASC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(rows
        .into_iter()
        .map(|(user_id, full_name, open_count, remaining)| StaffDebt {
            user_id,
            full_name,
            open_count,
            remaining_cents: can_see_amounts.then_some(remaining),
        })
        .collect())
}

/// Ödeme isteği. `request_id` istemci tarafında üretilir ve aynı niyet için sabit kalır.
pub struct PayRequest<'a> {
    pub settlement_id: &'a str,
    pub amount_cents: i64,
    pub payment_method: &'a str,
    pub request_id: &'a str,
}

/// Çağıranın kimliği ve (müdür için) işletme sahibi onay jetonu.
pub struct PayActor<'a> {
    pub id: &'a str,
    pub role: &'a str,
    pub approval_token: Option<&'a str>,
}

/// Hesaba ödeme yazar: tek gider, nakitse tek kasa çıkışı, tek ödeme satırı ve denetim
/// kaydı aynı işlemde. Kasa bakiyesi yetmese de nakit çıkışı yazılır (bakiye negatife
/// düşebilir); açık vardiya yoksa ödeme reddedilir ve hiçbir şey yazılmaz.
pub async fn pay(
    conn: &mut SqliteConnection,
    audit_lock: &AuditLock<'_>,
    tenant_id: &str,
    actor: &PayActor<'_>,
    request: &PayRequest<'_>,
    now_iso: &str,
) -> Result<SettlementPayment, String> {
    if request.amount_cents <= 0 {
        return Err("VALIDATION: ödeme tutarı sıfırdan büyük olmalı".to_string());
    }
    if !matches!(request.payment_method, "CASH" | "BANK_TRANSFER") {
        return Err("VALIDATION: ödeme kanalı nakit veya havale olmalı".to_string());
    }
    let request_id = request.request_id.trim();
    if request_id.is_empty() || request_id.len() > 80 {
        return Err("VALIDATION: istek kimliği zorunlu".to_string());
    }

    let replay: Option<(String, String, String, i64)> = sqlx::query_as(
        "SELECT id, settlement_id, expense_id, amount_cents FROM staff_settlement_payments
          WHERE tenant_id = ? AND request_id = ?",
    )
    .bind(tenant_id)
    .bind(request_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    if let Some((payment_id, settlement_id, expense_id, amount)) = replay {
        if settlement_id != request.settlement_id || amount != request.amount_cents {
            return Err("CONFLICT: istek kimliği başka bir ödemeye ait".to_string());
        }
        let paid = paid_total(conn, tenant_id, &settlement_id).await?;
        let earned = earned_of(conn, tenant_id, &settlement_id).await?;
        return Ok(SettlementPayment {
            payment_id,
            expense_id,
            settlement_id,
            amount_cents: amount,
            remaining_cents: (earned - paid).max(0),
            replayed: true,
        });
    }

    let settlement = get(conn, tenant_id, request.settlement_id, true).await?;
    let remaining = settlement
        .remaining_cents
        .ok_or_else(|| "UNAUTHORIZED: hesap tutarı okunamadı".to_string())?;
    if request.amount_cents > remaining {
        return Err(format!("CONFLICT: kalan personel borcu {remaining} kuruş"));
    }

    let resource = payroll_gate::resource(operation::PAYROLL_PAY, request.settlement_id);
    let authorized = authorize_money_out(
        conn,
        audit_lock,
        tenant_id,
        actor.id,
        actor.role,
        operation::PAYROLL_PAY,
        &resource,
        request.amount_cents,
        actor.approval_token,
    )
    .await?;

    let description = format!(
        "Personel ücreti: {} · {}",
        settlement.full_name, settlement.work_date
    );
    let (expense_id, _) = insert_expense(
        conn,
        tenant_id,
        &NewExpense {
            category: EXPENSE_CATEGORY,
            amount_cents: request.amount_cents,
            payment_method: request.payment_method,
            directory_id: None,
            recurring_id: None,
            actor_id: actor.id,
            description: Some(&description),
            expense_date: now_iso,
        },
    )
    .await?;
    let payment_id = generate_id("spy");
    sqlx::query(
        "INSERT INTO staff_settlement_payments
             (id, tenant_id, settlement_id, amount_cents, payment_method, expense_id,
              request_id, actor_id, approver_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&payment_id)
    .bind(tenant_id)
    .bind(request.settlement_id)
    .bind(request.amount_cents)
    .bind(request.payment_method)
    .bind(&expense_id)
    .bind(request_id)
    .bind(actor.id)
    .bind(&authorized.approver_id)
    .bind(now_iso)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;

    let left = remaining - request.amount_cents;
    let context = AuditContext::new(
        tenant_id.to_string(),
        actor.id.to_string(),
        actor.role.to_string(),
        audit_service::category::PERSONEL,
        "staff:settlement_paid",
        request.settlement_id.to_string(),
        serde_json::json!({
            "userId": settlement.user_id,
            "workDate": settlement.work_date,
            "amountCents": request.amount_cents,
            "paymentMethod": request.payment_method,
            "expenseId": expense_id,
            "remainingCents": left,
            "approverId": authorized.approver_id,
        }),
        now_iso.to_string(),
    )?;
    AuditService::append(conn, audit_lock, &context).await?;
    Ok(SettlementPayment {
        payment_id,
        expense_id,
        settlement_id: request.settlement_id.to_string(),
        amount_cents: request.amount_cents,
        remaining_cents: left,
        replayed: false,
    })
}

async fn earned_of(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    settlement_id: &str,
) -> Result<i64, String> {
    sqlx::query_scalar("SELECT earned_cents FROM staff_settlements WHERE tenant_id = ? AND id = ?")
        .bind(tenant_id)
        .bind(settlement_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(text_error)
}

#[cfg(test)]
#[path = "staff_settlement_tests/mod.rs"]
mod tests;
