//! Yemek kartı markaları, kabul ayarı ve mutabakat.
//!
//! Neden ayrı kanal: tahsilat kart cihazında değil, yemek kartı firmasının kendi
//! cihazında yapılır ve para işletmeye firma ödemesiyle gelir. Yazılım yalnız
//! kaydeder; marka bilgisi, firma ödemesiyle karşılaştırma için tek dayanaktır.
//! Kasa nakit sayımı ve banka kartı toplamı bu tutarlardan etkilenmez.

use serde::Serialize;
use sqlx::{Row, SqliteConnection};

/// `(kod, görünen ad)`. Kodlar `meal_card_providers` tablosundaki CHECK ile aynıdır.
pub const PROVIDERS: [(&str, &str); 6] = [
    ("MULTINET", "Multinet"),
    ("PLUXEE", "Pluxee (Sodexo)"),
    ("EDENRED", "Edenred (Ticket)"),
    ("SETCARD", "Setcard"),
    ("METROPOL", "Metropol"),
    ("OTHER", "Diğer yemek kartı"),
];

/// Marka belirtilmeyen eski istemci ve eski kayıtların düştüğü grup.
pub const FALLBACK_PROVIDER: &str = "OTHER";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSetting {
    pub code: String,
    pub label: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationRow {
    pub provider: String,
    pub label: String,
    /// Satış toplamından iadeler düşülmüş net tutar.
    pub total_cents: i64,
    pub count: i64,
    /// Dönemde bu markaya yapılan iade toplamı (bilgi amaçlı; `total_cents` zaten net).
    pub refunded_cents: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Reconciliation {
    pub rows: Vec<ReconciliationRow>,
    pub total_cents: i64,
    pub count: i64,
    pub refunded_cents: i64,
}

pub fn is_meal_card_method(method: &str) -> bool {
    matches!(method.to_uppercase().as_str(), "MEAL_CARD" | "YEMEK_KARTI")
}

fn label_of(code: &str) -> &'static str {
    PROVIDERS
        .iter()
        .find(|(known, _)| *known == code)
        .map_or("Diğer yemek kartı", |(_, label)| label)
}

fn sql_error(error: sqlx::Error) -> String {
    error.to_string()
}

/// Kiracının marka ayarları; satırı olmayan marka açıktır.
pub async fn list_settings(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<ProviderSetting>, String> {
    let rows = sqlx::query("SELECT code, enabled FROM meal_card_providers WHERE tenant_id = ?")
        .bind(tenant_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(sql_error)?;
    let mut stored = Vec::with_capacity(rows.len());
    for row in rows {
        let code: String = row.try_get("code").map_err(sql_error)?;
        let enabled: i64 = row.try_get("enabled").map_err(sql_error)?;
        stored.push((code, enabled != 0));
    }
    Ok(PROVIDERS
        .iter()
        .map(|(code, label)| ProviderSetting {
            code: (*code).to_string(),
            label: (*label).to_string(),
            enabled: stored
                .iter()
                .find(|(known, _)| known == code)
                .is_none_or(|(_, enabled)| *enabled),
        })
        .collect())
}

pub async fn set_enabled(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    code: &str,
    enabled: bool,
) -> Result<Vec<ProviderSetting>, String> {
    let code = code.trim().to_uppercase();
    if !PROVIDERS.iter().any(|(known, _)| *known == code) {
        return Err("VALIDATION: yemek kartı markası geçersiz".to_string());
    }
    sqlx::query(
        "INSERT INTO meal_card_providers (tenant_id, code, enabled) VALUES (?, ?, ?)
         ON CONFLICT(tenant_id, code) DO UPDATE SET enabled = excluded.enabled",
    )
    .bind(tenant_id)
    .bind(&code)
    .bind(i64::from(enabled))
    .execute(&mut *conn)
    .await
    .map_err(sql_error)?;
    list_settings(conn, tenant_id).await
}

/// Tahsilat yöntemi yemek kartıysa markayı doğrular ve normalleştirir.
///
/// Neden reddedilir: kapalı veya bilinmeyen marka sessizce `OTHER` sayılırsa
/// işletmenin kabul etmediği kart kayda geçer ve mutabakat yanlış gruba yazılır.
/// Yemek kartı olmayan yöntemde marka yok sayılır.
pub async fn resolve_provider(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    method: &str,
    provider: Option<&str>,
) -> Result<Option<String>, String> {
    if !is_meal_card_method(method) {
        return Ok(None);
    }
    let code = provider
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map_or_else(|| FALLBACK_PROVIDER.to_string(), str::to_uppercase);
    let settings = list_settings(conn, tenant_id).await?;
    let setting = settings
        .iter()
        .find(|setting| setting.code == code)
        .ok_or_else(|| "VALIDATION: yemek kartı markası geçersiz".to_string())?;
    if !setting.enabled {
        return Err(format!(
            "PROVIDER_DISABLED: {} bu işletmede kabul edilmiyor.",
            setting.label
        ));
    }
    Ok(Some(code))
}

/// Mutabakat: dönem ve marka bazında toplam ve adet.
///
/// Anahtar adında `card` geçmez: defter yazımındaki KVKK maskesi `card` içeren
/// anahtarın değerini `***` yapar. Marka kırılımı defter kaydındaki `mealProviderBreakdown` dizisindendir. Dizisi
/// olmayan eski yemek kartı kayıtları `OTHER` grubuna toplanır; tutar kaybolmaz.
pub async fn reconciliation(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    from: &str,
    to: &str,
) -> Result<Reconciliation, String> {
    let rows = sqlx::query(
        "SELECT provider, SUM(amount) AS total, COUNT(*) AS cnt FROM (
            SELECT COALESCE(json_extract(l.payload, b.fullkey || '.provider'), 'OTHER') AS provider,
                   CAST(json_extract(l.payload, b.fullkey || '.amountCents') AS INTEGER) AS amount
            FROM audit_ledger l,
                 json_each(CASE WHEN json_valid(l.payload) THEN l.payload ELSE '{}' END,
                           '$.mealProviderBreakdown') b
            WHERE l.tenant_id = ?1 AND l.action = 'payment:settled_fifo'
              AND datetime(l.timestamp) >= datetime(?2) AND datetime(l.timestamp) <= datetime(?3)
            UNION ALL
            SELECT 'OTHER' AS provider,
                   CAST(json_extract(l.payload, '$.mealCardAmountCents') AS INTEGER) AS amount
            FROM audit_ledger l
            WHERE l.tenant_id = ?1 AND l.action = 'payment:settled_fifo'
              AND json_valid(l.payload)
              AND json_extract(l.payload, '$.mealProviderBreakdown') IS NULL
              AND COALESCE(CAST(json_extract(l.payload, '$.mealCardAmountCents') AS INTEGER), 0) > 0
              AND datetime(l.timestamp) >= datetime(?2) AND datetime(l.timestamp) <= datetime(?3)
         ) GROUP BY provider",
    )
    .bind(tenant_id)
    .bind(from)
    .bind(to)
    .fetch_all(&mut *conn)
    .await
    .map_err(sql_error)?;

    let mut found: Vec<(String, i64, i64)> = Vec::with_capacity(rows.len());
    for row in rows {
        found.push((
            row.try_get("provider").map_err(sql_error)?,
            row.try_get("total").map_err(sql_error)?,
            row.try_get("cnt").map_err(sql_error)?,
        ));
    }
    let refunds = refunds_by_provider(conn, tenant_id, from, to).await?;
    let mut out = Vec::new();
    let (mut total_cents, mut count, mut refunded_cents) = (0_i64, 0_i64, 0_i64);
    for (code, _) in PROVIDERS {
        let sale = found.iter().find(|(known, _, _)| known == code);
        let refunded = refunds
            .iter()
            .filter(|(known, _)| known == code)
            .try_fold(0_i64, |sum, (_, cents)| sum.checked_add(*cents))
            .ok_or_else(|| "OVERFLOW: iade toplamı taştı".to_string())?;
        if sale.is_none() && refunded == 0 {
            continue;
        }
        let (gross, cnt) = sale.map_or((0, 0), |(_, total, cnt)| (*total, *cnt));
        let net = gross - refunded;
        total_cents += net;
        count += cnt;
        refunded_cents += refunded;
        out.push(ReconciliationRow {
            provider: code.to_string(),
            label: label_of(code).to_string(),
            total_cents: net,
            count: cnt,
            refunded_cents: refunded,
        });
    }
    Ok(Reconciliation {
        rows: out,
        total_cents,
        count,
        refunded_cents,
    })
}

/// Dönemdeki yemek kartı iadelerini marka bazında verir.
///
/// Neden satış kaydından marka okunur: `refunds` tablosu marka taşımaz. İade, orijinal
/// tahsilatın marka kırılımına sırayla dağıtılır; kırılım yoksa `OTHER` sayılır, böylece
/// iade tutarı hiçbir koşulda kaybolmaz.
async fn refunds_by_provider(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    from: &str,
    to: &str,
) -> Result<Vec<(String, i64)>, String> {
    let rows = sqlx::query(
        "SELECT r.amount_cents AS amount, l.payload AS payload
         FROM refunds r
         LEFT JOIN audit_ledger l ON l.tenant_id = r.tenant_id
              AND l.action = 'payment:settled_fifo' AND l.resource_id = r.original_transaction_id
         WHERE r.tenant_id = ?1 AND r.method = 'COMPENSATION'
           AND datetime(r.created_at) >= datetime(?2) AND datetime(r.created_at) <= datetime(?3)
         ORDER BY r.created_at, r.id",
    )
    .bind(tenant_id)
    .bind(from)
    .bind(to)
    .fetch_all(&mut *conn)
    .await
    .map_err(sql_error)?;
    let mut out: Vec<(String, i64)> = Vec::new();
    for row in rows {
        let mut left: i64 = row.try_get("amount").map_err(sql_error)?;
        let payload: Option<String> = row.try_get("payload").map_err(sql_error)?;
        let parsed = payload.and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
        if let Some(parts) = parsed
            .as_ref()
            .and_then(|value| value.get("mealProviderBreakdown"))
            .and_then(serde_json::Value::as_array)
        {
            for part in parts {
                let code = part
                    .get("provider")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(FALLBACK_PROVIDER);
                let cents = part
                    .get("amountCents")
                    .and_then(serde_json::Value::as_i64)
                    .unwrap_or(0);
                let take = left.min(cents.max(0));
                if take > 0 {
                    out.push((code.to_string(), take));
                    left -= take;
                }
            }
        }
        if left > 0 {
            out.push((FALLBACK_PROVIDER.to_string(), left));
        }
    }
    Ok(out)
}

#[cfg(test)]
#[path = "meal_cards_tests.rs"]
mod tests;
