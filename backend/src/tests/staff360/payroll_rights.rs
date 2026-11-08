//! Hak ediş kanıtları: bahşiş çarpanı, saat karşılığı, saatlik hak ediş, izin ve avans.

use super::*;
use crate::services::expense_service::{correct_staff_advance, record_staff_advance};
use crate::services::staff360::payroll_hours;

async fn kural(p: &SqlitePool, user: &str, model: &str, base: i64, rate: i64, period: &str) {
    payroll_service::set_rule(
        p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: user.into(),
            model: model.into(),
            base_salary_cents: base,
            commission_percent: 0,
            hourly_rate_cents: rate,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
            pay_period: period.to_string(),
        },
    )
    .await
    .expect("kural");
}

async fn izin(p: &SqlitePool, id: &str, kind: &str, from: &str, to: &str) {
    sqlx::query(
        "INSERT INTO leave_requests
             (id, tenant_id, user_id, kind, start_date, end_date, status, created_at)
         VALUES (?, 'tenant_a', 'usr_1', ?, ?, ?, 'Onaylandi', '2026-01-01')",
    )
    .bind(id)
    .bind(kind)
    .bind(from)
    .bind(to)
    .execute(p)
    .await
    .expect("izin");
}

async fn net_ve_kesinti(p: &SqlitePool, period: &str) -> (i64, i64) {
    let runs = payroll_service::run_payroll(p, "tenant_a", "MONTHLY", period, true)
        .await
        .expect("bordro");
    let a = runs[0].amounts.as_ref().expect("tutar");
    (a.deduction_cents, a.net_cents)
}

#[tokio::test]
async fn bahsis_carpani_yalniz_carpani_yazar_kural_yoksa_anlasilir_hata_verir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    kullanici(&p, "tenant_a", "usr_2", "Can", "WAITER").await;
    kural(&p, "usr_1", "TIP", 2_000_000, 0, "MONTHLY").await;

    payroll_service::set_tip_multiplier(&p, "tenant_a", "usr_1", 150)
        .await
        .expect("çarpan");
    let rules = payroll_service::list_rules(&p, "tenant_a", true)
        .await
        .expect("kurallar");
    assert_eq!(rules[0].tip_multiplier_percent, 150);
    assert_eq!(rules[0].base_salary_cents, 2_000_000, "maaş değişmemeli");

    let yok = payroll_service::set_tip_multiplier(&p, "tenant_a", "usr_2", 100)
        .await
        .expect_err("kural yok");
    assert!(yok.contains("maaş kuralı yok"), "{yok}");
    assert!(
        payroll_service::set_tip_multiplier(&p, "tenant_a", "usr_1", 501)
            .await
            .is_err()
    );
    assert!(
        payroll_service::set_tip_multiplier(&p, "tenant_b", "usr_1", 100)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn ucret_kuralini_sahip_yazar_mudur_tutarlari_gorur() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    kural(&p, "usr_1", "FIXED", 3_000_000, 0, "MONTHLY").await;
    let sahip = payroll_service::list_rules(&p, "tenant_a", true)
        .await
        .expect("kurallar");
    let mudur = payroll_service::list_rules(&p, "tenant_a", false)
        .await
        .expect("kurallar");
    assert_eq!(sahip[0].base_salary_cents, 3_000_000);
    assert_eq!(mudur[0].base_salary_cents, 3_000_000);
}

#[tokio::test]
async fn saatlik_hak_edis_icinde_bulunulan_haftanin_kapanmis_vardiyasindan_gelir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "CASHIER").await;
    kural(&p, "usr_1", "HOURLY", 0, 20_000, "WEEKLY").await;
    sqlx::raw_sql(
        "INSERT INTO staff_work_sessions (id, tenant_id, user_id, started_at, ended_at, break_minutes, status, created_by, updated_by, created_at, updated_at)
         VALUES ('wks_1','tenant_a','usr_1','2026-11-03T09:00:00Z','2026-11-03T16:30:00Z',30,'CLOSED','usr_owner','usr_owner','2026-11-03','2026-11-03'),
                ('wks_2','tenant_a','usr_1','2026-10-30T09:00:00Z','2026-10-30T17:00:00Z',0,'CLOSED','usr_owner','usr_owner','2026-10-30','2026-10-30'),
                ('wks_3','tenant_a','usr_1','2026-11-04T09:00:00Z',NULL,0,'OPEN','usr_owner','usr_owner','2026-11-04','2026-11-04');",
    )
    .execute(&p)
    .await
    .expect("vardiya");
    let today = chrono::NaiveDate::from_ymd_opt(2026, 11, 4).expect("tarih");

    let sahip = payroll_hours::current_earnings(&p, "tenant_a", "usr_1", today, true)
        .await
        .expect("hak ediş");
    assert_eq!(sahip.period, "W2026-11-02");
    // Yalnız bu haftanın kapanmış fiili oturumu: 7 saat × 200 TL = 1.400 TL.
    assert_eq!(sahip.worked_seconds, 25_200);
    assert_eq!(
        sahip.earned_cents, None,
        "saat karşılığı kişi kartında gösterilmez"
    );
    assert_eq!(sahip.hourly_rate_cents, None);
    assert_eq!(sahip.source, payroll_hours::HOURS_SOURCE);

    let mudur = payroll_hours::current_earnings(&p, "tenant_a", "usr_1", today, false)
        .await
        .expect("hak ediş");
    assert_eq!(
        mudur.worked_seconds, 25_200,
        "çalışma süresi müdüre görünür"
    );
    assert_eq!((mudur.hourly_rate_cents, mudur.earned_cents), (None, None));

    let runs = payroll_service::run_payroll(&p, "tenant_a", "WEEKLY", "2026-11-02", true)
        .await
        .expect("bordro");
    assert_eq!(runs[0].worked_seconds, 25_200);
    assert_eq!(
        runs[0].amounts.as_ref().expect("tutar").hourly_cents,
        140_000
    );

    kullanici(&p, "tenant_a", "usr_2", "Can", "WAITER").await;
    kural(&p, "usr_2", "FIXED", 100, 0, "MONTHLY").await;
    assert!(
        payroll_hours::current_earnings(&p, "tenant_a", "usr_2", today, true)
            .await
            .is_err(),
        "sabit maaşlıya saatlik hak ediş hesaplanmaz"
    );
}

#[tokio::test]
async fn ucretli_izin_kesmez_ucretsiz_izin_ay_sinirinda_kendi_gunleriyle_keser() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    kural(&p, "usr_1", "FIXED", 3_000_000, 0, "MONTHLY").await;
    for (id, kind) in [
        ("lve_y", "YILLIK"),
        ("lve_h", "HASTALIK"),
        ("lve_m", "MAZERET"),
    ] {
        let day = match kind {
            "YILLIK" => "2026-10-05",
            "HASTALIK" => "2026-10-12",
            _ => "2026-10-19",
        };
        izin(&p, id, kind, day, day).await;
    }
    assert_eq!(
        net_ve_kesinti(&p, "2026-10").await,
        (0, 3_000_000),
        "ücretli izin kesinti yapmamalı"
    );

    // 30 Ekim - 2 Kasım: Ekim'e 2, Kasım'a 2 gün düşer; her gün taban/30.
    izin(&p, "lve_u", "UCRETSIZ", "2026-10-30", "2026-11-02").await;
    assert_eq!(net_ve_kesinti(&p, "2026-10").await, (200_000, 2_800_000));
    assert_eq!(net_ve_kesinti(&p, "2026-11").await, (200_000, 2_800_000));
}

#[tokio::test]
async fn havale_avansi_kasaya_dokunmaz_nakit_avans_acik_vardiyadan_duser() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    kural(&p, "usr_1", "FIXED", 3_000_000, 0, "MONTHLY").await;
    let mut conn = p.acquire().await.expect("bağlantı");

    let kasasiz = record_staff_advance(
        &mut conn,
        "tenant_a",
        "usr_1",
        "2026-10",
        50_000,
        "CASH",
        "usr_p",
        "2026-10-10",
    )
    .await
    .expect_err("nakit avans açık vardiya ister");
    assert!(kasasiz.contains("SHIFT_REQUIRED"), "{kasasiz}");

    record_staff_advance(
        &mut conn,
        "tenant_a",
        "usr_1",
        "2026-10",
        100_000,
        "BANK_TRANSFER",
        "usr_p",
        "2026-10-10",
    )
    .await
    .expect("havale avansı");
    let hareket: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cash_movements")
        .fetch_one(&mut *conn)
        .await
        .expect("sayım");
    assert_eq!(hareket, 0, "havale kasa hareketi yazmamalı");

    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents)
         VALUES ('shf_1','tenant_a','usr_p','OPEN',datetime('now','-1 hour'),500000)",
    )
    .execute(&mut *conn)
    .await
    .expect("vardiya");
    record_staff_advance(
        &mut conn,
        "tenant_a",
        "usr_1",
        "2026-10",
        50_000,
        "CASH",
        "usr_p",
        "2026-10-11",
    )
    .await
    .expect("nakit avans");
    let cikis: (String, i64) =
        sqlx::query_as("SELECT movement_type, amount_cents FROM cash_movements")
            .fetch_one(&mut *conn)
            .await
            .expect("kasa hareketi");
    assert_eq!(cikis, ("OUT".to_string(), 50_000));

    let kategori: Vec<String> =
        sqlx::query_scalar("SELECT category FROM general_expenses WHERE tenant_id = 'tenant_a'")
            .fetch_all(&mut *conn)
            .await
            .expect("gider");
    assert_eq!(kategori, vec!["STAFF_ADVANCE", "STAFF_ADVANCE"]);
    assert!(record_staff_advance(
        &mut conn,
        "tenant_a",
        "usr_1",
        "2026-10",
        1,
        "CARD",
        "usr_p",
        "2026-10-11",
    )
    .await
    .is_err());
    drop(conn);

    // Avans personelden alacaktır: aralıklı ve aralıksız P&L'de gider sayılmaz.
    for range in [
        None,
        Some(("2026-10-01".to_string(), "2026-10-31".to_string())),
    ] {
        let rapor = crate::services::pnl_service::financial_report(&p, "tenant_a", &range)
            .await
            .expect("P&L");
        assert_eq!(rapor.total_expenses_cents, 0);
        assert!(
            rapor
                .expenses_by_category
                .iter()
                .all(|row| row.category != "STAFF_ADVANCE"),
            "avans kategori dökümüne girmemeli: {range:?}"
        );
    }
    assert_eq!(net_ve_kesinti(&p, "2026-10").await, (150_000, 2_850_000));
}

#[tokio::test]
async fn avans_duzeltmesi_tek_kesinti_birakir_basarisizsa_eskisi_kalir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    kural(&p, "usr_1", "FIXED", 3_000_000, 0, "MONTHLY").await;
    let mut conn = p.acquire().await.expect("bağlantı");
    record_staff_advance(
        &mut conn,
        "tenant_a",
        "usr_1",
        "2026-10",
        100_000,
        "BANK_TRANSFER",
        "usr_p",
        "2026-10-10",
    )
    .await
    .expect("avans");
    let eski: String = sqlx::query_scalar("SELECT expense_id FROM staff_advances")
        .fetch_one(&mut *conn)
        .await
        .expect("avans");
    drop(conn);

    // Yeni kayıt reddedilirse iptal de geri alınır: iki işlem tek bütündür.
    let mut tx = p.begin().await.expect("işlem");
    assert!(correct_staff_advance(
        &mut tx,
        "tenant_a",
        &eski,
        "2026-10",
        80_000,
        "CARD",
        "usr_p",
        "2026-10-12",
    )
    .await
    .is_err());
    drop(tx);
    assert_eq!(net_ve_kesinti(&p, "2026-10").await, (100_000, 2_900_000));

    let mut tx = p.begin().await.expect("işlem");
    correct_staff_advance(
        &mut tx,
        "tenant_a",
        &eski,
        "2026-10",
        80_000,
        "BANK_TRANSFER",
        "usr_p",
        "2026-10-12",
    )
    .await
    .expect("düzeltme");
    tx.commit().await.expect("commit");
    let kalan: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM staff_advances")
        .fetch_one(&p)
        .await
        .expect("sayım");
    assert_eq!(kalan, 1, "düzeltme ikinci avans bırakmamalı");
    assert_eq!(net_ve_kesinti(&p, "2026-10").await, (80_000, 2_920_000));
    assert!(correct_staff_advance(
        &mut p.acquire().await.expect("bağlantı"),
        "tenant_b",
        &eski,
        "2026-10",
        1,
        "BANK_TRANSFER",
        "usr_p",
        "2026-10-12",
    )
    .await
    .is_err());
}
