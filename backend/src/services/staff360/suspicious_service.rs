//! Faz 11 B4 — şüpheli işlem radarı.
//!
//! Tasarım kuralı: **eşik altı uyarı üretilmez.** Az örneklemli veriden
//! çıkan "anormallik" iftira olur; bir garsonun 2 iptali %100 oran görünür
//! ama gerçekte 2 iptaldir. Bu yüzden her kuralın asgari örneklem şartı
//! vardır ve ölçüm ile eşik birlikte raporlanır (patron "neden?" diye
//! sorduğunda ekranda cevap hazır olmalıdır).

use sqlx::Row;
use sqlx::SqlitePool;

use crate::services::staff360::payroll_types::SuspiciousFlag;

/// İptal oranı kuralı: en az 5 sipariş üzerinden ölçülür, %30 üstü işaretlenir.
const VOID_MIN_ORNEKLEM: i64 = 5;
const VOID_ESIK_YUZDE: i64 = 30;

/// Günde onaylı indirim/ikram kuralı: en az 3 gün üzerinden ölçülür,
/// günde 5 kez üstü işaretlenir.
const ONAY_MIN_GUN: i64 = 3;
const ONAY_ESIK_GUNDE: i64 = 5;

/// İki kuralı da çalıştırır ve yalnız eşiği aşanları döner.
pub async fn radar(
    pool: &SqlitePool,
    tenant_id: &str,
    from: &str,
    to: &str,
) -> Result<Vec<SuspiciousFlag>, String> {
    if from > to {
        return Err(format!("tarih araligi ters: {from} > {to}"));
    }
    let mut bayraklar = Vec::new();
    bayraklar.extend(void_radar(pool, tenant_id, from, to).await?);
    bayraklar.extend(approval_radar(pool, tenant_id, from, to).await?);
    // Ciddiyet sırası: yuksek → orta → dusuk. Aynı seviyede kişi adına göre.
    bayraklar.sort_by(|a, b| {
        siddet_sira(&a.severity)
            .cmp(&siddet_sira(&b.severity))
            .then(a.full_name.cmp(&b.full_name))
    });
    Ok(bayraklar)
}

fn siddet_sira(seviye: &str) -> u8 {
    match seviye {
        "Yuksek" => 0,
        "Orta" => 1,
        _ => 2,
    }
}

/// Kural 1: yüksek iptal oranı.
async fn void_radar(
    pool: &SqlitePool,
    tenant_id: &str,
    from: &str,
    to: &str,
) -> Result<Vec<SuspiciousFlag>, String> {
    let rows = sqlx::query(
        "SELECT o.cashier_id AS user_id, u.name AS full_name,
                COUNT(*) AS toplam,
                SUM(CASE WHEN o.status = 'VOID' THEN 1 ELSE 0 END) AS iptal
           FROM orders o
           JOIN users u ON u.id = o.cashier_id AND u.tenant_id = o.tenant_id
          WHERE o.tenant_id = ?1 AND o.created_at >= ?2 AND o.created_at <= ?3
          GROUP BY o.cashier_id, u.name
         HAVING COUNT(*) >= ?4 AND SUM(CASE WHEN o.status = 'VOID' THEN 1 ELSE 0 END) > 0",
    )
    .bind(tenant_id)
    .bind(from)
    .bind(to)
    .bind(VOID_MIN_ORNEKLEM)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("iptal radarı okunamadi: {e}"))?;

    let mut out = Vec::new();
    for r in rows {
        let user_id: String = r.try_get("user_id").map_err(|e| e.to_string())?;
        let full_name: String = r.try_get("full_name").map_err(|e| e.to_string())?;
        let toplam: i64 = r.try_get("toplam").map_err(|e| e.to_string())?;
        let iptal: i64 = r.try_get("iptal").map_err(|e| e.to_string())?;
        let oran = (iptal * 100) / toplam;
        if oran <= VOID_ESIK_YUZDE {
            continue;
        }
        out.push(SuspiciousFlag {
            user_id,
            full_name,
            rule: "Yuksek iptal orani".to_string(),
            severity: if oran >= 60 { "Yuksek" } else { "Orta" }.to_string(),
            detail: format!("{iptal} iptal / {toplam} siparis"),
            measured: format!("%{oran}"),
            threshold: format!("asgari {VOID_MIN_ORNEKLEM} siparis, esik %{VOID_ESIK_YUZDE}"),
        });
    }
    Ok(out)
}

/// Kural 2: günde çok sayıda onaylı indirim/ikram.
async fn approval_radar(
    pool: &SqlitePool,
    tenant_id: &str,
    from: &str,
    to: &str,
) -> Result<Vec<SuspiciousFlag>, String> {
    // `approver_id` = onaylayan yetkili, `requester_id` = isteyen personel.
    // İki kişi karşılaştırılır: şişen taraf isteyen, onaylayan değil.
    let rows = sqlx::query(
        "SELECT a.requester_id AS user_id, u.name AS full_name, COUNT(DISTINCT date(a.created_at)) AS gun,
                COUNT(*) AS adet
           FROM approvals a
           JOIN users u ON u.id = a.requester_id AND u.tenant_id = a.tenant_id
          WHERE a.tenant_id = ?1 AND a.status = 'APPROVED'
            AND a.request_type IN ('DISCOUNT', 'VOID', 'GIFT')
            AND a.created_at >= ?2 AND a.created_at <= ?3
          GROUP BY a.requester_id, u.name
         HAVING COUNT(DISTINCT date(a.created_at)) >= ?4",
    )
    .bind(tenant_id)
    .bind(from)
    .bind(to)
    .bind(ONAY_MIN_GUN)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("onay radarı okunamadi: {e}"))?;

    let mut out = Vec::new();
    for r in rows {
        let user_id: String = r.try_get("user_id").map_err(|e| e.to_string())?;
        let full_name: String = r.try_get("full_name").map_err(|e| e.to_string())?;
        let gun: i64 = r.try_get("gun").map_err(|e| e.to_string())?;
        let adet: i64 = r.try_get("adet").map_err(|e| e.to_string())?;
        // Günlük ortalama: 5 kez/gün eşiği ortalama üzerinden ölçülür, tek bir
        // yoğun gün yanlış alarm üretmesin diye.
        let gunluk = adet / gun;
        if gunluk <= ONAY_ESIK_GUNDE {
            continue;
        }
        out.push(SuspiciousFlag {
            user_id,
            full_name,
            rule: "Gunluk onay yogunlugu".to_string(),
            severity: if gunluk >= 15 { "Yuksek" } else { "Orta" }.to_string(),
            detail: format!("{adet} onay / {gun} gun"),
            measured: format!("{gunluk} onay/gun"),
            threshold: format!("asgari {ONAY_MIN_GUN} gun, esik {ONAY_ESIK_GUNDE}/gun"),
        });
    }
    Ok(out)
}
