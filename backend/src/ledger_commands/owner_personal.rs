//! Patron Şahsi hareketleri (Faz 9).
//!
//! ## Patron Şahsi neden ayrı bir komut
//!
//! İşletme sahibinin kendisi için çektiği para **gider değildir**. Masraf olsaydı
//! kâr düşük, dolayısıyla vergi yüksek görünürdü. Oysa kasa hareketi gerçekten
//! vardır. Bu yüzden Patron Şahsi kaydı:
//!
//! * `debts` tablosuna `TAKEN` (biz borçluyuz) olarak yazılır — **gider tablosuna
//!   (`general_expenses`) hiç dokunulmaz**,
//! * P&L'ye girmez,
//! * hesap defterinde **sermaye çekimi** sınıfında görünür.
//!
//! Kuralın kanıtı `owner_personal_tests.rs` içindedir: komut sonrası P&L'in
//! değişmediği ve masanın borç kaydının açıldığı ayrı ayrı test edilir.

use crate::db::DbPool;
use crate::id_generator::generate_id;
use crate::ledger_commands::guard::require_ledger_tenant;
use crate::services::audit_service::{category::FINANS, AuditContext, AuditService};
use crate::services::ledger_statement::format_cents;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct OwnerPersonalPayload {
    #[serde(rename = "tenantId")]
    pub tenant_id: Option<String>,
    #[serde(rename = "actorId")]
    pub actor_id: Option<String>,
    #[serde(rename = "directoryId")]
    pub directory_id: String,
    #[serde(rename = "amountCents")]
    pub amount_cents: i64,
    /// `SERMAYE_CEKIMI` (patron kasadan para çekti) ya da `BORC` (patron
    /// işletmeye para verdi, geri ödenecek).
    #[serde(rename = "movementKind")]
    pub movement_kind: String,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct OwnerPersonalDto {
    #[serde(rename = "debtId")]
    pub debt_id: String,
    #[serde(rename = "directoryName")]
    pub directory_name: String,
    #[serde(rename = "amountCents")]
    pub amount_cents: i64,
    #[serde(rename = "amountLabel")]
    pub amount_label: String,
    #[serde(rename = "movementKind")]
    pub movement_kind: String,
    /// Kullanıcıya gösterilecek sabit Türkçe açıklama. İki değerden biri:
    /// "Sermaye çekimi" ya da "Patron borcu".
    #[serde(rename = "ledgerLabel")]
    pub ledger_label: String,
    /// Her zaman `true`: bu kayıt P&L'ye girmez. Arayüz bu rozeti
    /// göstermekle yükümlüdür, aksi hâde patron şahsi çekimini zarar sanar.
    #[serde(rename = "excludedFromProfit")]
    pub excluded_from_profit: bool,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

/// Patron Şahsi çekimi / patron borcu kaydeder.
///
/// ## Yetki
///
/// Yalnız `OWNER`. Müdür şahsi çekim kaydı açamaz: bu kayıt doğrudan sermayeyi
/// ilgilendirir ve müdürün yetkisi dışındadır (AGENTS.md §6).
#[tauri::command]
pub async fn record_owner_personal(
    actor_role: Option<String>,
    payload: OwnerPersonalPayload,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<OwnerPersonalDto, String> {
    crate::rbac::require_any_present(actor_role.as_deref(), &[crate::rbac::Role::Owner])?;

    if payload.amount_cents <= 0 {
        return Err("Patron Şahsi tutarı 0'dan büyük olmalıdır.".to_string());
    }
    let is_withdrawal = match payload.movement_kind.as_str() {
        "SERMAYE_CEKIMI" => true,
        "BORC" => false,
        other => {
            return Err(format!(
                "Patron Şahsi hareket türü 'SERMAYE_CEKIMI' veya 'BORC' olmalıdır; gelen: {}",
                other
            ))
        }
    };

    let tid = require_ledger_tenant(payload.tenant_id.as_deref())?;

    let audit_lock = crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Neden tip kapısı şart: bu komut `general_expenses`a dokunmadığı için
    // yanlış tipte bir kart (örneğin müşteri) seçilirse kayıt sessizce
    // alacak gibi görünür ve P&L yanlış yönde kayar. Kart tipi burada
    // doğrulanır, `create_debt` gibi genel komuta bırakılmaz.
    let dir_name: Option<String> = sqlx::query_scalar(
        "SELECT name FROM directories WHERE id = ? AND tenant_id = ? AND type = 'OWNER_PERSONAL'",
    )
    .bind(&payload.directory_id)
    .bind(&tid)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| format!("Patron Şahsi kartı okunamadı: {}", e))?;

    let directory_name = dir_name.ok_or_else(|| {
        "Seçilen kart Patron Şahsi kartı değil (veya bu işletmeye ait değil).".to_string()
    })?;

    let debt_id = generate_id("dbt");

    // `TAKEN` = işletme patrona borçlu. Yön `net_balance` ile aynıdır:
    // Patron Şahsi bakiyesi negatiftir ve P&L'e girmez.
    let debt_type = if is_withdrawal { "TAKEN" } else { "GIVEN" };
    let description = payload.note.clone().unwrap_or_else(|| {
        if is_withdrawal {
            "Sermaye çekimi".to_string()
        } else {
            "Patron borcu".to_string()
        }
    });

    sqlx::query(
        "INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents,
                            remaining_amount_cents, due_date, status, is_cash, order_id,
                            description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 'PENDING', 0, NULL, ?, datetime('now'))",
    )
    .bind(&debt_id)
    .bind(&tid)
    .bind(&payload.directory_id)
    .bind(debt_type)
    .bind(payload.amount_cents)
    .bind(payload.amount_cents)
    .bind(&description)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Patron Şahsi kaydı oluşturulamadı: {}", e))?;

    // Neden `cash_movements` YAZILMAZ: bu bir kasa tahsilatı değil, cari bir
    // hesap hareketidir. Kasa hareketi yazmak patronun şahsi paralarını işletme
    // kasası gibi gösterir ve gün sonu kasa tutmaz.

    let role_label = actor_role.clone().unwrap_or_else(|| "UNKNOWN".to_string());
    let (audit_actor_id, audit_actor_role) =
        crate::management_commands::audit_actor(payload.actor_id.clone(), &role_label);

    let ctx = AuditContext::new(
        tid.clone(),
        audit_actor_id,
        audit_actor_role,
        FINANS,
        "owner_personal:recorded",
        debt_id.clone(),
        serde_json::json!({
            "debtId": debt_id,
            "directoryId": payload.directory_id,
            "movementKind": payload.movement_kind,
            "amountCents": payload.amount_cents,
            "excludedFromProfit": true,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(OwnerPersonalDto {
        debt_id,
        directory_name,
        amount_cents: payload.amount_cents,
        amount_label: format_cents(payload.amount_cents),
        movement_kind: payload.movement_kind.clone(),
        ledger_label: if is_withdrawal {
            "Sermaye çekimi".to_string()
        } else {
            "Patron borcu".to_string()
        },
        excluded_from_profit: true,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}