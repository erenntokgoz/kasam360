//! Stok ekranı başka işletmenin partilerini veya tükenen lotları göstermez.

use super::support::{conn_of, parti_ekle, test_pool, urun_ekle};
use crate::services::inventory360::stock::list_stock_batches;
use crate::services::inventory360::{
    cost_for_active_recipe, create_purchase_order, create_recipe, receive_purchase_order,
    suppliers::{PurchaseOrderInput, PurchaseOrderLineInput},
};

#[tokio::test]
async fn stok_partileri_kiraciya_ve_kalan_miktara_gore_listelenir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, "ten_a", "prd_a", "Un", 0).await;
    urun_ekle(&mut conn, "ten_b", "prd_b", "Yağ", 0).await;
    parti_ekle(&mut conn, "ten_a", "bat_a", "prd_a", 3.0, 120, None).await;
    parti_ekle(&mut conn, "ten_b", "bat_b", "prd_b", 5.0, 50, None).await;
    parti_ekle(&mut conn, "ten_a", "bat_bos", "prd_a", 1.0, 200, None).await;
    sqlx::query("UPDATE inventory_batches SET remaining_quantity = 0 WHERE id = 'bat_bos' AND tenant_id = 'ten_a'")
        .execute(&mut conn).await.unwrap();

    let rows = list_stock_batches(&mut conn, "ten_a").await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, "bat_a");
    assert_eq!(rows[0].remaining_quantity, 3.0);
    assert_eq!(rows[0].unit_cost_cents, 120);
}

#[tokio::test]
async fn teslim_alinan_parti_recete_maliyetini_erisilebilir_yapar() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, "ten_a", "prd_yemek", "Yemek", 5000).await;
    urun_ekle(&mut conn, "ten_a", "prd_un", "Un", 0).await;
    let input = super::recipes::recete_girdisi(
        "prd_yemek",
        "Yemek",
        100.0,
        1.0,
        vec![super::recipes::malzeme("prd_un", 1.5, "kg", None)],
    );
    create_recipe(&mut conn, "ten_a", "usr_1", input)
        .await
        .unwrap();
    assert!(cost_for_active_recipe(&mut conn, "ten_a", "prd_yemek")
        .await
        .unwrap()
        .unwrap()
        .unit_cost_cents
        .is_none());

    sqlx::query("INSERT INTO suppliers (id, tenant_id, name, created_by) VALUES ('sup_1', 'ten_a', 'Uncu', 'usr_1')")
        .execute(&mut conn).await.unwrap();
    let order = create_purchase_order(
        &mut conn,
        "ten_a",
        "usr_1",
        PurchaseOrderInput {
            supplier_id: "sup_1".into(),
            order_number: "PO-1".into(),
            expected_at: None,
            notes: None,
            items: vec![PurchaseOrderLineInput {
                product_id: "prd_un".into(),
                quantity: 2.0,
                unit_cost_cents: Some(300),
            }],
        },
    )
    .await
    .unwrap();
    assert_eq!(
        receive_purchase_order(&mut conn, "ten_a", &order.id)
            .await
            .unwrap(),
        600
    );
    let cost = cost_for_active_recipe(&mut conn, "ten_a", "prd_yemek")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(cost.unit_cost_cents, Some(450));
}
