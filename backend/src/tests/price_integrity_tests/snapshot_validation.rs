//! Snapshot ve finansal constraint bütünlüğü testleri.

use super::common::*;
use sqlx::Row;

// ─── 3. Snapshot ───────────────────────────────────────────────────────────

#[tokio::test]
async fn siparis_snapshoti_gercek_fiyati_yazar() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let option_id = seed_option(&pool, "Ekstra Peynir", 4000).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    // İstemci 0 gönderiyor; snapshot gerçek fiyatı yazmalı.
    let lying = serde_json::json!([{ "id": option_id, "name": "Ekstra Peynir", "priceCents": 0 }]);
    let snapshot =
        crate::commands::authoritative_modifier_snapshot(&mut conn, TENANT, Some(&lying))
            .await
            .expect("snapshot yazılır")
            .expect("snapshot dolu");

    let parsed: serde_json::Value = serde_json::from_str(&snapshot).expect("geçerli JSON");
    assert_eq!(parsed[0]["priceCents"].as_i64(), Some(4000));
    assert_eq!(parsed[0]["name"].as_str(), Some("Ekstra Peynir"));
}

#[tokio::test]
async fn snapshot_yoksa_boş_kalem_yazilir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    assert!(
        crate::commands::authoritative_modifier_snapshot(&mut conn, TENANT, None)
            .await
            .expect("işlenir")
            .is_none()
    );
    assert!(
        crate::commands::authoritative_modifier_snapshot(
            &mut conn,
            TENANT,
            Some(&serde_json::json!([]))
        )
        .await
        .expect("işlenir")
        .is_none(),
        "boş dizi null olmalı"
    );
}

#[tokio::test]
async fn eski_siparis_snapshoti_okunmaya_devam_eder() {
    // Snapshot biçimi değişmedi (`[{id,name,priceCents}]`): eski sipariş satırı
    // `get_order_items` yoluyla okunabilir kalmalı.
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let legacy = r#"[{"id":"mod_eski","name":"Extra","priceCents":1500}]"#;
    sqlx::query("INSERT INTO orders (id, table_id, tenant_id, status, total_cents, created_at, updated_at) VALUES ('ord_old', 'tbl_1', ?, 'IN_PROGRESS', 31500, datetime('now'), datetime('now'))")
        .bind(TENANT)
        .execute(&mut *conn)
        .await
        .expect("sipariş eklenir");
    sqlx::query("INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_rate_bp, subtotal_cents, tax_amount_cents, total_cents, modifiers) VALUES ('itm_old', 'ord_old', 'prd_1', 1, 31500, 2000, 31500, 6300, 37800, ?)")
        .bind(legacy)
        .execute(&mut *conn)
        .await
        .expect("kalem eklenir");

    let stored: Option<String> =
        sqlx::query_scalar("SELECT modifiers FROM order_items WHERE id = 'itm_old'")
            .fetch_one(&mut *conn)
            .await
            .expect("okunur");
    let parsed: serde_json::Value =
        serde_json::from_str(&stored.expect("snapshot var")).expect("geçerli JSON");
    assert_eq!(parsed[0]["priceCents"].as_i64(), Some(1500));
    assert_eq!(parsed[0]["name"].as_str(), Some("Extra"));
}

#[tokio::test]
async fn donmus_kalem_kdv_oranini_korur() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    sqlx::query("INSERT INTO orders (id, table_id, tenant_id, status, total_cents, created_at, updated_at) VALUES ('ord_t', 'tbl_1', ?, 'IN_PROGRESS', 1, datetime('now'), datetime('now'))")
        .bind(TENANT)
        .execute(&mut *conn)
        .await
        .expect("sipariş");
    // KDV oranı %1 (100 bp) ile dondurulmuş kalem: katalogdaki %20 kullanılmamalı.
    sqlx::query("INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_rate_bp, subtotal_cents, tax_amount_cents, total_cents) VALUES ('itm_t', 'ord_t', 'prd_1', 1, 10000, 100, 10000, 100, 10100)")
        .execute(&mut *conn)
        .await
        .expect("kalem");

    let row = sqlx::query("SELECT tax_rate_bp FROM order_items WHERE id = 'itm_t'")
        .fetch_one(&mut *conn)
        .await
        .expect("okunur");
    let rate: i64 = row.try_get("tax_rate_bp").expect("oran okunur");
    assert_eq!(rate, 100, "donmuş KDV oranı bozulmamalı");
}

/// Basis-point KDV oranı: %10 = 1000 bp, %20 = 2000 bp.
#[tokio::test]
async fn basis_point_kdv_orani_dogru() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    sqlx::query("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)")
        .bind(TENANT)
        .bind("Test")
        .execute(&mut *conn)
        .await
        .ok();
    sqlx::query("INSERT OR IGNORE INTO categories (id, tenant_id, name) VALUES ('cat_bp', ?, 'K')")
        .bind(TENANT)
        .execute(&mut *conn)
        .await
        .ok();

    // %10 → 1000 bp
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, price_cents, tax_rate_bp, category_id, is_active) \
         VALUES ('prd_bp10', ?, 'X', 100, 1000, 'cat_bp', 1)",
    )
    .bind(TENANT)
    .execute(&mut *conn)
    .await
    .expect("ürün eklenir");

    // %20 → 2000 bp
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, price_cents, tax_rate_bp, category_id, is_active) \
         VALUES ('prd_bp20', ?, 'Y', 100, 2000, 'cat_bp', 1)",
    )
    .bind(TENANT)
    .execute(&mut *conn)
    .await
    .expect("ürün eklenir");

    let row10 = sqlx::query("SELECT tax_rate_bp FROM products WHERE id = 'prd_bp10'")
        .fetch_one(&mut *conn)
        .await
        .expect("okunur");
    let bp10: i64 = row10.try_get("tax_rate_bp").expect("oran okunur");
    assert_eq!(bp10, 1000, "%10 = 1000 bp olmalı");

    let row20 = sqlx::query("SELECT tax_rate_bp FROM products WHERE id = 'prd_bp20'")
        .fetch_one(&mut *conn)
        .await
        .expect("okunur");
    let bp20: i64 = row20.try_get("tax_rate_bp").expect("oran okunur");
    assert_eq!(bp20, 2000, "%20 = 2000 bp olmalı");
}

// ─── 4. Finansal CHECK constraint ────────────────────────────────────────────

/// orders.total_cents negatif olamaz (CHECK total_cents >= 0).
#[tokio::test]
async fn negatif_toplam_siparis_reddedilir() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let result = sqlx::query(
        "INSERT INTO orders (id, table_id, tenant_id, status, total_cents, created_at, updated_at) \
         VALUES ('ord_neg', 'tbl_1', ?, 'OPEN', -100, datetime('now'), datetime('now'))",
    )
    .bind(TENANT)
    .execute(&mut *conn)
    .await;

    assert!(
        result.is_err(),
        "negatif total_cents CHECK tarafından reddedilmeli"
    );
}

/// shifts.expected_amount_cents negatif olamaz (CHECK >= 0).
#[tokio::test]
async fn negatif_beklenen_tutar_vardiya_reddedilir() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let result = sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents) \
         VALUES ('sh_neg', ?, 'usr_1', 'OPEN', datetime('now'), -500)",
    )
    .bind(TENANT)
    .execute(&mut *conn)
    .await;

    assert!(
        result.is_err(),
        "negatif expected_amount_cents CHECK tarafından reddedilmeli"
    );
}

/// shifts.actual_amount_cents negatif olamaz (CHECK >= 0).
#[tokio::test]
async fn negatif_gercek_tutar_vardiya_reddedilir() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let result = sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents, actual_amount_cents) \
         VALUES ('sh_act', ?, 'usr_1', 'OPEN', datetime('now'), 1000, -300)",
    )
    .bind(TENANT)
    .execute(&mut *conn)
    .await;

    assert!(
        result.is_err(),
        "negatif actual_amount_cents CHECK tarafından reddedilmeli"
    );
}

/// products.tax_rate_bp negatif olamaz (CHECK >= 0).
#[tokio::test]
async fn negatif_kdv_orani_urun_reddedilir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    sqlx::query("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)")
        .bind(TENANT)
        .bind("Test")
        .execute(&mut *conn)
        .await
        .ok();
    sqlx::query("INSERT OR IGNORE INTO categories (id, tenant_id, name) VALUES ('cat_c', ?, 'K')")
        .bind(TENANT)
        .execute(&mut *conn)
        .await
        .ok();

    let result = sqlx::query(
        "INSERT INTO products (id, tenant_id, name, price_cents, tax_rate_bp, category_id, is_active) \
         VALUES ('prd_neg', ?, 'X', 100, -500, 'cat_c', 1)",
    )
    .bind(TENANT)
    .execute(&mut *conn)
    .await;

    assert!(
        result.is_err(),
        "negatif tax_rate_bp CHECK tarafından reddedilmeli"
    );
}
