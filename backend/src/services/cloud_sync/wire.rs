//! Günlük kaydının buluta giden biçimi.
//!
//! Aynı işlemi yerel ağdaki her kasa gönderebilir; sunucu içeriği karşılaştırıp
//! tekrar sayar. Bu yüzden dönüşüm belirlenimcidir: önceki görüntü (`old`) her
//! cihazda atılır, eksik ekleme anahtarı her cihazda aynı şemadan doldurulur.

use serde_json::{Map, Value};
use sqlx::{Row, SqliteConnection};
use std::collections::HashMap;

/// Tablonun birincil anahtar kolonları, sırasıyla. Tablo yoksa boş döner.
pub async fn primary_keys(conn: &mut SqliteConnection, table: &str) -> Result<Vec<String>, String> {
    let rows = sqlx::query("SELECT name, pk FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk")
        .bind(table)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    rows.iter()
        .map(|row| row.try_get::<String, _>("name").map_err(|e| e.to_string()))
        .collect()
}

/// Anahtar kolonları önbelleğe alınır: bir gönderimde aynı tablo yüzlerce kez geçer.
#[derive(Default)]
pub struct KeyCache(HashMap<String, Vec<String>>);

impl KeyCache {
    pub async fn keys(
        &mut self,
        conn: &mut SqliteConnection,
        table: &str,
    ) -> Result<Vec<String>, String> {
        if let Some(keys) = self.0.get(table) {
            return Ok(keys.clone());
        }
        let keys = primary_keys(conn, table).await?;
        self.0.insert(table.to_string(), keys.clone());
        Ok(keys)
    }
}

/// Satırdan anahtar çıkarır. Anahtar kolonu satırda yoksa işlem gönderilemez: sunucu
/// eksik anahtarı reddeder, tahmin edilmiş anahtar başka satırı ezerdi.
fn key_from_row(
    table: &str,
    keys: &[String],
    row: &Map<String, Value>,
) -> Result<Map<String, Value>, String> {
    if keys.is_empty() {
        return Err(format!(
            "CLOUD_KEY_MISSING: {table} tablosunun anahtarı bulunamadı"
        ));
    }
    keys.iter()
        .map(|column| {
            row.get(column)
                .map(|value| (column.clone(), value.clone()))
                .ok_or_else(|| format!("CLOUD_KEY_MISSING: {table}.{column} satırda yok"))
        })
        .collect()
}

/// `CHANGES` gövdesini sözleşme biçimine getirir: `old` atılır, ekleme anahtarı doldurulur.
pub(super) async fn normalize_changes(
    conn: &mut SqliteConnection,
    cache: &mut KeyCache,
    body: &mut Value,
) -> Result<usize, String> {
    let Some(changes) = body.get_mut("changes").and_then(Value::as_array_mut) else {
        return Err("CLOUD_INVALID_LOG: değişiklik listesi okunamadı".to_string());
    };
    for change in changes.iter_mut() {
        let Some(fields) = change.as_object_mut() else {
            return Err("CLOUD_INVALID_LOG: değişiklik nesne değil".to_string());
        };
        fields.remove("old");
        let has_key = fields.get("key").is_some_and(Value::is_object);
        if has_key {
            continue;
        }
        let table = fields
            .get("table")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "CLOUD_INVALID_LOG: tablo adı yok".to_string())?;
        let row = fields
            .get("row")
            .and_then(Value::as_object)
            .ok_or_else(|| {
                format!("CLOUD_KEY_MISSING: {table} değişikliğinde anahtar ve satır yok")
            })?;
        let keys = cache.keys(conn, &table).await?;
        let key = key_from_row(&table, &keys, row)?;
        fields.insert("key".to_string(), Value::Object(key));
    }
    Ok(changes.len())
}

/// Gönderime hazır işlem ve satır değişikliği sayısı.
#[derive(Debug, Clone)]
pub struct WireOperation {
    pub operation_id: String,
    pub json: Value,
    pub changes: usize,
    pub bytes: usize,
}

pub struct LogFields<'a> {
    pub operation_id: &'a str,
    pub tenant_id: &'a str,
    pub device_id: &'a str,
    pub actor_id: &'a str,
    pub actor_role: &'a str,
    pub intent_sha256: &'a str,
    pub payload: &'a str,
    pub created_at: &'a str,
}

/// Günlük satırını `Operation` serde biçimine çevirir. Gövde `LogOp`'a çözülmez: bulut
/// bilmediği alanı da saklasın, yerel sürümün tanımadığı tür sessizce değişmesin.
/// Ada birleşmesi birden çok işleme açılır (`merge_wire`); `me` gönderen kasadır.
pub async fn from_log(
    conn: &mut SqliteConnection,
    cache: &mut KeyCache,
    fields: &LogFields<'_>,
    me: &str,
) -> Result<Vec<WireOperation>, String> {
    let mut op: Value = serde_json::from_str(fields.payload)
        .map_err(|e| format!("CLOUD_INVALID_LOG: {} okunamadı: {e}", fields.operation_id))?;
    let domain = op
        .get("domain")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if domain == "ISLAND_MERGE" {
        let body = op
            .get("body")
            .ok_or_else(|| "CLOUD_INVALID_LOG: birleşme gövdesi yok".to_string())?;
        return super::merge_wire::expand(conn, cache, fields, body, me).await;
    }
    let changes = if domain == "CHANGES" {
        let body = op
            .get_mut("body")
            .ok_or_else(|| "CLOUD_INVALID_LOG: değişiklik gövdesi yok".to_string())?;
        normalize_changes(conn, cache, body).await?
    } else {
        0
    };
    let json = serde_json::json!({
        "operationId": fields.operation_id,
        "tenantId": fields.tenant_id,
        "deviceId": fields.device_id,
        "actorId": fields.actor_id,
        "actorRole": fields.actor_role,
        "intentSha256": fields.intent_sha256,
        "op": op,
        "createdAt": fields.created_at,
    });
    let bytes = json.to_string().len();
    Ok(vec![WireOperation {
        operation_id: fields.operation_id.to_string(),
        json,
        changes,
        bytes,
    }])
}

/// Saklanmış hazır işlem (ilk yükleme) için boyut ve sayım.
pub fn from_stored(text: &str) -> Result<WireOperation, String> {
    let json: Value = serde_json::from_str(text).map_err(|e| format!("CLOUD_INVALID_LOG: {e}"))?;
    let operation_id = json
        .get("operationId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "CLOUD_INVALID_LOG: işlem kimliği yok".to_string())?;
    let changes = json
        .pointer("/op/body/changes")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    Ok(WireOperation {
        operation_id,
        bytes: text.len(),
        changes,
        json,
    })
}

/// Anahtarın sıra bağımsız metni: aynı satır her yerde aynı metni verir.
pub fn key_text(table: &str, key: &Map<String, Value>) -> String {
    let mut pairs: Vec<(&String, &Value)> = key.iter().collect();
    pairs.sort_by(|a, b| a.0.cmp(b.0));
    let body: Vec<String> = pairs
        .into_iter()
        .map(|(column, value)| format!("{column}={value}"))
        .collect();
    format!("{table}\u{1}{}", body.join("\u{1}"))
}
