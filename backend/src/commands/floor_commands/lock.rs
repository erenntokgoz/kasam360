//! Masa kilit mekanizması ve offline çatışma yönetimi.
//!
//! Neden ayrı modül: Kilit mantığı hem tauri komutları hem de testler
//! tarafından doğrudan çağrılır; salon planı mantığından bağımsızdır.

use crate::commands::command_helpers::require_tenant_id;

/// Masa kilidi süresi (milisaniye). Offline çatışma politikası (docs/OFFLINE-CONFLICT-POLICY.md §2):
/// 30 saniye sonra otomatik unlock. Eski 30 dk'lık TTL, bir terminal kapanınca
/// başka terminalin masayı açmasını 30 dk blokluyordu.
pub const TABLE_LOCK_TTL_MS: i64 = 30_000;

/// Katılıksız kilit alma. `try_lock_table` tauri komutunun kiracı doğrulama ve
/// kilitleme mantığını taşır; test doğrudan çağrılabilsin diye ayrı çıkarıldı.
///
/// `ttl_ms` parametresi: üretimde `TABLE_LOCK_TTL_MS` (30 sn), testlerde 1–5 ms.
pub async fn try_acquire_table_lock(
    locks: &tokio::sync::Mutex<std::collections::HashMap<String, (String, i64)>>,
    tenant_id: &str,
    table_id: &str,
    waiter_id: &str,
    ttl_ms: i64,
) -> Result<bool, String> {
    let mut guard = locks.lock().await;
    let now = chrono::Utc::now().timestamp_millis();
    let lock_key = format!("{}:{}", tenant_id, table_id);

    if let Some((locked_by, locked_at)) = guard.get(&lock_key) {
        if locked_by != waiter_id && (now - locked_at) < ttl_ms {
            let remaining = (ttl_ms - (now - locked_at)) / 1000;
            return Err(format!(
                "TABLE_LOCKED: Masa {} şu anda {} tarafından açık (kalan {} saniye).",
                table_id, locked_by, remaining
            ));
        }
    }

    guard.insert(lock_key, (waiter_id.to_string(), now));
    Ok(true)
}

/// Katılıksız kilit bırakma. `unlock_table` tauri komutunun çekirdeği.
pub async fn release_table_lock(
    locks: &tokio::sync::Mutex<std::collections::HashMap<String, (String, i64)>>,
    tenant_id: &str,
    table_id: &str,
    waiter_id: &str,
) -> Result<(), String> {
    let mut guard = locks.lock().await;
    let lock_key = format!("{}:{}", tenant_id, table_id);
    if let Some((locked_by, _)) = guard.get(&lock_key) {
        if locked_by == waiter_id {
            guard.remove(&lock_key);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn try_lock_table(
    table_id: String,
    waiter_id: String,
    tenant_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    let tenant = require_tenant_id(Some(&tenant_id))?;
    try_acquire_table_lock(
        &state.table_locks,
        &tenant,
        &table_id,
        &waiter_id,
        TABLE_LOCK_TTL_MS,
    )
    .await
}

#[tauri::command]
pub async fn unlock_table(
    table_id: String,
    waiter_id: String,
    tenant_id: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let tenant = require_tenant_id(Some(&tenant_id))?;
    release_table_lock(&state.table_locks, &tenant, &table_id, &waiter_id).await
}
