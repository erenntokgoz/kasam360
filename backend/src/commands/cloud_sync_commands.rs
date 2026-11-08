//! Bulut eşitlemesinin komutları: durum, hesaptan çıkış ve girişte geri yükleme.
//!
//! Ağ yalnız sabit site adresine gider (`SITE_URL`); IPC'den adres gelmez.

use crate::commands::account_commands::{sign_out_device, SITE_URL};
use crate::commands::license_commands::{
    account_tenants, activate_for_tenant, link_with_password, TenantChoice,
};
use crate::db::DbPool;
use crate::services::cloud_sync::api::{Credentials, HttpApi};
use crate::services::cloud_sync::{
    CloudSync, CloudSyncStatus, RestoreOutcome, RestoreProgress, SyncError,
};
use crate::services::device_session::{self, DeviceSession};
use serde::Serialize;
use tauri::Emitter;

/// Geri yükleme ilerlemesi bu olayla ekrana gider.
pub const RESTORE_EVENT: &str = "cloud-restore-progress";
/// Durum değişince yayınlanan olay.
pub const STATUS_EVENT: &str = "cloud-sync-status";

#[tauri::command]
pub async fn get_cloud_sync_status(
    cloud: tauri::State<'_, CloudSync>,
) -> Result<CloudSyncStatus, String> {
    cloud.status().await
}

#[tauri::command]
pub async fn retry_cloud_sync(cloud: tauri::State<'_, CloudSync>) -> Result<(), String> {
    cloud.nudge();
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSignOut {
    pub session: DeviceSession,
    /// Bu kasanın verisi ve lisansı silindi mi.
    pub wiped: bool,
    /// Silinmediyse buluta henüz gitmemiş işlem sayısı.
    pub pending: i64,
    pub code: Option<String>,
}

/// Hesaptan çıkış. Oturum her durumda kapanır; yerel veri yalnız bulut bütün işlemleri
/// aldığını doğrularsa silinir, yoksa internet gelince arka planda tamamlanır.
#[tauri::command]
pub async fn cloud_sign_out(
    actor_id: String,
    actor_role: String,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
    cloud: tauri::State<'_, CloudSync>,
) -> Result<CloudSignOut, String> {
    sign_out_device(&pool, &state, actor_id, actor_role, tenant_id).await?;
    state.staff_session.clear()?;
    let api = HttpApi::new(SITE_URL)?;
    let outcome = cloud.sign_out(&api).await?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let session = device_session::load(&mut conn).await?;
    Ok(CloudSignOut {
        session,
        wiped: outcome.wiped,
        pending: outcome.pending,
        code: outcome.code,
    })
}

fn restore_error(error: SyncError) -> String {
    format!("{}: {}", error.code(), error.message())
}

/// Boş kasada hesapla giriş: cihaz hesaba bağlanır, işletme buluttaysa indirilir.
/// Hesap henüz bir işletmeye bağlı değilse `restored: false` döner ve kurulum sürer.
#[tauri::command]
pub async fn cloud_restore(
    email: String,
    password: String,
    app: tauri::AppHandle,
    pool: tauri::State<'_, DbPool>,
    cloud: tauri::State<'_, CloudSync>,
) -> Result<RestoreOutcome, String> {
    let email = device_session::normalize_email(&email)?;
    {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        if crate::services::setup::load_state(&mut conn).await?.status != "PENDING" {
            return Err("CONFLICT: bu kasada işletme kurulu".to_string());
        }
    }
    link_with_password(&pool, &email, &password).await?;
    let api = HttpApi::new(SITE_URL)?;
    let progress = move |step: RestoreProgress| {
        if let Err(reason) = app.emit(RESTORE_EVENT, &step) {
            tracing::warn!("Geri yükleme ilerlemesi yayınlanamadı: {reason}");
        }
    };
    match cloud.restore(&api, Some(&email), &progress).await {
        Ok(outcome) => Ok(outcome),
        Err(error) => match nothing_to_restore(&error) {
            true => Ok(RestoreOutcome {
                restored: false,
                tenant_id: None,
                rows: 0,
                skipped_audit_rows: 0,
            }),
            false => Err(restore_error(error)),
        },
    }
}

async fn require_pending(pool: &DbPool) -> Result<(), String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    if crate::services::setup::load_state(&mut conn).await?.status != "PENDING" {
        return Err("CONFLICT: bu kasada işletme kurulu".to_string());
    }
    Ok(())
}

/// Boş kasada, bağlı hesabın mevcut işletmeleri. Kurulu kasada çağrılamaz.
#[tauri::command]
pub async fn list_cloud_tenants(
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<TenantChoice>, String> {
    require_pending(&pool).await?;
    account_tenants(&pool).await
}

/// Boş kasayı seçilen mevcut işletmeye bağlar: cihaz etkinleştirilir (cihaz sınırı sunucuda),
/// işletmenin bulut verisi tek transaction'da indirilir. Kullanıcılar buluttan gelir; yeni OWNER
/// açılmaz. Bulutta henüz kasa verisi yoksa yerel işletme kaydı aynı kimlikle hazırlanır ve
/// kurulum o işletme adına sürer. Dolu kasaya yazılmaz; yarıda kalan indirme kasayı boş bırakır.
#[tauri::command]
pub async fn cloud_restore_tenant(
    tenant_id: String,
    email: String,
    app: tauri::AppHandle,
    pool: tauri::State<'_, DbPool>,
    cloud: tauri::State<'_, CloudSync>,
) -> Result<RestoreOutcome, String> {
    require_pending(&pool).await?;
    let email = device_session::normalize_email(&email)?;
    // İşletme adı ve kimliği IPC'den güvenilmez; hesabın sunucudaki listesinden doğrulanır.
    let choice = account_tenants(&pool)
        .await?
        .into_iter()
        .find(|choice| choice.tenant_id == tenant_id)
        .ok_or_else(|| "NOT_FOUND: bu hesapta böyle bir işletme yok".to_string())?;
    let (status, license_key, device_id) =
        activate_for_tenant(&pool, &choice.tenant_id, &choice.name).await?;
    if !matches!(
        status.state,
        crate::services::license::LicenseState::Active
            | crate::services::license::LicenseState::Grace
    ) {
        return Err(format!(
            "LICENSE: {}",
            status
                .last_error
                .unwrap_or_else(|| "Bu cihaz işletmeye bağlanamadı.".to_string())
        ));
    }
    let credentials = Credentials {
        tenant_id: choice.tenant_id.clone(),
        license_key,
        license_device_id: device_id,
    };
    let api = HttpApi::new(SITE_URL)?;
    let progress = move |step: RestoreProgress| {
        if let Err(reason) = app.emit(RESTORE_EVENT, &step) {
            tracing::warn!("Geri yükleme ilerlemesi yayınlanamadı: {reason}");
        }
    };
    let outcome = cloud
        .restore_tenant(&api, &credentials, Some(&email), &progress)
        .await
        .map_err(restore_error)?;
    if !outcome.restored {
        prepare_tenant_record(&pool, &choice).await?;
        return Ok(RestoreOutcome {
            restored: false,
            tenant_id: Some(choice.tenant_id),
            rows: 0,
            skipped_audit_rows: 0,
        });
    }
    Ok(outcome)
}

/// Bulutta kasa verisi olmayan işletmede ilk kasa kurulumu aynı işletme kimliğini kullanır;
/// kurulum yalnız boş kasada mevcut tek işletme kaydını devralır.
async fn prepare_tenant_record(pool: &DbPool, choice: &TenantChoice) -> Result<(), String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let existing: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tenants")
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    if existing > 0 {
        let same: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tenants WHERE id = ?")
            .bind(&choice.tenant_id)
            .fetch_one(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        if same == 0 {
            return Err("CONFLICT: kasada başka bir işletme kaydı var".to_string());
        }
        return Ok(());
    }
    sqlx::query("INSERT INTO tenants (id, name, status) VALUES (?, ?, 'ACTIVE')")
        .bind(&choice.tenant_id)
        .bind(&choice.name)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Paketsiz hesabın bulutta işletmesi olamaz (gönderim lisanslı cihaz ister). Boş kasada henüz
/// işletme seçilmediyse de indirilecek kapsam yoktur; bu durum kurulumu kilitlemez, yeni işletme
/// kurulumu sürer. Diğer bütün hatalar kurulumu durdurur ki yarım indirme üstüne kurulum yapılmasın.
fn nothing_to_restore(error: &SyncError) -> bool {
    matches!(error, SyncError::Halted { code, .. } if code == "LICENSE_INACTIVE" || code == "NO_LICENSE_KEY")
}

#[cfg(test)]
mod restore_outcome_tests {
    use super::*;

    #[test]
    fn isletme_secilmemis_bos_kasa_kurulumu_kilitlemez_diger_hatalar_durdurur() {
        let halted = |code: &str| SyncError::Halted {
            code: code.to_string(),
            message: String::new(),
        };
        assert!(nothing_to_restore(&halted("NO_LICENSE_KEY")));
        assert!(nothing_to_restore(&halted("LICENSE_INACTIVE")));
        assert!(!nothing_to_restore(&halted("DEVICE_REVOKED")));
        assert!(!nothing_to_restore(&SyncError::Local(
            "TENANT_MISMATCH".to_string()
        )));
    }
}
