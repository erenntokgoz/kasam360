//! Finansal rapor komutları (Faz 9): P&L ve dışa aktarım.
//!
//! Neden ayrı dosya: `expenses.rs` 500 satır tavanına ulaşmıştı. Hesaplama
//! mantığı zaten `services::pnl_service` içindedir; bu dosya yalnız yetki,
//! serileştirme ve dışa aktarım biçimini üstlenir.

use crate::db::DbPool;
use crate::ledger_commands::expenses::{
    resolve_date_range, ExpenseCategorySummaryDto, FinancialReportDto,
    MonthlyFinancialTrendDto,
};
use crate::ledger_commands::guard::require_ledger_tenant;
use crate::services::ledger_statement::format_cents;
use serde::{Deserialize, Serialize};

/// İşletmenin net kâr/zarar, gelir, gider ve borç/alacak bilançosunu hesaplar.
///
/// Neden delegasyon: çift sayım kuralı ve sessiz hata yasağı (AGENTS.md §3.4)
/// yalnız test edilebilir bir katmanda kanıtlanabilir. Komut yalnız yetkiyi ve
/// serileştirmeyi üstlenir; hesap `services::pnl_service::financial_report`
/// içindedir.
#[tauri::command]
pub async fn get_financial_report(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<FinancialReportDto, String> {
    // SPEC §34 "Raporlar": işletme sahibi tam, müdür kısmi. Bu komut gelir, gider
    // ve borç/alacak bilançosunu döndürdüğü için kasiyer, garson ve mutfak
    // rolleri dışarıdadır.
    crate::rbac::require_any_present(
        actor_role.as_deref(),
        &[crate::rbac::Role::Owner, crate::rbac::Role::Manager],
    )?;

    let range = resolve_date_range(start_date.as_ref(), end_date.as_ref())?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let owned: Option<(String, String)> = range.map(|(s, e)| (s.clone(), e.clone()));

    let report = crate::services::pnl_service::financial_report(&pool, &tid, &owned).await?;

    Ok(FinancialReportDto {
        total_revenue_cents: report.total_revenue_cents,
        total_expenses_cents: report.total_expenses_cents,
        net_profit_cents: report.net_profit_cents,
        receivables_cents: report.receivables_cents,
        payables_cents: report.payables_cents,
        expenses_by_category: report
            .expenses_by_category
            .into_iter()
            .map(|c| ExpenseCategorySummaryDto {
                category: c.category,
                total_cents: c.total_cents,
                count: c.count,
            })
            .collect(),
        monthly_trend: report
            .monthly_trend
            .into_iter()
            .map(|t| MonthlyFinancialTrendDto {
                month: t.month,
                revenue_cents: t.revenue_cents,
                expense_cents: t.expense_cents,
                profit_cents: t.profit_cents,
            })
            .collect(),
    })
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct FinancialExportDto {
    /// Noktalı virgül ayraçlı, `TutarKurus` sütunu tam kuruş sayısal.
    pub csv: String,
    #[serde(rename = "rowCount")]
    pub row_count: i64,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "generatedAt")]
    pub generated_at: String,
}

/// Finansal raporu dışa aktarır (muhasebe programına verilecek biçim).
///
/// ## Neden CSV üretiyoruz, dosya yazmıyoruz
///
/// Dosyayı Rust tarafında yazmak, kullanıcının belge konumunu kontrol edemeyen
/// bir yan etki yaratırdı. Bu komut yalnız **içeriği** üretir; kaydetme ve
/// yazdırma kararı masaüstünde kullanıcının.
///
/// ## Neden tam kuruş sütunu
///
/// CSV'nin ondalık ayracı nokta, sütun ayracı ise noktalı virgüldür. Ondalık
/// ayracı virgül olan bir dosyaya "1.234,56" yazmak sütunları kaydırır. Bu
/// yüzden `TutarKurus` sütunu tam kuruş sayısal, `TutarTL` sütunu ise yalnız
/// insan okuması içindir.
#[tauri::command]
pub async fn export_financial_report(
    actor_role: Option<String>,
    tenant_id: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<FinancialExportDto, String> {
    crate::rbac::require_any_present(
        actor_role.as_deref(),
        &[crate::rbac::Role::Owner, crate::rbac::Role::Manager],
    )?;

    let range = resolve_date_range(start_date.as_ref(), end_date.as_ref())?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let owned: Option<(String, String)> = range.map(|(s, e)| (s.clone(), e.clone()));

    let report = crate::services::pnl_service::financial_report(&pool, &tid, &owned).await?;

    let mut rows: Vec<Vec<String>> = Vec::with_capacity(32);

    // Başlık satırı Türkçe ve birim açık: muhasebeciye hangi sayının ne olduğunu
    // sormamak yerine dosya kendini açıklar.
    rows.push(vec![
        "Bölüm".to_string(),
        "Kalem".to_string(),
        "TutarKurus".to_string(),
        "TutarTL".to_string(),
    ]);

    rows.push(summary_row("Gelir", "Peşin satış toplamı", report.total_sales_revenue_cents));
    rows.push(summary_row(
        "Gelir",
        "Veresiye tahsilatı",
        report.total_debt_collected_cents,
    ));
    rows.push(summary_row("Gelir", "TOPLAM GELİR", report.total_revenue_cents));
    rows.push(summary_row("Gider", "TOPLAM GİDER", report.total_expenses_cents));
    rows.push(summary_row(
        "Sonuç",
        "NET KÂR / ZARAR",
        report.net_profit_cents,
    ));
    rows.push(summary_row("Bilanço", "Açık alacak", report.receivables_cents));
    rows.push(summary_row("Bilanço", "Açık borç", report.payables_cents));

    for c in &report.expenses_by_category {
        rows.push(summary_row("Gider", &c.category, c.total_cents));
    }

    for t in &report.monthly_trend {
        rows.push(summary_row("Aylık", &format!("{} gelir", t.month), t.revenue_cents));
        rows.push(summary_row("Aylık", &format!("{} gider", t.month), t.expense_cents));
        rows.push(summary_row(
            "Aylık",
            &format!("{} net", t.month),
            t.profit_cents,
        ));
    }

    let csv = rows
        .iter()
        .map(|r| r.iter().map(|c| csv_cell(c)).collect::<Vec<_>>().join(";"))
        .collect::<Vec<_>>()
        .join("\r\n");

    Ok(FinancialExportDto {
        csv,
        row_count: rows.len() as i64,
        file_name: financial_export_file_name(owned.as_ref()),
        generated_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Bir özet satırı üretir: bölüm, kalem, kuruş ve okunabilir TL.
fn summary_row(section: &str, item: &str, cents: i64) -> Vec<String> {
    vec![
        section.to_string(),
        item.to_string(),
        cents.to_string(),
        format_cents(cents),
    ]
}

/// Hücre içindeki ayraç ve tırnakları kaçışlar.
///
/// Neden: kategori adı "Kırtasiye; Bayi" gibi bir noktalı virgül içerebilir;
/// kaçışlanmazsa dosya o satırı iki sütuna böler ve toplam yanlış okunur.
/// **Sütun ayracı noktalı virgül olduğu için kaçış yalnız `;`, `"` ve satır sonu
/// için gerekir.** Türkçe binlik ayracı olan virgül kaçış gerektirmez.
fn csv_cell(value: &str) -> String {
    if value.contains(';') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// Dışa aktarım dosya adını tarih aralığından üretir.
fn financial_export_file_name(range: Option<&(String, String)>) -> String {
    match range {
        Some((s, e)) => format!("kasam360-finans-{}_{}.csv", s, e),
        None => "kasam360-finans-tum-donem.csv".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{csv_cell, financial_export_file_name};

    #[test]
    fn plain_cell_is_not_quoted() {
        assert_eq!(csv_cell("RENT"), "RENT");
        assert_eq!(csv_cell("1.234,56 TL"), "1.234,56 TL");
    }

    #[test]
    fn separator_inside_category_is_quoted() {
        // Sütun ayracı noktalı virgüldür; yalnız o kaçırılır. Virgül Türkçe
        // binlik ayracıdır ve dosyayı bozmaz.
        assert_eq!(
            csv_cell("Kırtasiye; Bayi"),
            "\"Kırtasiye; Bayi\"",
            "noktalı virgül içeren kategori adı sütun kaydırmamalı"
        );
        assert_eq!(
            csv_cell("Kırtasiye, Bayi"),
            "Kırtasiye, Bayi",
            "virgül sütun ayracı değildir; kaçış gerekmez"
        );
    }

    #[test]
    fn quotes_are_doubled_and_escaped() {
        assert_eq!(csv_cell("Beyaz \"Örtü\""), "\"Beyaz \"\"Örtü\"\"\"");
    }

    #[test]
    fn newline_inside_cell_is_quoted() {
        assert_eq!(csv_cell("çok\nsatır"), "\"çok\nsatır\"");
    }

    #[test]
    fn file_name_encodes_the_period() {
        assert_eq!(
            financial_export_file_name(Some(&("2026-10-01".to_string(), "2026-10-31".to_string()))),
            "kasam360-finans-2026-10-01_2026-10-31.csv"
        );
        assert_eq!(
            financial_export_file_name(None),
            "kasam360-finans-tum-donem.csv"
        );
    }
}