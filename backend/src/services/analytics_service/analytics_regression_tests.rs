//! Analitik motoru regresyon testleri:
//! 1. VOID hariç tutma (product_margins, combinations, peak_hours, monthly_target_status vs void_loss_rate).
//! 2. average_unit_costs kalan miktar ağırlıklı hesaplama (şişirme engeli).
//! 3. Partisi olmayan reçeteli ürünler için cost_for_active_recipe fallback çözümü.

use sqlx::SqlitePool;

use super::analytics_product::average_unit_costs;
use super::analytics_types::AnalyticsRange;
use crate::services::analytics_service::{
    combinations, monthly_target_status, peak_hours, product_margins, void_loss_rate,
};

async fn test_pool() -> SqlitePool {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("in-memory db");

    let schema = include_str!("../../../migrations/schema.sql");
    sqlx::raw_sql(schema)
        .execute(&pool)
        .await
        .expect("schema.sql uygulanmali");

    pool
}

fn mart_araligi() -> AnalyticsRange {
    Some(("2026-03-01T00:00:00Z".into(), "2026-04-01T00:00:00Z".into()))
}

#[tokio::test]
async fn void_siparisler_ciroya_katilmaz_yalniz_void_loss_rate_gorur() {
    let pool = test_pool().await;
    let tenant = "t_void_reg";

    // Kategori ve hedef
    sqlx::query("INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', ?1, 'İçecek')")
        .bind(tenant)
        .execute(&pool)
        .await
        .expect("kategori");

    sqlx::query(
        "INSERT INTO monthly_targets (id, tenant_id, month, category, target_cents)
         VALUES ('trg_1', ?1, '2026-03', 'İçecek', 20000)",
    )
    .bind(tenant)
    .execute(&pool)
    .await
    .expect("hedef");

    // Ürünler
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, price_cents, category_id, is_active)
         VALUES ('prd_a', ?1, 'Çay', 1000, 'cat_1', 1),
                ('prd_b', ?1, 'Simit', 2000, 'cat_1', 1)",
    )
    .bind(tenant)
    .execute(&pool)
    .await
    .expect("ürünler");

    sqlx::query("INSERT INTO tables (id, tenant_id, name) VALUES ('tbl_1', ?1, 'Masa 1')")
        .bind(tenant)
        .execute(&pool)
        .await
        .expect("masa");

    // PAID sipariş (14:00)
    sqlx::query(
        "INSERT INTO orders (id, tenant_id, table_id, status, total_cents, created_at)
         VALUES ('ord_paid', ?1, 'tbl_1', 'PAID', 3000, '2026-03-10 14:00:00')",
    )
    .bind(tenant)
    .execute(&pool)
    .await
    .expect("paid order");

    sqlx::query(
        "INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, total_cents)
         VALUES ('oi_p1', ?1, 'ord_paid', 'prd_a', 1, 1000),
                ('oi_p2', ?1, 'ord_paid', 'prd_b', 1, 2000)",
    )
    .bind(tenant)
    .execute(&pool)
    .await
    .expect("paid items");

    // VOID sipariş (14:30)
    sqlx::query(
        "INSERT INTO orders (id, tenant_id, table_id, status, total_cents, created_at)
         VALUES ('ord_void', ?1, 'tbl_1', 'VOID', 3000, '2026-03-10 14:30:00')",
    )
    .bind(tenant)
    .execute(&pool)
    .await
    .expect("void order");

    sqlx::query(
        "INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, total_cents)
         VALUES ('oi_v1', ?1, 'ord_void', 'prd_a', 1, 1000),
                ('oi_v2', ?1, 'ord_void', 'prd_b', 1, 2000)",
    )
    .bind(tenant)
    .execute(&pool)
    .await
    .expect("void items");

    let range = mart_araligi();

    // 1. product_margins: Yalnız PAID adet ve ciroyu saymalı
    let margins = product_margins(&pool, tenant, &range)
        .await
        .expect("margins");
    let tea = margins
        .iter()
        .find(|m| m.product_id == "prd_a")
        .expect("çay");
    assert_eq!(tea.units_sold, 1, "VOID adet eklenmemeli");
    assert_eq!(tea.revenue_cents, 1000, "VOID ciro eklenmemeli");

    let bagel = margins
        .iter()
        .find(|m| m.product_id == "prd_b")
        .expect("simit");
    assert_eq!(bagel.units_sold, 1, "VOID adet eklenmemeli");
    assert_eq!(bagel.revenue_cents, 2000, "VOID ciro eklenmemeli");

    // 2. combinations: Yalnız PAID sipariş kombinasyonunu saymalı
    let combos = combinations(&pool, tenant, &range, 1)
        .await
        .expect("combos");
    assert_eq!(combos.len(), 1);
    assert_eq!(
        combos[0].support, 1,
        "VOID kombinasyon desteğine katılmamalı"
    );

    // 3. peak_hours: Yalnız PAID sipariş 14. saat kovasına girmeli
    let peaks = peak_hours(&pool, tenant, &range).await.expect("peaks");
    let h14 = peaks.iter().find(|p| p.hour == 14).expect("14:00 kovası");
    assert_eq!(h14.orders, 1, "VOID sipariş saati sayısına katılmamalı");
    assert_eq!(
        h14.revenue_cents, 3000,
        "VOID sipariş hasılatına katılmamalı"
    );

    // 4. monthly_target_status: Gerçekleşen ciro yalnız PAID olmalı
    let targets = monthly_target_status(&pool, tenant, "2026-03", 0)
        .await
        .expect("targets");
    assert_eq!(targets.len(), 1);
    assert_eq!(
        targets[0].actual_cents, 3000,
        "VOID hedef gerçekleşmesine katılmamalı"
    );

    // 5. void_loss_rate: VOID ve PAID birlikte doğru hesaplanmalı
    let void_stat = void_loss_rate(&pool, tenant, &range)
        .await
        .expect("void_stat");
    assert_eq!(void_stat.voided_cents, 3000, "İptal tutarı 3000 olmalı");
    assert_eq!(
        void_stat.total_cents, 6000,
        "Toplam sipariş havuzu 6000 olmalı"
    );
    assert_eq!(void_stat.voided_orders, 1, "1 iptal sipariş olmalı");
    assert_eq!(void_stat.total_orders, 2, "2 toplam sipariş olmalı");
    assert_eq!(
        void_stat.void_rate_percent,
        Some(50),
        "İptal oranı %50 olmalı"
    );
}

#[tokio::test]
async fn ortalama_maliyet_kalan_miktari_kullanir_sisirme_yapmaz() {
    let pool = test_pool().await;
    let tenant = "t_cost_reg";

    sqlx::query("INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', ?1, 'Test')")
        .bind(tenant)
        .execute(&pool)
        .await
        .expect("kategori");

    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, price_cents, category_id, is_active)
         VALUES ('prd_k', ?1, 'Kahve', 5000, 'cat_1', 1)",
    )
    .bind(tenant)
    .execute(&pool)
    .await
    .expect("ürün");

    // initial_quantity = 100, remaining_quantity = 2, unit_cost_cents = 5000
    // Eski hatalı formül: (100 * 5000) / 2 = 250_000 kuruş (50 kat şişirme)
    // Düzeltilmiş formül: (2 * 5000) / 2 = 5000 kuruş
    sqlx::query(
        "INSERT INTO inventory_batches (id, tenant_id, product_id, initial_quantity, remaining_quantity, unit_cost_cents)
         VALUES ('bat_k1', ?1, 'prd_k', 100.0, 2.0, 5000)",
    )
    .bind(tenant)
    .execute(&pool)
    .await
    .expect("parti");

    let costs = average_unit_costs(&pool, tenant).await.expect("maliyetler");
    let (_, cost) = costs.iter().find(|(pid, _)| pid == "prd_k").expect("prd_k");
    assert_eq!(
        *cost,
        Some(5000),
        "Birim maliyet 5000 kuruş olarak doğru hesaplanmalı"
    );
}

#[tokio::test]
async fn partisi_olmayan_receteli_urun_recete_maliyeti_fallback_alir() {
    let pool = test_pool().await;
    let tenant = "t_recipe_fallback";

    sqlx::query("INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', ?1, 'Unlu')")
        .bind(tenant)
        .execute(&pool)
        .await
        .expect("kategori");

    // prd_kek (menü ürünü - doğrudan partisi YOK)
    // prd_un (hammadde - partisi VAR: 1000g @ 10 kuruş/g)
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, price_cents, category_id, is_active)
         VALUES ('prd_kek', ?1, 'Kek', 8000, 'cat_1', 1),
                ('prd_un', ?1, 'Un', 0, 'cat_1', 1)",
    )
    .bind(tenant)
    .execute(&pool)
    .await
    .expect("ürünler");

    sqlx::query(
        "INSERT INTO inventory_batches (id, tenant_id, product_id, initial_quantity, remaining_quantity, unit_cost_cents)
         VALUES ('bat_un1', ?1, 'prd_un', 1000.0, 1000.0, 10)",
    )
    .bind(tenant)
    .execute(&pool)
    .await
    .expect("un partisi");

    sqlx::query("UPDATE products SET stock_unit = 'g' WHERE tenant_id = ? AND id = 'prd_un'")
        .bind(tenant)
        .execute(&pool)
        .await
        .expect("stok birimi");

    // prd_kek için aktif reçete: 1 adet kek için 100g un gerekir.
    // 100g * 10 kuruş/g = 1000 kuruş birim maliyet.
    sqlx::query(
        "INSERT INTO recipes (id, tenant_id, product_id, name, output_quantity, output_unit, yield_percent, is_active, created_by)
         VALUES ('rcp_kek', ?1, 'prd_kek', 'Kek Reçetesi', 1.0, 'adet', 100.0, 1, 'usr_admin')",
    )
    .bind(tenant)
    .execute(&pool)
    .await
    .expect("reçete");

    sqlx::query(
        "INSERT INTO recipe_items (id, tenant_id, recipe_id, component_product_id, quantity, unit, waste_percent)
         VALUES ('ri_1', ?1, 'rcp_kek', 'prd_un', 100.0, 'g', 0.0)",
    )
    .bind(tenant)
    .execute(&pool)
    .await
    .expect("reçete kalemi");

    let costs = average_unit_costs(&pool, tenant).await.expect("maliyetler");
    let (_, kek_cost) = costs
        .iter()
        .find(|(pid, _)| pid == "prd_kek")
        .expect("prd_kek maliyeti");
    assert_eq!(
        *kek_cost,
        Some(1000),
        "Partisi olmayan kekin maliyeti reçetesinden 1000 kuruş olarak çözülmeli"
    );
}
