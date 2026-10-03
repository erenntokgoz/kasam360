//! Fire (zayi) kaydı ve kör sayım (Spec §2.12).
//!
//! Neden ayrı tablo: `stock_movements` stok hareketini kaydeder ama firein
//! **gerekçesini** tutmaz. Bozulan malzeme ile sayım hatası aynı muhasebe
//! satırına girerse, zararın kaynağı görülemez ve önlem alınamaz.
//!
//! Kör sayım kuralı: sayım satırında **beklenen miktar tutulmaz**. Beklenen
//! değeri gören kişi kendi ölçümüne göre yazmaz; sayımın değeri kaybolur.
//! Beklenen miktar yalnız kapanışta hesaplanır ve fark olarak denetim defterine
//! yazılır.

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use crate::id_generator::generate_id;
use crate::management_commands::ensure_owned;
use crate::services::inventory360::{optional_i64, optional_text};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct WasteRecord {
    pub id: String,
    pub product_id: String,
    pub product_name: String,
    pub reason: String,
    pub quantity: f64,
    /// Partilerden çözülen birim maliyet (kuruş). `None` = maliyet bilinmiyor;
    /// sıfır değildir (AGENTS.md §3.4).
    pub unit_cost_cents: Option<i64>,
    /// Fire tutarı (kuruş). `None` = maliyet bilinmiyor.
    pub total_cost_cents: Option<i64>,
    pub occurred_at: String,
    pub recorded_by: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasteInput {
    pub product_id: String,
    pub reason: String,
    pub quantity: f64,
    pub occurred_at: Option<String>,
    pub notes: Option<String>,
}

const GECERLI_GEREKCELER: [&str; 6] = [
    "BOZULDU",
    "RAF_OMRU_DOLDU",
    "KIRILDI",
    "SIZINTI",
    "HATA_GIRIS",
    "FIRE_EDILDI",
];

pub async fn record_waste(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    input: WasteInput,
) -> Result<WasteRecord, String> {
    if !GECERLI_GEREKCELER.contains(&input.reason.as_str()) {
        return Err(format!(
            "VALIDATION: fire gerekçesi geçersiz, izin verilenler: {}",
            GECERLI_GEREKCELER.join(", ")
        ));
    }
    if !(input.quantity.is_finite() && input.quantity > 0.0) {
        return Err("VALIDATION: fire miktarı sıfırdan büyük olmalı".into());
    }
    ensure_owned(conn, "products", &input.product_id, tenant_id).await?;

    let product_name: String =
        sqlx::query_scalar("SELECT name FROM products WHERE id = ? AND tenant_id = ?")
            .bind(&input.product_id)
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "NOT_FOUND: ürün bulunamadı".to_string())?;

    let occurred_at = input
        .occurred_at
        .clone()
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    // FIFO'dan düş: en eski partiden başlayarak miktarı karşıla. Gerçek
    // maliyet partilerden gelir; parti yoksa maliyet bilinmiyor olarak kalır.
    let mut kalan = input.quantity;
    let mut maliyet: Option<i64> = Some(0.0_f64).map(|v| v as i64);
    let mut maliyet_bilinmiyor = false;

    let partiler = sqlx::query(
        "SELECT id, remaining_quantity, unit_cost_cents
           FROM inventory_batches
          WHERE tenant_id = ? AND product_id = ? AND remaining_quantity > 0
          ORDER BY received_at ASC, id ASC",
    )
    .bind(tenant_id)
    .bind(&input.product_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    for parti in &partiler {
        if kalan <= f64::EPSILON {
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
        let yeni_kalan = parti_kalan - dusulen;

        sqlx::query(
            "UPDATE inventory_batches SET remaining_quantity = ?
              WHERE id = ? AND tenant_id = ?",
        )
        .bind(yeni_kalan)
        .bind(&parti_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        let satir_maliyet = (parti_maliyet as f64 * dusulen).round() as i64;
        maliyet = maliyet.map(|mevcut| mevcut + satir_maliyet);
        kalan -= dusulen;
    }

    // Stoktan fazla fire yazıldıysa kalan miktar karşılanmamıştır. Bu, gerçek
    // bir veri hatasıdır: ya fazla fire girilmiştir ya da stok kaydı eksiktir.
    // Kısmen karşılanan fire reddedilmez ama fark audit'e yazılır.
    let mut iki_kisimli = false;
    if kalan > f64::EPSILON {
        iki_kisimli = true;
        maliyet_bilinmiyor = true;
    }

    let unit_cost_cents = if maliyet_bilinmiyor {
        None
    } else {
        maliyet.map(|toplam| {
            if input.quantity > 0.0 {
                (toplam as f64 / input.quantity).round() as i64
            } else {
                0
            }
        })
    };
    let total_cost_cents = if maliyet_bilinmiyor { None } else { maliyet };

    let id = generate_id("wst");
    sqlx::query(
        "INSERT INTO waste_records
             (id, tenant_id, product_id, reason, quantity, unit_cost_cents,
              total_cost_cents, occurred_at, recorded_by, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(&input.product_id)
    .bind(&input.reason)
    .bind(input.quantity)
    .bind(unit_cost_cents)
    .bind(total_cost_cents)
    .bind(&occurred_at)
    .bind(actor_id)
    .bind(&input.notes)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) - ?
          WHERE id = ? AND tenant_id = ?",
    )
    .bind(input.quantity)
    .bind(&input.product_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(WasteRecord {
        id,
        product_id: input.product_id,
        product_name,
        reason: input.reason,
        quantity: input.quantity,
        unit_cost_cents,
        total_cost_cents,
        occurred_at,
        recorded_by: actor_id.to_string(),
        notes: if iki_kisimli {
            Some(format!(
                "UYARI: stoktan fazla fire girildi, {kalan} birim karşılanamadı"
            ))
        } else {
            input.notes
        },
    })
}

pub async fn list_waste_records(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    limit: Option<i64>,
) -> Result<Vec<WasteRecord>, String> {
    // Rapor sonu sınırsız döngüye girmemeli; sınır yoksa 500 varsayılır.
    let limit = limit.unwrap_or(500).clamp(1, 5000);
    let rows = sqlx::query(
        "SELECT w.id, w.product_id, p.name AS product_name, w.reason, w.quantity,
                w.unit_cost_cents, w.total_cost_cents, w.occurred_at, w.recorded_by, w.notes
           FROM waste_records w
           JOIN products p ON p.id = w.product_id AND p.tenant_id = w.tenant_id
          WHERE w.tenant_id = ?
          ORDER BY w.occurred_at DESC
          LIMIT ?",
    )
    .bind(tenant_id)
    .bind(limit)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(WasteRecord {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            product_id: row.try_get("product_id").map_err(|e| e.to_string())?,
            product_name: row.try_get("product_name").map_err(|e| e.to_string())?,
            reason: row.try_get("reason").map_err(|e| e.to_string())?,
            quantity: row.try_get("quantity").map_err(|e| e.to_string())?,
            unit_cost_cents: optional_i64(&row, "unit_cost_cents")?,
            total_cost_cents: optional_i64(&row, "total_cost_cents")?,
            occurred_at: row.try_get("occurred_at").map_err(|e| e.to_string())?,
            recorded_by: row.try_get("recorded_by").map_err(|e| e.to_string())?,
            notes: optional_text(&row, "notes")?,
        });
    }
    Ok(result)
}
