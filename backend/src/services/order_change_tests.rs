use super::*;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

const NOW: &str = "2026-10-31T12:00:00Z";

async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    sqlx::raw_sql(
        "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active) VALUES
            ('usr_k', 'tnt_a', 'CASHIER', 'Kasiyer', 'x', 1),
            ('usr_m', 'tnt_a', 'MANAGER', 'Müdür', 'x', 1);
         INSERT INTO tables (id, tenant_id, name) VALUES ('tbl_a', 'tnt_a', 'Masa 1');
         INSERT INTO orders (id, tenant_id, table_id, status) VALUES
            ('ord_kapali', 'tnt_a', 'tbl_a', 'PAID'),
            ('ord_acik', 'tnt_a', 'tbl_a', 'OPEN'),
            ('ord_diger', 'tnt_b', 'tbl_a', 'PAID');",
    )
    .execute(&pool)
    .await
    .expect("tohum");
    pool
}

fn request<'a>(order_id: &'a str, actor_id: &'a str, approved_by_actor: bool) -> NewRequest<'a> {
    NewRequest {
        order_id,
        reason: "Yanlış masaya yazıldı",
        actor_id,
        approved_by_actor,
        now: NOW,
    }
}

async fn status_of(conn: &mut SqliteConnection, id: &str) -> String {
    sqlx::query_scalar("SELECT status FROM order_change_requests WHERE id = ?")
        .bind(id)
        .fetch_one(conn)
        .await
        .expect("talep")
}

#[tokio::test]
async fn calisan_talebi_mudur_kararina_kadar_bekler() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let id = create(&mut conn, "tnt_a", &request("ord_kapali", "usr_k", false))
        .await
        .expect("talep");
    assert_eq!(status_of(&mut conn, &id).await, "PENDING");

    let status = decide(&mut conn, "tnt_a", &id, true, "usr_m", Some("Uygun"), NOW)
        .await
        .expect("karar");
    assert_eq!(status, "APPROVED");
    assert_eq!(status_of(&mut conn, &id).await, "APPROVED");
}

#[tokio::test]
async fn mudurun_kendi_talebi_onay_beklemez() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let id = create(&mut conn, "tnt_a", &request("ord_kapali", "usr_m", true))
        .await
        .expect("talep");
    assert_eq!(status_of(&mut conn, &id).await, "APPROVED");
}

#[tokio::test]
async fn acik_adisyona_ve_baska_kiracinin_adisyonuna_talep_acilmaz() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let open = create(&mut conn, "tnt_a", &request("ord_acik", "usr_k", false)).await;
    assert!(open.is_err());
    let foreign = create(&mut conn, "tnt_a", &request("ord_diger", "usr_k", false)).await;
    assert!(foreign.is_err());
}

#[tokio::test]
async fn bos_gerekce_ve_ikinci_bekleyen_talep_reddedilir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let mut empty = request("ord_kapali", "usr_k", false);
    empty.reason = "   ";
    assert!(create(&mut conn, "tnt_a", &empty).await.is_err());

    create(&mut conn, "tnt_a", &request("ord_kapali", "usr_k", false))
        .await
        .expect("ilk talep");
    let second = create(&mut conn, "tnt_a", &request("ord_kapali", "usr_k", false)).await;
    assert!(second.is_err());
}

#[tokio::test]
async fn talebi_acan_karar_veremez_ve_karar_degismez() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let id = create(&mut conn, "tnt_a", &request("ord_kapali", "usr_k", false))
        .await
        .expect("talep");
    assert!(decide(&mut conn, "tnt_a", &id, true, "usr_k", None, NOW)
        .await
        .is_err());

    decide(&mut conn, "tnt_a", &id, false, "usr_m", None, NOW)
        .await
        .expect("ret");
    assert!(decide(&mut conn, "tnt_a", &id, true, "usr_m", None, NOW)
        .await
        .is_err());
    assert_eq!(status_of(&mut conn, &id).await, "REJECTED");
}

#[tokio::test]
async fn liste_kiraciya_ve_bekleyene_gore_suzulur() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let id = create(&mut conn, "tnt_a", &request("ord_kapali", "usr_k", false))
        .await
        .expect("talep");

    assert_eq!(
        list(&mut conn, "tnt_a", true).await.expect("liste").len(),
        1
    );
    assert!(list(&mut conn, "tnt_b", false)
        .await
        .expect("liste")
        .is_empty());

    decide(&mut conn, "tnt_a", &id, false, "usr_m", None, NOW)
        .await
        .expect("karar");
    assert!(list(&mut conn, "tnt_a", true)
        .await
        .expect("liste")
        .is_empty());
    let all = list(&mut conn, "tnt_a", false).await.expect("liste");
    assert_eq!(all[0].requested_by_name.as_deref(), Some("Kasiyer"));
}

#[tokio::test]
async fn onayli_talep_kapatilana_kadar_acik_listede_kalir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let id = create(&mut conn, "tnt_a", &request("ord_kapali", "usr_m", true))
        .await
        .expect("talep");
    assert_eq!(
        list(&mut conn, "tnt_a", true).await.expect("liste").len(),
        1
    );

    assert!(resolve(&mut conn, "tnt_b", &id, "usr_m", NOW)
        .await
        .is_err());
    resolve(&mut conn, "tnt_a", &id, "usr_m", NOW)
        .await
        .expect("kapatma");
    assert!(list(&mut conn, "tnt_a", true)
        .await
        .expect("liste")
        .is_empty());
    assert!(resolve(&mut conn, "tnt_a", &id, "usr_m", NOW)
        .await
        .is_err());
}

#[tokio::test]
async fn bekleyen_ve_reddedilen_talep_kapatilamaz() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let id = create(&mut conn, "tnt_a", &request("ord_kapali", "usr_k", false))
        .await
        .expect("talep");
    assert!(resolve(&mut conn, "tnt_a", &id, "usr_m", NOW)
        .await
        .is_err());

    decide(&mut conn, "tnt_a", &id, false, "usr_m", None, NOW)
        .await
        .expect("ret");
    assert!(resolve(&mut conn, "tnt_a", &id, "usr_m", NOW)
        .await
        .is_err());
}
