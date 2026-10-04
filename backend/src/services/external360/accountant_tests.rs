//! Mali müşavir raporu testleri.
use super::super::super::security360::test_db::bellek;
use super::super::signing::dogrula;
use super::*;

async fn conn() -> SqliteConnection {
    bellek().await
}

async fn siparis_ekle(
    conn: &mut SqliteConnection,
    tenant: &str,
    id: &str,
    durum: &str,
    toplam: i64,
    gun: &str,
) {
    sqlx::query("INSERT OR IGNORE INTO tables (id, tenant_id, name) VALUES ('m1', ?, 'M1')")
        .bind(tenant)
        .execute(&mut *conn)
        .await
        .expect("masa");
    sqlx::query(
        "INSERT INTO orders (id, tenant_id, table_id, status, total_cents, created_at)
         VALUES (?, ?, 'm1', ?, ?, ?)",
    )
    .bind(id)
    .bind(tenant)
    .bind(durum)
    .bind(toplam)
    .bind(format!("{gun} 12:00:00"))
    .execute(&mut *conn)
    .await
    .expect("siparis");
}

#[tokio::test]
async fn rapor_durum_dagilimini_ayirir() {
    let mut conn = conn().await;
    siparis_ekle(&mut conn, "tenant_a", "o1", "PAID", 10_000, "2026-03-05").await;
    siparis_ekle(&mut conn, "tenant_a", "o2", "OPEN", 4_000, "2026-03-06").await;
    siparis_ekle(&mut conn, "tenant_a", "o3", "VOID", 2_000, "2026-03-07").await;

    let rapor = rapor_uret(
        &mut conn,
        Some("tenant_a"),
        "2026-03-01",
        "2026-03-31",
        "usr_1",
    )
    .await
    .expect("rapor");

    assert_eq!(rapor.govde.govde.tahsilat_cents, 10_000);
    assert_eq!(rapor.govde.govde.acik_satis_cents, 4_000);
    assert_eq!(rapor.govde.govde.iptal_cents, 2_000);
    assert_eq!(rapor.govde.govde.siparis_adedi, 3);
}

#[tokio::test]
async fn iptal_siparis_hasilat_degildir() {
    let mut conn = conn().await;
    siparis_ekle(&mut conn, "tenant_a", "o1", "VOID", 9_000, "2026-03-05").await;

    let rapor = rapor_uret(
        &mut conn,
        Some("tenant_a"),
        "2026-03-01",
        "2026-03-31",
        "usr_1",
    )
    .await
    .expect("rapor");

    // VOID ayrı sütunda; tahsilata karışırsa muhasebeci yanlış kazanç görür.
    assert_eq!(rapor.govde.govde.tahsilat_cents, 0);
    assert_eq!(rapor.govde.govde.iptal_cents, 9_000);
}

#[tokio::test]
async fn rapor_imzali_ve_dogrulanabilir() {
    let mut conn = conn().await;
    siparis_ekle(&mut conn, "tenant_a", "o1", "PAID", 10_000, "2026-03-05").await;

    let rapor = rapor_uret(
        &mut conn,
        Some("tenant_a"),
        "2026-03-01",
        "2026-03-31",
        "usr_1",
    )
    .await
    .expect("rapor");
    let (kimlik, anahtar) = anahtar_al_veya_uret(&mut conn, "tenant_a")
        .await
        .expect("a");
    let okunan = dogrula(&anahtar, &kimlik, &rapor.govde).expect("imza gecer");

    assert_eq!(okunan.tahsilat_cents, 10_000);
    assert_eq!(okunan.tenant_kodu, "tenant_a");
}

#[tokio::test]
async fn rapor_rakam_degistirilirse_reddedilir() {
    let mut conn = conn().await;
    siparis_ekle(&mut conn, "tenant_a", "o1", "PAID", 10_000, "2026-03-05").await;
    let rapor = rapor_uret(
        &mut conn,
        Some("tenant_a"),
        "2026-03-01",
        "2026-03-31",
        "usr_1",
    )
    .await
    .expect("rapor");
    let (kimlik, anahtar) = anahtar_al_veya_uret(&mut conn, "tenant_a")
        .await
        .expect("a");

    let mut sahte = rapor.govde.clone();
    sahte.govde.tahsilat_cents = 999_999;
    // Dosyada rakam şişirilmiş; imza artık tutmuyor.
    assert!(dogrula(&anahtar, &kimlik, &sahte).is_err());
}

#[tokio::test]
async fn rapor_kiracilarin_verisini_toplamaz() {
    let mut conn = conn().await;
    siparis_ekle(&mut conn, "tenant_a", "o1", "PAID", 10_000, "2026-03-05").await;
    siparis_ekle(&mut conn, "tenant_b", "o2", "PAID", 77_000, "2026-03-05").await;

    let rapor = rapor_uret(
        &mut conn,
        Some("tenant_a"),
        "2026-03-01",
        "2026-03-31",
        "usr_1",
    )
    .await
    .expect("rapor");

    assert_eq!(
        rapor.govde.govde.tahsilat_cents, 10_000,
        "baska kiracinin cirosu rapora sizdi"
    );
    assert_eq!(rapor.govde.govde.siparis_adedi, 1);
}

#[tokio::test]
async fn donem_disi_siparisler_haricidir() {
    let mut conn = conn().await;
    siparis_ekle(&mut conn, "tenant_a", "o1", "PAID", 10_000, "2026-03-05").await;
    siparis_ekle(&mut conn, "tenant_a", "o2", "PAID", 50_000, "2026-01-05").await;

    let rapor = rapor_uret(
        &mut conn,
        Some("tenant_a"),
        "2026-03-01",
        "2026-03-31",
        "usr_1",
    )
    .await
    .expect("rapor");

    assert_eq!(rapor.govde.govde.tahsilat_cents, 10_000);
}

#[tokio::test]
async fn boş_donem_sifir_uretr_hata_degil() {
    let mut conn = conn().await;

    let rapor = rapor_uret(
        &mut conn,
        Some("tenant_a"),
        "2026-03-01",
        "2026-03-31",
        "usr_1",
    )
    .await
    .expect("bos donem de gecerli bir rapordur");

    assert_eq!(rapor.govde.govde.tahsilat_cents, 0);
    assert_eq!(rapor.govde.govde.siparis_adedi, 0);
}

#[tokio::test]
async fn borc_toplamlari_yon_ayirt_edilir() {
    let mut conn = conn().await;
    sqlx::query("INSERT OR IGNORE INTO directories (id, tenant_id, name, type) VALUES ('d1', 'tenant_a', 'D', 'CUSTOMER')")
        .execute(&mut conn)
        .await
        .expect("cari");
    for (tip, tutar) in [("GIVEN", 30_000_i64), ("TAKEN", 12_000_i64)] {
        sqlx::query(
            "INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents,
                                remaining_amount_cents, status, created_at)
             VALUES (?, 'tenant_a', 'd1', ?, ?, ?, 'PENDING', '2026-03-10 09:00:00')",
        )
        .bind(format!("dbt_{tip}"))
        .bind(tip)
        .bind(tutar)
        .bind(tutar)
        .execute(&mut conn)
        .await
        .expect("borc");
    }

    let rapor = rapor_uret(
        &mut conn,
        Some("tenant_a"),
        "2026-03-01",
        "2026-03-31",
        "usr_1",
    )
    .await
    .expect("rapor");

    assert_eq!(rapor.govde.govde.borc_verilen_cents, 30_000);
    assert_eq!(rapor.govde.govde.borc_alinan_cents, 12_000);
    assert_eq!(rapor.govde.govde.kalan_borc_cents, 18_000);
}

#[tokio::test]
async fn bozuk_donem_reddedilir() {
    let mut conn = conn().await;

    assert!(
        rapor_uret(&mut conn, Some("tenant_a"), "2026-3-1", "2026-03-31", "u")
            .await
            .is_err()
    );
    assert!(
        rapor_uret(&mut conn, Some("tenant_a"), "abc", "2026-03-31", "u")
            .await
            .is_err()
    );
    // Ters dönem: imzası doğru ama içeriği yanlış dönemin rakamları olurdu.
    assert!(
        rapor_uret(&mut conn, Some("tenant_a"), "2026-04-01", "2026-03-31", "u")
            .await
            .is_err()
    );
}

#[tokio::test]
async fn kiraci_zorunludur() {
    let mut conn = conn().await;
    assert!(rapor_uret(&mut conn, None, "2026-03-01", "2026-03-31", "u")
        .await
        .is_err());
}

// ---- gönderim ve kuyruk ----

#[tokio::test]
async fn gonderilme_tek_seferliktir() {
    let mut conn = conn().await;
    let rapor = rapor_uret(
        &mut conn,
        Some("tenant_a"),
        "2026-03-01",
        "2026-03-31",
        "usr_1",
    )
    .await
    .expect("rapor");

    rapor_gonderildi_isaretle(&mut conn, "tenant_a", &rapor.id)
        .await
        .expect("gonderildi");
    // İkinci kez sessizce yutulmaz.
    assert!(rapor_gonderildi_isaretle(&mut conn, "tenant_a", &rapor.id)
        .await
        .is_err());
}

#[tokio::test]
async fn gonderim_durumu_gercekten_yazilir() {
    let mut conn = conn().await;
    let rapor = rapor_uret(
        &mut conn,
        Some("tenant_a"),
        "2026-03-01",
        "2026-03-31",
        "usr_1",
    )
    .await
    .expect("rapor");

    let once: Option<String> =
        sqlx::query_scalar("SELECT sent_at FROM accountant_reports WHERE id = ?")
            .bind(&rapor.id)
            .fetch_one(&mut conn)
            .await
            .expect("okunur");
    assert!(once.is_none(), "uretim aninda gonderilmis sayilmamali");

    rapor_gonderildi_isaretle(&mut conn, "tenant_a", &rapor.id)
        .await
        .expect("gonderildi");
    let sonra: Option<String> =
        sqlx::query_scalar("SELECT sent_at FROM accountant_reports WHERE id = ?")
            .bind(&rapor.id)
            .fetch_one(&mut conn)
            .await
            .expect("okunur");
    assert!(sonra.is_some());
}

#[tokio::test]
async fn rapor_baska_kiraciye_kuyruklanamaz() {
    let mut conn = conn().await;
    let rapor = rapor_uret(
        &mut conn,
        Some("tenant_a"),
        "2026-03-01",
        "2026-03-31",
        "usr_1",
    )
    .await
    .expect("rapor");

    assert!(
        raporu_posta_kuyruguna_al(&mut conn, "tenant_b", &rapor.id, "m@x.com", "a.json")
            .await
            .is_err()
    );
}

#[tokio::test]
async fn rapor_posta_kuyruguna_alinir() {
    let mut conn = conn().await;
    let rapor = rapor_uret(
        &mut conn,
        Some("tenant_a"),
        "2026-03-01",
        "2026-03-31",
        "usr_1",
    )
    .await
    .expect("rapor");

    let id = raporu_posta_kuyruguna_al(&mut conn, "tenant_a", &rapor.id, "m@x.com", "rapor.json")
        .await
        .expect("kuyruk");

    let satir: (String, String, String) = sqlx::query_as(
        "SELECT recipient, attachment_path, provider_flag FROM email_queue WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(&mut conn)
    .await
    .expect("okunur");
    assert_eq!(satir.0, "m@x.com");
    assert_eq!(satir.1, "rapor.json");
    assert_eq!(satir.2, "FAKE");
}

#[tokio::test]
async fn alici_adresi_zorunludur() {
    let mut conn = conn().await;
    let rapor = rapor_uret(
        &mut conn,
        Some("tenant_a"),
        "2026-03-01",
        "2026-03-31",
        "usr_1",
    )
    .await
    .expect("rapor");

    assert!(
        raporu_posta_kuyruguna_al(&mut conn, "tenant_a", &rapor.id, "  ", "a.json")
            .await
            .is_err()
    );
}
