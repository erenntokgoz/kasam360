//! Kiracı izolasyonu ve bölüm yaşam döngüsü.
//!
//! `tables.zone` SQLite'ta düz metindir (`ALTER TABLE ADD COLUMN` yabancı
//! anahtar kabul etmez). Bu dosyadaki testler, çapraz kiracı sızıntısının
//! tek kapısını korur.

use super::super::layout;
use super::super::types::{SaveLayoutInput, TablePlacement};
use super::*;
use sqlx::Row;

#[tokio::test]
async fn baska_kiracinin_masasi_krokiye_alinamaz() {
    let p = pool().await;
    masa_ekle(&p, "tbl_a", "tenant-a", "Masa A").await;
    masa_ekle(&p, "tbl_b", "tenant-b", "Masa B").await;
    let mut c = conn(&p).await;

    let sonuc = layout::save_layout(
        &mut c,
        "tenant-a",
        &SaveLayoutInput {
            tables: vec![yerlesim("tbl_b", 400, 400, 0, 4)],
            objects: vec![],
        },
    )
    .await;
    assert!(sonuc.is_err(), "başka kiracının masası taşındı");

    let x: i64 = sqlx::query_scalar("SELECT x FROM tables WHERE id = 'tbl_b'")
        .fetch_one(&mut c)
        .await
        .unwrap();
    assert_eq!(x, 0, "başka kiracının masası sessizce taşındı");
}

#[tokio::test]
async fn baska_kiracinin_bolumu_masaya_tanimlanamaz() {
    let p = pool().await;
    masa_ekle(&p, "tbl_a", "tenant-a", "Masa A").await;
    let mut c = conn(&p).await;

    let yabanci = layout::create_zone(&mut c, "tenant-b", "Teras", 0)
        .await
        .unwrap();

    let sonuc = layout::save_layout(
        &mut c,
        "tenant-a",
        &SaveLayoutInput {
            tables: vec![TablePlacement {
                table_id: "tbl_a".into(),
                x: 100,
                y: 100,
                rotation: 0,
                seats: 4,
                zone_id: Some(yabanci),
            }],
            objects: vec![],
        },
    )
    .await;
    assert!(
        sonuc.is_err(),
        "başka kiracının bölümü masaya tanımlandı; çapraz kiracı sızıntısı"
    );
}

#[tokio::test]
async fn baska_kiracinin_bolumu_boylece_duser() {
    // Sızıntı yalnız yazmada değil, silmede de olabilir: başka kiracının
    // bölümü silinirse o salonun çizimi dağınır.
    let p = pool().await;
    masa_ekle(&p, "tbl_a", "tenant-a", "Masa A").await;
    let mut c = conn(&p).await;

    let yabanci = layout::create_zone(&mut c, "tenant-b", "Teras", 0)
        .await
        .unwrap();

    let sonuc = layout::delete_zone(&mut c, "tenant-a", &yabanci).await;
    assert!(sonuc.is_err(), "başka kiracının bölümü silindi");

    let kalan: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM floor_zones WHERE id = ?")
        .bind(&yabanci)
        .fetch_one(&mut c)
        .await
        .unwrap();
    assert_eq!(kalan, 1, "başka kiracının bölüm kaydı kayboldu");
}

#[tokio::test]
async fn kroki_okuma_kiraciya_sinirlidir() {
    let p = pool().await;
    masa_ekle(&p, "tbl_a", "tenant-a", "Masa A").await;
    masa_ekle(&p, "tbl_b", "tenant-b", "Masa B").await;
    let mut c = conn(&p).await;

    let duzen = layout::get_layout(&mut c, "tenant-a", None).await.unwrap();
    assert_eq!(
        duzen.tables.len(),
        1,
        "başka kiracının masası krokide göründü"
    );
    assert_eq!(duzen.tables[0].id, "tbl_a");
}

#[tokio::test]
async fn bolum_silme_masayi_silmez_yalniz_baglantiyi_duser() {
    let p = pool().await;
    masa_ekle(&p, "tbl_a", "tenant-a", "Masa A").await;
    let mut c = conn(&p).await;

    let bolum = layout::create_zone(&mut c, "tenant-a", "Teras", 0)
        .await
        .unwrap();
    layout::save_layout(
        &mut c,
        "tenant-a",
        &SaveLayoutInput {
            tables: vec![TablePlacement {
                table_id: "tbl_a".into(),
                x: 100,
                y: 100,
                rotation: 0,
                seats: 6,
                zone_id: Some(bolum.clone()),
            }],
            objects: vec![],
        },
    )
    .await
    .unwrap();

    layout::delete_zone(&mut c, "tenant-a", &bolum)
        .await
        .unwrap();

    let satir = sqlx::query("SELECT zone, seats FROM tables WHERE id = 'tbl_a'")
        .fetch_one(&mut c)
        .await
        .unwrap();
    assert!(
        satir
            .try_get::<Option<String>, _>("zone")
            .unwrap()
            .is_none(),
        "bölüm bağlantısı düşmedi"
    );
    assert_eq!(
        satir.try_get::<i64, _>("seats").unwrap(),
        6,
        "bölüm silinince masa kaydı bozulmamalı; sandalye sayısı korunmalı"
    );
}

#[tokio::test]
async fn ayni_isimli_bolum_ikinci_kez_acilamaz() {
    let p = pool().await;
    let mut c = conn(&p).await;

    layout::create_zone(&mut c, "tenant-a", "Ana Salon", 0)
        .await
        .unwrap();
    let sonuc = layout::create_zone(&mut c, "tenant-a", "Ana Salon", 1).await;
    assert!(sonuc.is_err(), "çakışan bölüm adı kabul edildi");
}

#[tokio::test]
async fn ayni_ad_farkli_kiracida_calisir() {
    // Aynı ad çakışması **kiracı içinde** geçerlidir; iki işletme de
    // "Ana Salon" diyebilmelidir.
    let p = pool().await;
    let mut c = conn(&p).await;

    layout::create_zone(&mut c, "tenant-a", "Ana Salon", 0)
        .await
        .unwrap();
    let sonuc = layout::create_zone(&mut c, "tenant-b", "Ana Salon", 0).await;
    assert!(sonuc.is_ok(), "farklı kiracıda aynı bölüm adı reddedildi");
}

#[tokio::test]
async fn bos_isimli_bolum_acilamaz() {
    let p = pool().await;
    let mut c = conn(&p).await;

    let sonuc = layout::create_zone(&mut c, "tenant-a", "   ", 0).await;
    assert!(sonuc.is_err(), "boş bölüm adı kabul edildi");
}
