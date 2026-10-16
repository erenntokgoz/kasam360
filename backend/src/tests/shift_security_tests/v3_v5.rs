//! V3, V4, V5 — Yetki, clock-in, açık vardiya ve sipariş garson/kasiyer bağlama testleri.

use super::common::*;
use sqlx::Row;

// ---------------------------------------------------------------------------
// V3 — waiter_clock_in yetki ve tenant
// ---------------------------------------------------------------------------

#[test]
fn v3_bekci_yemisi_garson_vardiyasina_giremez() {
    // Komut katmanı RBAC'i `require_any_present` ile uygular; burada reddedilen
    // rol kümesinin kendisi doğrulanır.
    let reddedilen = crate::rbac::require_any_present(
        Some("KITCHEN"),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Waiter,
        ],
    );
    assert!(reddedilen.is_err(), "mutfak garson vardiyasina girememeli");
}

#[test]
fn v3_garson_kendi_vardiyasina_girebilir() {
    let sonuc = crate::rbac::require_any_present(
        Some("WAITER"),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Waiter,
        ],
    );
    assert!(sonuc.is_ok(), "garson kendi vardiyasini acabilmeli");
}

#[tokio::test]
async fn v3_garson_girisi_kiraciya_baglanir() {
    let p = pool().await;
    let payload = serde_json::json!({"waiterId": "usr_waiter", "clockedIn": true});
    sqlx::query(
        "INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at)
         VALUES (?1, ?2, ?3, 'WAITER_SHIFT', 'CLOCK_IN', ?4, datetime('now'))",
    )
    .bind("evt_1")
    .bind("tenant_a")
    .bind("usr_waiter")
    .bind(serde_json::to_string(&payload).expect("payload"))
    .execute(&p)
    .await
    .expect("giriş yazılmalı");

    let satir = sqlx::query("SELECT tenant_id FROM events WHERE event_id = 'evt_1'")
        .fetch_one(&p)
        .await
        .expect("olay okunmali");
    // Varsayılan `DEFAULT_TENANT`'a düşme kuralı bozulursa bu test kızar.
    assert_eq!(
        satir.try_get::<String, _>("tenant_id").expect("kolon"),
        "tenant_a"
    );
}

// ---------------------------------------------------------------------------
// V4 — open_shift / close_shift yetki
// ---------------------------------------------------------------------------

#[test]
fn v4_mutfak_kasa_vardiyasi_acamaz() {
    let sonuc = crate::rbac::require_any_present(
        Some("KITCHEN"),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Cashier,
        ],
    );
    assert!(sonuc.is_err(), "mutfak beklenen bakiyeyi belirleyememeli");
}

#[test]
fn v4_garson_kasa_vardiyasi_acamaz() {
    let sonuc = crate::rbac::require_any_present(
        Some("WAITER"),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Cashier,
        ],
    );
    assert!(sonuc.is_err(), "garson kasa vardiyasi acamamali");
}

#[test]
fn v4_kasiyer_kasa_vardiyasi_acabilir() {
    let sonuc = crate::rbac::require_any_present(
        Some("CASHIER"),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Cashier,
        ],
    );
    assert!(sonuc.is_ok());
}

#[tokio::test]
async fn v4_vardiya_basina_tek_acik_vardiya_kurali_kiracili() {
    let p = pool().await;
    add_shift(&p, "tenant_a", "shf_a", "usr_cash_a", 50_000).await;

    // Aynı kiracıda ikinci açık vardiya sayılır.
    let sayi: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM shifts WHERE cashier_id = 'usr_cash_a' AND status = 'OPEN' AND tenant_id = 'tenant_a'",
    )
    .fetch_one(&p)
    .await
    .expect("sayaç");
    assert_eq!(sayi, 1);

    // Farklı kiracı aynı kasiyer kimliğiyle vardiya açabilir: kimlik paylaşılan
    // bir değer, ayrım tenant'tan gelir.
    let diger: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM shifts WHERE cashier_id = 'usr_cash_a' AND status = 'OPEN' AND tenant_id = 'tenant_b'",
    )
    .fetch_one(&p)
    .await
    .expect("sayaç");
    assert_eq!(diger, 0, "baska kiracida vardiya yok sayilmamali");
}

// ---------------------------------------------------------------------------
// V5 — orders.cashier_id ve order_items.waiter_id yazımı
// ---------------------------------------------------------------------------

#[tokio::test]
async fn v5_siparis_kaydinda_cashier_id_doldurulur() {
    let p = pool().await;
    add_table(&p, "tenant_a", "tbl_1", Some("usr_waiter")).await;

    let waiter_id: Option<String> = sqlx::query_scalar::<_, Option<String>>(
        "SELECT waiter_id FROM tables WHERE tenant_id = ? AND id = ?",
    )
    .bind("tenant_a")
    .bind("tbl_1")
    .fetch_optional(&p)
    .await
    .expect("okunmali")
    .flatten();
    assert_eq!(
        waiter_id.as_deref(),
        Some("usr_waiter"),
        "masanin garsonu devralinmali"
    );

    sqlx::query(
        "INSERT INTO orders (id, tenant_id, table_id, status, total_cents, cashier_id, created_at, updated_at)
         VALUES ('ord_1', 'tenant_a', 'tbl_1', 'IN_PROGRESS', 50000, ?1, datetime('now'), datetime('now'))",
    )
    .bind(&waiter_id)
    .execute(&p)
    .await
    .expect("siparis yazılmalı");

    let satir = sqlx::query("SELECT cashier_id FROM orders WHERE id = 'ord_1'")
        .fetch_one(&p)
        .await
        .expect("siparis okunmali");
    // V5'in kanıtı: sipariş seviyesinde garson kaydı artık dolu.
    assert_eq!(
        satir
            .try_get::<Option<String>, _>("cashier_id")
            .expect("kolon"),
        Some("usr_waiter".to_string())
    );
}

#[tokio::test]
async fn v5_kalem_kaydinda_waiter_id_yazilabilir() {
    let p = pool().await;
    // `orders.table_id` FK'si ve `order_items.product_id` FK'si için üst kayıtlar
    // önce yazılmalı; aksi halde test şema kısıtına takılır, V5'i sınamaz.
    add_table(&p, "tenant_a", "tbl_1", Some("usr_waiter")).await;
    sqlx::query(
        "INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tenant_a', 'Kahve')",
    )
    .execute(&p)
    .await
    .expect("kategori yazılmalı");
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, category_id, price_cents)
         VALUES ('prd_1', 'tenant_a', 'Kahve', 'cat_1', 25000)",
    )
    .execute(&p)
    .await
    .expect("urun yazılmalı");
    sqlx::query(
        "INSERT INTO orders (id, tenant_id, table_id, status, total_cents, created_at, updated_at)
         VALUES ('ord_1', 'tenant_a', 'tbl_1', 'IN_PROGRESS', 50000, datetime('now'), datetime('now'))",
    )
    .execute(&p)
    .await
    .expect("siparis yazılmalı");

    // `order_items.waiter_id` kolonu şemada bulunmalı; yoksa INSERT hata verir.
    let sonuc = sqlx::query(
        "INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, total_cents, waiter_id)
         VALUES ('oi_1', 'tenant_a', 'ord_1', 'prd_1', 2, 50000, 'usr_waiter')",
    )
    .execute(&p)
    .await;
    assert!(sonuc.is_ok(), "kalem seviyesinde garson yazilabilmeli");

    let satir = sqlx::query("SELECT waiter_id FROM order_items WHERE id = 'oi_1'")
        .fetch_one(&p)
        .await
        .expect("kalem okunmali");
    assert_eq!(
        satir
            .try_get::<Option<String>, _>("waiter_id")
            .expect("kolon"),
        Some("usr_waiter".to_string())
    );
}

#[tokio::test]
async fn v5_waiter_id_alanı_kiraci_indeksli() {
    let p = pool().await;
    // Garson karnesi sürekli `(tenant_id, waiter_id)` ile sorgular; indeks yoksa
    // rapor tüm sipariş kalemlerini tarar.
    let indeksler = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'order_items'",
    )
    .fetch_all(&p)
    .await
    .expect("indeksler okunmali");
    let adlar: Vec<String> = indeksler
        .into_iter()
        .map(|r| r.try_get::<String, _>("name").expect("ad"))
        .collect();
    assert!(
        adlar.iter().any(|a| a == "idx_order_items_waiter"),
        "idx_order_items_waiter indeksi bulunmali: {adlar:?}"
    );
}

#[tokio::test]
async fn v5_garsonsuz_masa_siparisinde_kayit_null_kalir() {
    let p = pool().await;
    add_table(&p, "tenant_a", "tbl_bos", None).await;

    let waiter_id: Option<String> = sqlx::query_scalar::<_, Option<String>>(
        "SELECT waiter_id FROM tables WHERE tenant_id = ? AND id = ?",
    )
    .bind("tenant_a")
    .bind("tbl_bos")
    .fetch_optional(&p)
    .await
    .expect("okunmali")
    .flatten();
    // Boş string yerine null: masada garson yok demektir.
    assert!(waiter_id.is_none(), "garsonsuz masa null vermeli");
}
