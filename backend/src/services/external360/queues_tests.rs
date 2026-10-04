//! Kuyruk testleri.
use super::super::super::security360::test_db::bellek;
use super::*;

async fn conn() -> SqliteConnection {
    bellek().await
}

async fn mesaj_ekle(conn: &mut SqliteConnection, tenant: &str, id: &str, alici: &str) {
    sqlx::query(
        "INSERT INTO whatsapp_queue (id, tenant_id, recipient, message) VALUES (?, ?, ?, 'metin')",
    )
    .bind(id)
    .bind(tenant)
    .bind(alici)
    .execute(&mut *conn)
    .await
    .expect("mesaj");
}

async fn posta_ekle(conn: &mut SqliteConnection, tenant: &str, id: &str) {
    sqlx::query(
        "INSERT INTO email_queue (id, tenant_id, recipient, subject, body)
         VALUES (?, ?, 'm@x.com', 'konu', 'govde')",
    )
    .bind(id)
    .bind(tenant)
    .execute(&mut *conn)
    .await
    .expect("posta");
}

#[tokio::test]
async fn bekleyen_whatsapp_mesaji_gonderilir() {
    let mut conn = conn().await;
    mesaj_ekle(&mut conn, "tenant_a", "waq_1", "+90555").await;

    let sonuc = whatsapp_kuyrugunu_isle(&mut conn, Some("tenant_a"))
        .await
        .expect("kuyruk");
    assert_eq!(sonuc.gonderilen, 1);
    assert_eq!(sonuc.basarisiz, 0);

    let durum: String = sqlx::query_scalar("SELECT status FROM whatsapp_queue WHERE id = 'waq_1'")
        .fetch_one(&mut conn)
        .await
        .expect("okunur");
    assert_eq!(durum, "SENT");
}

#[tokio::test]
async fn gonderilen_mesaj_sahte_bayragi_tasir() {
    let mut conn = conn().await;
    mesaj_ekle(&mut conn, "tenant_a", "waq_1", "+90555").await;
    whatsapp_kuyrugunu_isle(&mut conn, Some("tenant_a"))
        .await
        .expect("kuyruk");

    let satir: (String, Option<String>, i64) = sqlx::query_as(
        "SELECT provider_flag, sent_at, attempts FROM whatsapp_queue WHERE id = 'waq_1'",
    )
    .fetch_one(&mut conn)
    .await
    .expect("okunur");

    // Gerçekmiş gibi görünmemeli: sahte sağlayıcının izi kayıtta kalmalı.
    assert_eq!(satir.0, "FAKE");
    assert!(satir.1.is_some(), "gonderilme zamani yazilmali");
    assert_eq!(satir.2, 1, "deneme sayaci artmali");
}

#[tokio::test]
async fn ayni_mesaj_iki_kez_gonderilmez() {
    let mut conn = conn().await;
    mesaj_ekle(&mut conn, "tenant_a", "waq_1", "+90555").await;

    let ilk = whatsapp_kuyrugunu_isle(&mut conn, Some("tenant_a"))
        .await
        .expect("1");
    let ikinci = whatsapp_kuyrugunu_isle(&mut conn, Some("tenant_a"))
        .await
        .expect("2");

    assert_eq!(ilk.gonderilen, 1);
    assert_eq!(ikinci.gonderilen, 0, "gonderilmis mesaj tekrar gitmemeli");

    let deneme: i64 = sqlx::query_scalar("SELECT attempts FROM whatsapp_queue WHERE id = 'waq_1'")
        .fetch_one(&mut conn)
        .await
        .expect("okunur");
    assert_eq!(deneme, 1);
}

#[tokio::test]
async fn kuyruk_kiracilarin_karismaz() {
    let mut conn = conn().await;
    mesaj_ekle(&mut conn, "tenant_a", "waq_a", "+90555").await;
    mesaj_ekle(&mut conn, "tenant_b", "waq_b", "+90555").await;

    let sonuc = whatsapp_kuyrugunu_isle(&mut conn, Some("tenant_a"))
        .await
        .expect("kuyruk");
    assert_eq!(sonuc.gonderilen, 1);

    let durum: String = sqlx::query_scalar("SELECT status FROM whatsapp_queue WHERE id = 'waq_b'")
        .fetch_one(&mut conn)
        .await
        .expect("okunur");
    assert_eq!(durum, "PENDING", "baska kiracinin mesaji gonderilmemeli");
}

#[tokio::test]
async fn bos_kuyruk_sessiz_gecer() {
    let mut conn = conn().await;
    let sonuc = whatsapp_kuyrugunu_isle(&mut conn, Some("tenant_a"))
        .await
        .expect("kuyruk");

    assert_eq!(
        sonuc,
        IslemeSonucu {
            gonderilen: 0,
            basarisiz: 0
        }
    );
}

#[tokio::test]
async fn kiraci_zorunludur() {
    let mut conn = conn().await;
    assert!(whatsapp_kuyrugunu_isle(&mut conn, None).await.is_err());
    assert!(email_kuyrugunu_isle(&mut conn, None).await.is_err());
}

// ---- e-posta ----

#[tokio::test]
async fn bekleyen_posta_gonderilir() {
    let mut conn = conn().await;
    posta_ekle(&mut conn, "tenant_a", "emq_1").await;

    let sonuc = email_kuyrugunu_isle(&mut conn, Some("tenant_a"))
        .await
        .expect("kuyruk");
    assert_eq!(sonuc.gonderilen, 1);

    let satir: (String, Option<String>) =
        sqlx::query_as("SELECT provider_flag, sent_at FROM email_queue WHERE id = 'emq_1'")
            .fetch_one(&mut conn)
            .await
            .expect("okunur");
    assert_eq!(satir.0, "FAKE");
    assert!(satir.1.is_some());
}

#[tokio::test]
async fn posta_tekrar_gonderilmez() {
    let mut conn = conn().await;
    posta_ekle(&mut conn, "tenant_a", "emq_1").await;

    email_kuyrugunu_isle(&mut conn, Some("tenant_a"))
        .await
        .expect("1");
    let ikinci = email_kuyrugunu_isle(&mut conn, Some("tenant_a"))
        .await
        .expect("2");

    assert_eq!(ikinci.gonderilen, 0);
}

// ---- sayaç ----

#[tokio::test]
async fn bekleyen_sayi_iki_kanaldan_doner() {
    let mut conn = conn().await;
    mesaj_ekle(&mut conn, "tenant_a", "waq_1", "+90555").await;
    mesaj_ekle(&mut conn, "tenant_a", "waq_2", "+90555").await;
    posta_ekle(&mut conn, "tenant_a", "emq_1").await;

    let (whatsapp, email) = bekleyen_sayi(&mut conn, "tenant_a").await.expect("sayi");
    assert_eq!((whatsapp, email), (2, 1));
}

#[tokio::test]
async fn gonderim_sonrasi_sayac_duser() {
    let mut conn = conn().await;
    mesaj_ekle(&mut conn, "tenant_a", "waq_1", "+90555").await;
    whatsapp_kuyrugunu_isle(&mut conn, Some("tenant_a"))
        .await
        .expect("kuyruk");

    let (whatsapp, _) = bekleyen_sayi(&mut conn, "tenant_a").await.expect("sayi");
    assert_eq!(whatsapp, 0);
}
