//! Faz 13 · Kroki düzeni servis testleri — ortak yardımcılar.
//!
//! Kapsam dışı bırakılırsa dört sessiz hata geri gelir:
//!   1. Çapraz kiracı sızıntısı: `tables.zone` düz metindir, denetim yalnız
//!      burada yapılır.
//!   2. Kısmi kayıt: toplu düzen yarıda kaydedilir ve salon bozulur.
//!   3. Aralık kaçağı: 7° döndürme ve 5 sandalye kabul edilir, sonra kaydedilen
//!      konum kayar.
//!   4. Şablon itmesi: şablon uygulaması kullanıcının el emeğini siler.
//!
//! Dosya bölünmesinin nedeni: AGENTS.md 500 satır sınırı. Alt modüller
//! konuya göre ayrılmıştır, testlere göre değil.

use crate::db::faz13::migrate_floor_plan_layout;
use crate::services::floor360::types::{ObjectPlacement, TablePlacement};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqliteConnection;

/// Uygulamanın gerçek şeması + Faz 13 migration'ı ile ayaklanan bellek içi
/// veritabanı. `schema.sql` okunur, elle DDL yazılmaz: elle yazılan şema
/// üretim şemasından ayrışır ve test gerçeği değil kurguyu doğrular.
pub(super) async fn pool() -> sqlx::Pool<sqlx::Sqlite> {
    let p = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../../../../migrations/schema.sql"))
        .execute(&p)
        .await
        .unwrap();
    migrate_floor_plan_layout(&p).await.unwrap();
    p
}

/// Havuzdan bağlantı koparır. `SqliteConnection` servis imzasıdır; havuz
/// tutmak, doğrulama sırasında başka bir bağlantıyla yarışma yaratır.
pub(super) async fn conn(p: &sqlx::Pool<sqlx::Sqlite>) -> SqliteConnection {
    p.acquire().await.unwrap().detach()
}

/// Test masası ekler. `tenant_id` **daima** bind edilir; tabloda varsayılan
/// yoktur ve test de bu kurala uyar (AGENTS.md §3.3).
pub(super) async fn masa_ekle(p: &sqlx::Pool<sqlx::Sqlite>, id: &str, kirac: &str, ad: &str) {
    sqlx::query(
        "INSERT INTO tables (id, tenant_id, name, status, current_total, x, y, seats)
         VALUES (?, ?, ?, 'AVAILABLE', 0, 0, 0, 4)",
    )
    .bind(id)
    .bind(kirac)
    .bind(ad)
    .execute(p)
    .await
    .unwrap();
}

pub(super) fn yerlesim(
    table_id: &str,
    x: i64,
    y: i64,
    rotation: i64,
    seats: i64,
) -> TablePlacement {
    TablePlacement {
        table_id: table_id.to_string(),
        x,
        y,
        rotation,
        seats,
        zone_id: None,
    }
}

pub(super) fn obje_yerlesim(object_id: &str, kind: &str, x: i64, y: i64) -> ObjectPlacement {
    ObjectPlacement {
        object_id: object_id.to_string(),
        zone_id: None,
        kind: kind.to_string(),
        label: None,
        x,
        y,
        width: 80,
        height: 80,
        rotation: 0,
    }
}

mod atomicity;
mod contract;
mod geometry;
mod objects;
mod templates;
mod tenant;
