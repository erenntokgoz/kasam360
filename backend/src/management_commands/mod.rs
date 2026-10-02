//! Yönetim komutlarının ortak güvenlik yardımcıları ve alt modüller.
//!
//! Dosya 500 satır sınırını aşmasın diye menü (kategori/ürün) ve personel
//! komutları ayrı modüllere ayrıldı. `pub use` yeniden dışa aktarımı
//! sayesinde `management_commands::get_management_products` gibi mevcut
//! çağrı yolları bozulmaz.

pub mod category;
pub mod product;
pub mod staff;

pub use category::{
    create_category, delete_category, get_management_categories, update_category,
};
pub use product::{
    create_product, delete_product, get_management_products, update_product,
    update_product_status,
};
pub use staff::{create_staff_member, delete_staff_member, get_staff};

use crate::services::audit_service::{AuditContext, AuditLock, AuditService};

/// Denetim defterine tek satır yazar. Yönetim komutları zaten `audit_mutex`
/// tutuyordu ama hiçbiri kayıt yazmıyordu; menü, ürün, personel ve modifier
/// değişiklikleri defter dışında kalıyordu.
pub(crate) async fn record_audit(
    conn: &mut sqlx::SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    category: &'static str,
    action: &str,
    resource_id: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    let ctx = AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        category,
        action,
        resource_id.to_string(),
        payload,
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(conn, lock, &ctx).await?;
    Ok(())
}

/// Çağıran oturum bilgisi taşımıyorsa aktör "SYSTEM" olarak yazılır; yönetim
/// ekranları oturum kullanıcısını `actor_id`/`actor_role` ile geçer.
pub(crate) fn audit_actor(actor_id: Option<String>, actor_role: &str) -> (String, String) {
    (
        actor_id.unwrap_or_else(|| "SYSTEM".to_string()),
        actor_role.to_string(),
    )
}

/// Çağıranın işletmesini çözer ve **fail-closed** doğrular.
///
/// Neden bu ayrı fonksiyon: tenant kimliği hiçbir zaman hedef satırdan
/// okunmaz. Okunursa bir işletme sahibi başka işletmenin `prd_...` kimliğini
/// tahmin edip değiştirebilir (satır güncellenir), üstelik denetim kaydı da
/// *kurbanın* defterine yazılır — defter hem sızdırılır hem de yalan söyler.
/// Tenant çağırandan gelir; hedefin ait olup olmadığı `WHERE` ile sınanır.
pub(crate) fn require_tenant(tenant_id: Option<&str>) -> Result<String, String> {
    let tenant = tenant_id.unwrap_or("").trim();
    if tenant.is_empty() {
        // Oturumsuz çağrı sessizce "DEFAULT_TENANT"e düşerse tüm işletmeler
        // aynı havuzda birleşir. Oturum yoksa işlem yapılamaz.
        return Err("UNAUTHORIZED: oturum işletmesi yok, işlem reddedildi".into());
    }
    Ok(tenant.to_string())
}

/// Hedef kayıt bu işletmeye ait mi diye sınar.
///
/// Ayrı döndürmek yerine `NOT_FOUND` verilir: "başka işletmenin ürünü"
/// demek, saldırgana hedefin var olduğunu sızdırır ve yanlış bir hata
/// tipidir. Çağıran yalnız kendi işletmesinde işlem yapabilir.
pub(crate) async fn ensure_owned(
    conn: &mut sqlx::SqliteConnection,
    table: &str,
    id: &str,
    tenant_id: &str,
) -> Result<(), String> {
    // `table` yalnız bu modülün sabit tablo adlarından gelir; kullanıcı girdisi
    // değildir, bu yüzden biçimlendirilebilir.
    let sql = format!("SELECT 1 FROM {table} WHERE id = ? AND tenant_id = ?");
    let found: Option<i32> = sqlx::query_scalar(&sql)
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(conn)
        .await
        .map_err(|e| e.to_string())?;
    if found.is_none() {
        return Err(format!("NOT_FOUND: {table} kaydı bulunamadı"));
    }
    Ok(())
}
