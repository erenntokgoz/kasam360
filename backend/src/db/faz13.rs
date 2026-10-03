//! Faz 13 · Kroki çizim şema migration'ı.
//!
//! Neden ayrı dosya: `init_db` 500 satır sınırında kalmalı; kroki şeması
//! (masa geometrisi + bölümler + mimari objeler) Faz 13'ün tamamıdır ve
//! başka fazların şemasıyla karışmamalıdır.

use crate::db::DbPool;

/// Kroki şemasını kuran migration.
///
/// Neden basit `ALTER TABLE ADD COLUMN` (Faz 12 deseni): masa geometrisi
/// beş **yeni** kolondur ve hepsinin varsayılanı vardır. Tabloyu yeniden
/// kurmaya gerek yoktur; yeniden kurmak `orders` ve `reservations` gibi
/// `tables`'a yönelen iki yabancı anahtarı riske atar.
///
/// SQLite bir kolon eklerken `CHECK` ya da `FOREIGN KEY` kısıtı koyamaz.
/// Bu yüzden `rotation`, `seats`, `x`, `y` aralık denetimi ve `zone`
/// kiracı denetimi **komut katmanında** yapılır; kural tek yerde
/// (floor_plan_commands) yaşar ve testler orayı hedefler.
pub(crate) async fn migrate_floor_plan_layout(pool: &DbPool) -> Result<(), sqlx::Error> {
    // Masa geometrisi. Varsayılanlar bilinçli: mevcut masalar (x=0,y=0) kroki
    // açıldığında sol üst köşede üst üste binmesin diye sonradan serpiştirilecek.
    let _ = sqlx::raw_sql("ALTER TABLE tables ADD COLUMN x INTEGER NOT NULL DEFAULT 0;")
        .execute(pool)
        .await;
    let _ = sqlx::raw_sql("ALTER TABLE tables ADD COLUMN y INTEGER NOT NULL DEFAULT 0;")
        .execute(pool)
        .await;
    let _ = sqlx::raw_sql("ALTER TABLE tables ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0;")
        .execute(pool)
        .await;
    let _ = sqlx::raw_sql("ALTER TABLE tables ADD COLUMN seats INTEGER NOT NULL DEFAULT 4;")
        .execute(pool)
        .await;
    // `zone` boş bırakılabilir: henüz bölümlenmemiş masalar da geçerli bir
    // durumdur ve "bölüm atanmamış" bilgisi sıfırdan farklıdır.
    let _ = sqlx::raw_sql("ALTER TABLE tables ADD COLUMN zone TEXT;")
        .execute(pool)
        .await;

    let _ = sqlx::raw_sql(
        "CREATE INDEX IF NOT EXISTS idx_tables_tenant_zone ON tables(tenant_id, zone);",
    )
    .execute(pool)
    .await;

    // Bölümler (Ana Salon, Teras, Bar). `tenant_id` üzerinde varsayılan
    // YOK: bind edilmemiş bir bölüm sessizce ortak havuza düşmemeli,
    // veritabanı hatası vermeli (AGENTS.md §3.3).
    let _ = sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS floor_zones (
            id          TEXT NOT NULL PRIMARY KEY,
            tenant_id   TEXT NOT NULL,
            name        TEXT NOT NULL,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            is_active   INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );",
    )
    .execute(pool)
    .await;

    let _ = sqlx::raw_sql(
        "CREATE INDEX IF NOT EXISTS idx_floor_zones_tenant ON floor_zones(tenant_id, sort_order);",
    )
    .execute(pool)
    .await;

    // Mimari objeler: kapı, bar, duvar, kolon. `zone_id` boş olabilir; bölüm
    // silinse de obje kaydı korunur (salon yeniden düzenlenebilir).
    //
    // `template_id` hangi objenin şablondan geldiğini işaretler. Neden şart:
    // şablon yeniden uygulandığında **kendi** objeleri yeniden yazmalıdır;
    // kullanıcının elle koyduğu kapı veya bar şablon uygulamasıyla
    // kaybolmamalıdır. Etiketsiz bir silme ("kind != 'WALL'") elde yapılan
    // tüm objeleri yok eder ve kullanıcının çizimini şablon uygulamasıyla
    // geri dönüşsüz biçimde siler.
    let _ = sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS floor_objects (
            id          TEXT NOT NULL PRIMARY KEY,
            tenant_id   TEXT NOT NULL,
            zone_id     TEXT,
            template_id TEXT,
            kind        TEXT NOT NULL CHECK (kind IN ('DOOR','BAR','WALL','COLUMN')),
            label       TEXT,
            x           INTEGER NOT NULL DEFAULT 0,
            y           INTEGER NOT NULL DEFAULT 0,
            width       INTEGER NOT NULL DEFAULT 80,
            height      INTEGER NOT NULL DEFAULT 80,
            rotation    INTEGER NOT NULL DEFAULT 0,
            is_active   INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );",
    )
    .execute(pool)
    .await;

    // Şema zaten var olan kurulumlarda yeni kolonu da eklemek gerekir.
    let _ = sqlx::raw_sql("ALTER TABLE floor_objects ADD COLUMN template_id TEXT;")
        .execute(pool)
        .await;

    let _ = sqlx::raw_sql(
        "CREATE INDEX IF NOT EXISTS idx_floor_objects_tenant_zone ON floor_objects(tenant_id, zone_id);",
    )
    .execute(pool)
    .await;

    let _ = sqlx::raw_sql(
        "CREATE INDEX IF NOT EXISTS idx_floor_objects_template ON floor_objects(tenant_id, template_id);",
    )
    .execute(pool)
    .await;

    Ok(())
}
