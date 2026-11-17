//! Adisyon kapanınca e-Adisyon belgesini kuyruğa alır.
//!
//! Neden ayrı ve tahsilattan sonra: ayar kapalıyken hiçbir şey yapılmaz; açıkken bile
//! belge üretimindeki bir hata satışı geri almamalıdır (tahsilat zaten kesinleşmiştir).
//! Başarısız adisyon `list_e_document_candidates` listesinde kalır ve elle üretilebilir.

use sqlx::SqliteConnection;

use super::{queue, settings};
use crate::services::audit_service::AuditLock;

/// Ayar açıksa kapanmış adisyondan belge üretir ve gönderim sırasına alır.
/// Dönüş `false`: ayar kapalı, hiçbir kayıt yazılmadı.
pub async fn enqueue_closed_order(
    conn: &mut SqliteConnection,
    lock: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    order_id: &str,
) -> Result<bool, String> {
    if !settings::get(conn, tenant_id).await?.enabled {
        return Ok(false);
    }
    let draft = queue::create_draft(conn, lock, tenant_id, actor_id, actor_role, order_id).await?;
    if draft.status == queue::DRAFT {
        queue::submit(conn, lock, tenant_id, actor_id, actor_role, &draft.id).await?;
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::e_document::test_support::*;

    const ORDER: &str = "ord_000000000000000000000001";

    async fn run(pool: &sqlx::SqlitePool, tenant: &str) -> Result<bool, String> {
        let mutex = tokio::sync::Mutex::new(());
        let lock = AuditLock::new(mutex.lock().await);
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        enqueue_closed_order(&mut conn, &lock, tenant, ACTOR, "OWNER", ORDER).await
    }

    async fn rows(pool: &sqlx::SqlitePool, tenant: &str) -> Vec<String> {
        sqlx::query_scalar("SELECT status FROM e_document_queue WHERE tenant_id = ?")
            .bind(tenant)
            .fetch_all(pool)
            .await
            .expect("kuyruk")
    }

    #[tokio::test]
    async fn ayar_kapaliyken_hicbir_sey_yazilmaz() {
        let pool = fresh_pool().await;
        seed_paid_order(&pool, TENANT_A, ORDER).await;
        assert!(!run(&pool, TENANT_A).await.expect("no-op"));
        assert!(rows(&pool, TENANT_A).await.is_empty());
    }

    #[tokio::test]
    async fn ayar_aciksa_belge_gonderim_sirasina_girer_ve_tekrar_uretilmez() {
        let pool = fresh_pool().await;
        enable(&pool, TENANT_A).await;
        seed_paid_order(&pool, TENANT_A, ORDER).await;
        assert!(run(&pool, TENANT_A).await.expect("kuyruğa alındı"));
        assert_eq!(
            rows(&pool, TENANT_A).await,
            vec![queue::PENDING.to_string()]
        );
        run(&pool, TENANT_A).await.expect("ikinci çağrı");
        assert_eq!(rows(&pool, TENANT_A).await.len(), 1);
    }
}
