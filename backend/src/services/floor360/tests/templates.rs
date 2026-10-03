//! Hazır şablonlar: ızgara uyumu, yeniden uygulama, kiracı yalıtımı.
//!
//! Kritik kural: şablon uygulaması **kullanıcının el emeğini silmez**.
//! Yalnız kendi ürettiği objeleri (`template_id` etiketli) yeniden yazar.

use super::super::layout;
use super::super::objects;
use super::super::templates;
use super::super::types::{
    CreateObjectInput, ALLOWED_SEATS, CANVAS_HEIGHT, CANVAS_WIDTH, GRID, OBJECT_KINDS,
    ROTATION_STEP,
};
use super::*;

#[tokio::test]
async fn dort_hazir_sablon_listelenir() {
    let sablonlar = objects::list_templates().await.unwrap();
    assert_eq!(sablonlar.len(), 4, "dört hazır şablon tanımlı olmalı");
    let kimlikler: Vec<&str> = sablonlar.iter().map(|(id, _, _)| id.as_str()).collect();
    for beklenen in ["klasik_kafe", "ocakbasi", "fast_food", "teras"] {
        assert!(kimlikler.contains(&beklenen), "şablon eksik: {beklenen}");
    }
}

#[tokio::test]
async fn sablon_listesinde_ad_ve_aciklama_bos_degil() {
    let sablonlar = objects::list_templates().await.unwrap();
    for (id, ad, aciklama) in sablonlar {
        assert!(!ad.trim().is_empty(), "{id} adı boş");
        assert!(!aciklama.trim().is_empty(), "{id} açıklaması boş");
    }
}

#[tokio::test]
async fn her_sablon_masalarini_izgaraya_oturtur() {
    // Şablon uygulandıktan sonra masalar 20 px ızgarada olmalı; değilse ilk
    // sürüklemede zıplarlar ve kullanıcı "kaydettim yine kaydı" der.
    for sablon in templates::ALL {
        for masa in sablon.tables.iter().take(sablon.table_count) {
            assert_eq!(
                masa.x % GRID,
                0,
                "{} şablonunda x ızgaraya oturmuyor: {}",
                sablon.id,
                masa.x
            );
            assert_eq!(
                masa.y % GRID,
                0,
                "{} şablonunda y ızgaraya oturmuyor: {}",
                sablon.id,
                masa.y
            );
            assert!(
                masa.rotation % ROTATION_STEP == 0,
                "{} şablonunda döndürme adımı yanlış",
                sablon.id
            );
            assert!(
                ALLOWED_SEATS.contains(&masa.seats),
                "{} şablonunda sandalye sayısı katalog dışı",
                sablon.id
            );
        }
    }
}

#[tokio::test]
async fn sablon_izgarasi_dort_yuz_elli_alti_altinda_kalmaz() {
    // Şablon tuvalden taşarsa uygulama sonrası masalar görünmez konumda kalır.
    for sablon in templates::ALL {
        for masa in sablon.tables.iter().take(sablon.table_count) {
            assert!(
                masa.x <= CANVAS_WIDTH && masa.y <= CANVAS_HEIGHT,
                "{} şablonunda masa tuvali taşıyor: ({}, {})",
                sablon.id,
                masa.x,
                masa.y
            );
        }
    }
}

#[tokio::test]
async fn her_sablon_gecerli_objeler_tasiyor() {
    for sablon in templates::ALL {
        assert!(
            !sablon.objects.is_empty(),
            "{} şablonunda mimari obje yok",
            sablon.id
        );
        for obje in sablon.objects {
            assert!(
                OBJECT_KINDS.contains(&obje.kind),
                "{} şablonunda katalog dışı obje türü: {}",
                sablon.id,
                obje.kind
            );
            assert!(
                obje.x + obje.width <= CANVAS_WIDTH && obje.y + obje.height <= CANVAS_HEIGHT,
                "{} şablonunda obje tuvali taşıyor: {}",
                sablon.id,
                obje.kind
            );
        }
    }
}

#[tokio::test]
async fn sablon_masalar_ve_objeler_yerlestirir() {
    let p = pool().await;
    // Klasik Kafe sekiz masa ister; dokuz masa verilirse dokuzuncusu
    // yerleşmeden (0,0)'da kalmalı ve şablon **masa uydurmamalı**.
    for i in 1..=9 {
        masa_ekle(&p, &format!("tbl_{i}"), "tenant-a", &format!("Masa {i}")).await;
    }
    let mut c = conn(&p).await;

    let ad = objects::apply_template(&mut c, "tenant-a", "klasik_kafe")
        .await
        .unwrap();
    assert_eq!(ad, "Klasik Kafe");

    let duzen = layout::get_layout(&mut c, "tenant-a", None).await.unwrap();
    assert_eq!(
        duzen.tables.len(),
        9,
        "şablon masa uydurdu veya kayıp masa var"
    );

    let yerlestirilen = duzen.tables.iter().filter(|t| t.x != 0 || t.y != 0).count();
    assert_eq!(yerlestirilen, 8, "şablon masaları konumlandırmadı");

    assert!(!duzen.objects.is_empty(), "şablon objeleri yaratmadı");
}

#[tokio::test]
async fn sablon_az_masa_varsa_var_olani_konumlandirir() {
    let p = pool().await;
    masa_ekle(&p, "tbl_1", "tenant-a", "Masa 1").await;
    masa_ekle(&p, "tbl_2", "tenant-a", "Masa 2").await;
    let mut c = conn(&p).await;

    // Teras altı masa ister; işletmede iki masa var.
    objects::apply_template(&mut c, "tenant-a", "teras")
        .await
        .unwrap();
    let duzen = layout::get_layout(&mut c, "tenant-a", None).await.unwrap();
    assert_eq!(duzen.tables.len(), 2, "şablon masa uydurdu");

    let yerlestirilen = duzen.tables.iter().filter(|t| t.x != 0 || t.y != 0).count();
    assert_eq!(yerlestirilen, 2, "var olan iki masa konumlanmadı");
}

#[tokio::test]
async fn bilinmeyen_sablon_not_found_doner() {
    let p = pool().await;
    masa_ekle(&p, "tbl_1", "tenant-a", "Masa 1").await;
    let mut c = conn(&p).await;

    let sonuc = objects::apply_template(&mut c, "tenant-a", "uzay_kahvesi").await;
    let hata = sonuc.unwrap_err();
    assert!(
        hata.starts_with("NOT_FOUND"),
        "bilinmeyen şablon NOT_FOUND dönmeli, verdi: {hata}"
    );
}

#[tokio::test]
async fn sablon_masasi_yoksa_uyari_verir() {
    let p = pool().await;
    let mut c = conn(&p).await;
    let sonuc = objects::apply_template(&mut c, "tenant-a", "klasik_kafe").await;
    assert!(sonuc.is_err(), "masasız salona şablon uygulandı");
}

#[tokio::test]
async fn sablon_iki_kez_uygulanirsa_objeler_ciftlenmez() {
    let p = pool().await;
    masa_ekle(&p, "tbl_1", "tenant-a", "Masa 1").await;
    let mut c = conn(&p).await;

    objects::apply_template(&mut c, "tenant-a", "fast_food")
        .await
        .unwrap();
    let ilk = layout::get_layout(&mut c, "tenant-a", None).await.unwrap();
    let ilk_kapi = ilk.objects.iter().filter(|o| o.kind == "DOOR").count();

    objects::apply_template(&mut c, "tenant-a", "fast_food")
        .await
        .unwrap();
    let ikinci = layout::get_layout(&mut c, "tenant-a", None).await.unwrap();
    let ikinci_kapi = ikinci.objects.iter().filter(|o| o.kind == "DOOR").count();

    assert_eq!(
        ikinci_kapi, ilk_kapi,
        "şablon ikinci kez uygulandığında kapılar çiftlendi"
    );
    assert!(ilk_kapi >= 2, "Fast Food şablonunda giriş ve çıkış olmalı");
}

#[tokio::test]
async fn sablon_kullanici_objesini_silmez() {
    // Şablon uygulamak "baştan çiz" değil, "şu yerleşimi öner" işlemidir.
    // Elle konan kapı, şablon uygulanınca da durmalıdır.
    let p = pool().await;
    masa_ekle(&p, "tbl_1", "tenant-a", "Masa 1").await;
    let mut c = conn(&p).await;

    objects::apply_template(&mut c, "tenant-a", "klasik_kafe")
        .await
        .unwrap();
    let elle = objects::create_object(
        &mut c,
        "tenant-a",
        &CreateObjectInput {
            zone_id: None,
            kind: "DOOR".into(),
            label: Some("Kritik Çıkış".into()),
            x: 3000,
            y: 2000,
            width: 80,
            height: 80,
            rotation: 0,
        },
    )
    .await
    .unwrap();

    // Aynı şablon ikinci kez uygulanır.
    objects::apply_template(&mut c, "tenant-a", "klasik_kafe")
        .await
        .unwrap();

    let kalan: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM floor_objects WHERE id = ?")
        .bind(&elle)
        .fetch_one(&mut c)
        .await
        .unwrap();
    assert_eq!(
        kalan, 1,
        "şablon uygulaması kullanıcının elle koyduğu kapıyı sildi"
    );
}

#[tokio::test]
async fn sablon_baska_kiracinin_masalarina_dokunmaz() {
    let p = pool().await;
    masa_ekle(&p, "tbl_a", "tenant-a", "Masa A").await;
    masa_ekle(&p, "tbl_b", "tenant-b", "Masa B").await;
    let mut c = conn(&p).await;

    objects::apply_template(&mut c, "tenant-a", "klasik_kafe")
        .await
        .unwrap();
    let x: i64 = sqlx::query_scalar("SELECT x FROM tables WHERE id = 'tbl_b'")
        .fetch_one(&mut c)
        .await
        .unwrap();
    assert_eq!(x, 0, "şablon başka kiracının masasını taşıdı");
}
