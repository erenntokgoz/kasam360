//! Cari rehber komutları (firma/müşteri kartları)
//!
//! Bu dosya ledger_commands.rs 500 satır tavanını aştığı için bölündü.
//!
//! Güvenlik kapıları: rol kapısı, fail-closed kiracı çözümü,
//! `debts` alt sorgusunda kiracı filtresi, para okumalarında hata yükseltme,
//! her yazma işleminde `audit_ledger` kaydı.

use crate::db::DbPool;
use crate::id_generator::generate_id;
use crate::ledger_commands::guard::{
    require_directory_create, require_ledger_read, require_ledger_tenant, require_ledger_write,
};
use crate::ledger_commands::operations::submit;
use crate::services::cari::search::{is_similar_name, matches_card};
use crate::services::cari::{CardFields, CariOp};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Row, SqliteConnection};

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
    /// Yeniden denemede aynı kalan istemci işlem anahtarı.
    #[serde(rename = "operationId")]
    pub operation_id: String,
    /// Benzer kartlar görüldükten sonra bilinçli olarak yeni kart açılır.
    #[serde(rename = "allowSimilar", default)]
    pub allow_similar: bool,
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
    #[serde(rename = "operationId")]
    pub operation_id: String,
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

/// Bakiye alt sorgusu — her iki çağrıda da `debts` satırı karta ait kiracının
/// olmalıdır.
///
/// Neden: `deb.directory_id = d.id` tek başına yetmez. Aynı `directory_id`
/// başka bir kiracının `debts` tablosunda geçiyorsa (kimlik çakışması, hatalı
/// import) alt sorgu o borcu da toplar; yani başka işletmenin borcu bu
/// işletmenin cari kartında görünür. `deb.tenant_id = d.tenant_id` olmadan
/// bakiye kiracılar arası sızar.
const BALANCE_SUBQUERY: &str = "COALESCE((
                     SELECT SUM(
                         CASE WHEN deb.type = 'GIVEN' THEN deb.remaining_amount_cents
                              WHEN deb.type = 'TAKEN' THEN -deb.remaining_amount_cents
                              ELSE 0 END
                     ) FROM debts deb
                     WHERE deb.directory_id = d.id
                       AND deb.tenant_id = d.tenant_id
                       AND deb.status != 'PAID'
                 ), 0)";

/// `get_directories` çıktısındaki tek satırı DTO'ya çevirir.
///
/// Neden ayrı fonksiyon: liste ve "güncellenen kartı geri oku" yolu aynı kolon
/// setini okuyor. Para alanlarında (`credit_limit_cents`, `balance_cents`)
/// hata `?` ile yükseltilir; AGENTS.md §3.4 gereği `unwrap_or(0)` yasak.
fn row_to_directory(r: &sqlx::sqlite::SqliteRow) -> Result<DirectoryDto, String> {
    Ok(DirectoryDto {
        id: r.try_get("id").map_err(|e| e.to_string())?,
        tenant_id: r.try_get("tenant_id").map_err(|e| e.to_string())?,
        name: r.try_get("name").map_err(|e| e.to_string())?,
        directory_type: r.try_get("type").map_err(|e| e.to_string())?,
        phone: r.try_get("phone").map_err(|e| e.to_string())?,
        email: r.try_get("email").map_err(|e| e.to_string())?,
        tax_no: r.try_get("tax_no").map_err(|e| e.to_string())?,
        tax_office: r.try_get("tax_office").map_err(|e| e.to_string())?,
        address: r.try_get("address").map_err(|e| e.to_string())?,
        credit_limit_cents: r
            .try_get::<i64, _>("credit_limit_cents")
            .map_err(|e| e.to_string())?,
        notes: r.try_get("notes").map_err(|e| e.to_string())?,
        created_at: r.try_get("created_at").map_err(|e| e.to_string())?,
        balance_cents: r.try_get("balance_cents").map_err(|e| e.to_string())?,
    })
}

const CARD_COLUMNS: &str =
    "d.id, d.tenant_id, d.name, d.type, d.phone, d.email, d.tax_no, d.tax_office,
     d.address, d.credit_limit_cents, d.notes, d.created_at";

async fn load_cards(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    directory_type: Option<&str>,
) -> Result<Vec<DirectoryDto>, String> {
    let sql = format!(
        "SELECT {CARD_COLUMNS}, {BALANCE_SUBQUERY} as balance_cents
         FROM directories d
         WHERE d.tenant_id = ?{}
         ORDER BY d.name ASC, d.id ASC",
        if directory_type.is_some() {
            " AND d.type = ?"
        } else {
            ""
        }
    );
    let mut query = sqlx::query(&sql).bind(tenant_id);
    if let Some(dtype) = directory_type {
        query = query.bind(dtype);
    }
    let rows = query
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    rows.iter().map(row_to_directory).collect()
}

/// Aynı türde benzer adlı ya da aynı telefonlu kartlar.
pub(crate) async fn similar_cards(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    directory_type: &str,
    name: &str,
    phone: Option<&str>,
) -> Result<Vec<DirectoryDto>, String> {
    let digits = |text: &str| -> String { text.chars().filter(char::is_ascii_digit).collect() };
    let wanted_phone = phone.map(digits).filter(|value| value.len() >= 7);
    let mut cards = load_cards(conn, tenant_id, Some(directory_type)).await?;
    cards.retain(|card| {
        is_similar_name(name, &card.name)
            || (wanted_phone.is_some() && card.phone.as_deref().map(digits) == wanted_phone)
    });
    Ok(cards)
}

/// İşletmeye ait cari kartları ve bakiye durumlarını listeler.
///
/// Arama Türkçe karakter ve harf büyüklüğünden bağımsızdır.
#[tauri::command]
pub async fn get_directories(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    directory_type: Option<String>,
    search: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<DirectoryDto>, String> {
    require_ledger_read(actor_role.as_deref())?;

    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let mut cards = load_cards(&mut conn, &tid, directory_type.as_deref()).await?;
    if let Some(query) = search.as_deref() {
        cards.retain(|card| matches_card(query, &card.name, card.phone.as_deref()));
    }
    Ok(cards)
}

/// Yeni kart öncesi benzer kayıtları gösterir; hiçbir kaydı birleştirmez.
#[tauri::command]
pub async fn find_similar_directories(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    directory_type: String,
    name: String,
    phone: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<DirectoryDto>, String> {
    require_ledger_read(actor_role.as_deref())?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    similar_cards(&mut conn, &tid, &directory_type, &name, phone.as_deref()).await
}

async fn read_card(pool: &DbPool, tenant_id: &str, id: &str) -> Result<DirectoryDto, String> {
    let row = sqlx::query(&format!(
        "SELECT {CARD_COLUMNS}, {BALANCE_SUBQUERY} as balance_cents
         FROM directories d
         WHERE d.id = ? AND d.tenant_id = ?"
    ))
    .bind(id)
    .bind(tenant_id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Cari kart okunamadı: {e}"))?;
    row_to_directory(&row)
}

/// Yeni bir cari rehber kartı oluşturur.
#[tauri::command]
pub async fn create_directory(
    actor_role: Option<String>,
    actor_id: Option<String>,
    payload: CreateDirectoryPayload,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DirectoryDto, String> {
    require_directory_create(actor_role.as_deref(), &payload.directory_type)?;
    let tid = require_ledger_tenant(payload.tenant_id.as_deref())?;

    // Uyarı arayüzden atlanamaz; kart yine de yalnız bilinçli onayla açılır.
    if !payload.allow_similar {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        let similar = similar_cards(
            &mut conn,
            &tid,
            &payload.directory_type,
            &payload.name,
            payload.phone.as_deref(),
        )
        .await?;
        if !similar.is_empty() {
            return Err(format!(
                "SIMILAR_NAME: {} benzer kart var; kontrol edip onaylayın",
                similar.len()
            ));
        }
    }

    let intent = json!({
        "name": payload.name,
        "type": payload.directory_type,
        "phone": payload.phone,
        "email": payload.email,
        "taxNo": payload.tax_no,
        "taxOffice": payload.tax_office,
        "address": payload.address,
        "creditLimitCents": payload.credit_limit_cents,
        "notes": payload.notes,
    });
    let op = CariOp::CreateCard {
        directory_type: payload.directory_type,
        card: CardFields {
            directory_id: generate_id("dir"),
            name: payload.name,
            phone: payload.phone,
            email: payload.email,
            tax_no: payload.tax_no,
            tax_office: payload.tax_office,
            address: payload.address,
            credit_limit_cents: payload.credit_limit_cents,
            notes: payload.notes,
        },
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    let outcome = submit(
        &pool,
        &state,
        &tid,
        &payload.operation_id,
        actor_id,
        actor_role,
        intent,
        op,
    )
    .await?;
    let id = outcome["directoryId"]
        .as_str()
        .ok_or_else(|| "INTERNAL: cari sonucu eksik".to_string())?;
    read_card(&pool, &tid, id).await
}

/// Hareket görmemiş cari kartı siler.
#[tauri::command]
pub async fn delete_directory(
    id: String,
    operation_id: String,
    tenant_id: Option<String>,
    actor_role: Option<String>,
    actor_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    require_ledger_write(actor_role.as_deref())?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let intent = json!({ "id": id });
    submit(
        &pool,
        &state,
        &tid,
        &operation_id,
        actor_id,
        actor_role,
        intent,
        CariOp::DeleteCard { directory_id: id },
    )
    .await?;
    Ok(())
}

/// Mevcut bir cari rehber kartını günceller.
#[tauri::command]
pub async fn update_directory(
    actor_role: Option<String>,
    actor_id: Option<String>,
    payload: UpdateDirectoryPayload,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<DirectoryDto, String> {
    require_ledger_write(actor_role.as_deref())?;
    let tid = require_ledger_tenant(payload.tenant_id.as_deref())?;

    let intent = json!({
        "id": payload.id,
        "name": payload.name,
        "phone": payload.phone,
        "email": payload.email,
        "taxNo": payload.tax_no,
        "taxOffice": payload.tax_office,
        "address": payload.address,
        "creditLimitCents": payload.credit_limit_cents,
        "notes": payload.notes,
    });
    let id = payload.id.clone();
    let op = CariOp::UpdateCard {
        card: CardFields {
            directory_id: payload.id,
            name: payload.name,
            phone: payload.phone,
            email: payload.email,
            tax_no: payload.tax_no,
            tax_office: payload.tax_office,
            address: payload.address,
            credit_limit_cents: payload.credit_limit_cents,
            notes: payload.notes,
        },
    };
    submit(
        &pool,
        &state,
        &tid,
        &payload.operation_id,
        actor_id,
        actor_role,
        intent,
        op,
    )
    .await?;
    read_card(&pool, &tid, &id).await
}
