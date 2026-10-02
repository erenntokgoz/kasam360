//! Faz 11 B3 — personel servisi: profil, vardiya planı, izin, zimmet, tutanak.
//!
//! Finansal kural (AGENTS.md §3.4): maaş/prim/bahşiş okumalarında hata yukarı
//! taşınır, sıfıra dönüştürülmez. Tüm sorgular `tenant_id` ile filtrelenir.
//!
//! Maaş gizliliği (§3.2): bu servis tutar döndürmez; tutar okuması
//! `payroll_service` içinde ve yetki kapısına tabidir. `staff_service` yalnız
//! profil ve operasyon kayıtlarını yönetir.

use chrono::{Datelike, NaiveDate};
use sqlx::{Row, SqlitePool};

use crate::services::staff360::staff_types::{
    CustodyRecord, Incident, IncidentInput, LeaveInput, LeaveRequest, ShiftPlan, ShiftPlanInput,
    StaffProfile, StaffProfileInput,
};

/// Personel listesi: yalnız profil + rozet bilgisi. Maaş kolonları **yok**.
pub async fn list_profiles(
    pool: &SqlitePool,
    tenant_id: &str,
) -> Result<Vec<StaffProfile>, String> {
    let rows = sqlx::query(
        "SELECT sp.user_id, sp.full_name, u.role, sp.base_salary_cents,
                sp.commission_percent, sp.birth_date, sp.hire_date, sp.phone,
                sp.national_id, sp.address, sp.emergency_contact, sp.notes
           FROM staff_profiles sp
           JOIN users u ON u.id = sp.user_id AND u.tenant_id = sp.tenant_id
          WHERE sp.tenant_id = ?1 AND u.is_active = 1
          ORDER BY sp.full_name ASC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(StaffProfile {
            user_id: r.try_get("user_id").map_err(|e| e.to_string())?,
            full_name: r.try_get("full_name").map_err(|e| e.to_string())?,
            role: r.try_get("role").map_err(|e| e.to_string())?,
            base_salary_cents: r.try_get("base_salary_cents").map_err(|e| e.to_string())?,
            commission_percent: r
                .try_get("commission_percent")
                .map_err(|e| e.to_string())?,
            birth_date: r.try_get("birth_date").map_err(|e| e.to_string())?,
            hire_date: r.try_get("hire_date").map_err(|e| e.to_string())?,
            phone: r.try_get("phone").map_err(|e| e.to_string())?,
            national_id: r.try_get("national_id").map_err(|e| e.to_string())?,
            address: r.try_get("address").map_err(|e| e.to_string())?,
            emergency_contact: r
                .try_get("emergency_contact")
                .map_err(|e| e.to_string())?,
            notes: r.try_get("notes").map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

/// Profil oluşturur veya günceller (UPSERT). `users` tablosunda karşılığı
/// olmayan `user_id` reddedilir: yönetici hayalet personel kaydı açamaz.
pub async fn upsert_profile(
    pool: &SqlitePool,
    tenant_id: &str,
    actor_id: &str,
    input: &StaffProfileInput,
) -> Result<(), String> {
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM users WHERE tenant_id = ?1 AND id = ?2 AND is_active = 1")
            .bind(tenant_id)
            .bind(&input.user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
    if exists.is_none() {
        return Err(format!("kullanici bulunamadi: {}", input.user_id));
    }
    if input.base_salary_cents < 0 {
        return Err("maas negatif olamaz".to_string());
    }
    if !(0..=100).contains(&input.commission_percent) {
        return Err("komisyon yuzdesi 0-100 araliginda olmali".to_string());
    }
    if let Some(birth) = input.birth_date.as_deref() {
        if !is_iso_date(birth) {
            return Err("dogum tarihi YYYY-MM-DD biciminde olmali".to_string());
        }
    }
    if let Some(hire) = input.hire_date.as_deref() {
        if !is_iso_date(hire) {
            return Err("ise giris tarihi YYYY-MM-DD biciminde olmali".to_string());
        }
    }

    sqlx::query(
        "INSERT INTO staff_profiles
             (id, tenant_id, user_id, full_name, base_salary_cents, commission_percent,
              birth_date, hire_date, phone, national_id, address, emergency_contact, notes,
              created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET full_name = excluded.full_name,
                       base_salary_cents = excluded.base_salary_cents,
                       commission_percent = excluded.commission_percent,
                       birth_date = excluded.birth_date,
                       hire_date = excluded.hire_date,
                       phone = excluded.phone,
                       national_id = excluded.national_id,
                       address = excluded.address,
                       emergency_contact = excluded.emergency_contact,
                       notes = excluded.notes,
                       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    )
    .bind(crate::id_generator::generate_id("stf"))
    .bind(tenant_id)
    .bind(&input.user_id)
    .bind(input.full_name.trim())
    .bind(input.base_salary_cents)
    .bind(input.commission_percent)
    .bind(input.birth_date.as_deref())
    .bind(input.hire_date.as_deref())
    .bind(input.phone.as_deref())
    .bind(input.national_id.as_deref())
    .bind(input.address.as_deref())
    .bind(input.emergency_contact.as_deref())
    .bind(input.notes.as_deref())
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    let _ = actor_id;
    Ok(())
}

/// Doğum günü listesi: yalnız ay/gün eşleşir, yıl gözetilmez.
/// Tarih bilinmiyorsa ürün **boş** döner; "1 kişi doğum günü" uydurmak,
/// patronun ikrami planını yanlış kurmasına yol açar.
pub async fn upcoming_birthdays(
    pool: &SqlitePool,
    tenant_id: &str,
    days_ahead: i64,
) -> Result<Vec<(String, String, String)>, String> {
    // `days_ahead` 0-365 ile sınırlanır; 99999 gibi bir değer tüm kayıtları
    // döndürür ve ekranda anlamsız bir liste oluşturur.
    let horizon = days_ahead.clamp(0, 365);
    let rows = sqlx::query(
        "SELECT user_id, full_name, birth_date
           FROM staff_profiles
          WHERE tenant_id = ?1 AND birth_date IS NOT NULL AND birth_date <> ''
          ORDER BY substr(birth_date, 6)",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let today = chrono::Utc::now().date_naive();
    let mut out: Vec<(String, String, String)> = Vec::new();
    for r in rows {
        let raw: String = r.try_get("birth_date").map_err(|e| e.to_string())?;
        let Some(birth) = NaiveDate::parse_from_str(&raw, "%Y-%m-%d").ok() else {
            // Bozuk tarih satırı atlanır; hata üretmek tum listeyi bozardi.
            continue;
        };
        // Bugünün ay/günü bu yıl 29 Şubat gibi yoksa (ör. 1 Mart, artık yıl
        // dışı) 28 Şubat'a düşülür; aksi halde "hiç doğmaz" görünürdü.
        let mut next = match NaiveDate::from_ymd_opt(birth.year(), today.month(), today.day()) {
            Some(d) => d,
            None => NaiveDate::from_ymd_opt(birth.year(), today.month(), today.day() - 1)
                .unwrap_or(birth),
        };
        if next < today {
            // Kalan günler yeni yılın doğum gününe kadar.
            let yil = today.year() + 1;
            next = match NaiveDate::from_ymd_opt(yil, birth.month(), birth.day()) {
                Some(d) => d,
                None => NaiveDate::from_ymd_opt(yil, birth.month(), birth.day() - 1)
                    .unwrap_or(next),
            };
        }
        let fark = (next - today).num_days();
        if fark <= horizon {
            out.push((
                r.try_get("user_id").map_err(|e| e.to_string())?,
                r.try_get("full_name").map_err(|e| e.to_string())?,
                next.format("%Y-%m-%d").to_string(),
            ));
        }
    }
    Ok(out)
}

/// `YYYY-MM-DD` biçimini doğrular. Gerçek tarih mi diye de kontrol eder:
/// `2026-02-30` biçim olarak geçerli ama takvimde yoktur.
fn is_iso_date(raw: &str) -> bool {
    NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d").is_ok()
}

// ---------------------------------------------------------------------------
// Vardiya planlaması
// ---------------------------------------------------------------------------

pub async fn list_shift_plans(
    pool: &SqlitePool,
    tenant_id: &str,
    from: &str,
    to: &str,
) -> Result<Vec<ShiftPlan>, String> {
    if from > to {
        return Err(format!("tarih araligi ters: {from} > {to}"));
    }
    let rows = sqlx::query(
        "SELECT sp.id, sp.user_id, sp.full_name, sp.plan_date, sp.start_time, sp.end_time,
                sp.planned_break_minutes, sp.role_required, sp.station, sp.status,
                sp.realized_shift_id
           FROM shift_plans sp
           JOIN users u ON u.id = sp.user_id AND u.tenant_id = sp.tenant_id
          WHERE sp.tenant_id = ?1 AND sp.plan_date >= ?2 AND sp.plan_date <= ?3
          ORDER BY sp.plan_date ASC, sp.start_time ASC",
    )
    .bind(tenant_id)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(ShiftPlan {
            id: r.try_get("id").map_err(|e| e.to_string())?,
            user_id: r.try_get("user_id").map_err(|e| e.to_string())?,
            user_name: r.try_get("full_name").map_err(|e| e.to_string())?,
            plan_date: r.try_get("plan_date").map_err(|e| e.to_string())?,
            start_time: r.try_get("start_time").map_err(|e| e.to_string())?,
            end_time: r.try_get("end_time").map_err(|e| e.to_string())?,
            planned_break_minutes: r
                .try_get("planned_break_minutes")
                .map_err(|e| e.to_string())?,
            role_required: r.try_get("role_required").map_err(|e| e.to_string())?,
            station: r.try_get("station").map_err(|e| e.to_string())?,
            status: r.try_get("status").map_err(|e| e.to_string())?,
            realized_shift_id: r.try_get("realized_shift_id").map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

/// Vardiya planı ekler. Bitiş, başlangıçtan sonra olmalıdır; aksi halde
/// "gece vardiyası" adı altında negatif saatli plan kaydedilirdi.
pub async fn add_shift_plan(
    pool: &SqlitePool,
    tenant_id: &str,
    actor_id: &str,
    plan: &ShiftPlanInput,
) -> Result<String, String> {
    if !is_iso_date(&plan.plan_date) {
        return Err("plan tarihi YYYY-MM-DD biciminde olmali".to_string());
    }
    if plan.end_time <= plan.start_time {
        return Err("vardiya bitisi baslangictan sonra olmali".to_string());
    }
    if plan.planned_break_minutes < 0 {
        return Err("mola negatif olamaz".to_string());
    }
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM users WHERE tenant_id = ?1 AND id = ?2 AND is_active = 1")
            .bind(tenant_id)
            .bind(&plan.user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
    if exists.is_none() {
        return Err(format!("kullanici bulunamadi: {}", plan.user_id));
    }

    let id = crate::id_generator::generate_id("spl");
    sqlx::query(
        "INSERT INTO shift_plans
             (id, tenant_id, user_id, plan_date, start_time, end_time,
              planned_break_minutes, role_required, station, status, created_by,
              created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'Planned', ?10,
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(&plan.user_id)
    .bind(&plan.plan_date)
    .bind(&plan.start_time)
    .bind(&plan.end_time)
    .bind(plan.planned_break_minutes)
    .bind(&plan.role_required)
    .bind(plan.station.as_deref())
    .bind(actor_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

// ---------------------------------------------------------------------------
// İzin
// ---------------------------------------------------------------------------

pub async fn list_leaves(
    pool: &SqlitePool,
    tenant_id: &str,
    user_id: Option<&str>,
) -> Result<Vec<LeaveRequest>, String> {
    let rows = match user_id {
        Some(u) => {
            sqlx::query(
                "SELECT id, user_id, kind, start_date, end_date, reason, status, approver_id, decided_at
                   FROM leave_requests WHERE tenant_id = ?1 AND user_id = ?2
                  ORDER BY start_date DESC",
            )
            .bind(tenant_id)
            .bind(u)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?
        }
        None => {
            sqlx::query(
                "SELECT id, user_id, kind, start_date, end_date, reason, status, approver_id, decided_at
                   FROM leave_requests WHERE tenant_id = ?1 ORDER BY start_date DESC",
            )
            .bind(tenant_id)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?
        }
    };

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(LeaveRequest {
            id: r.try_get("id").map_err(|e| e.to_string())?,
            user_id: r.try_get("user_id").map_err(|e| e.to_string())?,
            kind: r.try_get("kind").map_err(|e| e.to_string())?,
            start_date: r.try_get("start_date").map_err(|e| e.to_string())?,
            end_date: r.try_get("end_date").map_err(|e| e.to_string())?,
            reason: r.try_get("reason").map_err(|e| e.to_string())?,
            status: r.try_get("status").map_err(|e| e.to_string())?,
            approver_id: r.try_get("approver_id").map_err(|e| e.to_string())?,
            decided_at: r.try_get("decided_at").map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

/// İzin talebi oluşturur. Aynı kullanıcı için çakışan izin reddedilir;
/// müdür izin defterine bakıp onaylarken çakışmayı bilmelidir.
pub async fn request_leave(
    pool: &SqlitePool,
    tenant_id: &str,
    input: &LeaveInput,
) -> Result<String, String> {
    if !is_iso_date(&input.start_date) || !is_iso_date(&input.end_date) {
        return Err("izin tarihleri YYYY-MM-DD biciminde olmali".to_string());
    }
    if input.end_date < input.start_date {
        return Err("izin bitişi baslangictan once olamaz".to_string());
    }
    let cakisma: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM leave_requests
          WHERE tenant_id = ?1 AND user_id = ?2 AND status IN ('Bekliyor','Onaylandi')
            AND start_date <= ?3 AND end_date >= ?4",
    )
    .bind(tenant_id)
    .bind(&input.user_id)
    .bind(&input.end_date)
    .bind(&input.start_date)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    if cakisma > 0 {
        return Err("bu tarihlerde zaten bir izin talebi var".to_string());
    }

    let id = crate::id_generator::generate_id("lve");
    sqlx::query(
        "INSERT INTO leave_requests
             (id, tenant_id, user_id, kind, start_date, end_date, reason, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'Bekliyor',
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(&input.user_id)
    .bind(&input.kind)
    .bind(&input.start_date)
    .bind(&input.end_date)
    .bind(input.reason.as_deref())
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

/// İzin kararı. Karar veren kişi talebi oluşturan olamaz (self-approval yasağı).
pub async fn decide_leave(
    pool: &SqlitePool,
    tenant_id: &str,
    approver_id: &str,
    leave_id: &str,
    approve: bool,
) -> Result<(), String> {
    let row = sqlx::query(
        "SELECT user_id, status FROM leave_requests WHERE tenant_id = ?1 AND id = ?2",
    )
    .bind(tenant_id)
    .bind(leave_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    let Some(row) = row else {
        return Err("izin talebi bulunamadi".to_string());
    };
    let talep_sahibi: String = row.try_get("user_id").map_err(|e| e.to_string())?;
    if talep_sahibi == approver_id {
        return Err("kendi iznini kendin onaylayamazsin".to_string());
    }
    let durum: String = row.try_get("status").map_err(|e| e.to_string())?;
    if durum != "Bekliyor" {
        return Err(format!("izin talebi zaten kararli: {durum}"));
    }

    sqlx::query(
        "UPDATE leave_requests SET status = ?3, approver_id = ?4, decided_at = ?5
          WHERE tenant_id = ?1 AND id = ?2",
    )
    .bind(tenant_id)
    .bind(leave_id)
    .bind(if approve { "Onaylandi" } else { "Reddedildi" })
    .bind(approver_id)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Zimmet
// ---------------------------------------------------------------------------

pub async fn list_custody(
    pool: &SqlitePool,
    tenant_id: &str,
    only_open: bool,
) -> Result<Vec<CustodyRecord>, String> {
    let sql = if only_open {
        "SELECT id, user_id, item_name, quantity, status, delivered_at, returned_at, notes
           FROM custody_records WHERE tenant_id = ?1 AND status = 'Teslim'
          ORDER BY delivered_at DESC"
    } else {
        "SELECT id, user_id, item_name, quantity, status, delivered_at, returned_at, notes
           FROM custody_records WHERE tenant_id = ?1 ORDER BY delivered_at DESC"
    };
    let rows = sqlx::query(sql)
        .bind(tenant_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(CustodyRecord {
            id: r.try_get("id").map_err(|e| e.to_string())?,
            user_id: r.try_get("user_id").map_err(|e| e.to_string())?,
            item_name: r.try_get("item_name").map_err(|e| e.to_string())?,
            quantity: r.try_get("quantity").map_err(|e| e.to_string())?,
            status: r.try_get("status").map_err(|e| e.to_string())?,
            delivered_at: r.try_get("delivered_at").map_err(|e| e.to_string())?,
            returned_at: r.try_get("returned_at").map_err(|e| e.to_string())?,
            notes: r.try_get("notes").map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

pub async fn add_custody(
    pool: &SqlitePool,
    tenant_id: &str,
    user_id: &str,
    item_name: &str,
    quantity: i64,
    notes: Option<&str>,
) -> Result<String, String> {
    let name = item_name.trim();
    if name.is_empty() {
        return Err("zimmet kalemi bos olamaz".to_string());
    }
    if quantity <= 0 {
        return Err("adet sifirdan buyuk olmali".to_string());
    }
    let id = crate::id_generator::generate_id("cst");
    sqlx::query(
        "INSERT INTO custody_records
             (id, tenant_id, user_id, item_name, quantity, status, delivered_at, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, 'Teslim',
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?6)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(user_id)
    .bind(name)
    .bind(quantity)
    .bind(notes)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

pub async fn return_custody(
    pool: &SqlitePool,
    tenant_id: &str,
    custody_id: &str,
    damaged: bool,
) -> Result<(), String> {
    let row = sqlx::query("SELECT status FROM custody_records WHERE tenant_id = ?1 AND id = ?2")
        .bind(tenant_id)
        .bind(custody_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    let Some(row) = row else {
        return Err("zimmet kaydi bulunamadi".to_string());
    };
    let durum: String = row.try_get("status").map_err(|e| e.to_string())?;
    if durum != "Teslim" {
        return Err(format!("zimmet zaten kapali: {durum}"));
    }
    sqlx::query(
        "UPDATE custody_records SET status = ?3, returned_at = ?4 WHERE tenant_id = ?1 AND id = ?2",
    )
    .bind(tenant_id)
    .bind(custody_id)
    .bind(if damaged { "Hasarli" } else { "Iade" })
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tutanak sicili
// ---------------------------------------------------------------------------

pub async fn list_incidents(
    pool: &SqlitePool,
    tenant_id: &str,
    user_id: Option<&str>,
) -> Result<Vec<Incident>, String> {
    let rows = match user_id {
        Some(u) => {
            sqlx::query(
                "SELECT id, user_id, kind, severity, occurred_at, summary, details, resolution, status, recorded_by
                   FROM staff_incidents WHERE tenant_id = ?1 AND user_id = ?2
                  ORDER BY occurred_at DESC",
            )
            .bind(tenant_id)
            .bind(u)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?
        }
        None => {
            sqlx::query(
                "SELECT id, user_id, kind, severity, occurred_at, summary, details, resolution, status, recorded_by
                   FROM staff_incidents WHERE tenant_id = ?1 ORDER BY occurred_at DESC",
            )
            .bind(tenant_id)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?
        }
    };

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(Incident {
            id: r.try_get("id").map_err(|e| e.to_string())?,
            user_id: r.try_get("user_id").map_err(|e| e.to_string())?,
            kind: r.try_get("kind").map_err(|e| e.to_string())?,
            severity: r.try_get("severity").map_err(|e| e.to_string())?,
            occurred_at: r.try_get("occurred_at").map_err(|e| e.to_string())?,
            summary: r.try_get("summary").map_err(|e| e.to_string())?,
            details: r.try_get("details").map_err(|e| e.to_string())?,
            resolution: r.try_get("resolution").map_err(|e| e.to_string())?,
            status: r.try_get("status").map_err(|e| e.to_string())?,
            recorded_by: r.try_get("recorded_by").map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

pub async fn record_incident(
    pool: &SqlitePool,
    tenant_id: &str,
    recorder_id: &str,
    input: &IncidentInput,
) -> Result<String, String> {
    let ozet = input.summary.trim();
    if ozet.is_empty() {
        return Err("tutanak ozeti bos olamaz".to_string());
    }
    let id = crate::id_generator::generate_id("inc");
    sqlx::query(
        "INSERT INTO staff_incidents
             (id, tenant_id, user_id, kind, severity, occurred_at, summary, details, status, recorded_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ACIK', ?9,
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(&input.user_id)
    .bind(&input.kind)
    .bind(&input.severity)
    .bind(&input.occurred_at)
    .bind(ozet)
    .bind(input.details.as_deref())
    .bind(recorder_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}