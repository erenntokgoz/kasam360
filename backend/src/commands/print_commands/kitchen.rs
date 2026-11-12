//! Mutfak/bar fişi: sipariş kaydedilince istasyon yazıcısına gider.
//!
//! Neden ayrı komut: "Mutfağa Gönder" adımı kalktı; kaydetmek fişi çıkarmaktır. Yazıcı
//! yok ya da basım başarısız olursa sipariş zaten kayıtlıdır (`submit_order` önce commit
//! eder); bu komut yalnız hangi istasyonun basılamadığını açıkça döndürür ki arayüz
//! kalıcı uyarı gösterebilsin. Basılacak içerik her zaman veritabanından okunur.

use std::collections::BTreeMap;
use std::time::Duration;

use sqlx::Row;

use super::helpers::{require_tenant, utc_yerel_goster};
use crate::db::DbPool;
use crate::rbac::{self, Role};

/// Basım süreci takılırsa kasa akışı beklemesin.
const PRINT_TIMEOUT: Duration = Duration::from_secs(20);
/// Kalemin istasyonu boşsa KDS ile aynı varsayılan kullanılır.
const DEFAULT_STATION: &str = "Sıcak";

#[derive(serde::Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KitchenPrintReport {
    pub printed_stations: Vec<String>,
    pub problems: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KitchenSetup {
    pub has_kitchen_user: bool,
}

/// İşletmede etkin bir KITCHEN kullanıcısı var mı; yoksa mutfak ekranı gizlenir.
#[tauri::command]
pub async fn get_kitchen_setup(
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<KitchenSetup, String> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users WHERE tenant_id = ? AND role = 'KITCHEN' AND is_active = 1",
    )
    .bind(&tenant_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(KitchenSetup {
        has_kitchen_user: count > 0,
    })
}

struct TicketLine {
    quantity: i64,
    name: String,
    modifiers: Option<String>,
    notes: Option<String>,
}

/// Fiş metni; tutar içermez, mutfak yalnız ne hazırlayacağını görür.
fn format_ticket(table: &str, station: &str, created_at: &str, lines: &[TicketLine]) -> String {
    let mut text = String::new();
    text.push_str("================================\n");
    text.push_str(&format!("{station} FISI\n"));
    text.push_str(&format!("Masa: {table}\n"));
    text.push_str(&format!("{}\n", utc_yerel_goster(created_at)));
    text.push_str("--------------------------------\n");
    for line in lines {
        text.push_str(&format!("{} x {}\n", line.quantity, line.name));
        if let Some(modifiers) = line.modifiers.as_deref() {
            let clean = modifiers.replace(['[', ']', '"'], "");
            if !clean.trim().is_empty() {
                text.push_str(&format!("   + {}\n", clean.trim()));
            }
        }
        if let Some(note) = line.notes.as_deref().filter(|n| !n.trim().is_empty()) {
            text.push_str(&format!("   NOT: {}\n", note.trim()));
        }
    }
    text.push_str("================================\n\n\n");
    text
}

/// Metni Windows yazıcı kuyruğuna verir. Yazıcı adı ortam değişkeniyle gider; komut
/// metnine karışmaz, bu yüzden adındaki tırnak komutu bozamaz.
async fn send_to_printer(printer: &str, text: String) -> Result<(), String> {
    let printer = printer.to_string();
    let job = tokio::task::spawn_blocking(move || -> Result<(), String> {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut child = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "[Console]::InputEncoding=[Text.Encoding]::UTF8; $input | Out-Printer -Name $env:KASAM_PRINTER",
            ])
            .env("KASAM_PRINTER", &printer)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("yazıcı komutu başlatılamadı: {e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(text.as_bytes())
                .map_err(|e| format!("fiş yazıcıya iletilemedi: {e}"))?;
        }
        let output = child
            .wait_with_output()
            .map_err(|e| format!("yazıcı yanıt vermedi: {e}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    });
    match tokio::time::timeout(PRINT_TIMEOUT, job).await {
        Err(_) => Err("yazıcı zaman aşımına uğradı".to_string()),
        Ok(Err(e)) => Err(e.to_string()),
        Ok(Ok(result)) => result,
    }
}

/// Verilen kalemlerin istasyon fişlerini basar. Veritabanına hiçbir şey yazılmaz.
#[tauri::command]
pub async fn print_kitchen_ticket(
    order_id: String,
    item_ids: Vec<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<KitchenPrintReport, String> {
    rbac::require_any_present(
        actor_role.as_deref(),
        &[Role::Owner, Role::Manager, Role::Cashier, Role::Waiter],
    )?;
    let tenant = require_tenant(tenant_id.as_deref())?;
    build_and_print(&pool, &tenant, &order_id, &item_ids).await
}

async fn build_and_print(
    pool: &DbPool,
    tenant: &str,
    order_id: &str,
    item_ids: &[String],
) -> Result<KitchenPrintReport, String> {
    let order = sqlx::query(
        "SELECT o.created_at, COALESCE(t.name, o.table_id) AS table_name
         FROM orders o LEFT JOIN tables t ON t.id = o.table_id AND t.tenant_id = o.tenant_id
         WHERE o.id = ? AND o.tenant_id = ?",
    )
    .bind(order_id)
    .bind(tenant)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "NOT_FOUND: bu işletmeye ait sipariş bulunamadı".to_string())?;
    let created_at: String = order.try_get("created_at").unwrap_or_default();
    let table: String = order.try_get("table_name").unwrap_or_default();

    let rows = sqlx::query(
        "SELECT oi.id, oi.quantity, oi.modifiers, oi.notes, oi.station,
                COALESCE(p.name, oi.product_id) AS product_name
         FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ? AND oi.tenant_id = ?
           AND UPPER(COALESCE(oi.status, 'PENDING')) NOT IN ('VOID', 'CANCELLED')
         ORDER BY oi.id",
    )
    .bind(order_id)
    .bind(tenant)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut by_station: BTreeMap<String, Vec<TicketLine>> = BTreeMap::new();
    for row in &rows {
        let id: String = row.try_get("id").map_err(|e| e.to_string())?;
        if !item_ids.contains(&id) {
            continue;
        }
        let station: Option<String> = row.try_get("station").ok().flatten();
        by_station
            .entry(station.unwrap_or_else(|| DEFAULT_STATION.to_string()))
            .or_default()
            .push(TicketLine {
                quantity: row.try_get("quantity").map_err(|e| e.to_string())?,
                name: row.try_get("product_name").unwrap_or_default(),
                modifiers: row.try_get("modifiers").ok().flatten(),
                notes: row.try_get("notes").ok().flatten(),
            });
    }

    let stations = sqlx::query("SELECT name, printer_name FROM stations WHERE tenant_id = ?")
        .bind(tenant)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let printer_of = |station: &str| -> Option<String> {
        stations.iter().find_map(|row| {
            let name: String = row.try_get("name").ok()?;
            let printer: Option<String> = row.try_get("printer_name").ok().flatten();
            let printer = printer.filter(|p| !p.trim().is_empty())?;
            (name.to_lowercase() == station.to_lowercase()).then_some(printer)
        })
    };

    let mut report = KitchenPrintReport {
        printed_stations: Vec::new(),
        problems: Vec::new(),
    };
    for (station, lines) in &by_station {
        let Some(printer) = printer_of(station) else {
            report
                .problems
                .push(format!("{station}: yazıcı atanmamış, fiş basılmadı."));
            continue;
        };
        let text = format_ticket(&table, station, &created_at, lines);
        match send_to_printer(&printer, text).await {
            Ok(()) => report.printed_stations.push(station.clone()),
            Err(reason) => report
                .problems
                .push(format!("{station} ({printer}): {reason}")),
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fis_tutar_icermez_not_ve_secenek_yazar() {
        let lines = [TicketLine {
            quantity: 2,
            name: "Çay".into(),
            modifiers: Some("[\"Şekersiz\"]".into()),
            notes: Some("sıcak".into()),
        }];
        let text = format_ticket("Masa 4", "Bar", "2026-01-01 10:00:00", &lines);
        assert!(text.contains("2 x Çay"));
        assert!(text.contains("+ Şekersiz"));
        assert!(text.contains("NOT: sıcak"));
        assert!(!text.contains("TL"));
    }
}
