//! Müzik telif lisansları (MESAM, MSG, Bilgi Sistemi).
//!
//! Bu üç kuruluş ayrı lisanslar keser ve aynı işletmeye üç ayrı borç yazar.
//! Tek bir "telif kaydı" altında toplarları yanlış olur: biri ödenmiş diğeri
//! ödenmemiş olabilir ve borç bakiyesi görünmez.
//!
//! `year` kolonu ayrıdır: lisans yıllıktır ve lisans bedeli yıla göre
//! değişir. Aynı işletmenin iki farklı yıl için ayrı kaydı olabilir; bu yüzden
//! (tenant_id, year, license_type) üçlüsü tekilleştirilir.

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use super::{
    bayrak_al, bugun, gun_kaydir, hatirlatma_dogrula, metin_al, tarih_dogrula, tutar_dogrula,
};
use crate::id_generator::generate_id;

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
pub struct MusicLicense {
    pub id: String,
    pub license_type: String,
    pub year: i64,
    pub amount_cents: i64,
    pub expiry_date: String,
    pub reminder_days: i64,
    pub notes: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicLicenseInput {
    pub id: Option<String>,
    pub license_type: String,
    pub year: i64,
    pub amount_cents: i64,
    pub expiry_date: String,
    pub reminder_days: Option<i64>,
    pub notes: Option<String>,
    pub is_active: Option<bool>,
}

const LICENSE_TYPES: [&str; 4] = ["MESAM", "MSG", "BILGI", "DIGER"];

pub async fn save_license(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    input: MusicLicenseInput,
) -> Result<MusicLicense, String> {
    let license_type = input.license_type.trim().to_ascii_uppercase();
    if !LICENSE_TYPES.contains(&license_type.as_str()) {
        return Err(format!(
            "VALIDATION: lisans türü geçersiz. Seçilebilir: {}",
            LICENSE_TYPES.join(", ")
        ));
    }
    if !(1900..=2200).contains(&input.year) {
        return Err("VALIDATION: lisans yılı 1900-2200 arasında olmalı".into());
    }
    tutar_dogrula("lisans bedeli", Some(input.amount_cents))?;
    tarih_dogrula("bitiş tarihi", &input.expiry_date)?;
    let expiry_date = input.expiry_date.trim().to_string();
    let reminder_days = input.reminder_days.unwrap_or(30);
    hatirlatma_dogrula(reminder_days)?;
    let is_active = input.is_active.unwrap_or(true);

    // Aynı tür ve yıl için ikinci kayıt açılmasına izin verilmez: bedel
    // üstüne yazılır ve hangi ödemenin hangi yıla ait olduğu kaybolur.
    let cakisma: Option<String> = sqlx::query_scalar(
        "SELECT id FROM music_licenses
          WHERE tenant_id = ? AND license_type = ? AND year = ? AND (? IS NULL OR id <> ?)",
    )
    .bind(tenant_id)
    .bind(&license_type)
    .bind(input.year)
    .bind(input.id.as_deref())
    .bind(input.id.as_deref())
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if cakisma.is_some() {
        return Err(format!(
            "VALIDATION: {license_type} lisansı için {} yılı zaten kayıtlı",
            input.year
        ));
    }

    let id = match input.id.as_deref() {
        Some(mevcut) => {
            crate::management_commands::ensure_owned(conn, "music_licenses", mevcut, tenant_id)
                .await?;
            sqlx::query(
                "UPDATE music_licenses
                    SET license_type = ?, year = ?, amount_cents = ?, expiry_date = ?,
                        reminder_days = ?, notes = ?, is_active = ?
                  WHERE id = ? AND tenant_id = ?",
            )
            .bind(&license_type)
            .bind(input.year)
            .bind(input.amount_cents)
            .bind(&expiry_date)
            .bind(reminder_days)
            .bind(input.notes.as_deref().map(str::trim))
            .bind(is_active)
            .bind(mevcut)
            .bind(tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            mevcut.to_string()
        }
        None => {
            let yeni = generate_id("lic");
            sqlx::query(
                "INSERT INTO music_licenses
                     (id, tenant_id, license_type, year, amount_cents, expiry_date,
                      reminder_days, notes, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&yeni)
            .bind(tenant_id)
            .bind(&license_type)
            .bind(input.year)
            .bind(input.amount_cents)
            .bind(&expiry_date)
            .bind(reminder_days)
            .bind(input.notes.as_deref().map(str::trim))
            .bind(is_active)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            yeni
        }
    };

    Ok(MusicLicense {
        id,
        license_type,
        year: input.year,
        amount_cents: input.amount_cents,
        expiry_date,
        reminder_days,
        notes: input.notes,
        is_active,
    })
}

pub async fn list_licenses(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    year: Option<i64>,
) -> Result<Vec<MusicLicense>, String> {
    let mut sql = String::from(
        "SELECT id, license_type, year, amount_cents, expiry_date, reminder_days, notes, is_active
           FROM music_licenses
          WHERE tenant_id = ?",
    );
    if year.is_some() {
        sql.push_str(" AND year = ?");
    }
    sql.push_str(" ORDER BY year DESC, license_type ASC");

    let mut sorgu = sqlx::query(&sql).bind(tenant_id);
    if let Some(yil) = year {
        sorgu = sorgu.bind(yil);
    }

    let rows = sorgu
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    let mut sonuc = Vec::new();
    for row in rows {
        sonuc.push(lisans_oku(&row)?);
    }
    Ok(sonuc)
}

/// Süresi dolan veya dolmak üzere olan lisanslar. Pencere satır bazlıdır:
/// her kaydın kendi `reminder_days` değeri vardır.
pub async fn get_expiring_licenses(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    pencere_gun: i64,
) -> Result<Vec<MusicLicense>, String> {
    hatirlatma_dogrula(pencere_gun)?;
    let sinir = gun_kaydir(pencere_gun);

    let rows = sqlx::query(
        "SELECT id, license_type, year, amount_cents, expiry_date, reminder_days, notes, is_active
           FROM music_licenses
          WHERE tenant_id = ? AND is_active = 1
            AND expiry_date <= date(?, '+' || reminder_days || ' days')
          ORDER BY expiry_date ASC",
    )
    .bind(tenant_id)
    .bind(&sinir)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut sonuc = Vec::new();
    for row in rows {
        sonuc.push(lisans_oku(&row)?);
    }
    Ok(sonuc)
}

/// Bir yılın toplam telif borcu (kuruş).
///
/// `COALESCE` burada doğrudur: kayıt yoksa yılın borcu gerçekten sıfırdır ve
/// bu bir **toplam** sorgusudur. Satır okuma yollarındaki `unwrap_or(0)` yasağı
/// tek satırın eksik kolonunu sıfıra çevirmeyi yasaklar; toplamın kendisi
/// meşrudur.
pub async fn total_license_cents(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    year: i64,
) -> Result<i64, String> {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM music_licenses
          WHERE tenant_id = ? AND year = ? AND is_active = 1",
    )
    .bind(tenant_id)
    .bind(year)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())
}

/// Bugüne kadar süresi dolmuş lisans sayısı.
///
/// Denetim sorusu "geçen yılın telifini ödedik mi"dir; cevap bir sayı olmalıdır.
/// `COUNT` her zaman tek satır döndürür, bu yüzden burada `COALESCE` gerekmez.
pub async fn expired_count(conn: &mut SqliteConnection, tenant_id: &str) -> Result<i64, String> {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM music_licenses
          WHERE tenant_id = ? AND is_active = 1 AND expiry_date < ?",
    )
    .bind(tenant_id)
    .bind(bugun())
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())
}

fn lisans_oku(row: &sqlx::sqlite::SqliteRow) -> Result<MusicLicense, String> {
    Ok(MusicLicense {
        id: row.try_get("id").map_err(|e| e.to_string())?,
        license_type: row.try_get("license_type").map_err(|e| e.to_string())?,
        year: row.try_get("year").map_err(|e| e.to_string())?,
        amount_cents: row.try_get("amount_cents").map_err(|e| e.to_string())?,
        expiry_date: row.try_get("expiry_date").map_err(|e| e.to_string())?,
        reminder_days: row.try_get("reminder_days").map_err(|e| e.to_string())?,
        notes: metin_al(row, "notes")?,
        is_active: bayrak_al(row, "is_active")?,
    })
}
