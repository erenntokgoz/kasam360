//! Cari ekstre ve 80mm termal tediye makbuzu.
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
    /// Satırın ait olduğu borç; ödeme satırı da borcuna kimlikle bağlanır.
    pub debt_id: String,
    pub due_date: Option<String>,
    /// Veresiye adisyonu.
    pub order_id: Option<String>,
    /// Tedarikçi belgesi.
    pub document_no: Option<String>,
    pub purchase_order_id: Option<String>,
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
    let dir = sqlx::query("SELECT name, type FROM directories WHERE id = ? AND tenant_id = ?")
        .bind(directory_id)
        .bind(tenant_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Cari kart okunamadı: {}", e))?
        .ok_or_else(|| "NOT_FOUND: cari kart bulunamadı".to_string())?;

    let directory_name: String = dir.try_get("name").map_err(|e| e.to_string())?;
    let directory_type: String = dir.try_get("type").map_err(|e| e.to_string())?;

    // Açılış bakiyesi dönem öncesindeki bütün hareketlerin toplamıdır. Yalnız
    // bugünkü kalanlara bakmak, dönem içinde ödenen eski borcu açılıştan düşer
    // ve aynı ödemeyi satırda ikinci kez sayardı.
    let opening_balance_cents: i64 = sqlx::query_scalar(
        "SELECT
            COALESCE((SELECT SUM(CASE WHEN type = 'GIVEN' THEN total_amount_cents
                                      ELSE -total_amount_cents END)
                      FROM debts
                      WHERE tenant_id = ?1 AND directory_id = ?2
                        AND date(created_at) < date(?3)), 0)
          + COALESCE((SELECT SUM(CASE WHEN d.type = 'GIVEN' THEN -dp.amount_cents
                                      ELSE dp.amount_cents END)
                      FROM debt_payments dp
                      JOIN debts d ON d.id = dp.debt_id AND d.tenant_id = dp.tenant_id
                      WHERE dp.tenant_id = ?1 AND d.directory_id = ?2
                        AND date(dp.created_at) < date(?3)), 0)",
    )
    .bind(tenant_id)
    .bind(directory_id)
    .bind(from_date)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Açılış bakiyesi hesaplanamadı: {}", e))?;

    // Dönem içi borç hareketleri
    let debt_rows = sqlx::query(
        "SELECT deb.id, deb.type, deb.total_amount_cents, deb.description, deb.created_at,
                deb.due_date, deb.order_id, sd.document_no, sd.purchase_order_id
         FROM debts deb
         LEFT JOIN supplier_documents sd
                ON sd.debt_id = deb.id AND sd.tenant_id = deb.tenant_id
         WHERE deb.tenant_id = ? AND deb.directory_id = ?
           AND date(deb.created_at) >= date(?) AND date(deb.created_at) <= date(?)
         ORDER BY deb.created_at ASC, deb.id ASC",
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
                dp.payment_method, dp.notes, dp.created_at, d.due_date, d.order_id,
                sd.document_no, sd.purchase_order_id
         FROM debt_payments dp
         JOIN debts d ON d.id = dp.debt_id AND d.tenant_id = dp.tenant_id
         LEFT JOIN supplier_documents sd
                ON sd.debt_id = d.id AND sd.tenant_id = d.tenant_id
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

    for r in &debt_rows {
        let debt_type: String = r.try_get("type").map_err(|e| e.to_string())?;
        let amount: i64 = r.try_get("total_amount_cents").map_err(|e| e.to_string())?;
        let id: String = r.try_get("id").map_err(|e| e.to_string())?;
        // GIVEN (bize alacak) bakiyeyi artırır, TAKEN (bizim borcumuz) azaltır.
        lines.push(StatementLine {
            debt_id: id.clone(),
            id,
            kind: "BORC_ACILDI".to_string(),
            signed_amount_cents: if debt_type == "GIVEN" {
                amount
            } else {
                -amount
            },
            description: r.try_get("description").map_err(|e| e.to_string())?,
            created_at: r.try_get("created_at").map_err(|e| e.to_string())?,
            balance_after_cents: 0,
            due_date: r.try_get("due_date").map_err(|e| e.to_string())?,
            order_id: r.try_get("order_id").map_err(|e| e.to_string())?,
            document_no: r.try_get("document_no").map_err(|e| e.to_string())?,
            purchase_order_id: r.try_get("purchase_order_id").map_err(|e| e.to_string())?,
        });
    }

    for r in &payment_rows {
        let debt_type: String = r.try_get("debt_type").map_err(|e| e.to_string())?;
        let amount: i64 = r.try_get("amount_cents").map_err(|e| e.to_string())?;
        let method: String = r.try_get("payment_method").map_err(|e| e.to_string())?;
        let notes: Option<String> = r.try_get("notes").map_err(|e| e.to_string())?;
        // GIVEN tahsilatı (müşteri bize ödüyor) bakiyeyi azaltır;
        // TAKEN tediyesi (biz toptancıya ödüyoruz) artırır.
        lines.push(StatementLine {
            id: r.try_get("id").map_err(|e| e.to_string())?,
            debt_id: r.try_get("debt_id").map_err(|e| e.to_string())?,
            kind: if debt_type == "GIVEN" {
                "TAHSILAT".to_string()
            } else {
                "TEDIYE".to_string()
            },
            signed_amount_cents: if debt_type == "GIVEN" {
                -amount
            } else {
                amount
            },
            description: Some(match (&notes, method.as_str()) {
                (Some(n), _) if !n.is_empty() => format!("{} · {}", method, n),
                _ => method.clone(),
            }),
            created_at: r.try_get("created_at").map_err(|e| e.to_string())?,
            balance_after_cents: 0,
            due_date: r.try_get("due_date").map_err(|e| e.to_string())?,
            order_id: r.try_get("order_id").map_err(|e| e.to_string())?,
            document_no: r.try_get("document_no").map_err(|e| e.to_string())?,
            purchase_order_id: r.try_get("purchase_order_id").map_err(|e| e.to_string())?,
        });
    }

    lines.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });

    // Yürüyen bakiye sıralamadan sonra hesaplanır; önce hesaplanırsa satır
    // sonrası bakiye ekrandaki hareket sırasıyla tutmaz.
    let mut running = opening_balance_cents;
    let mut total_debit_cents = 0i64;
    let mut total_credit_cents = 0i64;
    for line in &mut lines {
        running = running
            .checked_add(line.signed_amount_cents)
            .ok_or_else(|| "OVERFLOW: ekstre bakiyesi taştı".to_string())?;
        line.balance_after_cents = running;
        if line.signed_amount_cents > 0 {
            total_debit_cents += line.signed_amount_cents;
        } else {
            total_credit_cents -= line.signed_amount_cents;
        }
    }

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
    push("KASAM360 HESAP DEFTERI", false);
    push("TEDIYE MAKBUZU", false);
    push("================================", true);
    push(&format!("Cari      : {}", directory_name), false);
    push(&format!("Belge No  : {}", take12(payment_id)), false);
    push(&format!("Tarih     : {}", issued_at), false);
    push(&format!("Odeme     : {}", method), false);
    push("--------------------------------", true);
    push(
        &format!("Tahsilat  : {:>20}", format_cents(amount_cents)),
        false,
    );
    push("--------------------------------", true);
    push(
        &format!("Kalan Borc: {:>20}", format_cents(remaining_after_cents)),
        false,
    );
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
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            grouped.push('.');
        }
        grouped.push(c);
    }
    format!(
        "{}{},{:02} TL",
        if negative { "-" } else { "" },
        grouped,
        kurus
    )
}

fn take12(value: &str) -> String {
    value.chars().take(12).collect()
}

#[cfg(test)]
#[path = "ledger_statement_tests.rs"]
mod tests;
