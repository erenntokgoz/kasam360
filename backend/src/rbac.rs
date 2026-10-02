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

/// Denetim logu okuma kapısı: işletme sahibi ve müdür.
///
/// Kasiyer, garson ve mutfak denetim defterini göremez. Garson/mutfak zaten
/// `ImmutableLedgerRepository` rol izolasyonuyla da dışlanıyordu; kapiyer de
/// burada dışlanır. MASTER ayrı komutta (`get_platform_audit_logs`) kalır.
pub fn require_audit_read(raw_role: &str) -> Result<Role, String> {
    require_any(raw_role, &[Role::Owner, Role::Manager])
}

/// [`Option`] taşıyan komutlar için fail-closed yetki kapısı.
///
/// Rol alanını hiç göndermeyen çağıran `None` düşer ve reddedilir; bkz.
/// [`require_master_present`].
pub fn require_any_present(caller_role: Option<&str>, allowed: &[Role]) -> Result<Role, String> {
    let raw = caller_role.ok_or_else(|| "UNAUTHORIZED: caller_role is required".to_string())?;
    require_any(raw, allowed)
}

/// Personel kaydı kapısı: işletme sahibi ve müdür.
///
/// Neden WAITER dışlanıyor: personel sicili, maaş ve tutanak bilgisi patronun
/// en hassas verisi; garson başkasının dosyasını göremez.
pub fn require_staff_admin(raw_role: &str) -> Result<Role, String> {
    require_any(raw_role, &[Role::Owner, Role::Manager])
}

/// Maaş **tutarı** görme kapısı: yalnız işletme sahibi.
///
/// Neden ayrı fonksiyon: müdür bordroyu *görebilir* (toplam, model, kişi
/// listesi) ama **tutarı göremez**. Bu ayrım personelin maaşını müdüre
/// açıklamak zorunda kılmaz; rapor satırı yetkisi ile maaş gizliliği
/// birbirine karıştırılmamalıdır (AGENTS.md §3.2).
pub fn require_payroll_amounts(raw_role: &str) -> Result<Role, String> {
    require_any(raw_role, &[Role::Owner])
}

/// Vardiya planı ve izin kararı kapısı: işletme sahibi ve müdür.
/// Onaylayan kişi kendi iznini onaylayamaz (ayrıca servis seviyesinde de
/// reddedilir); buradaki kapı yalnız rolü denetler.
pub fn require_shift_planning(raw_role: &str) -> Result<Role, String> {
    require_any(raw_role, &[Role::Owner, Role::Manager])
}

/// Personel izin talebi oluşturma kapısı: herkes kendi iznini isteyebilir,
/// bu yüzden MASTER, OWNER, MANAGER, CASHIER ve WAITER dâhildir. KITCHEN
/// dışlanır: mutfak personeli vardiya planlama ekranına girmez.
pub fn require_leave_request(raw_role: &str) -> Result<Role, String> {
    require_any(
        raw_role,
        &[Role::Master, Role::Owner, Role::Manager, Role::Cashier, Role::Waiter],
    )
}

/// Onay PIN'i verebilecek roller: MASTER, işletme sahibi ve müdür.
///
/// SPEC §34'te kasa/garson/mutfak onaylama yetkisine sahip değildir; onaylayan
/// her zaman bu üç rolden biri olmak zorundadır.
pub const APPROVER_ROLES: [Role; 3] = [Role::Master, Role::Owner, Role::Manager];

/// Yalnız işletme sahibi ve müdür onaylayabilir (MASTER hariç).
///
/// Büyük indirimlerde (%20 veya 500 TL üzeri) onaylayan kasa olamaz; bu yüzden
/// MASTER bu kapıdan da dışlanır — platform hesabı bir işletmenin indirimine
/// onay vermez.
pub fn require_approver(raw_role: &str) -> Result<Role, String> {
    require_any(raw_role, &[Role::Owner, Role::Manager])
}

/// Onaylayan kişi işlemi yapan kişi olamaz (ayrım gözetimi, görevler ayrılığı).
///
/// Neden kimlik karşılaştırması burada: kural tek yerden zorlanmalıdır. Aksi
/// hâlde her komut kendi karşılaştırmasını unutabilir ve "kendi işlemini kendi
/// onayladı" deliği yeniden açılırdı.
pub fn require_distinct_approver(approver_id: &str, actor_id: &str) -> Result<(), String> {
    if approver_id.trim().is_empty() {
        return Err("UNAUTHORIZED: Onaylayan kimliği boş olamaz.".to_string());
    }
    if approver_id.trim().eq_ignore_ascii_case(actor_id.trim()) {
        return Err(
            "SELF_APPROVAL_FORBIDDEN: Onaylayan kişi işlemi yapan kişi olamaz.".to_string(),
        );
    }
    Ok(())
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

    /// Denetim defteri okuma kapısı yalnız sahip ve müdüre açıktır. Kasiyer,
    /// garson ve mutfak reddedilir; MASTER işletme denetimine erişmez, kendi
    /// platform komutundan okur.
    #[test]
    fn denetim_okuma_kapisi_sahip_ve_mudure_acik_gerileri_kapatir() {
        assert!(require_audit_read("Owner").is_ok());
        assert!(require_audit_read("MANAGER").is_ok());

        for role in ["CASHIER", "WAITER", "KITCHEN", "Cashier", "Waiter", "Kitchen"] {
            assert!(require_audit_read(role).is_err(), "{} denetim defterini görebiliyor", role);
        }
        // MASTER işletme denetim defterine bu kapıdan giremez.
        assert!(require_audit_read("Master Admin").is_err());
        // Bilinmeyen yazım fail-closed: kapıdan düşer.
        assert!(require_audit_read("SuperUser").is_err());
        assert!(require_audit_read("").is_err());
    }

    /// Onay verebilen roller: MASTER, işletme sahibi, müdür. Kasa, garson ve
    /// mutfak onaylayamaz — SPEC §34'te onay yetkileri yoktur.
    #[test]
    fn onay_verebilen_roller_yalnizca_usta_uc_roldur() {
        for role in ["MASTER", "Owner", "MANAGER", " master_admin ", "Manager"] {
            assert!(
                require_any(role, &APPROVER_ROLES).is_ok(),
                "{} onay verebilmeli",
                role
            );
        }
        for role in ["CASHIER", "WAITER", "KITCHEN", "", "SuperUser"] {
            assert!(
                require_any(role, &APPROVER_ROLES).is_err(),
                "{} onay verebilmemeli",
                role
            );
        }
    }

    /// Büyük indirim onayı: MASTER dahil yalnız işletme sahibi ve müdür. Platform
    /// hesabı bir işletmenin indirimine onay vermez.
    #[test]
    fn buyuk_indirim_onayi_platform_hesabini_dislar() {
        assert!(require_approver("OWNER").is_ok());
        assert!(require_approver("Manager").is_ok());
        assert!(require_approver("MASTER").is_err());
        assert!(require_approver("CASHIER").is_err());
        assert!(require_approver("WAITER").is_err());
        assert!(require_approver("").is_err());
    }

    /// Ayrım gözetimi: onaylayan kişi işlemi yapan kişi olamaz. Kural tek
    /// fonksiyonda olduğu için hiçbir komut kendi kontrolünü unutamaz.
    #[test]
    fn onaylayan_kendi_islemini_onaylayamaz() {
        assert!(require_distinct_approver("usr_manager", "usr_cashier").is_ok());

        let err = require_distinct_approver("usr_manager", "usr_manager").unwrap_err();
        assert!(err.starts_with("SELF_APPROVAL_FORBIDDEN"), "{}", err);

        // Büyük/küçük harf ve boşluk farkı da aynı kişidir.
        assert!(require_distinct_approver("USR_MANAGER", " usr_manager ").is_err());
        // Onaylayan kimliği boş olamaz (fail-closed).
        assert!(require_distinct_approver("  ", "usr_cashier").is_err());
    }
}
