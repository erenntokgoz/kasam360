//! Personel profili servisi: profil kaydı ve doğum günü listesi.
//!
//! Maaş gizliliği (AGENTS.md §3.2): maaş kolonları servis tarafından taşınır
//! ama `can_view_amounts` yetkisi yoksa `None` olarak döner. `0` bir maaş
//! olabilir; "görünmüyor" ile "sıfır" ayrılır.

use chrono::{Datelike, NaiveDate};
use sqlx::{Row, SqlitePool};

use crate::services::staff360::staff_types::{StaffProfile, StaffProfileInput};

use super::{is_iso_date, read_amount};

/// yetki yoksa `base_salary_cents`/`commission_percent` `None` döner.
pub async fn list_profiles(
    pool: &SqlitePool,
    tenant_id: &str,
    can_view_amounts: bool,
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
            base_salary_cents: read_amount(&r, "base_salary_cents", can_view_amounts)?,
            commission_percent: read_amount(&r, "commission_percent", can_view_amounts)?,
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
///
/// Maaş ve komisyon **yalnız `OWNER`** tarafından yazılabilir. `can_write_amounts`
/// kapalıyken gelen tutarlar yok sayılmaz, hata verilir: sessizce yazılmaması
/// patronun "maaşı güncelledim" sanmasına yol açardı.
pub async fn upsert_profile(
    pool: &SqlitePool,
    tenant_id: &str,
    actor_id: &str,
    can_write_amounts: bool,
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
    if let Some(maas) = input.base_salary_cents {
        if maas < 0 {
            return Err("maas negatif olamaz".to_string());
        }
    }
    if let Some(komisyon) = input.commission_percent {
        if !(0..=100).contains(&komisyon) {
            return Err("komisyon yuzdesi 0-100 araliginda olmali".to_string());
        }
    }
    // Tutar yazma yetkisi kapısı: yetkisiz çağıran tutar gönderirse istek
    // reddedilir (sessizce yok sayılmaz — patron "güncellendi" sanar).
    // Göndermezse alan `None` kalır ve UPSERT eski değeri korur.
    if !can_write_amounts
        && (input.base_salary_cents.is_some() || input.commission_percent.is_some())
    {
        return Err(
            "UNAUTHORIZED: maas ve komisyon yalnizca isletme sahibi tarafindan guncellenebilir"
                .to_string(),
        );
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

    // Tutar alanları COALESCE ile korunur: `None` gelen değer mevcut
    // sütunu ezmez. Müdürün tutarsız kaydı maaşı sıfırlamaz.
    sqlx::query(
        "INSERT INTO staff_profiles
             (id, tenant_id, user_id, full_name, base_salary_cents, commission_percent,
              birth_date, hire_date, phone, national_id, address, emergency_contact, notes,
              created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET full_name = excluded.full_name,
                       base_salary_cents = COALESCE(excluded.base_salary_cents, staff_profiles.base_salary_cents),
                       commission_percent = COALESCE(excluded.commission_percent, staff_profiles.commission_percent),
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

