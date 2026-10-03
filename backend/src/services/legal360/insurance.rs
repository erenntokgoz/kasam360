//! Sigorta poliçeleri (işyeri, sorumluluk, SGK, kasko).
//!
//! İki parasal kolon ayrıdır ve karıştırılmamalıdır:
//!   * `premium_cents` — işletmenin **ödediği** prim (gider),
//!   * `coverage_cents` — poliçenin **teminat** tutarı (garanti).
//!
//! `coverage_cents` NULL olabilir ve NULL kalır: "teminatı bilmiyoruz" ile
//! "teminat yok" farklı belgelerdir. NULL'u `0`'a çevirmek poliçeyi limitsiz
//! gösterir (AGENTS.md §3.4).

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use super::{
    bayrak_al, gun_kaydir, hatirlatma_dogrula, metin_al, tam_sayi_al, tarih_dogrula, tutar_dogrula,
};
use crate::id_generator::generate_id;

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
pub struct InsurancePolicy {
    pub id: String,
    pub policy_type: String,
    pub insurance_company: String,
    pub policy_number: String,
    pub premium_cents: i64,
    pub coverage_cents: Option<i64>,
    pub issue_date: String,
    pub expiry_date: String,
    pub reminder_days: i64,
    pub notes: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyInput {
    pub id: Option<String>,
    pub policy_type: String,
    pub insurance_company: String,
    pub policy_number: String,
    pub premium_cents: i64,
    pub coverage_cents: Option<i64>,
    pub issue_date: String,
    pub expiry_date: String,
    pub reminder_days: Option<i64>,
    pub notes: Option<String>,
    pub is_active: Option<bool>,
}

const POLICY_TYPES: [&str; 5] = ["ISYERI", "SORUMLULUK", "SGK", "KASKO", "DIGER"];

pub async fn save_policy(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    input: PolicyInput,
) -> Result<InsurancePolicy, String> {
    let policy_type = input.policy_type.trim().to_ascii_uppercase();
    if !POLICY_TYPES.contains(&policy_type.as_str()) {
        return Err(format!(
            "VALIDATION: poliçe türü geçersiz. Seçilebilir: {}",
            POLICY_TYPES.join(", ")
        ));
    }

    let sirket = input.insurance_company.trim();
    if sirket.is_empty() {
        return Err("VALIDATION: sigorta şirketi boş olamaz".into());
    }
    let numara = input.policy_number.trim();
    if numara.is_empty() {
        return Err("VALIDATION: poliçe numarası boş olamaz".into());
    }

    tutar_dogrula("prim", Some(input.premium_cents))?;
    tutar_dogrula("teminat", input.coverage_cents)?;
    tarih_dogrula("düzenleme tarihi", &input.issue_date)?;
    tarih_dogrula("bitiş tarihi", &input.expiry_date)?;
    let issue_date = input.issue_date.trim().to_string();
    let expiry_date = input.expiry_date.trim().to_string();
    if expiry_date.as_str() < issue_date.as_str() {
        return Err("VALIDATION: bitiş tarihi düzenleme tarihinden önce olamaz".into());
    }

    let reminder_days = input.reminder_days.unwrap_or(30);
    hatirlatma_dogrula(reminder_days)?;
    let is_active = input.is_active.unwrap_or(true);

    let id = match input.id.as_deref() {
        Some(mevcut) => {
            crate::management_commands::ensure_owned(conn, "insurance_policies", mevcut, tenant_id)
                .await?;
            sqlx::query(
                "UPDATE insurance_policies
                    SET policy_type = ?, insurance_company = ?, policy_number = ?,
                        premium_cents = ?, coverage_cents = ?, issue_date = ?,
                        expiry_date = ?, reminder_days = ?, notes = ?, is_active = ?,
                        updated_at = CURRENT_TIMESTAMP
                  WHERE id = ? AND tenant_id = ?",
            )
            .bind(&policy_type)
            .bind(sirket)
            .bind(numara)
            .bind(input.premium_cents)
            .bind(input.coverage_cents)
            .bind(&issue_date)
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
            let yeni = generate_id("pol");
            sqlx::query(
                "INSERT INTO insurance_policies
                     (id, tenant_id, policy_type, insurance_company, policy_number,
                      premium_cents, coverage_cents, issue_date, expiry_date,
                      reminder_days, notes, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&yeni)
            .bind(tenant_id)
            .bind(&policy_type)
            .bind(sirket)
            .bind(numara)
            .bind(input.premium_cents)
            .bind(input.coverage_cents)
            .bind(&issue_date)
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

    Ok(InsurancePolicy {
        id,
        policy_type,
        insurance_company: sirket.to_string(),
        policy_number: numara.to_string(),
        premium_cents: input.premium_cents,
        coverage_cents: input.coverage_cents,
        issue_date,
        expiry_date,
        reminder_days,
        notes: input.notes,
        is_active,
    })
}

pub async fn list_policies(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    policy_type: Option<&str>,
) -> Result<Vec<InsurancePolicy>, String> {
    let mut sql = String::from(
        "SELECT id, policy_type, insurance_company, policy_number, premium_cents,
                coverage_cents, issue_date, expiry_date, reminder_days, notes, is_active
           FROM insurance_policies
          WHERE tenant_id = ?",
    );
    if policy_type.is_some() {
        sql.push_str(" AND policy_type = ?");
    }
    sql.push_str(" ORDER BY expiry_date ASC");

    let mut sorgu = sqlx::query(&sql).bind(tenant_id);
    if let Some(tur) = policy_type {
        sorgu = sorgu.bind(tur.trim().to_ascii_uppercase());
    }

    let rows = sorgu
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    let mut sonuc = Vec::new();
    for row in rows {
        sonuc.push(politika_oku(&row)?);
    }
    Ok(sonuc)
}

/// Süresi dolan veya dolmak üzere olan poliçeler.
///
/// `pencere_gun` **satır bazlıdır**: her poliçenin kendi `reminder_days`
/// değeri vardır. Ortak bir pencere kullanılsaydı 15 gün hatırlatma isteyen
/// kasko poliçesi 60 günlük listede görünmez ve yenilenmeden expire olurdu.
pub async fn get_expiring_policies(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    pencere_gun: i64,
) -> Result<Vec<InsurancePolicy>, String> {
    hatirlatma_dogrula(pencere_gun)?;
    let sinir = gun_kaydir(pencere_gun);

    let rows = sqlx::query(
        "SELECT id, policy_type, insurance_company, policy_number, premium_cents,
                coverage_cents, issue_date, expiry_date, reminder_days, notes, is_active
           FROM insurance_policies
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
        sonuc.push(politika_oku(&row)?);
    }
    Ok(sonuc)
}

/// Poliçe satırını okur.
///
/// Kuruş kolonları `try_get(...)?` ile okunur; `unwrap_or(0)` yazılsaydı
/// prim eksik olan bir satır "0 prim" olarak raporlanır ve toplam prim tutarı
/// yanlış çıkardı.
fn politika_oku(row: &sqlx::sqlite::SqliteRow) -> Result<InsurancePolicy, String> {
    Ok(InsurancePolicy {
        id: row.try_get("id").map_err(|e| e.to_string())?,
        policy_type: row.try_get("policy_type").map_err(|e| e.to_string())?,
        insurance_company: row
            .try_get("insurance_company")
            .map_err(|e| e.to_string())?,
        policy_number: row.try_get("policy_number").map_err(|e| e.to_string())?,
        premium_cents: row.try_get("premium_cents").map_err(|e| e.to_string())?,
        coverage_cents: tam_sayi_al(row, "coverage_cents")?,
        issue_date: row.try_get("issue_date").map_err(|e| e.to_string())?,
        expiry_date: row.try_get("expiry_date").map_err(|e| e.to_string())?,
        reminder_days: row.try_get("reminder_days").map_err(|e| e.to_string())?,
        notes: metin_al(row, "notes")?,
        is_active: bayrak_al(row, "is_active")?,
    })
}

/// Toplam yıllık prim (kuruş).
///
/// Boş tabloda `0` döner — bu bir **toplam** sorgusudur ve `COALESCE` doğrudur:
/// kayıt yoksa toplam gerçekten sıfırdır. Satır okuma yollarında kullanılan
/// `unwrap_or(0)` yasağı burada geçerli değildir; yasak olan, tek satırın
/// eksik kolonunu sıfıra çevirmektir.
pub async fn total_premium_cents(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<i64, String> {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(premium_cents), 0) FROM insurance_policies
          WHERE tenant_id = ? AND is_active = 1",
    )
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())
}
