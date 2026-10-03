//! Özel gün takvimi ve yıllık tekrarlar.
//!
//! Neden `recurring_yearly` ayrı bir alan: 29 Kasım (Kara Cuma) her yıl aynı
//! gün tekrarlar; 8 Mart bayramı da tekrarlar ama kuralı başka. Tek bir
//! `recurring` bayrağı ikisini de "yıllık" yapar ve ayrım kaybolur.
//!
//! `advance_days` indirimin başlamasından kaç gün önce başlayacağıdır. Kafe
//! tabelasını asmak için pazartesi hazırlamak gerekir; bu yüzden "gün
//! geldiğinde hatırlat" modeli işe yaramaz.

use chrono::Datelike;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use super::{bayrak_al, metin_al, tarih_dogrula};
use crate::id_generator::generate_id;

/// İndirim üst sınırı: %90.
///
/// Neden 100 değil: %100 indirim satışı değildir, zarardır ve stok düşümünü
/// üretirken zarar yazar. Ciro hedefi %90'ın üstünde bir "kampanya" değildir.
const EN_COK_INDIRIM: i64 = 90;

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
pub struct SpecialDay {
    pub id: String,
    pub name: String,
    pub date: String,
    pub recurring_yearly: bool,
    pub advance_days: i64,
    pub discount_percent: i64,
    pub description: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialDayInput {
    pub id: Option<String>,
    pub name: String,
    pub date: String,
    pub recurring_yearly: Option<bool>,
    pub advance_days: Option<i64>,
    pub discount_percent: Option<i64>,
    pub description: Option<String>,
    pub is_active: Option<bool>,
}

pub async fn save_special_day(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    input: SpecialDayInput,
) -> Result<SpecialDay, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("VALIDATION: özel gün adı boş olamaz".into());
    }
    tarih_dogrula("özel gün tarihi", &input.date)?;
    let date = input.date.trim().to_string();

    let advance_days = input.advance_days.unwrap_or(7);
    if !(0..=90).contains(&advance_days) {
        return Err("VALIDATION: hazırlık süresi 0-90 gün arasında olmalı".into());
    }

    let discount_percent = input.discount_percent.unwrap_or(0);
    if !(0..=EN_COK_INDIRIM).contains(&discount_percent) {
        return Err(format!(
            "VALIDATION: indirim yüzdesi 0-{EN_COK_INDIRIM} arasında olmalı"
        ));
    }

    let recurring_yearly = input.recurring_yearly.unwrap_or(false);
    let is_active = input.is_active.unwrap_or(true);

    let id = match input.id.as_deref() {
        Some(mevcut) => {
            crate::management_commands::ensure_owned(conn, "special_days", mevcut, tenant_id)
                .await?;
            sqlx::query(
                "UPDATE special_days
                    SET name = ?, date = ?, recurring_yearly = ?, advance_days = ?,
                        discount_percent = ?, description = ?, is_active = ?
                  WHERE id = ? AND tenant_id = ?",
            )
            .bind(name)
            .bind(&date)
            .bind(recurring_yearly)
            .bind(advance_days)
            .bind(discount_percent)
            .bind(input.description.as_deref().map(str::trim))
            .bind(is_active)
            .bind(mevcut)
            .bind(tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            mevcut.to_string()
        }
        None => {
            let yeni = generate_id("spd");
            sqlx::query(
                "INSERT INTO special_days
                     (id, tenant_id, name, date, recurring_yearly, advance_days,
                      discount_percent, description, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&yeni)
            .bind(tenant_id)
            .bind(name)
            .bind(&date)
            .bind(recurring_yearly)
            .bind(advance_days)
            .bind(discount_percent)
            .bind(input.description.as_deref().map(str::trim))
            .bind(is_active)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            yeni
        }
    };

    Ok(SpecialDay {
        id,
        name: name.to_string(),
        date,
        recurring_yearly,
        advance_days,
        discount_percent,
        description: input.description,
        is_active,
    })
}

pub async fn list_special_days(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<SpecialDay>, String> {
    let rows = sqlx::query(
        "SELECT id, name, date, recurring_yearly, advance_days, discount_percent,
                description, is_active
           FROM special_days
          WHERE tenant_id = ?
          ORDER BY date ASC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut sonuc = Vec::new();
    for row in rows {
        sonuc.push(SpecialDay {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            name: row.try_get("name").map_err(|e| e.to_string())?,
            date: row.try_get("date").map_err(|e| e.to_string())?,
            recurring_yearly: bayrak_al(&row, "recurring_yearly")?,
            advance_days: row.try_get("advance_days").map_err(|e| e.to_string())?,
            discount_percent: row.try_get("discount_percent").map_err(|e| e.to_string())?,
            description: metin_al(&row, "description")?,
            is_active: bayrak_al(&row, "is_active")?,
        });
    }
    Ok(sonuc)
}

/// Bir tekrarlayan özel günün bir sonraki gerçekleşme tarihi.
///
/// Kayıttaki yıl bilgi taşıyıcı değildir: 29 Kasım 2024 kaydı 2027'de de
/// Kasım 29'dur. Bu yüzden bugünden sonraki en yakın yıl seçilir.
///
/// Bugüne denk gelen bir tekrarda **bugün** seçilir, yarın değil: bugünün
/// kampanyası bu akşam başlıyor olabilir.
pub(crate) fn sonraki_gerceklesme(tarih: &str, bugun: chrono::NaiveDate) -> Result<String, String> {
    let taban = chrono::NaiveDate::parse_from_str(tarih, "%Y-%m-%d")
        .map_err(|_| format!("VALIDATION: saklanan tarih okunamadı: {tarih}"))?;
    let mut aday = taban
        .with_year(bugun.year())
        .ok_or_else(|| format!("VALIDATION: yıl dönüşümü başarısız: {tarih}"))?;
    if aday < bugun {
        aday = taban
            .with_year(bugun.year() + 1)
            .ok_or_else(|| format!("VALIDATION: yıl dönüşümü başarısız: {tarih}"))?;
    }
    Ok(aday.format("%Y-%m-%d").to_string())
}

/// Yaklaşan özel günler: bugünden itibaren `kapsam_gun` gün içinde gerçekleşen
/// etkin günler, en yakın tarih önce.
///
/// Kapsama hazırlık süresi de dahildir: 29 Kasım için 7 gün önceden bildirim
/// üretmek için `kapsam_gun` en az `advance_days` olmalıdır. Bu birleştirme
/// bilinçlidir — işletme sahibi "hazırlanmaya başlamam gereken gün" sorusunu
/// sorar, "olacak gün" değil.
pub async fn list_upcoming_special_days(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    kapsam_gun: i64,
) -> Result<Vec<(SpecialDay, String, i64)>, String> {
    if !(1..=365).contains(&kapsam_gun) {
        return Err("VALIDATION: kapsam 1-365 gün arasında olmalı".into());
    }
    let bugun_tarih = chrono::Local::now().date_naive();
    let sinir = (bugun_tarih + chrono::Duration::days(kapsam_gun))
        .format("%Y-%m-%d")
        .to_string();
    let bugun_metni = bugun_tarih.format("%Y-%m-%d").to_string();

    let rows = sqlx::query(
        "SELECT id, name, date, recurring_yearly, advance_days, discount_percent,
                description, is_active
           FROM special_days
          WHERE tenant_id = ? AND is_active = 1
          ORDER BY date ASC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut sonuc = Vec::new();
    for row in rows {
        let gun = SpecialDay {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            name: row.try_get("name").map_err(|e| e.to_string())?,
            date: row.try_get("date").map_err(|e| e.to_string())?,
            recurring_yearly: bayrak_al(&row, "recurring_yearly")?,
            advance_days: row.try_get("advance_days").map_err(|e| e.to_string())?,
            discount_percent: row.try_get("discount_percent").map_err(|e| e.to_string())?,
            description: metin_al(&row, "description")?,
            is_active: bayrak_al(&row, "is_active")?,
        };

        let gerceklesme = if gun.recurring_yearly {
            sonraki_gerceklesme(&gun.date, bugun_tarih)?
        } else {
            gun.date.clone()
        };

        if gerceklesme < bugun_metni || gerceklesme > sinir {
            continue;
        }

        // Hazırlık süresi bugün dolmuşsa kalan gün negatif olur; 0'a düşürülür
        // çünkü "bugünden kaç gün hazırlık gerekiyor" sorusu negatif cevap
        // istemez, "zamanı geldi" demektir.
        let kalan = (bugun_tarih
            - chrono::NaiveDate::parse_from_str(&gerceklesme, "%Y-%m-%d")
                .map_err(|_| "VALIDATION: gerçekleşme tarihi okunamadı".to_string())?)
        .num_days()
            + gun.advance_days;
        let kalan = if kalan < 0 { 0 } else { kalan };
        sonuc.push((gun, gerceklesme, kalan));
    }

    sonuc.sort_by(|a, b| a.1.cmp(&b.1));
    Ok(sonuc)
}
