//! Faz 11 B4 — personel KPI.
//!
//! Kaynak: `order_items.waiter_id` (garsonun sattığı kalemler) ve
//! `orders.cashier_id` (kapanan sipariş). Her iki alan da B1'de yazılmaya
//! başlandı; eski siparişlerde `waiter_id` boştur ve bu durum bilinçli
//! olarak rapora "kapsam dışı" olarak yansır, sıfır gibi gösterilmez.

use sqlx::Row;
use sqlx::SqlitePool;

use crate::services::staff360::payroll_types::StaffKpi;

/// Tarih aralığı doğrulaması. `from > to` hatası: ters aralıkta sorgu hiç
/// satır döner ve ekranda "bu ay 0 satış" gibi yanlış bir tablo çıkar.
fn aralik_kontrol(from: &str, to: &str) -> Result<(), String> {
    if from > to {
        return Err(format!("tarih araligi ters: {from} > {to}"));
    }
    Ok(())
}

/// Tüm personel KPI sıralaması. `user_id` verilirse tek kişi döner.
pub async fn kpi(
    pool: &SqlitePool,
    tenant_id: &str,
    from: &str,
    to: &str,
    user_id: Option<&str>,
) -> Result<Vec<StaffKpi>, String> {
    aralik_kontrol(from, to)?;

    // Sorgu iki katmanlı: garson satışı kalemlerden, kasa satışı siparişten
    // gelir. Aynı kişi her iki rolü de tutuyorsa toplanır (POS'ta sık olur).
    let sql = "SELECT u.id AS user_id, u.name AS full_name,
                      COALESCE((
                        SELECT COUNT(*) FROM order_items oi
                          JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
                         WHERE oi.tenant_id = u.tenant_id AND oi.waiter_id = u.id
                           AND o.status IN ('PAID','IN_PROGRESS','OPEN')
                           AND o.created_at >= ?2 AND o.created_at <= ?3
                      ), 0) AS item_count,
                      COALESCE((
                        SELECT SUM(oi.total_cents) FROM order_items oi
                          JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
                         WHERE oi.tenant_id = u.tenant_id AND oi.waiter_id = u.id
                           AND o.status IN ('PAID','IN_PROGRESS','OPEN')
                           AND o.created_at >= ?2 AND o.created_at <= ?3
                      ), 0) AS kalem_cirosu,
                      COALESCE((
                        SELECT COUNT(*) FROM orders o
                         WHERE o.tenant_id = u.tenant_id AND o.cashier_id = u.id
                           AND o.status IN ('PAID','IN_PROGRESS','OPEN')
                           AND o.created_at >= ?2 AND o.created_at <= ?3
                      ), 0) AS order_count,
                      COALESCE((
                        SELECT SUM(o.total_cents) FROM orders o
                         WHERE o.tenant_id = u.tenant_id AND o.cashier_id = u.id
                           AND o.status IN ('PAID','IN_PROGRESS','OPEN')
                           AND o.created_at >= ?2 AND o.created_at <= ?3
                      ), 0) AS siparis_cirosu,
                      COALESCE((
                        SELECT COUNT(*) FROM orders o
                         WHERE o.tenant_id = u.tenant_id AND o.cashier_id = u.id
                           AND o.status = 'VOID'
                           AND o.created_at >= ?2 AND o.created_at <= ?3
                      ), 0) AS void_count
                 FROM users u
                WHERE u.tenant_id = ?1 AND u.is_active = 1
                  AND (?4 IS NULL OR u.id = ?4)
                ORDER BY u.name ASC";

    let rows = sqlx::query(sql)
        .bind(tenant_id)
        .bind(from)
        .bind(to)
        .bind(user_id)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("KPI sorgusu okunamadi: {e}"))?;

    let mut out: Vec<StaffKpi> = Vec::with_capacity(rows.len());
    for r in rows {
        let uid: String = r.try_get("user_id").map_err(|e| e.to_string())?;
        let item_count: i64 = r.try_get("item_count").map_err(|e| e.to_string())?;
        let kalem_cirosu: i64 = r.try_get("kalem_cirosu").map_err(|e| e.to_string())?;
        let order_count: i64 = r.try_get("order_count").map_err(|e| e.to_string())?;
        let siparis_cirosu: i64 = r.try_get("siparis_cirosu").map_err(|e| e.to_string())?;
        let void_count: i64 = r.try_get("void_count").map_err(|e| e.to_string())?;
        let ciro = kalem_cirosu + siparis_cirosu;
        // Ortalama fiş yalnız fiş varsa hesaplanır; fiş yoksa 0 değil `None`
        // döner, ekranda "veri yok" yazar.
        let avg_ticket = if order_count > 0 {
            siparis_cirosu / order_count
        } else {
            0
        };
        let top_product = top_product(pool, tenant_id, &uid, from, to).await?;
        out.push(StaffKpi {
            user_id: uid,
            full_name: r.try_get("full_name").map_err(|e| e.to_string())?,
            order_count,
            item_count,
            gross_sales_cents: ciro,
            avg_ticket_cents: avg_ticket,
            void_count,
            top_product,
        });
    }
    Ok(out)
}

/// En çok satan ürün. Satış yoksa `None` döner — "en çok satan: bilinmiyor"
/// uydurmak yanlış bilgi olurdu.
async fn top_product(
    pool: &SqlitePool,
    tenant_id: &str,
    user_id: &str,
    from: &str,
    to: &str,
) -> Result<Option<String>, String> {
    let ad: Option<String> = sqlx::query_scalar(
        "SELECT p.name
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id
           JOIN products p ON p.id = oi.product_id AND p.tenant_id = oi.tenant_id
          WHERE oi.tenant_id = ?1 AND oi.waiter_id = ?2 AND o.status = 'PAID'
            AND o.created_at >= ?3 AND o.created_at <= ?4
          GROUP BY p.id, p.name
          ORDER BY SUM(oi.quantity) DESC, p.name ASC
          LIMIT 1",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(from)
    .bind(to)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("en cok satan urun okunamadi: {e}"))?;
    Ok(ad)
}
