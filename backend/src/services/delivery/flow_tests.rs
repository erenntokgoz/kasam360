//! Paket servis akışı: bayrak, kiracı, durum geçişleri, kurye yetkisi, mutabakat ve stok.

use super::customers::{AddressInput, CustomerInput};
use super::orders::{self, CreatedDelivery, NewDelivery};
use super::settlement::{self, SettleInput};
use super::transitions::{self, Who};
use super::*;
use crate::commands::payment_commands::CartItemDto;
use crate::services::audit_service::AuditLock;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use tokio::sync::Mutex;

pub(super) const TENANT: &str = "tnt_a";
pub(super) const OTHER: &str = "tnt_b";
pub(super) const CASHIER: &str = "usr_cashier";
pub(super) const COURIER: &str = "usr_courier";
pub(super) const COURIER_2: &str = "usr_courier2";

pub(super) async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    sqlx::raw_sql(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A'), ('tnt_b', 'B');
         INSERT INTO tenant_modules (tenant_id, module_id, is_active) VALUES ('tnt_a', 'feat_delivery', 1);
         INSERT INTO users (id, tenant_id, role, name) VALUES
            ('usr_cashier', 'tnt_a', 'CASHIER', 'Kasiyer'),
            ('usr_courier', 'tnt_a', 'WAITER', 'Kurye Bir'),
            ('usr_courier2', 'tnt_a', 'WAITER', 'Kurye İki'),
            ('usr_kitchen', 'tnt_a', 'KITCHEN', 'Aşçı');
         INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_a', 'Genel');
         INSERT INTO products (id, tenant_id, category_id, name, price_cents, tax_rate_bp)
            VALUES ('prd_1', 'tnt_a', 'cat_1', 'Çay', 100, 1000),
                   ('prd_2', 'tnt_a', 'cat_1', 'Tost', 3000, 1000);
         INSERT INTO inventory_batches (id, tenant_id, product_id, initial_quantity,
                                        remaining_quantity, unit_cost_cents, received_at)
            VALUES ('bat_1', 'tnt_a', 'prd_1', 50, 50, 10, '2026-01-01'),
                   ('bat_2', 'tnt_a', 'prd_2', 50, 50, 500, '2026-01-01');",
    )
    .execute(&pool)
    .await
    .expect("veri");
    pool
}

pub(super) fn item(product: &str, quantity: i64) -> CartItemDto {
    CartItemDto {
        id: format!("drf_{product}"),
        product: serde_json::json!({ "id": product }),
        quantity,
        ..CartItemDto::default()
    }
}

/// Müşteri ve adres açar; (müşteri, adres) kimliklerini döndürür.
pub(super) async fn customer(pool: &SqlitePool, tenant: &str, phone: &str) -> (String, String) {
    let mutex = Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut tx = pool.begin().await.expect("işlem");
    let saved = customers::save_customer(
        &mut tx,
        &lock,
        tenant,
        CASHIER,
        "CASHIER",
        &CustomerInput {
            id: None,
            phone: phone.to_string(),
            name: "Ayşe Yılmaz".to_string(),
            note: String::new(),
        },
    )
    .await
    .expect("müşteri");
    let saved = customers::save_address(
        &mut tx,
        &lock,
        tenant,
        CASHIER,
        "CASHIER",
        &AddressInput {
            id: None,
            customer_id: saved.id.clone(),
            label: "Ev".to_string(),
            address: "Gül Sk. 4/2".to_string(),
            directions: "Mavi kapı".to_string(),
        },
    )
    .await
    .expect("adres");
    tx.commit().await.expect("onay");
    (saved.id, saved.addresses[0].id.clone())
}

pub(super) async fn create(
    pool: &SqlitePool,
    tenant: &str,
    ids: &(String, String),
    method: &str,
    fee: i64,
) -> Result<CreatedDelivery, String> {
    let mutex = Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let created = orders::create(
        &mut tx,
        &lock,
        tenant,
        CASHIER,
        "CASHIER",
        &NewDelivery {
            customer_id: ids.0.clone(),
            address_id: ids.1.clone(),
            items: vec![item("prd_1", 2)],
            fee_cents: fee,
            payment_method: method.to_string(),
            note: String::new(),
            source: None,
        },
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(created)
}

pub(super) async fn advance(
    pool: &SqlitePool,
    who: Who,
    actor: &str,
    delivery: &str,
    to: &str,
    courier: Option<&str>,
) -> Result<DeliveryRow, String> {
    let mutex = Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let row = transitions::advance(
        &mut tx, &lock, TENANT, actor, "CASHIER", who, delivery, to, courier,
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(row)
}

pub(super) async fn flag(pool: &SqlitePool, user: &str, enabled: bool) -> Result<(), String> {
    let mutex = Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    couriers::set_flag(&mut tx, &lock, TENANT, "usr_owner", "OWNER", user, enabled).await?;
    tx.commit().await.map_err(|e| e.to_string())
}

/// Siparişi teslim edilmiş duruma getirir (kurye atanmış, yolda, teslim).
pub(super) async fn deliver(pool: &SqlitePool, created: &CreatedDelivery) {
    let id = &created.delivery_id;
    advance(pool, Who::Staff, CASHIER, id, "READY", None)
        .await
        .expect("hazır");
    advance(pool, Who::Staff, CASHIER, id, "ON_ROUTE", Some(COURIER))
        .await
        .expect("yolda");
    advance(pool, Who::Courier, COURIER, id, "DELIVERED", None)
        .await
        .expect("teslim");
}

pub(super) async fn settle(
    pool: &SqlitePool,
    ids: &[&str],
    cash: i64,
    card: i64,
    note: &str,
) -> Result<settlement::SettlementResult, String> {
    let mutex = Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let result = settlement::settle_courier(
        &mut tx,
        &lock,
        TENANT,
        CASHIER,
        "CASHIER",
        &SettleInput {
            courier_id: COURIER.to_string(),
            delivery_ids: ids.iter().map(|id| id.to_string()).collect(),
            received_cash_cents: cash,
            received_card_cents: card,
            note: note.to_string(),
        },
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(result)
}

pub(super) async fn stock(pool: &SqlitePool) -> f64 {
    sqlx::query_scalar("SELECT remaining_quantity FROM inventory_batches WHERE id = 'bat_1'")
        .fetch_one(pool)
        .await
        .expect("stok")
}

pub(super) async fn setup() -> (SqlitePool, (String, String)) {
    let pool = pool().await;
    flag(&pool, COURIER, true).await.expect("kurye");
    let ids = customer(&pool, TENANT, "0532 111 22 33").await;
    (pool, ids)
}

#[tokio::test]
async fn bayrak_kapaliyken_kiraci_paket_servisi_kullanamaz() {
    let pool = pool().await;
    let ids = customer(&pool, OTHER, "0532 999 88 77").await;
    let error = create(&pool, OTHER, &ids, "CASH", 0)
        .await
        .expect_err("kapalı");
    assert!(error.starts_with("NOT_FOUND"), "{error}");
    let mut conn = pool.acquire().await.expect("bağlantı");
    assert!(list_board(&mut conn, OTHER, None, 10).await.is_ok());
    assert!(require_enabled(&mut conn, OTHER).await.is_err());
}

#[tokio::test]
async fn siparis_toplami_ucret_dahil_ve_stok_bir_kez_duser() {
    let (pool, ids) = setup().await;
    let created = create(&pool, TENANT, &ids, "CASH", 500)
        .await
        .expect("sipariş");
    // 2 x 100 kuruş ürün + 500 kuruş teslimat ücreti; fiyat sunucudan gelir.
    assert_eq!(created.total_cents, 700);
    assert_eq!(created.item_ids.len(), 1, "ücret satırı mutfağa gitmez");
    assert_eq!(stock(&pool).await, 48.0);
    let mut conn = pool.acquire().await.expect("bağlantı");
    let row = find_delivery(&mut conn, TENANT, &created.delivery_id)
        .await
        .expect("satır");
    assert_eq!(row.status, "PREPARING");
    assert_eq!(row.fee_cents, 500);
    assert_eq!(row.total_cents, 700);
    assert_eq!(row.items_summary, "2 x Çay");
    assert_eq!(row.address_text, "Gül Sk. 4/2");
    let hidden: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM tables WHERE tenant_id = ? AND substr(id, 1, 12) = 'tbl_counter_'",
    )
    .bind(TENANT)
    .fetch_one(&mut *conn)
    .await
    .expect("masa");
    assert_eq!(hidden, 1, "paket satış noktası salon planında görünmez");
}

#[tokio::test]
async fn platform_kaynagi_ve_gecersiz_odeme_reddedilir() {
    let (pool, ids) = setup().await;
    let mutex = Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.expect("bağlantı");
    let mut input = NewDelivery {
        customer_id: ids.0.clone(),
        address_id: ids.1.clone(),
        items: vec![item("prd_1", 1)],
        fee_cents: 0,
        payment_method: "CASH".to_string(),
        note: String::new(),
        source: Some("GETIR".to_string()),
    };
    let error = orders::create(&mut conn, &lock, TENANT, CASHIER, "CASHIER", &input)
        .await
        .expect_err("platform");
    assert!(error.contains("platform"), "{error}");
    input.source = None;
    input.payment_method = "VERESIYE".to_string();
    assert!(
        orders::create(&mut conn, &lock, TENANT, CASHIER, "CASHIER", &input)
            .await
            .is_err()
    );
    input.payment_method = "CASH".to_string();
    input.fee_cents = -1;
    assert!(
        orders::create(&mut conn, &lock, TENANT, CASHIER, "CASHIER", &input)
            .await
            .is_err()
    );
    input.fee_cents = 0;
    input.items.clear();
    assert!(
        orders::create(&mut conn, &lock, TENANT, CASHIER, "CASHIER", &input)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn baska_kiracinin_musterisi_ile_siparis_acilamaz() {
    let (pool, _) = setup().await;
    let foreign = customer(&pool, OTHER, "0532 555 44 33").await;
    let error = create(&pool, TENANT, &foreign, "CASH", 0)
        .await
        .expect_err("yabancı");
    assert!(error.starts_with("NOT_FOUND"), "{error}");
}

#[tokio::test]
async fn durum_gecisleri_sirali_ve_kurye_yalniz_kendi_siparisini_ilerletir() {
    let (pool, ids) = setup().await;
    let created = create(&pool, TENANT, &ids, "CASH", 0)
        .await
        .expect("sipariş");
    let id = created.delivery_id.as_str();

    let skip = advance(&pool, Who::Staff, CASHIER, id, "ON_ROUTE", Some(COURIER)).await;
    assert!(skip.expect_err("atlama").starts_with("INVALID_TRANSITION"));
    // Kurye mutfağın "Hazır" kararını veremez.
    let ready_by_courier = advance(&pool, Who::Courier, COURIER, id, "READY", None).await;
    assert!(ready_by_courier.is_err());
    advance(&pool, Who::Staff, CASHIER, id, "READY", None)
        .await
        .expect("hazır");

    let no_courier = advance(&pool, Who::Staff, CASHIER, id, "ON_ROUTE", None).await;
    assert!(no_courier.is_err(), "kuryesiz yola çıkamaz");
    let not_a_courier = advance(
        &pool,
        Who::Staff,
        CASHIER,
        id,
        "ON_ROUTE",
        Some("usr_kitchen"),
    )
    .await;
    assert!(not_a_courier.is_err(), "etiketsiz personel kurye olamaz");

    // Atanmamış kurye siparişi ilerletemez.
    flag(&pool, COURIER_2, true).await.expect("ikinci kurye");
    {
        let mutex = Mutex::new(());
        let lock = AuditLock::new(mutex.lock().await);
        let mut tx = pool.begin().await.expect("işlem");
        transitions::assign_courier(&mut tx, &lock, TENANT, CASHIER, "CASHIER", id, COURIER)
            .await
            .expect("atama");
        tx.commit().await.expect("onay");
    }
    let foreign_courier = advance(&pool, Who::Courier, COURIER_2, id, "ON_ROUTE", None).await;
    assert!(foreign_courier
        .expect_err("başkası")
        .starts_with("FORBIDDEN"));
    let on_route = advance(&pool, Who::Courier, COURIER, id, "ON_ROUTE", None)
        .await
        .expect("yolda");
    assert_eq!(on_route.courier_id.as_deref(), Some(COURIER));
    assert!(on_route.dispatched_at.is_some());

    let delivered = advance(&pool, Who::Courier, COURIER, id, "DELIVERED", None)
        .await
        .expect("teslim");
    assert_eq!(delivered.status, "DELIVERED");
    assert!(advance(&pool, Who::Staff, CASHIER, id, "READY", None)
        .await
        .is_err());
}

#[tokio::test]
async fn kurye_gorunumu_yalniz_kendi_atamalarini_listeler() {
    let (pool, ids) = setup().await;
    let mine = create(&pool, TENANT, &ids, "CASH", 0)
        .await
        .expect("birinci");
    let other = create(&pool, TENANT, &ids, "CASH", 0)
        .await
        .expect("ikinci");
    advance(&pool, Who::Staff, CASHIER, &mine.delivery_id, "READY", None)
        .await
        .expect("hazır");
    advance(
        &pool,
        Who::Staff,
        CASHIER,
        &mine.delivery_id,
        "ON_ROUTE",
        Some(COURIER),
    )
    .await
    .expect("yolda");
    let mut conn = pool.acquire().await.expect("bağlantı");
    let seen = list_board(&mut conn, TENANT, Some(COURIER), 10)
        .await
        .expect("liste");
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].id, mine.delivery_id);
    let all = list_board(&mut conn, TENANT, None, 10)
        .await
        .expect("liste");
    assert_eq!(all.len(), 2);
    assert!(all.iter().any(|row| row.id == other.delivery_id));
}

#[tokio::test]
async fn mutfak_hazir_derse_paket_durumu_hazir_olur() {
    let (pool, ids) = setup().await;
    let created = create(&pool, TENANT, &ids, "CASH", 0)
        .await
        .expect("sipariş");
    let mutex = Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut tx = pool.begin().await.expect("işlem");
    transitions::mark_ready_for_order(
        &mut tx,
        &lock,
        TENANT,
        &created.order_id,
        "usr_kitchen",
        "KITCHEN",
    )
    .await
    .expect("hazır");
    // Paket olmayan sipariş sessizce geçilir.
    transitions::mark_ready_for_order(&mut tx, &lock, TENANT, "ord_yok", "usr_kitchen", "KITCHEN")
        .await
        .expect("paket değil");
    tx.commit().await.expect("kayıt");
    let status: String = sqlx::query_scalar("SELECT status FROM delivery_orders WHERE id = ?")
        .bind(&created.delivery_id)
        .fetch_one(&pool)
        .await
        .expect("durum");
    assert_eq!(status, "READY");
}
