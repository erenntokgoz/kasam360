//! Atomiklik: bir kayıt reddedilirse hiçbiri yazılmaz.
//!
//! İki ayrı garanti sınanır ve ikisi farklı yerlerde yaşar:
//!
//! 1. **Yazma öncesi doğrulama** — geçersiz açı, katalog dışı sandalye gibi
//!    hatalar `save_layout` içinde, hiçbir `UPDATE` çalışmadan yakalanır.
//!    Transaction olmadan da güvendedir.
//!
//! 2. **Yazma sırasında keşfedilen hata** — "olmayan masa" ancak `UPDATE`
//!    sırasında öğrenilir. Burada güvenceyi **çağıran komutun** transaction'ı
//!    sağlar; test de komutu taklit eder. Servis kendi transaction'ını
//!    açmaz, çünkü komut denetim kaydını da aynı transaction'a yazmak
//!    zorundadır ve iç içe `BEGIN` SQLite'ta hata verir.

use super::super::layout;
use super::super::types::{SaveLayoutInput, TablePlacement};
use super::*;
use sqlx::Row;

#[tokio::test]
async fn gecersiz_masa_tum_dzeni_geri_alir() {
    let p = pool().await;
    masa_ekle(&p, "tbl_1", "tenant-a", "Masa 1").await;
    masa_ekle(&p, "tbl_2", "tenant-a", "Masa 2").await;
    let mut c = conn(&p).await;

    // İlk masa geçerli, ikinci masa geçersiz döndürme taşıyor. Doğrulama
    // yazmadan önce bittiği için ilk masa hiç yazılmamalı.
    let sonuc = layout::save_layout(
        &mut c,
        "tenant-a",
        &SaveLayoutInput {
            tables: vec![
                yerlesim("tbl_1", 400, 400, 0, 4),
                yerlesim("tbl_2", 800, 800, 7, 4),
            ],
            objects: vec![],
        },
    )
    .await;
    assert!(sonuc.is_err());

    let x: i64 = sqlx::query_scalar("SELECT x FROM tables WHERE id = 'tbl_1'")
        .fetch_one(&mut c)
        .await
        .unwrap();
    assert_eq!(
        x, 0,
        "geçersiz ikinci masa yüzünden ilk masa yazıldı; kısmi kayıt oluştu"
    );
}

#[tokio::test]
async fn yabanci_bolum_tum_dzeni_geri_alir() {
    // Bölüm denetimi de yazmadan önce biter: ilk masa yazılıp ikinci masa
    // yabancı bölüme bağlanmaya çalışsa salon yarım kalmamalı.
    let p = pool().await;
    masa_ekle(&p, "tbl_1", "tenant-a", "Masa 1").await;
    masa_ekle(&p, "tbl_2", "tenant-a", "Masa 2").await;
    let mut c = conn(&p).await;

    let yabanci = layout::create_zone(&mut c, "tenant-b", "Teras", 0)
        .await
        .unwrap();

    let sonuc = layout::save_layout(
        &mut c,
        "tenant-a",
        &SaveLayoutInput {
            tables: vec![
                yerlesim("tbl_1", 400, 400, 0, 4),
                TablePlacement {
                    table_id: "tbl_2".into(),
                    x: 800,
                    y: 800,
                    rotation: 0,
                    seats: 4,
                    zone_id: Some(yabanci),
                },
            ],
            objects: vec![],
        },
    )
    .await;
    assert!(sonuc.is_err());

    let x: i64 = sqlx::query_scalar("SELECT x FROM tables WHERE id = 'tbl_1'")
        .fetch_one(&mut c)
        .await
        .unwrap();
    assert_eq!(x, 0, "yabancı bölüm yüzünden ilk masa yazıldı");
}

#[tokio::test]
async fn olmayan_masa_yazma_tum_dzeni_geri_alir() {
    // Komut katmanının yaptığı gibi: BEGIN IMMEDIATE, iş, hata halinde ROLLBACK.
    let p = pool().await;
    masa_ekle(&p, "tbl_1", "tenant-a", "Masa 1").await;
    let mut c = conn(&p).await;

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut c)
        .await
        .unwrap();

    let sonuc = layout::save_layout(
        &mut c,
        "tenant-a",
        &SaveLayoutInput {
            tables: vec![
                yerlesim("tbl_1", 400, 400, 0, 4),
                yerlesim("tbl_olmayan", 800, 800, 0, 4),
            ],
            objects: vec![],
        },
    )
    .await;
    assert!(sonuc.is_err(), "olmayan masa kabul edildi");
    sqlx::query("ROLLBACK").execute(&mut c).await.unwrap();

    let x: i64 = sqlx::query_scalar("SELECT x FROM tables WHERE id = 'tbl_1'")
        .fetch_one(&mut c)
        .await
        .unwrap();
    assert_eq!(x, 0, "olmayan masa yüzünden önceki yazma kaldı");
}

#[tokio::test]
async fn basarili_kayitta_yazimlar_kalici() {
    // Atomiklik testinin ters yönü: hata yoksa yazılar **kalmalı**. Yalnız
    // "her şey geri alındı" diyen bir test, yazmanın hiç çalışmadığını da
    // kanıtlar; bu test yazmanın gerçekten gerçekleştiğini gösterir.
    let p = pool().await;
    masa_ekle(&p, "tbl_1", "tenant-a", "Masa 1").await;
    let mut c = conn(&p).await;

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut c)
        .await
        .unwrap();
    layout::save_layout(
        &mut c,
        "tenant-a",
        &SaveLayoutInput {
            tables: vec![yerlesim("tbl_1", 400, 400, 90, 6)],
            objects: vec![],
        },
    )
    .await
    .unwrap();
    sqlx::query("COMMIT").execute(&mut c).await.unwrap();

    let satir = sqlx::query("SELECT x, y, rotation, seats FROM tables WHERE id = 'tbl_1'")
        .fetch_one(&mut c)
        .await
        .unwrap();
    let x: i64 = satir.try_get("x").unwrap();
    let rotation: i64 = satir.try_get("rotation").unwrap();
    let seats: i64 = satir.try_get("seats").unwrap();
    assert_eq!((x, rotation, seats), (400, 90, 6), "yazma kaydedilmedi");
}
