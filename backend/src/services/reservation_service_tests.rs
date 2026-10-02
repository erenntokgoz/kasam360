//! `reservation_service` testleri (Faz 8).
//!
//! Kapsam karar kurallarıdır:
//! 1. **Yalnız boş masa:** `OCCUPIED`/`RESERVED` masaya rezervasyon yazılamaz.
//! 2. **Kiracı izolasyonu:** başka işletmenin rezervasyonu görünmez, bulunamaz,
//!    iptal edilemez veya "geldi" işaretlenemez.
//! 3. **Tek açık rezervasyon:** aynı masada ikinci açık kayıt kısmi tekil indeks
//!    tarafından reddedilir (eşzamanlı tıklama simülasyonu).
//! 4. **Durum makinesi:** iptal ve "geldi" yalnız açık kayıtta çalışır; kapanan
//!    kayıt ikinci kez kapatılamaz ve **silinmez**.
//! 5. **Adisyonla kapanma:** sipariş gönderimi rezervasyonu `SEATED` yapar ve
//!    masayı `OCCUPIED` yapar; hiç rezervasyonu olmayan masada aynı çağrı `None`
//!    döner (uydurma kayıt yok).
//! 6. **Taşıma kapısı:** açık rezervasyonlu masa taşınamaz.

use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

const SCHEMA: &str = include_str!("../../migrations/schema.sql");

const TENANT_A: &str = "tenant_a";
const TENANT_B: &str = "tenant_b";

const RESERVED_AT: &str = "2026-10-02T20:30:00+03:00";

async fn pool() -> sqlx::SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("geçerli bağlantı seçenekleri")
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("bellek içi veritabanı açılır");
    sqlx::raw_sql(SCHEMA)
        .execute(&pool)
        .await
        .expect("şema uygulanır");
    pool
}

async fn seed_table(pool: &sqlx::SqlitePool, tenant: &str, id: &str, status: &str) {
    sqlx::query("INSERT OR IGNORE INTO tables (id, tenant_id, name, status) VALUES (?, ?, ?, ?)")
        .bind(id)
        .bind(tenant)
        .bind(id)
        .bind(status)
        .execute(pool)
        .await
        .expect("masa eklenir");
}

fn input(name: &str) -> NewReservation {
    NewReservation {
        customer_name: name.to_string(),
        customer_phone: Some("0555 000 00 00".to_string()),
        party_size: 4,
        reserved_at: RESERVED_AT.to_string(),
        note: Some("pencere".to_string()),
    }
}

/// Tek bağlantılı bellek içi havuzda bağlantı zaten `conn` üzerinde tutulduğu
/// için durum okuması da aynı bağlantıdan yapılır (ikinci bağlantı havuzu
/// tüketirdiği için `PoolTimedOut` verirdi).
async fn table_status(conn: &mut sqlx::SqliteConnection, tenant: &str, id: &str) -> String {
    sqlx::query_scalar("SELECT status FROM tables WHERE id = ? AND tenant_id = ?")
        .bind(id)
        .bind(tenant)
        .fetch_one(&mut *conn)
        .await
        .expect("masa durumu okunur")
}

#[tokio::test]
async fn bos_masa_rezerve_edilir_ve_masa_reserved_olur() {
    let pool = pool().await;
    seed_table(&pool, TENANT_A, "tbl_a", "AVAILABLE").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let dto = create(
        &mut conn,
        TENANT_A,
        "tbl_a",
        "usr_1",
        "WAITER",
        input("Ayşe Yılmaz"),
    )
    .await
    .expect("rezervasyon yazılır");

    assert!(dto.id.starts_with("rsv_"), "kimlik prefexli ULID olmalı");
    assert_eq!(dto.status, "ACTIVE");
    assert_eq!(dto.customer_name, "Ayşe Yılmaz");
    assert_eq!(dto.party_size, 4);
    assert_eq!(dto.table_name, "tbl_a");
    assert_eq!(table_status(&mut conn, TENANT_A, "tbl_a").await, "RESERVED");
}

#[tokio::test]
async fn dolu_masa_rezerve_edilemez() {
    let pool = pool().await;
    seed_table(&pool, TENANT_A, "tbl_occ", "OCCUPIED").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let error = create(
        &mut conn,
        TENANT_A,
        "tbl_occ",
        "usr_1",
        "WAITER",
        input("Ayşe"),
    )
    .await
    .expect_err("dolu masa rezerve edilemez");

    assert!(error.starts_with("CONFLICT"), "beklenen: {}", error);
    assert_eq!(table_status(&mut conn, TENANT_A, "tbl_occ").await, "OCCUPIED");
}

#[tokio::test]
async fn baska_kiracinin_masasi_bulunamaz() {
    let pool = pool().await;
    seed_table(&pool, TENANT_B, "tbl_b", "AVAILABLE").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let error = create(&mut conn, TENANT_A, "tbl_b", "usr_1", "OWNER", input("Ayşe"))
        .await
        .expect_err("çapraz kiracı reddedilir");

    assert!(error.starts_with("NOT_FOUND"), "beklenen: {}", error);
    assert_eq!(table_status(&mut conn, TENANT_B, "tbl_b").await, "AVAILABLE");
    assert!(open_for_table(&mut conn, TENANT_A, "tbl_b")
        .await
        .expect("sorgu çalışır")
        .is_none());
}

#[tokio::test]
async fn ayni_masada_ikinci_acik_rezervasyon_yazilamaz() {
    let pool = pool().await;
    seed_table(&pool, TENANT_A, "tbl_one", "AVAILABLE").await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    create(&mut conn, TENANT_A, "tbl_one", "usr_1", "WAITER", input("Ayşe"))
        .await
        .expect("ilk rezervasyon yazılır");

    // Uygulama ön koşulu zaten yakalar; indeks yarış koşulunda ikinci güvenlik katmanıdır.
    sqlx::query("UPDATE tables SET status = 'AVAILABLE' WHERE id = 'tbl_one'")
        .execute(&mut *conn)
        .await
        .expect("durum zorla sıfırlanır (yariş simülasyonu)");
    let error = create(&mut conn, TENANT_A, "tbl_one", "usr_2", "WAITER", input("Ali"))
        .await
        .expect_err("ikinci açık rezervasyon reddedilir");

    assert!(error.starts_with("CONFLICT"), "beklenen: {}", error);
}

#[tokio::test]
async fn rezervasyon_iptal_edilir_masa_bosalir_kayit_kalir() {
    let pool = pool().await;
    seed_table(&pool, TENANT_A, "tbl_c", "AVAILABLE").await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let created = create(&mut conn, TENANT_A, "tbl_c", "usr_1", "WAITER", input("Ayşe"))
        .await
        .expect("rezervasyon yazılır");

    let cancelled = cancel(&mut conn, TENANT_A, &created.id, "usr_2", None)
        .await
        .expect("iptal edilir");

    assert_eq!(cancelled.status, "CANCELLED");
    assert!(cancelled.closed_at.is_some(), "kapanma zamanı yazılır");
    assert_eq!(table_status(&mut conn, TENANT_A, "tbl_c").await, "AVAILABLE");

    let again = cancel(&mut conn, TENANT_A, &created.id, "usr_2", None)
        .await
        .expect_err("kapanan rezervasyon tekrar iptal edilemez");
    assert!(again.starts_with("CONFLICT"), "beklenen: {}", again);
    assert!(list_open(&mut conn, TENANT_A)
        .await
        .expect("liste okunur")
        .is_empty());
    // Kapanan kayıt silinmez: günlük sorgusu hâlâ görmelidir.
    assert_eq!(list_day(&mut conn, TENANT_A, "2026-10-02").await.expect("günlük okunur").len(), 1);
}

#[tokio::test]
async fn gelmedi_isaretlemesi_no_show_uretir() {
    let pool = pool().await;
    seed_table(&pool, TENANT_A, "tbl_ns", "AVAILABLE").await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let created = create(&mut conn, TENANT_A, "tbl_ns", "usr_1", "WAITER", input("Ayşe"))
        .await
        .expect("rezervasyon yazılır");

    let no_show = cancel(&mut conn, TENANT_A, &created.id, "usr_2", Some("NO_SHOW"))
        .await
        .expect("gelmedi işaretlenir");

    assert_eq!(no_show.status, "NO_SHOW");
    assert_eq!(no_show.close_reason.as_deref(), Some("NO_SHOW"));
    assert_eq!(table_status(&mut conn, TENANT_A, "tbl_ns").await, "AVAILABLE");
}

#[tokio::test]
async fn musteri_geldi_masa_yine_reserved_kalir() {
    let pool = pool().await;
    seed_table(&pool, TENANT_A, "tbl_arr", "AVAILABLE").await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let created = create(&mut conn, TENANT_A, "tbl_arr", "usr_1", "WAITER", input("Ayşe"))
        .await
        .expect("rezervasyon yazılır");

    let arrived = mark_arrived(&mut conn, TENANT_A, &created.id, "usr_2")
        .await
        .expect("geldi işaretlenir");

    assert_eq!(arrived.status, "ARRIVED");
    assert!(arrived.arrived_at.is_some(), "geliş zamanı yazılır");
    assert_eq!(table_status(&mut conn, TENANT_A, "tbl_arr").await, "RESERVED");

    let repeat = mark_arrived(&mut conn, TENANT_A, &created.id, "usr_2")
        .await
        .expect_err("bekleyen olmayan kayıt 'geldi' işaretlenemez");
    assert!(repeat.starts_with("CONFLICT"), "beklenen: {}", repeat);
}

#[tokio::test]
async fn adisyon_gonderimi_rezervasyonu_seated_yapar_masayi_doldurur() {
    let pool = pool().await;
    seed_table(&pool, TENANT_A, "tbl_seat", "AVAILABLE").await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let created = create(&mut conn, TENANT_A, "tbl_seat", "usr_1", "WAITER", input("Ayşe"))
        .await
        .expect("rezervasyon yazılır");

    let seated = seat_for_order(&mut conn, TENANT_A, "tbl_seat", "usr_1")
        .await
        .expect("adisyon kapatır")
        .expect("açık rezervasyon vardı");

    assert_eq!(seated.id, created.id);
    assert_eq!(seated.status, "SEATED");
    assert_eq!(seated.close_reason.as_deref(), Some("ADISYON"));
    assert_eq!(table_status(&mut conn, TENANT_A, "tbl_seat").await, "OCCUPIED");
    assert!(list_open(&mut conn, TENANT_A)
        .await
        .expect("liste okunur")
        .is_empty());
}

#[tokio::test]
async fn rezervasyonsuz_masada_adisyon_kaydi_uretilmez() {
    let pool = pool().await;
    seed_table(&pool, TENANT_A, "tbl_plain", "AVAILABLE").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let result = seat_for_order(&mut conn, TENANT_A, "tbl_plain", "usr_1")
        .await
        .expect("sorgu çalışır");

    assert!(result.is_none(), "rezervasyon uydurulmamalı");
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM reservations")
        .fetch_one(&mut *conn)
        .await
        .expect("sayım yapılır");
    assert_eq!(count, 0);
}

#[tokio::test]
async fn acil_kapanan_yollarda_rezervasyon_kaydi_korunur() {
    let pool = pool().await;
    seed_table(&pool, TENANT_A, "tbl_pay", "AVAILABLE").await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let _created = create(&mut conn, TENANT_A, "tbl_pay", "usr_1", "CASHIER", input("Ayşe"))
        .await
        .expect("rezervasyon yazılır");

    let closed = close_open_for_table(&mut conn, TENANT_A, "tbl_pay", "usr_2", "ODEME")
        .await
        .expect("kapatılır")
        .expect("açık rezervasyon vardı");

    assert_eq!(closed.status, "CANCELLED");
    assert_eq!(closed.close_reason.as_deref(), Some("ODEME"));
    assert_eq!(table_status(&mut conn, TENANT_A, "tbl_pay").await, "AVAILABLE");
}

#[tokio::test]
async fn acil_rezervasyonlu_masa_tasinamaz() {
    let pool = pool().await;
    seed_table(&pool, TENANT_A, "tbl_move", "AVAILABLE").await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    create(&mut conn, TENANT_A, "tbl_move", "usr_1", "WAITER", input("Ayşe"))
        .await
        .expect("rezervasyon yazılır");

    let error = assert_no_open_reservation(&mut conn, TENANT_A, "tbl_move")
        .await
        .expect_err("taşıma reddedilir");
    assert!(error.starts_with("CONFLICT"), "beklenen: {}", error);

    // Rezervasyon kapatıldıktan sonra kapı açılır.
    let open = open_for_table(&mut conn, TENANT_A, "tbl_move")
        .await
        .expect("okunur")
        .expect("açık kayıt vardır");
    cancel(&mut conn, TENANT_A, &open.id, "usr_1", None)
        .await
        .expect("iptal edilir");
    assert_no_open_reservation(&mut conn, TENANT_A, "tbl_move")
        .await
        .expect("kapı açılır");
}

#[tokio::test]
async fn gecerlilik_kurallari_uygulanir() {
    let pool = pool().await;
    seed_table(&pool, TENANT_A, "tbl_v", "AVAILABLE").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let blank_name = create(
        &mut conn,
        TENANT_A,
        "tbl_v",
        "usr_1",
        "WAITER",
        input("   "),
    )
    .await
    .expect_err("boş müşteri adı reddedilir");
    assert!(blank_name.starts_with("VALIDATION"), "beklenen: {}", blank_name);

    let zero_party = NewReservation {
        party_size: 0,
        ..input("Ayşe")
    };
    let error = create(&mut conn, TENANT_A, "tbl_v", "usr_1", "WAITER", zero_party)
        .await
        .expect_err("sıfır kişi reddedilir");
    assert!(error.starts_with("VALIDATION"), "beklenen: {}", error);

    let missing_time = NewReservation {
        reserved_at: "  ".to_string(),
        ..input("Ayşe")
    };
    let error = create(&mut conn, TENANT_A, "tbl_v", "usr_1", "WAITER", missing_time)
        .await
        .expect_err("saatsiz rezervasyon reddedilir");
    assert!(error.starts_with("VALIDATION"), "beklenen: {}", error);
}

#[tokio::test]
async fn salon_listesi_yalniz_acik_kayitlari_gosterir() {
    let pool = pool().await;
    seed_table(&pool, TENANT_A, "tbl_l1", "AVAILABLE").await;
    seed_table(&pool, TENANT_A, "tbl_l2", "AVAILABLE").await;
    let mut conn = pool.acquire().await.expect("bağlantı");

    let first = create(&mut conn, TENANT_A, "tbl_l1", "usr_1", "WAITER", input("Ayşe"))
        .await
        .expect("ilk kayıt");
    let second = create(&mut conn, TENANT_A, "tbl_l2", "usr_1", "WAITER", input("Ali"))
        .await
        .expect("ikinci kayıt");
    cancel(&mut conn, TENANT_A, &second.id, "usr_1", None)
        .await
        .expect("ikinci kayıt iptal edilir");

    let open = list_open(&mut conn, TENANT_A).await.expect("liste okunur");
    assert_eq!(open.len(), 1, "yalnız açık kayıt görünür");
    assert_eq!(open[0].id, first.id);
    assert_eq!(open[0].customer_name, "Ayşe");
}
