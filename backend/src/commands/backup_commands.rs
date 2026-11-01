//! Yedek listesi, elle yedek, ikinci klasör ve geri yükleme.

use crate::commands::auth_commands::unlock_session;
use crate::commands::receipt_commands::require_tenant_scope;
use crate::db::DbPool;
use crate::rbac::Role;
use crate::services::backup::{self, schedule, BackupFile};
use crate::services::setup;
use std::path::{Path, PathBuf};

const READ_ROLES: [Role; 2] = [Role::Owner, Role::Manager];

fn require_db_path(state: &crate::AppState) -> Result<&PathBuf, String> {
    state
        .db_path
        .as_ref()
        .ok_or_else(|| "UNSUPPORTED: bu veritabanı dosya üzerinde değil.".to_string())
}

#[tauri::command]
pub async fn get_backup_status(
    actor_role: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<schedule::BackupStatus, String> {
    crate::rbac::require_any(&actor_role, &READ_ROLES)?;
    schedule::load_status(&pool, require_db_path(&state)?).await
}

/// Bu cihazın ve ikinci klasörün yedekleri.
#[tauri::command]
pub async fn list_backups(
    actor_role: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<BackupFile>, String> {
    crate::rbac::require_any(&actor_role, &READ_ROLES)?;
    let db_path = require_db_path(&state)?;
    let status = schedule::load_status(&pool, db_path).await?;
    let mut dirs = vec![backup::backup_dir_for(db_path)];
    dirs.extend(status.mirror_dir.map(PathBuf::from));
    Ok(backup::list_backups(&dirs))
}

#[tauri::command]
pub async fn create_backup_now(
    actor_role: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<BackupFile, String> {
    crate::rbac::require_any(&actor_role, &READ_ROLES)?;
    schedule::run_backup(&pool, require_db_path(&state)?, "elle").await
}

#[tauri::command]
pub async fn set_backup_mirror(
    mirror_dir: Option<String>,
    actor_role: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    crate::rbac::require_any(&actor_role, &[Role::Owner])?;
    let dir = mirror_dir
        .as_deref()
        .map(str::trim)
        .filter(|dir| !dir.is_empty());
    schedule::set_mirror(&pool, dir).await
}

/// Eski yedeği siler. Yalnız patron silebilir; liste dışı yol reddedilir.
#[tauri::command]
pub async fn delete_backup(
    file_path: String,
    actor_role: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    crate::rbac::require_any(&actor_role, &[Role::Owner])?;
    let db_path = require_db_path(&state)?;
    let status = schedule::load_status(&pool, db_path).await?;
    let mut dirs = vec![backup::backup_dir_for(db_path)];
    dirs.extend(status.mirror_dir.map(PathBuf::from));
    backup::delete_listed(&dirs, Path::new(&file_path)).map_err(|e| e.to_string())
}

/// Yedeğe döner. Veri kaybettiren işlem olduğu için açık oturumdaki patronun PIN'ini
/// ister; dönüşten önce mevcut durum ayrıca yedeklenir ve uygulama yeniden açılır.
#[tauri::command]
pub async fn restore_backup(
    file_path: String,
    pin: String,
    actor_id: String,
    actor_role: String,
    tenant_id: Option<String>,
    app: tauri::AppHandle,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    crate::rbac::require_any(&actor_role, &[Role::Owner])?;
    let db_path = require_db_path(&state)?.clone();
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    unlock_session(&pool, &tenant, &actor_id, &pin).await?;

    backup::verify_file(Path::new(&file_path))
        .await
        .map_err(|e| format!("INVALID_BACKUP: {e}"))?;
    schedule::run_backup(&pool, &db_path, "geri_donus_oncesi").await?;
    backup::restore::schedule_restore(&db_path, Path::new(&file_path))
        .await
        .map_err(|e| format!("INVALID_BACKUP: {e}"))?;
    app.restart()
}

/// Kurulmamış cihazda yedek dosyasından döner: bozulan cihazın yerine yenisi gelir.
#[tauri::command]
pub async fn restore_backup_on_setup(
    file_path: String,
    app: tauri::AppHandle,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let db_path = require_db_path(&state)?.clone();
    {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        if setup::load_state(&mut conn).await?.status != "PENDING" {
            return Err("CONFLICT: bu cihazda kayıtlı işletme var.".to_string());
        }
    }
    backup::restore::schedule_restore(&db_path, Path::new(&file_path))
        .await
        .map_err(|e| format!("INVALID_BACKUP: {e}"))?;
    app.restart()
}
