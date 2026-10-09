//! Ortak kapalı kapı makrosu: tenant + şube + rol bir arada denetim.
//!
//! Neden makro: AGENTS.md §6'da yetki matrisi var. Mevcut kodda
//! `require_tenant` + `require_branch_id` + `rbac::require_any` her komutta
//! ayrı ayrı call ediliyordu. Birini unutmak bir kapıyı açARDı.
//! Bu makro üçünü bir arada zorlar — tek satır, tek kaynak.
//!
//! Kullanım:
//! ```ignore
//! let tid = require_tenant_branch_role!(tenant_id, branch_id, caller_role, [Owner, Manager])?;
//! ```
//!
//! Neden `macro_rules!` değil bir fonksiyon: makro compile-time'da expand olur,
//! hata mesajları sabitlenir. Ama `Option<&str>` parametreleriyle çalışır,
//! `?` operatörüyle call edilebilir.

/// Kiracı + şube + rol üçlüsünü fail-closed doğrular.
///
/// # Argümanlar
/// - `tenant_id`: Çağıranın bildirdiği kiracı kimliği (None → reddedilir).
/// - `branch_id`: Çağıranın bildirdiği şube kimliği (None → reddedilir).
/// - `caller_role`: Çağıranın rolü (None → reddedilir).
/// - `allowed`: Izin verilen roller listesi.
///
/// # Hata
/// Üçlüden biri eksikse veya rol yetkisizse `Err` döner. Sessiz geçiş YOK.
pub fn require_tenant_branch_role(
    tenant_id: Option<&str>,
    branch_id: Option<&str>,
    caller_role: Option<&str>,
    allowed: &[crate::rbac::Role],
) -> Result<(String, String, crate::rbac::Role), String> {
    // 1. Kiracı kimliği — boşluk temizlendikten sonra boşsa reddedilir.
    let tid = tenant_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string())?;

    // 2. Şube kimliği — aynı şekilde fail-closed.
    let bid = branch_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: branch_id is required".to_string())?;

    // 3. Rol — Option taşımak, Tauri IPC'de alan göndermeyen call ediciye
    //    açık bırakmak demektir. None → reddedilir (fail-closed).
    let role = crate::rbac::require_any_present(caller_role, allowed)?;

    Ok((tid, bid, role))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tum_olumlu_durum_gecerli_rol_doner() {
        let result = require_tenant_branch_role(
            Some("DEFAULT_TENANT"),
            Some("br_000000000001"),
            Some("Owner"),
            &[crate::rbac::Role::Owner, crate::rbac::Role::Manager],
        );
        assert!(result.is_ok());
        let (tid, bid, role) = result.unwrap();
        assert_eq!(tid, "DEFAULT_TENANT");
        assert_eq!(bid, "br_000000000001");
        assert_eq!(role, crate::rbac::Role::Owner);
    }

    #[test]
    fn kiraci bos_rededilir() {
        let result = require_tenant_branch_role(
            None,
            Some("br_000000000001"),
            Some("Owner"),
            &[crate::rbac::Role::Owner],
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("tenant_id"));
    }

    #[test]
    fn kiraci_bos_string_rededilir() {
        let result = require_tenant_branch_role(
            Some("   "),
            Some("br_000000000001"),
            Some("Owner"),
            &[crate::rbac::Role::Owner],
        );
        assert!(result.is_err());
    }

    #[test]
    fn subube_bos_rededilir() {
        let result = require_tenant_branch_role(
            Some("DEFAULT_TENANT"),
            None,
            Some("Owner"),
            &[crate::rbac::Role::Owner],
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("branch_id"));
    }

    #[test]
    fn rol_yok_rededilir() {
        let result = require_tenant_branch_role(
            Some("DEFAULT_TENANT"),
            Some("br_000000000001"),
            None,
            &[crate::rbac::Role::Owner],
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("caller_role"));
    }

    #[test]
    fn yetkisiz_rol_rededilir() {
        let result = require_tenant_branch_role(
            Some("DEFAULT_TENANT"),
            Some("br_000000000001"),
            Some("Cashier"),
            &[crate::rbac::Role::Owner],
        );
        assert!(result.is_err());
    }

    #[test]
    fn kiraci_trim_edilir() {
        let result = require_tenant_branch_role(
            Some("  DEFAULT_TENANT  "),
            Some("br_000000000001"),
            Some("Owner"),
            &[crate::rbac::Role::Owner],
        );
        assert!(result.is_ok());
        assert_eq!(result.unwrap().0, "DEFAULT_TENANT");
    }
}