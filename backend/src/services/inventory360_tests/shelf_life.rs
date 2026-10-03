//! Faz 12 · Raf ömrü testleri.
//!
//! Kapsam: dolmuş partinin risk tutarıyla raporlanması, uyarı penceresi,
//! tarihi yazılmamış partinin "bilinmiyor" sayılması, boşalan partinin
//! rapordan çıkması, politikanın geliş tarihine eklenmesi ve çapraz kiracı
//! reddi.
//!
//! `received_at` iki biçimde yazılır: şema varsayılanı `CURRENT_TIMESTAMP`
//! (`2026-10-03 08:52:00`), satın alma ise RFC 3339 (`2026-10-03T08:52:00Z`).
//! Tarih damgalama ikisini de okumak zorunda; yalnız birini okuyan kod
//! üretimde partilerin bir kısmında "tarih okunamadı" hatası verir.

use sqlx::Row;

use super::support::*;
use crate::services::inventory360::shelf_life::*;

const T: &str = "tnt_1";
const T2: &str = "tnt_2";

/// RFC 3339 geliş tarihiyle parti yazar (satın alma teslimi böyle yazar).
async fn rfc3339_parti(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    id: &str,
    urun_id: &str,
    miktar: f64,
    birim_maliyet: i64,
    gun_once: &str,
) {
    sqlx::query(
        "INSERT INTO inventory_batches
             (id, tenant_id, product_id, received_at, initial_quantity,
              remaining_quantity, unit_cost_cents)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(urun_id)
    .bind(format!("{gun_once}T08:00:00Z"))
    .bind(miktar)
    .bind(birim_maliyet)
    .execute(&mut *conn)
    .await
    .expect("parti eklenmeli");
}

#[tokio::test]
async fn dolmus_parti_risk_tutariyla_birlikte_raporlanir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Süt", 1500).await;
    parti_ekle(&mut conn, T, "bat_1", "prd_1", 10.0, 3800, Some(&gun(-3))).await;

    let rapor = expiring_batches(&mut conn, T).await.expect("rapor alinmali");
    assert_eq!(rapor.expired.len(), 1);
    assert_eq!(rapor.expired[0].batch_id, "bat_1");
    assert_eq!(rapor.expired[0].state, Freshness::Expired);
    assert_eq!(rapor.expired[0].days_remaining, Some(-3));
    // Risk tutarı partiden hesaplanır: 10 × 3800 = 38.000 kuruş.
    assert_eq!(rapor.at_risk_cost_cents, 38_000);

    let yalnizca = expired_batches(&mut conn, T).await.expect("rapor alinmali");
    assert_eq!(yalnizca.len(), 1);
    assert_eq!(yalnizca[0].product_name, "Süt");
}

#[tokio::test]
async fn uyari_penceresindeki_parti_ayri_gosterilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Süt", 1500).await;
    parti_ekle(&mut conn, T, "bat_yakin", "prd_1", 5.0, 2000, Some(&gun(2))).await;
    parti_ekle(&mut conn, T, "bat_uzak", "prd_1", 5.0, 2000, Some(&gun(30))).await;

    upsert_shelf_life_policy(
        &mut conn,
        T,
        ShelfLifePolicyInput {
            product_id: "prd_1".to_string(),
            shelf_life_days: 45,
            warning_days: Some(3),
            storage_instruction: None,
            is_active: Some(true),
        },
    )
    .await
    .expect("politika yazilmali");

    let rapor = expiring_batches(&mut conn, T).await.expect("rapor alinmali");
    assert_eq!(rapor.expiring_soon.len(), 1);
    assert_eq!(rapor.expiring_soon[0].batch_id, "bat_yakin");
    assert_eq!(rapor.expiring_soon[0].days_remaining, Some(2));
    assert!(rapor.expired.is_empty());
    assert_eq!(rapor.at_risk_cost_cents, 10_000);

    // Uyarı penceresi daraltılınca uzaklaşan parti de listeye girer.
    upsert_shelf_life_policy(
        &mut conn,
        T,
        ShelfLifePolicyInput {
            product_id: "prd_1".to_string(),
            shelf_life_days: 45,
            warning_days: Some(60.min(44)),
            storage_instruction: None,
            is_active: Some(true),
        },
    )
    .await
    .expect("politika guncellenmeli");
    let genis = expiring_batches(&mut conn, T).await.expect("rapor alinmali");
    assert_eq!(genis.expiring_soon.len(), 2, "genis pencerede iki parti de uyarilir");
}

#[tokio::test]
async fn tarihi_yazilmayan_parti_bilinmiyor_olarak_raporlanir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Süt", 1500).await;
    parti_ekle(&mut conn, T, "bat_1", "prd_1", 10.0, 3800, None).await;

    let rapor = expiring_batches(&mut conn, T).await.expect("rapor alinmali");
    assert_eq!(rapor.expired.len(), 0, "tarihi olmayan parti dolmus sayilmamali");
    assert_eq!(rapor.expiring_soon.len(), 0);
    assert_eq!(rapor.missing_expiry_date.len(), 1);
    assert_eq!(rapor.missing_expiry_date[0].state, Freshness::Unknown);

    // Kalan gün bilinmiyorsa sıfır yazılmaz: "bugün doluyor" ile "tarih yok"
    // karışır ve mutfak tarihi olmayan stoğu bugün kullanır.
    assert_eq!(rapor.missing_expiry_date[0].days_remaining, None);
    assert_ne!(rapor.missing_expiry_date[0].days_remaining, Some(0));
    assert_eq!(rapor.missing_expiry_date[0].expiry_date, None);
    // Tarihi olmayan parti de gıda güvenliği riskidir: risk tutarına girer.
    assert_eq!(rapor.at_risk_cost_cents, 38_000);
}

#[tokio::test]
async fn bosalan_parti_rapora_girmez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Süt", 1500).await;
    parti_ekle(&mut conn, T, "bat_1", "prd_1", 10.0, 3800, Some(&gun(-3))).await;
    parti_ekle(&mut conn, T, "bat_bos", "prd_1", 0.0, 3800, Some(&gun(-3))).await;

    let rapor = expiring_batches(&mut conn, T).await.expect("rapor alinmali");
    // Tükenen partinin dolmuş olması bir risk değildir; rapor yanıltmamalı.
    assert_eq!(rapor.expired.len(), 1);
    assert_eq!(rapor.expired[0].batch_id, "bat_1");
    assert_eq!(rapor.at_risk_cost_cents, 38_000);
}

#[tokio::test]
async fn politika_geregi_tarih_gelis_tarihine_eklenir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Süt", 1500).await;
    rfc3339_parti(&mut conn, T, "bat_1", "prd_1", 10.0, 3800, &gun(0)).await;
    // Şema varsayılanı biçiminde yazılmış ikinci parti: okunabilmeli.
    parti_ekle(&mut conn, T, "bat_2", "prd_1", 10.0, 3800, None).await;

    upsert_shelf_life_policy(
        &mut conn,
        T,
        ShelfLifePolicyInput {
            product_id: "prd_1".to_string(),
            shelf_life_days: 7,
            warning_days: Some(2),
            storage_instruction: Some("2-8 derecede".to_string()),
            is_active: Some(true),
        },
    )
    .await
    .expect("politika yazilmali");

    let tarih = stamp_expiry_from_policy(&mut conn, T, "bat_1")
        .await
        .expect("tarih damgalanmali");
    assert_eq!(tarih, Some(gun(7)), "raf omru gelis tarihine eklenmeli");

    // Aynı hesap şema varsayılanı biçiminde yazılmış partide de çalışır:
    // bu biçimde kayıt yapan yollar var, okumak tek biçimle sınırlı kalmaz.
    let varsayilan = stamp_expiry_from_policy(&mut conn, T, "bat_2")
        .await
        .expect("tarih damgalanmali");
    let bugun_sonrasi = gun(7);
    assert_eq!(
        varsayilan,
        Some(bugun_sonrasi),
        "CURRENT_TIMESTAMP bicimindeki gelis tarihi de okunmali"
    );

    // Pasif politika tarih üretmez: kapalı politika "belirsiz" demektir.
    upsert_shelf_life_policy(
        &mut conn,
        T,
        ShelfLifePolicyInput {
            product_id: "prd_1".to_string(),
            shelf_life_days: 7,
            warning_days: Some(2),
            storage_instruction: None,
            is_active: Some(false),
        },
    )
    .await
    .expect("politika kapatilmali");
    parti_ekle(&mut conn, T, "bat_3", "prd_1", 5.0, 3800, None).await;
    let kapali = stamp_expiry_from_policy(&mut conn, T, "bat_3")
        .await
        .expect("dondurulmemeli");
    assert_eq!(kapali, None, "kapali politika tarih uydurmamali");
}

#[tokio::test]
async fn politika_olmayan_urunde_tarih_uretilmez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Kahve", 4500).await;
    rfc3339_parti(&mut conn, T, "bat_1", "prd_1", 10.0, 3800, &gun(0)).await;

    let tarih = stamp_expiry_from_policy(&mut conn, T, "bat_1")
        .await
        .expect("sorgu hata vermemeli");
    assert_eq!(tarih, None, "politika yoksa tarih uydurulmamali");

    let satir = sqlx::query("SELECT expiry_date FROM inventory_batches WHERE id = 'bat_1'")
        .fetch_one(&mut conn)
        .await
        .expect("parti okunmali");
    assert_eq!(
        satir.try_get::<Option<String>, _>("expiry_date").expect("kolon okunmali"),
        None,
        "partiye tarih yazilmamali"
    );
}

#[tokio::test]
async fn raf_omru_ve_uyari_penceresi_dogrulanir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_1", "Süt", 1500).await;

    let sifir = upsert_shelf_life_policy(
        &mut conn,
        T,
        ShelfLifePolicyInput {
            product_id: "prd_1".to_string(),
            shelf_life_days: 0,
            warning_days: None,
            storage_instruction: None,
            is_active: None,
        },
    )
    .await
    .expect_err("sifir gun reddedilmeli");
    assert!(sifir.contains("büyük"), "neden belirtilmeli: {sifir}");

    let esit = upsert_shelf_life_policy(
        &mut conn,
        T,
        ShelfLifePolicyInput {
            product_id: "prd_1".to_string(),
            shelf_life_days: 7,
            warning_days: Some(7),
            storage_instruction: None,
            is_active: None,
        },
    )
    .await
    .expect_err("raf omrine esit uyari penceresi reddedilmeli");
    assert!(esit.contains("küçük"), "neden belirtilmeli: {esit}");

    let buyuk = upsert_shelf_life_policy(
        &mut conn,
        T,
        ShelfLifePolicyInput {
            product_id: "prd_1".to_string(),
            shelf_life_days: 7,
            warning_days: Some(30),
            storage_instruction: None,
            is_active: None,
        },
    )
    .await
    .expect_err("raf omrunden buyuk uyari penceresi reddedilmeli");
    assert!(buyuk.contains("küçük"), "neden belirtilmeli: {buyuk}");

    let negatif = upsert_shelf_life_policy(
        &mut conn,
        T,
        ShelfLifePolicyInput {
            product_id: "prd_1".to_string(),
            shelf_life_days: 7,
            warning_days: Some(-1),
            storage_instruction: None,
            is_active: None,
        },
    )
    .await
    .expect_err("negatif uyari penceresi reddedilmeli");
    assert!(negatif.contains("küçük"), "neden belirtilmeli: {negatif}");

    let sayi: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM shelf_life_policies")
        .fetch_one(&mut conn)
        .await
        .expect("sorgu calismali");
    assert_eq!(sayi, 0, "reddedilen politika yazilmamali");

    // Geçerli politika ve UPSERT sonrası gerçek kimlik okunur.
    let ilk = upsert_shelf_life_policy(
        &mut conn,
        T,
        ShelfLifePolicyInput {
            product_id: "prd_1".to_string(),
            shelf_life_days: 7,
            warning_days: None,
            storage_instruction: None,
            is_active: None,
        },
    )
    .await
    .expect("politika yazilmali");
    assert_eq!(ilk.warning_days, 3, "varsayilan uyari penceresi 3 gun");
    let ikinci = upsert_shelf_life_policy(
        &mut conn,
        T,
        ShelfLifePolicyInput {
            product_id: "prd_1".to_string(),
            shelf_life_days: 10,
            warning_days: Some(2),
            storage_instruction: None,
            is_active: None,
        },
    )
    .await
    .expect("politika guncellenmeli");
    assert_eq!(ikinci.id, ilk.id, "ayni urun icin ikinci kayit acilmamali");

    let politikalar = list_shelf_life_policies(&mut conn, T).await.expect("politikalar okunmali");
    assert_eq!(politikalar.len(), 1);
    assert_eq!(politikalar[0].shelf_life_days, 10);
}

#[tokio::test]
async fn baska_kiracinin_partisine_tarih_yazilamaz() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, T, "prd_benim", "Süt", 1500).await;
    urun_ekle(&mut conn, T2, "prd_yabanci", "Süt", 9900).await;
    parti_ekle(&mut conn, T, "bat_benim", "prd_benim", 10.0, 3800, Some(&gun(-3))).await;
    parti_ekle(&mut conn, T2, "bat_yabanci", "prd_yabanci", 10.0, 100, Some(&gun(-3))).await;

    let hata = set_batch_expiry(&mut conn, T2, "bat_benim", &gun(10))
        .await
        .expect_err("yabanci partiye tarih yazilamamali");
    assert!(hata.contains("NOT_FOUND") || hata.contains("bulunam"), "neden: {hata}");

    let bicim = set_batch_expiry(&mut conn, T, "bat_benim", "31-12-2026")
        .await
        .expect_err("bozuk tarih reddedilmeli");
    assert!(bicim.contains("YYYY-AA-GG"), "neden belirtilmeli: {bicim}");

    let benim = set_batch_expiry(&mut conn, T, "bat_benim", &gun(10))
        .await
        .expect("kendi partisine tarih yazilmali");
    assert_eq!(benim, (), "yazma komutu bir deger dondurmaz");

    // Yabancı işletmenin raporu kendi riskini görür, bizim partimizi görmez.
    let rapor = expiring_batches(&mut conn, T2).await.expect("rapor alinmali");
    assert_eq!(rapor.expired.len(), 1);
    assert_eq!(rapor.expired[0].batch_id, "bat_yabanci");
    assert_eq!(rapor.at_risk_cost_cents, 1_000, "baska kiracinin riski karismamali");

    let benim_rapor = expiring_batches(&mut conn, T).await.expect("rapor alinmali");
    assert!(benim_rapor.expired.is_empty(), "yazilan tarih sonrasi dolmus degil");
    assert_eq!(benim_rapor.at_risk_cost_cents, 0);
}