//! Kapısız komut regresyon testleri.
//!
//! Bu dosya, rol denetimi olmayan veya kiracı filtresi olmayan komutların
//! kapatıldığını kanıtlar. Kural (AGENTS.md §3.3, §6):
//!
//! - **Rol alanının varlığı da yetkidir.** `actor_role` hiç gönderilmemişse
//!   (`None`) çağrı reddedilir. `require_any_present` bunu fail-closed yapar.
//! - **Kiracı zorunludur.** `tenant_id` eksik veya boşsa reddedilir; hiçbir
//!   komut `"DEFAULT_TENANT"` varsayılanına düşmez.
//! - **Yazma komutları kiracıya bağlıdır.** Rol kapısı geçse bile hedef
//!   satır bu kiracının değilse yazma yapılmaz.
//!
//! Kapılar `tauri::State` içerdiği için komutlar doğrudan çağrılamaz; bu
//! yüzden her komutun kapısı saf bir fonksiyona (`*_kapisi`) taşınmıştır ve
//! testler o sözleşmeyi denetler.

use crate::cashier_commands::{cash_hareket_kapisi, vardiya_oku_kapisi};
use crate::commands::kds_commands::kds_kapisi;
use crate::kitchen_commands::{istasyon_okuma_kapisi, istasyon_yazma_kapisi, kds_durum_kapisi};
use crate::waiter_commands::{masa_okuma_kapisi, siparis_kapisi};

const TENANT_A: &str = "tenant_a";

// ============================================================================
// 1. ROL ALANI HİÇ GÖNDERİLMEZSE FAIL-CLOSED
// ============================================================================

#[test]
fn rol_alani_bos_kapilar_reddeder() {
    // Bu dört kapı, düzeltme öncesinde hiç rol denetlemiyordu.
    assert!(
        vardiya_oku_kapisi(None, Some(TENANT_A)).is_err(),
        "get_shift_summary rol alanı olmadan geçmemeli"
    );
    assert!(
        istasyon_okuma_kapisi(None, Some(TENANT_A)).is_err(),
        "get_stations rol alanı olmadan geçmemeli"
    );
    assert!(
        istasyon_yazma_kapisi(None, Some(TENANT_A)).is_err(),
        "create_station rol alanı olmadan geçmemeli"
    );
    assert!(
        kds_durum_kapisi(None, Some(TENANT_A)).is_err(),
        "update_kds_item_status rol alanı olmadan geçmemeli"
    );
    assert!(
        siparis_kapisi(None, Some(TENANT_A)).is_err(),
        "get_product_modifiers rol alanı olmadan geçmemeli"
    );
    assert!(
        masa_okuma_kapisi(None, Some(TENANT_A)).is_err(),
        "masa hazır durumu komutları rol alanı olmadan geçmemeli"
    );
    // KDS komutları (bilet geçişi + aktif bilet listesi)
    // hiç rol denetlemiyordu.
    assert!(
        kds_kapisi(None).is_err(),
        "KDS komutları rol alanı olmadan geçmemeli"
    );
    // Kasa giriş/çıkışı (para hareketi) hiç rol denetlemiyordu.
    assert!(
        cash_hareket_kapisi(None).is_err(),
        "kasa hareketi komutları rol alanı olmadan geçmemeli"
    );
}

#[test]
fn bos_ve_bilinmeyen_rol_yetki_vermez() {
    for role in ["", "   ", "SuperUser", "OWNER ADMIN"] {
        assert!(
            vardiya_oku_kapisi(Some(role), Some(TENANT_A)).is_err(),
            "'{}' vardiya özetini okuyabilmemeli",
            role
        );
        assert!(
            kds_kapisi(Some(role)).is_err(),
            "'{}' KDS biletini geçememeli",
            role
        );
        assert!(
            cash_hareket_kapisi(Some(role)).is_err(),
            "'{}' kasa hareketi yazamamalı",
            role
        );
    }
}

// ============================================================================
// 2. KİRACİ ZORUNLU (varsayılan kiracıya düşüş yok)
// ============================================================================

#[test]
fn kiraci_eksik_kapilar_reddeder() {
    for tenant in [None, Some(""), Some("   ")] {
        let etiket = format!("{:?}", tenant);
        assert!(
            vardiya_oku_kapisi(Some("OWNER"), tenant).is_err(),
            "vardiya özeti kiracısız ({}) geçmemeli",
            etiket
        );
        assert!(
            istasyon_okuma_kapisi(Some("OWNER"), tenant).is_err(),
            "istasyon okuma kiracısız ({}) geçmemeli",
            etiket
        );
        assert!(
            istasyon_yazma_kapisi(Some("OWNER"), tenant).is_err(),
            "istasyon yazma kiracısız ({}) geçmemeli",
            etiket
        );
        assert!(
            kds_durum_kapisi(Some("KITCHEN"), tenant).is_err(),
            "KDS durumu kiracısız ({}) geçmemeli",
            etiket
        );
        assert!(
            siparis_kapisi(Some("WAITER"), tenant).is_err(),
            "modifier okuma kiracısız ({}) geçmemeli",
            etiket
        );
        assert!(
            masa_okuma_kapisi(Some("KITCHEN"), tenant).is_err(),
            "masa durumu kiracısız ({}) geçmemeli",
            etiket
        );
    }
}

// ============================================================================
// 3. ROL MATRİSİ — SPEC §34
// ============================================================================

#[test]
fn vardiya_ozeti_sahip_mudur_kasive_acik_gerileri_kapatir() {
    for role in ["OWNER", "MANAGER", "CASHIER"] {
        assert!(
            vardiya_oku_kapisi(Some(role), Some(TENANT_A)).is_ok(),
            "{} vardiya özetini okuyabilmeli",
            role
        );
    }
    // Garson ve mutfak vardiya parasını göremez.
    for role in ["WAITER", "KITCHEN", "Master Admin"] {
        assert!(
            vardiya_oku_kapisi(Some(role), Some(TENANT_A)).is_err(),
            "{} vardiya özetini görememeli",
            role
        );
    }
}

#[test]
fn istasyon_okuma_yalniz_sahip_mudur_mutfak() {
    for role in ["OWNER", "MANAGER", "KITCHEN"] {
        assert!(
            istasyon_okuma_kapisi(Some(role), Some(TENANT_A)).is_ok(),
            "{} istasyon listesini görebilmeli",
            role
        );
    }
    // Garson ve kasa mutfağın üretim hattını okuyamaz.
    for role in ["WAITER", "CASHIER", "Master Admin"] {
        assert!(
            istasyon_okuma_kapisi(Some(role), Some(TENANT_A)).is_err(),
            "{} istasyon listesini görememeli",
            role
        );
    }
}

#[test]
fn istasyon_yazma_yalniz_sahip_mudur_mutfak() {
    for role in ["OWNER", "MANAGER", "KITCHEN"] {
        assert!(
            istasyon_yazma_kapisi(Some(role), Some(TENANT_A)).is_ok(),
            "{} istasyon ekleyebilmeli",
            role
        );
    }
    // Garson ve kasa üretim hattını değiştiremez.
    for role in ["WAITER", "CASHIER", "Master Admin"] {
        assert!(
            istasyon_yazma_kapisi(Some(role), Some(TENANT_A)).is_err(),
            "{} istasyon ekleyememeli",
            role
        );
    }
}

#[test]
fn kds_durumu_yalniz_mutfak_hattina_acik() {
    for role in ["OWNER", "MANAGER", "KITCHEN"] {
        assert!(
            kds_durum_kapisi(Some(role), Some(TENANT_A)).is_ok(),
            "{} bilet durumu yazabilmeli",
            role
        );
    }
    // Garson "hazır" diyemez, kasa da diyemez.
    for role in ["WAITER", "CASHIER", "Master Admin"] {
        assert!(
            kds_durum_kapisi(Some(role), Some(TENANT_A)).is_err(),
            "{} bilet durumu yazamamalı",
            role
        );
    }
}

#[test]
fn siparis_akisi_kapiyi_gecer_kitchen_gecemez() {
    for role in ["OWNER", "MANAGER", "WAITER", "CASHIER"] {
        assert!(
            siparis_kapisi(Some(role), Some(TENANT_A)).is_ok(),
            "{} modifier okumalı",
            role
        );
    }
    assert!(
        siparis_kapisi(Some("KITCHEN"), Some(TENANT_A)).is_err(),
        "mutfak POS seçim penceresini okumamalı"
    );
}

#[test]
fn masa_hazir_durumu_garson_mutfak_acik_kasa_kapalı() {
    for role in ["OWNER", "MANAGER", "WAITER", "KITCHEN"] {
        assert!(
            masa_okuma_kapisi(Some(role), Some(TENANT_A)).is_ok(),
            "{} masa hazır durumunu görebilmeli",
            role
        );
    }
    assert!(
        masa_okuma_kapisi(Some("CASHIER"), Some(TENANT_A)).is_err(),
        "kasa mutfak hazır durumunu görmemeli"
    );
}

// ============================================================================
// 4. TAKMA ADLAR (rbac sözlüğü tek kanonik role indirger)
// ============================================================================

#[test]
fn takma_ad_yazimlari_ayni_kapidan_gecer() {
    // `rbac::canonical_role` "Master Admin" → MASTER, "garson" → WAITER.
    assert!(vardiya_oku_kapisi(Some("Owner"), Some(TENANT_A)).is_ok());
    assert!(siparis_kapisi(Some("garson"), Some(TENANT_A)).is_ok());
    assert!(kds_durum_kapisi(Some("mutfak"), Some(TENANT_A)).is_ok());
    assert!(masa_okuma_kapisi(Some("mutfak"), Some(TENANT_A)).is_ok());
}

// ============================================================================
// 5. HATA MESAJI İHLAL EDİLEN ROLLERİ SAYMALI
// ============================================================================

#[test]
fn hata_mesaji_yetkili_rolleri_listeler() {
    let hata = vardiya_oku_kapisi(Some("WAITER"), Some(TENANT_A))
        .expect_err("garson vardiya özetini okuyamaz");
    assert!(hata.starts_with("UNAUTHORIZED"), "{}", hata);
    assert!(
        hata.contains("OWNER") && hata.contains("CASHIER"),
        "{}",
        hata
    );
}

// ============================================================================
// 6. KİRACİ ÇÖZÜMÜ — boşluk temizlenir, kiracı korunur
// ============================================================================

#[test]
fn kiraci_bosluklari_temizlenir_ve_korunur() {
    let kiraci = vardiya_oku_kapisi(Some("OWNER"), Some("  tenant_bosluklu  "))
        .expect("duzenli kiraci gecer");
    assert_eq!(kiraci, "tenant_bosluklu", "kiraci kirpilmali");
}

// ============================================================================
// 7. KDS KAPISI — bilet geçişi yalnız mutfak hattındadır
// ============================================================================

#[test]
fn kds_kapisi_yalniz_mutfak_hattina_acik() {
    // KDS bilet geçişi ve aktif bilet listesi:
    // mutfak hattıdır (SPEC §34 kitchenPrepare).
    for role in ["OWNER", "MANAGER", "KITCHEN"] {
        assert!(
            kds_kapisi(Some(role)).is_ok(),
            "{} KDS biletini okuyup geçebilmeli",
            role
        );
    }
    // Garson bilet ilerleyemez, kasa tahsilattan
    // sorumludur, MASTER platform hesabıdır.
    for role in ["WAITER", "CASHIER", "Master Admin"] {
        assert!(
            kds_kapisi(Some(role)).is_err(),
            "{} KDS biletini geçememeli",
            role
        );
    }
}

// ============================================================================
// 8. KASA HAREKETİ KAPISI — para yazarak yalnız sahip ve kasiyer
// ============================================================================

#[test]
fn kasa_hareketi_kapisi_yalniz_sahip_ve_kasier() {
    // Kasa giriş/çıkışı para hareketidir: yalnız
    // işletme sahibi ve kasiyer (SPEC §34).
    for role in ["OWNER", "CASHIER"] {
        assert!(
            cash_hareket_kapisi(Some(role)).is_ok(),
            "{} kasa hareketi yazabilmeli",
            role
        );
    }
    // Müdür onay jetonuyla onaylar, hareketi kendi
    // adına yazmaz; garson ve mutfak kasa tutmaz.
    for role in ["MANAGER", "WAITER", "KITCHEN", "Master Admin"] {
        assert!(
            cash_hareket_kapisi(Some(role)).is_err(),
            "{} kasa hareketi yazamamalı",
            role
        );
    }
}
