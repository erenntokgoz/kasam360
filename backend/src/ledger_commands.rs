//! Kasam360 Finans & Cari Defteri (Hesap Defteri Hub)
//! Toptancı, Müşteri Veresiye, Personel Finansı, Borç/Alacak ve Genel İşletme Giderleri

use crate::db::DbPool;
use crate::id_generator::generate_id;
use serde::{Deserialize, Serialize};
use sqlx::Row;

// ============================================================================
// DTO TANIMLARI
// ============================================================================

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DirectoryDto {
    pub id: String,
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub directory_type: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    #[serde(rename = "taxNo")]
    pub tax_no: Option<String>,
    #[serde(rename = "taxOffice")]
    pub tax_office: Option<String>,
    pub address: Option<String>,
    #[serde(rename = "creditLimitCents")]
    pub credit_limit_cents: i64,
    pub notes: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "balanceCents")]
    pub balance_cents: i64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CreateDirectoryPayload {
    #[serde(rename = "tenantId")]
    pub tenant_id: Option<String>,
    pub name: String,
    #[serde(rename = "type")]
    pub directory_type: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    #[serde(rename = "taxNo")]
    pub tax_no: Option<String>,
    #[serde(rename = "taxOffice")]
    pub tax_office: Option<String>,
    pub address: Option<String>,
    #[serde(rename = "creditLimitCents")]
    pub credit_limit_cents: Option<i64>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UpdateDirectoryPayload {
    pub id: String,
    #[serde(rename = "tenantId")]
    pub tenant_id: Option<String>,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    #[serde(rename = "taxNo")]
    pub tax_no: Option<String>,
    #[serde(rename = "taxOffice")]
    pub tax_office: Option<String>,
    pub address: Option<String>,
    #[serde(rename = "creditLimitCents")]
    pub credit_limit_cents: Option<i64>,
    pub notes: Option<String>,
}

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

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ExpenseDto {
    pub id: String,
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    pub category: String,
    #[serde(rename = "amountCents")]
    pub amount_cents: i64,
    #[serde(rename = "paymentMethod")]
    pub payment_method: String,
    #[serde(rename = "directoryId")]
    pub directory_id: Option<String>,
    #[serde(rename = "directoryName")]
    pub directory_name: Option<String>,
    #[serde(rename = "shiftId")]
    pub shift_id: Option<String>,
    #[serde(rename = "actorId")]
    pub actor_id: String,
    pub description: Option<String>,
    #[serde(rename = "expenseDate")]
    pub expense_date: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CreateExpensePayload {
    #[serde(rename = "tenantId")]
    pub tenant_id: Option<String>,
    pub category: String,
    #[serde(rename = "amountCents")]
    pub amount_cents: i64,
    #[serde(rename = "paymentMethod")]
    pub payment_method: String,
    #[serde(rename = "directoryId")]
    pub directory_id: Option<String>,
    #[serde(rename = "actorId")]
    pub actor_id: String,
    pub description: Option<String>,
    #[serde(rename = "expenseDate")]
    pub expense_date: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ExpenseCategorySummaryDto {
    pub category: String,
    #[serde(rename = "totalCents")]
    pub total_cents: i64,
    pub count: i64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MonthlyFinancialTrendDto {
    pub month: String,
    #[serde(rename = "revenueCents")]
    pub revenue_cents: i64,
    #[serde(rename = "expenseCents")]
    pub expense_cents: i64,
    #[serde(rename = "profitCents")]
    pub profit_cents: i64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct FinancialReportDto {
    #[serde(rename = "totalRevenueCents")]
    pub total_revenue_cents: i64,
    #[serde(rename = "totalExpensesCents")]
    pub total_expenses_cents: i64,
    #[serde(rename = "netProfitCents")]
    pub net_profit_cents: i64,
    #[serde(rename = "receivablesCents")]
    pub receivables_cents: i64,
    #[serde(rename = "payablesCents")]
    pub payables_cents: i64,
    #[serde(rename = "expensesByCategory")]
    pub expenses_by_category: Vec<ExpenseCategorySummaryDto>,
    #[serde(rename = "monthlyTrend")]
    pub monthly_trend: Vec<MonthlyFinancialTrendDto>,
}

// ============================================================================
// CARİ REHBER KOMUTLARI
// ============================================================================

/// İşletmeye ait cari kartları ve bakiye durumlarını listeler.
#[tauri::command]
pub async fn get_directories(
    tenant_id: Option<String>,
    directory_type: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<DirectoryDto>, String> {
    let tid = tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let rows = if let Some(ref dtype) = directory_type {
        sqlx::query(
            "SELECT d.id, d.tenant_id, d.name, d.type, d.phone, d.email, d.tax_no, d.tax_office,
                    d.address, d.credit_limit_cents, d.notes, d.created_at,
                    COALESCE((
                        SELECT SUM(
                            CASE WHEN deb.type = 'GIVEN' THEN deb.remaining_amount_cents
                                 WHEN deb.type = 'TAKEN' THEN -deb.remaining_amount_cents
                                 ELSE 0 END
                        ) FROM debts deb WHERE deb.directory_id = d.id AND deb.status != 'PAID'
                    ), 0) as balance_cents
             FROM directories d
             WHERE d.tenant_id = ? AND d.type = ?
             ORDER BY d.name ASC"
        )
        .bind(&tid)
        .bind(dtype)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?
    } else {
        sqlx::query(
            "SELECT d.id, d.tenant_id, d.name, d.type, d.phone, d.email, d.tax_no, d.tax_office,
                    d.address, d.credit_limit_cents, d.notes, d.created_at,
                    COALESCE((
                        SELECT SUM(
                            CASE WHEN deb.type = 'GIVEN' THEN deb.remaining_amount_cents
                                 WHEN deb.type = 'TAKEN' THEN -deb.remaining_amount_cents
                                 ELSE 0 END
                        ) FROM debts deb WHERE deb.directory_id = d.id AND deb.status != 'PAID'
                    ), 0) as balance_cents
             FROM directories d
             WHERE d.tenant_id = ?
             ORDER BY d.name ASC"
        )
        .bind(&tid)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?
    };

    let mut result = Vec::with_capacity(rows.len());
    for r in rows {
        result.push(DirectoryDto {
            id: r.try_get("id").unwrap_or_default(),
            tenant_id: r.try_get("tenant_id").unwrap_or_default(),
            name: r.try_get("name").unwrap_or_default(),
            directory_type: r.try_get("type").unwrap_or_default(),
            phone: r.try_get("phone").ok(),
            email: r.try_get("email").ok(),
            tax_no: r.try_get("tax_no").ok(),
            tax_office: r.try_get("tax_office").ok(),
            address: r.try_get("address").ok(),
            credit_limit_cents: r.try_get("credit_limit_cents").unwrap_or(0),
            notes: r.try_get("notes").ok(),
            created_at: r.try_get("created_at").unwrap_or_default(),
            balance_cents: r.try_get("balance_cents").unwrap_or(0),
        });
    }

    Ok(result)
}

/// Yeni bir cari rehber kartı oluşturur.
#[tauri::command]
pub async fn create_directory(
    payload: CreateDirectoryPayload,
    pool: tauri::State<'_, DbPool>,
) -> Result<DirectoryDto, String> {
    let tid = payload.tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    let id = generate_id("dir");
    let limit = payload.credit_limit_cents.unwrap_or(0);

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO directories (id, tenant_id, name, type, phone, email, tax_no, tax_office, address, credit_limit_cents, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
    )
    .bind(&id)
    .bind(&tid)
    .bind(&payload.name)
    .bind(&payload.directory_type)
    .bind(&payload.phone)
    .bind(&payload.email)
    .bind(&payload.tax_no)
    .bind(&payload.tax_office)
    .bind(&payload.address)
    .bind(limit)
    .bind(&payload.notes)
    .execute(&mut *conn)
    .await
    .map_err(|e| format!("Cari kart oluşturulamadı: {}", e))?;

    Ok(DirectoryDto {
        id,
        tenant_id: tid,
        name: payload.name,
        directory_type: payload.directory_type,
        phone: payload.phone,
        email: payload.email,
        tax_no: payload.tax_no,
        tax_office: payload.tax_office,
        address: payload.address,
        credit_limit_cents: limit,
        notes: payload.notes,
        created_at: chrono::Utc::now().to_rfc3339(),
        balance_cents: 0,
    })
}

/// Mevcut bir cari rehber kartını günceller.
#[tauri::command]
pub async fn update_directory(
    payload: UpdateDirectoryPayload,
    pool: tauri::State<'_, DbPool>,
) -> Result<DirectoryDto, String> {
    let tid = payload.tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let limit = payload.credit_limit_cents.unwrap_or(0);

    sqlx::query(
        "UPDATE directories
         SET name = ?, phone = ?, email = ?, tax_no = ?, tax_office = ?, address = ?, credit_limit_cents = ?, notes = ?
         WHERE id = ? AND tenant_id = ?"
    )
    .bind(&payload.name)
    .bind(&payload.phone)
    .bind(&payload.email)
    .bind(&payload.tax_no)
    .bind(&payload.tax_office)
    .bind(&payload.address)
    .bind(limit)
    .bind(&payload.notes)
    .bind(&payload.id)
    .bind(&tid)
    .execute(&mut *conn)
    .await
    .map_err(|e| format!("Cari kart güncellenemedi: {}", e))?;

    // Güncel kartı oku
    let r = sqlx::query(
        "SELECT d.id, d.tenant_id, d.name, d.type, d.phone, d.email, d.tax_no, d.tax_office,
                d.address, d.credit_limit_cents, d.notes, d.created_at,
                COALESCE((
                    SELECT SUM(
                        CASE WHEN deb.type = 'GIVEN' THEN deb.remaining_amount_cents
                             WHEN deb.type = 'TAKEN' THEN -deb.remaining_amount_cents
                             ELSE 0 END
                    ) FROM debts deb WHERE deb.directory_id = d.id AND deb.status != 'PAID'
                ), 0) as balance_cents
         FROM directories d
         WHERE d.id = ? AND d.tenant_id = ?"
    )
    .bind(&payload.id)
    .bind(&tid)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| format!("Güncellenen cari kart okunamadı: {}", e))?;

    Ok(DirectoryDto {
        id: r.try_get("id").unwrap_or_default(),
        tenant_id: r.try_get("tenant_id").unwrap_or_default(),
        name: r.try_get("name").unwrap_or_default(),
        directory_type: r.try_get("type").unwrap_or_default(),
        phone: r.try_get("phone").ok(),
        email: r.try_get("email").ok(),
        tax_no: r.try_get("tax_no").ok(),
        tax_office: r.try_get("tax_office").ok(),
        address: r.try_get("address").ok(),
        credit_limit_cents: r.try_get("credit_limit_cents").unwrap_or(0),
        notes: r.try_get("notes").ok(),
        created_at: r.try_get("created_at").unwrap_or_default(),
        balance_cents: r.try_get("balance_cents").unwrap_or(0),
    })
}

// ============================================================================
// BORÇ / ALACAK KOMUTLARI
// ============================================================================

/// Borç veya alacak kayıtlarını listeler.
#[tauri::command]
pub async fn get_debts(
    tenant_id: Option<String>,
    status: Option<String>,
    debt_type: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<DebtDto>, String> {
    let tid = tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let mut query_str = String::from(
        "SELECT deb.id, deb.tenant_id, deb.directory_id, d.name as directory_name,
                deb.type, deb.total_amount_cents, deb.remaining_amount_cents, deb.due_date,
                deb.status, deb.is_cash, deb.order_id, deb.description, deb.created_at
         FROM debts deb
         LEFT JOIN directories d ON deb.directory_id = d.id
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
        let is_cash_int: i64 = r.try_get("is_cash").unwrap_or(0);
        result.push(DebtDto {
            id: r.try_get("id").unwrap_or_default(),
            tenant_id: r.try_get("tenant_id").unwrap_or_default(),
            directory_id: r.try_get("directory_id").unwrap_or_default(),
            directory_name: r.try_get("directory_name").ok(),
            debt_type: r.try_get("type").unwrap_or_default(),
            total_amount_cents: r.try_get("total_amount_cents").unwrap_or(0),
            remaining_amount_cents: r.try_get("remaining_amount_cents").unwrap_or(0),
            due_date: r.try_get("due_date").ok(),
            status: r.try_get("status").unwrap_or_default(),
            is_cash: is_cash_int == 1,
            order_id: r.try_get("order_id").ok(),
            description: r.try_get("description").ok(),
            created_at: r.try_get("created_at").unwrap_or_default(),
        });
    }

    Ok(result)
}

/// Yeni borç veya alacak kaydı oluşturur.
#[tauri::command]
pub async fn create_debt(
    payload: CreateDebtPayload,
    pool: tauri::State<'_, DbPool>,
) -> Result<DebtDto, String> {
    if payload.total_amount_cents <= 0 {
        return Err("Borç/Alacak tutarı 0'dan büyük olmalıdır.".to_string());
    }

    let tid = payload.tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    let id = generate_id("dbt");
    let is_cash_val = if payload.is_cash.unwrap_or(false) { 1 } else { 0 };

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
    payload: PayDebtPayload,
    pool: tauri::State<'_, DbPool>,
) -> Result<DebtPaymentResultDto, String> {
    if payload.amount_cents <= 0 {
        return Err("Ödeme tutarı 0'dan büyük olmalıdır.".to_string());
    }

    let tid = payload.tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Borç kaydını sorgula
    let debt_row = sqlx::query(
        "SELECT deb.id, deb.tenant_id, deb.directory_id, deb.type, deb.remaining_amount_cents, d.name as directory_name
         FROM debts deb
         LEFT JOIN directories d ON deb.directory_id = d.id
         WHERE deb.id = ? AND deb.tenant_id = ?"
    )
    .bind(&payload.debt_id)
    .bind(&tid)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Borç kaydı bulunamadı.".to_string())?;

    let remaining: i64 = debt_row.try_get("remaining_amount_cents").unwrap_or(0);
    let debt_type: String = debt_row.try_get("type").unwrap_or_default();
    let dir_name: String = debt_row.try_get("directory_name").unwrap_or_else(|_| "Bilinmeyen Cari".to_string());

    if payload.amount_cents > remaining {
        return Err(format!(
            "Ödeme tutarı ({} kuruş) kalan borçtan ({} kuruş) büyük olamaz.",
            payload.amount_cents, remaining
        ));
    }

    let new_remaining = remaining - payload.amount_cents;
    let new_status = if new_remaining == 0 { "PAID" } else { "PARTIAL" };

    // Borç durumunu güncelle
    sqlx::query(
        "UPDATE debts SET remaining_amount_cents = ?, status = ? WHERE id = ? AND tenant_id = ?"
    )
    .bind(new_remaining)
    .bind(new_status)
    .bind(&payload.debt_id)
    .bind(&tid)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

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

// ============================================================================
// GENEL GİDER KOMUTLARI
// ============================================================================

/// İşletme gider kayıtlarını listeler.
#[tauri::command]
pub async fn get_expenses(
    tenant_id: Option<String>,
    category: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<ExpenseDto>, String> {
    let tid = tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let mut query_str = String::from(
        "SELECT e.id, e.tenant_id, e.category, e.amount_cents, e.payment_method,
                e.directory_id, d.name as directory_name, e.shift_id, e.actor_id,
                e.description, e.expense_date, e.created_at
         FROM general_expenses e
         LEFT JOIN directories d ON e.directory_id = d.id
         WHERE e.tenant_id = ?"
    );

    if category.is_some() {
        query_str.push_str(" AND e.category = ?");
    }
    if start_date.is_some() {
        query_str.push_str(" AND e.expense_date >= ?");
    }
    if end_date.is_some() {
        query_str.push_str(" AND e.expense_date <= ?");
    }
    query_str.push_str(" ORDER BY e.expense_date DESC");

    let mut query = sqlx::query(&query_str).bind(&tid);
    if let Some(ref cat) = category {
        query = query.bind(cat);
    }
    if let Some(ref sd) = start_date {
        query = query.bind(sd);
    }
    if let Some(ref ed) = end_date {
        query = query.bind(ed);
    }

    let rows = query.fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;

    let mut result = Vec::with_capacity(rows.len());
    for r in rows {
        result.push(ExpenseDto {
            id: r.try_get("id").unwrap_or_default(),
            tenant_id: r.try_get("tenant_id").unwrap_or_default(),
            category: r.try_get("category").unwrap_or_default(),
            amount_cents: r.try_get("amount_cents").unwrap_or(0),
            payment_method: r.try_get("payment_method").unwrap_or_default(),
            directory_id: r.try_get("directory_id").ok(),
            directory_name: r.try_get("directory_name").ok(),
            shift_id: r.try_get("shift_id").ok(),
            actor_id: r.try_get("actor_id").unwrap_or_default(),
            description: r.try_get("description").ok(),
            expense_date: r.try_get("expense_date").unwrap_or_default(),
            created_at: r.try_get("created_at").unwrap_or_default(),
        });
    }

    Ok(result)
}

/// Yeni bir işletme gider fişi oluşturur.
/// Eğer nakit (CASH) ise kasa çekmecesinden anında OUT kasa hareketi keser.
#[tauri::command]
pub async fn create_expense(
    payload: CreateExpensePayload,
    pool: tauri::State<'_, DbPool>,
) -> Result<ExpenseDto, String> {
    if payload.amount_cents <= 0 {
        return Err("Gider tutarı 0'dan büyük olmalıdır.".to_string());
    }

    let tid = payload.tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    let id = generate_id("exp");
    let exp_date = payload.expense_date.unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Aktif vardiya kontrolü
    let active_shift_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM shifts WHERE tenant_id = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1"
    )
    .bind(&tid)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Nakit ise kasa hareketine yaz
    if payload.payment_method == "CASH" {
        let cm_id = generate_id("csh");
        let shift_id_for_cm = active_shift_id.clone().unwrap_or_else(|| "NO_SHIFT".to_string());
        let reason = format!("İşletme Gideri ({}): {}", payload.category, payload.description.as_deref().unwrap_or("-"));

        sqlx::query(
            "INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at)
             VALUES (?, ?, ?, 'OUT', ?, ?, ?, datetime('now'))"
        )
        .bind(&cm_id)
        .bind(&tid)
        .bind(&shift_id_for_cm)
        .bind(payload.amount_cents)
        .bind(&reason)
        .bind(&payload.actor_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Kasa çıkış hareketi işlenemedi: {}", e))?;
    }

    // Gider tablosuna yaz
    sqlx::query(
        "INSERT INTO general_expenses (id, tenant_id, category, amount_cents, payment_method, directory_id, shift_id, actor_id, description, expense_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
    )
    .bind(&id)
    .bind(&tid)
    .bind(&payload.category)
    .bind(payload.amount_cents)
    .bind(&payload.payment_method)
    .bind(&payload.directory_id)
    .bind(&active_shift_id)
    .bind(&payload.actor_id)
    .bind(&payload.description)
    .bind(&exp_date)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Gider kaydı oluşturulamadı: {}", e))?;

    // Cari adını sorgula
    let dir_name = if let Some(ref did) = payload.directory_id {
        sqlx::query_scalar("SELECT name FROM directories WHERE id = ?")
            .bind(did)
            .fetch_optional(&mut *tx)
            .await
            .unwrap_or(None)
    } else {
        None
    };

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(ExpenseDto {
        id,
        tenant_id: tid,
        category: payload.category,
        amount_cents: payload.amount_cents,
        payment_method: payload.payment_method,
        directory_id: payload.directory_id,
        directory_name: dir_name,
        shift_id: active_shift_id,
        actor_id: payload.actor_id,
        description: payload.description,
        expense_date: exp_date,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

// ============================================================================
// FİNANSAL RAPOR (P&L VE NET BİLANÇO)
// ============================================================================

/// İşletmenin net kâr/zarar, gelir, gider ve borç/alacak bilançosunu hesaplar.
#[tauri::command]
pub async fn get_financial_report(
    tenant_id: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<FinancialReportDto, String> {
    let tid = tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    // 1. Satış Gelirleri (PAID Siparişler)
    let revenue_query = if start_date.is_some() && end_date.is_some() {
        sqlx::query_scalar(
            "SELECT COALESCE(SUM(total_cents), 0) FROM orders
             WHERE tenant_id = ? AND status = 'PAID' AND created_at >= ? AND created_at <= ?"
        )
        .bind(&tid)
        .bind(start_date.as_ref().unwrap())
        .bind(end_date.as_ref().unwrap())
    } else {
        sqlx::query_scalar(
            "SELECT COALESCE(SUM(total_cents), 0) FROM orders
             WHERE tenant_id = ? AND status = 'PAID'"
        )
        .bind(&tid)
    };
    let total_sales_revenue: i64 = revenue_query.fetch_one(&mut *conn).await.unwrap_or(0);

    // 2. Tahsil Edilen Alacaklar
    let debt_coll_query = if start_date.is_some() && end_date.is_some() {
        sqlx::query_scalar(
            "SELECT COALESCE(SUM(dp.amount_cents), 0) FROM debt_payments dp
             JOIN debts d ON dp.debt_id = d.id
             WHERE dp.tenant_id = ? AND d.type = 'GIVEN' AND dp.created_at >= ? AND dp.created_at <= ?"
        )
        .bind(&tid)
        .bind(start_date.as_ref().unwrap())
        .bind(end_date.as_ref().unwrap())
    } else {
        sqlx::query_scalar(
            "SELECT COALESCE(SUM(dp.amount_cents), 0) FROM debt_payments dp
             JOIN debts d ON dp.debt_id = d.id
             WHERE dp.tenant_id = ? AND d.type = 'GIVEN'"
        )
        .bind(&tid)
    };
    let total_debt_collected: i64 = debt_coll_query.fetch_one(&mut *conn).await.unwrap_or(0);

    let total_revenue_cents = total_sales_revenue + total_debt_collected;

    // 3. Genel Giderler
    let expense_query = if start_date.is_some() && end_date.is_some() {
        sqlx::query_scalar(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM general_expenses
             WHERE tenant_id = ? AND expense_date >= ? AND expense_date <= ?"
        )
        .bind(&tid)
        .bind(start_date.as_ref().unwrap())
        .bind(end_date.as_ref().unwrap())
    } else {
        sqlx::query_scalar(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM general_expenses
             WHERE tenant_id = ?"
        )
        .bind(&tid)
    };
    let total_expenses_cents: i64 = expense_query.fetch_one(&mut *conn).await.unwrap_or(0);

    let net_profit_cents = total_revenue_cents - total_expenses_cents;

    // 4. Açık Alacaklar ve Borçlar
    let receivables_cents: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(remaining_amount_cents), 0) FROM debts
         WHERE tenant_id = ? AND type = 'GIVEN' AND status != 'PAID'"
    )
    .bind(&tid)
    .fetch_one(&mut *conn)
    .await
    .unwrap_or(0);

    let payables_cents: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(remaining_amount_cents), 0) FROM debts
         WHERE tenant_id = ? AND type = 'TAKEN' AND status != 'PAID'"
    )
    .bind(&tid)
    .fetch_one(&mut *conn)
    .await
    .unwrap_or(0);

    // 5. Gider Kategorileri Kırılımı
    let cat_rows = sqlx::query(
        "SELECT category, SUM(amount_cents) as total_cents, COUNT(*) as count
         FROM general_expenses
         WHERE tenant_id = ?
         GROUP BY category
         ORDER BY total_cents DESC"
    )
    .bind(&tid)
    .fetch_all(&mut *conn)
    .await
    .unwrap_or_default();

    let mut expenses_by_category = Vec::with_capacity(cat_rows.len());
    for r in cat_rows {
        expenses_by_category.push(ExpenseCategorySummaryDto {
            category: r.try_get("category").unwrap_or_default(),
            total_cents: r.try_get("total_cents").unwrap_or(0),
            count: r.try_get("count").unwrap_or(0),
        });
    }

    // 6. Son 6 Aylık Trend
    let trend_rows = sqlx::query(
        "SELECT strftime('%Y-%m', created_at) as month,
                SUM(total_cents) as revenue_cents
         FROM orders
         WHERE tenant_id = ? AND status = 'PAID'
         GROUP BY month
         ORDER BY month DESC
         LIMIT 6"
    )
    .bind(&tid)
    .fetch_all(&mut *conn)
    .await
    .unwrap_or_default();

    let mut monthly_trend = Vec::new();
    for r in trend_rows {
        let m: String = r.try_get("month").unwrap_or_default();
        let rev: i64 = r.try_get("revenue_cents").unwrap_or(0);

        // O aya ait gider toplamı
        let exp: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM general_expenses
             WHERE tenant_id = ? AND strftime('%Y-%m', expense_date) = ?"
        )
        .bind(&tid)
        .bind(&m)
        .fetch_one(&mut *conn)
        .await
        .unwrap_or(0);

        monthly_trend.push(MonthlyFinancialTrendDto {
            month: m,
            revenue_cents: rev,
            expense_cents: exp,
            profit_cents: rev - exp,
        });
    }

    Ok(FinancialReportDto {
        total_revenue_cents,
        total_expenses_cents,
        net_profit_cents,
        receivables_cents,
        payables_cents,
        expenses_by_category,
        monthly_trend,
    })
}
