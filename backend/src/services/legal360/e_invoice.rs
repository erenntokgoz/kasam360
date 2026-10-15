//! e-Arşiv fatura kuyruğu (KDV %1 / %10 / %20).
//!
//! Kapsam bilinçli olarak **dar**: bu modül yerel bir kuyruk ve durum
//! makinesidir, GİB'ye giden istek değildir. AGENTS.md §3.1 harici bulutu
//! yasaklar; dolayısıyla "gönderim" burada yalnız kaydın `SENT` durumuna
//! geçmesidir ve `payload` gönderilecek belgeyi tutar. Gerçek entegrasyon
//! ayrı bir entegrasyonun konusudur ve aynı yasağı taşır.
//!
//! KDV aritmetiği **tam sayıdır**. `orders.total_cents` KDV dahil toplamdır,
//! dolayısıyla KDV toplamdan **geri** çözülür:
//!
//! ```text
//! kdv_cents    = total_cents * oran / (100 + oran)
//! matrah_cents = total_cents - kdv_cents
//! ```
//!
//! İleri yön hesap (`total * oran / 100`) KDV'yi matrahın üstüne katar ve
//! her faturada birkaç kuruş kaydırır. Geri çözümde matrah ile KDV toplamı
//! tam olarak `total_cents` olur; test bu değişmezi kilitler.

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use super::metin_al;
use crate::id_generator::generate_id;

/// Türk vergi sistemindeki geçerli KDV oranları (tam sayı yüzde).
///
/// `CHECK (kdv_rate_percent IN (1,10,20))` veritabanında da aynı küme
/// dayatır. Buradaki liste kullanıcıya anlaşılır hata vermek içindir.
const KDV_ORANLARI: [i64; 3] = [1, 10, 20];

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EInvoice {
    pub id: String,
    pub order_id: Option<String>,
    pub invoice_number: Option<String>,
    pub status: String,
    pub kdv_rate_percent: i64,
    pub total_cents: i64,
    pub kdv_cents: i64,
    pub matrah_cents: i64,
    pub sent_at: Option<String>,
    pub response: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EInvoiceInput {
    pub order_id: String,
    /// KDV oranı (tam sayı yüzde: 1, 10 veya 20).
    pub kdv_rate_percent: i64,
    /// Fatura numarası. Boş bırakılırsa sipariş kimliğinden türetilir.
    pub invoice_number: Option<String>,
}

/// KDV ve matrahı tam sayı olarak hesaplar.
///
/// Kuruş bölmesi **aşağı** yuvarlar: 1100 kuruş + %10 KDV'de KDV 100 kuruş,
/// matrah 1000 kuruş çıkar ve toplam 1100 kuruştur. Yukarı yuvarlama 1101
/// kuruş üretirdi ve matrahla KDV toplamı sipariş tutarını aşardı.
pub(crate) fn kdv_hesapla(total_cents: i64, oran: i64) -> Result<(i64, i64), String> {
    if !KDV_ORANLARI.contains(&oran) {
        return Err(format!(
            "VALIDATION: KDV oranı {oran} geçersiz. Geçerli oranlar: 1, 10, 20"
        ));
    }
    if total_cents < 0 {
        return Err("VALIDATION: fatura tutarı negatif olamaz".into());
    }
    let kdv = total_cents * oran / (100 + oran);
    Ok((kdv, total_cents - kdv))
}

/// Siparişten e-Arşiv kaydı üretir ve kuyruğa alır.
///
/// Sipariş `orders` tablosundan okunur; **kiracı filtresi zorunludur** — başka
/// bir işletmenin siparişiyle fatura üretmek hem izolasyon ihlali hem de
/// vergi belgesi sahteciliğidir. Sipariş bulunamazsa `NOT_FOUND` döner ve
/// **sıfır tutarlı** fatura üretilmez (AGENTS.md §3.4).
pub async fn generate_e_invoice(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    input: EInvoiceInput,
) -> Result<EInvoice, String> {
    let oran = input.kdv_rate_percent;
    if !KDV_ORANLARI.contains(&oran) {
        return Err(format!(
            "VALIDATION: KDV oranı {oran} geçersiz. Geçerli oranlar: 1, 10, 20"
        ));
    }

    let order_id = input.order_id.trim();
    if order_id.is_empty() {
        return Err("VALIDATION: sipariş kimliği boş olamaz".into());
    }

    let total_cents: i64 =
        sqlx::query_scalar("SELECT total_cents FROM orders WHERE id = ? AND tenant_id = ?")
            .bind(order_id)
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "NOT_FOUND: sipariş bulunamadı".to_string())?;

    let (kdv_cents, matrah_cents) = kdv_hesapla(total_cents, oran)?;
    let fatura_no = match input.invoice_number.as_deref().map(str::trim) {
        Some(no) if !no.is_empty() => no.to_string(),
        // Numara verilmediyse sipariş kimliğinden türetilir: elle numara
        // vermek hatırlanmayan benzersizlik ihlaline yol açar.
        _ => format!("EARS-{order_id}"),
    };

    // Aynı sipariş için ikinci e-Arşiv kaydı açılmaz: vergi mükellefi aynı
    // satışı iki kez bildirir.
    let var: Option<String> = sqlx::query_scalar(
        "SELECT id FROM e_invoices
          WHERE tenant_id = ? AND order_id = ? AND status <> 'CANCELLED'",
    )
    .bind(tenant_id)
    .bind(order_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if let Some(mevcut) = var {
        return Err(format!(
            "VALIDATION: bu sipariş için zaten e-Arşiv kaydı var: {mevcut}"
        ));
    }

    let id = generate_id("ear");
    let payload = serde_json::json!({
        "invoiceNumber": fatura_no,
        "orderId": order_id,
        "kdvRatePercent": oran,
        "matrahCents": matrah_cents,
        "kdvCents": kdv_cents,
        "totalCents": total_cents,
    })
    .to_string();

    sqlx::query(
        "INSERT INTO e_invoices
             (id, tenant_id, order_id, invoice_number, status, kdv_rate_percent,
              total_cents, kdv_cents, matrah_cents, payload)
         VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(order_id)
    .bind(&fatura_no)
    .bind(oran)
    .bind(total_cents)
    .bind(kdv_cents)
    .bind(matrah_cents)
    .bind(&payload)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(EInvoice {
        id,
        order_id: Some(order_id.to_string()),
        invoice_number: Some(fatura_no),
        status: "PENDING".to_string(),
        kdv_rate_percent: oran,
        total_cents,
        kdv_cents,
        matrah_cents,
        sent_at: None,
        response: None,
    })
}

pub async fn get_e_invoice(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    id: &str,
) -> Result<EInvoice, String> {
    let satir = sqlx::query(
        "SELECT id, order_id, invoice_number, status, kdv_rate_percent, total_cents,
                kdv_cents, matrah_cents, sent_at, response
           FROM e_invoices
          WHERE id = ? AND tenant_id = ?",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let row = satir.ok_or_else(|| "NOT_FOUND: e-Arşiv kaydı bulunamadı".to_string())?;
    fatura_oku(&row)
}

pub async fn list_e_invoices(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    status: Option<&str>,
) -> Result<Vec<EInvoice>, String> {
    let mut sql = String::from(
        "SELECT id, order_id, invoice_number, status, kdv_rate_percent, total_cents,
                kdv_cents, matrah_cents, sent_at, response
           FROM e_invoices
          WHERE tenant_id = ?",
    );
    if status.is_some() {
        sql.push_str(" AND status = ?");
    }
    sql.push_str(" ORDER BY created_at DESC");

    let mut sorgu = sqlx::query(&sql).bind(tenant_id);
    if let Some(durum) = status {
        sorgu = sorgu.bind(durum.trim().to_ascii_uppercase());
    }

    let rows = sorgu
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    let mut sonuc = Vec::new();
    for row in rows {
        sonuc.push(fatura_oku(&row)?);
    }
    Ok(sonuc)
}

/// Kuyruğa alınan faturayı `SENT` durumuna geçirir.
///
/// Yalnız `PENDING` kayıt gönderilebilir: gönderilmiş veya iptal edilmiş bir
/// faturanın ikinci kez "gönderildi" görünmesi, vergi defterinde çift kayıt
/// izlenimi uyandırır.
pub async fn mark_e_invoice_sent(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    id: &str,
) -> Result<EInvoice, String> {
    durum_aktar(conn, tenant_id, id, "PENDING", "SENT", None).await
}

pub async fn mark_e_invoice_accepted(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    id: &str,
    response: Option<String>,
) -> Result<EInvoice, String> {
    durum_aktar(conn, tenant_id, id, "SENT", "ACCEPTED", response.as_deref()).await
}

pub async fn mark_e_invoice_rejected(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    id: &str,
    response: Option<String>,
) -> Result<EInvoice, String> {
    durum_aktar(conn, tenant_id, id, "SENT", "REJECTED", response.as_deref()).await
}

/// İptal yalnız `PENDING` ve `SENT` kayıtlar için mümkündür. `ACCEPTED`
/// fatura vergi defterine girmiştir; iptali kayıt düzeltme belgesiyle olur,
/// bu modülün kapsamı dışındadır.
pub async fn cancel_e_invoice(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    id: &str,
    gerekce: Option<String>,
) -> Result<EInvoice, String> {
    let mevcut = get_e_invoice(conn, tenant_id, id).await?;
    if mevcut.status == "ACCEPTED" {
        return Err("VALIDATION: vergi defterine geçmiş fatura iptal edilemez".to_string());
    }
    if mevcut.status == "CANCELLED" {
        return Err("VALIDATION: fatura zaten iptal edilmiş".to_string());
    }
    durum_aktar(
        conn,
        tenant_id,
        id,
        &mevcut.status,
        "CANCELLED",
        gerekce.as_deref(),
    )
    .await
}

/// Durum geçişinin tek kapısı.
///
/// Neden tek kapı: her komut kendi `UPDATE`'ini yazsaydı "hangi durumdan
/// hangisine geçilebilir" kuralı kopyalanırdı ve bir komut unuttuğunda geçersiz
/// geçiş sessizce açılırdı. Burada kaynak durum `WHERE`'e yazılır; uyuşmazsa
/// hiç satır değişmez ve çağıran bunu `Err` olarak öğrenir.
async fn durum_aktar(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    id: &str,
    kaynak_durum: &str,
    hedef_durum: &str,
    response: Option<&str>,
) -> Result<EInvoice, String> {
    crate::management_commands::ensure_owned(conn, "e_invoices", id, tenant_id).await?;

    let sonuc = sqlx::query(
        "UPDATE e_invoices
            SET status = ?, response = ?, sent_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND tenant_id = ? AND status = ?",
    )
    .bind(hedef_durum)
    .bind(response.map(str::trim))
    .bind(id)
    .bind(tenant_id)
    .bind(kaynak_durum)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if sonuc.rows_affected() == 0 {
        return Err(format!(
            "DURUM_GECERSIZ: e-Arşiv kaydı {kaynak_durum} durumunda değil, {hedef_durum} durumuna geçemez"
        ));
    }
    get_e_invoice(conn, tenant_id, id).await
}

fn fatura_oku(row: &sqlx::sqlite::SqliteRow) -> Result<EInvoice, String> {
    Ok(EInvoice {
        id: row.try_get("id").map_err(|e| e.to_string())?,
        order_id: metin_al(row, "order_id")?,
        invoice_number: metin_al(row, "invoice_number")?,
        status: row.try_get("status").map_err(|e| e.to_string())?,
        kdv_rate_percent: row.try_get("kdv_rate_percent").map_err(|e| e.to_string())?,
        total_cents: row.try_get("total_cents").map_err(|e| e.to_string())?,
        kdv_cents: row.try_get("kdv_cents").map_err(|e| e.to_string())?,
        matrah_cents: row.try_get("matrah_cents").map_err(|e| e.to_string())?,
        sent_at: metin_al(row, "sent_at")?,
        response: metin_al(row, "response")?,
    })
}

/// Bekleyen kuyruk sayısı. Vergi müşafidinin günlük sorusu "kaç fatura
/// gönderilmedi"dir.
pub async fn pending_count(conn: &mut SqliteConnection, tenant_id: &str) -> Result<i64, String> {
    sqlx::query_scalar("SELECT COUNT(*) FROM e_invoices WHERE tenant_id = ? AND status = 'PENDING'")
        .bind(tenant_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())
}
