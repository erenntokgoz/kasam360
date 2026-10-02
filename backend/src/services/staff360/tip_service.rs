//! Faz 11 B4 — bahşiş havuzu ve dağıtımı.
//!
//! Finansal kural (AGENTS.md §3.4): havuz toplamı hata halinde 0'a dönmez.
//! Dağıtımda kuruş kaybı olmaz: toplam bölünürken kalan kuruş, deterministik
//! sıradaki (kullanıcı kimliğine göre) son kişiye verilir ve sonra doğrulanır.

use sqlx::SqlitePool;

use crate::services::staff360::payroll_types::{
    TipAllocation, TipAllocationInput, TipPoolSummary,
};

/// Havuza bahşiş ekler. Kartla alınan bahşiş terminale işlendiği için
/// buraya **yalnız nakit** bahşiş yazılır; kart bahşişini de yazmak havuzu
/// gerçekte olmayan parayla şişirirdi.
pub async fn record_tip(
    pool: &SqlitePool,
    tenant_id: &str,
    order_id: Option<&str>,
    amount_cents: i64,
    paid_at: &str,
) -> Result<String, String> {
    if amount_cents <= 0 {
        return Err("bahsis sifirdan buyuk olmali".to_string());
    }
    let period = period_of(paid_at)
        .ok_or_else(|| format!("tarih ayrıştırılamadı: {paid_at}"))?;

    let id = crate::id_generator::generate_id("tip");
    sqlx::query(
        "INSERT INTO tip_pool_entries (id, tenant_id, period, order_id, amount_cents, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(&period)
    .bind(order_id)
    .bind(amount_cents)
    .bind(paid_at)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

/// Dönemin havuz toplamı. Satır yoksa 0 meşrudur (kimse bahşiş vermemiştir);
/// sorgu hatası `?` ile yukarı çıkar.
pub async fn pool_total(pool: &SqlitePool, tenant_id: &str, period: &str) -> Result<i64, String> {
    let total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM tip_pool_entries
          WHERE tenant_id = ?1 AND period = ?2",
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
        "SELECT COUNT(*) FROM tip_pool_entries WHERE tenant_id = ?1 AND period = ?2",
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
            let kalan = total - dagilan;
            kalan
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
        .fetch_optional(pool)
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
        .execute(pool)
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
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

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
        "SELECT COALESCE(SUM(amount_cents), 0) FROM tip_distributions
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
        assert_eq!(period_of("2026-03-15T10:22:31Z").as_deref(), Some("2026-03"));
    }

    #[test]
    fn bozuk_tarih_donem_uremez() {
        assert!(period_of("15/03/2026").is_none());
        assert!(period_of("").is_none());
    }
}
