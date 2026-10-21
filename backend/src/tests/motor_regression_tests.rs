//! Motor akışları için regresyon ve entegrasyon testleri:
//! 1. POS 86'd kilidi, ek sipariş (append) ve get_order_items.
//! 2. parse_order_item_modifiers & parse_kds_created_at (RUSH) sözleşmesi.
//! 3. move_table (TARGET_OCCUPIED, masa taşıma ve kaynak sıfırlama).
//! 4. close_shift (cashAmountCents, cash_in, cash_out ile beklenen bakiye ve fark).

use crate::commands::command_helpers::parse_order_item_modifiers;
use crate::commands::floor_commands::table_ops::execute_move_table;
use crate::commands::kds_commands::{execute_get_active_tickets, parse_kds_created_at};
use crate::commands::payment_commands::CartItemDto;
use crate::commands::pos_commands::{
    execute_get_order_items, execute_submit_order, SubmitOrderPayloadDto,
};
use crate::commands::shift_commands::execute_close_shift;
use crate::commands::void_commands::item_void::{execute_void_order_item, VoidOrderItemPayloadDto};
use crate::db::DbPool;
use crate::services::audit_service::{AuditContext, AuditLock, AuditService};

async fn setup_test_db() -> DbPool {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("in-memory db açılmalı");

    let schema = include_str!("../../migrations/schema.sql");
    sqlx::raw_sql(schema)
        .execute(&pool)
        .await
        .expect("schema.sql uygulanmalı");

    pool
}

#[tokio::test]
async fn pos_86_kilidi_ve_ek_siparis_append_testi() {
    let pool = setup_test_db().await;
    let mut conn = pool.acquire().await.expect("conn");
    let tenant = "t_pos_motor";

    // Kategori, masa ve ürünler
    sqlx::query(
        "INSERT INTO categories (id, tenant_id, name, default_station) VALUES ('cat_mutfak', ?1, 'Yemekler', 'Mutfak')",
    )
    .bind(tenant)
    .execute(&mut *conn)
    .await
    .expect("kategori");

    sqlx::query(
        "INSERT INTO tables (id, tenant_id, name, status, current_total) VALUES ('tbl_10', ?1, 'Masa 10', 'AVAILABLE', 0)",
    )
    .bind(tenant)
    .execute(&mut *conn)
    .await
    .expect("masa");

    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, price_cents, tax_rate_bp, category_id, is_active, is_86)
         VALUES ('prd_86', ?1, 'Tükenmiş Çorba', 5000, 1000, 'cat_mutfak', 1, 1),
                ('prd_corba', ?1, 'Mercimek Çorbası', 3000, 1000, 'cat_mutfak', 1, 0),
                ('prd_pilav', ?1, 'Pirinç Pilavı', 4000, 1000, 'cat_mutfak', 1, 0)",
    )
    .bind(tenant)
    .execute(&mut *conn)
    .await
    .expect("ürünler");

    // 1. is_86 = 1 olan ürünle sipariş verme denemesi reddedilmeli
    let payload_86 = SubmitOrderPayloadDto {
        order_id: "".into(),
        table_id: "tbl_10".into(),
        items: vec![CartItemDto {
            id: "i_86".into(),
            product: serde_json::json!({ "id": "prd_86" }),
            quantity: 1,
            ..Default::default()
        }],
        notes: None,
        ..Default::default()
    };

    let err_res = execute_submit_order(&mut conn, tenant, &payload_86, Some("usr_garson")).await;
    assert!(
        err_res.is_err(),
        "86'd ürün sipariş edilemez, reddedilmeliydi"
    );
    assert!(err_res.unwrap_err().contains("PRODUCT_86D"));

    // 2. Açık siparişi olmayan masaya ilk sipariş (Mercimek Çorbası, 3000 + 300 KDV = 3300)
    let payload_1 = SubmitOrderPayloadDto {
        order_id: "".into(),
        table_id: "tbl_10".into(),
        items: vec![CartItemDto {
            id: "i_c1".into(),
            product: serde_json::json!({ "id": "prd_corba" }),
            quantity: 1,
            note: Some("Sıcak olsun".into()),
            ..Default::default()
        }],
        notes: Some("Genel masa notu".into()),
        ..Default::default()
    };

    let res_1 = execute_submit_order(&mut conn, tenant, &payload_1, Some("usr_garson")).await;
    assert!(res_1.is_ok(), "İlk sipariş başarıyla verilmeli");

    let table_1: (String, i64) = sqlx::query_as(
        "SELECT status, current_total FROM tables WHERE id = 'tbl_10' AND tenant_id = ?",
    )
    .bind(tenant)
    .fetch_one(&mut *conn)
    .await
    .expect("masa sorgusu");
    assert_eq!(table_1.0, "OCCUPIED");
    assert_eq!(table_1.1, 3300);

    // 3. Masada açık sipariş varken ikinci kez sipariş gönderme (Pilav 2 adet, 2 * 4400 = 8800)
    // Yeni kalemler mevcut açık siparişe eklenmeli (append)
    let payload_2 = SubmitOrderPayloadDto {
        order_id: "".into(),
        table_id: "tbl_10".into(),
        items: vec![CartItemDto {
            id: "i_p1".into(),
            product: serde_json::json!({ "id": "prd_pilav" }),
            quantity: 2,
            note: Some("Az tereyağlı".into()),
            ..Default::default()
        }],
        notes: None,
        ..Default::default()
    };

    let res_2 = execute_submit_order(&mut conn, tenant, &payload_2, Some("usr_garson")).await;
    assert!(res_2.is_ok(), "Ek sipariş başarıyla eklenmeli");

    // Masadaki açık sipariş sayısı tek kalmalı (yeni sipariş açılmamalı, append olmalı)
    let order_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM orders WHERE table_id = 'tbl_10' AND tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS')",
    )
    .bind(tenant)
    .fetch_one(&mut *conn)
    .await
    .expect("sipariş sayısı");
    assert_eq!(order_count, 1, "Mevcut siparişe append yapılmalı");

    // Masa yürüyen toplamı güncellenmeli: 3300 + 8800 = 12100 kuruş
    let table_2_total: i64 = sqlx::query_scalar(
        "SELECT current_total FROM tables WHERE id = 'tbl_10' AND tenant_id = ?",
    )
    .bind(tenant)
    .fetch_one(&mut *conn)
    .await
    .expect("masa toplamı");
    assert_eq!(table_2_total, 12100);

    // 4. execute_get_order_items çağrıldığında tüm kalemlerin eksiksiz dönmesi
    let items = execute_get_order_items(&mut conn, "tbl_10", tenant)
        .await
        .expect("get_order_items");
    assert_eq!(
        items.len(),
        2,
        "Her iki siparişin kalemleri eksiksiz dönmeli"
    );

    let corba = items
        .iter()
        .find(|i| i.product["id"] == "prd_corba")
        .expect("çorba kalemi");
    assert_eq!(corba.quantity, 1);
    assert_eq!(corba.note.as_deref(), Some("Sıcak olsun"));

    let pilav = items
        .iter()
        .find(|i| i.product["id"] == "prd_pilav")
        .expect("pilav kalemi");
    assert_eq!(pilav.quantity, 2);
    assert_eq!(pilav.note.as_deref(), Some("Az tereyağlı"));
}

#[test]
fn kds_modifiers_ve_rush_sayaci_testi() {
    // 1. parse_order_item_modifiers sözleşme testi
    let json_snap = r#"[{"id":"m1","name":"Az Pişmiş","priceCents":0}]"#;
    let parsed = parse_order_item_modifiers(Some(json_snap));
    assert_eq!(parsed, vec!["Az Pişmiş".to_string()]);

    let json_priced = r#"[{"id":"m2","name":"Ekstra Kaşar","priceCents":1500}]"#;
    let parsed_priced = parse_order_item_modifiers(Some(json_priced));
    assert_eq!(parsed_priced, vec!["Ekstra Kaşar (+15.00 TL)".to_string()]);

    let json_plain = r#"["Sossuz","Buzlu"]"#;
    let parsed_plain = parse_order_item_modifiers(Some(json_plain));
    assert_eq!(
        parsed_plain,
        vec!["Sossuz".to_string(), "Buzlu".to_string()]
    );

    // 2. parse_kds_created_at ve 20 dk öncesi RUSH testi
    let twenty_mins_ago = chrono::Utc::now() - chrono::Duration::minutes(20);
    let sqlite_date_str = twenty_mins_ago.format("%Y-%m-%d %H:%M:%S").to_string();

    let parsed_dt = parse_kds_created_at(&sqlite_date_str)
        .expect("SQLite UTC zaman formatı başarıyla ayrıştırılmalı");
    let elapsed = (chrono::Utc::now() - parsed_dt).num_seconds().max(0);
    assert!(
        (1190..=1220).contains(&elapsed),
        "Geçen süre yaklaşık 1200 saniye olmalı: {elapsed}"
    );

    let priority = if elapsed >= 900 {
        "RUSH"
    } else if elapsed >= 600 {
        "WARNING"
    } else {
        "NORMAL"
    };
    assert_eq!(priority, "RUSH", "15 dakikayı aşan sipariş RUSH olmalı");
}

#[tokio::test]
async fn move_table_dolu_masayi_reddeder_bos_masaya_tasir_ve_kaynagi_sifirlar() {
    let pool = setup_test_db().await;
    let mut conn = pool.acquire().await.expect("conn");
    let tenant = "t_move_table";

    sqlx::query(
        "INSERT INTO tables (id, tenant_id, name, status, current_total, waiter_id)
         VALUES ('tbl_src', ?1, 'Masa 1', 'OCCUPIED', 5000, 'usr_garson'),
                ('tbl_occ', ?1, 'Masa 2', 'OCCUPIED', 2000, 'usr_diger'),
                ('tbl_empty', ?1, 'Masa 3', 'AVAILABLE', 0, NULL)",
    )
    .bind(tenant)
    .execute(&mut *conn)
    .await
    .expect("masalar");

    sqlx::query(
        "INSERT INTO orders (id, tenant_id, table_id, status, total_cents, created_at)
         VALUES ('ord_src', ?1, 'tbl_src', 'OPEN', 5000, datetime('now'))",
    )
    .bind(tenant)
    .execute(&mut *conn)
    .await
    .expect("sipariş");

    // 1. Hedef masa dolu ise (OCCUPIED) TARGET_OCCUPIED dönmeli
    let err_occ = execute_move_table(&mut conn, tenant, "tbl_src", "tbl_occ").await;
    assert!(err_occ.is_err(), "Dolu masaya taşıma reddedilmeli");
    assert!(err_occ.unwrap_err().contains("TARGET_OCCUPIED"));

    // 2. Boş masaya taşıma başarılı olmalı
    let ok_move = execute_move_table(&mut conn, tenant, "tbl_src", "tbl_empty").await;
    assert!(ok_move.is_ok(), "Boş masaya taşıma başarılı olmalı");

    // Kaynak masa sıfırlanmalı
    let src: (String, i64, Option<String>) = sqlx::query_as(
        "SELECT status, current_total, waiter_id FROM tables WHERE id = 'tbl_src' AND tenant_id = ?",
    )
    .bind(tenant)
    .fetch_one(&mut *conn)
    .await
    .expect("src");
    assert_eq!(src.0, "AVAILABLE");
    assert_eq!(src.1, 0);
    assert!(src.2.is_none());

    // Hedef masa güncellenmeli
    let dest: (String, i64, Option<String>) = sqlx::query_as(
        "SELECT status, current_total, waiter_id FROM tables WHERE id = 'tbl_empty' AND tenant_id = ?",
    )
    .bind(tenant)
    .fetch_one(&mut *conn)
    .await
    .expect("dest");
    assert_eq!(dest.0, "OCCUPIED");
    assert_eq!(dest.1, 5000);
    assert_eq!(dest.2.as_deref(), Some("usr_garson"));

    // Siparişin masa kimliği güncellenmeli
    let ord_table: String = sqlx::query_scalar("SELECT table_id FROM orders WHERE id = 'ord_src'")
        .fetch_one(&mut *conn)
        .await
        .expect("order table");
    assert_eq!(ord_table, "tbl_empty");
}

#[tokio::test]
async fn close_shift_beklenen_bakiye_ve_farki_dogru_hesaplar() {
    let pool = setup_test_db().await;
    let mut conn = pool.acquire().await.expect("conn");
    let tenant = "t_shift_close";

    // 1. Açık vardiya
    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents)
         VALUES ('shf_100', ?1, 'usr_kasiyer', 'OPEN', '2026-03-15 08:00:00', 50000)",
    )
    .bind(tenant)
    .execute(&mut *conn)
    .await
    .expect("shift");

    // 2. payment:settled_fifo audit kaydı (Nakit 20_000, Kart 10_000)
    let audit_mutex = tokio::sync::Mutex::new(());
    let audit_lock = AuditLock::new(audit_mutex.lock().await);

    let payload_audit = serde_json::json!({
        "totalAmount": 30000,
        "cashAmountCents": 20000,
        "cardAmountCents": 10000
    });
    let ctx = AuditContext::new(
        tenant.to_string(),
        "usr_kasiyer".to_string(),
        "CASHIER".to_string(),
        crate::services::audit_service::category::FINANS,
        "payment:settled_fifo",
        "ord_x".to_string(),
        payload_audit,
        "2026-03-15T10:00:00Z".to_string(),
    )
    .expect("valid audit context");
    AuditService::append(&mut conn, &audit_lock, &ctx)
        .await
        .expect("audit record");

    // 3. Kasa giriş (10_000) ve kasa çıkış (5_000)
    sqlx::query(
        "INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at)
         VALUES ('cm_in', ?1, 'shf_100', 'IN', 10000, 'Avans ekleme', 'usr_kasiyer', '2026-03-15 11:00:00'),
                ('cm_out', ?1, 'shf_100', 'OUT', 5000, 'Tedarikçi peşin ödeme', 'usr_kasiyer', '2026-03-15 12:00:00')",
    )
    .bind(tenant)
    .execute(&mut *conn)
    .await
    .expect("cash movements");

    // Beklenen kasa bakiyesi:
    // Açılış (50_000) + Nakit Satış (20_000) + Kasa Giriş (10_000) - Kasa Çıkış (5_000) = 75_000 kuruş.
    // Sayılan nakit: 73_000 kuruş.
    // Beklenen fark: 73_000 - 75_000 = -2000 kuruş (kasa açığı).
    let closed = execute_close_shift(
        &mut conn,
        &audit_lock,
        "usr_kasiyer",
        73000,
        tenant,
        Some("CASHIER"),
    )
    .await
    .expect("execute_close_shift başarılı olmalı");

    assert_eq!(closed.status, "CLOSED");

    let shift_row: (i64, i64, String) = sqlx::query_as(
        "SELECT actual_amount_cents, difference_cents, status FROM shifts WHERE id = 'shf_100' AND tenant_id = ?",
    )
    .bind(tenant)
    .fetch_one(&mut *conn)
    .await
    .expect("shift row");

    assert_eq!(shift_row.0, 73000, "actual_amount_cents 73000 olmalı");
    assert_eq!(
        shift_row.1, -2000,
        "difference_cents -2000 (i64) olarak doğru hesaplanmalı"
    );
    assert_eq!(shift_row.2, "CLOSED");
}

#[tokio::test]
async fn kds_aktif_biletler_iptal_edilen_kalemi_gostermez() {
    let pool = setup_test_db().await;
    let mut conn = pool.acquire().await.expect("conn");
    let tenant = "t_kds_void";

    // 1. Kategori, masa ve ürünler
    sqlx::query(
        "INSERT INTO categories (id, tenant_id, name, default_station) VALUES ('cat_kds', ?1, 'Mutfak', 'Sıcak')",
    )
    .bind(tenant)
    .execute(&mut *conn)
    .await
    .expect("kategori");

    sqlx::query(
        "INSERT INTO tables (id, tenant_id, name, status, current_total) VALUES ('tbl_kds', ?1, 'Masa KDS', 'AVAILABLE', 0)",
    )
    .bind(tenant)
    .execute(&mut *conn)
    .await
    .expect("masa");

    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, price_cents, tax_rate_bp, category_id, is_active)
         VALUES ('prd_pizza', ?1, 'Pizza', 15000, 1000, 'cat_kds', 1),
                ('prd_kola', ?1, 'Kola', 3000, 1000, 'cat_kds', 1)",
    )
    .bind(tenant)
    .execute(&mut *conn)
    .await
    .expect("ürünler");

    // Onay yetkilisi (Müdür)
    let pin_hash = crate::user_credentials::hash_pin("2222").expect("PIN hash");
    sqlx::query(
        "INSERT INTO users (id, tenant_id, role, name, pin_hash, is_active) VALUES ('usr_mgr', ?1, 'MANAGER', 'Müdür', ?2, 1)",
    )
    .bind(tenant)
    .bind(pin_hash)
    .execute(&mut *conn)
    .await
    .expect("müdür");

    // 2. Sipariş ver: 1 Pizza + 1 Kola
    let payload = SubmitOrderPayloadDto {
        order_id: "".into(),
        table_id: "tbl_kds".into(),
        items: vec![
            CartItemDto {
                id: "i_pizza".into(),
                product: serde_json::json!({ "id": "prd_pizza" }),
                quantity: 1,
                ..Default::default()
            },
            CartItemDto {
                id: "i_kola".into(),
                product: serde_json::json!({ "id": "prd_kola" }),
                quantity: 1,
                ..Default::default()
            },
        ],
        notes: Some("KDS test adisyonu".into()),
        waiter_id: Some("usr_garson".into()),
    };

    let (order_id, _) = execute_submit_order(&mut conn, tenant, &payload, Some("usr_garson"))
        .await
        .expect("sipariş verilmeli");

    // 3. get_active_tickets içinde bilet ve 2 kalemin görünmesi
    let tickets = execute_get_active_tickets(&mut conn, tenant)
        .await
        .expect("kds biletleri");
    assert_eq!(tickets.len(), 1, "1 aktif KDS bileti olmalı");
    assert_eq!(tickets[0].id, order_id);
    assert_eq!(tickets[0].items.len(), 2, "Bilette 2 kalem görünmeli");

    // 4. Kola kalemi için iptal onayı al ve void_order_item çağır
    // Kola: 3000 kuruş + %10 KDV = 3300 kuruş
    let kola_item = tickets[0]
        .items
        .iter()
        .find(|it| it["name"] == "Kola")
        .expect("kola kalemi");
    let kola_id = kola_item["id"].as_str().expect("kola id");

    let app_req = crate::commands::void_commands::order_void::void_approval_request(
        tenant,
        kola_id,
        3300,
        "usr_garson",
        "WAITER",
    );
    let verified = crate::approval_service::verify_and_issue(&mut conn, &app_req, "2222")
        .await
        .expect("onay jetonu alınmalı");

    let audit_mutex = tokio::sync::Mutex::new(());
    let audit_lock = AuditLock::new(audit_mutex.lock().await);

    let void_payload = VoidOrderItemPayloadDto {
        item_id: kola_id.into(),
        reason: "Müşteri vazgeçti".into(),
        actor_id: "usr_garson".into(),
        actor_role: "WAITER".into(),
        approval_token: Some(verified.token),
    };
    let void_res = execute_void_order_item(&mut conn, &audit_lock, tenant, &void_payload).await;
    assert!(void_res.is_ok(), "Kola kalemi başarıyla iptal edilmeli");

    // 5. get_active_tickets sorgulandığında iptal edilen kolanın KDS'ten düşmesi
    let tickets_after = execute_get_active_tickets(&mut conn, tenant)
        .await
        .expect("kds biletleri");
    assert_eq!(tickets_after.len(), 1, "Bilet hala aktif kalmalı");
    assert_eq!(
        tickets_after[0].items.len(),
        1,
        "İptal edilen kalem KDS listesinden düşmeli, yalnız 1 kalem kalmalı"
    );
    assert_eq!(tickets_after[0].items[0]["name"], "Pizza");
}
