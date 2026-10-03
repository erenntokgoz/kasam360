use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use crate::management_commands::ensure_owned;

// ---------------------------------------------------------------------------
// TOPLU FİYAT GÜNCELLEME
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BulkPriceChange {
    pub product_id: String,
    pub product_name: String,
    pub old_price_cents: i64,
    pub new_price_cents: i64,
    /// Dondurma nedeniyle değişmeyen ürünler. Sessizce atlanmaz, raporda
    /// listelenir.
    pub skipped: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BulkPriceResult {
    pub changed: Vec<BulkPriceChange>,
    pub skipped: Vec<BulkPriceChange>,
    pub category_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkPriceInput {
    pub category_id: Option<String>,
    pub product_ids: Option<Vec<String>>,
    /// Yüzde değişim. Negatif indirim, pozitif zam. `None` ise `by_cents`.
    pub percent: Option<f64>,
    /// Mutlak kuruş değişimi. Negatif olamaz; indirim `percent` ile yapılır.
    pub by_cents: Option<i64>,
    /// Yuvarlama: fiyatlar on kuruşa yuvarlanır (50 kuruş → 50, 55 → 60).
    pub round_to_tens: Option<bool>,
}

/// Toplu fiyat güncelleme.
///
/// Negative modifier fiyat engeliyle aynı gerekçe: yuvarlama veya yüzde
/// hesabı sonucu negatif fiyat üretirse ürün bedava verilir. Negatif sonuç
/// reddedilir, sıfıra kırpılmaz.
pub async fn bulk_update_prices(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    input: BulkPriceInput,
) -> Result<BulkPriceResult, String> {
    let mut urunler: Vec<(String, String, i64)> = Vec::new();

    match (&input.category_id, &input.product_ids) {
        (Some(_), Some(_)) => {
            return Err("VALIDATION: kategori ve ürün listesi birlikte verilemez".into())
        }
        (Some(category_id), None) => {
            let rows = sqlx::query(
                "SELECT id, name, price_cents FROM products
                  WHERE tenant_id = ? AND category_id = ? AND is_active = 1",
            )
            .bind(tenant_id)
            .bind(category_id)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            for row in rows {
                urunler.push((
                    row.try_get("id").map_err(|e| e.to_string())?,
                    row.try_get("name").map_err(|e| e.to_string())?,
                    row.try_get("price_cents").map_err(|e| e.to_string())?,
                ));
            }
        }
        (None, Some(ids)) => {
            for id in ids {
                ensure_owned(conn, "products", id, tenant_id).await?;
                let row = sqlx::query(
                    "SELECT id, name, price_cents FROM products WHERE id = ? AND tenant_id = ?",
                )
                .bind(id)
                .bind(tenant_id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "NOT_FOUND: ürün bulunamadı".to_string())?;
                urunler.push((
                    row.try_get("id").map_err(|e| e.to_string())?,
                    row.try_get("name").map_err(|e| e.to_string())?,
                    row.try_get("price_cents").map_err(|e| e.to_string())?,
                ));
            }
        }
        (None, None) => return Err(
            "VALIDATION: kategori ya da ürün listesi zorunlu, tüm menüye körlemesine zam risklidir"
                .into(),
        ),
    }

    let percent = input.percent;
    let by_cents = input.by_cents;
    if percent.is_none() && by_cents.is_none() {
        return Err("VALIDATION: yüzde ya da kuruş değişimi zorunlu".into());
    }
    if by_cents.map(|deger| deger < 0).unwrap_or(false) {
        return Err(
            "VALIDATION: kuruş değişimi negatif olamaz, indirim için yüzde kullanılır".into(),
        );
    }
    if urunler.is_empty() {
        return Err("VALIDATION: güncellenecek ürün bulunamadı".into());
    }

    let mut changed = Vec::new();
    let mut skipped = Vec::new();

    for (id, name, eski) in urunler {
        let mut yeni = match (percent, by_cents) {
            (Some(yuzde), _) => (eski as f64 * (1.0 + yuzde / 100.0)).round() as i64,
            (_, Some(mutlak)) => eski + mutlak,
            // Yukarıda her iki durumun da boş olduğu reddedildi.
            _ => eski,
        };

        if input.round_to_tens.unwrap_or(true) && yeni > 0 {
            // On kuruşa yuvarlama: 155 → 160, 154 → 150. Psikolojik fiyat
            // (199 yerine 200) Türkiye perakendesinde yaygın bir beklentidir.
            yeni = ((yeni + 5) / 10) * 10;
        }

        if yeni < 0 {
            skipped.push(BulkPriceChange {
                product_id: id,
                product_name: name,
                old_price_cents: eski,
                new_price_cents: yeni,
                skipped: Some("hesaplama negatif fiyat üretti, uygulanmadı".into()),
            });
            continue;
        }

        // Fiyat dondurması olan ürün toplu zamdan çıkarılır. Dondurma bir
        // taahhüttür; toplu güncelleme onu sessizce delmemelidir.
        let dondurma: Option<String> = sqlx::query_scalar(
            "SELECT id FROM price_freezes
              WHERE tenant_id = ? AND product_id = ? AND is_active = 1
                AND date('now') BETWEEN valid_from AND valid_to
              LIMIT 1",
        )
        .bind(tenant_id)
        .bind(&id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        if dondurma.is_some() {
            skipped.push(BulkPriceChange {
                product_id: id,
                product_name: name,
                old_price_cents: eski,
                new_price_cents: eski,
                skipped: Some("fiyat dondurma aktif, taahhüt bozulmadı".into()),
            });
            continue;
        }

        sqlx::query("UPDATE products SET price_cents = ? WHERE id = ? AND tenant_id = ?")
            .bind(yeni)
            .bind(&id)
            .bind(tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

        changed.push(BulkPriceChange {
            product_id: id,
            product_name: name,
            old_price_cents: eski,
            new_price_cents: yeni,
            skipped: None,
        });
    }

    Ok(BulkPriceResult {
        changed,
        skipped,
        category_id: input.category_id,
    })
}
