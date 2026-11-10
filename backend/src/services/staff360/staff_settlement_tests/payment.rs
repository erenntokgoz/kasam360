//! Personel hesabı testleri: payment.

use super::*;

#[tokio::test]
async fn kismi_odeme_kasadan_duser_bakiye_negatife_inebilir_kalan_borc_korunur() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    open_shift(&mut conn).await;
    let id = night_settlement(&mut conn).await;
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);

    let paid = pay_as(
        &mut conn, &lock, "OWNER", None, &id, 40_000, "CASH", "req_1",
    )
    .await
    .expect("kısmi ödeme");
    assert_eq!(paid.remaining_cents, 72_500);
    assert!(!paid.replayed);
    let s = get(&mut conn, TENANT, &id, true).await.expect("hesap");
    assert_eq!(s.status, "PARTIAL");
    assert_eq!(s.paid_cents, Some(40_000));
    assert_eq!(s.remaining_cents, Some(72_500));
    assert_eq!(
        count(
            &mut conn,
            "SELECT SUM(amount_cents) FROM cash_movements WHERE movement_type = 'OUT'"
        )
        .await,
        40_000
    );
    // Açılış nakdi sıfırdı: ödeme reddedilmedi, beklenen kasa negatife indi.
    let calc = crate::commands::cashier_commands::calculate_expected_shift_balance(
        &mut conn,
        TENANT,
        "shf_a",
        "2026-11-10 06:00:00",
        None,
        0,
    )
    .await
    .expect("kasa");
    assert_eq!(calc.expected_balance, -40_000);
    let open = debts(&mut conn, TENANT, true).await.expect("borç");
    assert_eq!(open[0].remaining_cents, Some(72_500));
}

#[tokio::test]
async fn sonradan_odeme_ayni_gideri_ikinci_kez_yazmaz() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    open_shift(&mut conn).await;
    let id = night_settlement(&mut conn).await;
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);

    // Çıkışta ödenmedi; sonra tamamı ödenir: tam bir gider, tam bir kasa çıkışı.
    let later = pay_as(
        &mut conn,
        &lock,
        "OWNER",
        None,
        &id,
        112_500,
        "CASH",
        "req_later",
    )
    .await
    .expect("sonradan ödeme");
    assert_eq!(later.remaining_cents, 0);
    let expenses = "SELECT COUNT(*) FROM general_expenses WHERE category = 'STAFF_PAY'";
    assert_eq!(count(&mut conn, expenses).await, 1);
    assert_eq!(
        count(
            &mut conn,
            "SELECT COUNT(*) FROM cash_movements WHERE movement_type = 'OUT'"
        )
        .await,
        1
    );

    // Aynı istek tekrar (çift tıklama, yeniden deneme): yeni kayıt yok, aynı gider döner.
    let replay = pay_as(
        &mut conn,
        &lock,
        "OWNER",
        None,
        &id,
        112_500,
        "CASH",
        "req_later",
    )
    .await
    .expect("tekrar");
    assert!(replay.replayed);
    assert_eq!(replay.expense_id, later.expense_id);
    assert_eq!(count(&mut conn, expenses).await, 1);
    assert_eq!(
        count(&mut conn, "SELECT COUNT(*) FROM staff_settlement_payments").await,
        1
    );
    assert_eq!(
        count(
            &mut conn,
            "SELECT COUNT(*) FROM cash_movements WHERE movement_type = 'OUT'"
        )
        .await,
        1
    );

    // Yeni istek kimliğiyle fazla ödeme: borç kapandı, reddedilir ve yazılmaz.
    let over = pay_as(&mut conn, &lock, "OWNER", None, &id, 1, "CASH", "req_over")
        .await
        .expect_err("borç kapalı");
    assert!(over.starts_with("CONFLICT"), "{over}");
    assert_eq!(count(&mut conn, expenses).await, 1);
    // Aynı istek kimliği başka tutarla gelirse sessizce kabul edilmez.
    let mismatch = pay_as(&mut conn, &lock, "OWNER", None, &id, 5, "CASH", "req_later")
        .await
        .expect_err("kimlik başka ödemeye ait");
    assert!(mismatch.starts_with("CONFLICT"), "{mismatch}");
}

#[tokio::test]
async fn kismi_ve_sonraki_odemeler_toplamda_ucreti_asmaz_ve_gider_toplami_odemeye_esittir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    open_shift(&mut conn).await;
    let id = night_settlement(&mut conn).await;
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    pay_as(&mut conn, &lock, "OWNER", None, &id, 40_000, "CASH", "r1")
        .await
        .expect("1");
    pay_as(
        &mut conn,
        &lock,
        "OWNER",
        None,
        &id,
        72_500,
        "BANK_TRANSFER",
        "r2",
    )
    .await
    .expect("2");
    let s = get(&mut conn, TENANT, &id, true).await.expect("hesap");
    assert_eq!((s.status.as_str(), s.remaining_cents), ("PAID", Some(0)));
    assert_eq!(
        count(
            &mut conn,
            "SELECT SUM(amount_cents) FROM general_expenses WHERE category = 'STAFF_PAY'"
        )
        .await,
        112_500
    );
    // Havale kasaya dokunmaz; yalnız nakit kısım kasa çıkışıdır.
    assert_eq!(
        count(
            &mut conn,
            "SELECT SUM(amount_cents) FROM cash_movements WHERE movement_type = 'OUT'"
        )
        .await,
        40_000
    );
    assert!(debts(&mut conn, TENANT, true)
        .await
        .expect("borç")
        .is_empty());
}

#[tokio::test]
async fn acik_vardiya_yoksa_nakit_odeme_reddedilir_ve_hicbir_sey_yazilmaz() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    let id = night_settlement(&mut conn).await;
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    let error = pay_as(&mut conn, &lock, "OWNER", None, &id, 10_000, "CASH", "r1")
        .await
        .expect_err("vardiya yok");
    assert!(error.starts_with("SHIFT_REQUIRED"), "{error}");
    assert_eq!(
        count(&mut conn, "SELECT COUNT(*) FROM general_expenses").await,
        0
    );
    assert_eq!(
        count(&mut conn, "SELECT COUNT(*) FROM staff_settlement_payments").await,
        0
    );
}

#[tokio::test]
async fn gecersiz_tutar_kanal_ve_istek_kimligi_reddedilir() {
    let pool = pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı");
    open_shift(&mut conn).await;
    let id = night_settlement(&mut conn).await;
    let mutex = tokio::sync::Mutex::new(());
    let lock = AuditLock::new(mutex.lock().await);
    for (amount, method, request) in [
        (0, "CASH", "r"),
        (-5, "CASH", "r"),
        (100, "CREDIT_CARD", "r"),
        (100, "CASH", "  "),
        (112_501, "CASH", "r"),
    ] {
        assert!(
            pay_as(&mut conn, &lock, "OWNER", None, &id, amount, method, request)
                .await
                .is_err(),
            "{amount} {method} {request}"
        );
    }
    assert_eq!(
        count(&mut conn, "SELECT COUNT(*) FROM general_expenses").await,
        0
    );
}

#[tokio::test]
async fn migration_0019_eski_gider_satirlarini_korur_ve_personel_odemesi_kategorisini_acar() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("havuz");
    sqlx::raw_sql(
        "CREATE TABLE directories (id TEXT PRIMARY KEY);
         CREATE TABLE general_expenses (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
            category TEXT NOT NULL CHECK(category IN ('RENT', 'UTILITIES', 'SUPPLIER', 'STAFF_ADVANCE', 'TAX', 'PERSONAL', 'MAINTENANCE', 'OTHER')),
            amount_cents INTEGER NOT NULL,
            payment_method TEXT NOT NULL CHECK(payment_method IN ('CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'VERESIYE')),
            directory_id TEXT, shift_id TEXT, actor_id TEXT NOT NULL, description TEXT,
            expense_date DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, recurring_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
            FOREIGN KEY (directory_id) REFERENCES directories(id)
         );
         INSERT INTO general_expenses (id, tenant_id, category, amount_cents, payment_method, actor_id)
            VALUES ('exp_1', 'tnt_a', 'RENT', 250000, 'BANK_TRANSFER', 'usr_owner');",
    )
    .execute(&pool)
    .await
    .expect("eski tablo");
    let before: Result<_, _> = sqlx::query(
        "INSERT INTO general_expenses (id, tenant_id, category, amount_cents, payment_method, actor_id)
         VALUES ('exp_x', 'tnt_a', 'STAFF_PAY', 1, 'CASH', 'u')",
    )
    .execute(&pool)
    .await;
    assert!(before.is_err(), "eski şema yeni kategoriyi kabul etmemeli");
    sqlx::raw_sql(include_str!(
        "../../../../migrations/0019_staff_pay_category.sql"
    ))
    .execute(&pool)
    .await
    .expect("migration");
    let kept: i64 =
        sqlx::query_scalar("SELECT amount_cents FROM general_expenses WHERE id = 'exp_1'")
            .fetch_one(&pool)
            .await
            .expect("korunan satır");
    assert_eq!(kept, 250_000);
    sqlx::query(
        "INSERT INTO general_expenses (id, tenant_id, category, amount_cents, payment_method, actor_id)
         VALUES ('exp_2', 'tnt_a', 'STAFF_PAY', 1, 'CASH', 'u')",
    )
    .execute(&pool)
    .await
    .expect("yeni kategori");
}
