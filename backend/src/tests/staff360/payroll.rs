use super::*;
// ---------------------------------------------------------------------------
// Maaş
// ---------------------------------------------------------------------------

#[tokio::test]
async fn sabit_maas_modeli_temiz_hesaplanir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "FIXED".into(),
            base_salary_cents: 25_000,
            commission_percent: 0,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
            pay_period: "MONTHLY".to_string(),
        },
    )
    .await
    .expect("kural");

    let runs = payroll_service::run_payroll(&p, "tenant_a", "MONTHLY", "2026-03", true)
        .await
        .expect("bordro");
    assert_eq!(runs.len(), 1);
    let a = runs[0].amounts.as_ref().expect("sahip tutarı görmeli");
    assert_eq!(a.base_cents, 25_000);
    assert_eq!(a.gross_cents, 25_000);
    assert_eq!(a.net_cents, 25_000);
    assert!(runs[0].warning.is_none(), "temiz hesapta uyarı olmamalı");
}

#[tokio::test]
async fn saatlik_model_kapanmis_vardiye_saati_uzerinden_hesaplanir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "CASHIER").await;
    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, closed_at, expected_amount_cents)
         VALUES ('shf_1','tenant_a','usr_1','CLOSED', '2026-03-10 09:00:00', '2026-03-10 17:00:00', 0)",
    )
    .execute(&p)
    .await
    .expect("vardiya");

    payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "HOURLY".into(),
            base_salary_cents: 0,
            commission_percent: 0,
            hourly_rate_cents: 500,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
            pay_period: "MONTHLY".to_string(),
        },
    )
    .await
    .expect("kural");

    let runs = payroll_service::run_payroll(&p, "tenant_a", "MONTHLY", "2026-03", true)
        .await
        .expect("bordro");
    let saat = runs[0].amounts.as_ref().expect("tutar").hourly_cents;
    // 8 saatlik vardiya, saat 500 kuruş → ~4.000 kuruş. Küçük zaman farkı
    // toleransı: yuvarlama 4.000 ± 10 aralığında olmalı.
    assert!(
        (3_990..=4_010).contains(&saat),
        "8 saat × 500 kuruş ≈ 4.000, gelen {saat}"
    );
}

#[tokio::test]
async fn müdür_maas_tutarini_gormez() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "FIXED".into(),
            base_salary_cents: 25_000,
            commission_percent: 0,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
            pay_period: "MONTHLY".to_string(),
        },
    )
    .await
    .expect("kural");

    // Müdür görünümü: kural ve model görünür, tutar `None`.
    let kurallar = payroll_service::list_rules(&p, "tenant_a", false)
        .await
        .expect("kurallar");
    assert_eq!(kurallar.len(), 1, "müdür kural listesini görebilmeli");
    assert_eq!(
        kurallar[0].base_salary_cents, 0,
        "gizli görünümde tutar sıfırlanır"
    );
    assert!(kurallar[0].base_salary_cents == 0);

    let bordro = payroll_service::run_payroll(&p, "tenant_a", "MONTHLY", "2026-03", false)
        .await
        .expect("bordro");
    assert!(
        bordro[0].amounts.is_none(),
        "müdüre maaş tutarı sızdı — `None` olmalıydı"
    );
    // Kişi, model ve dönem görünür: müdür planı anlayabilmeli.
    assert_eq!(bordro[0].full_name, "Ayşe");
    assert_eq!(bordro[0].model, "FIXED");
}

#[tokio::test]
async fn gecersiz_maas_modeli_reddedilir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    let sonuc = payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "HEDIYE".into(),
            base_salary_cents: 1_000,
            commission_percent: 0,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
            pay_period: "MONTHLY".to_string(),
        },
    )
    .await;
    assert!(sonuc.is_err(), "bilinmeyen model sessizce kabul edilmemeli");
}

#[tokio::test]
async fn bordro_olmayan_calisan_icin_hata_verir() {
    let p = pool().await;
    let sonuc = payroll_service::run_payroll(&p, "tenant_a", "MONTHLY", "2026-03", true).await;
    assert!(sonuc.is_err(), "kural yokken bordro \"0 kişi\" dönmemeli");
}

#[tokio::test]
async fn maas_kurali_baska_kiraciya_yazilamaz() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    let sonuc = payroll_service::set_rule(
        &p,
        "tenant_b",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "FIXED".into(),
            base_salary_cents: 1_000,
            commission_percent: 0,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
            pay_period: "MONTHLY".to_string(),
        },
    )
    .await;
    assert!(sonuc.is_err(), "başka kiracının çalışanına maaş yazılamaz");
}

#[tokio::test]
async fn ayni_donem_bordro_yeniden_hesaplanabilir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "FIXED".into(),
            base_salary_cents: 25_000,
            commission_percent: 0,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
            pay_period: "MONTHLY".to_string(),
        },
    )
    .await
    .expect("kural");
    payroll_service::run_payroll(&p, "tenant_a", "MONTHLY", "2026-03", true)
        .await
        .expect("bordro");
    // Maaş değişti: yeniden hesapta tek satır kalmalı, ikiye katlanmamalı.
    payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "FIXED".into(),
            base_salary_cents: 30_000,
            commission_percent: 0,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
            pay_period: "MONTHLY".to_string(),
        },
    )
    .await
    .expect("kural");
    payroll_service::run_payroll(&p, "tenant_a", "MONTHLY", "2026-03", true)
        .await
        .expect("bordro");

    let satir: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM payroll_runs WHERE tenant_id = 'tenant_a' AND user_id = 'usr_1' AND period = '2026-03'",
    )
    .fetch_one(&p)
    .await
    .expect("say");
    assert_eq!(satir, 1, "her hesapta yeni satır açılmamalı (UPSERT)");
    let brut: i64 = sqlx::query_scalar(
        "SELECT gross_cents FROM payroll_runs WHERE tenant_id = 'tenant_a' AND user_id = 'usr_1'",
    )
    .fetch_one(&p)
    .await
    .expect("brüt");
    assert_eq!(brut, 30_000, "güncel maaş uygulanmamış");
}

#[tokio::test]
async fn haftalik_hakedis_yalniz_haftalik_kisiyi_hesaplar_avansi_tarihten_duser() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    kullanici(&p, "tenant_a", "usr_2", "Can", "WAITER").await;
    for (user, period) in [("usr_1", "WEEKLY"), ("usr_2", "MONTHLY")] {
        payroll_service::set_rule(
            &p,
            "tenant_a",
            &PayrollRuleInput {
                user_id: user.into(),
                model: "FIXED".into(),
                base_salary_cents: 70_000,
                commission_percent: 0,
                hourly_rate_cents: 0,
                tip_multiplier_percent: 100,
                profit_share_percent: 0,
                pay_period: period.to_string(),
            },
        )
        .await
        .expect("kural");
    }
    // Aynı ayın ayrı haftalarında iki avans: yalnız kendi haftasındaki düşer.
    for (id, day) in [("adv_1", "2026-11-03"), ("adv_2", "2026-11-12")] {
        sqlx::query(
            "INSERT INTO staff_advances (id, tenant_id, user_id, period, amount_cents, expense_id, actor_id, created_at)
             VALUES (?, 'tenant_a', 'usr_1', '2026-11', 10000, 'exp', 'usr_p', ?)",
        )
        .bind(id)
        .bind(day)
        .execute(&p)
        .await
        .expect("avans");
    }
    let runs = payroll_service::run_payroll(&p, "tenant_a", "WEEKLY", "2026-11-02", true)
        .await
        .expect("bordro");
    assert_eq!(runs.len(), 1, "aylık kişi haftalık hesaba girmez");
    assert_eq!(runs[0].period, "W2026-11-02");
    let amounts = runs[0].amounts.as_ref().expect("tutar");
    assert_eq!(
        (amounts.deduction_cents, amounts.net_cents),
        (10_000, 60_000)
    );
}

#[tokio::test]
async fn komisyon_ve_kar_payi_modeli_reddedilir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    for model in ["COMMISSION", "PROFIT_SHARE"] {
        let sonuc = payroll_service::set_rule(
            &p,
            "tenant_a",
            &PayrollRuleInput {
                user_id: "usr_1".into(),
                model: model.into(),
                base_salary_cents: 1_000,
                commission_percent: 0,
                hourly_rate_cents: 0,
                tip_multiplier_percent: 100,
                profit_share_percent: 0,
                pay_period: "MONTHLY".to_string(),
            },
        )
        .await;
        assert!(sonuc.is_err(), "{model} artık kabul edilmemeli");
    }
    // Eski istemcinin gönderdiği yüzde sabit modelde de sessizce yutulmaz.
    let sonuc = payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "FIXED".into(),
            base_salary_cents: 1_000,
            commission_percent: 10,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
            pay_period: "MONTHLY".to_string(),
        },
    )
    .await;
    assert!(sonuc.is_err(), "komisyon yüzdesi reddedilmeli");
}

#[tokio::test]
async fn eski_komisyon_kurali_satis_okumadan_sabit_hesaplanir() {
    let p = pool().await;
    kasa(&p, "tenant_a", "tbl_1").await;
    urun(&p, "tenant_a", "a").await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    siparis(
        &p,
        "tenant_a",
        "ord_1",
        "usr_1",
        "usr_1",
        20_000,
        "PAID",
        "2026-03-10 12:00:00",
    )
    .await;
    // Yükseltme öncesi kural: komisyon %10 ve kâr payı %5.
    sqlx::query(
        "INSERT INTO payroll_rules (id, tenant_id, user_id, model, base_salary_cents,
             commission_percent, profit_share_percent)
         VALUES ('prl_1', 'tenant_a', 'usr_1', 'COMMISSION', 25000, 10, 5)",
    )
    .execute(&p)
    .await
    .expect("eski kural");
    sqlx::raw_sql(include_str!(
        "../../../migrations/0017_fixed_instead_of_commission.sql"
    ))
    .execute(&p)
    .await
    .expect("0017");
    let kural: (String, i64, i64, i64) = sqlx::query_as(
        "SELECT model, base_salary_cents, commission_percent, profit_share_percent
           FROM payroll_rules WHERE tenant_id = 'tenant_a' AND user_id = 'usr_1'",
    )
    .fetch_one(&p)
    .await
    .expect("kural");
    assert_eq!(kural, ("FIXED".to_string(), 25_000, 0, 0));

    let runs = payroll_service::run_payroll(&p, "tenant_a", "MONTHLY", "2026-03", true)
        .await
        .expect("bordro");
    let a = runs[0].amounts.as_ref().expect("tutar");
    assert_eq!((a.commission_cents, a.profit_share_cents), (0, 0));
    assert_eq!(
        a.gross_cents, 25_000,
        "satış bordroya prim olarak girmemeli"
    );
}
