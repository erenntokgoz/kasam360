//! Mimari obje yaşam döngüsü: oluştur, taşı, sil.

use super::super::layout;
use super::super::objects;
use super::super::types::{CreateObjectInput, SaveLayoutInput};
use super::*;

fn obje_girdisi(tur: &str, x: i64, y: i64) -> CreateObjectInput {
    CreateObjectInput {
        zone_id: None,
        kind: tur.to_string(),
        label: None,
        x,
        y,
        width: 80,
        height: 80,
        rotation: 0,
    }
}

#[tokio::test]
async fn obje_olusurulur_ve_kiracili_donus() {
    let p = pool().await;
    let mut c = conn(&p).await;

    let id = objects::create_object(&mut c, "tenant-a", &obje_girdisi("DOOR", 200, 300))
        .await
        .unwrap();

    let obje = layout::list_objects(&mut c, "tenant-a", None)
        .await
        .unwrap();
    assert_eq!(obje.len(), 1, "obje oluşturulmadı");
    assert_eq!(obje[0].id, id);
    assert_eq!((obje[0].x, obje[0].y), (200, 300));
    assert!(obje[0].is_active);
}

#[tokio::test]
async fn obje_kiraciya_sinirlidir() {
    let p = pool().await;
    let mut c = conn(&p).await;

    let id = objects::create_object(&mut c, "tenant-a", &obje_girdisi("BAR", 200, 300))
        .await
        .unwrap();

    let yabanci = layout::list_objects(&mut c, "tenant-b", None)
        .await
        .unwrap();
    assert!(yabanci.is_empty(), "obje başka kiracıya göründü");

    // Silme de kiracı sınırlı: başka kiracı silme çağırsaydı 0 satır etkilenir
    // ve hata döner.
    let sonuc = objects::delete_object(&mut c, "tenant-b", &id).await;
    assert!(sonuc.is_err(), "başka kiracının objesi silindi");

    let kalan: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM floor_objects WHERE id = ?")
        .bind(&id)
        .fetch_one(&mut c)
        .await
        .unwrap();
    assert_eq!(kalan, 1, "nesne yanlışlıkla silindi");
}

#[tokio::test]
async fn obje_tasinar_ve_dondurulur() {
    let p = pool().await;
    let mut c = conn(&p).await;

    let id = objects::create_object(&mut c, "tenant-a", &obje_girdisi("BAR", 200, 300))
        .await
        .unwrap();

    let mut tasima = obje_yerlesim(&id, "BAR", 600, 700);
    tasima.rotation = 90;
    tasima.width = 400;
    tasima.height = 60;
    tasima.label = Some("Ana Bar".into());

    layout::save_layout(
        &mut c,
        "tenant-a",
        &SaveLayoutInput {
            tables: vec![],
            objects: vec![tasima],
        },
    )
    .await
    .unwrap();

    let obje = layout::list_objects(&mut c, "tenant-a", None)
        .await
        .unwrap();
    assert_eq!((obje[0].x, obje[0].y, obje[0].rotation), (600, 700, 90));
    assert_eq!(obje[0].width, 400);
    assert_eq!(obje[0].label.as_deref(), Some("Ana Bar"));
}

#[tokio::test]
async fn objeye_bolum_atanabilir_ve_bolum_silinince_baglanti_duser() {
    let p = pool().await;
    let mut c = conn(&p).await;

    let bolum = layout::create_zone(&mut c, "tenant-a", "Teras", 0)
        .await
        .unwrap();
    let mut giris = obje_girdisi("BAR", 200, 300);
    giris.zone_id = Some(bolum.clone());

    objects::create_object(&mut c, "tenant-a", &giris)
        .await
        .unwrap();

    layout::delete_zone(&mut c, "tenant-a", &bolum)
        .await
        .unwrap();

    let obje = layout::list_objects(&mut c, "tenant-a", None)
        .await
        .unwrap();
    assert_eq!(obje.len(), 1, "bölüm silinince obje kayboldu");
    assert!(
        obje[0].zone_id.is_none(),
        "bölüm bağlantısı düşmedi; kroki tutarsız"
    );
}

#[tokio::test]
async fn objeye_baska_kiracinin_bolumu_atanamaz() {
    let p = pool().await;
    let mut c = conn(&p).await;

    let yabanci = layout::create_zone(&mut c, "tenant-b", "Teras", 0)
        .await
        .unwrap();
    let mut giris = obje_girdisi("BAR", 200, 300);
    giris.zone_id = Some(yabanci);

    let sonuc = objects::create_object(&mut c, "tenant-a", &giris).await;
    assert!(
        sonuc.is_err(),
        "objeye yabancı bölüm atandı; çapraz kiracı sızıntısı"
    );
}

#[tokio::test]
async fn olmayan_obje_tasinamaz() {
    let p = pool().await;
    let mut c = conn(&p).await;

    let sonuc = layout::save_layout(
        &mut c,
        "tenant-a",
        &SaveLayoutInput {
            tables: vec![],
            objects: vec![obje_yerlesim("obj_yok", "DOOR", 100, 100)],
        },
    )
    .await;
    assert!(
        sonuc.is_err(),
        "olmayan obje sessizce yok sayıldı; kullanıcı çizimi kayboldu"
    );
}

#[tokio::test]
async fn obje_obturler_cataloglari() {
    // Her obje türünün bir varsayılan ölçüsü olmalı; "kapı ekle" diyen
    // kullanıcı 1 piksel kapı çizmemelidir.
    let turler = [
        ("DOOR", (80, 80)),
        ("BAR", (400, 60)),
        ("WALL", (400, 20)),
        ("COLUMN", (40, 40)),
    ];
    for (tur, beklenen) in turler {
        let (genislik, yukseklik) = crate::services::floor360::types::default_object_size(tur);
        assert_eq!(
            (genislik, yukseklik),
            beklenen,
            "{tur} varsayılan ölçüsü değişti; frontend sözleşmesiyle uyuşmaz"
        );
    }
}
