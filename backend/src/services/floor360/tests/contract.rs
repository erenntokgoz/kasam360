//! Sözleşme sabitleri: ısı haritası verisi, durum ayrımı, rol kapıları.

use super::super::layout;
use super::super::types::SaveLayoutInput;
use super::*;

#[tokio::test]
async fn isi_haritasi_durumu_gercek_durumdan_okur() {
    // Isı haritası ayrı alan değildir; `tables.status`tan türetilir. Ayrı bir
    // alan tutulsaydı ısı haritası bayat kalır ve patron dolu masayı boş görürdü.
    let p = pool().await;
    masa_ekle(&p, "tbl_bos", "tenant-a", "Masa Boş").await;
    masa_ekle(&p, "tbl_dolu", "tenant-a", "Masa Dolu").await;
    masa_ekle(&p, "tbl_rez", "tenant-a", "Masa Rezerve").await;
    sqlx::query("UPDATE tables SET status = 'OCCUPIED' WHERE id = 'tbl_dolu'")
        .execute(&p)
        .await
        .unwrap();
    sqlx::query("UPDATE tables SET status = 'RESERVED' WHERE id = 'tbl_rez'")
        .execute(&p)
        .await
        .unwrap();

    let mut c = conn(&p).await;
    let duzen = layout::get_layout(&mut c, "tenant-a", None).await.unwrap();
    let durum = |id: &str| {
        duzen
            .tables
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.status.clone())
            .unwrap()
    };
    assert_eq!(durum("tbl_bos"), "AVAILABLE");
    assert_eq!(durum("tbl_dolu"), "OCCUPIED");
    assert_eq!(durum("tbl_rez"), "RESERVED");
}

#[tokio::test]
async fn kroki_konumlandirmasi_durumu_degistirmez() {
    // Geometri ile işletim durumu ayrı kaygılardır: masa taşınınca doluluk
    // değişmemelidir, doluluğu değiştirmek kroki kaydının işi değildir.
    let p = pool().await;
    masa_ekle(&p, "tbl_1", "tenant-a", "Masa 1").await;
    sqlx::query("UPDATE tables SET status = 'OCCUPIED' WHERE id = 'tbl_1'")
        .execute(&p)
        .await
        .unwrap();
    let mut c = conn(&p).await;

    layout::save_layout(
        &mut c,
        "tenant-a",
        &SaveLayoutInput {
            tables: vec![yerlesim("tbl_1", 600, 600, 90, 8)],
            objects: vec![],
        },
    )
    .await
    .unwrap();

    let durum: String = sqlx::query_scalar("SELECT status FROM tables WHERE id = 'tbl_1'")
        .fetch_one(&mut c)
        .await
        .unwrap();
    assert_eq!(durum, "OCCUPIED", "kroki kaydı doluluğu bozdu");
}

#[tokio::test]
async fn okuma_kapilari_tum_salon_rollerine_acik() {
    // Garson masayı bulmak zorunda; salon garsona kapalı olursa akşam servisi
    // masasını göremez.
    let salon = [
        crate::rbac::Role::Owner,
        crate::rbac::Role::Manager,
        crate::rbac::Role::Cashier,
        crate::rbac::Role::Waiter,
        crate::rbac::Role::Kitchen,
    ];
    for rol in ["OWNER", "MANAGER", "CASHIER", "WAITER", "KITCHEN"] {
        assert!(
            crate::rbac::require_any(rol, &salon).is_ok(),
            "{rol} salonu görememeli"
        );
    }
}

#[tokio::test]
async fn cizim_kapisi_garsona_kapali() {
    // Garson salonu görür ama yerleşimi değiştiremez: yanlışlıkla masa
    // taşınan bir akşam servisi kaybolur.
    let cizim = [crate::rbac::Role::Owner, crate::rbac::Role::Manager];
    for rol in ["OWNER", "MANAGER"] {
        assert!(
            crate::rbac::require_any(rol, &cizim).is_ok(),
            "{rol} kroki çizememeli"
        );
    }
    for rol in ["CASHIER", "WAITER", "KITCHEN", "MASTER"] {
        assert!(
            crate::rbac::require_any(rol, &cizim).is_err(),
            "{rol} kroki çizebildi; kapı sızdı"
        );
    }
}

#[tokio::test]
async fn tuval_boyutlari_frontend_sablonuyle_ayni() {
    // Frontend tuvali CSS boyutundan hesaplar ve sabit kodlar. Sabitler
    // ayrışırsa masa tuvalin dışında çizilir ve kaydetme reddedilir.
    let p = pool().await;
    let mut c = conn(&p).await;
    let duzen = layout::get_layout(&mut c, "tenant-a", None).await.unwrap();
    assert_eq!(duzen.canvas_width, 4000);
    assert_eq!(duzen.canvas_height, 3000);
    assert_eq!(duzen.grid, 20);
    assert_eq!(duzen.rotation_step, 15);
}
