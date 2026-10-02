//! Şube komutları.
//!
//! Yetki modeli (AGENTS.md §6, Faz 6):
//! - **Şube ekle / güncelle / arşivle yalnız MASTER'ın.** İşletme sahibi şube
//!   yönetmez; patron panelinde şube sekmesi yoktur (yalnız geçiş dropdown'ı).
//! - **Şube listeleme** işletme sahibi ve müdüre açıktır, ama yalnız **kendi
//!   tenant'ının** şubelerini görür. Bu okuma şube geçişi için gereklidir;
//!   yazma yetkisi taşımaz.
//!
//! Faz 6 öncesi bu dosyada hiç RBAC kapısı yoktu ve `tenant_id` çağırandan
//! geliyordu: herhangi bir oturum başka bir işletmenin şubelerini okuyabiliyor
//! ve şube oluşturabiliyordu. Artık kapı fail-closed, tenant zorunlu ve tüm SQL
//! kuralları `services::branch_service` içinde.
//!
//! Silme davranışı: şube **fiziksel olarak silinmez**, `status = 'ARCHIVED'`
//! yapılır. Geçmiş sipariş ve vardiya kayıtları bu şubeye bağlı olduğu için
//! satırları boşa çıkarmak veri bütünlüğünü bozar (AGENTS.md §2).

use crate::db::DbPool;
use crate::management_commands::{audit_actor, record_audit};
use crate::rbac::{self, Role};
use crate::services::audit_service::{AuditLock, category};
use crate::services::branch_service::{self, Branch};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BranchDto {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub address: Option<String>,
    pub status: String,
    pub created_at: String,
}

/// Hangi tenant üzerinde işlem yapılacağını yetkiyle birlikte çözer.
///
/// Neden ayrı fonksiyon: komutlar hem "kendi işletmem" (`caller_tenant_id`,
/// oturumdan gelir) hem de "hedef işletme" (`tenant_id`, MASTER'ın yönettiği
/// işletme) alanlarını alıyor. İkisini karıştırmak cross-tenant sızıntıdır:
/// işletme sahibi başka bir işletme adına `tenant_id` gönderip şubelerini
/// okuyabilirdi. Bu yüzden:
/// - **MASTER** hedef tenant'ı seçebilir (platform işidir), ama boş geçemez,
/// - **diğer roller** yalnız kendi oturum tenant'ı üzerinde işlem yapabilir;
///   başka bir tenant istenirse istek reddedilir.
fn resolve_target_tenant(
    role: Option<&str>,
    session_tenant_id: Option<&str>,
    requested_tenant_id: Option<&str>,
) -> Result<String, String> {
    let session = session_tenant_id
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string);
    let requested = requested_tenant_id
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string);

    match role {
        Some("MASTER") => requested
            .or(session)
            .ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string()),
        _ => {
            let own = session.ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string())?;
            if let Some(target) = requested {
                if target != own {
                    return Err("FORBIDDEN: başka bir işletmenin şubesi erişilemez".to_string());
                }
            }
            Ok(own)
        }
    }
}

/// Prefixed şube kimliği (`br_`): AGENTS.md §2 ham UUID yasak.
fn new_branch_id() -> String {
    let raw = Uuid::new_v4().simple().to_string();
    format!("br_{}", &raw[..12])
}

fn require_branch_id(branch_id: &str) -> Result<String, String> {
    let trimmed = branch_id.trim();
    if trimmed.is_empty() {
        return Err("INVALID_ARGUMENT: branch_id is required".to_string());
    }
    Ok(trimmed.to_string())
}

/// Şube listesi.
///
/// Neden MASTER da burada: MASTER işletme sahibi ekranına giremez, şubeyi
/// platform tarafından yönetir; yine de denetim ve doğrulama amaçlı
/// listeleyebilir. MASTER için tenant de zorunludur: "tüm şubeler" dökümü
/// platform tarafında `get_tenants` ile yapılır.
#[tauri::command]
pub async fn get_branches(
    caller_role: Option<String>,
    caller_tenant_id: Option<String>,
    tenant_id: Option<String>,
    include_archived: Option<bool>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<BranchDto>, String> {
    rbac::require_any_present(
        caller_role.as_deref(),
        &[Role::Owner, Role::Manager, Role::Master],
    )?;
    let tid = resolve_target_tenant(
        caller_role.as_deref(),
        caller_tenant_id.as_deref(),
        tenant_id.as_deref(),
    )?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let branches = branch_service::list(&mut conn, &tid, include_archived.unwrap_or(false)).await?;
    Ok(branches.iter().map(Branch::to_dto).collect())
}

/// Şube ekleme — **yalnız MASTER** (AGENTS.md §6).
#[tauri::command]
pub async fn create_branch(
    caller_role: Option<String>,
    caller_id: Option<String>,
    caller_tenant_id: Option<String>,
    tenant_id: Option<String>,
    name: String,
    address: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<BranchDto, String> {
    rbac::require_master_present(caller_role.as_deref())?;
    let tid = resolve_target_tenant(
        caller_role.as_deref(),
        caller_tenant_id.as_deref(),
        tenant_id.as_deref(),
    )?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let (actor_id, actor_role) = audit_actor(caller_id, "MASTER");
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let branch = branch_service::create(
        &mut tx,
        &tid,
        &new_branch_id(),
        &name,
        address.as_deref(),
    )
    .await?;

    record_audit(
        &mut tx,
        &lock,
        &tid,
        &actor_id,
        &actor_role,
        category::SISTEM,
        "branch:created",
        &branch.id,
        serde_json::json!({
            "name": branch.name,
            "address": branch.address,
            "createdBy": actor_id,
        }),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(branch.to_dto())
}

/// Şube ad/adres güncelleme — **yalnız MASTER**.
#[tauri::command]
pub async fn update_branch(
    caller_role: Option<String>,
    caller_id: Option<String>,
    caller_tenant_id: Option<String>,
    tenant_id: Option<String>,
    branch_id: String,
    name: Option<String>,
    address: Option<String>,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<BranchDto, String> {
    rbac::require_master_present(caller_role.as_deref())?;
    let tid = resolve_target_tenant(
        caller_role.as_deref(),
        caller_tenant_id.as_deref(),
        tenant_id.as_deref(),
    )?;
    let bid = require_branch_id(&branch_id)?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let (actor_id, actor_role) = audit_actor(caller_id, "MASTER");
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let previous_name = branch_service::load(&mut tx, &tid, &bid).await?.name;
    let branch = branch_service::update(
        &mut tx,
        &tid,
        &bid,
        name.as_deref(),
        address.as_deref(),
    )
    .await?;

    record_audit(
        &mut tx,
        &lock,
        &tid,
        &actor_id,
        &actor_role,
        category::SISTEM,
        "branch:updated",
        &branch.id,
        serde_json::json!({
            "previousName": previous_name,
            "name": branch.name,
            "address": branch.address,
            "updatedBy": actor_id,
        }),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(branch.to_dto())
}

/// Şubeyi arşivle (yumuşak silme) — **yalnız MASTER**.
#[tauri::command]
pub async fn archive_branch(
    caller_role: Option<String>,
    caller_id: Option<String>,
    caller_tenant_id: Option<String>,
    tenant_id: Option<String>,
    branch_id: String,
    pool: tauri::State<'_, DbPool>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    rbac::require_master_present(caller_role.as_deref())?;
    let tid = resolve_target_tenant(
        caller_role.as_deref(),
        caller_tenant_id.as_deref(),
        tenant_id.as_deref(),
    )?;
    let bid = require_branch_id(&branch_id)?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let (actor_id, actor_role) = audit_actor(caller_id, "MASTER");
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let branch = branch_service::archive(&mut tx, &tid, &bid).await?;

    record_audit(
        &mut tx,
        &lock,
        &tid,
        &actor_id,
        &actor_role,
        category::SISTEM,
        "branch:archived",
        &branch.id,
        serde_json::json!({
            "name": branch.name,
            "archivedBy": actor_id,
        }),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tenant_bos_is_fail_closed() {
        // Tenant çözümlenemiyorsa hiçbir rol geçemez.
        assert!(resolve_target_tenant(Some("OWNER"), None, None).is_err());
        assert!(resolve_target_tenant(Some("OWNER"), Some("   "), None).is_err());
        assert!(resolve_target_tenant(Some("MANAGER"), None, None).is_err());
        assert_eq!(
            resolve_target_tenant(Some("OWNER"), Some(" tnt_1 "), None).unwrap(),
            "tnt_1"
        );
    }

    #[test]
    fn bos_sube_kimligi_reddedilir() {
        assert!(require_branch_id("  ").is_err());
        assert_eq!(require_branch_id(" br_1 ").unwrap(), "br_1");
    }

    #[test]
    fn yazma_yalnizca_masterdan_gecer() {
        assert!(rbac::require_master_present(Some("OWNER")).is_err());
        assert!(rbac::require_master_present(Some("MANAGER")).is_err());
        assert!(rbac::require_master_present(Some("CASHIER")).is_err());
        assert!(rbac::require_master_present(None).is_err());
        assert!(rbac::require_master_present(Some("MASTER")).is_ok());
    }

    #[test]
    fn okuma_patron_ve_mudure_acik_kasiyere_degil() {
        let allowed = &[Role::Owner, Role::Manager, Role::Master];
        assert!(rbac::require_any_present(Some("OWNER"), allowed).is_ok());
        assert!(rbac::require_any_present(Some("MANAGER"), allowed).is_ok());
        assert!(rbac::require_any_present(Some("MASTER"), allowed).is_ok());
        assert!(rbac::require_any_present(Some("CASHIER"), allowed).is_err());
        assert!(rbac::require_any_present(Some("WAITER"), allowed).is_err());
        assert!(rbac::require_any_present(None, allowed).is_err());
    }

    #[test]
    fn sube_kimligi_prefexlidir() {
        let id = new_branch_id();
        assert!(id.starts_with("br_"), "kimlik prefexsiz: {}", id);
        assert_eq!(id.len(), 15);
    }

    #[test]
    fn patron_yalniz_kendi_tenantini_okur() {
        let own = resolve_target_tenant(Some("OWNER"), Some("tnt_kendi"), Some("tnt_kendi"));
        assert_eq!(own.unwrap(), "tnt_kendi");

        // Tenant alanı hiç gönderilmezse oturum tenant'ı kullanılır.
        let implicit = resolve_target_tenant(Some("OWNER"), Some("tnt_kendi"), None);
        assert_eq!(implicit.unwrap(), "tnt_kendi");
    }

    #[test]
    fn baskasinin_tenanti_reddedilir() {
        // En kritik kapı: işletme sahibi başka bir işletmenin şubelerini okuyamaz.
        let cross = resolve_target_tenant(Some("OWNER"), Some("tnt_kendi"), Some("tnt_baska"));
        assert!(cross.is_err(), "cross-tenant şube okuması açık kalmış");

        let cross_manager = resolve_target_tenant(Some("MANAGER"), Some("tnt_kendi"), Some("tnt_baska"));
        assert!(cross_manager.is_err(), "müdür cross-tenant okuması açık kalmış");
    }

    #[test]
    fn oturum_tenanti_bosken_fail_closed() {
        assert!(resolve_target_tenant(Some("OWNER"), None, Some("tnt_baska")).is_err());
        assert!(resolve_target_tenant(Some("OWNER"), Some("  "), None).is_err());
    }

    #[test]
    fn master_hedef_tenant_secebilir() {
        // MASTER'ın oturum tenant'ı platform varsayılanıdır; yönettiği işletmeyi
        // `tenant_id` ile seçer.
        let selected = resolve_target_tenant(Some("MASTER"), Some("DEFAULT_TENANT"), Some("tnt_hedef"));
        assert_eq!(selected.unwrap(), "tnt_hedef");

        let fallback = resolve_target_tenant(Some("MASTER"), Some("tnt_hedef"), None);
        assert_eq!(fallback.unwrap(), "tnt_hedef");
    }
}