use super::*;
// ---------------------------------------------------------------------------
// Şüpheli işlem radarı
// ---------------------------------------------------------------------------

#[tokio::test]
async fn radar_az_orneklemli_iptalde_uyar_uretmez() {
    let p = pool().await;
    kasa(&p, "tenant_a", "tbl_1").await;
    urun(&p, "tenant_a", "a").await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "CASHIER").await;
    // 2 siparişin 2'si de iptal: oran %100 ama örneklem 2 < 5 → uyarı yok.
    siparis(&p, "tenant_a", "ord_1", "usr_1", "usr_1", 10_000, "VOID", "2026-03-10 12:00:00").await;
    siparis(&p, "tenant_a", "ord_2", "usr_1", "usr_1", 10_000, "VOID", "2026-03-11 12:00:00").await;

    let bayrak = suspicious_service::radar(&p, "tenant_a", "2000-01-01", "2100-01-01")
        .await
        .expect("radar");
    assert!(bayrak.is_empty(), "az örneklemli yüksek oran iftira olurdu: {bayrak:?}");
}

#[tokio::test]
async fn radar_yuksek_iptal_oranini_yakinlar() {
    let p = pool().await;
    kasa(&p, "tenant_a", "tbl_1").await;
    urun(&p, "tenant_a", "a").await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "CASHIER").await;
    for i in 1..=4 {
        siparis(&p, "tenant_a", &format!("ord_v{i}"), "usr_1", "usr_1", 10_000, "VOID", "2026-03-10 12:00:00").await;
    }
    for i in 1..=6 {
        siparis(&p, "tenant_a", &format!("ord_p{i}"), "usr_1", "usr_1", 10_000, "PAID", "2026-03-10 12:00:00").await;
    }

    let bayrak = suspicious_service::radar(&p, "tenant_a", "2000-01-01", "2100-01-01")
        .await
        .expect("radar");
    let iptal = bayrak.iter().find(|b| b.rule.contains("iptal")).expect("iptal bayrağı");
    assert_eq!(iptal.measured, "%40", "4/10 iptal = %40");
    assert!(iptal.threshold.contains("asgari 5"), "eşik raporda görünmeli");
}

#[tokio::test]
async fn radar_normal_isletmede_sessiz_kalir() {
    let p = pool().await;
    kasa(&p, "tenant_a", "tbl_1").await;
    urun(&p, "tenant_a", "a").await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "CASHIER").await;
    for i in 1..=20 {
        siparis(&p, "tenant_a", &format!("ord_{i}"), "usr_1", "usr_1", 10_000, "PAID", "2026-03-10 12:00:00").await;
    }
    let bayrak = suspicious_service::radar(&p, "tenant_a", "2000-01-01", "2100-01-01")
        .await
        .expect("radar");
    assert!(bayrak.is_empty(), "sağlıklı işletmede uyarı üretilmemeli: {bayrak:?}");
}

#[tokio::test]
async fn radar_gunluk_onay_yogunlugunu_yakinlar() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "CASHIER").await;
    for gun in 1..=4 {
        for _ in 0..7 {
            sqlx::query(
                "INSERT INTO approvals (id, tenant_id, request_type, resource_id, requester_id, status, payload, created_at)
                 VALUES (?1,'tenant_a','DISCOUNT',?2,'usr_1','APPROVED','{}', ?3)",
            )
            .bind(format!("apr_{gun}_{}", sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM approvals").fetch_one(&p).await.unwrap_or(0)))
            .bind(format!("ord_{gun}"))
            .bind(format!("2026-03-0{gun} 10:00:00"))
            .execute(&p)
            .await
            .expect("onay");
        }
    }
    let bayrak = suspicious_service::radar(&p, "tenant_a", "2026-03-01", "2026-03-31")
        .await
        .expect("radar");
    let onay = bayrak.iter().find(|b| b.rule.contains("onay")).expect("onay bayrağı");
    assert!(onay.measured.contains("7 onay/gun"), "ölçüm: {}", onay.measured);
}

