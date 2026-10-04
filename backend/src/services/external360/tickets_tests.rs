//! Teknik servis kaydı testleri.
use super::super::super::security360::test_db::bellek;
use super::*;

async fn conn() -> SqliteConnection {
    bellek().await
}

async fn kullanici_ekle(conn: &mut SqliteConnection, id: &str, tenant: &str, aktif: i64) {
    sqlx::query(
        "INSERT INTO users (id, tenant_id, name, role, pin_hash, is_active)
         VALUES (?, ?, 'P', 'Technician', 'x', ?)",
    )
    .bind(id)
    .bind(tenant)
    .bind(aktif)
    .execute(&mut *conn)
    .await
    .expect("kullanici");
}

#[tokio::test]
async fn kayit_acilir() {
    let mut conn = conn().await;
    let id = kayit_ac(
        &mut conn,
        Some("tenant_a"),
        "KASA",
        "HIGH",
        "Yazıcı kağıt yemiyor",
        "Rolik değişti",
        None,
    )
    .await
    .expect("kayit");

    assert!(id.starts_with("svc_"));
    let durum: String = sqlx::query_scalar("SELECT status FROM service_tickets WHERE id = ?")
        .bind(&id)
        .fetch_one(&mut conn)
        .await
        .expect("okunur");
    assert_eq!(durum, "OPEN");
}

#[tokio::test]
async fn gecersiz_kategori_ve_aciliyet_reddedilir() {
    let mut conn = conn().await;
    assert!(
        kayit_ac(&mut conn, Some("tenant_a"), "ROBOT", "LOW", "B", "", None)
            .await
            .is_err()
    );
    assert!(
        kayit_ac(&mut conn, Some("tenant_a"), "KASA", "YOK", "B", "", None)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn bos_baslik_reddedilir() {
    let mut conn = conn().await;
    assert!(
        kayit_ac(&mut conn, Some("tenant_a"), "KASA", "LOW", "   ", "", None)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn kiraci_zorunludur() {
    let mut conn = conn().await;
    assert!(kayit_ac(&mut conn, None, "KASA", "LOW", "B", "", None)
        .await
        .is_err());
}

#[tokio::test]
async fn atama_yapilabilir() {
    let mut conn = conn().await;
    kullanici_ekle(&mut conn, "usr_1", "tenant_a", 1).await;
    let id = kayit_ac(
        &mut conn,
        Some("tenant_a"),
        "AG",
        "MEDIUM",
        "Kasaya bağlanmıyor",
        "",
        None,
    )
    .await
    .expect("kayit");

    personel_ata(&mut conn, "tenant_a", &id, Some("usr_1"))
        .await
        .expect("ata");

    let atanan: Option<String> =
        sqlx::query_scalar("SELECT assigned_to FROM service_tickets WHERE id = ?")
            .bind(&id)
            .fetch_one(&mut conn)
            .await
            .expect("okunur");
    assert_eq!(atanan.as_deref(), Some("usr_1"));
}

#[tokio::test]
async fn yabanci_kullaniciya_atama_yapilamaz() {
    let mut conn = conn().await;
    kullanici_ekle(&mut conn, "usr_yabanci", "tenant_b", 1).await;
    let id = kayit_ac(&mut conn, Some("tenant_a"), "AG", "MEDIUM", "B", "", None)
        .await
        .expect("kayit");

    assert!(
        personel_ata(&mut conn, "tenant_a", &id, Some("usr_yabanci"))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn pasif_personele_atama_yapilamaz() {
    let mut conn = conn().await;
    kullanici_ekle(&mut conn, "usr_pasif", "tenant_a", 0).await;
    let id = kayit_ac(&mut conn, Some("tenant_a"), "AG", "LOW", "B", "", None)
        .await
        .expect("kayit");

    assert!(personel_ata(&mut conn, "tenant_a", &id, Some("usr_pasif"))
        .await
        .is_err());
}

#[tokio::test]
async fn cozulme_tarihi_yalniz_cozumuldugunde_yazilir() {
    let mut conn = conn().await;
    let id = kayit_ac(&mut conn, Some("tenant_a"), "KASA", "HIGH", "B", "", None)
        .await
        .expect("kayit");

    let once: Option<String> =
        sqlx::query_scalar("SELECT resolved_at FROM service_tickets WHERE id = ?")
            .bind(&id)
            .fetch_one(&mut conn)
            .await
            .expect("okunur");
    assert!(once.is_none());

    durum_guncelle(&mut conn, "tenant_a", &id, "RESOLVED")
        .await
        .expect("cozuldu");
    let sonra: Option<String> =
        sqlx::query_scalar("SELECT resolved_at FROM service_tickets WHERE id = ?")
            .bind(&id)
            .fetch_one(&mut conn)
            .await
            .expect("okunur");
    assert!(sonra.is_some());
}

#[tokio::test]
async fn gecersiz_durum_reddedilir() {
    let mut conn = conn().await;
    let id = kayit_ac(&mut conn, Some("tenant_a"), "KASA", "LOW", "B", "", None)
        .await
        .expect("kayit");

    assert!(durum_guncelle(&mut conn, "tenant_a", &id, "YOK")
        .await
        .is_err());
}

#[tokio::test]
async fn olmayan_kayit_guncellenemez() {
    let mut conn = conn().await;
    assert!(durum_guncelle(&mut conn, "tenant_a", "svc_yok", "RESOLVED")
        .await
        .is_err());
}

#[tokio::test]
async fn kayit_baska_kiracta_guncellenemez() {
    let mut conn = conn().await;
    let id = kayit_ac(&mut conn, Some("tenant_a"), "KASA", "LOW", "B", "", None)
        .await
        .expect("kayit");

    assert!(durum_guncelle(&mut conn, "tenant_b", &id, "RESOLVED")
        .await
        .is_err());
}

#[tokio::test]
async fn liste_acilige_gore_siralanir() {
    let mut conn = conn().await;
    for (kategori, onem, baslik) in [
        ("DIGER", "LOW", "Düşük"),
        ("KASA", "CRITICAL", "Kritik"),
        ("AG", "MEDIUM", "Orta"),
    ] {
        kayit_ac(
            &mut conn,
            Some("tenant_a"),
            kategori,
            onem,
            baslik,
            "",
            None,
        )
        .await
        .expect("kayit");
    }

    let liste = acik_kayitlar(&mut conn, "tenant_a").await.expect("liste");
    let onemler: Vec<&str> = liste.iter().map(|(_, o, _)| o.as_str()).collect();

    assert_eq!(onemler, vec!["CRITICAL", "MEDIUM", "LOW"]);
}

#[tokio::test]
async fn kapanan_kayit_listede_gorunmez() {
    let mut conn = conn().await;
    let id = kayit_ac(&mut conn, Some("tenant_a"), "KASA", "HIGH", "B", "", None)
        .await
        .expect("kayit");
    durum_guncelle(&mut conn, "tenant_a", &id, "CLOSED")
        .await
        .expect("kapandi");

    assert!(acik_kayitlar(&mut conn, "tenant_a")
        .await
        .expect("liste")
        .is_empty());
}

#[tokio::test]
async fn liste_kiracilarin_karismaz() {
    let mut conn = conn().await;
    kayit_ac(&mut conn, Some("tenant_a"), "KASA", "LOW", "A", "", None)
        .await
        .expect("a");
    kayit_ac(&mut conn, Some("tenant_b"), "KASA", "LOW", "B", "", None)
        .await
        .expect("b");

    assert_eq!(
        acik_kayitlar(&mut conn, "tenant_a")
            .await
            .expect("liste")
            .len(),
        1
    );
}
