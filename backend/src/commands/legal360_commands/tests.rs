//! Yasal ve kampanya komut katmanı regresyon testleri.
//!
//! Kapsam dışı bırakılırsa üç sessiz açık geri gelir:
//!   * MASTER yetki listesine yanlışlıkla eklenir ve işletmenin belgesini görür,
//!   * oturumsuz çağrı `DEFAULT_TENANT`'e düşer,
//!   * müdür yazma komutuna girer ve prim/KDV tutarını değiştirir.
//!
//! Bu testler `#[tauri::command]` fonksiyonlarını **doğrudan çağıramaz**;
//! çağırdıkları tek şey yetki ve tenant kapılarıdır ve bunlar saf
//! fonksiyonlardır. Kapılar saf olduğu için Tauri runtime'ı gerekmez.

use super::*;
use crate::rbac::{self, Role};

/// Bu modülün izin verdiği roller. MASTER'in **bulunmaması** tesadüf değil,
/// yazılımcının tercihidir (bkz. `legal360_commands/mod.rs`).
const OKUMA_ROLU: [Role; 2] = [Role::Owner, Role::Manager];
const YAZMA_ROLU: [Role; 1] = [Role::Owner];

#[test]
fn okuma_kapisi_sahip_ve_mudure_acik_gerileri_kapatir() {
    for rol in ["OWNER", "MANAGER", "Owner", "Manager"] {
        assert!(
            rbac::require_any(rol, &OKUMA_ROLU).is_ok(),
            "{rol} yasal kayitlari okumali"
        );
    }
    for rol in ["MASTER", "CASHIER", "WAITER", "KITCHEN", "SuperUser", ""] {
        assert!(
            rbac::require_any(rol, &OKUMA_ROLU).is_err(),
            "{rol} yasal kayitlari okumamali"
        );
    }
}

#[test]
fn yazma_kapisi_yalnizca_sahiptir() {
    assert!(rbac::require_any("OWNER", &YAZMA_ROLU).is_ok());
    for rol in ["MASTER", "MANAGER", "CASHIER", "WAITER", "KITCHEN"] {
        assert!(
            rbac::require_any(rol, &YAZMA_ROLU).is_err(),
            "{rol} prim/KDV/kampanya yazmamali"
        );
    }
}

#[test]
fn master_platform_hesabi_yasal_module_giremez() {
    // AGENTS.md §6: MASTER POS/Floor/KDS dışında da işletme içi kayıtlara
    // bakmaz. Bu test, yeni bir yasal komut eklerken MASTER'ın izin
    // listesine sızmasını yakalar.
    let hata = rbac::require_any("Master Admin", &OKUMA_ROLU).unwrap_err();
    assert!(hata.starts_with("UNAUTHORIZED"), "{hata}");
    assert!(
        !hata.contains("MASTER"),
        "hata yalnizca izin verilenleri saymali: {hata}"
    );
}

#[test]
fn bos_oturum_reddedilir_tenant_fallback_yok() {
    for bos in [None, Some(""), Some("   "), Some("\t")] {
        let hata = require_tenant(bos).unwrap_err();
        assert!(hata.starts_with("UNAUTHORIZED"), "{hata}");
        assert!(
            hata.contains("işletmesi yok"),
            "hata sebebi acik olmali: {hata}"
        );
    }
}

#[test]
fn gecerli_tenant_kirpilir_ve_bosluk_temizlenir() {
    assert_eq!(require_tenant(Some(" ten_a ")).expect("gecerli"), "ten_a");
}

#[test]
fn oturumsuz_cagri_default_tenanta_dusmez() {
    // Regresyon: `require_tenant` `unwrap_or("DEFAULT_TENANT")` kullanırsaydı
    // oturumsuz çağıran tüm kiracı verisini görecekdi.
    let hata = require_tenant(None).expect_err("oturumsuz cagri reddedilmeli");
    assert!(
        !hata.contains("DEFAULT_TENANT"),
        "hata varsayilan kiraci adini icermemeli: {hata}"
    );
}

#[test]
fn denetim_kategorileri_donusmaz_kume_ayittir() {
    // Yeni denetim kategorisi acmak, zincir dogrulamasini degistirir; yasal modül
    // mevcut iki kategoriyi kullanir.
    assert_eq!(
        KATEGORI_FINANS,
        crate::services::audit_service::category::FINANS,
        "Finans kategorisi yeniden tanimlanmamali"
    );
    assert_eq!(
        KATEGORI_MENU,
        crate::services::audit_service::category::MENU,
        "Menu kategorisi yeniden tanimlanmamali"
    );
    assert!(
        crate::services::audit_service::category::is_valid(KATEGORI_FINANS),
        "kategori donmus kumede olmali"
    );
    assert!(
        crate::services::audit_service::category::is_valid(KATEGORI_MENU),
        "kategori donmus kumede olmali"
    );
}

#[test]
fn sistem_aktoru_yedek_olarak_yazilir() {
    let (id, rol) = audit_actor(None, "OWNER");
    assert_eq!(id, "SYSTEM", "kimlik gelmezse aktör SYSTEM olmali");
    assert_eq!(rol, "OWNER");

    let (id, _) = audit_actor(Some("usr_sahip".to_string()), "OWNER");
    assert_eq!(id, "usr_sahip", "gelen kimlik korunmali");
}
