//! Personel hesabı testleri: accrual.

use super::*;

#[tokio::test]
async fn gece_yarisini_asan_vardiya_tam_sure_ve_baslangic_gunuyle_hesaplanir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let id = night_settlement(&mut conn).await;
    let s = get(&mut conn, TENANT, &id, true).await.expect("hesap");
    assert_eq!(s.kind, "HOURLY");
    assert_eq!(s.work_date, "2026-11-09", "vardiya başladığı güne yazılır");
    assert_eq!(s.worked_seconds, 27_000);
    assert_eq!(s.earned_cents, Some(112_500));
    assert_eq!(s.remaining_cents, Some(112_500));
    assert_eq!(s.status, "UNPAID");
}

#[tokio::test]
async fn saat_ucreti_sabit_yedi_bucuk_saate_degil_gercek_sureye_bagli() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    rule(&mut conn, "usr_ali", "HOURLY", "WEEKLY", 0, 20_000).await;
    // Dört saat çalışıldı: sabit 7,5 saat varsayımı olsaydı 1.500 TL çıkardı.
    let accrual = close_session(
        &mut conn,
        "wks_short",
        "usr_ali",
        "2026-11-10T10:00:00Z",
        "2026-11-10T14:00:00Z",
        0,
    )
    .await;
    let s = get(
        &mut conn,
        TENANT,
        &accrual.settlement_id.expect("hesap"),
        true,
    )
    .await
    .expect("hesap");
    assert_eq!(s.earned_cents, Some(80_000));
}

#[tokio::test]
async fn gunluk_ucret_saatten_bagimsizdir_ve_gun_basina_tek_hesap_acilir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    rule(&mut conn, "usr_ayse", "FIXED", "DAILY", 100_000, 0).await;
    let first = close_session(
        &mut conn,
        "wks_a",
        "usr_ayse",
        "2026-11-10T08:00:00Z",
        "2026-11-10T11:00:00Z",
        0,
    )
    .await;
    let s = get(
        &mut conn,
        TENANT,
        &first.settlement_id.expect("hesap"),
        true,
    )
    .await
    .expect("hesap");
    assert_eq!((s.kind.as_str(), s.earned_cents), ("DAILY", Some(100_000)));
    // Aynı gün ikinci kayıt ikinci günlük ücret üretmez.
    let second = close_session(
        &mut conn,
        "wks_b",
        "usr_ayse",
        "2026-11-10T15:00:00Z",
        "2026-11-10T17:00:00Z",
        0,
    )
    .await;
    assert!(second.settlement_id.is_none());
    assert!(second.note.is_some_and(|note| note.contains("zaten")));
    assert_eq!(
        count(&mut conn, "SELECT COUNT(*) FROM staff_settlements").await,
        1
    );
}

#[tokio::test]
async fn donemlik_kural_ve_kuralsiz_personel_cikista_ucret_uretmez() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    rule(&mut conn, "usr_ali", "FIXED", "MONTHLY", 3_000_000, 0).await;
    let monthly = close_session(
        &mut conn,
        "wks_m",
        "usr_ali",
        "2026-11-10T08:00:00Z",
        "2026-11-10T16:00:00Z",
        0,
    )
    .await;
    assert!(monthly.settlement_id.is_none() && monthly.note.is_some());
    let none = close_session(
        &mut conn,
        "wks_n",
        "usr_ayse",
        "2026-11-10T08:00:00Z",
        "2026-11-10T16:00:00Z",
        0,
    )
    .await;
    assert!(none.settlement_id.is_none() && none.note.is_some());
    assert_eq!(
        count(&mut conn, "SELECT COUNT(*) FROM staff_settlements").await,
        0
    );
}

#[tokio::test]
async fn odenmedi_ya_da_yanitsiz_kalan_ucret_borc_olur_ve_hicbir_para_yazilmaz() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    night_settlement(&mut conn).await;
    let debts = debts(&mut conn, TENANT, true).await.expect("borç");
    assert_eq!(debts.len(), 1);
    assert_eq!(debts[0].remaining_cents, Some(112_500));
    assert_eq!(debts[0].open_count, 1);
    // Ödenmiş sayılmadı: gider, kasa hareketi ve ödeme satırı yok.
    assert_eq!(
        count(&mut conn, "SELECT COUNT(*) FROM general_expenses").await,
        0
    );
    assert_eq!(
        count(&mut conn, "SELECT COUNT(*) FROM cash_movements").await,
        0
    );
    assert_eq!(
        count(&mut conn, "SELECT COUNT(*) FROM staff_settlement_payments").await,
        0
    );
    // Tutar görünürlüğü kapısı: göremeyen çağırana sıfır değil bilinmiyor döner.
    let hidden = debts_hidden(&mut conn).await;
    assert_eq!(hidden, None);
}

async fn debts_hidden(conn: &mut SqliteConnection) -> Option<i64> {
    debts(conn, TENANT, false).await.expect("borç")[0].remaining_cents
}

#[tokio::test]
async fn odeme_almis_cikis_hesabi_degistirilemez_odenmemis_yeniden_hesaplanir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    open_shift(&mut conn).await;
    let id = night_settlement(&mut conn).await;
    // Ödenmemiş hesap: çıkış düzeltmesi tutarı yeniden hesaplar.
    let edited = close_session(
        &mut conn,
        "wks_night",
        "usr_ali",
        "2026-11-09T22:00:00+03:00",
        "2026-11-10T05:00:00+03:00",
        0,
    )
    .await;
    assert_eq!(edited.settlement_id.as_deref(), Some(id.as_str()));
    let s = get(&mut conn, TENANT, &id, true).await.expect("hesap");
    assert_eq!(s.earned_cents, Some(105_000));
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    pay_as(
        &mut conn,
        &lock,
        "OWNER",
        None,
        &id,
        5_000,
        "BANK_TRANSFER",
        "r1",
    )
    .await
    .expect("ödeme");
    let start = shift_math::parse_instant("2026-11-09T22:00:00+03:00", "g").expect("g");
    let error = accrue_on_close(
        &mut conn,
        TENANT,
        &ClosedSession {
            id: "wks_night",
            user_id: "usr_ali",
            work_date: &shift_math::work_date(&start),
            worked_seconds: 3_600,
        },
        "usr_owner",
        NOW,
    )
    .await
    .expect_err("ödemeli hesap");
    assert!(error.starts_with("CONFLICT"), "{error}");
}

#[tokio::test]
async fn cikista_hesaplanan_kayit_bordroda_ikinci_kez_sayilmaz() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    night_settlement(&mut conn).await;
    rule(&mut conn, "usr_ayse", "HOURLY", "WEEKLY", 0, 15_000).await;
    // Hesap kesilmemiş ikinci kişinin kaydı bordroya girer.
    sqlx::query(
        "INSERT INTO staff_work_sessions (id, tenant_id, user_id, started_at, ended_at, break_minutes,
             status, created_by, updated_by, created_at, updated_at)
         VALUES ('wks_free', ?, 'usr_ayse', '2026-11-10T08:00:00Z', '2026-11-10T10:00:00Z', 0,
                 'CLOSED', 'x', 'x', ?, ?)",
    )
    .bind(TENANT)
    .bind(NOW)
    .bind(NOW)
    .execute(&mut *conn)
    .await
    .expect("kayıt");
    drop(conn);
    let ali = payroll_hours::worked_seconds(
        &pool,
        TENANT,
        "usr_ali",
        "2026-11-02",
        "2026-11-15T23:59:59",
    )
    .await
    .expect("ali");
    let ayse = payroll_hours::worked_seconds(
        &pool,
        TENANT,
        "usr_ayse",
        "2026-11-02",
        "2026-11-15T23:59:59",
    )
    .await
    .expect("ayşe");
    assert_eq!(ali, 0, "çıkışta hesaplanan kayıt bordrodan düşer");
    assert_eq!(ayse, 7_200);
}

#[tokio::test]
async fn gunluk_ucretli_personelin_hesaplanan_gunu_bordroda_tabani_tekrar_yazmaz() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    rule(&mut conn, "usr_ayse", "FIXED", "DAILY", 100_000, 0).await;
    close_session(
        &mut conn,
        "wks_a",
        "usr_ayse",
        "2026-11-10T08:00:00+03:00",
        "2026-11-10T16:00:00+03:00",
        0,
    )
    .await;
    drop(conn);
    let runs = payroll_service::run_payroll(&pool, TENANT, "DAILY", "2026-11-10", true)
        .await
        .expect("bordro");
    let amounts = runs[0].amounts.as_ref().expect("tutar");
    assert_eq!((amounts.base_cents, amounts.net_cents), (0, 0));
    assert!(runs[0]
        .warning
        .as_deref()
        .is_some_and(|w| w.contains("cikista")));
    // Hesaplanmayan gün bordroda normal taban yazar.
    let other = payroll_service::run_payroll(&pool, TENANT, "DAILY", "2026-11-11", true)
        .await
        .expect("bordro");
    assert_eq!(
        other[0].amounts.as_ref().expect("tutar").base_cents,
        100_000
    );
}
