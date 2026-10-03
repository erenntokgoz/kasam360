//! Yasal belge takvimi (ruhsat, yangın, HACCP, vergi, SGK).
//!
//! Neden ayrı tablo: bu belgelerin ortak noktası "son kullanma tarihi +
//! hatırlatma". Farklı belge türleri farklı otorite ve numara taşır; tek bir
//! `documents` tablosunda her tür için NULL dolgu yapmak okunabilirliği düşürür
//! ve hangi kolonun o türde anlamlı olduğu koddan anlaşılmaz olur.
//!
//! Silme yasağı: belge kaydı denetim izidir. Kayıt silinirse "bu ruhsat hiç
//! alınmadı" ile "alındı ve iptal edildi" ayırt edilemez. Bu yüzden
//! `is_active = 0` ile pasifleştirilir ve geçmiş hatırlatma kaydı korunur.

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use super::{bayrak_al, gun_kaydir, hatirlatma_dogrula, metin_al, tarih_dogrula};
use crate::id_generator::generate_id;

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
pub struct LegalDocument {
    pub id: String,
    pub doc_type: String,
    pub title: String,
    pub authority: Option<String>,
    pub document_number: Option<String>,
    pub issue_date: Option<String>,
    pub expiry_date: String,
    pub reminder_days: i64,
    pub file_path: Option<String>,
    pub notes: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegalDocumentInput {
    /// `None` yeni kayıt açar; `Some` mevcut kaydı günceller.
    pub id: Option<String>,
    pub doc_type: String,
    pub title: String,
    pub authority: Option<String>,
    pub document_number: Option<String>,
    pub issue_date: Option<String>,
    pub expiry_date: String,
    pub reminder_days: Option<i64>,
    pub file_path: Option<String>,
    pub notes: Option<String>,
    pub is_active: Option<bool>,
}

/// Tanınan belge türleri. `CHECK` ile aynı küme veritabanında da dondurulur;
/// buradaki liste yalnızca kullanıcıya anlaşılır hata mesajı üretir.
const DOC_TYPES: [&str; 6] = ["RUHSAT", "YANGIN", "HACCP", "VERGI", "SGK", "DIGER"];

pub async fn save_document(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    input: LegalDocumentInput,
) -> Result<LegalDocument, String> {
    let doc_type = input.doc_type.trim().to_ascii_uppercase();
    if !DOC_TYPES.contains(&doc_type.as_str()) {
        return Err(format!(
            "VALIDATION: belge türü geçersiz. Seçilebilir: {}",
            DOC_TYPES.join(", ")
        ));
    }

    let title = input.title.trim();
    if title.is_empty() {
        return Err("VALIDATION: belge başlığı boş olamaz".into());
    }
    tarih_dogrula("son kullanma tarihi", &input.expiry_date)?;
    let expiry_date = input.expiry_date.trim().to_string();
    let issue_date = match input.issue_date.as_deref() {
        Some(ham) if !ham.trim().is_empty() => {
            tarih_dogrula("düzenleme tarihi", ham)?;
            Some(ham.trim().to_string())
        }
        _ => None,
    };
    let reminder_days = input.reminder_days.unwrap_or(30);
    hatirlatma_dogrula(reminder_days)?;

    let id = match input.id.as_deref() {
        Some(mevcut) => {
            crate::management_commands::ensure_owned(conn, "legal_documents", mevcut, tenant_id)
                .await?;
            sqlx::query(
                "UPDATE legal_documents
                    SET doc_type = ?, title = ?, authority = ?, document_number = ?,
                        issue_date = ?, expiry_date = ?, reminder_days = ?, file_path = ?,
                        notes = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
                  WHERE id = ? AND tenant_id = ?",
            )
            .bind(&doc_type)
            .bind(title)
            .bind(input.authority.as_deref().map(str::trim))
            .bind(input.document_number.as_deref().map(str::trim))
            .bind(&issue_date)
            .bind(&expiry_date)
            .bind(reminder_days)
            .bind(input.file_path.as_deref().map(str::trim))
            .bind(input.notes.as_deref().map(str::trim))
            .bind(input.is_active.unwrap_or(true))
            .bind(mevcut)
            .bind(tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            mevcut.to_string()
        }
        None => {
            let yeni = generate_id("leg");
            sqlx::query(
                "INSERT INTO legal_documents
                     (id, tenant_id, doc_type, title, authority, document_number,
                      issue_date, expiry_date, reminder_days, file_path, notes,
                      is_active, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&yeni)
            .bind(tenant_id)
            .bind(&doc_type)
            .bind(title)
            .bind(input.authority.as_deref().map(str::trim))
            .bind(input.document_number.as_deref().map(str::trim))
            .bind(&issue_date)
            .bind(&expiry_date)
            .bind(reminder_days)
            .bind(input.file_path.as_deref().map(str::trim))
            .bind(input.notes.as_deref().map(str::trim))
            .bind(input.is_active.unwrap_or(true))
            .bind(actor_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            yeni
        }
    };

    Ok(LegalDocument {
        id,
        doc_type,
        title: title.to_string(),
        authority: input.authority,
        document_number: input.document_number,
        issue_date,
        expiry_date,
        reminder_days,
        file_path: input.file_path,
        notes: input.notes,
        is_active: input.is_active.unwrap_or(true),
    })
}

pub async fn list_documents(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    doc_type: Option<&str>,
    only_active: bool,
) -> Result<Vec<LegalDocument>, String> {
    let mut sql = String::from(
        "SELECT id, doc_type, title, authority, document_number, issue_date, expiry_date,
                reminder_days, file_path, notes, is_active
           FROM legal_documents
          WHERE tenant_id = ?",
    );
    if doc_type.is_some() {
        sql.push_str(" AND doc_type = ?");
    }
    if only_active {
        sql.push_str(" AND is_active = 1");
    }
    sql.push_str(" ORDER BY expiry_date ASC, doc_type ASC");

    let mut sorgu = sqlx::query(&sql).bind(tenant_id);
    if let Some(tur) = doc_type {
        sorgu = sorgu.bind(tur.trim().to_ascii_uppercase());
    }

    let rows = sorgu
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    let mut sonuc = Vec::new();
    for row in rows {
        sonuc.push(LegalDocument {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            doc_type: row.try_get("doc_type").map_err(|e| e.to_string())?,
            title: row.try_get("title").map_err(|e| e.to_string())?,
            authority: metin_al(&row, "authority")?,
            document_number: metin_al(&row, "document_number")?,
            issue_date: metin_al(&row, "issue_date")?,
            expiry_date: row.try_get("expiry_date").map_err(|e| e.to_string())?,
            reminder_days: row.try_get("reminder_days").map_err(|e| e.to_string())?,
            file_path: metin_al(&row, "file_path")?,
            notes: metin_al(&row, "notes")?,
            is_active: bayrak_al(&row, "is_active")?,
        });
    }
    Ok(sonuc)
}

/// İki ayrı soru, iki ayrı cevap: **hatırlatma penceresi** ve **süresi
/// geçmiş belge**.
///
/// Neden tek listede birleştirilmiyor: bir belge hem pencerede hem geçmişte
/// olabilir ve müdür "kaç belgeyi yenilemem lazım" sorusunu sorarken bu
/// fark önemlidir. Ayrıca geçmişte kalan belge işletmede açık risktir; sessizce
/// pencereden düşmesi bu riski görünmez kılar.
pub async fn list_upcoming_reminders(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    pencere_gun: i64,
) -> Result<Vec<LegalDocument>, String> {
    hatirlatma_dogrula(pencere_gun)?;
    let sinir = gun_kaydir(pencere_gun);

    let rows = sqlx::query(
        "SELECT id, doc_type, title, authority, document_number, issue_date, expiry_date,
                reminder_days, file_path, notes, is_active
           FROM legal_documents
          WHERE tenant_id = ? AND is_active = 1
            AND expiry_date >= ? AND expiry_date <= ?
          ORDER BY expiry_date ASC",
    )
    .bind(tenant_id)
    .bind(super::bugun())
    .bind(&sinir)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut sonuc = Vec::new();
    for row in rows {
        sonuc.push(LegalDocument {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            doc_type: row.try_get("doc_type").map_err(|e| e.to_string())?,
            title: row.try_get("title").map_err(|e| e.to_string())?,
            authority: metin_al(&row, "authority")?,
            document_number: metin_al(&row, "document_number")?,
            issue_date: metin_al(&row, "issue_date")?,
            expiry_date: row.try_get("expiry_date").map_err(|e| e.to_string())?,
            reminder_days: row.try_get("reminder_days").map_err(|e| e.to_string())?,
            file_path: metin_al(&row, "file_path")?,
            notes: metin_al(&row, "notes")?,
            is_active: bayrak_al(&row, "is_active")?,
        });
    }
    Ok(sonuc)
}

/// Süresi dolmuş belgeler. `bugun` gününde dolan belge de listede olur: bugün
/// dolan belge "geçmiş" değildir, tam bugün yenilenmesi gerekir.
pub async fn get_expiring_documents(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<LegalDocument>, String> {
    let rows = sqlx::query(
        "SELECT id, doc_type, title, authority, document_number, issue_date, expiry_date,
                reminder_days, file_path, notes, is_active
           FROM legal_documents
          WHERE tenant_id = ? AND is_active = 1 AND expiry_date <= ?
          ORDER BY expiry_date ASC",
    )
    .bind(tenant_id)
    .bind(super::bugun())
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut sonuc = Vec::new();
    for row in rows {
        sonuc.push(LegalDocument {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            doc_type: row.try_get("doc_type").map_err(|e| e.to_string())?,
            title: row.try_get("title").map_err(|e| e.to_string())?,
            authority: metin_al(&row, "authority")?,
            document_number: metin_al(&row, "document_number")?,
            issue_date: metin_al(&row, "issue_date")?,
            expiry_date: row.try_get("expiry_date").map_err(|e| e.to_string())?,
            reminder_days: row.try_get("reminder_days").map_err(|e| e.to_string())?,
            file_path: metin_al(&row, "file_path")?,
            notes: metin_al(&row, "notes")?,
            is_active: bayrak_al(&row, "is_active")?,
        });
    }
    Ok(sonuc)
}
