//! Paket servis parası: kapıda tahsilat mutabakatı, ön ödeme, iptal, müşteri geçmişi ve rapor.

use super::customers::CustomerInput;
use super::flow_tests::*;
use super::orders;
use super::settlement::{self, SettleInput};
use super::*;
use crate::services::audit_service::AuditLock;
use tokio::sync::Mutex;

#[tokio::test]
async fn kapida_nakit_mutabakati_kasaya_nakit_yazar_stok_tekrar_dusmez() {
    let (pool, ids) = setup().await;
    let created = create(&pool, TENANT, &ids, "CASH", 500)
        .await
        .expect("sipariş");
    deliver(&pool, &created).await;
    assert_eq!(stock(&pool).await, 48.0);

    // Kasaya para girmeden adisyon kapanmaz.
    let order_status: String = sqlx::query_scalar("SELECT status FROM orders WHERE id = ?")
        .bind(&created.order_id)
        .fetch_one(&pool)
        .await
        .expect("durum");
    assert_eq!(order_status, "IN_PROGRESS");

    let short = settle(&pool, &[&created.delivery_id], 600, 0, "").await;
    assert!(short
        .expect_err("açıklamasız fark")
        .starts_with("VALIDATION"));
    let result = settle(
        &pool,
        &[&created.delivery_id],
        600,
        0,
        "100 kuruş eksik geldi",
    )
    .await
    .expect("mutabakat");
    assert_eq!(result.expected_cash_cents, 700);
    assert_eq!(result.cash_difference_cents, -100);
    assert_eq!(result.expected_card_cents, 0);

    let (cash, card, total): (i64, i64, i64) = sqlx::query_as(
        "SELECT CAST(json_extract(payload, '$.cashAmountCents') AS INTEGER),
                CAST(json_extract(payload, '$.cardAmountCents') AS INTEGER),
                CAST(json_extract(payload, '$.totalAmount') AS INTEGER)
         FROM audit_ledger WHERE tenant_id = ? AND action = 'payment:settled_fifo'",
    )
    .bind(TENANT)
    .fetch_one(&pool)
    .await
    .expect("defter");
    assert_eq!((cash, card, total), (700, 0, 700));
    let order_status: String = sqlx::query_scalar("SELECT status FROM orders WHERE id = ?")
        .bind(&created.order_id)
        .fetch_one(&pool)
        .await
        .expect("durum");
    assert_eq!(order_status, "PAID");
    assert_eq!(
        stock(&pool).await,
        48.0,
        "mutabakat stoğu ikinci kez düşmez"
    );

    let again = settle(&pool, &[&created.delivery_id], 700, 0, "").await;
    assert!(again.is_err(), "aynı sipariş iki kez tahsil edilemez");
}

#[tokio::test]
async fn kapida_kart_kart_kanalina_yazilir() {
    let (pool, ids) = setup().await;
    let created = create(&pool, TENANT, &ids, "CARD", 0)
        .await
        .expect("sipariş");
    deliver(&pool, &created).await;
    let wrong_channel = settle(&pool, &[&created.delivery_id], 200, 0, "yanlış kanal").await;
    // Fark açıklamayla kabul edilir ama kayıt beklenen kanalı korur.
    let result = wrong_channel.expect("fark kayda geçer");
    assert_eq!(
        (result.expected_card_cents, result.card_difference_cents),
        (200, -200)
    );
    let (cash, card): (i64, i64) = sqlx::query_as(
        "SELECT CAST(json_extract(payload, '$.cashAmountCents') AS INTEGER),
                CAST(json_extract(payload, '$.cardAmountCents') AS INTEGER)
         FROM audit_ledger WHERE tenant_id = ? AND action = 'payment:settled_fifo'",
    )
    .bind(TENANT)
    .fetch_one(&pool)
    .await
    .expect("defter");
    assert_eq!((cash, card), (0, 200));
}

#[tokio::test]
async fn online_odenen_siparis_teslimde_kapanir_kasaya_para_girmez() {
    let (pool, ids) = setup().await;
    let created = create(&pool, TENANT, &ids, "ONLINE", 0)
        .await
        .expect("sipariş");
    deliver(&pool, &created).await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let row = find_delivery(&mut conn, TENANT, &created.delivery_id)
        .await
        .expect("satır");
    assert!(row.settled_at.is_some());
    let (cash, card, total): (i64, i64, i64) = sqlx::query_as(
        "SELECT CAST(json_extract(payload, '$.cashAmountCents') AS INTEGER),
                CAST(json_extract(payload, '$.cardAmountCents') AS INTEGER),
                CAST(json_extract(payload, '$.totalAmount') AS INTEGER)
         FROM audit_ledger WHERE tenant_id = ? AND action = 'payment:settled_fifo'",
    )
    .bind(TENANT)
    .fetch_one(&mut *conn)
    .await
    .expect("defter");
    assert_eq!((cash, card, total), (0, 0, 200));
    drop(conn);
    let again = settle(&pool, &[&created.delivery_id], 0, 0, "").await;
    assert!(again.is_err(), "ön ödemeli sipariş kuryeden tahsil edilmez");
}

#[tokio::test]
async fn mutabakat_baska_kuryenin_ya_da_teslim_edilmemis_siparisi_reddeder() {
    let (pool, ids) = setup().await;
    let created = create(&pool, TENANT, &ids, "CASH", 0)
        .await
        .expect("sipariş");
    let early = settle(&pool, &[&created.delivery_id], 200, 0, "").await;
    assert!(early.is_err(), "teslim edilmemiş");
    deliver(&pool, &created).await;
    flag(&pool, COURIER_2, true).await.expect("ikinci kurye");
    let mutex = Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.expect("bağlantı");
    let wrong = settlement::settle_courier(
        &mut conn,
        &lock,
        TENANT,
        CASHIER,
        "CASHIER",
        &SettleInput {
            courier_id: COURIER_2.to_string(),
            delivery_ids: vec![created.delivery_id.clone()],
            received_cash_cents: 200,
            received_card_cents: 0,
            note: String::new(),
        },
    )
    .await;
    assert!(wrong.expect_err("başka kurye").starts_with("FORBIDDEN"));
    let foreign_tenant = settlement::settle_courier(
        &mut conn,
        &lock,
        OTHER,
        CASHIER,
        "CASHIER",
        &SettleInput {
            courier_id: COURIER.to_string(),
            delivery_ids: vec![created.delivery_id.clone()],
            received_cash_cents: 200,
            received_card_cents: 0,
            note: String::new(),
        },
    )
    .await;
    assert!(foreign_tenant.is_err(), "başka kiracı mutabakat yapamaz");
}

#[tokio::test]
async fn iptal_stogu_geri_verir_teslim_edilmis_siparis_iptal_edilemez() {
    let (pool, ids) = setup().await;
    let created = create(&pool, TENANT, &ids, "CASH", 500)
        .await
        .expect("sipariş");
    assert_eq!(stock(&pool).await, 48.0);
    {
        let mutex = Mutex::new(());
        let lock = AuditLock::new(mutex.lock().await);
        let mut tx = pool.begin().await.expect("işlem");
        let row = orders::cancel(
            &mut tx,
            &lock,
            TENANT,
            CASHIER,
            "CASHIER",
            &created.delivery_id,
            "müşteri vazgeçti",
        )
        .await
        .expect("iptal");
        tx.commit().await.expect("onay");
        assert_eq!(row.status, "CANCELLED");
    }
    assert_eq!(stock(&pool).await, 50.0);
    let order_status: String = sqlx::query_scalar("SELECT status FROM orders WHERE id = ?")
        .bind(&created.order_id)
        .fetch_one(&pool)
        .await
        .expect("durum");
    assert_eq!(order_status, "VOID");

    let delivered = create(&pool, TENANT, &ids, "CASH", 0)
        .await
        .expect("ikinci");
    deliver(&pool, &delivered).await;
    let mutex = Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.expect("bağlantı");
    let late = orders::cancel(
        &mut conn,
        &lock,
        TENANT,
        CASHIER,
        "CASHIER",
        &delivered.delivery_id,
        "geç kalındı",
    )
    .await;
    assert!(late.expect_err("teslim").starts_with("INVALID_TRANSITION"));
}

#[tokio::test]
async fn kurye_etiketi_acik_isi_varken_kaldirilamaz() {
    let (pool, ids) = setup().await;
    let created = create(&pool, TENANT, &ids, "CASH", 0)
        .await
        .expect("sipariş");
    deliver(&pool, &created).await;
    let error = flag(&pool, COURIER, false).await.expect_err("açık iş");
    assert!(error.starts_with("CONFLICT"), "{error}");
    assert!(
        flag(&pool, "usr_kitchen", true).await.is_err(),
        "mutfak kurye olamaz"
    );
    settle(&pool, &[&created.delivery_id], 200, 0, "")
        .await
        .expect("mutabakat");
    flag(&pool, COURIER, false).await.expect("artık kalkar");
}

#[tokio::test]
async fn musteri_telefonu_tekil_aranir_ve_gecmisi_listelenir() {
    let (pool, ids) = setup().await;
    let created = create(&pool, TENANT, &ids, "CASH", 0)
        .await
        .expect("sipariş");
    let mut conn = pool.acquire().await.expect("bağlantı");
    let by_phone = customers::search(&mut conn, TENANT, "111 22")
        .await
        .expect("arama");
    assert_eq!(by_phone.len(), 1);
    assert_eq!(by_phone[0].addresses.len(), 1);
    assert_eq!(by_phone[0].order_count, 1);
    let by_name = customers::search(&mut conn, TENANT, "ayşe")
        .await
        .expect("ad");
    assert_eq!(by_name.len(), 1);
    assert!(customers::search(&mut conn, OTHER, "111 22")
        .await
        .expect("kiracı")
        .is_empty());
    let history = customers::history(&mut conn, TENANT, &ids.0, 10)
        .await
        .expect("geçmiş");
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].delivery_id, created.delivery_id);
    assert_eq!(history[0].total_cents, 200);
    drop(conn);

    let mutex = Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let mut conn = pool.acquire().await.expect("bağlantı");
    let clash = customers::save_customer(
        &mut conn,
        &lock,
        TENANT,
        CASHIER,
        "CASHIER",
        &CustomerInput {
            id: None,
            phone: "+90 532 111 22 33".to_string(),
            name: "Başka".to_string(),
            note: String::new(),
        },
    )
    .await;
    assert!(clash.expect_err("aynı telefon").starts_with("CONFLICT"));
}

#[tokio::test]
async fn rapor_teslim_ciro_iptal_ve_kurye_sayilarini_verir() {
    let (pool, ids) = setup().await;
    let first = create(&pool, TENANT, &ids, "CASH", 500)
        .await
        .expect("birinci");
    deliver(&pool, &first).await;
    let second = create(&pool, TENANT, &ids, "ONLINE", 0)
        .await
        .expect("ikinci");
    deliver(&pool, &second).await;
    let third = create(&pool, TENANT, &ids, "CARD", 0)
        .await
        .expect("üçüncü");
    {
        let mutex = Mutex::new(());
        let lock = AuditLock::new(mutex.lock().await);
        let mut tx = pool.begin().await.expect("işlem");
        orders::cancel(
            &mut tx,
            &lock,
            TENANT,
            CASHIER,
            "CASHIER",
            &third.delivery_id,
            "iptal",
        )
        .await
        .expect("iptal");
        tx.commit().await.expect("onay");
    }
    let mut conn = pool.acquire().await.expect("bağlantı");
    let report = reports::report(
        &mut conn,
        TENANT,
        "2000-01-01T00:00:00+00:00",
        "2999-01-01T00:00:00+00:00",
    )
    .await
    .expect("rapor");
    assert_eq!(report.delivered_count, 2);
    assert_eq!(report.revenue_cents, 700 + 200);
    assert_eq!(report.fee_cents, 500);
    assert_eq!(report.cancelled_count, 1);
    assert_eq!(report.cancelled_cents, 200);
    assert_eq!(report.couriers.len(), 1);
    assert_eq!(report.couriers[0].delivered_count, 2);
    assert!(report.couriers[0].average_trip_seconds.is_some());
    let other = reports::report(
        &mut conn,
        OTHER,
        "2000-01-01T00:00:00+00:00",
        "2999-01-01T00:00:00+00:00",
    )
    .await
    .expect("diğer kiracı");
    assert_eq!(other.delivered_count, 0);
}
