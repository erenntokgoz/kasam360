//! Cari ekstre ve 80mm termal tediye makbuzu (Faz 9).
//!
//! Neden ayrı dosya: hesap defteri motoru 500 satirlik tavana ulastiginda
//! yeni yuzeyler ayni dosyaya eklenemez. Ekstre ve makbuz kendi yuzeyleriyle
//! ayri modul olur; bakiye motoru (`ledger_service`) degismez.
//!
//! Guvenlik: makbuz icerigi veritabanindan turer, istemciden gelen metinle
//! basilmaz. Uydurma mali belge riski bu yuzden kapatilir (AGENTS.md 3.2).

use sqlx::{Row, SqlitePool};

// ============================================================================
// CARİ EKSTRE
// ============================================================================

/// Ekstre satırı — hareket yönü imzayla taşınır.
///
/// Neden `+`/`-` imza: ekstre "alacak" ve "borç" sütunlarıyla iki paralel
/// toplam yürütür; tek imzalı akış hem ekranda hem makbuzda tek toplama
/// indirgenir ve matematiksel olarak kendi kendini doğrular.
#[derive(Debug, Clone)]
pub struct StatementLine {
    pub id: String,
    /// `BORÇ_ACILDI`, `TAHSILAT`, `ODEME`, `IADE` …
    pub kind: String,
    /// İşaretlı tutar: alacak artırıcı (+), borç azaltıcı (-).
    pub signed_amount_cents: i64,
    pub description: Option<String>,
    pub created_at: String,
    /// Satır sonrası bakiye.
    pub balance_after_cents: i64,
}

/// Bir cari kartın dönem ekstresi.
#[derive(Debug, Clone)]
pub struct DirectoryStatement {
    pub directory_id: String,
    pub directory_name: String,
    pub directory_type: String,
    pub opening_balance_cents: i64,
    pub closing_balance_cents: i64,
    pub total_debit_cents: i64,
    pub total_credit_cents: i64,
    pub lines: Vec<StatementLine>,
    pub from_date: String,
    pub to_date: String,
}

/// Bir cari kartın hesap ekstresini üretir.
///
/// ## İşaret kuralı
///
/// `net_balance` ile **birebir aynı** yön kullanılır; ekstre ile net bakiye
/// arasında işaret farkı olursa patron iki sayıyı karşılaştıramaz.
///
/// ```text
/// VERESİYE (GIVEN) açılışı  →  bakiyeyi artırır  (+)  müşteri bize borçlu
/// BORÇ (TAKEN) açılışı      →  bakiyeyi azaltır  (-)  biz cariye borçluyuz
/// TAHSiLAT (GIVEN tahsilatı)→  bakiyeyi azaltır  (-)
/// TEDİYE (TAKEN ödemesi)    →  bakiyeyi artırır  (+)
/// ```
pub async fn directory_statement(
    pool: &SqlitePool,
    tenant_id: &str,
    directory_id: &str,
    from_date: &str,
    to_date: &str,
) -> Result<DirectoryStatement, String> {
    let dir = sqlx::query(
        "SELECT name, type FROM directories WHERE id = ? AND tenant_id = ?",
    )
    .bind(directory_id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Cari kart okunamadı: {}", e))?
    .ok_or_else(|| "NOT_FOUND: cari kart bulunamadı".to_string())?;

    let directory_name: String = dir.try_get("name").map_err(|e| e.to_string())?;
    let directory_type: String = dir.try_get("type").map_err(|e| e.to_string())?;

    // Açılış bakiyesi: dönem başlangıcından önce açılmış ve kapanmamış borçların
    // işaretli toplamı.
    let opening_balance_cents: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(
                    CASE WHEN type = 'GIVEN' THEN remaining_amount_cents
                         WHEN type = 'TAKEN' THEN -remaining_amount_cents
                         ELSE 0 END), 0)
         FROM debts
         WHERE tenant_id = ? AND directory_id = ? AND status != 'PAID'
           AND date(created_at) < date(?)",
    )
    .bind(tenant_id)
    .bind(directory_id)
    .bind(from_date)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Açılış bakiyesi hesaplanamadı: {}", e))?;

    // Dönem içi borç hareketleri
    let debt_rows = sqlx::query(
        "SELECT id, type, total_amount_cents, description, created_at
         FROM debts
         WHERE tenant_id = ? AND directory_id = ? AND date(created_at) >= date(?) AND date(created_at) <= date(?)
         ORDER BY created_at ASC, id ASC",
    )
    .bind(tenant_id)
    .bind(directory_id)
    .bind(from_date)
    .bind(to_date)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Dönem borçları okunamadı: {}", e))?;

    // Dönem içi ödemeler
    let payment_rows = sqlx::query(
        "SELECT dp.id, dp.debt_id, d.type as debt_type, dp.amount_cents,
                dp.payment_method, dp.notes, dp.created_at
         FROM debt_payments dp
         JOIN debts d ON d.id = dp.debt_id AND d.tenant_id = dp.tenant_id
         WHERE dp.tenant_id = ? AND d.directory_id = ?
           AND date(dp.created_at) >= date(?) AND date(dp.created_at) <= date(?)
         ORDER BY dp.created_at ASC, dp.id ASC",
    )
    .bind(tenant_id)
    .bind(directory_id)
    .bind(from_date)
    .bind(to_date)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Dönem tahsilatları okunamadı: {}", e))?;

    let mut lines: Vec<StatementLine> = Vec::with_capacity(debt_rows.len() + payment_rows.len());
    let mut running = opening_balance_cents;
    let mut total_debit_cents = 0i64;
    let mut total_credit_cents = 0i64;

    for r in &debt_rows {
        let debt_type: String = r.try_get("type").map_err(|e| e.to_string())?;
        let amount: i64 = r.try_get("total_amount_cents").map_err(|e| e.to_string())?;
        // GIVEN (bize alacak) bakiyeyi artırır, TAKEN (bizim borcumuz) azaltır.
        let signed = if debt_type == "GIVEN" { amount } else { -amount };
        running += signed;
        if signed > 0 {
            total_debit_cents += signed;
        } else {
            total_credit_cents += -signed;
        }
        lines.push(StatementLine {
            id: r.try_get("id").map_err(|e| e.to_string())?,
            kind: "BORC_ACILDI".to_string(),
            signed_amount_cents: signed,
            description: r.try_get("description").map_err(|e| e.to_string())?,
            created_at: r.try_get("created_at").map_err(|e| e.to_string())?,
            balance_after_cents: running,
        });
    }

    for r in &payment_rows {
        let debt_type: String = r.try_get("debt_type").map_err(|e| e.to_string())?;
        let amount: i64 = r.try_get("amount_cents").map_err(|e| e.to_string())?;
        let method: String = r.try_get("payment_method").map_err(|e| e.to_string())?;
        // GIVEN tahsilatı (müşteri bize ödüyor) bakiyeyi azaltır;
        // TAKEN tediyesi (biz toptancıya ödüyoruz) artırır.
        let signed = if debt_type == "GIVEN" { -amount } else { amount };
        running += signed;
        if signed > 0 {
            total_debit_cents += signed;
        } else {
            total_credit_cents += -signed;
        }
        let notes: Option<String> = r.try_get("notes").map_err(|e| e.to_string())?;
        lines.push(StatementLine {
            id: r.try_get("id").map_err(|e| e.to_string())?,
            kind: if debt_type == "GIVEN" {
                "TAHSILAT".to_string()
            } else {
                "TEDIYE".to_string()
            },
            signed_amount_cents: signed,
            description: Some(match (&notes, method.as_str()) {
                (Some(n), _) if !n.is_empty() => format!("{} · {}", method, n),
                _ => method.clone(),
            }),
            created_at: r.try_get("created_at").map_err(|e| e.to_string())?,
            balance_after_cents: running,
        });
    }

    lines.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });

    Ok(DirectoryStatement {
        directory_id: directory_id.to_string(),
        directory_name,
        directory_type,
        opening_balance_cents,
        closing_balance_cents: running,
        total_debit_cents,
        total_credit_cents,
        lines,
        from_date: from_date.to_string(),
        to_date: to_date.to_string(),
    })
}

// ============================================================================
// 80mm TERMAL TEDİYE MAKBUZU
// ============================================================================

/// 80mm termal makbuz satırı (32 karakter sütun).
#[derive(Debug, Clone)]
pub struct ReceiptLine {
    pub text: String,
    /// `true` ise çift çizgi / boşluk ayracı basılır.
    pub is_separator: bool,
}

/// Tediye makbuzunu 80mm (32 sütun) satırlarına böler.
///
/// Neden ayrı fonksiyon: makbuz içeriği veritabanından türetilir, istemciden
/// gelen metinle basılmaz. Bu, uydurma makbuz riskini kapatır (AGENTS.md §3.2:
/// sahte mali belge yasak).
pub fn payment_receipt_lines(
    directory_name: &str,
    debt_id: &str,
    payment_id: &str,
    amount_cents: i64,
    remaining_after_cents: i64,
    method: &str,
    status: &str,
    issued_at: &str,
) -> Vec<ReceiptLine> {
    let mut out = Vec::new();
    let mut push = |text: &str, is_separator: bool| {
        out.push(ReceiptLine {
            text: text.to_string(),
            is_separator,
        })
    };

    push("================================", false);
    push("KASAM360 HESAP DEFLERI", false);
    push("TEDIYE MAKBUZU", false);
    push("================================", true);
    push(&format!("Cari      : {}", directory_name), false);
    push(&format!("Belge No  : {}", take12(payment_id)), false);
    push(&format!("Tarih     : {}", issued_at), false);
    push(&format!("Odeme     : {}", method), false);
    push("--------------------------------", true);
    push(&format!("Tahsilat  : {:>20}", format_cents(amount_cents)), false);
    push("--------------------------------", true);
    push(&format!("Kalan Borc: {:>20}", format_cents(remaining_after_cents)), false);
    push(&format!("Durum     : {}", status), false);
    push("--------------------------------", true);
    push(&format!("Referans  : {}", take12(debt_id)), false);
    push("================================", true);
    push("Imza: ______________", false);
    push("Alik:  ______________", false);
    push("================================", false);

    out
}

/// Kuruşu `1.234,56` biçiminde yazar (Türkçe para gösterimi).
pub fn format_cents(cents: i64) -> String {
    let negative = cents < 0;
    let abs = cents.abs();
    let lira = abs / 100;
    let kurus = abs % 100;
    let mut grouped = String::new();
    let digits = lira.to_string();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(c);
    }
    format!("{}{}.{:02} TL", if negative { "-" } else { "" }, grouped, kurus)
}

fn take12(value: &str) -> String {
    value.chars().take(12).collect()
}

#[cfg(test)]
#[path = "ledger_statement_tests.rs"]
mod tests;
