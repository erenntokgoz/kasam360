//! Tedarikçi talebi testleri.
use super::super::super::security360::test_db::bellek;
use super::*;

async fn conn() -> SqliteConnection {
    bellek().await
}

async fn tedarikci_ekle(
    conn: &mut SqliteConnection,
    tenant: &str,
    id: &str,
    telefon: Option<&str>,
) {
    sqlx::query(
        "INSERT INTO suppliers (id, tenant_id, name, phone, created_by)
         VALUES (?, ?, 'Tedarikçi', ?, 'usr_1')",
    )
    .bind(id)
    .bind(tenant)
    .bind(telefon)
    .execute(&mut *conn)
    .await
    .expect("tedarikci");
}

#[tokio::test]
async fn taslak_talep_olusturulur() {
    let mut conn = conn().await;
    tedarikci_ekle(&mut conn, "tenant_a", "sup_1", Some("+905550000001")).await;

    let id = talep_olustur(
        &mut conn,
        Some("tenant_a"),
        "sup_1",
        r#"[{"product_id":"u1","qty":10}]"#,
        "acil",
    )
    .await
    .expect("talep");

    let durum: String = sqlx::query_scalar("SELECT status FROM supplier_orders WHERE id = ?")
        .bind(&id)
        .fetch_one(&mut conn)
        .await
        .expect("okunur");
    assert_eq!(durum, "DRAFT");
}

#[tokio::test]
async fn yabanci_tedarikciye_talep_acilamaz() {
    let mut conn = conn().await;
    tedarikci_ekle(&mut conn, "tenant_b", "sup_yabanci", Some("+90555")).await;

    // Çapraz kiracı: tedarikçinin fiyat listesi bu işletmeye sızar.
    assert!(talep_olustur(
        &mut conn,
        Some("tenant_a"),
        "sup_yabanci",
        r#"[{"product_id":"u1","qty":1}]"#,
        ""
    )
    .await
    .is_err());
}

#[tokio::test]
async fn olmayan_tedarikci_reddedilir() {
    let mut conn = conn().await;
    assert!(talep_olustur(
        &mut conn,
        Some("tenant_a"),
        "sup_yok",
        r#"[{"product_id":"u1"}]"#,
        ""
    )
    .await
    .is_err());
}

#[tokio::test]
async fn talep_fiyat_tasimaz() {
    let mut conn = conn().await;
    tedarikci_ekle(&mut conn, "tenant_a", "sup_1", Some("+90555")).await;

    // Tedarikçinin yazdığı fiyat otomatik kabul edilmez: stok maliyeti ve P&L
    // etkilenir (para kaynağı kuralı).
    let hata = talep_olustur(
        &mut conn,
        Some("tenant_a"),
        "sup_1",
        r#"[{"product_id":"u1","qty":10,"price_cents":1}]"#,
        "",
    )
    .await
    .expect_err("fiyatli talep reddedilmeli");
    assert!(hata.contains("fiyat"));
}

#[tokio::test]
async fn talep_govdesi_bozuk_reddedilir() {
    let mut conn = conn().await;
    tedarikci_ekle(&mut conn, "tenant_a", "sup_1", Some("+90555")).await;

    for govde in [
        "{}",
        "bozuk",
        "[]",
        r#"[{"qty":1}]"#,
        r#"[{"product_id":"u1","qty":0}]"#,
    ] {
        assert!(
            talep_olustur(&mut conn, Some("tenant_a"), "sup_1", govde, "")
                .await
                .is_err(),
            "{govde} reddedilmeli"
        );
    }
}

#[tokio::test]
async fn disa_aktarilan_talep_imzali_gecer() {
    let mut conn = conn().await;
    tedarikci_ekle(&mut conn, "tenant_a", "sup_1", Some("+90555")).await;
    let id = talep_olustur(
        &mut conn,
        Some("tenant_a"),
        "sup_1",
        r#"[{"product_id":"u1","qty":10}]"#,
        "",
    )
    .await
    .expect("talep");

    let belge = talep_disa_aktar(&mut conn, Some("tenant_a"), &id)
        .await
        .expect("aktar");
    let (kimlik, anahtar) = anahtar_al_veya_uret(&mut conn, "tenant_a")
        .await
        .expect("a");
    let okunan = dogrula(&anahtar, &kimlik, &belge).expect("imza gecer");

    assert_eq!(okunan.talep_id, id);
    assert_eq!(okunan.tedarikci_adi, "Tedarikçi");
}

#[tokio::test]
async fn yoldaki_degistirilmis_talep_ice_alinmaz() {
    let mut conn = conn().await;
    tedarikci_ekle(&mut conn, "tenant_a", "sup_1", Some("+90555")).await;
    let id = talep_olustur(
        &mut conn,
        Some("tenant_a"),
        "sup_1",
        r#"[{"product_id":"u1","qty":10}]"#,
        "",
    )
    .await
    .expect("talep");
    let belge = talep_disa_aktar(&mut conn, Some("tenant_a"), &id)
        .await
        .expect("aktar");

    // Saldırgan adedi değiştirir.
    let mut sahte = belge.clone();
    sahte.govde.urunler = r#"[{"product_id":"u1","qty":10000}]"#.to_string();
    assert!(cevap_ice_al(&mut conn, Some("tenant_a"), &sahte)
        .await
        .is_err());
}

#[tokio::test]
async fn imzasiz_cevap_reddedilir() {
    let mut conn = conn().await;
    tedarikci_ekle(&mut conn, "tenant_a", "sup_1", Some("+90555")).await;
    let id = talep_olustur(
        &mut conn,
        Some("tenant_a"),
        "sup_1",
        r#"[{"product_id":"u1","qty":10}]"#,
        "",
    )
    .await
    .expect("talep");
    let mut belge = talep_disa_aktar(&mut conn, Some("tenant_a"), &id)
        .await
        .expect("aktar");
    belge.imza = "0".repeat(64);

    assert!(cevap_ice_al(&mut conn, Some("tenant_a"), &belge)
        .await
        .is_err());
}

#[tokio::test]
async fn alinan_cevap_talebi_teslim_edilmis_yapar() {
    let mut conn = conn().await;
    tedarikci_ekle(&mut conn, "tenant_a", "sup_1", Some("+90555")).await;
    let id = talep_olustur(
        &mut conn,
        Some("tenant_a"),
        "sup_1",
        r#"[{"product_id":"u1","qty":10}]"#,
        "",
    )
    .await
    .expect("talep");
    let belge = talep_disa_aktar(&mut conn, Some("tenant_a"), &id)
        .await
        .expect("aktar");

    cevap_ice_al(&mut conn, Some("tenant_a"), &belge)
        .await
        .expect("alindi");

    let durum: String = sqlx::query_scalar("SELECT status FROM supplier_orders WHERE id = ?")
        .bind(&id)
        .fetch_one(&mut conn)
        .await
        .expect("okunur");
    assert_eq!(durum, "DELIVERED");
}

#[tokio::test]
async fn kuyruga_alinan_talep_baglanti_kurulur() {
    let mut conn = conn().await;
    tedarikci_ekle(&mut conn, "tenant_a", "sup_1", Some("+905550000001")).await;
    let id = talep_olustur(
        &mut conn,
        Some("tenant_a"),
        "sup_1",
        r#"[{"product_id":"u1","qty":10}]"#,
        "acil",
    )
    .await
    .expect("talep");

    let kuyruk_id = talep_kuyruga_al(&mut conn, "tenant_a", &id)
        .await
        .expect("kuyruk");

    let satir: (String, Option<String>) =
        sqlx::query_as("SELECT status, whatsapp_message_id FROM supplier_orders WHERE id = ?")
            .bind(&id)
            .fetch_one(&mut conn)
            .await
            .expect("okunur");
    assert_eq!(satir.0, "QUEUED");
    assert_eq!(satir.1.as_deref(), Some(kuyruk_id.as_str()));

    // Sahte sağlayıcı bilgisi dosyada görünür olmalı.
    let bayrak: String =
        sqlx::query_scalar("SELECT provider_flag FROM whatsapp_queue WHERE id = ?")
            .bind(&kuyruk_id)
            .fetch_one(&mut conn)
            .await
            .expect("okunur");
    assert_eq!(bayrak, "FAKE");
}

#[tokio::test]
async fn telefonsuz_tedarikci_kuyruga_alinamaz() {
    let mut conn = conn().await;
    tedarikci_ekle(&mut conn, "tenant_a", "sup_1", None).await;
    let id = talep_olustur(
        &mut conn,
        Some("tenant_a"),
        "sup_1",
        r#"[{"product_id":"u1"}]"#,
        "",
    )
    .await
    .expect("talep");

    assert!(talep_kuyruga_al(&mut conn, "tenant_a", &id).await.is_err());
}

#[tokio::test]
async fn iptal_edilen_talep_tekrar_kuyruga_alinmaz() {
    let mut conn = conn().await;
    tedarikci_ekle(&mut conn, "tenant_a", "sup_1", Some("+90555")).await;
    let id = talep_olustur(
        &mut conn,
        Some("tenant_a"),
        "sup_1",
        r#"[{"product_id":"u1"}]"#,
        "",
    )
    .await
    .expect("talep");

    talep_iptal(&mut conn, "tenant_a", &id)
        .await
        .expect("iptal");
    assert!(talep_kuyruga_al(&mut conn, "tenant_a", &id).await.is_err());
}
