//! Dış aktör Tauri komutları.
//!
//! Bu katman **yalnız yetki sınar ve servise delegasyon yapar**; iş mantığı
//! `services/external360` içindedir. Böylece iş mantığı komut altyapısı olmadan
//! testlenebilir ve yetki denetimi tek yerde toplanır.
//!
//! Dört kural her komutta aynıdır:
//!   1. Rol `rbac::require_any` ile **önce** sınanır — servis çağrısından önce.
//!   2. Tenant `require_tenant_id` ile çözülür; boş kiracı reddedilir.
//!   3. Dışarı taşan veya para okuyan komutlar (`*_build`, `*_export`, `*_queue`)
//!      `audit_mutex` alır ve denetim defterine yazar: bu işlemler defter dışına
//!      veri çıkarır, izi olmayan bir dışa aktarım denetimlenemez.
//!   4. MASTER hiçbir kapıda yer almaz — platform hesabı dış aktör verisi görmez.

use crate::rbac::{require_any, Role};
use crate::services::audit_service::{AuditContext, AuditLock, AuditService};
use crate::services::external360::{accountant, menu_file, qr_menu, queues, supplier, tickets};
use crate::DbPool;
use tauri::State;

use super::command_helpers::{audit_actor, require_tenant_id};

/// Denetim kaydı yazar.
///
/// Neden yereldeki yardımcı yerine bu yazım: `inventory360` kendi yardımcısını
/// taşıyor; burada aynı kalıbın kopyası modül içinde kalır ve çağıran modülün
/// yardımcılarına bağımlılık eklenmez.
/// Neden `allow`: argüman sayısı Tauri IPC sözleşmesidir, bizim seçimimiz
/// değildir. Azaltmak komut imzasını değiştirir ve çağıranları kırar.
#[allow(clippy::too_many_arguments)]
async fn denetle(
    conn: &mut sqlx::SqliteConnection,
    kilit: &AuditLock<'_>,
    tenant_id: &str,
    actor_id: &str,
    actor_role: &str,
    category: &'static str,
    action: &str,
    resource_id: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    let ctx = AuditContext::new(
        tenant_id.to_string(),
        actor_id.to_string(),
        actor_role.to_string(),
        category,
        action,
        resource_id.to_string(),
        payload,
        chrono::Utc::now().to_rfc3339(),
    )?;
    // `append` imza özetini döndürür; çağıran yalnız "yazıldı / hata" bilgisine
    // ihtiyaç duyar, özete değil.
    AuditService::append(conn, kilit, &ctx).await.map(|_| ())
}

/// `feat_qr_menu` bayrağı KAPALI iken QR menü komutları 404 döner.
///
/// Neden bu kapı sonradan eklendi: komutlar yazıldığında bayrak kontrolü
/// unutulmuştu. Sonuç, `feat_qr_menu` KAPALI olan bir işletmede menü dosyası
/// yine üretilebiliyor, müşteri oturumu yine açılabiliyor ve bayrak
/// AGENTS.md §3.3'ün yasakladığı anlamda "var ama kapı yok" durumuna
/// düşüyordu. Diğer üç bayrak (`inventory360_commands::require_*`) bu kalıbı
/// zaten uyguluyor; burada da aynı sözleşme geçerli.
///
/// Neden 404 ve 403 değil: bayrak kapalıyken özellik **yoktur**. 403 "var ama
/// yetkin yok" der ve arayüzde yanlış bir boş ekran gösterir.
pub(crate) fn require_qr_menu(active_modules: Option<&Vec<String>>) -> Result<(), String> {
    match active_modules {
        Some(moduller) if moduller.iter().any(|m| m == "feat_qr_menu") => Ok(()),
        _ => Err("NOT_FOUND: QR menü bu işletmede etkin değil".into()),
    }
}

/// QR menü bayrağı kapalıyken 404 döndüğünü ve açıkken geçtiğini doğrular.
#[cfg(test)]
mod qr_menu_flag_tests {
    use super::require_qr_menu;

    fn moduller(aktif: &[&str]) -> Vec<String> {
        aktif.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn bayrak_yoksa_qr_menu_komutlari_404_doner() {
        for moduller in [None, Some(Vec::new()), Some(moduller(&["core"]))] {
            let hata =
                require_qr_menu(moduller.as_ref()).expect_err("bayrak yoksa komut 404 dönmeli");
            assert!(hata.starts_with("NOT_FOUND"), "{}", hata);
        }
    }

    #[test]
    fn bayrak_aciksa_qr_menu_komutlari_gecer() {
        assert!(require_qr_menu(Some(&moduller(&["core", "feat_qr_menu"]))).is_ok());
    }

    #[test]
    fn komsu_bayrak_qr_menu_acmaz() {
        // Yanlış bayrak adı (`feat_qr_menu` ≠ `feat_qr_menus`) kapıyı geçmemeli.
        assert!(require_qr_menu(Some(&moduller(&["feat_qr_menus"]))).is_err());
        // Başka bir bayrağın açık olması bu özelliği açmaz.
        assert!(require_qr_menu(Some(&moduller(&["feat_kds", "feat_delivery"]))).is_err());
    }
}

// ---- müşteri / QR menü ----

/// Müşteri oturumu açar (masa başından QR menü bağlantısı basılır).
#[tauri::command]
pub async fn qr_customer_session_open(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    customer_label: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<qr_menu::MusteriOturumu, String> {
    require_qr_menu(active_modules.as_ref())?;
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager, Role::Waiter])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    qr_menu::oturum_ac(
        &mut conn,
        Some(&tenant),
        customer_label.as_deref().unwrap_or(""),
    )
    .await
}

/// Müşteri oturumunu iptal eder.
#[tauri::command]
pub async fn qr_customer_session_revoke(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    session_token: String,
    pool: State<'_, DbPool>,
) -> Result<bool, String> {
    require_qr_menu(active_modules.as_ref())?;
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    qr_menu::oturum_iptal(&mut conn, &tenant, &session_token).await
}

/// İmzalı statik menü dosyasını (JSON + HTML) üretir.
#[tauri::command]
pub async fn qr_menu_build(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    pool: State<'_, DbPool>,
    state: State<'_, crate::AppState>,
) -> Result<menu_file::ImzaliMenuCiktisi, String> {
    require_qr_menu(active_modules.as_ref())?;
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let kilit = AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let cikti = menu_file::menu_dosyasi_uret(&mut conn, &tenant).await?;

    // Menü dosyası işletmenin ürünlerini ve fiyatlarını dışarı taşır; izi olmazsa
    // "bu fiyatı kim ne zaman yayınladı" sorusu yanıtlanamaz.
    denetle(
        &mut conn,
        &kilit,
        &tenant,
        &actor.0,
        &actor.1,
        "EXTERNAL",
        "qr_menu:built",
        &cikti.key_id,
        serde_json::json!({ "urun_adedi": cikti.json.len() }),
    )
    .await?;

    Ok(cikti)
}

/// Bekleyen müşteri taleplerini listeler.
#[tauri::command]
pub async fn qr_pending_requests(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    pool: State<'_, DbPool>,
) -> Result<Vec<(String, String, String)>, String> {
    require_qr_menu(active_modules.as_ref())?;
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager, Role::Cashier])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    qr_menu::bekleyen_talepler(&mut conn, &tenant).await
}

/// Müşteri talebini mevcut siparişe bağlar.
///
/// Neden sipariş yaratmaz: bkz. `qr_menu` modül başlığı — para üreten tek yer
/// POS'tur. Bu komut yalnız "karşılandı" gerçeğini ve bağlantıyı yazar.
#[tauri::command]
pub async fn qr_request_accept(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    request_id: String,
    order_id: String,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    require_qr_menu(active_modules.as_ref())?;
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    qr_menu::talep_onayla(&mut conn, &tenant, &request_id, &order_id).await
}

/// Müşteri talebini reddeder.
#[tauri::command]
pub async fn qr_request_reject(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    request_id: String,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    require_qr_menu(active_modules.as_ref())?;
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    qr_menu::talep_reddet(&mut conn, &tenant, &request_id).await
}

/// Müşteri geri bildirimini kaydeder.
#[tauri::command]
pub async fn qr_feedback_create(
    tenant_id: Option<String>,
    active_modules: Option<Vec<String>>,
    session_token: String,
    rating: i64,
    comment: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<String, String> {
    require_qr_menu(active_modules.as_ref())?;
    // Rol denetimi **yok**: bu komut müşterinin kendi çağrısıdır, personelin
    // değil. Yetki, doğrulanmış müşteri oturumudur; rol matrisi personelin
    // yetkilerini tanımlar ve müşterinin hiçbir rolü yoktur.
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    qr_menu::geri_bildirim_kaydet(
        &mut conn,
        Some(&tenant),
        &session_token,
        rating,
        comment.as_deref().unwrap_or(""),
    )
    .await
}

// ---- tedarikçi ----

/// Tedarikçi sipariş talebi oluşturur.
#[tauri::command]
pub async fn supplier_request_create(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    supplier_id: String,
    items: String,
    note: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<String, String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    supplier::talep_olustur(
        &mut conn,
        Some(&tenant),
        &supplier_id,
        &items,
        note.as_deref().unwrap_or(""),
    )
    .await
}

/// Talebi imzalı dosya olarak dışa aktarır (tedarikçiye verilecek dosya).
#[tauri::command]
pub async fn supplier_request_export(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    request_id: String,
    pool: State<'_, DbPool>,
    state: State<'_, crate::AppState>,
) -> Result<String, String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let kilit = AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let belge = supplier::talep_disa_aktar(&mut conn, Some(&tenant), &request_id).await?;

    denetle(
        &mut conn,
        &kilit,
        &tenant,
        &actor.0,
        &actor.1,
        "EXTERNAL",
        "supplier:exported",
        &request_id,
        serde_json::json!({ "key_id": belge.key_id }),
    )
    .await?;

    serde_json::to_string(&belge).map_err(|e| e.to_string())
}

/// Talebi WhatsApp kuyruğuna alır.
#[tauri::command]
pub async fn supplier_request_queue(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    request_id: String,
    pool: State<'_, DbPool>,
    state: State<'_, crate::AppState>,
) -> Result<String, String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let kilit = AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let kuyruk_id = supplier::talep_kuyruga_al(&mut conn, &tenant, &request_id).await?;

    denetle(
        &mut conn,
        &kilit,
        &tenant,
        &actor.0,
        &actor.1,
        "EXTERNAL",
        "supplier:queued",
        &request_id,
        serde_json::json!({ "kuyruk": kuyruk_id }),
    )
    .await?;

    Ok(kuyruk_id)
}

// ---- mali müşavir ----

/// Dönem raporu üretir (yalnız işletme sahibi).
///
/// Neden yalnız sahibi: rapor ciro, iptal ve borç rakamlarını dışarı taşır. Bu
/// patronun bilgisidir; yöneticinin görmesi yetki değil, veri sızıntısıdır.
#[tauri::command]
pub async fn accountant_report_build(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    period_start: String,
    period_end: String,
    pool: State<'_, DbPool>,
    state: State<'_, crate::AppState>,
) -> Result<String, String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let kilit = AuditLock::new(state.audit_mutex.lock().await);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rapor = accountant::rapor_uret(
        &mut conn,
        Some(&tenant),
        &period_start,
        &period_end,
        &actor.0,
    )
    .await?;

    denetle(
        &mut conn,
        &kilit,
        &tenant,
        &actor.0,
        &actor.1,
        "EXTERNAL",
        "accountant:report_built",
        &rapor.id,
        serde_json::json!({
            "donem_baslangic": period_start,
            "donem_bitis": period_end,
            "tahsilat_cents": rapor.govde.govde.tahsilat_cents,
        }),
    )
    .await?;

    serde_json::to_string(&rapor.govde).map_err(|e| e.to_string())
}

/// Raporu müşavire iletildi olarak işaretler.
#[tauri::command]
pub async fn accountant_report_mark_sent(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    report_id: String,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    accountant::rapor_gonderildi_isaretle(&mut conn, &tenant, &report_id).await
}

// ---- teknik servis ----

/// Servis kaydı açar.
///
/// Neden `allow`: argüman sayısı IPC sözleşmesidir (bkz. `denetle`).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn service_ticket_create(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    category: String,
    severity: String,
    title: String,
    description: Option<String>,
    assigned_to: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<String, String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    tickets::kayit_ac(
        &mut conn,
        Some(&tenant),
        &category,
        &severity,
        &title,
        description.as_deref().unwrap_or(""),
        assigned_to.as_deref(),
    )
    .await
}

/// Servis kaydının durumunu ilerletir.
#[tauri::command]
pub async fn service_ticket_update_status(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    ticket_id: String,
    status: String,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    tickets::durum_guncelle(&mut conn, &tenant, &ticket_id, &status).await
}

/// Açık servis kayıtlarını listeler.
#[tauri::command]
pub async fn service_tickets_open(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<(String, String, String)>, String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager, Role::Cashier])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    tickets::acik_kayitlar(&mut conn, &tenant).await
}

// ---- kuyruklar ----

/// Bekleyen WhatsApp ve e-posta mesajlarını sahte sağlayıcıyla gönderir.
///
/// Neden sahte: AGENTS.md §3.1 harici bulutu yasaklıyor. Bu komut ağa çıkmaz.
#[tauri::command]
pub async fn outbound_queues_flush(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<(i64, i64), String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let w = queues::whatsapp_kuyrugunu_isle(&mut conn, Some(&tenant)).await?;
    let e = queues::email_kuyrugunu_isle(&mut conn, Some(&tenant)).await?;
    Ok((w.gonderilen + w.basarisiz, e.gonderilen + e.basarisiz))
}

/// Kuyrukların bekleyen sayısını döndürür.
#[tauri::command]
pub async fn outbound_queues_pending(
    actor_id: Option<String>,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<(i64, i64), String> {
    let actor = audit_actor(actor_id, actor_role);
    require_any(&actor.1, &[Role::Owner, Role::Manager, Role::Cashier])?;
    let tenant = require_tenant_id(tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    queues::bekleyen_sayi(&mut conn, &tenant).await
}
