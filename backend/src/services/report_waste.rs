//! Fire iptal ve düzeltme olaylarının rapora yansıması.
//!
//! Neden denetim defterinden: fire kaydı deftere eklemeli yazılır; iptal ve düzeltme de
//! yeni olay olarak eklenir. Rapor, eski olayı değiştirmek yerine bu olayları okuyup
//! iptal edilen fireyi saymaz.

use sqlx::{Row, SqliteConnection};

/// İptal edilen fire kayıtları ve düzeltilmiş son tutarlar (denetim defterinden).
pub(crate) async fn waste_corrections(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<
    (
        std::collections::HashSet<String>,
        std::collections::HashMap<String, i64>,
    ),
    String,
> {
    let rows = sqlx::query(
        "SELECT action, resource_id, payload FROM audit_ledger          WHERE tenant_id = ? AND action IN ('stok:waste_voided', 'stok:waste_edited')          ORDER BY timestamp DESC, rowid DESC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut voided = std::collections::HashSet::new();
    let mut edited = std::collections::HashMap::new();
    for row in rows {
        let action: String = row
            .try_get::<Option<String>, _>("action")
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        let resource: String = row
            .try_get::<Option<String>, _>("resource_id")
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        if action == "stok:waste_voided" {
            voided.insert(resource);
            continue;
        }
        // Yeniden eskiye sıralı: ilk görülen düzeltme son tutardır.
        if edited.contains_key(&resource) {
            continue;
        }
        let payload_text: String = row
            .try_get::<Option<String>, _>("payload")
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        let payload: serde_json::Value = serde_json::from_str(&payload_text)
            .map_err(|_| "WASTE düzeltme kaydı okunamadı.".to_string())?;
        let cents = payload
            .get("totalCostCents")
            .and_then(|v| v.as_i64())
            .ok_or_else(|| "WASTE düzeltmesinde 'totalCostCents' tutarı okunamadı.".to_string())?;
        edited.insert(resource, cents);
    }
    Ok((voided, edited))
}
