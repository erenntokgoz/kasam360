//! Faz 11 testleri — ortak fixture'lar ve alt modüller.
//!
//! Dosya 500 satır sınırını aşmasın diye konu alanına göre bölündü. Her test
//! gerçek SQLite şeması üzerinde çalışır ve **hesabın tutarlılığını**
//! kanıtlar: kuruş kaybı yok, tenant sızmıyor, yetkisiz çağıran tutar görmüyor.

mod kpi;
mod payroll;
mod radar;
mod regression;
mod staff;
mod tip;

use chrono::Datelike;
use sqlx::SqlitePool;

use crate::services::staff360::payroll_types::{PayrollRuleInput, TipAllocationInput};
use crate::services::staff360::{
    kpi_service, payroll_service, staff_service, suspicious_service, tip_service,
};

async fn pool() -> SqlitePool {
    let p = SqlitePool::connect("sqlite::memory:").await.expect("hafıza");
    sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
        .execute(&p)
        .await
        .expect("şema");
    p
}

async fn kullanici(p: &SqlitePool, tenant: &str, id: &str, ad: &str, rol: &str) {
    sqlx::query("INSERT INTO users (id, tenant_id, role, name, is_active) VALUES (?1,?2,?3,?4,1)")
        .bind(id)
        .bind(tenant)
        .bind(rol)
        .bind(ad)
        .execute(p)
        .await
        .expect("kullanıcı");
}

async fn kasa(p: &SqlitePool, tenant: &str, id: &str) {
    sqlx::query(
        "INSERT INTO tables (id, tenant_id, name, status, waiter_id) VALUES (?1,?2,?3,'AVAILABLE',NULL)",
    )
    .bind(id)
    .bind(tenant)
    .bind(id)
    .execute(p)
    .await
    .expect("masa");
}

/// `tag` tenant'a özgüdür: `products.id` ve `categories.id` global birincil
/// anahtardır, iki kiracı aynı kimliği kullanamaz.
async fn urun(p: &SqlitePool, tenant: &str, tag: &str) {
    let kat = format!("cat_{tag}");
    let urun_id = format!("prd_{tag}");
    sqlx::query("INSERT INTO categories (id, tenant_id, name) VALUES (?1,?2,'Kahve')")
        .bind(&kat)
        .bind(tenant)
        .execute(p)
        .await
        .expect("kategori");
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, category_id, price_cents) VALUES (?1,?2,?3,?4,2500)",
    )
    .bind(&urun_id)
    .bind(tenant)
    .bind(format!("Espresso {tag}"))
    .bind(&kat)
    .execute(p)
    .await
    .expect("ürün");
}

/// Sipariş + kalem + istenen garson. `created_at` **açıkça** verilir: bordro
/// dönemi (`YYYY-MM`) ve KPI aralığı gerçek tarihle karşılaştırır, "bugün"
/// varsayımı testi sessizce boşa çıkarırdı.
async fn siparis(
    p: &SqlitePool,
    tenant: &str,
    oid: &str,
    kasiyer: &str,
    garson: &str,
    toplam: i64,
    durum: &str,
    created_at: &str,
) {
    sqlx::query(
        "INSERT INTO orders (id, tenant_id, table_id, status, total_cents, cashier_id, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
    )
    .bind(oid)
    .bind(tenant)
    .bind("tbl_1")
    .bind(durum)
    .bind(toplam)
    .bind(kasiyer)
    .bind(created_at)
    .execute(p)
    .await
    .expect("sipariş");
    // Ürün kimliği kiracının kendi ürünüdür: `product_id` global FK'dir, yanlış
    // işletmenin ürününe bağlamak testin konusunu bozardı.
    let urun_id: String = sqlx::query_scalar(
        "SELECT id FROM products WHERE tenant_id = ?1 ORDER BY id LIMIT 1",
    )
    .bind(tenant)
    .fetch_one(p)
    .await
    .expect("ürün");
    sqlx::query(
        "INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, total_cents, waiter_id)
         VALUES (?1,?2,?3,?4,1,?5,?6)",
    )
    .bind(format!("oi_{oid}"))
    .bind(tenant)
    .bind(oid)
    .bind(&urun_id)
    .bind(toplam)
    .bind(garson)
    .execute(p)
    .await
    .expect("kalem");
}

