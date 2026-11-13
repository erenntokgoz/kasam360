//! Fire için FIFO düşümü ve parti iadesi.
//!
//! Neden ayrı dosya: kayıt, düzeltme ve iptal aynı parti hesabını paylaşır. Düşümün
//! hangi partiden hangi maliyetle yapıldığı `waste_allocations` tablosunda tutulur;
//! iptal stoğu ortalamayla değil, düşüldüğü partilere gerçek maliyetiyle geri koyar.

use sqlx::{Row, SqliteConnection};

use crate::id_generator::generate_id;
use crate::services::inventory360::quantity_cost::line_cost_cents;

/// Kayan nokta artığı: bundan küçük kalan miktar sıfır sayılır.
const MIKTAR_TOLERANSI: f64 = 1e-9;

/// Eldeki partilerden FIFO ile düşer; dağılımı kaydeder ve toplam maliyeti (kuruş) döner.
///
/// Stoğu aşan talepte ilk partiye bile dokunulmaz.
pub(super) async fn consume_fifo(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    product_id: &str,
    quantity: f64,
    waste_id: &str,
) -> Result<i64, String> {
    let partiler = sqlx::query(
        "SELECT id, remaining_quantity, unit_cost_cents
           FROM inventory_batches
          WHERE tenant_id = ? AND product_id = ? AND remaining_quantity > 0
          ORDER BY received_at ASC, id ASC",
    )
    .bind(tenant_id)
    .bind(product_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let available = partiler
        .iter()
        .try_fold(0.0, |sum, row| {
            row.try_get::<f64, _>("remaining_quantity")
                .map(|value| sum + value)
        })
        .map_err(|e| e.to_string())?;
    if available <= 0.0 || quantity - available > f64::EPSILON * quantity {
        return Err("VALIDATION: Fire miktarı eldeki stoğu aşıyor.".into());
    }

    let mut kalan = quantity;
    let mut maliyet: i64 = 0;
    for parti in &partiler {
        if kalan <= 0.0 {
            break;
        }
        let parti_id: String = parti.try_get("id").map_err(|e| e.to_string())?;
        let parti_kalan: f64 = parti
            .try_get("remaining_quantity")
            .map_err(|e| e.to_string())?;
        let parti_maliyet: i64 = parti
            .try_get("unit_cost_cents")
            .map_err(|e| e.to_string())?;

        let dusulen = kalan.min(parti_kalan);
        maliyet = maliyet
            .checked_add(line_cost_cents(parti_maliyet, dusulen)?)
            .ok_or_else(|| "OVERFLOW: fire maliyeti taştı".to_string())?;

        sqlx::query(
            "UPDATE inventory_batches SET remaining_quantity = ?
              WHERE id = ? AND tenant_id = ?",
        )
        .bind(parti_kalan - dusulen)
        .bind(&parti_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        sqlx::query(
            "INSERT INTO waste_allocations
                 (id, tenant_id, waste_id, product_id, batch_id, quantity, unit_cost_cents)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(generate_id("wal"))
        .bind(tenant_id)
        .bind(waste_id)
        .bind(product_id)
        .bind(&parti_id)
        .bind(dusulen)
        .bind(parti_maliyet)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        kalan -= dusulen;
    }
    Ok(maliyet)
}

/// Fire miktarının bir kısmını (veya tamamını) partilere geri koyar; iade edilen
/// maliyeti (kuruş) döner.
///
/// Sıra düşümün tersidir: en son düşülen dağılım önce geri döner. Dağılımı
/// kaydedilmemiş eski kayıt için `legacy_unit_cost_cents` ile yeni bir iade partisi
/// açılır; maliyet bilinmiyorsa uydurulmaz ve işlem reddedilir.
pub(super) async fn return_to_batches(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    waste_id: &str,
    product_id: &str,
    quantity: f64,
    legacy_unit_cost_cents: Option<i64>,
) -> Result<i64, String> {
    let dagilimlar = sqlx::query(
        "SELECT id, batch_id, quantity, unit_cost_cents
           FROM waste_allocations
          WHERE tenant_id = ? AND waste_id = ? AND product_id = ?
          ORDER BY rowid DESC",
    )
    .bind(tenant_id)
    .bind(waste_id)
    .bind(product_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut kalan = quantity;
    let mut iade_maliyet: i64 = 0;
    for dagilim in &dagilimlar {
        if kalan <= MIKTAR_TOLERANSI {
            break;
        }
        let dagilim_id: String = dagilim.try_get("id").map_err(|e| e.to_string())?;
        let parti_id: String = dagilim.try_get("batch_id").map_err(|e| e.to_string())?;
        let dagilim_miktar: f64 = dagilim.try_get("quantity").map_err(|e| e.to_string())?;
        let birim_maliyet: i64 = dagilim
            .try_get("unit_cost_cents")
            .map_err(|e| e.to_string())?;

        let iade = kalan.min(dagilim_miktar);
        iade_maliyet = iade_maliyet
            .checked_add(line_cost_cents(birim_maliyet, iade)?)
            .ok_or_else(|| "OVERFLOW: fire maliyeti taştı".to_string())?;

        let guncellenen = sqlx::query(
            "UPDATE inventory_batches SET remaining_quantity = remaining_quantity + ?
              WHERE id = ? AND tenant_id = ?",
        )
        .bind(iade)
        .bind(&parti_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?
        .rows_affected();
        if guncellenen == 0 {
            // Parti sonradan kaldırılmış: stok yine de kaybolmaz, aynı maliyetle yeni parti.
            open_return_batch(conn, tenant_id, product_id, iade, birim_maliyet).await?;
        }

        if iade >= dagilim_miktar {
            sqlx::query("DELETE FROM waste_allocations WHERE id = ? AND tenant_id = ?")
                .bind(&dagilim_id)
                .bind(tenant_id)
                .execute(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
        } else {
            sqlx::query("UPDATE waste_allocations SET quantity = ? WHERE id = ? AND tenant_id = ?")
                .bind(dagilim_miktar - iade)
                .bind(&dagilim_id)
                .bind(tenant_id)
                .execute(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
        }
        kalan -= iade;
    }

    if kalan > MIKTAR_TOLERANSI {
        let birim_maliyet = legacy_unit_cost_cents.ok_or_else(|| {
            "VALIDATION: Bu fire kaydının parti dağılımı ve maliyeti bilinmiyor, geri alınamaz."
                .to_string()
        })?;
        iade_maliyet = iade_maliyet
            .checked_add(line_cost_cents(birim_maliyet, kalan)?)
            .ok_or_else(|| "OVERFLOW: fire maliyeti taştı".to_string())?;
        open_return_batch(conn, tenant_id, product_id, kalan, birim_maliyet).await?;
    }
    Ok(iade_maliyet)
}

async fn open_return_batch(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    product_id: &str,
    quantity: f64,
    unit_cost_cents: i64,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO inventory_batches
             (id, tenant_id, product_id, batch_code, initial_quantity,
              remaining_quantity, unit_cost_cents)
         VALUES (?1, ?2, ?3, 'FIRE-IADE', ?4, ?4, ?5)",
    )
    .bind(generate_id("bat"))
    .bind(tenant_id)
    .bind(product_id)
    .bind(quantity)
    .bind(unit_cost_cents)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}
