//! İptal edilen ve düzeltilen fire kaydının düzeltme raporuna yansıması.

use super::super::*;
use super::common::*;

#[tokio::test]
async fn iptal_edilen_fire_sayilmaz_duzeltilenin_son_tutari_gecer() {
    let pool = pool().await;
    seed_tenant(&pool, TENANT_A).await;
    let payload = |cents: i64| serde_json::json!({ "totalCostCents": cents });
    let olaylar = [
        (
            1,
            "stok:waste_recorded",
            "wst_a",
            1000,
            "2026-03-05 10:00:00",
        ),
        (
            2,
            "stok:waste_recorded",
            "wst_b",
            2000,
            "2026-03-05 11:00:00",
        ),
        (
            3,
            "stok:waste_recorded",
            "wst_c",
            3000,
            "2026-03-05 12:00:00",
        ),
        (4, "stok:waste_voided", "wst_a", 1000, "2026-03-06 10:00:00"),
        (5, "stok:waste_edited", "wst_b", 1500, "2026-03-06 11:00:00"),
    ];
    for (sira, eylem, kayit, tutar, zaman) in olaylar {
        seed_audit(
            &pool,
            TENANT_A,
            sira,
            eylem,
            kayit,
            "usr_o",
            &payload(tutar),
            zaman,
        )
        .await;
    }

    let mut conn = conn_of(&pool).await;
    let report = adjustments_report(&mut conn, TENANT_A, &range(ARALIK.0, ARALIK.1))
        .await
        .expect("rapor okunur");

    let mut tutarlar: Vec<(String, i64)> = report
        .rows
        .iter()
        .filter(|r| r.kind == "WASTE")
        .map(|r| (r.resource_id.clone(), r.amount_cents))
        .collect();
    tutarlar.sort();
    assert_eq!(
        tutarlar,
        vec![("wst_b".to_string(), 1500), ("wst_c".to_string(), 3000)]
    );
}
