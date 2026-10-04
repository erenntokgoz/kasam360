//! QR menü dosyası testleri.
use super::super::super::security360::test_db::bellek;
use super::super::signing::{anahtar_al_veya_uret, dogrula};
use super::*;

async fn conn() -> SqliteConnection {
    bellek().await
}

async fn urun_ekle(conn: &mut SqliteConnection, tenant: &str, id: &str, ad: &str, fiyat: i64) {
    sqlx::query(
        "INSERT OR IGNORE INTO categories (id, tenant_id, name, display_order)
         VALUES ('kat1', ?, 'Ana Yemek', 1)",
    )
    .bind(tenant)
    .execute(&mut *conn)
    .await
    .expect("kategori");
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, price_cents, category_id, is_active)
         VALUES (?, ?, ?, ?, 'kat1', 1)",
    )
    .bind(id)
    .bind(tenant)
    .bind(ad)
    .bind(fiyat)
    .execute(&mut *conn)
    .await
    .expect("urun");
}

#[tokio::test]
async fn menu_pasif_ve_86_urunleri_icermez() {
    let mut conn = conn().await;
    urun_ekle(&mut conn, "tenant_a", "u1", "Çorba", 8_500).await;
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, price_cents, category_id, is_active, is_86)
         VALUES ('u2', 'tenant_a', 'Tatlı', 6_000, 'kat1', 1, 1)",
    )
    .execute(&mut conn)
    .await
    .expect("urun");
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, price_cents, category_id, is_active)
         VALUES ('u3', 'tenant_a', 'Eski', 1_000, 'kat1', 0)",
    )
    .execute(&mut conn)
    .await
    .expect("urun");

    let ogeler = menu_ogeleri(&mut conn, "tenant_a").await.expect("menu");
    let adlar: Vec<&str> = ogeler.iter().map(|o| o.ad.as_str()).collect();

    assert_eq!(adlar, vec!["Çorba"]);
}

#[tokio::test]
async fn menu_belgesi_imzali_ve_dogrulanabilir() {
    let mut conn = conn().await;
    urun_ekle(&mut conn, "tenant_a", "u1", "Çorba", 8_500).await;

    let belge = menu_belgesi_uret(&mut conn, Some("tenant_a"))
        .await
        .expect("belge");
    let (kimlik, anahtar) = anahtar_al_veya_uret(&mut conn, "tenant_a")
        .await
        .expect("anahtar");

    let dogrulanmis = dogrula(&anahtar, &kimlik, &belge).expect("imza gecer");
    assert_eq!(dogrulanmis.ogeler.len(), 1);
    assert_eq!(dogrulanmis.ogeler[0].fiyat_cents, 8_500);
    assert_eq!(dogrulanmis.tenant_kodu, "tenant_a");
}

#[tokio::test]
async fn menu_belgesinde_anahtar_yoktur() {
    let mut conn = conn().await;
    urun_ekle(&mut conn, "tenant_a", "u1", "Çorba", 8_500).await;
    let (_, anahtar) = anahtar_al_veya_uret(&mut conn, "tenant_a")
        .await
        .expect("a");
    let anahtar_hex = hex::encode(&anahtar);

    let belge = menu_belgesi_uret(&mut conn, Some("tenant_a"))
        .await
        .expect("b");
    let metin = serde_json::to_string(&belge).expect("seri");

    // Dosya müşteriye dağıtılıyor; anahtarın kendisi dosyada bulunmamalı.
    assert!(!metin.contains(&anahtar_hex), "menude imza anahtari sizdi");
}

#[tokio::test]
async fn menu_belgesinde_fiyat_degistirilirse_reddedilir() {
    let mut conn = conn().await;
    urun_ekle(&mut conn, "tenant_a", "u1", "Çorba", 8_500).await;
    let belge = menu_belgesi_uret(&mut conn, Some("tenant_a"))
        .await
        .expect("b");
    let (kimlik, anahtar) = anahtar_al_veya_uret(&mut conn, "tenant_a")
        .await
        .expect("a");

    let mut sahte = belge.clone();
    sahte.govde.ogeler[0].fiyat_cents = 1;
    assert!(dogrula(&anahtar, &kimlik, &sahte).is_err());
}

#[tokio::test]
async fn menu_kiracilarin_urunlerini_toplamaz() {
    let mut conn = conn().await;
    urun_ekle(&mut conn, "tenant_a", "u1", "A", 1_000).await;
    urun_ekle(&mut conn, "tenant_b", "u2", "B", 2_000).await;

    let ogeler = menu_ogeleri(&mut conn, "tenant_a").await.expect("menu");
    assert_eq!(ogeler.len(), 1);
    assert_eq!(ogeler[0].ad, "A");
}

#[tokio::test]
async fn dosya_uretimi_iki_bicim_dondurur() {
    let mut conn = conn().await;
    urun_ekle(&mut conn, "tenant_a", "u1", "Çorba", 8_500).await;

    let cikti = menu_dosyasi_uret(&mut conn, "tenant_a")
        .await
        .expect("dosya");
    assert!(cikti.html.contains("Çorba"));
    assert!(cikti.json.contains("Çorba"));
    assert_eq!(cikti.imza.len(), 64, "HMAC-SHA256 hex");
    assert!(!cikti.key_id.is_empty());
}

#[tokio::test]
async fn html_menusu_harici_varlik_icermez() {
    let mut conn = conn().await;
    urun_ekle(&mut conn, "tenant_a", "u1", "Çorba", 8_500).await;
    let cikti = menu_dosyasi_uret(&mut conn, "tenant_a")
        .await
        .expect("dosya");

    let html = cikti.html.to_ascii_lowercase();
    assert!(!html.contains("http://"), "harici adres olmamali");
    assert!(!html.contains("https://"));
    assert!(!html.contains("<script"), "betik olmamali");
}

#[test]
fn html_menusu_urun_adindaki_betik_kacirilir() {
    let belge = MenuBelgesi {
        tenant_kodu: "t".into(),
        uretim_zamani: "z".into(),
        ogeler: vec![MenuOgesi {
            urun_id: "u1".into(),
            ad: "<script>alert(1)</script>".into(),
            aciklama: "a\"b".into(),
            fiyat_cents: 100,
            kategori: "k".into(),
        }],
    };

    let html = menu_html(&belge, "imza");
    assert!(!html.contains("<script>"), "betik etiketi kacirilmadi");
    assert!(html.contains("&lt;script&gt;"));
    assert!(html.contains("&quot;"));
}
