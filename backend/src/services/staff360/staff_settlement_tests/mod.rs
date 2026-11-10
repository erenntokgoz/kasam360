//! Çıkış hesabı, personel borcu, ödeme ve yetki kapısı kanıtları. Her test gerçek SQLite
//! şeması üzerinde çalışır; para satırları (gider, kasa hareketi, ödeme) doğrudan sayılır.

pub(super) use super::*;
pub(super) use crate::approval_service::{self, ApprovalRequest};
pub(super) use crate::rbac::Role;
pub(super) use crate::services::staff360::{
    payroll_hours, payroll_run_payment, payroll_service, shift_math,
};
pub(super) use sqlx::sqlite::SqlitePoolOptions;
pub(super) use sqlx::SqlitePool;
pub(super) const TENANT: &str = "tnt_a";
pub(super) const NOW: &str = "2026-11-10T09:00:00Z";

mod accrual;
mod gate;
mod payment;

pub(super) async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    for (id, tenant, role, name, pin) in [
        ("usr_owner", TENANT, "OWNER", "Sahip", "2222"),
        ("usr_mgr", TENANT, "MANAGER", "Müdür", "3333"),
        ("usr_cash", TENANT, "CASHIER", "Kasiyer", "4444"),
        ("usr_ali", TENANT, "WAITER", "Ali", "5555"),
        ("usr_ayse", TENANT, "WAITER", "Ayşe", "6666"),
        ("usr_b", "tnt_b", "WAITER", "Başka", "7777"),
    ] {
        let hash = crate::user_credentials::hash_pin(pin).expect("PIN");
        sqlx::query(
            "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active)
             VALUES (?, ?, ?, ?, ?, 1)",
        )
        .bind(id)
        .bind(tenant)
        .bind(role)
        .bind(name)
        .bind(hash)
        .execute(&pool)
        .await
        .expect("kullanıcı");
    }
    pool
}

pub(super) async fn rule(
    conn: &mut SqliteConnection,
    user: &str,
    model: &str,
    period: &str,
    base: i64,
    rate: i64,
) {
    sqlx::query(
        "INSERT INTO payroll_rules (id, tenant_id, user_id, model, base_salary_cents,
             hourly_rate_cents, pay_period, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(format!("prl_{user}"))
    .bind(TENANT)
    .bind(user)
    .bind(model)
    .bind(base)
    .bind(rate)
    .bind(period)
    .execute(&mut *conn)
    .await
    .expect("kural");
}

pub(super) async fn open_shift(conn: &mut SqliteConnection) {
    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents)
         VALUES ('shf_a', ?, 'usr_owner', 'OPEN', '2026-11-10 06:00:00', 0)",
    )
    .bind(TENANT)
    .execute(&mut *conn)
    .await
    .expect("vardiya");
}

/// Kaydı yazar ve çıkış hesabını kesar; komutun yaptığının aynısı.
pub(super) async fn close_session(
    conn: &mut SqliteConnection,
    id: &str,
    user: &str,
    started: &str,
    ended: &str,
    break_minutes: i64,
) -> Accrual {
    let start = shift_math::parse_instant(started, "giriş").expect("giriş");
    let end = shift_math::parse_instant(ended, "çıkış").expect("çıkış");
    let seconds = shift_math::net_worked_seconds(&start, &end, break_minutes).expect("süre");
    sqlx::query(
        "INSERT OR REPLACE INTO staff_work_sessions
             (id, tenant_id, user_id, started_at, ended_at, break_minutes, status,
              created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'CLOSED', 'usr_owner', 'usr_owner', ?, ?)",
    )
    .bind(id)
    .bind(TENANT)
    .bind(user)
    .bind(shift_math::canonical_utc(&start))
    .bind(shift_math::canonical_utc(&end))
    .bind(break_minutes)
    .bind(NOW)
    .bind(NOW)
    .execute(&mut *conn)
    .await
    .expect("kayıt");
    accrue_on_close(
        conn,
        TENANT,
        &ClosedSession {
            id,
            user_id: user,
            work_date: &shift_math::work_date(&start),
            worked_seconds: seconds,
        },
        "usr_owner",
        NOW,
    )
    .await
    .expect("hesap")
}

pub(super) async fn count(conn: &mut SqliteConnection, sql: &str) -> i64 {
    sqlx::query_scalar(sql)
        .fetch_one(&mut *conn)
        .await
        .expect("sayım")
}

pub(super) async fn pay_as(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    role: &str,
    token: Option<&str>,
    settlement: &str,
    amount: i64,
    method: &str,
    request_id: &str,
) -> Result<SettlementPayment, String> {
    let actor_id = if role == "OWNER" {
        "usr_owner"
    } else {
        "usr_mgr"
    };
    pay(
        conn,
        lock,
        TENANT,
        &PayActor {
            id: actor_id,
            role,
            approval_token: token,
        },
        &PayRequest {
            settlement_id: settlement,
            amount_cents: amount,
            payment_method: method,
            request_id,
        },
        NOW,
    )
    .await
}

/// Gece vardiyası: 22:00 → 06:00, 30 dk mola, saat başı 150 TL → 7,5 saat = 1.125 TL.
pub(super) async fn night_settlement(conn: &mut SqliteConnection) -> String {
    rule(conn, "usr_ali", "HOURLY", "WEEKLY", 0, 15_000).await;
    let accrual = close_session(
        conn,
        "wks_night",
        "usr_ali",
        "2026-11-09T22:00:00+03:00",
        "2026-11-10T06:00:00+03:00",
        30,
    )
    .await;
    accrual.settlement_id.expect("hesap")
}

/// Sahibin PIN'iyle, bu ödemeye bağlı onay jetonu üretir.
pub(super) async fn owner_token(
    conn: &mut SqliteConnection,
    settlement: &str,
    amount: i64,
    pin: &str,
) -> Result<String, String> {
    let request = ApprovalRequest {
        tenant_id: TENANT.to_string(),
        operation: approval_service::operation::PAYROLL_PAY.to_string(),
        resource_id: payroll_gate::resource(approval_service::operation::PAYROLL_PAY, settlement),
        actor_id: "usr_mgr".to_string(),
        actor_role: "MANAGER".to_string(),
        amount_cents: amount,
        approved_percent_hint: 0,
        terminal_id: "term_1".to_string(),
    };
    approval_service::verify_and_issue(conn, &request, pin)
        .await
        .map(|verified| verified.token)
}
