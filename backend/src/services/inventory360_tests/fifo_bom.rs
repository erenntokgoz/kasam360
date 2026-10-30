//! BOM Reçeteli Ürünler için FIFO Stok Düşümü Regresyon Testi.

use super::recipes::{malzeme, recete_girdisi, recete_olustur};
use super::support::*;
use crate::commands::CartItemDto;
use crate::services::inventory_service::InventoryService;

const KIRACI: &str = "tnt_fifo_bom";

#[tokio::test]
async fn recete_kilogram_stok_gram_satis_fifo_miktarini_cevirir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, KIRACI, "prd_bread", "Ekmek", 1000).await;
    urun_ekle(&mut conn, KIRACI, "prd_flour", "Un", 0).await;
    sqlx::query("UPDATE products SET stock_unit = 'g' WHERE tenant_id = ? AND id = 'prd_flour'")
        .bind(KIRACI)
        .execute(&mut conn)
        .await
        .unwrap();
    parti_ekle(&mut conn, KIRACI, "bat_flour", "prd_flour", 2000.0, 1, None).await;
    recete_olustur(
        &mut conn,
        KIRACI,
        recete_girdisi(
            "prd_bread",
            "Ekmek",
            100.0,
            1.0,
            vec![malzeme("prd_flour", 1.5, "kg", None)],
        ),
    )
    .await;
    let cart = CartItemDto {
        id: "itm_1".into(),
        product: serde_json::json!({"id": "prd_bread"}),
        quantity: 1,
        ..Default::default()
    };
    let result = InventoryService::execute_fifo_deduction(
        &mut conn,
        KIRACI,
        "txn_unit",
        &[cart],
        "2026-10-30T00:00:00Z",
    )
    .await
    .unwrap();
    assert_eq!(result.total_cogs_cents, 1500);
    let remaining: f64 = sqlx::query_scalar(
        "SELECT remaining_quantity FROM inventory_batches WHERE tenant_id = ? AND id = 'bat_flour'",
    )
    .bind(KIRACI)
    .fetch_one(&mut conn)
    .await
    .unwrap();
    assert_eq!(remaining, 500.0);
}

#[tokio::test]
async fn bom_receteli_urun_fifo_bilesenlerden_duser_ve_maliyeti_hesaplar() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;

    // 1. Ürünler: Menü ürünü (prd_latte) ve iki hammadde (prd_beans, prd_milk)
    urun_ekle(&mut conn, KIRACI, "prd_latte", "Latte", 6500).await;
    urun_ekle(&mut conn, KIRACI, "prd_beans", "Kahve Çekirdeği", 0).await;
    urun_ekle(&mut conn, KIRACI, "prd_milk", "Süt", 0).await;

    // 2. Hammadde Partileri (inventory_batches):
    // prd_beans için iki parti (en eski 15 g @ 5 kuruş, yeni 50 g @ 8 kuruş)
    parti_ekle(&mut conn, KIRACI, "bat_beans_1", "prd_beans", 15.0, 5, None).await;
    parti_ekle(&mut conn, KIRACI, "bat_beans_2", "prd_beans", 50.0, 8, None).await;
    // prd_milk için tek parti (500 ml @ 2 kuruş)
    parti_ekle(&mut conn, KIRACI, "bat_milk_1", "prd_milk", 500.0, 2, None).await;

    // 3. Menü ürünü için aktif reçete:
    // output_quantity = 1.0, yield_percent = 100.0
    // Çekirdek: quantity = 18.0, waste_percent = 10.0 -> İhtiyaç: 18.0 / (1 - 0.10) = 20.0 g
    // Süt: quantity = 200.0, waste_percent = 0.0 -> İhtiyaç: 200.0 ml
    recete_olustur(
        &mut conn,
        KIRACI,
        recete_girdisi(
            "prd_latte",
            "Latte Standart",
            100.0,
            1.0,
            vec![
                malzeme("prd_beans", 18.0, "g", Some(10.0)),
                malzeme("prd_milk", 200.0, "ml", None),
            ],
        ),
    )
    .await;

    // 4. execute_fifo_deduction çağır: 1 adet Latte satışı
    let cart_item = CartItemDto {
        id: "itm_1".into(),
        product: serde_json::json!({ "id": "prd_latte" }),
        quantity: 1,
        ..Default::default()
    };

    let result = InventoryService::execute_fifo_deduction(
        &mut conn,
        KIRACI,
        "txn_bom_01",
        &[cart_item],
        "2026-10-16T12:00:00Z",
    )
    .await
    .expect("FIFO stok düşümü başarılı olmalı");

    // 5. Doğrulamalar:
    // Çekirdek 20g ihtiyacı: 15g * 5 kuruş = 75 kuruş, 5g * 8 kuruş = 40 kuruş -> Toplam 115 kuruş.
    // Süt 200ml ihtiyacı: 200ml * 2 kuruş = 400 kuruş.
    // Toplam COGS = 115 + 400 = 515 kuruş.
    assert_eq!(result.total_cogs_cents, 515, "COGS doğru hesaplanmalı");
    assert_eq!(
        result.untracked_deficit, 0.0,
        "Karşılanamayan açık 0 olmalı"
    );

    // Partilerin kalan miktarlarını kontrol et
    let b1_rem: f64 = sqlx::query_scalar(
        "SELECT remaining_quantity FROM inventory_batches WHERE id = 'bat_beans_1'",
    )
    .fetch_one(&mut conn)
    .await
    .expect("b1_rem");
    assert!(
        (b1_rem - 0.0).abs() < 1e-6,
        "bat_beans_1 tamamen tüketilmeli"
    );

    let b2_rem: f64 = sqlx::query_scalar(
        "SELECT remaining_quantity FROM inventory_batches WHERE id = 'bat_beans_2'",
    )
    .fetch_one(&mut conn)
    .await
    .expect("b2_rem");
    assert!(
        (b2_rem - 45.0).abs() < 1e-6,
        "bat_beans_2'den 5g düşülüp 45g kalmalı"
    );

    let m_rem: f64 = sqlx::query_scalar(
        "SELECT remaining_quantity FROM inventory_batches WHERE id = 'bat_milk_1'",
    )
    .fetch_one(&mut conn)
    .await
    .expect("m_rem");
    assert!(
        (m_rem - 300.0).abs() < 1e-6,
        "bat_milk_1'den 200ml düşülüp 300ml kalmalı"
    );

    let legacy_stock: Option<i64> = sqlx::query_scalar(
        "SELECT stock_quantity FROM products WHERE id = 'prd_beans' AND tenant_id = ?",
    )
    .bind(KIRACI)
    .fetch_one(&mut conn)
    .await
    .expect("eski kolon okunmalı");
    assert_eq!(
        legacy_stock, None,
        "satış eski stok kolonunu değiştirmemeli"
    );

    // prd_latte'nin kendisi için doğrudan parti aranmadığını doğrula
    let latte_batches: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM inventory_batches WHERE product_id = 'prd_latte'")
            .fetch_one(&mut conn)
            .await
            .expect("latte_batches");
    assert_eq!(latte_batches, 0, "Latte kendisi doğrudan parti tüketmemeli");

    // Allocation olayının aggregate_type = 'INVENTORY_ALLOCATION' olarak yazıldığını doğrula
    let event_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE aggregate_type = 'INVENTORY_ALLOCATION' AND tenant_id = ?",
    )
    .bind(KIRACI)
    .fetch_one(&mut conn)
    .await
    .expect("event_count");
    assert_eq!(event_count, 1, "FIFO düşüm olayı kaydedilmeli");
}
