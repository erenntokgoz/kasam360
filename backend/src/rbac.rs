//! Rol tabanlı yetkilendirme çekirdeği — SPEC §34'ün backend karşılığı.
//!
//! Sorun: aynı rolün birden fazla yazımı (`OWNER`, `Owner`, `MASTER`, `Master Admin`,
//! `SuperAdmin`) komutlara dağıtılmış halde karşılaştırılıyordu. Sonuç, aynı kişinin
//! bir komuta girip diğerine girememesi gibi keyfî ve tekrarlı kapılardı.
//!
//! Çözüm: her yazım tek bir kanonik role indirgenir ve kapı kararları buradan verilir.
//! Frontend'deki `desktop/src/core/security/navigationMatrix.ts` ile aynı SPEC tablosunun
//! backend yüzüdür; ikisi de rolleri elle yazmaz, tanımlı altı rolden birine indirger.

use std::fmt;

/// SPEC §34'te tanımlı altı rol. Matris dışına rol üretilemez.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Master,
    Owner,
    Manager,
    Cashier,
    Waiter,
    Kitchen,
}

impl Role {
    /// Matris karşılaştırmalarında ve hata mesajlarında kullanılan kanonik ad.
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Master => "MASTER",
            Role::Owner => "OWNER",
            Role::Manager => "MANAGER",
            Role::Cashier => "CASHIER",
            Role::Waiter => "WAITER",
            Role::Kitchen => "KITCHEN",
        }
    }

    /// SPEC §34'ün tamamı.
    pub fn all() -> &'static [Role] {
        &[Role::Master, Role::Owner, Role::Manager, Role::Cashier, Role::Waiter, Role::Kitchen]
    }
}

impl fmt::Display for Role {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Aynı rolün geçmişte kullanılmış, kanonik ad dışındaki yazımları.
///
/// Büyük/küçük harf ayrımı `canonical_role` içinde zaten çözülür, dolayısıyla
/// `OWNER`/`Owner` gibi çiftler burada yer almaz. Buradaki anahtarlar yalnızca
/// harf aralığından bağımsız biçim farklarını karşılar (boşluk, alt çizgi, tire,
/// ek sözcük). Listeye rol uydurmak değil, kodda fiilen geçen yazımları toplamak
/// esastır: henüz hiç geçmemiş bir takma ad, gelecekte kazara yetki açabilir.
const ALIASES: &[(&str, Role)] = &[
    ("master admin", Role::Master),
    ("super admin", Role::Master),
    ("superadmin", Role::Master),
    ("garson", Role::Waiter),
    ("mutfak", Role::Kitchen),
];

/// Gelen rol metnini kanonik role indirger. Tanınmayan yazım `None` döner.
///
/// Neden `None` önemli: bilinmeyen bir rol sessizce "en az yetkili" bir role
/// düşürülürse, yazım hatası bir kullanıcıya fazla yetki verebilir. Bunun yerine
/// çağıran taraf reddetmek zorundadır (fail-closed).
pub fn canonical_role(raw: &str) -> Option<Role> {
    // Ayraçları ve büyük/küçük harfi tek kutuya indir: "Master Admin", "master_admin",
    // "MASTER-ADMIN" ve "master admin" aynı kapıya düşmeli.
    let normalized: String = raw
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c == '_' || c == '-' { ' ' } else { c })
        .collect();
    let collapsed = normalized.split_whitespace().collect::<Vec<_>>().join(" ");

    // Önce tam eşleşme, sonra kanonik ad: kısa adlar ("owner") takma adlarla çakışmaz.
    if let Some((_, role)) = ALIASES.iter().find(|(alias, _)| *alias == collapsed) {
        return Some(*role);
    }
    Role::all()
        .iter()
        .copied()
        .find(|role| role.as_str().eq_ignore_ascii_case(&collapsed))
}

/// Rol bu listeden biriyse `Ok`, değilse reddeden `Err` döner.
///
/// Tüm komut giriş noktaları bu fonksiyonu kullanır; böylece "hangi rol geçerli"
/// sorusunun cevabı komutun içine gömülmez, burada kalır.
pub fn require_any(raw_role: &str, allowed: &[Role]) -> Result<Role, String> {
    match canonical_role(raw_role) {
        Some(role) if allowed.contains(&role) => Ok(role),
        _ => Err(format!(
            "UNAUTHORIZED: Bu işlem için yetki yok (izin: {}).",
            allowed.iter().map(|r| r.as_str()).collect::<Vec<_>>().join(", ")
        )),
    }
}

/// Sadece MASTER içindir: platform, tenant, feature flag, şube ve ham audit kapsamı.
pub fn require_master(raw_role: &str) -> Result<Role, String> {
    require_any(raw_role, &[Role::Master])
}

/// [`Option`] taşıyan komut giriş noktaları için MASTER kapısı.
///
/// Neden ayrı bir fonksiyon: Tauri IPC'de eksik alan `None` olarak çözülür. Bu yüzden
/// `if let Some(role) = caller_role { ... }` deseni, rol alanını hiç göndermeyen
/// çağıranı sessizce geçirir — yani kapı kendisi kapatırken açık kalır. Rolün
/// varlığı da yetkidir: `None` reddedilir (fail-closed).
pub fn require_master_present(caller_role: Option<&str>) -> Result<Role, String> {
    let raw = caller_role.ok_or_else(|| "UNAUTHORIZED: caller_role is required".to_string())?;
    require_master(raw)
}

/// Rapor satırı: SPEC §34'te Raporlar ve Hesap Defteri işletme sahibine aittir,
/// müdüre kısmi olarak açıktır. Bu satır rapor/ledger komutlarının ortak kapısıdır.
pub fn require_reporting(raw_role: &str) -> Result<Role, String> {
    require_any(raw_role, &[Role::Owner, Role::Manager])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tum_rol_yazimlari_tek_kanonik_role_duser() {
        for spelling in ["OWNER", "Owner", "owner", " owner "] {
            assert_eq!(canonical_role(spelling), Some(Role::Owner), "{}", spelling);
        }
        for spelling in ["MASTER", "Master Admin", "MASTER ADMIN", "master_admin", "SuperAdmin", "super admin"] {
            assert_eq!(canonical_role(spelling), Some(Role::Master), "{}", spelling);
        }
        for spelling in ["MANAGER", "Manager", "CASHIER", "Cashier", "WAITER", "KITCHEN", "Kitchen"] {
            assert!(canonical_role(spelling).is_some(), "{}", spelling);
        }
    }

    #[test]
    fn bilinmeyen_yazim_yetki_vermez() {
        assert_eq!(canonical_role("SuperUser"), None);
        assert_eq!(canonical_role(""), None);
        assert_eq!(canonical_role("OWNER ADMIN"), None);
    }

    #[test]
    fn require_any_yalnizca_listedeki_rolleri_gecirir() {
        assert!(require_any("Owner", &[Role::Owner, Role::Manager]).is_ok());
        assert!(require_any("Cashier", &[Role::Owner, Role::Manager]).is_err());
        assert!(require_any("SuperUser", &[Role::Master]).is_err());
    }

    #[test]
    fn master_kapisi_yalnizca_masterdan_gecer() {
        assert!(require_master("Master Admin").is_ok());
        assert!(require_master("OWNER").is_err());
    }

    #[test]
    fn raporlama_kapisi_sahip_ve_mudure_acik_kasivere_degil() {
        assert!(require_reporting("Owner").is_ok());
        assert!(require_reporting("MANAGER").is_ok());
        assert!(require_reporting("CASHIER").is_err());
        assert!(require_reporting("WAITER").is_err());
        assert!(require_reporting("KITCHEN").is_err());
    }

    #[test]
    fn hata_mesaji_yetkili_rolleri_sayar_ve_siralamaz() {
        let err = require_any("WAITER", &[Role::Owner, Role::Manager]).unwrap_err();
        assert!(err.starts_with("UNAUTHORIZED"), "{}", err);
        assert!(err.contains("OWNER") && err.contains("MANAGER"), "{}", err);
    }
}
