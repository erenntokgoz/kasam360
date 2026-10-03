//! Faz 13 · Kroki düzenini okuma ve yazma.
//!
//! Yazma disiplini: her yazma `BEGIN IMMEDIATE` + denetim kilidi altında
//! çalışır ve **atomiktir**. Tek bir masa ya da obje reddedilirse düzenin
//! tamamı geri alınır; kısmi kayıt bırakmak, kullanıcının salonunu yarım
//! çizilmiş bırakır ve kaydet butonu "yarım yazdı" izlenimi üretir.

use super::types::{
    validate_object_placement, validate_table_placement, FloorLayout, FloorObject, FloorZone,
    LayoutTable, SaveLayoutInput, CANVAS_HEIGHT, CANVAS_WIDTH, GRID, ROTATION_STEP,
};
use crate::id_generator::generate_id;
use sqlx::{Row, SqliteConnection};

/// Masanın kıracaı boş olmamalı; boş kırak tüm masaları eşleştirir.
fn require_key(anahtar: &str) -> Result<String, String> {
    let kirac = anahtar.trim();
    if kirac.is_empty() {
        return Err("VALIDATION: kimlik boş olamaz".into());
    }
    Ok(kirac.to_string())
}

/// Bölümün bu kiracıya ait olduğunu kanıtlar.
///
/// Neden sorgu: SQLite `ALTER TABLE ADD COLUMN` ile yabancı anahtar kısıtı
/// koyamaz, bu yüzden `tables.zone` düz metindir. Kiracı sızıntısını engelleyen
/// tek yer burasıdır (AGENTS.md §3.3). Bölüm başka kiracınınsa hata döner.
pub(super) async fn zone_belongs_to_tenant(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    zone_id: &str,
) -> Result<(), String> {
    let sahip: Option<String> =
        sqlx::query_scalar("SELECT tenant_id FROM floor_zones WHERE id = ?")
            .bind(zone_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    match sahip {
        None => Err("NOT_FOUND: bölüm bulunamadı".into()),
        Some(kirac) if kirac == tenant_id => Ok(()),
        Some(_) => Err("UNAUTHORIZED: bölüm başka bir işletmeye ait".into()),
    }
}

/// Bölüm listesi. Yalnız bu kiracının bölümleri, sıra numarasına göre.
pub async fn list_zones(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<FloorZone>, String> {
    let satirlar = sqlx::query(
        "SELECT id, name, sort_order, is_active
           FROM floor_zones
          WHERE tenant_id = ?
          ORDER BY sort_order ASC, id ASC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    satirlar
        .into_iter()
        .map(|satir| {
            Ok(FloorZone {
                id: satir
                    .try_get::<String, _>("id")
                    .map_err(|e| e.to_string())?,
                name: satir
                    .try_get::<String, _>("name")
                    .map_err(|e| e.to_string())?,
                sort_order: satir
                    .try_get::<i64, _>("sort_order")
                    .map_err(|e| e.to_string())?,
                is_active: satir
                    .try_get::<i64, _>("is_active")
                    .map_err(|e| e.to_string())?
                    != 0,
            })
        })
        .collect()
}

/// Masaların kroki geometrisi. Bölüm filtresi verilirse yalnız o bölüm,
/// verilmezse kiracının tüm masaları döner.
pub async fn list_layout_tables(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    zone_id: Option<&str>,
) -> Result<Vec<LayoutTable>, String> {
    // Bölüm filtresi SQL'e bind edilir; string birleştirme ile sorgu
    // biçimlendirme yapılmaz.
    let mut sql = String::from(
        "SELECT id, name, status, x, y, rotation, seats, zone, current_total
           FROM tables
          WHERE tenant_id = ?",
    );
    if zone_id.is_some() {
        sql.push_str(" AND zone = ?");
    }
    sql.push_str(" ORDER BY name ASC, id ASC");

    let mut sorgu = sqlx::query(&sql).bind(tenant_id);
    if let Some(bolum) = zone_id {
        sorgu = sorgu.bind(bolum);
    }

    let satirlar = sorgu
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    satirlar
        .into_iter()
        .map(|satir| {
            Ok(LayoutTable {
                id: satir
                    .try_get::<String, _>("id")
                    .map_err(|e| e.to_string())?,
                name: satir
                    .try_get::<String, _>("name")
                    .map_err(|e| e.to_string())?,
                status: satir
                    .try_get::<String, _>("status")
                    .map_err(|e| e.to_string())?,
                x: satir.try_get::<i64, _>("x").map_err(|e| e.to_string())?,
                y: satir.try_get::<i64, _>("y").map_err(|e| e.to_string())?,
                rotation: satir
                    .try_get::<i64, _>("rotation")
                    .map_err(|e| e.to_string())?,
                seats: satir
                    .try_get::<i64, _>("seats")
                    .map_err(|e| e.to_string())?,
                zone_id: satir
                    .try_get::<Option<String>, _>("zone")
                    .map_err(|e| e.to_string())?,
                current_total_cents: satir
                    .try_get::<i64, _>("current_total")
                    .map_err(|e| e.to_string())?,
            })
        })
        .collect()
}

/// Mimari objeler. Bölüm filtresi tıpkı masada olduğu gibi bind edilir.
pub async fn list_objects(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    zone_id: Option<&str>,
) -> Result<Vec<FloorObject>, String> {
    let mut sql = String::from(
        "SELECT id, zone_id, kind, label, x, y, width, height, rotation, is_active
           FROM floor_objects
          WHERE tenant_id = ?",
    );
    if zone_id.is_some() {
        sql.push_str(" AND zone_id = ?");
    }
    sql.push_str(" ORDER BY kind ASC, id ASC");

    let mut sorgu = sqlx::query(&sql).bind(tenant_id);
    if let Some(bolum) = zone_id {
        sorgu = sorgu.bind(bolum);
    }

    let satirlar = sorgu
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    satirlar
        .into_iter()
        .map(|satir| {
            Ok(FloorObject {
                id: satir
                    .try_get::<String, _>("id")
                    .map_err(|e| e.to_string())?,
                zone_id: satir
                    .try_get::<Option<String>, _>("zone_id")
                    .map_err(|e| e.to_string())?,
                kind: satir
                    .try_get::<String, _>("kind")
                    .map_err(|e| e.to_string())?,
                label: satir
                    .try_get::<Option<String>, _>("label")
                    .map_err(|e| e.to_string())?,
                x: satir.try_get::<i64, _>("x").map_err(|e| e.to_string())?,
                y: satir.try_get::<i64, _>("y").map_err(|e| e.to_string())?,
                width: satir
                    .try_get::<i64, _>("width")
                    .map_err(|e| e.to_string())?,
                height: satir
                    .try_get::<i64, _>("height")
                    .map_err(|e| e.to_string())?,
                rotation: satir
                    .try_get::<i64, _>("rotation")
                    .map_err(|e| e.to_string())?,
                is_active: satir
                    .try_get::<i64, _>("is_active")
                    .map_err(|e| e.to_string())?
                    != 0,
            })
        })
        .collect()
}

/// Krokinin tamamını tek okumada döner. Frontend üç ayrı çağrıyla üç ayrı
/// anlık görüntü görür ve aralarına başka bir yazma girerse kroki
/// tutarsız çizilir.
pub async fn get_layout(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    zone_id: Option<&str>,
) -> Result<FloorLayout, String> {
    let zones = list_zones(conn, tenant_id).await?;
    let tables = list_layout_tables(conn, tenant_id, zone_id).await?;
    let objects = list_objects(conn, tenant_id, zone_id).await?;
    Ok(FloorLayout {
        zones,
        tables,
        objects,
        canvas_width: CANVAS_WIDTH,
        canvas_height: CANVAS_HEIGHT,
        grid: GRID,
        rotation_step: ROTATION_STEP,
    })
}

/// Düzeni kaydeder. Çağıran zaten `BEGIN IMMEDIATE` açmış olmalıdır.
pub async fn save_layout(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    giris: &SaveLayoutInput,
) -> Result<(), String> {
    // Tüm doğrulama yazmadan **önce** biter: geç bir masa geçersizse önceki
    // masaların yazılmış olması, kullanıcı "yarım kaydedildi" izlenimi
    // yaşamasına yol açar.
    for yerlesim in &giris.tables {
        validate_table_placement(yerlesim)?;
    }
    for yerlesim in &giris.objects {
        validate_object_placement(yerlesim)?;
    }

    // Bölüm referansları da yazmadan önce doğrulanır.
    for yerlesim in &giris.tables {
        if let Some(bolum) = &yerlesim.zone_id {
            zone_belongs_to_tenant(conn, tenant_id, bolum).await?;
        }
    }
    for yerlesim in &giris.objects {
        if let Some(bolum) = &yerlesim.zone_id {
            zone_belongs_to_tenant(conn, tenant_id, bolum).await?;
        }
    }

    for yerlesim in &giris.tables {
        let table_id = require_key(&yerlesim.table_id)?;
        let sonuc = sqlx::query(
            "UPDATE tables
                SET x = ?, y = ?, rotation = ?, seats = ?, zone = ?
              WHERE id = ? AND tenant_id = ?",
        )
        .bind(yerlesim.x)
        .bind(yerlesim.y)
        .bind(yerlesim.rotation)
        .bind(yerlesim.seats)
        .bind(yerlesim.zone_id.as_deref())
        .bind(&table_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        // Satır yoksa ya da başka kiracının masasıysa 0 etkilenir. Sessizce
        // geçmek, kullanıcının çizdiği masa kaydedilmedi demesine yol açar.
        if sonuc.rows_affected() == 0 {
            return Err(format!("NOT_FOUND: masa bulunamadı ({table_id})"));
        }
    }

    for yerlesim in &giris.objects {
        let object_id = require_key(&yerlesim.object_id)?;
        let sonuc = sqlx::query(
            "UPDATE floor_objects
                SET zone_id = ?, kind = ?, label = ?, x = ?, y = ?,
                    width = ?, height = ?, rotation = ?, updated_at = ?
              WHERE id = ? AND tenant_id = ?",
        )
        .bind(yerlesim.zone_id.as_deref())
        .bind(&yerlesim.kind)
        .bind(yerlesim.label.as_deref())
        .bind(yerlesim.x)
        .bind(yerlesim.y)
        .bind(yerlesim.width)
        .bind(yerlesim.height)
        .bind(yerlesim.rotation)
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(&object_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        if sonuc.rows_affected() == 0 {
            return Err(format!("NOT_FOUND: obje bulunamadı ({object_id})"));
        }
    }

    Ok(())
}

/// Yeni bölüm açar. Aynı adlı aktif bölüm varsa çakışma hatası verilir:
/// iki "Ana Salon" bölümü kullanıcıyı hangisine çizdiğini ayırt etme
/// zorunda bırakır.
pub async fn create_zone(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    name: &str,
    sort_order: i64,
) -> Result<String, String> {
    let temiz = name.trim();
    if temiz.is_empty() {
        return Err("VALIDATION: bölüm adı boş olamaz".into());
    }

    let ayni_ad: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM floor_zones WHERE tenant_id = ? AND name = ?")
            .bind(tenant_id)
            .bind(temiz)
            .fetch_one(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    if ayni_ad > 0 {
        return Err("CONFLICT: bu isimde bir bölüm zaten var".into());
    }

    let id = generate_id("zone");
    let simdi = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO floor_zones
            (id, tenant_id, name, sort_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(temiz)
    .bind(sort_order)
    .bind(&simdi)
    .bind(&simdi)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

/// Bölümü kaldırır. Bölüme bağlı masalar silinmez; yalnız `zone` bağlantısı
/// düşer, çünkü masa kaydı salonun gerçek varlığıdır ve kroki düzeninden
/// bağımsız olarak yaşamaya devam eder.
pub async fn delete_zone(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    zone_id: &str,
) -> Result<(), String> {
    let sonuc = sqlx::query("DELETE FROM floor_zones WHERE id = ? AND tenant_id = ?")
        .bind(zone_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    if sonuc.rows_affected() == 0 {
        return Err("NOT_FOUND: bölüm bulunamadı".into());
    }

    sqlx::query("UPDATE tables SET zone = NULL WHERE tenant_id = ? AND zone = ?")
        .bind(tenant_id)
        .bind(zone_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("UPDATE floor_objects SET zone_id = NULL WHERE tenant_id = ? AND zone_id = ?")
        .bind(tenant_id)
        .bind(zone_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
