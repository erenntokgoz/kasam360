//! Bahşiş havuzu ve dağıtımı.
//!
//! Finansal kural (AGENTS.md §3.4): havuz toplamı hata halinde 0'a dönmez.
//! Dağıtımda kuruş kaybı olmaz: toplam bölünürken kalan kuruş, deterministik
//! sıradaki (kullanıcı kimliğine göre) son kişiye verilir ve sonra doğrulanır.

use crate::services::lan_sync::WritePool;
use sqlx::{SqliteConnection, SqlitePool};

use crate::services::staff360::payroll_types::{TipAllocation, TipAllocationInput, TipPoolSummary};

/// Havuza bahşiş ekler. Yöntem kayıtta durur: kart bahşişi kasadaki nakitle
/// karıştırılmasın, dağıtımda hangi paranın nereden geldiği görülsün.
#[cfg(test)]
pub async fn record_tip(
    pool: &SqlitePool,
    tenant_id: &str,
    order_id: Option<&str>,
    amount_cents: i64,
    payment_method: &str,
    paid_at: &str,
) -> Result<String, String> {
    let mut tx = pool.begin_write().await?;
    let (id, _) = insert_tip(
        &mut tx,
        tenant_id,
        order_id,
        amount_cents,
        payment_method,
        paid_at,
        None,
        None,
    )
    .await?;
    tx.commit().await?;
    Ok(id)
}

#[allow(clippy::too_many_arguments)]
pub async fn insert_tip(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    order_id: Option<&str>,
    amount_cents: i64,
    payment_method: &str,
    paid_at: &str,
    recipient: Option<&str>,
    request_id: Option<&str>,
) -> Result<(String, bool), String> {
    if amount_cents <= 0 {
        return Err("bahsis sifirdan buyuk olmali".to_string());
    }
    if !matches!(payment_method, "CASH" | "CARD") {
        return Err("VALIDATION: bahşiş yöntemi nakit veya kart olmalıdır".to_string());
    }
    if let Some(key) = request_id {
        let existing: Option<(String, i64, String, Option<String>)> = sqlx::query_as(
            "SELECT id, amount_cents, payment_method, recipient_user_id FROM tip_pool_entries
             WHERE tenant_id = ? AND request_id = ?",
        )
        .bind(tenant_id)
        .bind(key)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        if let Some((id, amount, method, user)) = existing {
            if amount == amount_cents && method == payment_method && user.as_deref() == recipient {
                return Ok((id, false));
            }
            return Err(
                "IDEMPOTENCY_CONFLICT: Bahşiş isteği farklı bilgilerle kaydedilmiş.".into(),
            );
        }
    }
    if let Some(user_id) = recipient {
        let active: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM users WHERE tenant_id = ? AND id = ?
              AND is_active = 1 AND role IN ('OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'))",
        )
        .bind(tenant_id)
        .bind(user_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        if !active {
            return Err("VALIDATION: Aktif personel bulunamadı.".into());
        }
    }
    let period = period_of(paid_at).ok_or_else(|| format!("tarih ayrıştırılamadı: {paid_at}"))?;

    let id = crate::id_generator::generate_id("tip");
    sqlx::query(
        "INSERT INTO tip_pool_entries
             (id, tenant_id, period, order_id, amount_cents, payment_method, created_at, recipient_user_id, request_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(&period)
    .bind(order_id)
    .bind(amount_cents)
    .bind(payment_method)
    .bind(paid_at)
    .bind(recipient)
    .bind(request_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok((id, true))
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TipEntry {
    pub id: String,
    pub amount_cents: i64,
    pub payment_method: String,
    pub created_at: String,
}

pub async fn list_entries(
    pool: &SqlitePool,
    tenant_id: &str,
    period: &str,
) -> Result<Vec<TipEntry>, String> {
    let rows: Vec<(String, i64, String, String)> = sqlx::query_as(
        "SELECT id, amount_cents, payment_method, created_at FROM tip_pool_entries
          WHERE tenant_id = ?1 AND period = ?2 AND recipient_user_id IS NULL ORDER BY created_at DESC",
    )
    .bind(tenant_id)
    .bind(period)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(id, amount_cents, payment_method, created_at)| TipEntry {
            id,
            amount_cents,
            payment_method,
            created_at,
        })
        .collect())
}

/// Yanlış girilen bahşişi siler. Dağıtılmış dönemde silinmez: personele yazılan pay
/// havuzdan büyük kalırdı.
pub async fn delete_entry(
    pool: &SqlitePool,
    tenant_id: &str,
    entry_id: &str,
) -> Result<i64, String> {
    let mut tx = pool.begin_write().await?;
    let entry: Option<(String, i64)> = sqlx::query_as(
        "SELECT period, amount_cents FROM tip_pool_entries WHERE tenant_id = ?1 AND id = ?2 AND recipient_user_id IS NULL",
    )
    .bind(tenant_id)
    .bind(entry_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    let (period, amount_cents) =
        entry.ok_or_else(|| "NOT_FOUND: bahşiş kaydı bulunamadı".to_string())?;
    let distributed: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM tip_distributions WHERE tenant_id = ?1 AND period = ?2",
    )
    .bind(tenant_id)
    .bind(&period)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    if distributed > 0 {
        return Err("CONFLICT: dağıtılmış dönemin bahşişi silinemez.".to_string());
    }
    sqlx::query("DELETE FROM tip_pool_entries WHERE tenant_id = ?1 AND id = ?2 AND recipient_user_id IS NULL")
        .bind(tenant_id)
        .bind(entry_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await?;
    Ok(amount_cents)
}

/// Dönemin havuz toplamı. Satır yoksa 0 meşrudur (kimse bahşiş vermemiştir);
/// sorgu hatası `?` ile yukarı çıkar.
pub async fn pool_total(pool: &SqlitePool, tenant_id: &str, period: &str) -> Result<i64, String> {
    let total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM tip_pool_entries
          WHERE tenant_id = ?1 AND period = ?2 AND recipient_user_id IS NULL",
    )
    .bind(tenant_id)
    .bind(period)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("havuz toplami okunamadi: {e}"))?;
    Ok(total)
}

/// Dönem özeti: toplam, dağıtılan ve kalan.
pub async fn pool_summary(
    pool: &SqlitePool,
    tenant_id: &str,
    period: &str,
) -> Result<TipPoolSummary, String> {
    let total = pool_total(pool, tenant_id, period).await?;
    let row = sqlx::query(
        "SELECT COALESCE(SUM(amount_cents), 0) AS distributed
           FROM tip_distributions WHERE tenant_id = ?1 AND period = ?2",
    )
    .bind(tenant_id)
    .bind(period)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("dagitim toplami okunamadi: {e}"))?;
    use sqlx::Row;
    let distributed: i64 = row.try_get("distributed").map_err(|e| e.to_string())?;
    let havuz: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM tip_pool_entries WHERE tenant_id = ?1 AND period = ?2 AND recipient_user_id IS NULL",
    )
    .bind(tenant_id)
    .bind(period)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("havuz kayit sayisi okunamadi: {e}"))?;

    Ok(TipPoolSummary {
        period: period.to_string(),
        total_cents: total,
        distributed_cents: distributed,
        entry_count: havuz,
        leftover_cents: total - distributed,
    })
}

/// Havuzu tabana göre dağıtır ve `tip_distributions` tablosuna yazar.
///
/// Taban seçimi çağıranın sorumluluğundadır: genelde vardiye saati veya
/// fiş adedi. Buradaki formül: `pay = havuz × (taban_i × katsayı_i) / Σ(taban × katsayı)`.
/// Bölme tam sayıdır; kalan kuruş son kişiye verilir, sonra toplam denetlenir.
pub async fn distribute_pool(
    pool: &SqlitePool,
    tenant_id: &str,
    period: &str,
    allocations: &[TipAllocationInput],
) -> Result<Vec<TipAllocation>, String> {
    let mut tx = pool.begin_write().await?;
    if allocations.is_empty() {
        return Err("dagitilacak calisan yok".to_string());
    }
    let total = pool_total(pool, tenant_id, period).await?;
    if total <= 0 {
        return Err("bu donemde dagitilacak bahsis yok".to_string());
    }

    // Ağırlıklı taban toplamı. Sıfırsa bölme yapılamaz; sessizce 0 dağıtmak
    // "havuz dağıtıldı" gibi görünür ve kuruş kaybolur.
    let mut agirlikli: Vec<(String, i64, i64)> = Vec::with_capacity(allocations.len());
    let mut toplam_agirlik: i64 = 0;
    for a in allocations {
        if a.basis_cents < 0 {
            return Err("taban negatif olamaz".to_string());
        }
        if a.multiplier_percent < 0 {
            return Err("katsayi negatif olamaz".to_string());
        }
        let agirlik = a
            .basis_cents
            .checked_mul(a.multiplier_percent)
            .ok_or_else(|| "agirlik hesabi tasma".to_string())?;
        toplam_agirlik += agirlik;
        agirlikli.push((a.user_id.clone(), agirlik, a.multiplier_percent));
    }
    if toplam_agirlik <= 0 {
        return Err("dagitim tabani sifir; kimse calismamis".to_string());
    }

    // Kullanıcı kimliğine göre sırala: kalan kuruşun gideceği kişi sabit olsun,
    // yoksa her hesapta farklı kişiye kuruş kalır ve "neden benden eksik" sorusu doğar.
    agirlikli.sort_by(|a, b| a.0.cmp(&b.0));

    let mut dagilan: i64 = 0;
    let son_index = agirlikli.len() - 1;
    let mut out: Vec<TipAllocation> = Vec::with_capacity(agirlikli.len());
    for (idx, (user_id, agirlik, katsayi)) in agirlikli.iter().enumerate() {
        let pay = if idx == son_index {
            total - dagilan
        } else {
            // Kesmeden önce tabanı 100 ile çarp: yüzde 100'de en fazla 1 kuruş
            // yuvarlama farkı oluşabilir, kalan onu kapatır.
            let pay = (*agirlik as i128 * total as i128) / (toplam_agirlik as i128);
            let pay = i64::try_from(pay).map_err(|_| "dagitim tasmasi".to_string())?;
            dagilan += pay;
            pay
        };
        let ad = sqlx::query_scalar::<_, String>(
            "SELECT name FROM users WHERE tenant_id = ?1 AND id = ?2",
        )
        .bind(tenant_id)
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| user_id.clone());

        out.push(TipAllocation {
            user_id: user_id.clone(),
            full_name: ad,
            basis_cents: allocations
                .iter()
                .find(|a| &a.user_id == user_id)
                .map(|a| a.basis_cents)
                .unwrap_or(0),
            multiplier_percent: *katsayi,
            amount_cents: pay,
        });
    }

    // Toplam denetimi: yuvarlama bir kuruştan fazla kaybettiyse hata ver.
    let toplam_pay: i64 = out.iter().map(|a| a.amount_cents).sum();
    if toplam_pay != total {
        return Err(format!(
            "dagitim toplami havuzla uyusmuyor: {} != {}",
            toplam_pay, total
        ));
    }

    sqlx::query("DELETE FROM tip_distributions WHERE tenant_id = ?1 AND period = ?2")
        .bind(tenant_id)
        .bind(period)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    for a in &out {
        sqlx::query(
            "INSERT INTO tip_distributions
                 (id, tenant_id, period, user_id, amount_cents, basis_cents,
                  multiplier_percent, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        )
        .bind(crate::id_generator::generate_id("tpd"))
        .bind(tenant_id)
        .bind(period)
        .bind(&a.user_id)
        .bind(a.amount_cents)
        .bind(a.basis_cents)
        .bind(a.multiplier_percent)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    tx.commit().await?;
    Ok(out)
}

/// Bir çalışanın dönem bahşiş toplamı (bordro hesabında kullanılır).
pub async fn tip_for_user(
    pool: &SqlitePool,
    tenant_id: &str,
    user_id: &str,
    period: &str,
) -> Result<i64, String> {
    let toplam: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM staff_tip_earnings
          WHERE tenant_id = ?1 AND period = ?2 AND user_id = ?3",
    )
    .bind(tenant_id)
    .bind(period)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("calisan bahsis toplami okunamadi: {e}"))?;
    Ok(toplam)
}

/// ISO tarihinin `YYYY-MM` dönemini verir. Ayrıştırılamayan tarih `None`
/// döner; çağıran hata yükseltir.
fn period_of(iso: &str) -> Option<String> {
    if iso.len() < 7 {
        return None;
    }
    let ay = &iso[5..7];
    if !ay.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(format!("{}-{}", &iso[0..4], ay))
}

#[cfg(test)]
mod tests {
    use super::period_of;

    #[test]
    fn donem_ayrilir() {
        assert_eq!(
            period_of("2026-03-15T10:22:31Z").as_deref(),
            Some("2026-03")
        );
    }

    #[test]
    fn bozuk_tarih_donem_uremez() {
        assert!(period_of("15/03/2026").is_none());
        assert!(period_of("").is_none());
    }
}
