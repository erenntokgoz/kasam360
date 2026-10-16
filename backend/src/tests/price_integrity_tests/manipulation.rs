//! İstemci fiyat manipülasyonu ve çift sayım testleri.

use super::common::*;
use crate::repositories::payment_repository::PaymentRepository;
use crate::services::modifier_service;

// ─── 1. İstemci fiyatı manipülasyonu ────────────────────────────────────────

/// İstemci ekstre ücretini `0` göndererek ödemekten kaçamaz.
#[tokio::test]
async fn istemci_sifir_fiyat_gondererek_ekstre_ucretinden_kacamaz() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let option_id = seed_option(&pool, "Ekstra Peynir", 4000).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    // İstemci yalan söylüyor: gerçek fiyat farkı 4000 kuruş.
    let cheating =
        serde_json::json!([{ "id": option_id, "name": "Ekstra Peynir", "priceCents": 0 }]);
    let truth = PaymentRepository::calculate_server_truth(
        &mut conn,
        TENANT,
        &[item("itm_1", Some(cheating))],
        None,
    )
    .await
    .expect("sunucu hesabı");

    // 34000 brüt + %20 KDV = 40800
    assert_eq!(truth.gross_cents, 34000, "ürün 300 TL + ekstra 40 TL");
    assert_eq!(
        truth.total_cents, 40800,
        "istemcinin 0 fiyatı geçerli olmamalı"
    );
}

#[tokio::test]
async fn istemci_fiyati_asiri_yuksek_gonderemez() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let option_id = seed_option(&pool, "Ekstra Peynir", 4000).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let inflated =
        serde_json::json!([{ "id": option_id, "name": "Ekstra Peynir", "priceCents": 999_000 }]);
    let truth = PaymentRepository::calculate_server_truth(
        &mut conn,
        TENANT,
        &[item("itm_1", Some(inflated))],
        None,
    )
    .await
    .expect("sunucu hesabı");

    assert_eq!(truth.gross_cents, 34000, "fiyat veritabanından gelmeli");
}

#[tokio::test]
async fn baska_tenantin_secenegi_fiyatlandirilamaz() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    sqlx::query("INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant_b', 'Başka')")
        .execute(&pool)
        .await
        .expect("tenant eklenir");

    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    let group_b =
        modifier_service::create_group(&mut conn, "tenant_b", "B Grubu", false, 0, None, None)
            .await
            .expect("B grubu");
    let option_b =
        modifier_service::add_option(&mut conn, "tenant_b", &group_b, "B Seçeneği", 1000)
            .await
            .expect("B seçeneği");
    drop(conn);

    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    let foreign = serde_json::json!([{ "id": option_b, "name": "B Seçeneği", "priceCents": 0 }]);
    let outcome = PaymentRepository::calculate_server_truth(
        &mut conn,
        TENANT,
        &[item("itm_1", Some(foreign))],
        None,
    )
    .await;
    let err: String = match outcome {
        Ok(_) => panic!("çapraz tenant seçeneği reddedilmeliydi"),
        Err(e) => e,
    };
    assert!(err.contains("MALICIOUS_INPUT"), "beklenen hata: {}", err);
}

// ─── 2. Çift sayım ─────────────────────────────────────────────────────────

/// Sipariş satırı donmuş fiyat içerdiğinde aynı ekstra ikinci kez eklenmez.
///
/// `submit_order` `unit_price_cents`'i modifier **dahil** dondurur. Ödeme
/// sırasında aynı kalem tekrar hesaplanırken donmuş değerin üzerine modifier
/// eklenirse müşteri iki kez ücretlendirilir.
#[tokio::test]
async fn donmus_fiyat_modifieri_iki_kez_eklemez() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let option_id = seed_option(&pool, "Ekstra Peynir", 4000).await;

    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    // `submit_order` kalemi: 30000 + 4000 = 34000 dondurulmuş.
    sqlx::query("INSERT INTO orders (id, table_id, tenant_id, status, total_cents, created_at, updated_at) VALUES ('ord_1', 'tbl_1', ?, 'IN_PROGRESS', 34000, datetime('now'), datetime('now'))")
        .bind(TENANT)
        .execute(&mut *conn)
        .await
        .expect("sipariş eklenir");
    sqlx::query("INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_rate_bp, subtotal_cents, tax_amount_cents, total_cents) VALUES ('itm_1', 'ord_1', 'prd_1', 1, 34000, 2000, 34000, 6800, 40800)")
        .execute(&mut *conn)
        .await
        .expect("kalem eklenir");

    let selected =
        serde_json::json!([{ "id": option_id, "name": "Ekstra Peynir", "priceCents": 4000 }]);
    let truth = PaymentRepository::calculate_server_truth(
        &mut conn,
        TENANT,
        &[item("itm_1", Some(selected))],
        None,
    )
    .await
    .expect("sunucu hesabı");

    assert_eq!(
        truth.gross_cents, 34000,
        "çift sayım: 34000 + 4000 = 38000 olmamalı"
    );
    assert_eq!(truth.total_cents, 40800);
}

#[tokio::test]
async fn donmus_fiyat_yoksa_modifier_bir_kez_eklenir() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let option_id = seed_option(&pool, "Ekstra Peynir", 4000).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let selected =
        serde_json::json!([{ "id": option_id, "name": "Ekstra Peynir", "priceCents": 4000 }]);
    let truth = PaymentRepository::calculate_server_truth(
        &mut conn,
        TENANT,
        &[item("itm_1", Some(selected))],
        None,
    )
    .await
    .expect("sunucu hesabı");
    assert_eq!(truth.gross_cents, 34000, "ürün + tek ekstra");
}

#[tokio::test]
async fn donmus_fiyat_baska_tenantin_kaleminden_alinmaz() {
    let pool = pool().await;
    seed_catalog(&pool, 30000).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    sqlx::query("INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant_b', 'Başka')")
        .execute(&mut *conn)
        .await
        .ok();
    sqlx::query("INSERT INTO orders (id, table_id, tenant_id, status, total_cents, created_at, updated_at) VALUES ('ord_x', 'tbl_1', 'tenant_b', 'IN_PROGRESS', 1, datetime('now'), datetime('now'))")
        .execute(&mut *conn)
        .await
        .expect("sipariş eklenir");
    sqlx::query("INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_rate_bp, subtotal_cents, tax_amount_cents, total_cents) VALUES ('itm_x', 'ord_x', 'prd_1', 1, 1, 0, 1, 0, 1)")
        .execute(&mut *conn)
        .await
        .expect("kalem eklenir");
    drop(conn);

    let mut conn = pool.acquire().await.expect("bağlantı alınır");
    let truth =
        PaymentRepository::calculate_server_truth(&mut conn, TENANT, &[item("itm_x", None)], None)
            .await
            .expect("sunucu hesabı");
    assert_eq!(
        truth.gross_cents, 30000,
        "başka işletmenin donmuş fiyatı kullanılmamalı"
    );
}
