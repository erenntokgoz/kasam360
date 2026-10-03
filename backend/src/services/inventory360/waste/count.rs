use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use crate::id_generator::generate_id;
use crate::management_commands::ensure_owned;
use crate::services::inventory360::{optional_f64, optional_i64, optional_text};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StockCountLine {
    pub product_id: String,
    pub product_name: String,
    pub counted_quantity: f64,
    /// Kapanışta dolar. Kapanmamış sayımda `None`'dur — beklenen miktar
    /// sayım sırasında **gösterilmez**.
    pub expected_quantity: Option<f64>,
    pub variance_quantity: Option<f64>,
    pub variance_cost_cents: Option<i64>,
    pub counted_by: Option<String>,
    pub counted_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StockCount {
    pub id: String,
    pub status: String,
    pub location: Option<String>,
    pub started_by: String,
    pub started_at: String,
    pub closed_by: Option<String>,
    pub closed_at: Option<String>,
    pub notes: Option<String>,
    pub lines: Vec<StockCountLine>,
}

/// Kör sayım açar. Satırlar **boş** başlar: beklenen miktar hiç yüklenmez.
pub async fn open_stock_count(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    location: Option<String>,
    notes: Option<String>,
) -> Result<StockCount, String> {
    let acik: Option<String> = sqlx::query_scalar(
        "SELECT id FROM stock_counts WHERE tenant_id = ? AND status = 'ACIK' LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if acik.is_some() {
        return Err("CONFLICT: açık bir sayım zaten var, önce onu kapat".into());
    }

    let id = generate_id("sct");
    let started_at = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO stock_counts (id, tenant_id, status, location, started_by, started_at, notes)
         VALUES (?, ?, 'ACIK', ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(&location)
    .bind(actor_id)
    .bind(&started_at)
    .bind(&notes)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(StockCount {
        id,
        status: "ACIK".to_string(),
        location,
        started_by: actor_id.to_string(),
        started_at,
        closed_by: None,
        closed_at: None,
        notes,
        lines: Vec::new(),
    })
}

pub async fn record_count_line(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    stock_count_id: &str,
    product_id: &str,
    counted_quantity: f64,
    counted_by: &str,
) -> Result<(), String> {
    ensure_owned(conn, "stock_counts", stock_count_id, tenant_id).await?;
    ensure_owned(conn, "products", product_id, tenant_id).await?;

    if !(counted_quantity.is_finite() && counted_quantity >= 0.0) {
        return Err("VALIDATION: sayılan miktar negatif veya sayı değil olamaz".into());
    }

    let status: String =
        sqlx::query_scalar("SELECT status FROM stock_counts WHERE id = ? AND tenant_id = ?")
            .bind(stock_count_id)
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "NOT_FOUND: sayım bulunamadı".to_string())?;
    if status != "ACIK" {
        return Err(format!(
            "CONFLICT: sayım {status} durumunda, kapalı sayıma satır girilemez"
        ));
    }

    sqlx::query(
        "INSERT INTO stock_count_lines
             (id, tenant_id, stock_count_id, product_id, counted_quantity,
              counted_by, counted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, stock_count_id, product_id)
         DO UPDATE SET counted_quantity = excluded.counted_quantity,
                       counted_by = excluded.counted_by,
                       counted_at = excluded.counted_at",
    )
    .bind(generate_id("scl"))
    .bind(tenant_id)
    .bind(stock_count_id)
    .bind(product_id)
    .bind(counted_quantity)
    .bind(counted_by)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Sayımı kapatır: beklenen miktar hesaplanır, fark maliyeti düşülür ve
/// stok miktarları sayılan değere ayarlanır.
///
/// Kapanışta beklenen miktar `products.stock_quantity` üzerinden okunur. Bu
/// değer partilerin toplamıyla tutarsızsa (parti hareketi `stock_quantity`'yi
/// güncellemediyse) fark hesabı yanlış olur; bu yüzden beklenen miktar partilerden
/// türetilir, ürün kolonundan değil. Ürün kolonu yalnız parti yoksa kullanılır ve
/// bu durum `expected_from` alanında belirtilir.
///
/// Ne parti ne ürün kolonu yoksa beklenen miktar `None` kalır (bilinmiyor) ve
/// fark hesaplanmaz; sıfır kabul etmek sayımın değerini uydurur.
///
/// Kapanış tek yazma değil: her satır için fark hesabı, ürün kolonu
/// düzeltmesi ve `stock_movements` kaydı yazılır. Bu yüzden çağıran komut
/// `BEGIN IMMEDIATE` ile sarar; hata olursa hiçbiri yazılmaz ve stok ile
/// hareket defteri yarım kalmış sayımda tutmaz.
pub async fn close_stock_count(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    stock_count_id: &str,
    actor_id: &str,
    apply_adjustment: bool,
) -> Result<StockCount, String> {
    ensure_owned(conn, "stock_counts", stock_count_id, tenant_id).await?;

    let status: String =
        sqlx::query_scalar("SELECT status FROM stock_counts WHERE id = ? AND tenant_id = ?")
            .bind(stock_count_id)
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "NOT_FOUND: sayım bulunamadı".to_string())?;
    if status != "ACIK" {
        return Err(format!("CONFLICT: sayım zaten {status} durumunda"));
    }

    let satirlar = sqlx::query(
        "SELECT id, product_id, counted_quantity
           FROM stock_count_lines
          WHERE tenant_id = ? AND stock_count_id = ?",
    )
    .bind(tenant_id)
    .bind(stock_count_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if satirlar.is_empty() {
        return Err("VALIDATION: en az bir satır sayılmadan sayım kapatılamaz".into());
    }

    let mut lines = Vec::new();
    for satir in &satirlar {
        let satir_id: String = satir.try_get("id").map_err(|e| e.to_string())?;
        let product_id: String = satir.try_get("product_id").map_err(|e| e.to_string())?;
        let counted: f64 = satir
            .try_get("counted_quantity")
            .map_err(|e| e.to_string())?;

        // Beklenen miktar partilerden türetilir: `stock_quantity` kolonu bazı
        // yollarda güncellenmediği için tek başına güvenilir değildir.
        // `CAST` şart: `stock_quantity` kolonu INTEGER'dır ve sqlx tam sayı
        // sütunu `f64` olarak okumayı reddeder.
        let parti_toplam: Option<f64> = sqlx::query_scalar(
            "SELECT CAST(SUM(remaining_quantity) AS REAL) FROM inventory_batches
              WHERE tenant_id = ? AND product_id = ?",
        )
        .bind(tenant_id)
        .bind(&product_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        // Parti yoksa ürün kolonuna düşülür. Kolon da NULL ise beklenen miktar
        // **bilinmiyor** demektir, sıfır değil: `stock_quantity` nullable'dır ve
        // hiç stok hareketi görmemiş üründe NULL kalır. Sıfır yazmak "stokta hiç
        // bir şey yok" der; o zaman ilk kör sayımda sayılan malın tamamı fazla
        // stok olarak görünür ve sayım farkı şişerek denetim defterine yalan
        // yazar. Bilinmeyen miktar `None` kalır, fark hesaplanmaz.
        //
        // `fetch_one` seçimi bilinçli: `sqlx`'te `query_scalar::<Option<T>>` ile
        // `fetch_optional` NULL sütunu `Some(0)` döndürür (bkz. `support.rs`
        // notu). `fetch_one` NULL'u `None` olarak döndürür, `Row::try_get` de
        // öyle. Satır `id` tekil olduğu için her zaman vardır.
        let urun_stogu: Option<f64> = sqlx::query_scalar(
            "SELECT CAST(stock_quantity AS REAL) FROM products WHERE id = ? AND tenant_id = ?",
        )
        .bind(&product_id)
        .bind(tenant_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        let (expected, beklenen_kaynak) = match parti_toplam {
            Some(deger) => (Some(deger), "parti"),
            None => (urun_stogu, "urun_kolonu"),
        };

        let variance = expected.map(|deger| counted - deger);

        // Fark maliyeti: fark sıfır değilse ve maliyet biliniyorsa hesaplanır.
        // Maliyet bilinmiyorsa `None` — sahte sıfır fark maliyeti yazılmaz.
        let variance_cost = match variance {
            None => None,
            Some(fark) if fark.abs() <= f64::EPSILON => Some(0i64),
            Some(fark) => {
                let unit_cost: Option<i64> = sqlx::query_scalar(
                    "SELECT unit_cost_cents FROM inventory_batches
                      WHERE tenant_id = ? AND product_id = ? AND remaining_quantity > 0
                      ORDER BY received_at DESC, id DESC LIMIT 1",
                )
                .bind(tenant_id)
                .bind(&product_id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
                unit_cost.map(|cost| (cost as f64 * fark).round() as i64)
            }
        };

        sqlx::query(
            "UPDATE stock_count_lines
                SET expected_quantity = ?, variance_quantity = ?, variance_cost_cents = ?,
                    adjustment_applied = ?
              WHERE id = ? AND tenant_id = ?",
        )
        .bind(expected)
        .bind(variance)
        .bind(variance_cost)
        .bind(apply_adjustment)
        .bind(&satir_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        // Beklenen miktar bilinmiyorsa fark hesaplanamaz ve stok düzeltmesi
        // yazılamaz: kolonu sayılan değere çekmek farkı bilinmeden düzeltme
        // uydurur, hareket defteri de kaymış miktarı yazamaz.
        if apply_adjustment {
            if let Some(fark) = variance {
                // Stok farkı düzeltmesi: ürün kolonu sayılan değere çekilir.
                // Pozitif fark (eşya fazlası) bir maliyet değil, envanter fazlasıdır;
                // bu yüzden yeni parti **açılmaz**, yalnız kolon güncellenir ve fark
                // maliyeti negatif (kar) olarak raporlanır.
                sqlx::query("UPDATE products SET stock_quantity = ? WHERE id = ? AND tenant_id = ?")
                    .bind(counted)
                    .bind(&product_id)
                    .bind(tenant_id)
                    .execute(&mut *conn)
                    .await
                    .map_err(|e| e.to_string())?;

                sqlx::query(
                    "INSERT INTO stock_movements
                         (id, tenant_id, inventory_item_id, product_id, movement_type,
                          quantity, actor_id, reason)
                     VALUES (?, ?, NULL, ?, 'ADJUST', ?, ?, ?)",
                )
                .bind(generate_id("smv"))
                .bind(tenant_id)
                .bind(&product_id)
                .bind(fark)
                .bind(actor_id)
                .bind(format!(
                    "kör sayım farkı: beklenen {beklenen_kaynak} {}, sayılan {counted}",
                    expected.unwrap_or(0.0)
                ))
                .execute(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
            }
        }

        let product_name: String =
            sqlx::query_scalar("SELECT name FROM products WHERE id = ? AND tenant_id = ?")
                .bind(&product_id)
                .bind(tenant_id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| e.to_string())?
                .unwrap_or_else(|| "ürün silinmiş".to_string());

        lines.push(StockCountLine {
            product_id,
            product_name,
            counted_quantity: counted,
            expected_quantity: expected,
            variance_quantity: variance,
            variance_cost_cents: variance_cost,
            counted_by: Some(actor_id.to_string()),
            counted_at: Some(chrono::Utc::now().to_rfc3339()),
        });
    }

    let closed_at = chrono::Utc::now().to_rfc3339();
    let new_status = if apply_adjustment {
        "UYGULANDI"
    } else {
        "KAPALI"
    };
    sqlx::query(
        "UPDATE stock_counts SET status = ?, closed_by = ?, closed_at = ? WHERE id = ? AND tenant_id = ?",
    )
    .bind(new_status)
    .bind(actor_id)
    .bind(&closed_at)
    .bind(stock_count_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // Nullable metin kolonları `optional_text` ile okunur: `query_scalar::<Option<String>>`
    // + `fetch_optional` NULL'u `Some("")` döndürür ve kapanış yanıtı ile
    // `get_stock_count` okuma yolu birbirinden ayrışır.
    let satir = sqlx::query(
        "SELECT location, started_by, started_at, notes FROM stock_counts
          WHERE id = ? AND tenant_id = ?",
    )
    .bind(stock_count_id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let location = optional_text(&satir, "location")?;
    let started_by: String = satir
        .try_get("started_by")
        .map_err(|e| e.to_string())?;
    let started_at: String = satir
        .try_get("started_at")
        .map_err(|e| e.to_string())?;
    let notes = optional_text(&satir, "notes")?;

    let sonuc = StockCount {
        id: stock_count_id.to_string(),
        status: new_status.to_string(),
        location,
        started_by,
        started_at,
        closed_by: Some(actor_id.to_string()),
        closed_at: Some(closed_at),
        notes,
        lines,
    };
    Ok(sonuc)
}

pub async fn list_stock_counts(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<StockCount>, String> {
    let rows = sqlx::query(
        "SELECT id, status, location, started_by, started_at, closed_by, closed_at, notes
           FROM stock_counts
          WHERE tenant_id = ?
          ORDER BY started_at DESC
          LIMIT 200",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        let id: String = row.try_get("id").map_err(|e| e.to_string())?;
        result.push(StockCount {
            id: id.clone(),
            status: row.try_get("status").map_err(|e| e.to_string())?,
            location: optional_text(&row, "location")?,
            started_by: row.try_get("started_by").map_err(|e| e.to_string())?,
            started_at: row.try_get("started_at").map_err(|e| e.to_string())?,
            closed_by: optional_text(&row, "closed_by")?,
            closed_at: optional_text(&row, "closed_at")?,
            notes: optional_text(&row, "notes")?,
            lines: load_count_lines(conn, tenant_id, &id).await?,
        });
    }
    Ok(result)
}

pub async fn get_stock_count(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    stock_count_id: &str,
) -> Result<StockCount, String> {
    let row = sqlx::query(
        "SELECT id, status, location, started_by, started_at, closed_by, closed_at, notes
           FROM stock_counts
          WHERE id = ? AND tenant_id = ?",
    )
    .bind(stock_count_id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "NOT_FOUND: sayım bulunamadı".to_string())?;

    Ok(StockCount {
        id: row.try_get("id").map_err(|e| e.to_string())?,
        status: row.try_get("status").map_err(|e| e.to_string())?,
        location: optional_text(&row, "location")?,
        started_by: row.try_get("started_by").map_err(|e| e.to_string())?,
        started_at: row.try_get("started_at").map_err(|e| e.to_string())?,
        closed_by: optional_text(&row, "closed_by")?,
        closed_at: optional_text(&row, "closed_at")?,
        notes: optional_text(&row, "notes")?,
        lines: load_count_lines(conn, tenant_id, stock_count_id).await?,
    })
}

async fn load_count_lines(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    stock_count_id: &str,
) -> Result<Vec<StockCountLine>, String> {
    let rows = sqlx::query(
        "SELECT l.product_id, p.name AS product_name, l.counted_quantity,
                l.expected_quantity, l.variance_quantity, l.variance_cost_cents,
                l.counted_by, l.counted_at
           FROM stock_count_lines l
           LEFT JOIN products p ON p.id = l.product_id AND p.tenant_id = l.tenant_id
          WHERE l.tenant_id = ? AND l.stock_count_id = ?
          ORDER BY p.name ASC",
    )
    .bind(tenant_id)
    .bind(stock_count_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(StockCountLine {
            product_id: row.try_get("product_id").map_err(|e| e.to_string())?,
            product_name: row
                .try_get::<Option<String>, _>("product_name")
                .map_err(|e| e.to_string())?
                .unwrap_or_else(|| "ürün silinmiş".to_string()),
            counted_quantity: row.try_get("counted_quantity").map_err(|e| e.to_string())?,
            expected_quantity: optional_f64(&row, "expected_quantity")?,
            variance_quantity: optional_f64(&row, "variance_quantity")?,
            variance_cost_cents: optional_i64(&row, "variance_cost_cents")?,
            counted_by: optional_text(&row, "counted_by")?,
            counted_at: optional_text(&row, "counted_at")?,
        });
    }
    Ok(result)
}
