use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CashMovementDto {
    pub id: String,
    #[serde(rename = "shiftId")]
    pub shift_id: String,
    #[serde(rename = "movementType")]
    pub movement_type: String,
    #[serde(rename = "amountCents")]
    pub amount_cents: i64,
    pub reason: String,
    #[serde(rename = "actorId")]
    pub actor_id: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ShiftSummaryDto {
    #[serde(rename = "shiftId")]
    pub shift_id: String,
    #[serde(rename = "totalSales")]
    pub total_sales: i64,
    #[serde(rename = "totalCashIn")]
    pub total_cash_in: i64,
    #[serde(rename = "totalCashOut")]
    pub total_cash_out: i64,
    #[serde(rename = "expectedBalance")]
    pub expected_balance: i64,
    pub discrepancy: i64,
    #[serde(rename = "actualClosingBalance")]
    pub actual_closing_balance: Option<i64>,
}

// Neden `allow`: Tauri IPC sözleşmesi D1/D2 gereği değiştirilemez; komut
// imzası arayüzle sözleşmedir, argümanları DTO'ya toplamak IPC'yi kırar.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn cash_in(
    shift_id: String,
    amount_cents: i64,
    reason: String,
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<CashMovementDto, String> {
    use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};

    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    
    let id = format!("cmin_{}", Uuid::new_v4());
    let tenant_id = tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    
    sqlx::query(
        "INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at)
         VALUES (?, ?, ?, 'IN', ?, ?, ?, datetime('now'))"
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&shift_id)
    .bind(amount_cents)
    .bind(&reason)
    .bind(&actor_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // "Kasa Giriş & Çıkış" operasyon filtresi bu iki kayıttan beslenir.
    let ctx = AuditContext::new(
        tenant_id,
        actor_id.clone(),
        actor_role.unwrap_or_else(|| "Cashier".to_string()),
        category::FINANS,
        "cash:movement_in",
        id.clone(),
        serde_json::json!({
            "shiftId": shift_id,
            "amountCents": amount_cents,
            "reason": reason,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    
    tx.commit().await.map_err(|e| e.to_string())?;
    
    Ok(CashMovementDto {
        id,
        shift_id,
        movement_type: "IN".to_string(),
        amount_cents,
        reason,
        actor_id,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
    #[allow(clippy::too_many_arguments)]
pub async fn cash_out(
    shift_id: String,
    amount_cents: i64,
    reason: String,
    actor_id: String,
    actor_role: Option<String>,
    tenant_id: Option<String>,
    approval_token: Option<String>,
    #[allow(non_snake_case)]
    approvalToken: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<CashMovementDto, String> {
    use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};

    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let id = format!("cmout_{}", Uuid::new_v4());
    let tenant_id = tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    let actor_role = actor_role.unwrap_or_else(|| "Cashier".to_string());
    let jeton = approval_token.or(approvalToken);

    // Kasa çıkışı para hareketidir: negatif veya sıfır tutar "çıkış" değildir.
    // Negatif bir tutar `IN` hareketi gibi toplamlara ters yönde işler ve
    // vardiya farkını yapay olarak şişirir.
    use crate::services::security360::money_gate as gate;
    gate::nakit_tutar_gecerli_mi(amount_cents)?;
    gate::gerekce_gecerli_mi(&reason)?;

    // Vardiya bu kiracının mı? Önceden hiç sorulmuyordu: başka bir işletmenin
    // vardiya kimliğiyle hareket yazılabiliyor ve para başka kasanın defterine
    // gidiyordu. Vardiya `closed_at` doluysa da hareket yazılamaz.
    let vardiya = sqlx::query("SELECT id, status FROM shifts WHERE id = ? AND tenant_id = ?")
        .bind(&shift_id)
        .bind(&tenant_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let durum: Option<String> = match &vardiya {
        Some(satir) => Some(satir.try_get("status").map_err(|e| e.to_string())?),
        None => None,
    };
    gate::vardiya_kabul_eder_mi(durum.as_deref())?;

    // Eşik aşımı onay gerektirir (D3). Eşik kiracının DB kaydından okunur;
    // kayıt yoksa bu yüzey mevcut davranışta kalır (onay istenmez).
    let esik = crate::services::security360::threshold::esik_oku(&mut tx, &tenant_id).await?;
    if gate::onay_gerekli_mi(amount_cents, esik) {
        let token = gate::onay_jetonunu_zorunlu_kil(jeton.as_deref())?;

        // Kaynak kimliği vardiya + tutardan türetilir: onay jetonu işlemden
        // önce üretildiği için komutun içindeki rastgele haremet `id`si
        // onaylayana bildirilemezdi.
        let kaynak = gate::kasa_cikis_kaynagi(&shift_id, amount_cents);

        let request = crate::approval_service::ApprovalRequest {
            tenant_id: tenant_id.clone(),
            operation: crate::approval_service::operation::CASH_OUT.to_string(),
            resource_id: kaynak,
            actor_id: actor_id.trim().to_string(),
            actor_role: actor_role.clone(),
            amount_cents,
            approved_percent_hint: 0,
            terminal_id: "terminal_cash".to_string(),
        };
        let approver = crate::approval_service::consume_token(&mut tx, token, &request).await?;

        let ctx = AuditContext::new(
            tenant_id.clone(),
            approver.approver_id.clone(),
            approver.approver_role.as_str().to_string(),
            category::GUVENLIK,
            "approval:consumed",
            id.clone(),
            serde_json::json!({
                "operation": crate::approval_service::operation::CASH_OUT,
                "amountCents": amount_cents,
                "thresholdCents": esik,
                "actorId": request.actor_id,
                "approverId": approver.approver_id,
                "approverRole": approver.approver_role.as_str(),
            }),
            chrono::Utc::now().to_rfc3339(),
        )?;
        AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    }

    sqlx::query(
        "INSERT INTO cash_movements (id, tenant_id, shift_id, movement_type, amount_cents, reason, actor_id, created_at)
         VALUES (?, ?, ?, 'OUT', ?, ?, ?, datetime('now'))"
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&shift_id)
    .bind(amount_cents)
    .bind(&reason)
    .bind(&actor_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let ctx = AuditContext::new(
        tenant_id,
        actor_id.clone(),
        actor_role,
        category::FINANS,
        "cash:movement_out",
        id.clone(),
        serde_json::json!({
            "shiftId": shift_id,
            "amountCents": amount_cents,
            "reason": reason,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(&mut tx, &audit_lock, &ctx).await?;
    
    tx.commit().await.map_err(|e| e.to_string())?;
    
    Ok(CashMovementDto {
        id,
        shift_id,
        movement_type: "OUT".to_string(),
        amount_cents,
        reason,
        actor_id,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn get_shift_summary(
    shift_id: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<ShiftSummaryDto, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let tenant_id = tenant_id.unwrap_or_else(|| "DEFAULT_TENANT".to_string());
    
    // Get shift details (opening balance, actual closing if any)
    let shift_row = sqlx::query("SELECT opened_at, expected_amount_cents, actual_amount_cents, closed_at, tenant_id FROM shifts WHERE id = ? AND tenant_id = ?")
        .bind(&shift_id)
        .bind(&tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        
let Some(shift) = shift_row else {
        return Err("NOT_FOUND: Vardiya bulunamadı.".into());
    };
    // Para ve sayaç okumaları `unwrap_or(0)` **olamaz** (AGENTS.md §3.4): SQL
    // hatası sıfıra dönüşünce vardiya farkı "sıfır" görünür ve kasa açığı
    // hatasız raporlanır. Yanlış rapor, hata mesajından daha tehlikelidir.
    let opening_balance: i64 = shift
        .try_get("expected_amount_cents")
        .map_err(|e| e.to_string())?;
    // `Option` okuması da `?` ile yükselir: `NULL` sütunu ile bozulan sütun
    // arasındaki fark, "sayım girilmedi" ile "okuma başarısız" ayrımıdır.
    let actual_closing_balance: Option<i64> = shift
        .try_get("actual_amount_cents")
        .map_err(|e| e.to_string())?;
    let opened_at: String = shift.try_get("opened_at").map_err(|e| e.to_string())?;
    let closed_at: Option<String> = shift.try_get("closed_at").map_err(|e| e.to_string())?;

    // Vardiya sırasındaki toplam satışlar
    // Vardiya satışları tek bir defterde tutulduğu için tenant filtresi
    // zorunludur: filtresiz sorgu tüm işletmelerin cirosunu bu vardiyaya yazardı.
    let mut sales_query = String::from(
        "SELECT COALESCE(sum(json_extract(payload, '$.totalAmount')), 0) as total
         FROM audit_ledger 
         WHERE tenant_id = ? AND action='payment:settled_fifo' AND created_at >= ?"
    );
    // Yalnızca nakit satışlar (Kasa çekmecesine giren nakit)
    let mut cash_sales_query = String::from(
        "SELECT COALESCE(sum(json_extract(payload, '$.totalAmount')), 0) as total
         FROM audit_ledger 
         WHERE tenant_id = ? AND action='payment:settled_fifo' 
         AND UPPER(json_extract(payload, '$.method')) = 'CASH' 
         AND created_at >= ?"
    );
    
    let (sales_row, cash_sales_row) = if let Some(ref closed) = closed_at {
        sales_query.push_str(" AND created_at <= ?");
        cash_sales_query.push_str(" AND created_at <= ?");
        let s = sqlx::query(&sales_query).bind(&tenant_id).bind(&opened_at).bind(closed).fetch_one(&mut *conn).await.map_err(|e| e.to_string())?;
        let cs = sqlx::query(&cash_sales_query).bind(&tenant_id).bind(&opened_at).bind(closed).fetch_one(&mut *conn).await.map_err(|e| e.to_string())?;
        (s, cs)
    } else {
        let s = sqlx::query(&sales_query).bind(&tenant_id).bind(&opened_at).fetch_one(&mut *conn).await.map_err(|e| e.to_string())?;
        let cs = sqlx::query(&cash_sales_query).bind(&tenant_id).bind(&opened_at).fetch_one(&mut *conn).await.map_err(|e| e.to_string())?;
        (s, cs)
    };
    
    let total_sales: i64 = sales_row.try_get("total").map_err(|e| e.to_string())?;
    let cash_sales: i64 = cash_sales_row.try_get("total").map_err(|e| e.to_string())?;

    // Kasa hareketleri **mutlaka** kiracı filtresiyle okunur. Önceden filtre
    // yoktu: `shift_id` çapraz tenant'ta benzersiz olmadığı için başka bir
    // işletmenin kasa çıkışları bu vardiyanın toplamına giriyor ve fark
    // yapay olarak büyüyordu.
    let cash_in_row = sqlx::query(
        "SELECT COALESCE(SUM(amount_cents), 0) as total FROM cash_movements
         WHERE shift_id = ? AND tenant_id = ? AND movement_type = 'IN'",
    )
    .bind(&shift_id)
    .bind(&tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let total_cash_in: i64 = cash_in_row.try_get("total").map_err(|e| e.to_string())?;

    let cash_out_row = sqlx::query(
        "SELECT COALESCE(SUM(amount_cents), 0) as total FROM cash_movements
         WHERE shift_id = ? AND tenant_id = ? AND movement_type = 'OUT'",
    )
    .bind(&shift_id)
    .bind(&tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let total_cash_out: i64 = cash_out_row.try_get("total").map_err(|e| e.to_string())?;

    // Yalnızca nakit satışlar kasa çekmecesine eklenir (Kredi kartı/yemek kartı hariç tutulur)
    let expected_balance = opening_balance + cash_sales + total_cash_in - total_cash_out;
    // Kapatılmamış vardiyada fark **hesaplanamaz**; sıfır yazmak "kasa tutuyor"
    // izlenimi verir. Alan boş kalır, arayüz "vardiya açık" der.
    let discrepancy = match actual_closing_balance {
        Some(actual) => actual - expected_balance,
        None => 0,
    };
    
    Ok(ShiftSummaryDto {
        shift_id,
        total_sales,
        total_cash_in,
        total_cash_out,
        expected_balance,
        discrepancy,
        actual_closing_balance,
    })
}
