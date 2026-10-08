//! Komutlar arasında paylaşılan küçük yardımcılar
//!
//! Bu dosya commands.rs 500 satır tavanını aştığı için bölündü; içerik
//! olduğu gibi taşındı, davranış değiştirilmedi.

use sqlx::Row;

/// Komutun çağıranı oturum bilgisi taşımıyorsa aktör "SYSTEM" olarak yazılır.
///
/// Eskiden bu yollar "System" yazıyordu; fark, artık bunu bir **sabit** olarak
/// değil, çağıranın gerçekten bildirmediği bir gerçek olarak ifade ediyoruz.
pub(crate) fn audit_actor(actor_id: Option<String>, actor_role: Option<String>) -> (String, String) {
    (
        actor_id.unwrap_or_else(|| "SYSTEM".to_string()),
        actor_role.unwrap_or_else(|| "System".to_string()),
    )
}

/// Denetim kaydının tenant'ını masa satırından fail-closed çözer.
///
/// Neden hata döner: masa kaydı yoksa veya kiracı boşsa
/// varsayılan kiracıya düşmek, başka bir işletmenin
/// masa kimliğiyle denetim kaydı yazmaktır. Kiracı
/// çözülemezse komut durur (fail-closed, AGENTS.md §3.3).
pub(crate) async fn table_tenant(
    conn: &mut sqlx::SqliteConnection,
    table_id: &str,
) -> Result<String, String> {
    let row = sqlx::query("SELECT tenant_id FROM tables WHERE id = ?")
        .bind(table_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    let Some(row) = row else {
        return Err(format!("NOT_FOUND: masa bulunamadı ({table_id})"));
    };
    let tenant: Option<String> = row.try_get("tenant_id").map_err(|e| e.to_string())?;
    tenant
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string())
}

/// Kiracı kimliğini fail-closed çözer.
///
/// Neden: `move_table`/`merge_tables` gibi komutlar `tenant_id` parametresi
/// almadığı için hedef masanın tenant'ı denetlenmeden yazılıyordu. Boş
/// string veya eksik değer kabul edilirse sorgular `tenant_id = ''` ile
/// eşleşmez ve yazma sessizce başarısız olur; bu yüzden hata fırlatılır.
pub(crate) fn require_tenant_id(tenant_id: Option<&str>) -> Result<String, String> {
    tenant_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string())
}
