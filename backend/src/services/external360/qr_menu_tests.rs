//! QR menü testleri.
use super::super::super::security360::test_db::bellek;
use super::*;

async fn conn() -> SqliteConnection {
    bellek().await
}

/// Talep kabulü gerçek bir siparişe bağlandığı için masa + sipariş satırı gerekir:
/// `orders.table_id` `NOT NULL` ve masaya bağlıdır (modül başlığı).
async fn masa_ve_siparis(conn: &mut SqliteConnection, tenant: &str, siparis_id: &str) {
    sqlx::query("INSERT OR IGNORE INTO tables (id, tenant_id, name) VALUES ('m1', ?, 'M1')")
        .bind(tenant)
        .execute(&mut *conn)
        .await
        .expect("masa");
    sqlx::query("INSERT INTO orders (id, tenant_id, table_id, status) VALUES (?, ?, 'm1', 'OPEN')")
        .bind(siparis_id)
        .bind(tenant)
        .execute(&mut *conn)
        .await
        .expect("siparis");
}

// ---- oturum ----

#[tokio::test]
async fn acilan_musteri_oturumu_dogrulanir() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, Some("tenant_a"), "Masa 5")
        .await
        .expect("ac");

    let oturum = oturum_dogrula(&mut conn, Some("tenant_a"), &bilet.token)
        .await
        .expect("gecer");
    assert_eq!(oturum.musteri_etiketi, "Masa 5");
}

#[tokio::test]
async fn jeton_duz_metin_saklanmaz() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, Some("tenant_a"), "x")
        .await
        .expect("ac");

    let saklanan: String =
        sqlx::query_scalar("SELECT qr_token_hash FROM customer_sessions WHERE id = ?")
            .bind(&bilet.session_id)
            .fetch_one(&mut conn)
            .await
            .expect("okunur");

    assert_ne!(saklanan, bilet.token);
    assert_eq!(saklanan.len(), 64, "SHA-256 ozeti");
}

#[tokio::test]
async fn jeton_baska_kiracida_gecerli_degil() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, Some("tenant_a"), "x")
        .await
        .expect("ac");

    assert!(oturum_dogrula(&mut conn, Some("tenant_b"), &bilet.token)
        .await
        .is_err());
}

#[tokio::test]
async fn iptal_edilen_oturum_gecersiz_olur() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, Some("tenant_a"), "x")
        .await
        .expect("ac");
    assert!(oturum_iptal(&mut conn, "tenant_a", &bilet.token)
        .await
        .expect("iptal"));

    assert!(oturum_dogrula(&mut conn, Some("tenant_a"), &bilet.token)
        .await
        .is_err());
}

#[tokio::test]
async fn suresi_dolus_musteri_oturumu_gecersizdir() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, Some("tenant_a"), "x")
        .await
        .expect("ac");
    sqlx::query("UPDATE customer_sessions SET expires_at = ? WHERE id = ?")
        .bind(simdi_sn() - 1)
        .bind(&bilet.session_id)
        .execute(&mut conn)
        .await
        .expect("sure kisaltilir");

    assert!(oturum_dogrula(&mut conn, Some("tenant_a"), &bilet.token)
        .await
        .is_err());
}

#[tokio::test]
async fn kiraci_bos_gonderilemez() {
    let mut conn = conn().await;
    // Varsayılan kiracıya düşmek, "hiçbir işletmenin verisi" yerine bir
    // işletmenin verisini getirirdi.
    assert!(oturum_ac(&mut conn, None, "x").await.is_err());
    assert!(oturum_ac(&mut conn, Some("  "), "x").await.is_err());
}

// ---- talep ----

#[tokio::test]
async fn gecerli_jetonla_talep_kaydedilir() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, Some("tenant_a"), "x")
        .await
        .expect("ac");
    let govde = r#"[{"product_id":"u1","qty":2}]"#;

    let id = talep_kaydet(&mut conn, Some("tenant_a"), &bilet.token, govde, "az")
        .await
        .expect("talep");

    let satir: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM customer_orders WHERE id = ? AND tenant_id = 'tenant_a'",
    )
    .bind(&id)
    .fetch_one(&mut conn)
    .await
    .expect("sayilir");
    assert_eq!(satir, 1);
}

#[tokio::test]
async fn jetonsuz_talep_kaydedilemez() {
    let mut conn = conn().await;
    assert!(talep_kaydet(
        &mut conn,
        Some("tenant_a"),
        "uydurma",
        r#"[{"product_id":"u1"}]"#,
        ""
    )
    .await
    .is_err());
}

#[tokio::test]
async fn talep_gevsek_urun_alanini_reddeder() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, Some("tenant_a"), "x")
        .await
        .expect("ac");
    assert!(
        talep_kaydet(&mut conn, Some("tenant_a"), &bilet.token, "{}", "")
            .await
            .is_err()
    );
    assert!(
        talep_kaydet(&mut conn, Some("tenant_a"), &bilet.token, "bozuk", "")
            .await
            .is_err()
    );
    assert!(talep_kaydet(
        &mut conn,
        Some("tenant_a"),
        &bilet.token,
        r#"[{"qty":2}]"#,
        ""
    )
    .await
    .is_err());
}

#[tokio::test]
async fn talep_iceren_fiyat_reddedilir() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, Some("tenant_a"), "x")
        .await
        .expect("ac");
    // Müşteri fiyatı kendisi yazamaz: fiyat kayması açığı (P0-7).
    let hata = talep_kaydet(
        &mut conn,
        Some("tenant_a"),
        &bilet.token,
        r#"[{"product_id":"u1","qty":1,"price_cents":1}]"#,
        "",
    )
    .await
    .expect_err("fiyatli talep reddedilmeli");
    assert!(hata.contains("fiyat"));
}

#[tokio::test]
async fn talep_sifir_adet_reddedilir() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, Some("tenant_a"), "x")
        .await
        .expect("ac");
    assert!(talep_kaydet(
        &mut conn,
        Some("tenant_a"),
        &bilet.token,
        r#"[{"product_id":"u1","qty":0}]"#,
        ""
    )
    .await
    .is_err());
}

#[tokio::test]
async fn talep_baska_kiracinin_siparisine_baglanamaz() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, Some("tenant_a"), "x")
        .await
        .expect("ac");
    let talep = talep_kaydet(
        &mut conn,
        Some("tenant_a"),
        &bilet.token,
        r#"[{"product_id":"u1"}]"#,
        "",
    )
    .await
    .expect("talep");
    masa_ve_siparis(&mut conn, "tenant_b", "ord_yabanci").await;

    // Çapraz kiracı bağlantısı kurulamaz.
    assert!(talep_onayla(&mut conn, "tenant_a", &talep, "ord_yabanci")
        .await
        .is_err());
}

#[tokio::test]
async fn kabul_edilen_talep_siparise_baglanir() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, Some("tenant_a"), "x")
        .await
        .expect("ac");
    let talep = talep_kaydet(
        &mut conn,
        Some("tenant_a"),
        &bilet.token,
        r#"[{"product_id":"u1"}]"#,
        "",
    )
    .await
    .expect("talep");
    masa_ve_siparis(&mut conn, "tenant_a", "ord_1").await;

    talep_onayla(&mut conn, "tenant_a", &talep, "ord_1")
        .await
        .expect("kabul");

    let satir: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM customer_orders WHERE id = ? AND status = 'ACCEPTED' AND order_id = 'ord_1'")
            .bind(&talep)
            .fetch_one(&mut conn)
            .await
            .expect("sayilir");
    assert_eq!(satir, 1);
}

#[tokio::test]
async fn iki_kez_onaylanan_talep_tekrar_islenmez() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, Some("tenant_a"), "x")
        .await
        .expect("ac");
    let talep = talep_kaydet(
        &mut conn,
        Some("tenant_a"),
        &bilet.token,
        r#"[{"product_id":"u1"}]"#,
        "",
    )
    .await
    .expect("talep");
    masa_ve_siparis(&mut conn, "tenant_a", "ord_1").await;
    masa_ve_siparis(&mut conn, "tenant_a", "ord_2").await;

    talep_onayla(&mut conn, "tenant_a", &talep, "ord_1")
        .await
        .expect("1");
    // İkinci onay sessizce yutulmaz: durum makinesi ilerlemiyor.
    assert!(talep_onayla(&mut conn, "tenant_a", &talep, "ord_2")
        .await
        .is_err());

    // Durum makinesi PENDING -> ACCEPTED tek seferliktir.
    let bagli: Option<String> =
        sqlx::query_scalar("SELECT order_id FROM customer_orders WHERE id = ?")
            .bind(&talep)
            .fetch_one(&mut conn)
            .await
            .expect("okunur");
    assert_eq!(bagli.as_deref(), Some("ord_1"));
}

#[tokio::test]
async fn bekleyen_talepler_kiracinarin_karismaz() {
    let mut conn = conn().await;
    let a = oturum_ac(&mut conn, Some("tenant_a"), "x")
        .await
        .expect("a");
    let b = oturum_ac(&mut conn, Some("tenant_b"), "y")
        .await
        .expect("b");
    talep_kaydet(
        &mut conn,
        Some("tenant_a"),
        &a.token,
        r#"[{"product_id":"u1"}]"#,
        "",
    )
    .await
    .expect("a");
    talep_kaydet(
        &mut conn,
        Some("tenant_b"),
        &b.token,
        r#"[{"product_id":"u1"}]"#,
        "",
    )
    .await
    .expect("b");

    let liste = bekleyen_talepler(&mut conn, "tenant_a")
        .await
        .expect("liste");
    assert_eq!(liste.len(), 1, "baska kiracinin talebi listelenmemeli");
}

// ---- geri bildirim ----

#[tokio::test]
async fn gecerli_puan_kaydedilir() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, Some("tenant_a"), "x")
        .await
        .expect("ac");

    let id = geri_bildirim_kaydet(&mut conn, Some("tenant_a"), &bilet.token, 4, "iyi")
        .await
        .expect("kayit");
    assert!(id.starts_with("cxf_"));
}

#[tokio::test]
async fn puan_araligi_sinirlandirilir() {
    let mut conn = conn().await;
    let bilet = oturum_ac(&mut conn, Some("tenant_a"), "x")
        .await
        .expect("ac");
    for puan in [0, 6, -1] {
        assert!(
            geri_bildirim_kaydet(&mut conn, Some("tenant_a"), &bilet.token, puan, "")
                .await
                .is_err(),
            "{puan} reddedilmeli"
        );
    }
}

#[tokio::test]
async fn geri_bildirim_jetonsuz_yazilamaz() {
    let mut conn = conn().await;
    assert!(
        geri_bildirim_kaydet(&mut conn, Some("tenant_a"), "yok", 5, "")
            .await
            .is_err()
    );
}
