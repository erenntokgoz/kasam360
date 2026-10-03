//! e-Arşiv komutları (üret, kuyruk, durum).
//!
//! Rol kapısı: **yalnız `OWNER`**, okuma dahil.
//!
//! Neden müdür dışlanıyor: e-Arşiv belgesi vergi beyanına girer. Bir belgenin
//! kim tarafından görüntülendiği denetimde sorulur ve "müdür vergi belgesini
//! görebiliyor" yanıtı savunma değil risktir. Fatura kaydı sahibin imzasıyla
//! oluşur ve sahibin görebildiği şeydir.

use tauri::State;

use super::{acquire, audit_actor, record_audit, require_tenant, KATEGORI_FINANS};
use crate::db::DbPool;
use crate::rbac::{self, Role};
use crate::services::audit_service::AuditLock;
use crate::services::legal360::e_invoice::{
    cancel_e_invoice, generate_e_invoice, get_e_invoice, list_e_invoices, mark_e_invoice_accepted,
    mark_e_invoice_rejected, mark_e_invoice_sent, EInvoice, EInvoiceInput,
};

#[tauri::command]
pub async fn generate_e_invoice_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    args: EInvoiceInput,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<EInvoice, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<EInvoice, String> = async {
        let fatura = generate_e_invoice(&mut conn, &tenant_id, args).await?;

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            KATEGORI_FINANS,
            "earsiv:fatura_uretildi",
            &fatura.id,
            serde_json::json!({
                "orderId": fatura.order_id,
                "kdvRatePercent": fatura.kdv_rate_percent,
                "matrahCents": fatura.matrah_cents,
                "kdvCents": fatura.kdv_cents,
                "totalCents": fatura.total_cents,
            }),
        )
        .await?;

        Ok(fatura)
    }
    .await;

    match result {
        Ok(deger) => {
            sqlx::query("COMMIT")
                .execute(&mut conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(deger)
        }
        Err(hata) => {
            let _ = sqlx::query("ROLLBACK").execute(&mut conn).await;
            Err(hata)
        }
    }
}

#[tauri::command]
pub async fn get_e_invoice_command(
    actor_role: String,
    tenant_id: Option<String>,
    id: String,
    pool: State<'_, DbPool>,
) -> Result<EInvoice, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    get_e_invoice(&mut conn, &tenant_id, id.trim()).await
}

#[tauri::command]
pub async fn list_e_invoices_command(
    actor_role: String,
    tenant_id: Option<String>,
    status: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<EInvoice>, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;

    list_e_invoices(&mut conn, &tenant_id, status.as_deref()).await
}

/// Durum değiştiren komutlar tek yordamın güvenlik zincirini paylaşır:
/// yetki, kilit, tenant, denetim ve COMMIT/ROLLBACK. Dört ayrı komut bu
/// zinciri dört kez kopyalarsa birinde unutulan `ROLLBACK` tüm modülü bozar.
#[tauri::command]
pub async fn mark_e_invoice_sent_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    id: String,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<EInvoice, String> {
    durum_komutu(
        actor_role,
        actor_id,
        tenant_id,
        id,
        DurumIslem::Gonder,
        pool,
        app_state,
        "earsiv:fatura_gonderildi",
    )
    .await
}

#[tauri::command]
pub async fn mark_e_invoice_accepted_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    id: String,
    response: Option<String>,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<EInvoice, String> {
    durum_komutu(
        actor_role,
        actor_id,
        tenant_id,
        id,
        DurumIslem::Kabul(response),
        pool,
        app_state,
        "earsiv:fatura_kabul_edildi",
    )
    .await
}

#[tauri::command]
pub async fn mark_e_invoice_rejected_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    id: String,
    response: Option<String>,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<EInvoice, String> {
    durum_komutu(
        actor_role,
        actor_id,
        tenant_id,
        id,
        DurumIslem::Ret(response),
        pool,
        app_state,
        "earsiv:fatura_reddedildi",
    )
    .await
}

#[tauri::command]
pub async fn cancel_e_invoice_command(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    id: String,
    reason: Option<String>,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
) -> Result<EInvoice, String> {
    durum_komutu(
        actor_role,
        actor_id,
        tenant_id,
        id,
        DurumIslem::Iptal(reason),
        pool,
        app_state,
        "earsiv:fatura_iptal",
    )
    .await
}

/// Durum komutlarının ortak iskeleti.
///
/// `too_many_arguments` kapatması bilinçlidir: yordam sekiz alan taşır ve
/// bunların altısı doğrudan Tauri IPC parametresidir. Bunları tek bir yapıya
/// sıkıştırmak, her durum komutunda elle bir dönüştürme satırı ve dolayısıyla
/// yeni bir hata yüzeyi doğururdu.
///
/// `DurumIslem` neden enum ve kapalyon değil: `async` bir kapalyon
/// `&mut bağlantı` ödünçlemesini taşıyamaz (HRTB yaşam süresi kısıtı). Enum
/// aynı ayrıştırmayı derleme zamanı denetimiyle yapar ve her geçiş için tek
/// satır yazar; yeni bir durum eklendiğinde eşleşmenin tümünü derleyici
/// zorlar.
#[allow(clippy::too_many_arguments)]
async fn durum_komutu(
    actor_role: String,
    actor_id: Option<String>,
    tenant_id: Option<String>,
    id: String,
    islem: DurumIslem,
    pool: State<'_, DbPool>,
    app_state: State<'_, crate::AppState>,
    eylem: &'static str,
) -> Result<EInvoice, String> {
    rbac::require_any(&actor_role, &[Role::Owner])?;

    let lock = AuditLock::new(app_state.audit_mutex.lock().await);
    let mut conn = acquire(&pool).await?;
    let tenant_id = require_tenant(tenant_id.as_deref())?;
    let (actor_id, actor_role) = audit_actor(actor_id, &actor_role);
    let hedef_id = id.trim().to_string();

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    let result: Result<EInvoice, String> = async {
        let fatura = match islem {
            DurumIslem::Gonder => mark_e_invoice_sent(&mut conn, &tenant_id, &hedef_id).await?,
            DurumIslem::Kabul(yanit) => {
                mark_e_invoice_accepted(&mut conn, &tenant_id, &hedef_id, yanit).await?
            }
            DurumIslem::Ret(yanit) => {
                mark_e_invoice_rejected(&mut conn, &tenant_id, &hedef_id, yanit).await?
            }
            DurumIslem::Iptal(gerekce) => {
                cancel_e_invoice(&mut conn, &tenant_id, &hedef_id, gerekce).await?
            }
        };

        record_audit(
            &mut conn,
            &lock,
            &tenant_id,
            &actor_id,
            &actor_role,
            KATEGORI_FINANS,
            eylem,
            &fatura.id,
            serde_json::json!({
                "status": fatura.status,
                "totalCents": fatura.total_cents,
                "kdvCents": fatura.kdv_cents,
            }),
        )
        .await?;

        Ok(fatura)
    }
    .await;

    match result {
        Ok(deger) => {
            sqlx::query("COMMIT")
                .execute(&mut conn)
                .await
                .map_err(|e| e.to_string())?;
            Ok(deger)
        }
        Err(hata) => {
            let _ = sqlx::query("ROLLBACK").execute(&mut conn).await;
            Err(hata)
        }
    }
}

/// Durum komutlarının desteklediği geçişler.
enum DurumIslem {
    Gonder,
    Kabul(Option<String>),
    Ret(Option<String>),
    Iptal(Option<String>),
}
