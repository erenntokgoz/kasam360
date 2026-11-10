//! Personel hesabı testleri: gate.

use super::*;

#[tokio::test]
async fn mudur_sahip_onayi_olmadan_odeme_yapamaz() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    open_shift(&mut conn).await;
    let id = night_settlement(&mut conn).await;
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);

    let none = pay_as(&mut conn, &lock, "MANAGER", None, &id, 10_000, "CASH", "r1")
        .await
        .expect_err("onaysız");
    assert!(none.starts_with("APPROVAL_REQUIRED"), "{none}");
    let blank = pay_as(
        &mut conn,
        &lock,
        "MANAGER",
        Some("  "),
        &id,
        10_000,
        "CASH",
        "r1",
    )
    .await
    .expect_err("boş jeton");
    assert!(blank.starts_with("APPROVAL_REQUIRED"), "{blank}");
    let forged = pay_as(
        &mut conn,
        &lock,
        "MANAGER",
        Some("sahte"),
        &id,
        10_000,
        "CASH",
        "r1",
    )
    .await
    .expect_err("sahte jeton");
    assert!(forged.starts_with("APPROVAL_TOKEN_INVALID"), "{forged}");
    // Müdür kendi PIN'iyle kendini onaylayamaz: ödeme onayı yalnız sahipten alınır.
    let own = owner_token(&mut conn, &id, 10_000, "3333")
        .await
        .expect_err("müdür onayı");
    assert!(own.starts_with("UNAUTHORIZED"), "{own}");
    // Kasiyer ve garson bordro kapısından hiç geçemez.
    for role in ["CASHIER", "WAITER", "KITCHEN"] {
        let denied = pay_as(&mut conn, &lock, role, None, &id, 10_000, "CASH", "r1")
            .await
            .expect_err("yetkisiz rol");
        assert!(denied.starts_with("UNAUTHORIZED"), "{role}: {denied}");
    }
    assert_eq!(
        count(&mut conn, "SELECT COUNT(*) FROM general_expenses").await,
        0
    );
    assert_eq!(
        count(&mut conn, "SELECT COUNT(*) FROM cash_movements").await,
        0
    );
    assert_eq!(
        count(&mut conn, "SELECT COUNT(*) FROM staff_settlement_payments").await,
        0
    );
}

#[tokio::test]
async fn mudur_sahip_jetonuyla_yalniz_onaylanan_odemeyi_bir_kez_yapar() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    open_shift(&mut conn).await;
    let id = night_settlement(&mut conn).await;
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);

    let token = owner_token(&mut conn, &id, 30_000, "2222")
        .await
        .expect("jeton");
    // Başka tutara taşınamaz.
    let scope = pay_as(
        &mut conn,
        &lock,
        "MANAGER",
        Some(&token),
        &id,
        30_001,
        "CASH",
        "r1",
    )
    .await
    .expect_err("tutar kapsamı");
    assert!(
        scope.starts_with("APPROVAL_TOKEN_SCOPE_MISMATCH"),
        "{scope}"
    );
    assert_eq!(
        count(&mut conn, "SELECT COUNT(*) FROM general_expenses").await,
        0
    );

    let paid = pay_as(
        &mut conn,
        &lock,
        "MANAGER",
        Some(&token),
        &id,
        30_000,
        "CASH",
        "r1",
    )
    .await
    .expect("onaylı ödeme");
    assert_eq!(paid.remaining_cents, 82_500);
    let approver: Option<String> =
        sqlx::query_scalar("SELECT approver_id FROM staff_settlement_payments WHERE id = ?")
            .bind(&paid.payment_id)
            .fetch_one(&mut *conn)
            .await
            .expect("onaylayan");
    assert_eq!(approver.as_deref(), Some("usr_owner"));
    // Jeton tek kullanımlıktır: yeni istek kimliğiyle yeniden kullanılamaz.
    let reuse = pay_as(
        &mut conn,
        &lock,
        "MANAGER",
        Some(&token),
        &id,
        30_000,
        "CASH",
        "r2",
    )
    .await
    .expect_err("kullanılmış jeton");
    assert!(reuse.starts_with("APPROVAL_TOKEN_USED"), "{reuse}");
    assert_eq!(
        count(&mut conn, "SELECT COUNT(*) FROM general_expenses").await,
        1
    );
    // Onay tüketimi denetim defterinde sahibin kimliğiyle durur.
    let consumed = count(
        &mut conn,
        "SELECT COUNT(*) FROM audit_ledger WHERE action = 'approval:consumed' AND actor_id = 'usr_owner'",
    )
    .await;
    assert_eq!(consumed, 1);
}

#[tokio::test]
async fn baska_kiracinin_hesabi_gorulmez_ve_odenemez() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    open_shift(&mut conn).await;
    let id = night_settlement(&mut conn).await;
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    assert!(list(&mut conn, "tnt_b", None, false, true)
        .await
        .expect("liste")
        .is_empty());
    assert!(debts(&mut conn, "tnt_b", true)
        .await
        .expect("borç")
        .is_empty());
    let error = pay(
        &mut conn,
        &lock,
        "tnt_b",
        &PayActor {
            id: "usr_owner",
            role: "OWNER",
            approval_token: None,
        },
        &PayRequest {
            settlement_id: &id,
            amount_cents: 100,
            payment_method: "BANK_TRANSFER",
            request_id: "r",
        },
        NOW,
    )
    .await
    .expect_err("başka kiracı");
    assert!(error.starts_with("NOT_FOUND"), "{error}");
    assert_eq!(
        count(&mut conn, "SELECT COUNT(*) FROM general_expenses").await,
        0
    );
}

async fn run_for(conn: &mut SqliteConnection, net: i64) -> String {
    sqlx::query(
        "INSERT INTO payroll_runs (id, tenant_id, user_id, period, model, net_cents, gross_cents, created_at)
         VALUES ('pay_1', ?, 'usr_ali', '2026-11', 'FIXED', ?, ?, ?)",
    )
    .bind(TENANT)
    .bind(net)
    .bind(net)
    .bind(NOW)
    .execute(&mut *conn)
    .await
    .expect("bordro");
    "pay_1".to_string()
}

#[tokio::test]
async fn bordro_odemesi_gider_yazar_mudur_onaysiz_reddedilir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    open_shift(&mut conn).await;
    let run = run_for(&mut conn, 200_000).await;
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let actor = |role: &'static str, token: Option<&'static str>| PayActor {
        id: if role == "OWNER" {
            "usr_owner"
        } else {
            "usr_mgr"
        },
        role,
        approval_token: token,
    };
    let denied = payroll_run_payment::pay_run(
        &mut conn,
        &lock,
        TENANT,
        &actor("MANAGER", None),
        &run,
        50_000,
        "CASH",
        NOW,
    )
    .await
    .expect_err("onaysız müdür");
    assert!(denied.starts_with("APPROVAL_REQUIRED"), "{denied}");
    assert_eq!(
        count(&mut conn, "SELECT COUNT(*) FROM payroll_payments").await,
        0
    );
    assert_eq!(
        count(&mut conn, "SELECT COUNT(*) FROM general_expenses").await,
        0
    );

    let left = payroll_run_payment::pay_run(
        &mut conn,
        &lock,
        TENANT,
        &actor("OWNER", None),
        &run,
        50_000,
        "CASH",
        NOW,
    )
    .await
    .expect("sahip ödemesi");
    assert_eq!(left, 150_000);
    assert_eq!(
        count(
            &mut conn,
            "SELECT COUNT(*) FROM general_expenses WHERE category = 'STAFF_PAY'"
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &mut conn,
            "SELECT SUM(amount_cents) FROM cash_movements WHERE movement_type = 'OUT'"
        )
        .await,
        50_000
    );
    let over = payroll_run_payment::pay_run(
        &mut conn,
        &lock,
        TENANT,
        &actor("OWNER", None),
        &run,
        150_001,
        "BANK_TRANSFER",
        NOW,
    )
    .await
    .expect_err("fazla ödeme");
    assert!(over.starts_with("CONFLICT"), "{over}");
}

#[tokio::test]
async fn ucret_kurali_ve_avans_kapisi_mudure_sahip_onayi_ister() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    for operation in [
        approval_service::operation::PAYROLL_RULE,
        approval_service::operation::STAFF_ADVANCE,
    ] {
        let resource = payroll_gate::resource(operation, "usr_ali");
        let owner = payroll_gate::authorize_money_out(
            &mut conn,
            &lock,
            TENANT,
            "usr_owner",
            "OWNER",
            operation,
            &resource,
            100,
            None,
        )
        .await
        .expect("sahip doğrudan");
        assert_eq!(owner.approver_id, None);
        let manager = payroll_gate::authorize_money_out(
            &mut conn, &lock, TENANT, "usr_mgr", "MANAGER", operation, &resource, 100, None,
        )
        .await
        .expect_err("müdür onaysız");
        assert!(
            manager.starts_with("APPROVAL_REQUIRED"),
            "{operation}: {manager}"
        );
        let cashier = payroll_gate::authorize_money_out(
            &mut conn,
            &lock,
            TENANT,
            "usr_cash",
            "CASHIER",
            operation,
            &resource,
            100,
            Some("x"),
        )
        .await
        .expect_err("kasiyer");
        assert!(
            cashier.starts_with("UNAUTHORIZED"),
            "{operation}: {cashier}"
        );
    }
    let unknown = payroll_gate::authorize_money_out(
        &mut conn,
        &lock,
        TENANT,
        "usr_owner",
        "OWNER",
        "CASH_OUT",
        "x",
        1,
        None,
    )
    .await
    .expect_err("bilinmeyen işlem");
    assert!(unknown.starts_with("INVALID_OPERATION"), "{unknown}");
    assert!(Role::Owner != Role::Manager);
}
