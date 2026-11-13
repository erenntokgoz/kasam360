//! Para hesapları (kasa, banka, POS), hesaplar arası transfer ve nakit akışı.
//!
//! Neden bakiye saklanmaz: bakiye açılış tutarı artı gelen eksi giden
//! transferlerdir; ayrı bir sütun transferle birlikte sapabilirdi. Vardiya
//! kasasının kart/nakit ayrımı `cash_movements` ve vardiya tablolarında kalır,
//! bu servis ona yazmaz; akış listesi onu yalnız okur.
//!
//! Her sorgu `tenant_id` ile daraltılır. Yazan işlevler çağıranın açtığı yazma
//! işlemi ve denetim kilidi içinde çalışır; denetim kaydı aynı işlemde yazılır.

use serde::Serialize;
use sqlx::{Row, SqliteConnection};

use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};

const KINDS: [&str; 3] = ["CASH", "BANK", "POS"];
/// Tek işlemde kabul edilen üst tutar (kuruş); taşma ve yazım hatasına karşı.
pub const MAX_AMOUNT_CENTS: i64 = 100_000_000_000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MoneyAccount {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub opening_cents: i64,
    pub balance_cents: i64,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountTransfer {
    pub id: String,
    pub from_account_id: String,
    pub to_account_id: String,
    pub amount_cents: i64,
    pub note: String,
    pub actor_id: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FlowEntry {
    pub id: String,
    /// `CASH_IN`, `CASH_OUT` veya `TRANSFER`.
    pub kind: String,
    pub amount_cents: i64,
    pub description: String,
    pub actor_name: Option<String>,
    pub created_at: String,
}

fn id_is_valid(id: &str, prefix: &str) -> bool {
    id.strip_prefix(&format!("{prefix}_"))
        .is_some_and(|rest| rest.len() == 24 && rest.bytes().all(|b| b.is_ascii_hexdigit()))
}

fn amount_gate(cents: i64, allow_zero: bool) -> Result<(), String> {
    if cents < 0 || (!allow_zero && cents == 0) || cents > MAX_AMOUNT_CENTS {
        return Err("VALIDATION: tutar geçersiz".to_string());
    }
    Ok(())
}

const ACCOUNT_SELECT: &str = "SELECT a.id, a.name, a.kind, a.opening_cents, a.is_active, \
        a.opening_cents \
          + COALESCE((SELECT SUM(amount_cents) FROM account_transfers \
                      WHERE tenant_id = a.tenant_id AND to_account_id = a.id), 0) \
          - COALESCE((SELECT SUM(amount_cents) FROM account_transfers \
                      WHERE tenant_id = a.tenant_id AND from_account_id = a.id), 0) AS balance \
     FROM money_accounts a WHERE a.tenant_id = ?";

fn read_account(row: &sqlx::sqlite::SqliteRow) -> Result<MoneyAccount, String> {
    Ok(MoneyAccount {
        id: row.try_get("id").map_err(|e| e.to_string())?,
        name: row.try_get("name").map_err(|e| e.to_string())?,
        kind: row.try_get("kind").map_err(|e| e.to_string())?,
        opening_cents: row.try_get("opening_cents").map_err(|e| e.to_string())?,
        balance_cents: row.try_get("balance").map_err(|e| e.to_string())?,
        is_active: row
            .try_get::<i64, _>("is_active")
            .map_err(|e| e.to_string())?
            != 0,
    })
}

pub async fn list_accounts(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<MoneyAccount>, String> {
    let rows = sqlx::query(&format!(
        "{ACCOUNT_SELECT} ORDER BY a.is_active DESC, lower(a.name)"
    ))
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    rows.iter().map(read_account).collect()
}

async fn find_account(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    account_id: &str,
) -> Result<Option<MoneyAccount>, String> {
    let row = sqlx::query(&format!("{ACCOUNT_SELECT} AND a.id = ?"))
        .bind(tenant_id)
        .bind(account_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    row.as_ref().map(read_account).transpose()
}

#[allow(clippy::too_many_arguments)]
async fn audit(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    action: &str,
    resource_id: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    let ctx = AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        category::FINANS,
        action,
        resource_id.to_string(),
        payload,
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(conn, lock, &ctx).await.map(|_| ())
}

#[allow(clippy::too_many_arguments)]
pub async fn create_account(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    name: &str,
    kind: &str,
    opening_cents: i64,
) -> Result<MoneyAccount, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err("VALIDATION: hesap adı 1-60 karakter olmalı".to_string());
    }
    if !KINDS.contains(&kind) {
        return Err("VALIDATION: hesap türü geçersiz".to_string());
    }
    amount_gate(opening_cents, true)?;
    let duplicate: Option<String> = sqlx::query_scalar(
        "SELECT id FROM money_accounts WHERE tenant_id = ? AND lower(name) = lower(?)",
    )
    .bind(tenant_id)
    .bind(name)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if duplicate.is_some() {
        return Err("CONFLICT: aynı adlı hesap zaten var".to_string());
    }
    let id = crate::id_generator::generate_id("acc");
    sqlx::query(
        "INSERT INTO money_accounts (id, tenant_id, name, kind, opening_cents, is_active) \
         VALUES (?, ?, ?, ?, ?, 1)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(name)
    .bind(kind)
    .bind(opening_cents)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    audit(
        conn,
        lock,
        tenant_id,
        actor_id,
        actor_role,
        "account:created",
        &id,
        serde_json::json!({ "name": name, "kind": kind, "openingCents": opening_cents }),
    )
    .await?;
    find_account(conn, tenant_id, &id)
        .await?
        .ok_or_else(|| "hesap yazıldıktan sonra okunamadı".to_string())
}

/// Hesap silinmez, pasife alınır: geçmiş transferler hesaba bağlı kalır.
/// Bakiyesi olan hesap pasife alınamaz; para başka hesaba aktarılmadan
/// kaybolmuş görünürdü.
#[allow(clippy::too_many_arguments)]
pub async fn set_active(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    account_id: &str,
    active: bool,
) -> Result<MoneyAccount, String> {
    let account = find_account(conn, tenant_id, account_id)
        .await?
        .ok_or_else(|| "NOT_FOUND: hesap bulunamadı".to_string())?;
    if !active && account.balance_cents != 0 {
        return Err("INVALID_STATE: bakiyesi olan hesap pasife alınamaz".to_string());
    }
    sqlx::query("UPDATE money_accounts SET is_active = ? WHERE id = ? AND tenant_id = ?")
        .bind(i64::from(active))
        .bind(account_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    audit(
        conn,
        lock,
        tenant_id,
        actor_id,
        actor_role,
        if active {
            "account:activated"
        } else {
            "account:deactivated"
        },
        account_id,
        serde_json::json!({ "name": account.name }),
    )
    .await?;
    find_account(conn, tenant_id, account_id)
        .await?
        .ok_or_else(|| "hesap okunamadı".to_string())
}

async fn find_transfer(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    id: &str,
) -> Result<Option<AccountTransfer>, String> {
    let row = sqlx::query(
        "SELECT id, from_account_id, to_account_id, amount_cents, note, actor_id, created_at \
         FROM account_transfers WHERE tenant_id = ? AND id = ?",
    )
    .bind(tenant_id)
    .bind(id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    row.map(|r| {
        Ok(AccountTransfer {
            id: r.try_get("id").map_err(|e| e.to_string())?,
            from_account_id: r.try_get("from_account_id").map_err(|e| e.to_string())?,
            to_account_id: r.try_get("to_account_id").map_err(|e| e.to_string())?,
            amount_cents: r.try_get("amount_cents").map_err(|e| e.to_string())?,
            note: r.try_get("note").map_err(|e| e.to_string())?,
            actor_id: r.try_get("actor_id").map_err(|e| e.to_string())?,
            created_at: r.try_get("created_at").map_err(|e| e.to_string())?,
        })
    })
    .transpose()
}

/// Transfer: kaynak bakiyesi yetmezse reddedilir (eksi bakiye oluşmaz).
/// Aynı `transfer_id` aynı içerikle tekrar gelirse yeni kayıt açılmaz.
#[allow(clippy::too_many_arguments)]
pub async fn transfer(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    transfer_id: &str,
    from_id: &str,
    to_id: &str,
    amount_cents: i64,
    note: &str,
) -> Result<AccountTransfer, String> {
    if !id_is_valid(transfer_id, "xfr") {
        return Err("VALIDATION: transfer kimliği geçersiz".to_string());
    }
    amount_gate(amount_cents, false)?;
    if from_id == to_id {
        return Err("VALIDATION: kaynak ve hedef hesap aynı olamaz".to_string());
    }
    let note = note.trim();
    if note.chars().count() > 200 {
        return Err("VALIDATION: açıklama en fazla 200 karakter".to_string());
    }
    if let Some(existing) = find_transfer(conn, tenant_id, transfer_id).await? {
        let same = existing.from_account_id == from_id
            && existing.to_account_id == to_id
            && existing.amount_cents == amount_cents;
        return if same {
            Ok(existing)
        } else {
            Err("CONFLICT: bu transfer kimliği başka içerikle kullanılmış".to_string())
        };
    }
    let from = find_account(conn, tenant_id, from_id)
        .await?
        .ok_or_else(|| "NOT_FOUND: kaynak hesap bulunamadı".to_string())?;
    let to = find_account(conn, tenant_id, to_id)
        .await?
        .ok_or_else(|| "NOT_FOUND: hedef hesap bulunamadı".to_string())?;
    if !from.is_active || !to.is_active {
        return Err("INVALID_STATE: pasif hesaba veya hesaptan transfer yapılamaz".to_string());
    }
    if from.balance_cents < amount_cents {
        return Err("INSUFFICIENT_FUNDS: kaynak hesap bakiyesi yetersiz".to_string());
    }
    sqlx::query(
        "INSERT INTO account_transfers \
         (id, tenant_id, from_account_id, to_account_id, amount_cents, note, actor_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(transfer_id)
    .bind(tenant_id)
    .bind(from_id)
    .bind(to_id)
    .bind(amount_cents)
    .bind(note)
    .bind(actor_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    audit(
        conn,
        lock,
        tenant_id,
        actor_id,
        actor_role,
        "account:transfer",
        transfer_id,
        serde_json::json!({
            "fromAccountId": from_id,
            "toAccountId": to_id,
            "amountCents": amount_cents,
            "note": note,
        }),
    )
    .await?;
    find_transfer(conn, tenant_id, transfer_id)
        .await?
        .ok_or_else(|| "transfer yazıldıktan sonra okunamadı".to_string())
}

/// Nakit akışı: vardiya kasasındaki giriş/çıkışlar ile hesaplar arası
/// transferler tek listede, en yeni üstte. `cash_movements` gider, cari ve
/// iade ödemelerini de taşıdığı için akış onlarla tutarlıdır.
pub async fn flow(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    from: &str,
    to: &str,
    limit: i64,
) -> Result<Vec<FlowEntry>, String> {
    let rows = sqlx::query(
        "SELECT id, kind, amount_cents, description, actor_name, created_at FROM ( \
            SELECT m.id AS id, CASE m.movement_type WHEN 'IN' THEN 'CASH_IN' ELSE 'CASH_OUT' END AS kind, \
                   m.amount_cents AS amount_cents, m.reason AS description, \
                   u.name AS actor_name, m.created_at AS created_at \
            FROM cash_movements m LEFT JOIN users u ON u.id = m.actor_id AND u.tenant_id = m.tenant_id \
            WHERE m.tenant_id = ?1 \
          UNION ALL \
            SELECT x.id, 'TRANSFER', x.amount_cents, \
                   fa.name || ' -> ' || ta.name || CASE WHEN x.note = '' THEN '' ELSE ' · ' || x.note END, \
                   u.name, x.created_at \
            FROM account_transfers x \
            JOIN money_accounts fa ON fa.id = x.from_account_id AND fa.tenant_id = x.tenant_id \
            JOIN money_accounts ta ON ta.id = x.to_account_id AND ta.tenant_id = x.tenant_id \
            LEFT JOIN users u ON u.id = x.actor_id AND u.tenant_id = x.tenant_id \
            WHERE x.tenant_id = ?1 \
         ) WHERE datetime(created_at) >= datetime(?2) AND datetime(created_at) <= datetime(?3) \
         ORDER BY datetime(created_at) DESC, id DESC LIMIT ?4",
    )
    .bind(tenant_id)
    .bind(from)
    .bind(to)
    .bind(limit.clamp(1, 500))
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    rows.iter()
        .map(|r| {
            Ok(FlowEntry {
                id: r.try_get("id").map_err(|e| e.to_string())?,
                kind: r.try_get("kind").map_err(|e| e.to_string())?,
                amount_cents: r.try_get("amount_cents").map_err(|e| e.to_string())?,
                description: r.try_get("description").map_err(|e| e.to_string())?,
                actor_name: r.try_get("actor_name").map_err(|e| e.to_string())?,
                created_at: r.try_get("created_at").map_err(|e| e.to_string())?,
            })
        })
        .collect()
}

#[cfg(test)]
#[path = "money_accounts_tests.rs"]
mod tests;
