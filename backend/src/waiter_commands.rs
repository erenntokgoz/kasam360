use crate::db::DbPool;
use serde::{Deserialize, Serialize};

pub use crate::services::modifier_service::{ModifierGroupDto, ModifierOptionDto};

/// Ürüne bağlı modifier grupları ve seçenekleri (POS seçim penceresi).
///
/// Faz 4 düzeltmesi: komut `tenant_id` ile sınırlandı. Önceden ürün `id`'si tek
/// başına yeterliydi, dolayısıyla başka işletmenin ürününe bağlı gruplar
/// okunabiliyordu; ayrıca seçenekler grup başına ayrı sorguyla (N+1) alınıyordu.
#[tauri::command]
pub async fn get_product_modifiers(
    product_id: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<ModifierGroupDto>, String> {
    let tid = tenant_id
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    crate::services::modifier_service::product_groups(&mut conn, &tid, &product_id).await
}

/// Masa durumunu doğrudan yazar.
///
/// Neden bu komut en zayıf kapıydı: `status` serbest metin alınıyor, tenant
/// filtresi yoktu (`WHERE id = ?`) ve rol denetimi hiç yoktu. Bu yüzden herhangi
/// bir oturum başka bir işletmenin masasını boşaltabiliyor, "RESERVED" olmayan
/// bir değer yazabiliyor ve şemadaki CHECK'i yalnız SQLite yakalıyordu.
///
/// Faz 8 kuralları:
/// - **Yalnız izin verilen üç durum:** `AVAILABLE`, `RESERVED`, `OCCUPIED`.
/// - **Tenant zorunlu** ve hedef masa bu kiracıya ait olmalı.
/// - **RBAC:** masa durumu yalnız garson, müdür ve işletme sahibi tarafından
///   değiştirilir; kasa ve mutfak değiştiremez.
/// - **Rezervasyon bütünlüğü:** rezervasyon bloğu elle kapatılamaz. Bir masa
///   `AVAILABLE` yapılırken varsa açık rezervasyon kaydı önce iptal edilir;
///   `RESERVED` yazmak ise **reservations tablosuna kayıt olmadan** mümkün değildir,
///   bu yüzden bu komuttan `RESERVED` geçişi kaldırıldı (yalnız `reserve_table`).
#[tauri::command]
pub async fn update_table_status(
    table_id: String,
    status: String,
    tenant_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    crate::rbac::require_any_present(
        actor_role.as_deref(),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Waiter,
        ],
    )?;
    let tenant = tenant_id
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string())?;
    let target = status.trim().to_uppercase();
    if !matches!(target.as_str(), "AVAILABLE" | "OCCUPIED") {
        return Err(format!(
            "VALIDATION: '{}' geçerli bir masa durumu değil (AVAILABLE, OCCUPIED)",
            target
        ));
    }

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let exists: Option<String> =
        sqlx::query_scalar("SELECT id FROM tables WHERE id = ? AND tenant_id = ?")
            .bind(table_id.trim())
            .bind(&tenant)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    if exists.is_none() {
        return Err("NOT_FOUND: bu işletmeye ait masa bulunamadı".to_string());
    }

    // Masa boşaltılıyorsa açık rezervasyon kaydı da kapatılır; aksi halde kayıt
    // açık kalır ve kısmi tekil indeks yüzünden aynı masa yeniden rezerve
    // edilemezdi.
    if target == "AVAILABLE" {
        let _ = crate::services::reservation_service::close_open_for_table(
            &mut conn,
            &tenant,
            table_id.trim(),
            "MANUEL_DURUM",
            "MASYA_BOSALTILDI",
        )
        .await?;
    }

    sqlx::query("UPDATE tables SET status = ? WHERE id = ? AND tenant_id = ?")
        .bind(&target)
        .bind(table_id.trim())
        .bind(&tenant)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Garson vardiyaya giriş kaydı.
///
/// Neden yetki + tenant eklendi (AGENTS.md §3.3 ve §6): komut ne RBAC çağırıyordu
/// ne de `tenant_id` bağlıyordu. `events` tablosundaki `tenant_id` sütunu varsayılan
/// `DEFAULT_TENANT` olduğu için tüm garson girişleri tek bir işletmenin altında
/// birikmişti; işletme büyüdükçe "bu garson hangi şubede çalıştı" sorusu cevaplanamaz
/// hale geliyordu. Personelin vardiya süresi KPI'ya girdiği için bu kayıt artık
/// kiracıya bağlı olmak zorundadır.
#[tauri::command]
pub async fn waiter_clock_in(
    waiter_id: String,
    tenant_id: String,
    actor_role: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<String, String> {
    // Garson kendi vardiyasını açabilir; müdür ve patron da açabilir.
    crate::rbac::require_any_present(
        Some(actor_role.as_str()),
        &[
            crate::rbac::Role::Owner,
            crate::rbac::Role::Manager,
            crate::rbac::Role::Waiter,
        ],
    )?;
    let tenant = tenant_id.trim().to_string();
    if tenant.is_empty() {
        return Err("tenant_id gerekli".to_string());
    }
    let event_id = format!("evt_clockin_{}", uuid::Uuid::new_v4());
    let payload = serde_json::json!({
        "waiterId": waiter_id,
        "clockedIn": true,
        "tenantId": tenant,
    });
    sqlx::query(
        "INSERT INTO events
             (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at)
         VALUES (?1, ?2, ?3, 'WAITER_SHIFT', 'CLOCK_IN', ?4, datetime('now'))",
    )
    .bind(&event_id)
    .bind(&tenant)
    .bind(&waiter_id)
    // `to_string` hatası yutulmaz: bozuk payload yazmak sessizce veri kaybıdır.
    .bind(serde_json::to_string(&payload).map_err(|e| e.to_string())?)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(event_id)
}

#[tauri::command]
pub async fn get_table_ready_status(
    table_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<String, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let row = sqlx::query("
        SELECT e.payload FROM events e
        JOIN orders o ON e.aggregate_id = o.id
        WHERE o.table_id = ? AND o.status = 'IN_PROGRESS'
        AND e.event_type = 'TICKET_STATUS_UPDATED'
        ORDER BY e.created_at DESC LIMIT 1
    ")
    .bind(&table_id)
    .fetch_optional(&mut *conn).await.map_err(|e| e.to_string())?;

    if let Some(r) = row {
        use sqlx::Row;
        let payload_str: String = r.try_get("payload").unwrap_or_default();
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&payload_str) {
            return Ok(v.get("toStatus").and_then(|s| s.as_str()).unwrap_or("Unknown").to_string());
        }
    }
    Ok("Unknown".to_string())
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TableReadyStatusDto {
    #[serde(rename = "tableId")]
    pub table_id: String,
    pub status: String,
}

/// N+1 sorgu darboğazını engelleyen toplu masa KDS hazır durumu sorgusu.
#[tauri::command]
pub async fn get_all_table_statuses(
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<TableReadyStatusDto>, String> {
    let tid = tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let rows = sqlx::query(
        "SELECT o.table_id, e.payload FROM events e
         JOIN orders o ON e.aggregate_id = o.id
         WHERE o.tenant_id = ? AND o.status = 'IN_PROGRESS'
         AND e.event_type = 'TICKET_STATUS_UPDATED'
         ORDER BY e.created_at ASC"
    )
    .bind(&tid)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut map = std::collections::HashMap::new();
    for r in rows {
        use sqlx::Row;
        let table_id: String = r.try_get("table_id").unwrap_or_default();
        let payload_str: String = r.try_get("payload").unwrap_or_default();
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&payload_str) {
            let status = v.get("toStatus").and_then(|s| s.as_str()).unwrap_or("Unknown").to_string();
            map.insert(table_id, status);
        }
    }

    Ok(map.into_iter().map(|(table_id, status)| TableReadyStatusDto { table_id, status }).collect())
}

