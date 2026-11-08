use super::period_range;
use crate::services::staff360::payroll_hours::worked_seconds;
use crate::services::staff360::payroll_service;
use sqlx::SqlitePool;

async fn attendance_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.expect("havuz");
    sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    pool
}

#[tokio::test]
async fn calisma_oturumlari_mola_ve_donem_sinirini_korumali_toplar() {
    let p = attendance_pool().await;
    sqlx::query("INSERT INTO users (id, tenant_id, role, name, is_active) VALUES ('usr_1','tenant_a','CASHIER','Ayşe',1)")
        .execute(&p).await.expect("personel");
    payroll_service::set_rule(
        &p,
        "tenant_a",
        &crate::services::staff360::payroll_types::PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "HOURLY".into(),
            base_salary_cents: 0,
            commission_percent: 0,
            hourly_rate_cents: 20_000,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
            pay_period: "WEEKLY".into(),
        },
    )
    .await
    .expect("saatlik kural");
    sqlx::raw_sql(
        "INSERT INTO staff_work_sessions (id, tenant_id, user_id, started_at, ended_at, break_minutes, status, created_by, updated_by, created_at, updated_at)
         VALUES ('wks_1','tenant_a','usr_1','2026-11-03T09:00:00Z','2026-11-03T16:30:00Z',30,'CLOSED','usr_owner','usr_owner','2026-11-03','2026-11-03'),
                ('wks_2','tenant_a','usr_1','2026-10-30T09:00:00Z','2026-10-30T17:00:00Z',0,'CLOSED','usr_owner','usr_owner','2026-10-30','2026-10-30'),
                ('wks_3','tenant_a','usr_1','2026-11-04T09:00:00Z',NULL,0,'OPEN','usr_owner','usr_owner','2026-11-04','2026-11-04');",
    )
    .execute(&p)
    .await
    .expect("çalışma oturumları");

    let seconds = worked_seconds(
        &p,
        "tenant_a",
        "usr_1",
        "2026-11-02T00:00:00Z",
        "2026-11-09T00:00:00Z",
    )
    .await
    .expect("haftalık çalışma süresi");
    assert_eq!(seconds, 25_200);
    assert_eq!(
        super::hourly_pay_cents(seconds, 20_000).expect("hak ediş"),
        140_000
    );
}

#[tokio::test]
async fn kismi_bordro_odemesini_korur_ve_odenen_netin_altina_dusurmez() {
    let p = attendance_pool().await;
    sqlx::query("INSERT INTO users (id, tenant_id, role, name, is_active) VALUES ('usr_1','tenant_a','CASHIER','Ayşe',1)")
        .execute(&p).await.expect("personel");
    payroll_service::set_rule(
        &p,
        "tenant_a",
        &crate::services::staff360::payroll_types::PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "FIXED".into(),
            base_salary_cents: 100_000,
            commission_percent: 0,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
            pay_period: "MONTHLY".into(),
        },
    )
    .await
    .expect("kural");
    let first = payroll_service::run_payroll(&p, "tenant_a", "MONTHLY", "2026-11", true)
        .await
        .expect("bordro");
    assert_eq!(first[0].remaining_cents, 100_000);
    sqlx::query("INSERT INTO payroll_payments (id, tenant_id, payroll_run_id, amount_cents, payment_method, actor_id, created_at) VALUES ('ppay_1','tenant_a',?,60000,'CASH','usr_owner','2026-11-08')")
        .bind(&first[0].id).execute(&p).await.expect("kısmi ödeme");
    let second = payroll_service::run_payroll(&p, "tenant_a", "MONTHLY", "2026-11", true)
        .await
        .expect("tekrar hesaplama");
    assert_eq!(second[0].paid_cents, 60_000);
    assert_eq!(second[0].remaining_cents, 40_000);

    payroll_service::set_rule(
        &p,
        "tenant_a",
        &crate::services::staff360::payroll_types::PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "FIXED".into(),
            base_salary_cents: 50_000,
            commission_percent: 0,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
            pay_period: "MONTHLY".into(),
        },
    )
    .await
    .expect("değişen kural");
    let err = payroll_service::run_payroll(&p, "tenant_a", "MONTHLY", "2026-11", true)
        .await
        .expect_err("ödenenden küçük net değişikliği reddedilmeli");
    assert!(err.contains("yapılmış ödemelerden düşük"), "{err}");
}

#[test]
fn donem_araligi_uc_aylik_dogru() {
    assert_eq!(
        period_range("2026-03").unwrap(),
        ("2026-03-01".to_string(), "2026-03-31T23:59:59".to_string())
    );
}

#[test]
fn subat_artisiz_28_gun() {
    let (b, s) = period_range("2026-02").unwrap();
    assert_eq!(b, "2026-02-01");
    assert!(s.starts_with("2026-02-28"), "2026 artık yıl değil: {s}");
}

#[test]
fn subat_artili_29_gun() {
    let (_, s) = period_range("2028-02").unwrap();
    assert!(s.starts_with("2028-02-29"), "2028 artık yıl: {s}");
}

#[test]
fn yuzyil_artik_olmayan_yil_28_gun() {
    // 1900 artık yıl **değildir** (100 ile bölünür ama 400 ile bölünmez).
    let (_, s) = period_range("1900-02").unwrap();
    assert!(s.starts_with("1900-02-28"), "{s}");
}

#[test]
fn gecersiz_donem_reddedilir() {
    assert!(period_range("2026-13").is_err());
    assert!(period_range("2026").is_err());
    assert!(period_range("abc-def").is_err());
}
