//! Faz 14 Tauri komutlarının ortak güvenlik katmanı.
//!
//! Bu katman **yalnız yetki sınar ve servise delegasyon yapar**; iş mantığı
//! `services/legal360` içindedir. Böylece iş mantığı komut altyapısı olmadan
//! testlenebilir ve yetki değişikliği tek yerde toplanır.
//!
//! Dört kural her komutta aynıdır:
//!   1. Rol `rbac::require_any` ile **önce** sınanır — servis çağrısından önce.
//!   2. Tenant `require_tenant` ile çözülür; boş oturum reddedilir.
//!   3. Para etkisi olan yazma işlemleri `audit_mutex` alır ve `BEGIN IMMEDIATE`
//!      içinde denetim defterine yazılır.
//!   4. `COMMIT` yalnız iş başarılıysa; hata halinde `ROLLBACK`.
//!
//! MASTER hiçbir kapıda yer almaz. Bu bir kontrol değil, **yapı** kararıdır:
//! izin listelerinde MASTER bulunmadığı için platform hesabı yasal kayıtlara
//! erişemez ve bu kural sonradan gevşetilemez (rbac.rs'teki yetki kapılarıyla
//! aynı gerekçe).

pub mod campaign_commands;
pub mod e_invoice_commands;
pub mod insurance_commands;
pub mod legal_commands;
pub mod music_license_commands;
pub mod special_day_commands;

#[cfg(test)]
mod tests;

pub use campaign_commands::{
    apply_campaign_command, get_campaign_stats, list_campaign_templates_command,
    list_campaigns_command, save_campaign_command,
};
pub use e_invoice_commands::{
    cancel_e_invoice_command, generate_e_invoice_command, get_e_invoice_command,
    list_e_invoices_command, mark_e_invoice_accepted_command, mark_e_invoice_rejected_command,
    mark_e_invoice_sent_command,
};
pub use insurance_commands::{
    get_expiring_policies_command, list_policies_command, save_policy_command,
};
pub use legal_commands::{
    get_expiring_documents_command, list_documents_command, list_upcoming_reminders_command,
    save_legal_document_command,
};
pub use music_license_commands::{
    get_expiring_licenses_command, list_music_licenses_command, save_music_license_command,
};
pub use special_day_commands::{
    list_special_days_command, list_upcoming_special_days_command, save_special_day_command,
};

use crate::db::DbPool;
use crate::services::audit_service::{AuditContext, AuditLock, AuditService};

/// Denetim kategorisi. Yeni kategori açılmaz (`audit_service::category::ALL`
/// donmuş bir kümedir); yasal ve kampanya işlemleri `FINANS`, kampanya kuralı
/// `MENU` kategorisinde kaydedilir.
pub(crate) const KATEGORI_FINANS: &str = crate::services::audit_service::category::FINANS;
pub(crate) const KATEGORI_MENU: &str = crate::services::audit_service::category::MENU;

/// Mali etkisi olan yazma işlemlerinin denetim defteri kaydı.
///
/// `too_many_arguments` kapatması bilinçlidir: denetim kaydının dokuz alanı
/// vardır ve bunları bir yapıya sıkıştırmak, çağıranın hangi alanı
/// doldurduğunu gizler. `audit_service::append` imzası da aynı sekiz alanı
/// zorunlu tutar; sıkıştırma yalnız hatayı gizlerdi.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn record_audit(
    conn: &mut sqlx::SqliteConnection,
    lock: &AuditLock<'_>,
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
    AuditService::append(conn, lock, &ctx).await?;
    Ok(())
}

/// Çağıran oturum bilgisi taşımıyorsa aktör "SYSTEM" olarak yazılır.
pub(crate) fn audit_actor(actor_id: Option<String>, actor_role: &str) -> (String, String) {
    (
        actor_id.unwrap_or_else(|| "SYSTEM".to_string()),
        actor_role.to_string(),
    )
}

/// Çağıranın işletmesini çözer ve fail-closed doğrular.
///
/// Tenant hiçbir zaman hedef satırdan okunmaz: okunursa bir işletme sahibi
/// başka işletmenin `leg_...` kimliğini tahmin edip değiştirebilir ve denetim
/// kaydı kurbanın defterine yazılır.
pub(crate) fn require_tenant(tenant_id: Option<&str>) -> Result<String, String> {
    let tenant = tenant_id.unwrap_or("").trim();
    if tenant.is_empty() {
        return Err("UNAUTHORIZED: oturum işletmesi yok, işlem reddedildi".into());
    }
    Ok(tenant.to_string())
}

/// Havuz bağlantısı alır. Bağlantı hatası `Err` olarak yukarı taşınır, sessizce
/// boş sonuç dönülmez.
pub(crate) async fn acquire(pool: &DbPool) -> Result<sqlx::SqliteConnection, String> {
    pool.acquire()
        .await
        .map(|baglanti| baglanti.detach())
        .map_err(|e| e.to_string())
}
