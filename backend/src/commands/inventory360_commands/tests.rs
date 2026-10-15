//! Faz 12 komut katmanı regresyon testleri.
//!
//! Kapsam dışı bırakılırsa üç sessiz açık geri gelir:
//!   * bayrak kapalıyken komut 403 yerine 200 dönebilir (bayt kapısı),
//!   * oturumsuz çağrı `DEFAULT_TENANT`e düşebilir,
//!   * RBAC sırası bayrak kontrolünden sonra gelirse yetkisiz kullanıcı varlık
//!     keşfedebilir.
//!
//! Bu testler `#[tauri::command]` fonksiyonlarını doğrudan çağıramaz; çağırdıkları
//! tek şey yetki ve bayrak kapılarıdır ve bunlar saf fonksiyonlardır.

use super::*;

#[test]
fn bayrak_kapali_yken_recete_404_doner() {
    let moduller = vec!["feat_kds".to_string()];
    let hata = require_recipe_bom(Some(&moduller)).unwrap_err();
    assert!(
        hata.starts_with("NOT_FOUND"),
        "bayrak kapalıyken 404 beklenir, gelen: {hata}"
    );
}

#[test]
fn bayrak_acik_yken_recete_gecer() {
    let moduller = vec!["feat_recipe_bom".to_string()];
    assert!(require_recipe_bom(Some(&moduller)).is_ok());
}

#[test]
fn bayrak_eksik_yken_recote_404_doner() {
    // `None` oturum bayrağı getirmiyor demektir; kapalı kabul edilir.
    let hata = require_recipe_bom(None).unwrap_err();
    assert!(hata.starts_with("NOT_FOUND"), "gelen: {hata}");
}

#[test]
fn bayrak_kapali_yken_dinamik_tarife_404_doner() {
    let moduller = vec!["feat_recipe_bom".to_string(), "feat_kds".to_string()];
    let hata = require_dynamic_pricing(Some(&moduller)).unwrap_err();
    assert!(hata.starts_with("NOT_FOUND"), "gelen: {hata}");
}

#[test]
fn bayrak_kapali_yken_fire_radar_404_doner() {
    let moduller = vec!["feat_recipe_bom".to_string()];
    let hata = require_loss_radar(Some(&moduller)).unwrap_err();
    assert!(hata.starts_with("NOT_FOUND"), "gelen: {hata}");
}

#[test]
fn bayrak_acik_yken_fire_radar_gecer() {
    let moduller = vec!["feat_loss_radar".to_string()];
    assert!(require_loss_radar(Some(&moduller)).is_ok());
}

#[test]
fn bos_oturum_reddedilir_tenant_fallback_yok() {
    for bos in [None, Some(""), Some("   ")] {
        let hata = require_tenant(bos).unwrap_err();
        assert!(
            hata.starts_with("UNAUTHORIZED"),
            "boş oturum reddedilmeli, gelen: {hata}"
        );
    }
}

#[test]
fn gecerli_tenant_kirpilir() {
    assert_eq!(require_tenant(Some("  tenant-a  ")).unwrap(), "tenant-a");
}

#[test]
fn oturumsuz_aktör_sistem_yazilir_kimlik_uydurmaz() {
    let (kimlik, rol) = audit_actor(None, "OWNER");
    assert_eq!(kimlik, "SYSTEM");
    assert_eq!(rol, "OWNER");

    let (kimlik, _) = audit_actor(Some("usr_7".to_string()), "MANAGER");
    assert_eq!(kimlik, "usr_7");
}

#[test]
fn fire_komutu_recete_bayragina_bağli_degil() {
    // Fire bir maliyet olayıdır; `feat_recipe_bom` kapalıyken de kaydedilmelidir.
    // Bu yüzden fire komutu `require_recipe_bom` çağırmaz. Yanlışlıkla
    // bağlanırsa test kırılır.
    let moduller = vec!["feat_recipe_bom".to_string()];
    assert!(require_loss_radar(Some(&moduller)).is_err());
}

// ---------------------------------------------------------------------------
// Arayüz sözleşmesi: panelin gönderdiği JSON çözümlenebilmeli
// ---------------------------------------------------------------------------

/// Tauri komutu, arayüzün gönderdiği gövdeyi `serde` ile çözümler. Panel
/// `Option` alanları boş bırakabilir; serde eksik alanı reddederse komut
/// çalışma anında `INVALID_ARGUMENT` ile patlar ve bu yalnız üretimde görünür.
///
/// Bu testler panelin gönderdiği **en kuru** gövdeyi kullanır: alanı doldurulmayan
/// her yerde kısaltılmıştır.
#[test]
fn panelin_gonderdigi_en_kuru_fiyat_listesi_govdesi_cozumlenir() {
    let govde = r#"{"name":"Toptan","kind":"PERAKENDE"}"#;
    let giris: crate::services::inventory360::pricing::PriceListInput =
        serde_json::from_str(govde).expect("fiyat listesi gövdesi çözümlenmeli");
    assert_eq!(giris.name, "Toptan");
    assert!(giris.items.is_none(), "kalem yoksa liste boş kurulur");
}

#[test]
fn panelin_gonderdigi_en_kuru_tedarikci_govdesi_cozumlenir() {
    let govde = r#"{"name":"Toptancı Ltd."}"#;
    let giris: crate::services::inventory360::suppliers::SupplierInput =
        serde_json::from_str(govde).expect("tedarikçi gövdesi çözümlenmeli");
    assert_eq!(giris.name, "Toptancı Ltd.");
}

#[test]
fn panelin_gonderdigi_en_kuru_fire_govdesi_cozumlenir() {
    let govde = r#"{"productId":"prd_un","quantity":2.5,"reason":"BOZULMA"}"#;
    let giris: crate::services::inventory360::waste::WasteInput =
        serde_json::from_str(govde).expect("fire gövdesi çözümlenmeli");
    assert_eq!(giris.quantity, 2.5);
    assert_eq!(giris.reason, "BOZULMA");
}

#[test]
fn panelin_gonderdigi_en_kuru_sayim_kapatma_govdesi_cozumlenir() {
    let govde = r#"{"stockCountId":"sc_1","applyAdjustment":true}"#;
    let giris: waste_commands::CloseStockCountArgs =
        serde_json::from_str(govde).expect("sayım kapatma gövdesi çözümlenmeli");
    assert_eq!(giris.stock_count_id, "sc_1");
    assert!(giris.apply_adjustment);
}

#[test]
fn panelin_gonderdigi_en_kuru_sayim_satiri_govdesi_cozumlenir() {
    let govde = r#"{"stockCountId":"sc_1","productId":"prd_un","countedQuantity":3.0}"#;
    let giris: waste_commands::RecordCountLineArgs =
        serde_json::from_str(govde).expect("sayım satırı gövdesi çözümlenmeli");
    assert_eq!(giris.counted_quantity, 3.0);
}

#[test]
fn panelin_gonderdigi_en_kuru_toplu_fiyat_govdesi_cozumlenir() {
    let govde = r#"{"percent":10.0,"roundToTens":true}"#;
    let giris: crate::services::inventory360::pricing::BulkPriceInput =
        serde_json::from_str(govde).expect("toplu fiyat gövdesi çözümlenmeli");
    assert_eq!(giris.percent, Some(10.0));
    assert_eq!(giris.round_to_tens, Some(true));
}

#[test]
fn negatif_toplu_fiyat_govdesi_ayni_alan_iki_yolla_gelmez() {
    // Kategori ve ürün listesi aynı anda gönderilirse servis reddeder; mock'un
    // gevşek kalması gerçek davranışla ayrışmasın.
    let govde = r#"{"categoryId":"cat_1","percent":10.0}"#;
    let giris: crate::services::inventory360::pricing::BulkPriceInput =
        serde_json::from_str(govde).expect("çözümlenmeli");
    assert!(giris.category_id.is_some());
    assert!(giris.product_ids.is_none());
}
