//! Yedek listesi, elle yedek, ikinci klasör ve geri yükleme.

use crate::commands::auth_commands::authenticate_by_identifier;
use crate::db::DbPool;
use crate::rbac::Role;
use crate::services::backup::{self, schedule, BackupFile};
use crate::services::{device_session, setup};
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

/// Yedeğe döner. Veri kaybettiren işlem olduğu için patron şifresi ister; dönüşten
/// önce mevcut durum ayrıca yedeklenir ve uygulama yeniden açılır.
#[tauri::command]
pub async fn restore_backup(
    file_path: String,
    password: String,
    actor_role: String,
    app: tauri::AppHandle,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    crate::rbac::require_any(&actor_role, &[Role::Owner])?;
    let db_path = require_db_path(&state)?.clone();
    let email = {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        device_session::load(&mut conn)
            .await?
            .email
            .ok_or_else(|| "ACCOUNT_REQUIRED: hesap oturumu yok.".to_string())?
    };
    let account = authenticate_by_identifier(&pool, &email, &password).await?;
    crate::rbac::require_any(&account.role, &[Role::Owner])?;

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
