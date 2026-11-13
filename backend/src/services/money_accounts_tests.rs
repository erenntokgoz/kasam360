//! `money_accounts` testleri: transfer bakiyesi, kiracı yalıtımı, denetim izi, akış.

use super::*;
use crate::services::audit_service::AuditLock;
use crate::services::cash_flow_test_support::*;

const XFR_1: &str = "xfr_0123456789abcdef01234567";
const XFR_2: &str = "xfr_0123456789abcdef01234568";

async fn new_account(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    name: &str,
    kind: &str,
    opening: i64,
) -> Result<MoneyAccount, String> {
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    create_account(
        &mut conn,
        &lock,
        tenant,
        "usr_sahip",
        "OWNER",
        name,
        kind,
        opening,
    )
    .await
}

async fn move_money(
    pool: &sqlx::SqlitePool,
    tenant: &str,
    id: &str,
    from: &str,
    to: &str,
    cents: i64,
) -> Result<AccountTransfer, String> {
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    transfer(
        &mut conn,
        &lock,
        tenant,
        "usr_sahip",
        "OWNER",
        id,
        from,
        to,
        cents,
        "test",
    )
    .await
}

#[tokio::test]
async fn transfer_iki_hesabin_bakiyesini_kurus_hassasiyetinde_degistirir() {
    let pool = pool().await;
    let kasa = new_account(&pool, TENANT_A, "Ana Kasa", "CASH", 100_000)
        .await
        .expect("kasa");
    let banka = new_account(&pool, TENANT_A, "Banka", "BANK", 0)
        .await
        .expect("banka");

    move_money(&pool, TENANT_A, XFR_1, &kasa.id, &banka.id, 33_333)
        .await
        .expect("transfer");

    let mut conn = pool.acquire().await.expect("bağlantı");
    let accounts = list_accounts(&mut conn, TENANT_A).await.expect("liste");
    let balance = |id: &str| {
        accounts
            .iter()
            .find(|a| a.id == id)
            .map(|a| a.balance_cents)
    };
    assert_eq!(balance(&kasa.id), Some(66_667));
    assert_eq!(balance(&banka.id), Some(33_333));
    let total: i64 = accounts.iter().map(|a| a.balance_cents).sum();
    assert_eq!(total, 100_000, "transfer toplam parayı değiştirmez");
}

#[tokio::test]
async fn yetersiz_bakiye_ayni_hesap_ve_gecersiz_tutar_reddedilir() {
    let pool = pool().await;
    let kasa = new_account(&pool, TENANT_A, "Ana Kasa", "CASH", 1_000)
        .await
        .expect("kasa");
    let pos = new_account(&pool, TENANT_A, "POS", "POS", 0)
        .await
        .expect("pos");

    let over = move_money(&pool, TENANT_A, XFR_1, &kasa.id, &pos.id, 1_001).await;
    assert!(over.is_err_and(|e| e.starts_with("INSUFFICIENT_FUNDS")));
    assert!(move_money(&pool, TENANT_A, XFR_1, &kasa.id, &kasa.id, 10)
        .await
        .is_err());
    assert!(move_money(&pool, TENANT_A, XFR_1, &kasa.id, &pos.id, 0)
        .await
        .is_err());
    assert!(move_money(&pool, TENANT_A, XFR_1, &kasa.id, &pos.id, -5)
        .await
        .is_err());
    assert!(
        move_money(&pool, TENANT_A, "xfr_kisa", &kasa.id, &pos.id, 5)
            .await
            .is_err()
    );

    let mut conn = pool.acquire().await.expect("bağlantı");
    let accounts = list_accounts(&mut conn, TENANT_A).await.expect("liste");
    assert!(accounts.iter().all(|a| a.balance_cents >= 0));
}

#[tokio::test]
async fn ayni_transfer_kimligi_tekrar_gelirse_cift_kayit_olmaz() {
    let pool = pool().await;
    let kasa = new_account(&pool, TENANT_A, "Ana Kasa", "CASH", 5_000)
        .await
        .expect("kasa");
    let banka = new_account(&pool, TENANT_A, "Banka", "BANK", 0)
        .await
        .expect("banka");

    let first = move_money(&pool, TENANT_A, XFR_1, &kasa.id, &banka.id, 2_000)
        .await
        .expect("ilk");
    let again = move_money(&pool, TENANT_A, XFR_1, &kasa.id, &banka.id, 2_000)
        .await
        .expect("tekrar");
    assert_eq!(first, again);
    let different = move_money(&pool, TENANT_A, XFR_1, &kasa.id, &banka.id, 3_000).await;
    assert!(different.is_err_and(|e| e.starts_with("CONFLICT")));

    let mut conn = pool.acquire().await.expect("bağlantı");
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM account_transfers")
        .fetch_one(&mut *conn)
        .await
        .expect("sayım");
    assert_eq!(count, 1);
}

#[tokio::test]
async fn kiracilar_birbirinin_hesabina_dokunamaz() {
    let pool = pool().await;
    let a = new_account(&pool, TENANT_A, "Kasa", "CASH", 9_000)
        .await
        .expect("a");
    let b = new_account(&pool, TENANT_B, "Kasa", "CASH", 9_000)
        .await
        .expect("aynı ad başka kiracıda serbest");

    assert!(move_money(&pool, TENANT_B, XFR_1, &a.id, &b.id, 100)
        .await
        .is_err());
    assert!(move_money(&pool, TENANT_A, XFR_2, &a.id, &b.id, 100)
        .await
        .is_err());

    let mut conn = pool.acquire().await.expect("bağlantı");
    assert_eq!(
        list_accounts(&mut conn, TENANT_A).await.expect("a").len(),
        1
    );
    assert_eq!(
        list_accounts(&mut conn, TENANT_B).await.expect("b").len(),
        1
    );
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let foreign = set_active(
        &mut conn,
        &lock,
        TENANT_B,
        "usr_sahip",
        "OWNER",
        &a.id,
        false,
    )
    .await;
    assert!(foreign.is_err_and(|e| e.starts_with("NOT_FOUND")));
}

#[tokio::test]
async fn ayni_ad_pasif_hesap_ve_audit_kaydi_kurallari() {
    let pool = pool().await;
    let kasa = new_account(&pool, TENANT_A, "Ana Kasa", "CASH", 500)
        .await
        .expect("kasa");
    assert!(new_account(&pool, TENANT_A, "ana kasa", "BANK", 0)
        .await
        .is_err());
    assert!(new_account(&pool, TENANT_A, "X", "KRIPTO", 0)
        .await
        .is_err());
    assert!(new_account(&pool, TENANT_A, "Y", "CASH", -1).await.is_err());

    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.expect("bağlantı");
    let blocked = set_active(
        &mut conn,
        &lock,
        TENANT_A,
        "usr_sahip",
        "OWNER",
        &kasa.id,
        false,
    )
    .await;
    assert!(
        blocked.is_err_and(|e| e.starts_with("INVALID_STATE")),
        "bakiyeli hesap pasife alınamaz"
    );
    drop(conn);
    drop(lock);

    let empty = new_account(&pool, TENANT_A, "Boş", "POS", 0)
        .await
        .expect("boş");
    let lock = AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.expect("bağlantı");
    let off = set_active(
        &mut conn,
        &lock,
        TENANT_A,
        "usr_sahip",
        "OWNER",
        &empty.id,
        false,
    )
    .await
    .expect("pasif");
    assert!(!off.is_active);
    let moved = transfer(
        &mut conn,
        &lock,
        TENANT_A,
        "usr_sahip",
        "OWNER",
        XFR_1,
        &kasa.id,
        &empty.id,
        1,
        "",
    )
    .await;
    assert!(moved.is_err_and(|e| e.starts_with("INVALID_STATE")));

    let actions: Vec<String> = sqlx::query_scalar(
        "SELECT action FROM audit_ledger WHERE tenant_id = ? AND category = 'FINANS' ORDER BY sequence",
    )
    .bind(TENANT_A)
    .fetch_all(&mut *conn)
    .await
    .expect("denetim");
    assert!(actions.iter().filter(|a| *a == "account:created").count() >= 2);
    assert!(actions.contains(&"account:deactivated".to_string()));
}

#[tokio::test]
async fn akis_kasa_hareketi_ve_transferi_tek_listede_filtreli_verir() {
    let pool = pool().await;
    seed_user(&pool, TENANT_A, "usr_kasiyer", "Kasiyer").await;
    sqlx::query("INSERT INTO shifts (id, tenant_id, cashier_id, status) VALUES ('shf_1', ?, 'usr_kasiyer', 'OPEN')")
        .bind(TENANT_A)
        .execute(&pool)
        .await
        .expect("vardiya");
    for (id, kind, cents, at) in [
        ("csh_a", "IN", 400, "2026-03-02 09:00:00"),
        ("csh_b", "OUT", 150, "2026-03-02 10:00:00"),
        ("csh_out_of_range", "IN", 1, "2026-02-01 10:00:00"),
    ] {
        sqlx::query("INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at) VALUES (?, ?, 'shf_1', ?, ?, 'neden', 'usr_kasiyer', ?)")
            .bind(id)
            .bind(TENANT_A)
            .bind(kind)
            .bind(cents)
            .bind(at)
            .execute(&pool)
            .await
            .expect("hareket");
    }
    sqlx::query("INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at) VALUES ('csh_b_tenant', ?, 'shf_1', 'IN', 999, 'başka', 'usr_kasiyer', '2026-03-02 09:30:00')")
        .bind(TENANT_B)
        .execute(&pool)
        .await
        .expect("başka kiracı");

    let kasa = new_account(&pool, TENANT_A, "Kasa", "CASH", 1_000)
        .await
        .expect("kasa");
    let banka = new_account(&pool, TENANT_A, "Banka", "BANK", 0)
        .await
        .expect("banka");
    move_money(&pool, TENANT_A, XFR_1, &kasa.id, &banka.id, 250)
        .await
        .expect("transfer");
    sqlx::query("UPDATE account_transfers SET created_at = '2026-03-02 11:00:00'")
        .execute(&pool)
        .await
        .expect("zaman");

    let mut conn = pool.acquire().await.expect("bağlantı");
    let entries = flow(
        &mut conn,
        TENANT_A,
        "2026-03-01T00:00:00+00:00",
        "2026-03-31T00:00:00+00:00",
        50,
    )
    .await
    .expect("akış");
    let kinds: Vec<_> = entries.iter().map(|e| e.kind.as_str()).collect();
    assert_eq!(kinds, ["TRANSFER", "CASH_OUT", "CASH_IN"]);
    assert_eq!(entries[0].amount_cents, 250);
    assert!(entries[0].description.contains("Kasa -> Banka"));
    assert_eq!(entries[2].actor_name.as_deref(), Some("Kasiyer"));
}
