//! Cari kart ve borç açma işlemleri ile ortak uygulama girişi.

use super::payment::{apply_payment, RecordPaymentInput};
use super::supplier_document::{apply_document, ApproveDocumentInput};
use super::ApplyError;
use crate::services::audit_service::{self, AuditContext, AuditLock, AuditService};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqliteConnection;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardFields {
    pub directory_id: String,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub tax_no: Option<String>,
    pub tax_office: Option<String>,
    pub address: Option<String>,
    pub credit_limit_cents: Option<i64>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDebtInput {
    pub debt_id: String,
    pub directory_id: String,
    pub debt_type: String,
    pub amount_cents: i64,
    pub due_date: Option<String>,
    pub is_cash: bool,
    pub order_id: Option<String>,
    pub description: Option<String>,
    pub created_at: String,
}

/// Cihazlar arasında taşınabilen kanonik cari işlem.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CariOp {
    CreateCard {
        directory_type: String,
        #[serde(flatten)]
        card: CardFields,
        created_at: String,
    },
    UpdateCard {
        #[serde(flatten)]
        card: CardFields,
    },
    DeleteCard {
        directory_id: String,
    },
    OpenDebt(OpenDebtInput),
    RecordPayment(RecordPaymentInput),
    ApproveDocument(ApproveDocumentInput),
}

impl CariOp {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::CreateCard { .. } => "CREATE_CARD",
            Self::UpdateCard { .. } => "UPDATE_CARD",
            Self::DeleteCard { .. } => "DELETE_CARD",
            Self::OpenDebt(_) => "OPEN_DEBT",
            Self::RecordPayment(_) => "RECORD_PAYMENT",
            Self::ApproveDocument(_) => "APPROVE_DOCUMENT",
        }
    }

    pub fn target_id(&self) -> &str {
        match self {
            Self::CreateCard { card, .. } | Self::UpdateCard { card } => &card.directory_id,
            Self::DeleteCard { directory_id } => directory_id,
            Self::OpenDebt(input) => &input.directory_id,
            Self::RecordPayment(input) => &input.debt_id,
            Self::ApproveDocument(input) => &input.purchase_order_id,
        }
    }
}

fn rejected(message: impl Into<String>) -> ApplyError {
    ApplyError::Rejected(message.into())
}

pub(super) fn validate_iso_date(value: Option<&str>) -> Result<(), ApplyError> {
    match value {
        Some(date) if chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() => Err(
            rejected("VALIDATION: vade tarihi YYYY-AA-GG biçiminde olmalıdır"),
        ),
        _ => Ok(()),
    }
}

fn validate_card(card: &CardFields) -> Result<(), ApplyError> {
    let length = card.name.trim().chars().count();
    if length == 0 || length > 120 {
        return Err(rejected("VALIDATION: cari adı 1-120 karakter olmalıdır"));
    }
    if card.credit_limit_cents.is_some_and(|limit| limit < 0) {
        return Err(rejected("VALIDATION: cari limiti negatif olamaz"));
    }
    Ok(())
}

async fn create_card(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    directory_type: &str,
    card: &CardFields,
    created_at: &str,
) -> Result<Value, ApplyError> {
    validate_card(card)?;
    let limit = card.credit_limit_cents.unwrap_or(0);
    sqlx::query(
        "INSERT INTO directories (id, tenant_id, name, type, phone, email, tax_no, tax_office,
                                  address, credit_limit_cents, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&card.directory_id)
    .bind(tenant_id)
    .bind(card.name.trim())
    .bind(directory_type)
    .bind(&card.phone)
    .bind(&card.email)
    .bind(&card.tax_no)
    .bind(&card.tax_office)
    .bind(&card.address)
    .bind(limit)
    .bind(&card.notes)
    .bind(created_at)
    .execute(&mut *conn)
    .await
    .map_err(|e| match e.as_database_error() {
        Some(db) if db.is_check_violation() => rejected("VALIDATION: geçersiz cari türü"),
        _ => ApplyError::Internal(format!("Cari kart oluşturulamadı: {e}")),
    })?;
    Ok(json!({
        "directoryId": card.directory_id,
        "name": card.name.trim(),
        "type": directory_type,
        "creditLimitCents": limit,
    }))
}

/// Yalnız hareket görmemiş kart silinir: borç geçmişi olan kart defterin parçasıdır.
async fn delete_card(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    directory_id: &str,
) -> Result<Value, ApplyError> {
    let debts: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM debts WHERE tenant_id = ? AND directory_id = ?")
            .bind(tenant_id)
            .bind(directory_id)
            .fetch_one(&mut *conn)
            .await?;
    if debts > 0 {
        return Err(rejected("CONFLICT: hareket gören cari kart silinemez."));
    }
    let deleted = sqlx::query("DELETE FROM directories WHERE id = ? AND tenant_id = ?")
        .bind(directory_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await;
    match deleted {
        Ok(result) if result.rows_affected() == 0 => {
            Err(rejected("NOT_FOUND: cari kart bulunamadı"))
        }
        Ok(_) => Ok(json!({ "directoryId": directory_id })),
        Err(error) if error.to_string().contains("FOREIGN KEY") => {
            Err(rejected("CONFLICT: hareket gören cari kart silinemez."))
        }
        Err(error) => Err(error.into()),
    }
}

async fn update_card(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    card: &CardFields,
) -> Result<Value, ApplyError> {
    validate_card(card)?;
    // Limit gönderilmediyse korunur; boş alanın limiti sıfırlaması veresiye
    // denetimini sessizce değiştirirdi.
    let updated = sqlx::query(
        "UPDATE directories
         SET name = ?, phone = ?, email = ?, tax_no = ?, tax_office = ?, address = ?,
             credit_limit_cents = COALESCE(?, credit_limit_cents), notes = ?
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(card.name.trim())
    .bind(&card.phone)
    .bind(&card.email)
    .bind(&card.tax_no)
    .bind(&card.tax_office)
    .bind(&card.address)
    .bind(card.credit_limit_cents)
    .bind(&card.notes)
    .bind(&card.directory_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(rejected("NOT_FOUND: cari kart bulunamadı"));
    }
    Ok(json!({ "directoryId": card.directory_id, "name": card.name.trim() }))
}

async fn open_debt(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    input: &OpenDebtInput,
) -> Result<Value, ApplyError> {
    if input.amount_cents <= 0 {
        return Err(rejected("VALIDATION: tutar 0'dan büyük olmalıdır"));
    }
    if input.debt_type != "GIVEN" && input.debt_type != "TAKEN" {
        return Err(rejected("VALIDATION: borç tipi GIVEN veya TAKEN olmalıdır"));
    }
    validate_iso_date(input.due_date.as_deref())?;
    let known: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM directories WHERE id = ? AND tenant_id = ?")
            .bind(&input.directory_id)
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await?;
    if known.is_none() {
        return Err(rejected("NOT_FOUND: cari kart bulunamadı"));
    }
    sqlx::query(
        "INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents,
                            remaining_amount_cents, due_date, status, is_cash, order_id,
                            description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)",
    )
    .bind(&input.debt_id)
    .bind(tenant_id)
    .bind(&input.directory_id)
    .bind(&input.debt_type)
    .bind(input.amount_cents)
    .bind(input.amount_cents)
    .bind(&input.due_date)
    .bind(i64::from(input.is_cash))
    .bind(&input.order_id)
    .bind(&input.description)
    .bind(&input.created_at)
    .execute(&mut *conn)
    .await?;
    Ok(json!({
        "debtId": input.debt_id,
        "directoryId": input.directory_id,
        "type": input.debt_type,
        "totalAmountCents": input.amount_cents,
        "dueDate": input.due_date,
    }))
}

/// İşlemi çağıranın transaction'ında uygular ve denetim kaydını yazar.
pub async fn apply(
    conn: &mut SqliteConnection,
    audit_lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    now_iso: &str,
    op: &CariOp,
) -> Result<Value, ApplyError> {
    let (action, result) = match op {
        CariOp::CreateCard {
            directory_type,
            card,
            created_at,
        } => (
            "directory:created",
            create_card(conn, tenant_id, directory_type, card, created_at).await?,
        ),
        CariOp::UpdateCard { card } => (
            "directory:updated",
            update_card(conn, tenant_id, card).await?,
        ),
        CariOp::DeleteCard { directory_id } => (
            "directory:deleted",
            delete_card(conn, tenant_id, directory_id).await?,
        ),
        CariOp::OpenDebt(input) => ("debt:created", open_debt(conn, tenant_id, input).await?),
        CariOp::RecordPayment(input) => ("debt:paid", apply_payment(conn, tenant_id, input).await?),
        CariOp::ApproveDocument(input) => (
            "supplier_document:approved",
            apply_document(conn, tenant_id, input).await?,
        ),
    };
    let ctx = AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        audit_service::category::FINANS,
        action,
        op.target_id().to_string(),
        result.clone(),
        now_iso.to_string(),
    )
    .map_err(ApplyError::Internal)?;
    AuditService::append(conn, audit_lock, &ctx)
        .await
        .map_err(ApplyError::Internal)?;
    Ok(result)
}
