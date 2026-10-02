//! Şube veri katmanı.
//!
//! Neden ayrı servis: komut katmanı RBAC ve denetim kaydıyla ilgilenir; SQL
//! kuralları (tenant izolasyonu, aynı isimli aktif şube yasağı, son aktif şubeyi
//! koruma) burada tek yerde durur ve bellek içi SQLite ile doğrudan test edilir.
//!
//! Tüm sorgular `tenant_id` ile daraltılır: bir işletmenin şubesi başka bir
//! işletmenin komutuyla okunamaz, güncellenemez ve arşivlenemez.

use sqlx::Row;

pub const ARCHIVED_STATUS: &str = "ARCHIVED";
pub const ACTIVE_STATUS: &str = "ACTIVE";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Branch {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub address: Option<String>,
    pub status: String,
    pub created_at: String,
}

impl Branch {
    /// Tauri'ye giden DTO'ya çevirir (alan adları aynıdır).
    pub fn to_dto(&self) -> crate::branch_commands::BranchDto {
        crate::branch_commands::BranchDto {
            id: self.id.clone(),
            tenant_id: self.tenant_id.clone(),
            name: self.name.clone(),
            address: self.address.clone(),
            status: self.status.clone(),
            created_at: self.created_at.clone(),
        }
    }
}

const SELECT_COLUMNS: &str =
    "SELECT id, tenant_id, name, address, status, created_at FROM branches";

fn row_to_branch(row: &sqlx::sqlite::SqliteRow) -> Branch {
    Branch {
        id: row.try_get("id").unwrap_or_default(),
        tenant_id: row.try_get("tenant_id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        address: row.try_get("address").ok(),
        status: row.try_get("status").unwrap_or_default(),
        created_at: row.try_get("created_at").unwrap_or_default(),
    }
}

pub async fn list(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    include_archived: bool,
) -> Result<Vec<Branch>, String> {
    let sql = if include_archived {
        format!("{} WHERE tenant_id = ? ORDER BY created_at ASC, name ASC", SELECT_COLUMNS)
    } else {
        format!(
            "{} WHERE tenant_id = ? AND status != '{}' ORDER BY created_at ASC, name ASC",
            SELECT_COLUMNS, ARCHIVED_STATUS
        )
    };
    let rows = sqlx::query(&sql)
        .bind(tenant_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(row_to_branch).collect())
}

pub async fn load(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Branch, String> {
    let sql = format!("{} WHERE tenant_id = ? AND id = ?", SELECT_COLUMNS);
    let row = sqlx::query(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "NOT_FOUND: şube bulunamadı".to_string())?;
    Ok(row_to_branch(&row))
}

/// Aktif şube sayısı: arşivleme kuralı bunun üzerine kurulur.
pub async fn active_count(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
) -> Result<i64, String> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM branches WHERE tenant_id = ? AND status != 'ARCHIVED'",
    )
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(count)
}

pub async fn create(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    branch_id: &str,
    name: &str,
    address: Option<&str>,
) -> Result<Branch, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("INVALID_ARGUMENT: name is required".to_string());
    }

    // Aynı tenant içinde aynı isimli **aktif** şube açılamaz: geçiş listesi
    // kullanıcıya iki "Kadıköy" gösterirdi.
    let duplicate: Option<String> = sqlx::query_scalar(
        "SELECT id FROM branches WHERE tenant_id = ? AND name = ? AND status != 'ARCHIVED' LIMIT 1",
    )
    .bind(tenant_id)
    .bind(trimmed)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if duplicate.is_some() {
        return Err("CONFLICT: aynı isimli aktif şube zaten var".to_string());
    }

    sqlx::query(
        "INSERT INTO branches (id, tenant_id, name, address, status) \
         VALUES (?, ?, ?, ?, 'ACTIVE')",
    )
    .bind(branch_id)
    .bind(tenant_id)
    .bind(trimmed)
    .bind(address.map(str::trim).filter(|v| !v.is_empty()))
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    load(conn, tenant_id, branch_id).await
}

pub async fn update(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    branch_id: &str,
    name: Option<&str>,
    address: Option<&str>,
) -> Result<Branch, String> {
    let existing = load(conn, tenant_id, branch_id).await?;

    let next_name = match name.map(str::trim).filter(|v| !v.is_empty()) {
        Some(value) => value.to_string(),
        None => existing.name.clone(),
    };
    let next_address = match address {
        Some(value) => Some(value.trim().to_string()).filter(|v| !v.is_empty()),
        None => existing.address.clone(),
    };

    // Ad değiştiyse aynı isimli başka aktif şube çakışması yeniden denetlenir.
    if next_name != existing.name {
        let duplicate: Option<String> = sqlx::query_scalar(
            "SELECT id FROM branches \
             WHERE tenant_id = ? AND name = ? AND status != 'ARCHIVED' AND id != ? LIMIT 1",
        )
        .bind(tenant_id)
        .bind(&next_name)
        .bind(branch_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        if duplicate.is_some() {
            return Err("CONFLICT: aynı isimli aktif şube zaten var".to_string());
        }
    }

    sqlx::query("UPDATE branches SET name = ?, address = ? WHERE tenant_id = ? AND id = ?")
        .bind(&next_name)
        .bind(&next_address)
        .bind(tenant_id)
        .bind(branch_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    load(conn, tenant_id, branch_id).await
}

/// Şubeyi arşivler (fiziksel silme yoktur).
///
/// Son aktif şube arşivlenemez: kasa ve vardiya akışları bir şubeye bağlıdır,
/// sıfır şubeli işletme cihazı kilitler.
pub async fn archive(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Branch, String> {
    let existing = load(conn, tenant_id, branch_id).await?;
    if existing.status == ARCHIVED_STATUS {
        return Err("CONFLICT: şube zaten arşivlenmiş".to_string());
    }
    if active_count(conn, tenant_id).await? <= 1 {
        return Err("CONFLICT: son aktif şube arşivlenemez".to_string());
    }

    sqlx::query("UPDATE branches SET status = ? WHERE tenant_id = ? AND id = ?")
        .bind(ARCHIVED_STATUS)
        .bind(tenant_id)
        .bind(branch_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    load(conn, tenant_id, branch_id).await
}

#[cfg(test)]
#[path = "branch_service_tests.rs"]
mod tests;