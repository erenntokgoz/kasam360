//! Dış aktör komutları yardımcıları (denetim ve özellik bayrağı kapıları).
//!
//! Neden ayrı modül: external360_commands.rs 500 satır tavanını aştığı için
//! ortak yardımcılar bu alt modüle ayrıldı.

use crate::services::audit_service::{AuditContext, AuditLock, AuditService};

/// Denetim kaydı yazar.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn denetle(
    conn: &mut sqlx::SqliteConnection,
    kilit: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    category: &'static str,
    action: &str,
    resource_id: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    let ctx = AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        category,
        action,
        resource_id.to_string(),
        payload,
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(conn, kilit, &ctx).await.map(|_| ())
}

/// `feat_qr_menu` bayrağı KAPALI iken QR menü komutları 404 döner.
pub(crate) fn require_qr_menu(active_modules: Option<&Vec<String>>) -> Result<(), String> {
    match active_modules {
        Some(moduller) if moduller.iter().any(|m| m == "feat_qr_menu") => Ok(()),
        _ => Err("NOT_FOUND: QR menü bu işletmede etkin değil".into()),
    }
}

/// QR menü bayrağı kapalıyken 404 döndüğünü ve açıkken geçtiğini doğrular.
#[cfg(test)]
mod qr_menu_flag_tests {
    use super::require_qr_menu;

    fn moduller(aktif: &[&str]) -> Vec<String> {
        aktif.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn bayrak_yoksa_qr_menu_komutlari_404_doner() {
        for moduller in [None, Some(Vec::new()), Some(moduller(&["core"]))] {
            let hata =
                require_qr_menu(moduller.as_ref()).expect_err("bayrak yoksa komut 404 dönmeli");
            assert!(hata.starts_with("NOT_FOUND"), "{}", hata);
        }
    }

    #[test]
    fn bayrak_aciksa_qr_menu_komutlari_gecer() {
        assert!(require_qr_menu(Some(&moduller(&["core", "feat_qr_menu"]))).is_ok());
    }

    #[test]
    fn komsu_bayrak_qr_menu_acmaz() {
        assert!(require_qr_menu(Some(&moduller(&["feat_qr_menus"]))).is_err());
        assert!(require_qr_menu(Some(&moduller(&["feat_kds", "feat_delivery"]))).is_err());
    }
}
