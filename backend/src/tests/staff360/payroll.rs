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
async fn komisyon_kendi_satisindan_hesaplanir() {
    let p = pool().await;
    kasa(&p, "tenant_a", "tbl_1").await;
    urun(&p, "tenant_a", "a").await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    kullanici(&p, "tenant_a", "usr_k", "Kasiyer", "CASHIER").await;
    siparis(
        &p,
        "tenant_a",
        "ord_1",
        "usr_k",
        "usr_1",
        20_000,
        "PAID",
        "2026-03-10 12:00:00",
    )
    .await;
    siparis(
        &p,
        "tenant_a",
        "ord_2",
        "usr_k",
        "usr_1",
        10_000,
        "PAID",
        "2026-03-11 12:00:00",
    )
    .await;

    payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "COMMISSION".into(),
            base_salary_cents: 0,
            commission_percent: 10,
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
    let a = runs[0].amounts.as_ref().expect("tutar");
    // 30.000 kuruş satışın %10'u = 3.000 kuruş.
    assert_eq!(
        a.commission_cents, 3_000,
        "komisyon yanlış tabandan hesaplandı"
    );
    assert_eq!(a.gross_cents, 3_000);
}

#[tokio::test]
async fn komisyon_satis_yoksa_uyari_verir_sifir_yazmaz() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "COMMISSION".into(),
            base_salary_cents: 0,
            commission_percent: 10,
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
    let uyari = runs[0].warning.as_ref().expect("uyari olmalı");
    assert!(uyari.contains("satış kaydı yok"), "uyari metni: {uyari}");
    // Tutar 0 çünkü gerçekten satış yok; ama ekranda "hesaplanmadı" yazar.
    assert_eq!(runs[0].amounts.as_ref().expect("tutar").commission_cents, 0);
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
async fn komisyon_cift_ciro_ve_acik_siparis_sayilmaz() {
    let p = pool().await;
    kasa(&p, "tenant_a", "tbl_1").await;
    urun(&p, "tenant_a", "a").await;
    kullanici(&p, "tenant_a", "usr_comm", "Garson Ali", "WAITER").await;

    payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_comm".into(),
            model: "COMMISSION".into(),
            base_salary_cents: 0,
            commission_percent: 10,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
            pay_period: "MONTHLY".to_string(),
        },
    )
    .await
    .expect("kural");

    // 1. Sipariş: PAID, 20_000 kuruş (cashier_id == waiter_id == usr_comm)
    siparis(
        &p,
        "tenant_a",
        "ord_p1",
        "usr_comm",
        "usr_comm",
        20_000,
        "PAID",
        "2026-03-10 12:00:00",
    )
    .await;

    // 2. Sipariş: IN_PROGRESS, 50_000 kuruş - ciroya katılmamalı
    siparis(
        &p,
        "tenant_a",
        "ord_p2",
        "usr_comm",
        "usr_comm",
        50_000,
        "IN_PROGRESS",
        "2026-03-11 12:00:00",
    )
    .await;

    let runs = payroll_service::run_payroll(&p, "tenant_a", "MONTHLY", "2026-03", true)
        .await
        .expect("bordro");

    assert_eq!(runs.len(), 1);
    let amounts = runs[0].amounts.as_ref().expect("tutarlar");
    // Satış tam 20_000 olmalı; %10 komisyon = 2000 kuruş.
    // 2x sayılmış olsaydı 40_000 -> 4000 çıkardı; IN_PROGRESS katılsaydı 7000+ çıkardı.
    assert_eq!(amounts.gross_cents, 2000, "Komisyon 20_000'in %10'u olmalı");
    assert_eq!(amounts.net_cents, 2000);
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
