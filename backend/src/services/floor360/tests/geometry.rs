//! Geometri sözleşmesi: ızgara, döndürme, sandalye, obje türü.

use super::super::layout;
use super::super::objects;
use super::super::types::{
    CreateObjectInput, SaveLayoutInput, ALLOWED_SEATS, CANVAS_HEIGHT, CANVAS_WIDTH, GRID,
    OBJECT_KINDS, ROTATION_STEP,
};
use super::*;

#[tokio::test]
async fn izgara_yirmi_piksel_ve_dondurme_on_bes_adim() {
    // İki sabit de vardır; frontend `snap.ts` aynı değerleri taşır, saparsa
    // snap ızgarası ile kaydedilen konum birbirinden ayrılır.
    assert_eq!(GRID, 20);
    assert_eq!(ROTATION_STEP, 15);
}

#[tokio::test]
async fn masa_konumu_tuzval_sinirinda_kalir() {
    let p = pool().await;
    masa_ekle(&p, "tbl_1", "tenant-a", "Masa 1").await;
    let mut c = conn(&p).await;

    for (etiket, x, y) in [
        ("tuval dışı x", CANVAS_WIDTH + 20, 100),
        ("tuval dışı y", 100, CANVAS_HEIGHT + 20),
        ("negatif x", -20, 100),
        ("negatif y", 100, -20),
    ] {
        let sonuc = layout::save_layout(
            &mut c,
            "tenant-a",
            &SaveLayoutInput {
                tables: vec![yerlesim("tbl_1", x, y, 0, 4)],
                objects: vec![],
            },
        )
        .await;
        assert!(sonuc.is_err(), "{etiket} kabul edildi; masa kaybolur");
    }
}

#[tokio::test]
async fn dondurme_on_bes_adimda_ilerler() {
    let p = pool().await;
    masa_ekle(&p, "tbl_1", "tenant-a", "Masa 1").await;
    let mut c = conn(&p).await;

    for aci in [0, 15, 90, 180, 345] {
        let sonuc = layout::save_layout(
            &mut c,
            "tenant-a",
            &SaveLayoutInput {
                tables: vec![yerlesim("tbl_1", 200, 200, aci, 4)],
                objects: vec![],
            },
        )
        .await;
        assert!(sonuc.is_ok(), "{aci} derece reddedildi: {sonuc:?}");
    }

    // 7 derece kabul edilirse masa ızgaradan kopar ve sonraki her sürüklemede
    // kayar. 360 derece de reddedilir: 0 ile aynı olması gerekir, kabul
    // edilirse "0 mı 360 mı" ayrımı belirsizleşir.
    for aci in [7, 360, 400, -15] {
        let sonuc = layout::save_layout(
            &mut c,
            "tenant-a",
            &SaveLayoutInput {
                tables: vec![yerlesim("tbl_1", 200, 200, aci, 4)],
                objects: vec![],
            },
        )
        .await;
        assert!(sonuc.is_err(), "{aci} derece kabul edildi; ızgaradan kopar");
    }
}

#[tokio::test]
async fn sandalye_sayisi_katalogla_sinirli() {
    let p = pool().await;
    masa_ekle(&p, "tbl_1", "tenant-a", "Masa 1").await;
    let mut c = conn(&p).await;

    for adet in ALLOWED_SEATS {
        let sonuc = layout::save_layout(
            &mut c,
            "tenant-a",
            &SaveLayoutInput {
                tables: vec![yerlesim("tbl_1", 200, 200, 0, adet)],
                objects: vec![],
            },
        )
        .await;
        assert!(sonuc.is_ok(), "{adet} sandalye reddedildi: {sonuc:?}");
    }

    for adet in [0, 1, 3, 5, 7, 12, -4] {
        let sonuc = layout::save_layout(
            &mut c,
            "tenant-a",
            &SaveLayoutInput {
                tables: vec![yerlesim("tbl_1", 200, 200, 0, adet)],
                objects: vec![],
            },
        )
        .await;
        assert!(sonuc.is_err(), "katalog dışı sandalye kabul edildi: {adet}");
    }
}

#[tokio::test]
async fn obje_turu_katalogla_sinirli() {
    // Obje türü denetimi **oluşturma** yolunda sınanır: düzen kaydetme yalnız
    // var olan objeyi taşır, yeni obje yaratmaz.
    let p = pool().await;
    let mut c = conn(&p).await;
    let bolum = layout::create_zone(&mut c, "tenant-a", "Ana Salon", 0)
        .await
        .unwrap();

    for tur in OBJECT_KINDS {
        let sonuc = objects::create_object(
            &mut c,
            "tenant-a",
            &CreateObjectInput {
                zone_id: Some(bolum.clone()),
                kind: tur.to_string(),
                label: None,
                x: 100,
                y: 100,
                width: 80,
                height: 80,
                rotation: 0,
            },
        )
        .await;
        assert!(sonuc.is_ok(), "{tur} reddedildi: {sonuc:?}");
    }

    let sonuc = objects::create_object(
        &mut c,
        "tenant-a",
        &CreateObjectInput {
            zone_id: None,
            kind: "HAVUZ".into(),
            label: None,
            x: 100,
            y: 100,
            width: 80,
            height: 80,
            rotation: 0,
        },
    )
    .await;
    assert!(sonuc.is_err(), "katalog dışı obje türü kabul edildi");
}

#[tokio::test]
async fn obje_olculeri_katalogla_sinirli() {
    let p = pool().await;
    let mut c = conn(&p).await;

    for (genislik, yukseklik) in [(19, 80), (80, 19), (2001, 80)] {
        let sonuc = objects::create_object(
            &mut c,
            "tenant-a",
            &CreateObjectInput {
                zone_id: None,
                kind: "DOOR".into(),
                label: None,
                x: 100,
                y: 100,
                width: genislik,
                height: yukseklik,
                rotation: 0,
            },
        )
        .await;
        assert!(
            sonuc.is_err(),
            "{genislik}x{yukseklik} ölçü kabul edildi; görünmez obje tuvali kirletir"
        );
    }
}
