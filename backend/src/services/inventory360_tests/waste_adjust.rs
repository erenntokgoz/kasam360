//! Fire düzeltme ve iptal testleri.
//!
//! Kapsam: iptalde stoğun düşüldüğü partilere gerçek maliyetle dönmesi, miktar
//! artırma/azaltma farkı, yetersiz stokta ret, kalem değişimi, kiracı yalıtımı ve
//! parti dağılımı olmayan eski kayıt.

use super::support::*;
use crate::services::inventory360::waste::*;

const T: &str = "tnt_1";
const AKTOR: &str = "usr_1";

async fn kalan(conn: &mut sqlx::SqliteConnection, parti: &str) -> f64 {
    sqlx::query_scalar::<_, f64>("SELECT remaining_quantity FROM inventory_batches WHERE id = ?")
        .bind(parti)
        .fetch_one(conn)
        .await
        .expect("parti okunmali")
}

fn duzeltme(id: &str, miktar: f64) -> WasteEditInput {
    WasteEditInput {
        waste_id: id.to_string(),
        product_id: None,
        quantity: miktar,
        notes: None,
    }
}

/// 5 × 3000 + 3 × 4000 = 27.000 kuruş düşen 8 birimlik fire.
async fn iki_partili_fire(conn: &mut sqlx::SqliteConnection) -> WasteRecord {
    urun_ekle(conn, T, "prd_1", "Süt", 1500).await;
    parti_ekle(conn, T, "bat_eski", "prd_1", 5.0, 3000, None).await;
    parti_ekle(conn, T, "bat_yeni", "prd_1", 10.0, 4000, None).await;
    record_waste(
        conn,
        T,
        AKTOR,
        WasteInput {
            product_id: "prd_1".into(),
            reason: "BOZULDU".into(),
            quantity: 8.0,
            occurred_at: None,
            notes: Some("not".into()),
        },
    )
    .await
    .expect("fire kaydedilmeli")
}

#[tokio::test]
async fn iptal_stogu_dusuldugu_partilere_gercek_maliyetle_geri_koyar() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let kayit = iki_partili_fire(&mut conn).await;
    assert_eq!(kalan(&mut conn, "bat_eski").await, 0.0);
    assert_eq!(kalan(&mut conn, "bat_yeni").await, 7.0);

    let sonuc = void_waste(&mut conn, T, AKTOR, &kayit.id, "yanlış girildi")
        .await
        .expect("iptal edilmeli");

    assert_eq!(sonuc.returned_cost_cents, 27_000);
    assert_eq!(kalan(&mut conn, "bat_eski").await, 5.0);
    assert_eq!(kalan(&mut conn, "bat_yeni").await, 10.0);
    assert!(list_waste_records(&mut conn, T, None)
        .await
        .expect("liste")
        .is_empty());
    let kayit_sayisi: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM waste_records")
        .fetch_one(&mut conn)
        .await
        .expect("sorgu");
    assert_eq!(kayit_sayisi, 1, "kayıt silinmez, iptal işaretlenir");
    let tekrar = void_waste(&mut conn, T, AKTOR, &kayit.id, "tekrar").await;
    assert!(
        tekrar.is_err(),
        "iptal edilen fire ikinci kez iptal edilemez"
    );
    assert_eq!(kalan(&mut conn, "bat_eski").await, 5.0);
}

#[tokio::test]
async fn duzenleme_azaltinca_son_dusulen_partiden_iade_eder() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let kayit = iki_partili_fire(&mut conn).await;

    let sonuc = edit_waste(&mut conn, T, AKTOR, duzeltme(&kayit.id, 6.0))
        .await
        .expect("azaltma kabul edilmeli");

    // 8 birimden 2'si geri döner; en son düşülen parti (bat_yeni) önce iade alır.
    assert_eq!(kalan(&mut conn, "bat_eski").await, 0.0);
    assert_eq!(kalan(&mut conn, "bat_yeni").await, 9.0);
    assert_eq!(sonuc.record.quantity, 6.0);
    assert_eq!(sonuc.record.total_cost_cents, Some(27_000 - 8_000));
    assert_eq!(sonuc.previous_total_cost_cents, 27_000);
}

#[tokio::test]
async fn duzenleme_artirinca_fark_kadar_fifo_dusurur() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let kayit = iki_partili_fire(&mut conn).await;

    let sonuc = edit_waste(&mut conn, T, AKTOR, duzeltme(&kayit.id, 10.0))
        .await
        .expect("artırma kabul edilmeli");

    assert_eq!(kalan(&mut conn, "bat_yeni").await, 5.0);
    assert_eq!(sonuc.record.total_cost_cents, Some(27_000 + 8_000));

    // Artırılan kısım da dağılımda: iptal hepsini geri koyar.
    void_waste(&mut conn, T, AKTOR, &kayit.id, "hata")
        .await
        .expect("iptal edilmeli");
    assert_eq!(kalan(&mut conn, "bat_eski").await, 5.0);
    assert_eq!(kalan(&mut conn, "bat_yeni").await, 10.0);
}

#[tokio::test]
async fn yetersiz_stokta_artirma_reddedilir_ve_stok_degismez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let kayit = iki_partili_fire(&mut conn).await;

    let hata = edit_waste(&mut conn, T, AKTOR, duzeltme(&kayit.id, 20.0))
        .await
        .expect_err("stoğu aşan artırma reddedilmeli");
    assert!(hata.contains("aşıyor"), "neden belirtilmeli: {hata}");
    assert_eq!(kalan(&mut conn, "bat_yeni").await, 7.0);
    let kayitli = list_waste_records(&mut conn, T, None).await.expect("liste");
    assert_eq!(kayitli[0].quantity, 8.0);
}

#[tokio::test]
async fn kalem_degisince_eski_kalem_iade_yeni_kalem_dusulur() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let kayit = iki_partili_fire(&mut conn).await;
    urun_ekle(&mut conn, T, "prd_2", "Yoğurt", 900).await;
    parti_ekle(&mut conn, T, "bat_y", "prd_2", 4.0, 500, None).await;

    let sonuc = edit_waste(
        &mut conn,
        T,
        AKTOR,
        WasteEditInput {
            waste_id: kayit.id.clone(),
            product_id: Some("prd_2".into()),
            quantity: 3.0,
            notes: Some("yanlış kalem".into()),
        },
    )
    .await
    .expect("kalem değişmeli");

    assert_eq!(kalan(&mut conn, "bat_eski").await, 5.0);
    assert_eq!(kalan(&mut conn, "bat_yeni").await, 10.0);
    assert_eq!(kalan(&mut conn, "bat_y").await, 1.0);
    assert_eq!(sonuc.record.product_id, "prd_2");
    assert_eq!(sonuc.record.total_cost_cents, Some(1_500));
    assert_eq!(sonuc.record.notes.as_deref(), Some("yanlış kalem"));
}

#[tokio::test]
async fn baska_kiracinin_fire_kaydi_duzeltilemez_ve_iptal_edilemez() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let kayit = iki_partili_fire(&mut conn).await;

    let duzelt = edit_waste(&mut conn, "tnt_2", AKTOR, duzeltme(&kayit.id, 1.0)).await;
    assert!(duzelt.expect_err("reddedilmeli").contains("NOT_FOUND"));
    let iptal = void_waste(&mut conn, "tnt_2", AKTOR, &kayit.id, "x").await;
    assert!(iptal.expect_err("reddedilmeli").contains("NOT_FOUND"));
    assert_eq!(kalan(&mut conn, "bat_yeni").await, 7.0);
}

#[tokio::test]
async fn dagilimi_olmayan_eski_kayit_kendi_maliyetiyle_iade_partisi_acar() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    let kayit = iki_partili_fire(&mut conn).await;
    // Yükseltme öncesi kayıt: dağılım satırı yok.
    sqlx::query("DELETE FROM waste_allocations")
        .execute(&mut conn)
        .await
        .expect("dagilim silinmeli");

    let sonuc = void_waste(&mut conn, T, AKTOR, &kayit.id, "eski kayıt")
        .await
        .expect("iptal edilmeli");

    assert_eq!(sonuc.returned_cost_cents, 8 * 3375);
    let iade: (f64, i64) = sqlx::query_as(
        "SELECT remaining_quantity, unit_cost_cents FROM inventory_batches
          WHERE tenant_id = ? AND batch_code = 'FIRE-IADE'",
    )
    .bind(T)
    .fetch_one(&mut conn)
    .await
    .expect("iade partisi açılmalı");
    assert_eq!(iade, (8.0, 3375));
}
