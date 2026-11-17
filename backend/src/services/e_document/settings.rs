//! e-Adisyon ayarları: açık/kapalı anahtarı ve belgeyi düzenleyen işletmenin kimliği.
//!
//! Neden varsayılan kapalı: sağlayıcı sözleşmesi ve mali mühür olmadan hiçbir işletme
//! belge kuyruğuna düşmemeli. Açma kararı yalnız işletme sahibindedir ve denetim
//! defterine yazılır; eksik kimlik bilgisiyle açılamaz (fail-closed).

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use super::model::Supplier;
use super::tax_id;
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};

pub const DEFAULT_SERIES: &str = "ADS";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EDocumentSettings {
    pub enabled: bool,
    pub tax_id: String,
    pub legal_name: String,
    pub tax_office: String,
    pub series_code: String,
    pub street: String,
    pub district: String,
    pub city: String,
}

impl Default for EDocumentSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            tax_id: String::new(),
            legal_name: String::new(),
            tax_office: String::new(),
            series_code: DEFAULT_SERIES.to_string(),
            street: String::new(),
            district: String::new(),
            city: String::new(),
        }
    }
}

pub async fn get(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<EDocumentSettings, String> {
    let row = sqlx::query(
        "SELECT enabled, tax_id, legal_name, tax_office, series_code, street, district, city \
         FROM e_document_settings WHERE tenant_id = ?",
    )
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let Some(row) = row else {
        return Ok(EDocumentSettings::default());
    };
    let text = |name: &str| row.try_get::<String, _>(name).map_err(|e| e.to_string());
    Ok(EDocumentSettings {
        enabled: row
            .try_get::<i64, _>("enabled")
            .map_err(|e| e.to_string())?
            != 0,
        tax_id: text("tax_id")?,
        legal_name: text("legal_name")?,
        tax_office: text("tax_office")?,
        series_code: text("series_code")?,
        street: text("street")?,
        district: text("district")?,
        city: text("city")?,
    })
}

fn clean(value: &str, label: &str, max: usize) -> Result<String, String> {
    let value = value.trim();
    if value.chars().count() > max {
        return Err(format!("VALIDATION: {label} en çok {max} karakter olmalı"));
    }
    Ok(value.to_string())
}

fn normalized(input: &EDocumentSettings) -> Result<EDocumentSettings, String> {
    let series = input.series_code.trim().to_uppercase();
    if series.len() != 3 || !series.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err("VALIDATION: birim kodu 3 harf/rakam olmalı".to_string());
    }
    let settings = EDocumentSettings {
        enabled: input.enabled,
        tax_id: input.tax_id.trim().to_string(),
        legal_name: clean(&input.legal_name, "unvan", 120)?,
        tax_office: clean(&input.tax_office, "vergi dairesi", 80)?,
        series_code: series,
        street: clean(&input.street, "adres", 200)?,
        district: clean(&input.district, "ilçe", 80)?,
        city: clean(&input.city, "şehir", 80)?,
    };
    if !settings.tax_id.is_empty() {
        tax_id::classify(&settings.tax_id)?;
    }
    if settings.enabled {
        // Açık bir anahtar eksik kimlikle belge üretmesin diye alanlar topluca istenir.
        if settings.tax_id.is_empty() {
            return Err("VALIDATION: e-Adisyon için VKN/TCKN zorunlu".to_string());
        }
        if settings.legal_name.is_empty()
            || settings.tax_office.is_empty()
            || settings.city.is_empty()
        {
            return Err("VALIDATION: e-Adisyon için unvan, vergi dairesi ve şehir zorunlu".into());
        }
    }
    Ok(settings)
}

pub async fn save(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    input: &EDocumentSettings,
) -> Result<EDocumentSettings, String> {
    let settings = normalized(input)?;
    sqlx::query(
        "INSERT INTO e_document_settings \
            (tenant_id, enabled, tax_id, legal_name, tax_office, series_code, street, district, city, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) \
         ON CONFLICT(tenant_id) DO UPDATE SET enabled = excluded.enabled, tax_id = excluded.tax_id, \
            legal_name = excluded.legal_name, tax_office = excluded.tax_office, \
            series_code = excluded.series_code, street = excluded.street, \
            district = excluded.district, city = excluded.city, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(tenant_id)
    .bind(i64::from(settings.enabled))
    .bind(&settings.tax_id)
    .bind(&settings.legal_name)
    .bind(&settings.tax_office)
    .bind(&settings.series_code)
    .bind(&settings.street)
    .bind(&settings.district)
    .bind(&settings.city)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let ctx = AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        category::SISTEM,
        "e_document:settings_saved",
        tenant_id.to_string(),
        serde_json::json!({
            "enabled": settings.enabled,
            "taxId": settings.tax_id,
            "seriesCode": settings.series_code,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(conn, lock, &ctx).await?;
    Ok(settings)
}

/// Açık ve eksiksiz ayardan düzenleyen taraf bilgisini üretir; aksi hâlde belge üretilmez.
pub fn supplier_of(settings: &EDocumentSettings) -> Result<Supplier, String> {
    if !settings.enabled {
        return Err("DISABLED: e-Adisyon kapalı".to_string());
    }
    let normalized = normalized(settings)?;
    let kind = tax_id::classify(&normalized.tax_id)?;
    Ok(Supplier {
        tax_id: normalized.tax_id,
        tax_id_kind: kind,
        legal_name: normalized.legal_name,
        tax_office: normalized.tax_office,
        street: normalized.street,
        district: normalized.district,
        city: normalized.city,
    })
}
