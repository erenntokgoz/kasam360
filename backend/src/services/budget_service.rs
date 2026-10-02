//! Bütçe ve tekrarlayan gider motoru (Faz 9 — Spec §2.3 "dürüst kasa
//! mutabakatı, açılış bakiyeleri sihirbazı, bütçe uyarıları, tekrarlayan
//! işlemler (kira, stopaj)").
//!
//! Neden ayrı servis: `recurring_expenses` ve `budget_limits` tabloları şemada
//! vardı ama hiçbir kod yazmıyordu. Yani kira/stopaj gibi sabit giderler
//! elle `general_expenses` içine giriliyordu; ay sonunda "bu ay ne harcandı"
//! sorusu için güvenilir bir tavan yoktu ve harcama tavanı aşıldığında kimse
//! öğrenmiyordu.
//!
//! ## Para okuma kuralı (AGENTS.md §3.4)
//!
//! Harcama toplamları `unwrap_or(0)` ile yutulmaz; SQL hatası `Err` olarak
//! yukarı çıkar. Aksi hâlde bütçe motoru bozuk bir tabloda "harcama yok"
//! der ve uyarı üretmez.

use sqlx::{Row, SqlitePool};

/// Tek bir bütçe satırının o anki durumu.
#[derive(Debug, Clone)]
pub struct BudgetStatus {
    pub category: String,
    pub monthly_limit_cents: i64,
    pub spent_cents: i64,
    /// Kalan tutar. Negatifse limit aşılmıştır.
    pub remaining_cents: i64,
    /// `spent / limit` yüzdesi (tam sayı). Limit sıfırsa `0`.
    pub used_percent: i64,
    pub is_exceeded: bool,
    /// Limiti %80 ve üzeri aşan uyarı eşiği.
    pub is_near_limit: bool,
}

/// Uyarı eşiği: limitin yüzde 80'i.
const NEAR_LIMIT_PERCENT: i64 = 80;

/// Bir kategorinin ay içindeki harcamasını okur.
///
/// Neden ay filtresi `strftime` ile: `expense_date` ISO metin olarak saklanıyor
/// (`YYYY-MM-DD...`), `substr(expense_date,1,7)` ay bilgisini doğrudan verir.
async fn spent_in_month(
    pool: &SqlitePool,
    tenant_id: &str,
    category: &str,
    month_prefix: &str,
) -> Result<i64, String> {
    let total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM general_expenses
         WHERE tenant_id = ? AND category = ? AND substr(expense_date, 1, 7) = ?",
    )
    .bind(tenant_id)
    .bind(category)
    .bind(month_prefix)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("{} kategorisi harcamaları okunamadı: {}", category, e))?;
    Ok(total)
}

/// Ayın `YYYY-MM` önekini döndürür (`2026-10`).
pub fn month_prefix_from_iso(iso: &str) -> Result<String, String> {
    let trimmed = iso.trim();
    if trimmed.len() < 7 {
        return Err(format!("Geçersiz tarih: '{}'", iso));
    }
    let candidate = &trimmed[..7];
    let ok = candidate
        .chars()
        .enumerate()
        .all(|(i, c)| if i == 4 { c == '-' } else { c.is_ascii_digit() });
    if !ok {
        return Err(format!("Geçersiz tarih: '{}'", iso));
    }
    Ok(candidate.to_string())
}

/// Tanımlı bütçe limitleriyle gerçekleşen harcamayı karşılaştırır.
///
/// `as_of` verilmezse bugünün ayı kullanılır. Karşılaştırma **kümülatif**
/// değildir: bütçe aylık tanımıyla birebir tutarlı olsun diye yalnız içinde
/// bulunulan ayın harcaması ölçülür.
pub async fn budget_status(
    pool: &SqlitePool,
    tenant_id: &str,
    as_of: Option<&str>,
) -> Result<Vec<BudgetStatus>, String> {
    let month = match as_of {
        Some(iso) => month_prefix_from_iso(iso)?,
        None => month_prefix_from_iso(&chrono::Utc::now().to_rfc3339())?,
    };

    let rows = sqlx::query(
        "SELECT category, monthly_limit_cents FROM budget_limits
         WHERE tenant_id = ?
         ORDER BY category ASC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Bütçe limitleri okunamadı: {}", e))?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let category: String = r.try_get("category").map_err(|e| e.to_string())?;
        let monthly_limit_cents: i64 = r
            .try_get("monthly_limit_cents")
            .map_err(|e| e.to_string())?;
        let spent_cents = spent_in_month(pool, tenant_id, &category, &month).await?;

        let remaining_cents = monthly_limit_cents - spent_cents;
        let used_percent = if monthly_limit_cents == 0 {
            0
        } else {
            (spent_cents * 100) / monthly_limit_cents
        };

        out.push(BudgetStatus {
            category,
            monthly_limit_cents,
            spent_cents,
            remaining_cents,
            used_percent,
            is_exceeded: spent_cents > monthly_limit_cents,
            is_near_limit: used_percent >= NEAR_LIMIT_PERCENT && spent_cents <= monthly_limit_cents,
        });
    }
    Ok(out)
}

// ============================================================================
// TEKRARLAYAN GİDER
// ============================================================================

/// Bir tekrarlayan giderin bu ay vadesi dolmuş mu?
#[derive(Debug, Clone)]
pub struct RecurringDue {
    pub id: String,
    pub title: String,
    pub category: String,
    pub amount_cents: i64,
    pub frequency: String,
    pub due_day: i64,
    /// Bu ayın gün sayısı (28/29/30/31).
    pub days_in_month: i64,
    /// Ayın bugünü itibarıyla vade geçmiş mi.
    pub is_overdue: bool,
    pub is_due_today: bool,
}

/// Ayın gün sayısını dışarıya açar: artık yıl kuralı, vade gününün ay sonuna
/// sıkıştırılmasını doğrudan belirlediği için testler bu kuralı ayrıca doğrulamalıdır.
pub(crate) fn days_in_month(year: i32, month: u32) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
            if leap {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

/// Aktif tekrarlayan giderleri ve içinde bulunulan aydaki vade durumunu döndürür.
pub async fn recurring_due(
    pool: &SqlitePool,
    tenant_id: &str,
    as_of: Option<&str>,
) -> Result<Vec<RecurringDue>, String> {
    let now_iso = match as_of {
        Some(iso) => iso.to_string(),
        None => chrono::Utc::now().to_rfc3339(),
    };
    let month = month_prefix_from_iso(&now_iso)?;
    let year: i32 = month[..4]
        .parse()
        .map_err(|_| format!("Geçersiz yıl: {}", month))?;
    let month_num: u32 = month[5..7]
        .parse()
        .map_err(|_| format!("Geçersiz ay: {}", month))?;
    let today: i64 = if now_iso.len() >= 10 {
        now_iso[8..10].parse().unwrap_or(1)
    } else {
        1
    };
    let dim = days_in_month(year, month_num);

    let rows = sqlx::query(
        "SELECT id, title, category, amount_cents, frequency, due_day
         FROM recurring_expenses
         WHERE tenant_id = ? AND is_active = 1
         ORDER BY due_day ASC, title ASC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Tekrarlayan giderler okunamadı: {}", e))?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let due_day: i64 = r.try_get("due_day").map_err(|e| e.to_string())?;
        // Neden `min`: 31 Ocak'ta vadesi olan kira Şubat'ta 28/29'a
        // sıkıştırılmalı; aksi hâlde o ay hiç görünmez ve kira unutulur.
        let effective_day = if due_day < 1 {
            1
        } else if due_day > dim {
            dim
        } else {
            due_day
        };

        out.push(RecurringDue {
            id: r.try_get("id").map_err(|e| e.to_string())?,
            title: r.try_get("title").map_err(|e| e.to_string())?,
            category: r.try_get("category").map_err(|e| e.to_string())?,
            amount_cents: r.try_get("amount_cents").map_err(|e| e.to_string())?,
            frequency: r.try_get("frequency").map_err(|e| e.to_string())?,
            due_day: effective_day,
            days_in_month: dim,
            is_overdue: today > effective_day,
            is_due_today: today == effective_day,
        });
    }
    Ok(out)
}

#[cfg(test)]
#[path = "budget_service_tests.rs"]
mod tests;
