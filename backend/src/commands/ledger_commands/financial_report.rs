//! Finansal rapor komutları: P&L ve dışa aktarım.
//!
//! Neden ayrı dosya: `expenses.rs` 500 satır tavanına ulaşmıştı. Hesaplama
//! mantığı zaten `services::pnl_service` içindedir; bu dosya yalnız yetki,
//! serileştirme ve dışa aktarım biçimini üstlenir.

use crate::db::DbPool;
use crate::ledger_commands::expenses::{
    resolve_date_range, ExpenseCategorySummaryDto, FinancialReportDto, MonthlyFinancialTrendDto,
};
use crate::ledger_commands::guard::require_ledger_tenant;
use crate::services::ledger_statement::format_cents;
use serde::{Deserialize, Serialize};

/// Yerel gün ofseti (dakika). Gelmezse UTC günü kabul edilir; makul saat dilimi dışı reddedilir,
/// çünkü ofset gün sınırını kaydırır ve uç değer dönemi tamamen yanlış güne taşırdı.
fn require_utc_offset(value: Option<i64>) -> Result<i64, String> {
    match value {
        None => Ok(0),
        Some(minutes) if (-14 * 60..=14 * 60).contains(&minutes) => Ok(minutes),
        Some(_) => Err("INVALID_ARGUMENT: utcOffsetMinutes -840 ile 840 arasında olmalıdır".into()),
    }
}

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
    utc_offset_minutes: Option<i64>,
    pool: tauri::State<'_, DbPool>,
) -> Result<FinancialReportDto, String> {
    // Kâr yalnız işletme sahibinindir: Panorama da müdüre kâr göstermez, iki kapı
    // ayrışsaydı müdür aynı rakamı buradan okurdu.
    crate::rbac::require_any_present(actor_role.as_deref(), &[crate::rbac::Role::Owner])?;

    let range = resolve_date_range(start_date.as_ref(), end_date.as_ref())?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let owned: Option<(String, String)> = range.map(|(s, e)| (s.clone(), e.clone()));

    let offset = require_utc_offset(utc_offset_minutes)?;
    let report =
        crate::services::pnl_service::financial_report_at(&pool, &tid, &owned, offset).await?;

    Ok(FinancialReportDto {
        total_revenue_cents: report.total_revenue_cents,
        total_cogs_cents: report.total_cogs_cents,
        total_vat_cents: report.total_vat_cents,
        total_refunds_cents: report.total_refunds_cents,
        gross_profit_cents: report.gross_profit_cents,
        cost_missing_lines: report.cost_missing_lines,
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
    utc_offset_minutes: Option<i64>,
    pool: tauri::State<'_, DbPool>,
) -> Result<FinancialExportDto, String> {
    crate::rbac::require_any_present(
        actor_role.as_deref(),
        &[crate::rbac::Role::Owner, crate::rbac::Role::Manager],
    )?;

    let range = resolve_date_range(start_date.as_ref(), end_date.as_ref())?;
    let tid = require_ledger_tenant(tenant_id.as_deref())?;
    let owned: Option<(String, String)> = range.map(|(s, e)| (s.clone(), e.clone()));

    let offset = require_utc_offset(utc_offset_minutes)?;
    let report =
        crate::services::pnl_service::financial_report_at(&pool, &tid, &owned, offset).await?;

    let rows = financial_export_rows(&report, owned.as_ref());

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

/// Dosyanın satırları. Ekrandaki kâr hesabıyla aynı kalemler aynı sırayla
/// yazılır; dönem ve maliyet eksikliği de dosyada durur, dosya tek başına okunur.
fn financial_export_rows(
    report: &crate::services::pnl_service::FinancialReport,
    range: Option<&(String, String)>,
) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = Vec::with_capacity(40);
    let (start, end) = match range {
        Some((s, e)) => (s.clone(), e.clone()),
        None => ("Tüm dönem".to_string(), "Tüm dönem".to_string()),
    };
    rows.push(vec![
        "Dönem".into(),
        "Başlangıç".into(),
        start,
        String::new(),
    ]);
    rows.push(vec!["Dönem".into(), "Bitiş".into(), end, String::new()]);
    let approximate = report.cost_missing_lines > 0;
    if approximate {
        rows.push(vec![
            "Uyarı".into(),
            "Maliyet eksik".into(),
            report.cost_missing_lines.to_string(),
            "kalemin partisi yok; kâr yaklaşıktır".into(),
        ]);
    }

    // Başlık satırı Türkçe ve birim açık: muhasebeciye hangi sayının ne olduğunu
    // sormamak yerine dosya kendini açıklar.
    rows.push(vec![
        "Bölüm".to_string(),
        "Kalem".to_string(),
        "TutarKurus".to_string(),
        "TutarTL".to_string(),
    ]);
    let profit_label = |label: &str| {
        if approximate {
            format!("{label} (yaklaşık, maliyet eksik)")
        } else {
            label.to_string()
        }
    };
    rows.push(summary_row(
        "Gelir",
        "Peşin satış toplamı",
        report.total_sales_revenue_cents,
    ));
    rows.push(summary_row(
        "Gelir",
        "Veresiye tahsilatı",
        report.total_debt_collected_cents,
    ));
    rows.push(summary_row(
        "Gelir",
        "TOPLAM GELİR",
        report.total_revenue_cents,
    ));
    rows.push(summary_row(
        "İade",
        "Toplam İadeler",
        report.total_refunds_cents,
    ));
    rows.push(summary_row("Vergi", "KDV", report.total_vat_cents));
    rows.push(summary_row(
        "Maliyet",
        "Satılan Malın Maliyeti (COGS)",
        report.total_cogs_cents,
    ));
    rows.push(summary_row(
        "Kâr",
        &profit_label("BRÜT KÂR"),
        report.gross_profit_cents,
    ));
    rows.push(summary_row(
        "Gider",
        "TOPLAM GİDER",
        report.total_expenses_cents,
    ));
    rows.push(summary_row(
        "Sonuç",
        &profit_label("NET KÂR / ZARAR"),
        report.net_profit_cents,
    ));
    rows.push(summary_row(
        "Bilanço",
        "Açık alacak",
        report.receivables_cents,
    ));
    rows.push(summary_row("Bilanço", "Açık borç", report.payables_cents));

    for c in &report.expenses_by_category {
        rows.push(summary_row("Gider", &c.category, c.total_cents));
    }

    for t in &report.monthly_trend {
        rows.push(summary_row(
            "Aylık",
            &format!("{} gelir", t.month),
            t.revenue_cents,
        ));
        rows.push(summary_row(
            "Aylık",
            &format!("{} gider", t.month),
            t.expense_cents,
        ));
        rows.push(summary_row(
            "Aylık",
            &format!("{} net", t.month),
            t.profit_cents,
        ));
    }
    rows
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
    use super::{csv_cell, financial_export_file_name, financial_export_rows};
    use crate::services::pnl_service::FinancialReport;

    fn report(cost_missing_lines: i64) -> FinancialReport {
        FinancialReport {
            total_revenue_cents: 100_000,
            total_sales_revenue_cents: 100_000,
            total_debt_collected_cents: 0,
            total_cogs_cents: 20_000,
            total_refunds_cents: 0,
            total_vat_cents: 10_000,
            gross_profit_cents: 70_000,
            cost_missing_lines,
            total_expenses_cents: 5_000,
            net_profit_cents: 65_000,
            receivables_cents: 0,
            payables_cents: 0,
            expenses_by_category: Vec::new(),
            monthly_trend: Vec::new(),
        }
    }

    fn find<'a>(rows: &'a [Vec<String>], item: &str) -> Option<&'a Vec<String>> {
        rows.iter().find(|row| row[1].starts_with(item))
    }

    #[test]
    fn dosya_donemi_ve_kdv_yi_yazar() {
        let range = ("2026-10-01".to_string(), "2026-10-31".to_string());
        let rows = financial_export_rows(&report(0), Some(&range));
        assert_eq!(rows[0], vec!["Dönem", "Başlangıç", "2026-10-01", ""]);
        assert_eq!(rows[1], vec!["Dönem", "Bitiş", "2026-10-31", ""]);
        // Brüt kâr = gelir - iade - KDV - maliyet: KDV satırı olmadan dosya tutmaz.
        assert_eq!(find(&rows, "KDV").map(|r| r[2].as_str()), Some("10000"));
        assert_eq!(
            find(&rows, "BRÜT KÂR").map(|r| r[1].as_str()),
            Some("BRÜT KÂR")
        );
        assert!(find(&rows, "Maliyet eksik").is_none());
    }

    #[test]
    fn maliyet_eksikse_kar_yaklasik_yazilir() {
        let rows = financial_export_rows(&report(3), None);
        assert_eq!(rows[0][2], "Tüm dönem");
        assert_eq!(
            find(&rows, "Maliyet eksik").map(|r| r[2].as_str()),
            Some("3")
        );
        assert_eq!(
            find(&rows, "NET KÂR").map(|r| r[1].as_str()),
            Some("NET KÂR / ZARAR (yaklaşık, maliyet eksik)")
        );
    }

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
