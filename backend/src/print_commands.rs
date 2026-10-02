//! Faz 7 — Veritabanı kaynaklı termal basım komutları.
//!
//! Neden ayrı modül: `commands.rs` 500 satır sınırını aştığı için fiş dışı
//! basımlar (Z-Rapor, kasa fişi, adisyon/void fişi) burada toplanır.
//!
//! Temel kural: **keyfi JSON basılmaz.** Önceki `print_receipt(order)` imzası
//! çağıranın gönderdiği serbest alanları yazıcıya aktarıyordu; bu hem yetkisiz
//! hem de veritabanında karşılığı olmayan mali belge üretmeye yol açıyordu.
//! Artık her basım kaydı veritabanından okur, tenant ve rol kapısından geçer.

use sqlx::Row;

use crate::db::DbPool;
use crate::rbac::{self, Role};

/// Kuruşu tam sayıdan biçimlendirir; float aritmetiği kullanılmaz.
fn fmt_cents(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let absolute = if cents < 0 { -cents } else { cents };
    format!("{}{},{:02} TL", sign, absolute / 100, absolute % 100)
}

fn require_tenant(tenant_id: Option<&str>) -> Result<String, String> {
    tenant_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string())
}

/// Fiş basımı yapabilecek roller. Kasa ve müdür tahsilat fişi basabilir; mutfak
/// ve garson basamaz.
fn require_receipt_printer(role: Option<&str>) -> Result<(), String> {
    rbac::require_any_present(
        role,
        &[Role::Owner, Role::Manager, Role::Cashier],
    )?;
    Ok(())
}

fn print_header(title: &str, subtitle: &str) {
    println!("\n================================================");
    println!("             *** KASAM360 ADİSYON ***           ");
    println!("              ESC/POS 80mm TERMAL FİŞ           ");
    println!("================================================");
    println!("  {:<38}", title);
    if !subtitle.is_empty() {
        println!("  {:<38}", subtitle);
    }
    println!("------------------------------------------------");
}

fn print_footer() {
    println!("================================================");
    println!("       MALİ DEĞERİ YOKTUR - BİLGİ FİŞİDİR       ");
    println!("       Teşekkür ederiz, tekrar bekleriz.         ");
    println!("================================================");
}

/// Z-Raporu / X-Raporu — vardiya satırlarından türetilir.
///
/// Neden ayrı komut: Z-Rapor bir **tahsilat fişi değildir**; vardiya mutabakat
/// belgesidir. Bu yüzden `print_receipt` üzerinden basılamaz.
#[tauri::command]
pub async fn print_z_report(
    shift_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    require_receipt_printer(actor_role.as_deref())?;
    let tenant = require_tenant(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let row = sqlx::query(
        "SELECT cashier_id, status, opened_at, closed_at, expected_amount_cents,
                actual_amount_cents, difference_cents
         FROM shifts WHERE id = ? AND tenant_id = ?",
    )
    .bind(&shift_id)
    .bind(&tenant)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "NOT_FOUND: bu işletmeye ait vardiya bulunamadı".to_string())?;

    let opened_at: String = row.try_get("opened_at").map_err(|e| e.to_string())?;
    let closed_at: Option<String> = row.try_get("closed_at").map_err(|e| e.to_string())?;
    let expected: i64 = row.try_get("expected_amount_cents").unwrap_or(0);
    let actual: Option<i64> = row.try_get("actual_amount_cents").ok();
    let difference: Option<i64> = row.try_get("difference_cents").ok();
    let status: String = row.try_get("status").unwrap_or_default();
    let cashier_id: String = row.try_get("cashier_id").unwrap_or_default();

    // Vardiya satışları audit_ledger üzerinden okunur; tahsilat kaydı olmayan
    // tutar Z-Rapor'a girmez.
    let sales_sql = "SELECT COALESCE(SUM(json_extract(payload, '$.totalAmount')), 0)
                     FROM audit_ledger
                     WHERE tenant_id = ? AND action = 'payment:settled_fifo' AND created_at >= ?";
    let cash_in_sql = "SELECT COALESCE(SUM(amount_cents), 0) FROM cash_movements
                       WHERE tenant_id = ? AND shift_id = ? AND movement_type = 'IN'";
    let cash_out_sql = "SELECT COALESCE(SUM(amount_cents), 0) FROM cash_movements
                        WHERE tenant_id = ? AND shift_id = ? AND movement_type = 'OUT'";

    let total_sales = match closed_at.as_ref() {
        Some(closed) => {
            sqlx::query_scalar(&format!("{} AND created_at <= ?", sales_sql))
                .bind(&tenant)
                .bind(&opened_at)
                .bind(closed)
                .fetch_one(&mut *conn)
                .await
                .map_err(|e| e.to_string())?
        }
        None => {
            sqlx::query_scalar(sales_sql)
                .bind(&tenant)
                .bind(&opened_at)
                .fetch_one(&mut *conn)
                .await
                .map_err(|e| e.to_string())?
        }
    };

    let cash_in: i64 = sqlx::query_scalar(cash_in_sql)
        .bind(&tenant)
        .bind(&shift_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    let cash_out: i64 = sqlx::query_scalar(cash_out_sql)
        .bind(&tenant)
        .bind(&shift_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    print_header(
        if closed_at.is_some() { "Z-RAPORU (GÜN SONU MUTABAKATI)" } else { "X-RAPORU (GÜN İÇİ ARA MUTABAKAT)" },
        "KASAM360 HESAP DEFTERI",
    );
    println!("Vardiya No : {}", shift_id);
    println!("Kasiyer    : {}", cashier_id);
    println!("Durum      : {}", status);
    println!("Acilis     : {}", opened_at);
    println!("Kapanis    : {}", closed_at.clone().unwrap_or_else(|| "-".to_string()));
    println!("------------------------------------------------");
    println!("Acilis Bakiyesi : {}", fmt_cents(expected));
    println!("Toplam Satis    : {}", fmt_cents(total_sales));
    println!("Kasa Girisi     : {}", fmt_cents(cash_in));
    println!("Kasa Cikisi     : {}", fmt_cents(cash_out));
    if let Some(actual_amount) = actual {
        println!("Gercek Teslim   : {}", fmt_cents(actual_amount));
    }
    if let Some(diff) = difference {
        println!("Fark            : {}", fmt_cents(diff));
    }
    print_footer();
    Ok(())
}

/// Kasa giriş/çıkış fişi — kayıtlı kasa hareketinden basılır.
#[tauri::command]
pub async fn print_cash_slip(
    movement_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    require_receipt_printer(actor_role.as_deref())?;
    let tenant = require_tenant(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let row = sqlx::query(
        "SELECT shift_id, movement_type, amount_cents, reason, actor_id, created_at
         FROM cash_movements WHERE id = ? AND tenant_id = ?",
    )
    .bind(&movement_id)
    .bind(&tenant)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "NOT_FOUND: bu işletmeye ait kasa hareketi bulunamadı".to_string())?;

    let movement_type: String = row.try_get("movement_type").unwrap_or_default();
    let amount: i64 = row.try_get("amount_cents").unwrap_or(0);
    let reason: String = row.try_get("reason").unwrap_or_default();
    let actor_id: String = row.try_get("actor_id").unwrap_or_default();
    let shift_id: String = row.try_get("shift_id").unwrap_or_default();
    let created_at: String = row.try_get("created_at").unwrap_or_default();

    let is_in = movement_type.eq_ignore_ascii_case("IN");
    print_header(
        if is_in { "KASA GIRIS FISI" } else { "KASA CIKIS FISI" },
        "KASAM360 HESAP DEFTERI",
    );
    println!("Hareket No : {}", movement_id);
    println!("Vardiya    : {}", shift_id);
    println!("Tarih      : {}", created_at);
    println!("Kasiyer    : {}", actor_id);
    println!("Aciklama   : {}", reason);
    println!("------------------------------------------------");
    println!(
        "Tutar      : {}",
        fmt_cents(if is_in { amount } else { -amount })
    );
    print_footer();
    Ok(())
}

/// Adisyon (bill) fişi — sipariş kaydından basılır.
///
/// Adisyon **tahsilat değildir**; açık hesabın bilgi fişidir. Tahsilat fişi için
/// `print_receipt`, iptal fişi için `print_void_slip` kullanılır.
#[tauri::command]
pub async fn print_order_slip(
    order_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    require_receipt_printer(actor_role.as_deref())?;
    let tenant = require_tenant(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    print_order_body(&mut conn, &order_id, "ADISYON BILGI FISI", &tenant).await
}

/// İptal (void) fişi — masanın iptal edilmiş siparişinden basılır.
///
/// Neden masa kimliğiyle çalışır: `void_order` çağıranı yalnız masa kimliğiyle
/// çalışır ve iptal edilen siparişin kimliğini döndürmez. Bu komut da aynı
/// kaydı tenant içinde çözer; iptal edilmiş sipariş yoksa basmaz.
#[tauri::command]
pub async fn print_void_slip(
    table_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    require_receipt_printer(actor_role.as_deref())?;
    let tenant = require_tenant(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let order_id: String = sqlx::query_scalar(
        "SELECT id FROM orders
         WHERE table_id = ? AND tenant_id = ? AND status IN ('VOID', 'CANCELLED')
         ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(&table_id)
    .bind(&tenant)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "NOT_FOUND: bu masada iptal edilmiş sipariş bulunamadı".to_string())?;

    print_order_body(&mut conn, &order_id, "HESAP IPTAL (VOID) FISI", &tenant).await
}

/// Günün hesap defteri Z-Raporu — günlük tahsilatlardan türetilir.
///
/// Neden ayrı komut: gün sonu belgesi tek bir vardiyaya bağlı değildir; vardiya
/// kapanmadan da basılabilir. Kaynak yine veritabanıdır: `SALE_SETTLED` hareketleri
/// ve o günün tahsilat siparişleri.
#[tauri::command]
pub async fn print_day_z_report(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    require_receipt_printer(actor_role.as_deref())?;
    let tenant = require_tenant(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let totals = sqlx::query(
        "SELECT COALESCE(SUM(total_cents), 0) AS total, COUNT(*) AS count
         FROM orders
         WHERE tenant_id = ? AND status IN ('PAID', 'CLOSED')
           AND created_at >= date('now', 'start of day')",
    )
    .bind(&tenant)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let revenue: i64 = totals.try_get("total").unwrap_or(0);
    let order_count: i64 = totals.try_get("count").unwrap_or(0);

    let methods = sqlx::query(
        "SELECT json_extract(payload, '$.method') AS method,
                COALESCE(SUM(json_extract(payload, '$.totalAmount')), 0) AS amount
         FROM audit_ledger
         WHERE tenant_id = ? AND action = 'payment:settled_fifo'
           AND created_at >= date('now', 'start of day')
         GROUP BY json_extract(payload, '$.method')",
    )
    .bind(&tenant)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let cash_in: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM cash_movements
         WHERE tenant_id = ? AND movement_type = 'IN' AND created_at >= date('now', 'start of day')",
    )
    .bind(&tenant)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let cash_out: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM cash_movements
         WHERE tenant_id = ? AND movement_type = 'OUT' AND created_at >= date('now', 'start of day')",
    )
    .bind(&tenant)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let today: String = sqlx::query_scalar("SELECT date('now')")
        .fetch_one(&mut *conn)
        .await
        .unwrap_or_default();

    print_header("GUNUN HESAP DEFTERI MALI BELGE", "KASAM360 HESAP DEFTERI");
    println!("Tarih        : {}", today);
    println!("------------------------------------------------");
    println!("{:<34} {:>12}", "ODEME YONTEMI", "TUTAR");
    println!("------------------------------------------------");
    for row in &methods {
        let method: Option<String> = row.try_get("method").ok();
        let amount: i64 = row.try_get("amount").unwrap_or(0);
        println!(
            "{:<34} {:>12}",
            method.as_deref().unwrap_or("BILINMIYEN"),
            fmt_cents(amount)
        );
    }
    if methods.is_empty() {
        println!("Odeme hareketi bulunamadi.");
    }
    println!("------------------------------------------------");
    println!("Kasa Girisi : {}", fmt_cents(cash_in));
    println!("Kasa Cikisi : {}", fmt_cents(cash_out));
    println!("{:<34} {:>12}", "ADET ADISYON", order_count);
    println!("{:<34} {:>12}", "GUNLUK CIRO", fmt_cents(revenue));
    print_footer();
    Ok(())
}

/// Ortak sipariş gövdesi: başlık + kalemler + toplam.
async fn print_order_body(
    conn: &mut sqlx::SqliteConnection,
    order_id: &str,
    title: &str,
    tenant: &str,
) -> Result<(), String> {
    let order = sqlx::query(
        "SELECT table_id, status, total_cents, created_at, notes FROM orders WHERE id = ? AND tenant_id = ?",
    )
    .bind(order_id)
    .bind(tenant)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "NOT_FOUND: bu işletmeye ait sipariş bulunamadı".to_string())?;

    let table_id: String = order.try_get("table_id").unwrap_or_default();
    let status: String = order.try_get("status").unwrap_or_default();
    let total: i64 = order.try_get("total_cents").unwrap_or(0);
    let created_at: String = order.try_get("created_at").unwrap_or_default();
    let notes: Option<String> = order.try_get("notes").ok();

    let items = sqlx::query(
        "SELECT oi.quantity, oi.total_cents, oi.modifiers,
                COALESCE(p.name, oi.product_id) AS product_name
         FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ? ORDER BY oi.id",
    )
    .bind(order_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    print_header(title, "KASAM360 ADISYON");
    println!("Siparis No : {}", order_id);
    println!("Masa       : {}", if table_id.is_empty() { "-" } else { &table_id });
    println!("Durum      : {}", status);
    println!("Tarih      : {}", created_at);
    println!("------------------------------------------------");
    println!("{:<22} {:>4} {:>12}", "URUN", "ADET", "TUTAR");
    println!("------------------------------------------------");
    for item in &items {
        let name: String = item.try_get("product_name").unwrap_or_default();
        let short: String = name.chars().take(22).collect();
        let quantity: i64 = item.try_get("quantity").unwrap_or(0);
        let line_total: i64 = item.try_get("total_cents").unwrap_or(0);
        let modifiers: Option<String> = item.try_get("modifiers").ok();
        println!("{:<22} {:>4} {:>12}", short, quantity, fmt_cents(line_total));
        if let Some(list) = modifiers {
            let clean = list.replace(['[', ']', '"'], "");
            if !clean.trim().is_empty() {
                println!("   + {}", clean);
            }
        }
    }
    println!("------------------------------------------------");
    println!("{:<34} {:>12}", "TOPLAM", fmt_cents(total));
    if let Some(note) = notes {
        if !note.trim().is_empty() {
            println!("Not        : {}", note);
        }
    }
    print_footer();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::fmt_cents;

    #[test]
    fn kuruş_bicimlendirme_tam_sayi_kullanir() {
        assert_eq!(fmt_cents(0), "0,00 TL");
        assert_eq!(fmt_cents(5), "0,05 TL");
        assert_eq!(fmt_cents(123456), "1234,56 TL");
        assert_eq!(fmt_cents(-2050), "-20,50 TL");
    }
}

#[cfg(test)]
#[path = "print_commands_tests.rs"]
mod print_tests;