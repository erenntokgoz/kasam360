//! Sanal POS ödeme niyeti ve yanıt günlüğü.
//!
//! Neden sağlayıcı arayüzü: canlı sağlayıcı sonradan bağlanacak. Niyet, tekrar ve geç
//! yanıt kuralları sağlayıcıya göre değişmez; yalnız `PosProvider` değişir.
//! Buradaki tek sağlayıcı `TestProvider`'dır, ağa çıkmaz ve para çekmez.
//!
//! Güvenlik kuralları:
//! - Aynı `transaction_id` ikinci kez sağlayıcıya gitmez: yeniden deneme ikinci çekim olamaz.
//! - Aynı `event_id` ikinci kez uygulanmaz: sağlayıcı yanıtı tekrarlayabilir.
//! - Sonuçlanmış niyet farklı bir yanıtla değişmez: geç gelen ret onayı silemez.
//! - Günlük yalnız eklenir, kart bilgisi hiçbir zaman tutulmaz.

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use crate::id_generator::generate_id;

pub const TEST_PROVIDER: &str = "TEST";
const LOG_LIMIT: i64 = 200;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TestScenario {
    Approve,
    Decline,
    Cancel,
    /// Sağlayıcı onayı iki kez gönderir.
    DuplicateResponse,
    /// Önce onay, ardından geç gelen ret.
    LateDecline,
}

#[derive(Debug, Clone)]
pub struct ProviderEvent {
    pub event_id: String,
    pub status: &'static str,
    pub provider_ref: String,
    pub message: &'static str,
}

pub trait PosProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn charge(&self, transaction_id: &str) -> Vec<ProviderEvent>;
}

pub struct TestProvider {
    pub scenario: TestScenario,
}

impl PosProvider for TestProvider {
    fn name(&self) -> &'static str {
        TEST_PROVIDER
    }

    fn charge(&self, transaction_id: &str) -> Vec<ProviderEvent> {
        let provider_ref = format!("test_{transaction_id}");
        let event = |suffix: &str, status, message| ProviderEvent {
            event_id: format!("evt_{transaction_id}_{suffix}"),
            status,
            provider_ref: provider_ref.clone(),
            message,
        };
        let approved = event("1", "APPROVED", "Test onayı, para çekilmedi");
        match self.scenario {
            TestScenario::Approve => vec![approved],
            TestScenario::Decline => vec![event("1", "DECLINED", "Test reddi: kart reddedildi")],
            TestScenario::Cancel => vec![event("1", "CANCELLED", "Test iptali: müşteri vazgeçti")],
            TestScenario::DuplicateResponse => vec![approved.clone(), approved],
            TestScenario::LateDecline => {
                vec![approved, event("2", "DECLINED", "Test: geç gelen ret")]
            }
        }
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChargeResult {
    pub status: String,
    pub provider_ref: Option<String>,
    pub message: Option<String>,
    /// Önceki denemenin sonucu döndü, sağlayıcıya gidilmedi.
    pub replayed: bool,
}

pub struct ChargeRequest<'a> {
    pub transaction_id: &'a str,
    pub order_id: &'a str,
    pub amount_cents: i64,
    pub actor_id: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentLogRow {
    pub id: String,
    pub created_at: String,
    pub kind: String,
    pub status: String,
    pub message: Option<String>,
    pub transaction_id: String,
    pub order_id: String,
    pub amount_cents: i64,
    pub provider: String,
}

fn text_error(error: sqlx::Error) -> String {
    error.to_string()
}

pub async fn test_mode_enabled(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<bool, String> {
    let stored: Option<bool> =
        sqlx::query_scalar("SELECT test_mode FROM pos_gateway_settings WHERE tenant_id = ?")
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(text_error)?;
    Ok(stored.is_some_and(|enabled| enabled))
}

pub async fn set_test_mode(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    enabled: bool,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO pos_gateway_settings (tenant_id, test_mode) VALUES (?, ?)
         ON CONFLICT(tenant_id) DO UPDATE SET test_mode = excluded.test_mode",
    )
    .bind(tenant_id)
    .bind(enabled)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(())
}

async fn write_log(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    intent_id: &str,
    event_id: Option<&str>,
    kind: &str,
    status: &str,
    message: Option<&str>,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO pos_payment_log (id, tenant_id, intent_id, event_id, kind, status, message)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(generate_id("pyl"))
    .bind(tenant_id)
    .bind(intent_id)
    .bind(event_id)
    .bind(kind)
    .bind(status)
    .bind(message)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(())
}

/// Yanıtı niyete uygular. Tekrar ve çelişen yanıt günlüğe girer, durumu değiştirmez.
pub async fn apply_event(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    intent_id: &str,
    event: &ProviderEvent,
) -> Result<(), String> {
    let seen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pos_payment_log
          WHERE tenant_id = ? AND event_id = ? AND kind = 'RESPONSE'",
    )
    .bind(tenant_id)
    .bind(&event.event_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    if seen > 0 {
        return write_log(
            conn,
            tenant_id,
            intent_id,
            None,
            "DUPLICATE",
            event.status,
            Some("Tekrarlanan yanıt uygulanmadı"),
        )
        .await;
    }

    let applied = sqlx::query(
        "UPDATE pos_payment_intents
            SET status = ?, provider_ref = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND tenant_id = ? AND status = 'PENDING'",
    )
    .bind(event.status)
    .bind(&event.provider_ref)
    .bind(intent_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    let kind = if applied.rows_affected() == 1 {
        "RESPONSE"
    } else {
        "IGNORED"
    };
    let event_id = (kind == "RESPONSE").then_some(event.event_id.as_str());
    write_log(
        conn,
        tenant_id,
        intent_id,
        event_id,
        kind,
        event.status,
        Some(event.message),
    )
    .await
}

async fn load_result(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    intent_id: &str,
    replayed: bool,
) -> Result<ChargeResult, String> {
    let row = sqlx::query(
        "SELECT i.status, i.provider_ref,
                (SELECT l.message FROM pos_payment_log l
                  WHERE l.tenant_id = i.tenant_id AND l.intent_id = i.id AND l.kind = 'RESPONSE'
                  ORDER BY l.id DESC LIMIT 1) AS message
           FROM pos_payment_intents i WHERE i.id = ? AND i.tenant_id = ?",
    )
    .bind(intent_id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    Ok(ChargeResult {
        status: row.try_get("status").map_err(text_error)?,
        provider_ref: row.try_get("provider_ref").map_err(text_error)?,
        message: row.try_get("message").map_err(text_error)?,
        replayed,
    })
}

pub async fn charge(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    request: ChargeRequest<'_>,
    provider: &dyn PosProvider,
) -> Result<ChargeResult, String> {
    if request.amount_cents <= 0 {
        return Err("VALIDATION: çekim tutarı sıfırdan büyük olmalı".into());
    }
    crate::management_commands::ensure_owned(conn, "orders", request.order_id, tenant_id).await?;

    let existing = sqlx::query(
        "SELECT id, order_id, amount_cents FROM pos_payment_intents
          WHERE tenant_id = ? AND transaction_id = ?",
    )
    .bind(tenant_id)
    .bind(request.transaction_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?;
    if let Some(row) = existing {
        let order_id: String = row.try_get("order_id").map_err(text_error)?;
        let amount: i64 = row.try_get("amount_cents").map_err(text_error)?;
        if order_id != request.order_id || amount != request.amount_cents {
            return Err("IDEMPOTENCY_CONFLICT: işlem kimliği başka tutarla kullanılmış".into());
        }
        let intent_id: String = row.try_get("id").map_err(text_error)?;
        let result = load_result(conn, tenant_id, &intent_id, true).await?;
        write_log(
            conn,
            tenant_id,
            &intent_id,
            None,
            "REPLAY",
            &result.status,
            Some("Önceki sonuç döndü, yeni çekim yapılmadı"),
        )
        .await?;
        return Ok(result);
    }

    let intent_id = generate_id("pyi");
    sqlx::query(
        "INSERT INTO pos_payment_intents
             (id, tenant_id, transaction_id, order_id, provider, amount_cents, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&intent_id)
    .bind(tenant_id)
    .bind(request.transaction_id)
    .bind(request.order_id)
    .bind(provider.name())
    .bind(request.amount_cents)
    .bind(request.actor_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    write_log(
        conn, tenant_id, &intent_id, None, "REQUEST", "PENDING", None,
    )
    .await?;

    for event in provider.charge(request.transaction_id) {
        apply_event(conn, tenant_id, &intent_id, &event).await?;
    }
    load_result(conn, tenant_id, &intent_id, false).await
}

/// Onaylanmış ama satışa bağlanamamış çekimi iptal eder. Satış kaydı varsa para
/// iadesi iade akışından geçmelidir; burası kasayı atlayan bir kapı olamaz.
pub async fn void_charge(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    transaction_id: &str,
) -> Result<(), String> {
    let settled: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events
          WHERE tenant_id = ? AND aggregate_id = ? AND event_type = 'SALE_SETTLED'",
    )
    .bind(tenant_id)
    .bind(transaction_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(text_error)?;
    if settled > 0 {
        return Err("CONFLICT: tahsilat kaydedilmiş, iade akışını kullanın".into());
    }
    let intent_id: String = sqlx::query_scalar(
        "SELECT id FROM pos_payment_intents WHERE tenant_id = ? AND transaction_id = ?",
    )
    .bind(tenant_id)
    .bind(transaction_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(text_error)?
    .ok_or_else(|| "NOT_FOUND: çekim bulunamadı".to_string())?;
    let changed = sqlx::query(
        "UPDATE pos_payment_intents SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND tenant_id = ? AND status = 'APPROVED'",
    )
    .bind(&intent_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(text_error)?;
    if changed.rows_affected() == 1 {
        write_log(
            conn,
            tenant_id,
            &intent_id,
            None,
            "VOID",
            "CANCELLED",
            Some("Satışa bağlanamadı, çekim iptal edildi"),
        )
        .await?;
    }
    Ok(())
}

pub async fn list_log(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<PaymentLogRow>, String> {
    let rows = sqlx::query(
        "SELECT l.id, l.created_at, l.kind, l.status, l.message, i.transaction_id,
                i.order_id, i.amount_cents, i.provider
           FROM pos_payment_log l
           JOIN pos_payment_intents i ON i.id = l.intent_id AND i.tenant_id = l.tenant_id
          WHERE l.tenant_id = ?
          ORDER BY l.id DESC LIMIT ?",
    )
    .bind(tenant_id)
    .bind(LOG_LIMIT)
    .fetch_all(&mut *conn)
    .await
    .map_err(text_error)?;
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        result.push(PaymentLogRow {
            id: row.try_get("id").map_err(text_error)?,
            created_at: row.try_get("created_at").map_err(text_error)?,
            kind: row.try_get("kind").map_err(text_error)?,
            status: row.try_get("status").map_err(text_error)?,
            message: row.try_get("message").map_err(text_error)?,
            transaction_id: row.try_get("transaction_id").map_err(text_error)?,
            order_id: row.try_get("order_id").map_err(text_error)?,
            amount_cents: row.try_get("amount_cents").map_err(text_error)?,
            provider: row.try_get("provider").map_err(text_error)?,
        });
    }
    Ok(result)
}

#[cfg(test)]
#[path = "pos_gateway_tests.rs"]
mod tests;
