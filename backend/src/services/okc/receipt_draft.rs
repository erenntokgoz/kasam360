//! Tahsilat yükünden yazar kasa fiş taslağı üretir.
//!
//! Neden sunucu fiyatı: kalem tutarları istemciden değil `PaymentRepository::priced_lines`
//! ile tahsilatı doğrulayan aynı hesaptan gelir; fiş toplamı ile tahsilat toplamı
//! ayrışamaz. Kalem indirimleri satır tutarına işlenir; fişte ayrı indirim satırı yoktur.
//!
//! Neden oransal dağıtım: veresiye ile karışık veya yalnız tutara göre alınan parçalı
//! tahsilatta fişe giren tutar kalem toplamından küçüktür. Fark kalemlere, en büyük
//! kalan yöntemiyle kuruş kaybı olmadan dağıtılır. Bu davranış üreticiyle ve mali
//! müşavirle doğrulanmalıdır (docs/contracts/okc-gmp3.md, açık sorular).

use sqlx::{Row, SqliteConnection};

use super::types::{
    OkcError, OkcResult, ReceiptDraft, ReceiptLine, ReceiptPayment, TenderKind, MAX_NAME_CHARS,
};
use crate::commands::{CartItemDto, PaymentPayloadDto};
use crate::repositories::payment_repository::PaymentRepository;

/// `target` kuruşu `weights` oranında dağıtır; toplam her zaman tam `target` olur.
pub fn allocate_cents(weights: &[i64], target: i64) -> OkcResult<Vec<i64>> {
    let invalid = |message: &str| Err(OkcError::Validation(message.to_string()));
    if target < 0 || weights.iter().any(|w| *w < 0) {
        return invalid("dağıtılacak tutar negatif olamaz");
    }
    let base: i128 = weights.iter().map(|w| i128::from(*w)).sum();
    if base == 0 {
        return invalid("fiş kalemlerinin toplamı sıfır");
    }
    let target_wide = i128::from(target);
    let mut shares: Vec<(usize, i128, i128)> = weights
        .iter()
        .enumerate()
        .map(|(index, weight)| {
            let scaled = i128::from(*weight) * target_wide;
            (index, scaled / base, scaled % base)
        })
        .collect();
    let allocated: i128 = shares.iter().map(|s| s.1).sum();
    let mut leftover = target_wide - allocated;
    // En büyük kalanlar birer kuruş alır; eşitlikte önce gelen kalem.
    let mut order: Vec<usize> = (0..shares.len()).collect();
    order.sort_by(|a, b| shares[*b].2.cmp(&shares[*a].2).then(a.cmp(b)));
    for index in order {
        if leftover == 0 {
            break;
        }
        shares[index].1 += 1;
        leftover -= 1;
    }
    shares
        .into_iter()
        .map(|(_, value, _)| {
            i64::try_from(value).map_err(|_| OkcError::Validation("kalem tutarı taştı".to_string()))
        })
        .collect()
}

fn truncate_name(name: &str) -> String {
    name.trim().chars().take(MAX_NAME_CHARS).collect()
}

/// Fişe girecek ödemeler. Veresiye cari borçtur, fişe girmez.
pub fn payments_for(payload: &PaymentPayloadDto) -> OkcResult<Vec<ReceiptPayment>> {
    let mut payments = Vec::new();
    let mut push = |method: &str, amount: i64| -> OkcResult<()> {
        if let Some(kind) = TenderKind::from_method(method)? {
            payments.push(ReceiptPayment {
                kind,
                amount_cents: amount,
            });
        }
        Ok(())
    };
    match payload.splits.as_deref() {
        Some(splits) if !splits.is_empty() => {
            for split in splits {
                push(&split.method, split.amount)?;
            }
        }
        _ => push(&payload.method, payload.total_amount)?,
    }
    Ok(payments)
}

/// Adisyon satırları: tutara göre parçalı tahsilatta kalem dağıtımının tabanı.
///
/// Neden adisyondan: adisyon tahsilatında fiyat ve KDV sipariş anında mühürlüdür
/// (`order_items`); istemci kalem seçtiyse yalnız seçilen adetin payı alınır,
/// seçmediyse iptal edilmemiş tüm satırlar taban olur.
async fn order_lines(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    order_id: &str,
    selected: &[CartItemDto],
) -> OkcResult<Vec<ReceiptLine>> {
    let rows = sqlx::query(
        "SELECT oi.id, COALESCE(p.name, '') AS name, oi.quantity, oi.total_cents, oi.tax_rate_bp
         FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id AND p.tenant_id = oi.tenant_id
         WHERE oi.order_id = ? AND oi.tenant_id = ? AND oi.status != 'CANCELLED'
         ORDER BY oi.id",
    )
    .bind(order_id)
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| OkcError::Validation(e.to_string()))?;
    let read = |e: sqlx::Error| OkcError::Validation(e.to_string());
    let mut lines = Vec::new();
    for row in &rows {
        let id: String = row.try_get("id").map_err(read)?;
        let quantity: i64 = row.try_get("quantity").map_err(read)?;
        let name: String = row.try_get("name").map_err(read)?;
        let total: i64 = row.try_get("total_cents").map_err(read)?;
        let tax_bp: i64 = row.try_get("tax_rate_bp").map_err(read)?;
        let (take, share) = if selected.is_empty() {
            (quantity, total)
        } else {
            let Some(item) = selected.iter().find(|item| item.id == id) else {
                continue;
            };
            if quantity <= 0 || item.quantity <= 0 || item.quantity > quantity {
                return Err(OkcError::Validation(format!(
                    "kalem adedi geçersiz: {}",
                    item.id
                )));
            }
            let share = i128::from(total) * i128::from(item.quantity) / i128::from(quantity);
            let share = i64::try_from(share)
                .map_err(|_| OkcError::Validation("kalem payı taştı".to_string()))?;
            (item.quantity, share)
        };
        lines.push(ReceiptLine {
            name: truncate_name(&name),
            quantity_milli: take
                .checked_mul(1000)
                .ok_or_else(|| OkcError::Validation("miktar taştı".to_string()))?,
            total_cents: share,
            tax_bp,
        });
    }
    if lines.len() < selected.len() {
        return Err(OkcError::Validation(
            "seçilen kalem bu adisyonda bulunamadı".to_string(),
        ));
    }
    Ok(lines)
}

/// Tahsilattan fiş taslağı üretir. `None`: fişe girecek ödeme yok (tamamı veresiye).
pub async fn draft_for_payment(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    payload: &PaymentPayloadDto,
) -> OkcResult<Option<ReceiptDraft>> {
    let payments = payments_for(payload)?;
    if payments.is_empty() {
        return Ok(None);
    }
    let fiscal_total: i64 = payments
        .iter()
        .try_fold(0i64, |acc, p| acc.checked_add(p.amount_cents))
        .ok_or_else(|| OkcError::Validation("ödeme toplamı taştı".to_string()))?;

    let mut lines = match payload.order_id.as_deref() {
        Some(order_id) => order_lines(conn, tenant_id, order_id, &payload.items).await?,
        None => {
            if payload.items.is_empty() {
                return Err(OkcError::Validation(
                    "fiş için kalem veya adisyon gerekir".to_string(),
                ));
            }
            let priced = PaymentRepository::priced_lines(conn, tenant_id, &payload.items)
                .await
                .map_err(OkcError::Validation)?;
            let mut lines = Vec::with_capacity(priced.len());
            for line in priced {
                let name: Option<String> =
                    sqlx::query_scalar("SELECT name FROM products WHERE id = ? AND tenant_id = ?")
                        .bind(&line.product_id)
                        .bind(tenant_id)
                        .fetch_optional(&mut *conn)
                        .await
                        .map_err(|e| OkcError::Validation(e.to_string()))?;
                lines.push(ReceiptLine {
                    name: truncate_name(&name.unwrap_or_default()),
                    quantity_milli: line
                        .quantity
                        .checked_mul(1000)
                        .ok_or_else(|| OkcError::Validation("miktar taştı".to_string()))?,
                    total_cents: line.gross_cents - line.discount_cents,
                    tax_bp: line.tax_rate_bp,
                });
            }
            lines
        }
    };
    let weights: Vec<i64> = lines.iter().map(|l| l.total_cents).collect();
    let shares = allocate_cents(&weights, fiscal_total)?;
    for (line, share) in lines.iter_mut().zip(shares) {
        line.total_cents = share;
    }
    // Sıfır tutarlı kalemler fişe girmez: ikram kalemi mali belgeye yazılmaz.
    lines.retain(|line| line.total_cents > 0);
    Ok(Some(ReceiptDraft {
        basket_id: payload.transaction_id.clone(),
        lines,
        discount_cents: 0,
        payments,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allocation_keeps_every_cent() {
        assert_eq!(
            allocate_cents(&[100, 100, 100], 100).expect("a"),
            vec![34, 33, 33]
        );
        assert_eq!(
            allocate_cents(&[500, 1500], 2000).expect("b"),
            vec![500, 1500]
        );
        assert_eq!(allocate_cents(&[1, 1], 1).expect("c"), vec![1, 0]);
        let shares = allocate_cents(&[333, 777, 1], 1000).expect("d");
        assert_eq!(shares.iter().sum::<i64>(), 1000);
    }

    #[test]
    fn allocation_rejects_degenerate_input() {
        assert!(allocate_cents(&[0, 0], 10).is_err());
        assert!(allocate_cents(&[10], -1).is_err());
        assert!(allocate_cents(&[-5, 10], 5).is_err());
    }
}
