//! Borç / alacak komutları (veresiye, toptancı borcu)
//!
//! Bu dosya ledger_commands.rs 500 satır tavanını aştığı için bölündü.
//!
//! Güvenlik kapıları (Faz 9): rol kapısı, fail-closed kiracı çözümü,
//! para okumalarında hata yükseltme, her yazma işleminde `audit_ledger` kaydı.

use crate::commands::command_helpers::audit_actor;
use crate::db::DbPool;
use crate::id_generator::generate_id;
use crate::ledger_commands::guard::{require_ledger_read, require_ledger_tenant, require_ledger_write};
use crate::services::audit_service::{self, AuditContext, AuditService};
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DebtDto {
    pub id: String,
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    #[serde(rename = "directoryId")]
    pub directory_id: String,
    #[serde(rename = "directoryName")]
    pub directory_name: Option<String>,
    #[serde(rename = "type")]
    pub debt_type: String, // 'GIVEN' (Alacak) veya 'TAKEN' (Borç)
    #[serde(rename = "totalAmountCents")]
    pub total_amount_cents: i64,
    #[serde(rename = "remainingAmountCents")]
    pub remaining_amount_cents: i64,
    #[serde(rename = "dueDate")]
    pub due_date: Option<String>,
    pub status: String,
    #[serde(rename = "isCash")]
    pub is_cash: bool,
    #[serde(rename = "orderId")]
    pub order_id: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CreateDebtPayload {
    #[serde(rename = "tenantId")]
    pub tenant_id: Option<String>,
    #[serde(rename = "directoryId")]
    pub directory_id: String,
    #[serde(rename = "type")]
    pub debt_type: String,
    #[serde(rename = "totalAmountCents")]
    pub total_amount_cents: i64,
    #[serde(rename = "dueDate")]
    pub due_date: Option<String>,
    #[serde(rename = "isCash")]
    pub is_cash: Option<bool>,
    #[serde(rename = "orderId")]
    pub order_id: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "actorId")]
    pub actor_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PayDebtPayload {
    #[serde(rename = "tenantId")]
    pub tenant_id: Option<String>,
    #[serde(rename = "debtId")]
    pub debt_id: String,
    #[serde(rename = "amountCents")]
    pub amount_cents: i64,
    #[serde(rename = "paymentMethod")]
    pub payment_method: String, // 'CASH', 'CREDIT_CARD', 'BANK_TRANSFER'
    #[serde(rename = "actorId")]
    pub actor_id: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DebtPaymentResultDto {
    #[serde(rename = "paymentId")]
    pub payment_id: String,
    #[serde(rename = "debtId")]
    pub debt_id: String,
    #[serde(rename = "amountCents")]
    pub amount_cents: i64,
    #[serde(rename = "remainingAmountCents")]
    pub remaining_amount_cents: i64,
    pub status: String,
    #[serde(rename = "cashMovementId")]
    pub cash_movement_id: Option<String>,
}

/// `get_debts` çıktısındaki tek satırı DTO'ya çevirir.
///
/// Neden ayrı fonksiyon: borç satırı birden fazla yerde okunuyor; para alanları
/// (`total_amount_cents`, `remaining_amount_cents`) AGENTS.md §3.4 gereği hata
/// ile yükseltilir, `unwrap_or(0)` ile sıfırlanmaz.
fn row_to_debt(r: &sqlx::sqlite::SqliteRow) -> Result<DebtDto, String> {
    let is_cash_int: i64 = r.try_get("is_cash").map_err(|e| e.to_string())?;
    Ok(DebtDto {
        id: r.try_get("id").map_err(|e| e.to_string())?,
        tenant_id: r.try_get("tenant_id").map_err(|e| e.to_string())?,
        directory_id: r.try_get("directory_id").map_err(|e| e.to_string())?,
        directory_name: r.try_get("directory_name").map_err(|e| e.to_string())?,
        debt_type: r.try_get("type").map_err(|e| e.to_string())?,
        total_amount_cents: r.try_get("total_amount_cents").map_err(|e| e.to_string())?,
        remaining_amount_cents: r.try_get("remaining_amount_cents").map_err(|e| e.to_string())?,
        due_date: r.try_get("due_date").map_err(|e| e.to_string())?,
        status: r.try_get("status").map_err(|e| e.to_string())?,
        is_cash: is_cash_int == 1,
        order_id: r.try_get("order_id").map_err(|e| e.to_string())?,
        description: r.try_get("description").map_err(|e| e.to_string())?,
        created_at: r.try_get("created_at").map_err(|e| e.to_string())?,
    })
}

/// Borç veya alacak kayıtlarını listeler.
#[tauri::command]
pub async fn get_debts(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    status: Option<String>,
    debt_type: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<DebtDto>, String> {
    require_ledger_read(actor_role.as_deref())?;

    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let mut query_str = String::from(
        "SELECT deb.id, deb.tenant_id, deb.directory_id, d.name as directory_name,
                deb.type, deb.total_amount_cents, deb.remaining_amount_cents, deb.due_date,
                deb.status, deb.is_cash, deb.order_id, deb.description, deb.created_at
         FROM debts deb
         LEFT JOIN directories d ON deb.directory_id = d.id AND d.tenant_id = deb.tenant_id
         WHERE deb.tenant_id = ?"
    );

    if status.is_some() {
        query_str.push_str(" AND deb.status = ?");
    }
    if debt_type.is_some() {
        query_str.push_str(" AND deb.type = ?");
    }
    query_str.push_str(" ORDER BY deb.created_at DESC");

    let mut query = sqlx::query(&query_str).bind(&tid);
    if let Some(ref st) = status {
        query = query.bind(st);
    }
    if let Some(ref dt) = debt_type {
        query = query.bind(dt);
    }

    let rows = query.fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;

    let mut result = Vec::with_capacity(rows.len());
    for r in rows {
        result.push(row_to_debt(&r)?);
    }

    Ok(result)
}

/// Yeni borç veya alacak kaydı oluşturur.
#[tauri::command]
pub async fn create_debt(
    actor_role: Option<String>,
    actor_id: Option<String>,
    payload: CreateDebtPayload,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DebtDto, String> {
    require_ledger_write(actor_role.as_deref())?;

    if payload.total_amount_cents <= 0 {
        return Err("Borç/Alacak tutarı 0'dan büyük olmalıdır.".to_string());
    }
    if payload.debt_type != "GIVEN" && payload.debt_type != "TAKEN" {
        return Err("Borç/Alacak tipi 'GIVEN' veya 'TAKEN' olmalıdır.".to_string());
    }

    let tid = require_ledger_tenant(payload.tenant_id.as_deref())?;
    let id = generate_id("dbt");
    let is_cash_val = if payload.is_cash.unwrap_or(false) { 1 } else { 0 };

    let audit_lock = audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Cari kartın adını çek
    let dir_name: Option<String> = sqlx::query_scalar(
        "SELECT name FROM directories WHERE id = ? AND tenant_id = ?"
    )
    .bind(&payload.directory_id)
    .bind(&tid)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Neden bu kapı şart: `dir_name` `None` çıkabilir (cari kart silinmiş ya da
    // başka kiracının kartı). Bu durumda borç kaydı yine de açılırdı ve
    // bakiye kimseye bağlanmazdı; yani "bize borçlu" kalemi kayıp giderdi.
    if dir_name.is_none() {
        return Err("Cari kart bulunamadı (kiracı eşleşmedi).".to_string());
    }

    sqlx::query(
        "INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents, remaining_amount_cents, due_date, status, is_cash, order_id, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, datetime('now'))"
    )
    .bind(&id)
    .bind(&tid)
    .bind(&payload.directory_id)
    .bind(&payload.debt_type)
    .bind(payload.total_amount_cents)
    .bind(payload.total_amount_cents)
    .bind(&payload.due_date)
    .bind(is_cash_val)
    .bind(&payload.order_id)
    .bind(&payload.description)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Borç kaydı oluşturulamadı: {}", e))?;

    let (audit_actor_id, audit_actor_role) = audit_actor(
        actor_id.or(payload.actor_id.clone()),
        actor_role,
    );
    let ctx = AuditContext::new(
        tid.clone(),
        audit_actor_id,
        audit_actor_role,
        audit_service::category::FINANS,
        "debt:created",
        id.clone(),
        serde_json::json!({
            "debtId": id,
            "directoryId": payload.directory_id,
            "type": payload.debt_type,
            "totalAmountCents": payload.total_amount_cents,
            "isCash": payload.is_cash.unwrap_or(false),
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(DebtDto {
        id,
        tenant_id: tid,
        directory_id: payload.directory_id,
        directory_name: dir_name,
        debt_type: payload.debt_type,
        total_amount_cents: payload.total_amount_cents,
        remaining_amount_cents: payload.total_amount_cents,
        due_date: payload.due_date,
        status: "PENDING".to_string(),
        is_cash: payload.is_cash.unwrap_or(false),
        order_id: payload.order_id,
        description: payload.description,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Borç veya alacak için tahsilat/tediye ödemesi kaydeder.
/// Eğer nakit (CASH) ise kasa çekmecesine cash_movement (IN veya OUT) yazar.
#[tauri::command]
pub async fn pay_debt(
    actor_role: Option<String>,
    payload: PayDebtPayload,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DebtPaymentResultDto, String> {
    require_ledger_write(actor_role.as_deref())?;

    if payload.amount_cents <= 0 {
        return Err("Ödeme tutarı 0'dan büyük olmalıdır.".to_string());
    }

    let tid = require_ledger_tenant(payload.tenant_id.as_deref())?;
    let audit_lock = audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Borç kaydını sorgula
    let debt_row = sqlx::query(
        "SELECT deb.id, deb.tenant_id, deb.directory_id, deb.type, deb.remaining_amount_cents, d.name as directory_name
         FROM debts deb
         LEFT JOIN directories d ON deb.directory_id = d.id AND d.tenant_id = deb.tenant_id
         WHERE deb.id = ? AND deb.tenant_id = ?"
    )
    .bind(&payload.debt_id)
    .bind(&tid)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Borç kaydı bulunamadı.".to_string())?;

    let remaining: i64 = debt_row.try_get("remaining_amount_cents").map_err(|e| e.to_string())?;
    let debt_type: String = debt_row.try_get("type").map_err(|e| e.to_string())?;
    let dir_name: String = debt_row.try_get("directory_name").map_err(|e| e.to_string())?;

    if debt_type != "GIVEN" && debt_type != "TAKEN" {
        return Err(format!("Bilinmeyen borç tipi: {}", debt_type));
    }
    if payload.amount_cents > remaining {
        return Err(format!(
            "Ödeme tutarı ({} kuruş) kalan borçtan ({} kuruş) büyük olamaz.",
            payload.amount_cents, remaining
        ));
    }

    let new_remaining = remaining - payload.amount_cents;
    let new_status = if new_remaining == 0 { "PAID" } else { "PARTIAL" };

    // Borç durumunu güncelle
    let updated = sqlx::query(
        "UPDATE debts SET remaining_amount_cents = ?, status = ? WHERE id = ? AND tenant_id = ?"
    )
    .bind(new_remaining)
    .bind(new_status)
    .bind(&payload.debt_id)
    .bind(&tid)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Neden şart: bakiye güncellemesi sessizce 0 satır etkileyebilir (kiracı
    // eşleşmedi / yarış durumu). Bu durumda `debt_payments` yazılır, bakiye
    // düşmez ve tahsilat kayıp giderdi.
    if updated.rows_affected() != 1 {
        return Err("Borç bakiyesi güncellenemedi (kiracı eşleşmedi).".to_string());
    }

    // Ödeme kaydını oluştur
    let payment_id = generate_id("pmt");
    let mut cash_movement_id: Option<String> = None;

    // Aktif vardiya kontrolü
    let active_shift_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM shifts WHERE tenant_id = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1"
    )
    .bind(&tid)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Nakit ise kasa hareketini işle
    if payload.payment_method == "CASH" {
        let cm_id = generate_id("csh");
        let movement_type = if debt_type == "GIVEN" { "IN" } else { "OUT" };
        let reason = if debt_type == "GIVEN" {
            format!("Cari Alacak Tahsilatı: {}", dir_name)
        } else {
            format!("Cari Borç Tediyesi: {}", dir_name)
        };

        let shift_id_for_cm = active_shift_id.clone().unwrap_or_else(|| "NO_SHIFT".to_string());

        sqlx::query(
            "INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))"
        )
        .bind(&cm_id)
        .bind(&tid)
        .bind(&shift_id_for_cm)
        .bind(movement_type)
        .bind(payload.amount_cents)
        .bind(&reason)
        .bind(&payload.actor_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Kasa nakit hareketi işlenemedi: {}", e))?;

        cash_movement_id = Some(cm_id);
    }

    // debt_payments tablosuna ekle
    sqlx::query(
        "INSERT INTO debt_payments (id, tenant_id, debt_id, amount_cents, payment_method, shift_id, actor_id, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
    )
    .bind(&payment_id)
    .bind(&tid)
    .bind(&payload.debt_id)
    .bind(payload.amount_cents)
    .bind(&payload.payment_method)
    .bind(&active_shift_id)
    .bind(&payload.actor_id)
    .bind(&payload.notes)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Ödeme kaydı eklenemedi: {}", e))?;

    let (audit_actor_id, audit_actor_role) = audit_actor(Some(payload.actor_id.clone()), actor_role);
    let ctx = AuditContext::new(
        tid.clone(),
        audit_actor_id,
        audit_actor_role,
        audit_service::category::FINANS,
        "debt:paid",
        payload.debt_id.clone(),
        serde_json::json!({
            "debtId": payload.debt_id,
            "paymentId": payment_id,
            "amountCents": payload.amount_cents,
            "paymentMethod": payload.payment_method,
            "remainingAmountCents": new_remaining,
            "cashMovementId": cash_movement_id,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(DebtPaymentResultDto {
        payment_id,
        debt_id: payload.debt_id,
        amount_cents: payload.amount_cents,
        remaining_amount_cents: new_remaining,
        status: new_status.to_string(),
        cash_movement_id,
    })
}