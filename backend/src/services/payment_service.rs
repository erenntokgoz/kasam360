use crate::commands::PaymentPayloadDto;
use crate::repositories::payment_repository::PaymentRepository;
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use crate::services::inventory_service::InventoryService;
use chrono::Utc;

pub struct PaymentService;

impl PaymentService {
    pub async fn process_transaction(
        payload: &PaymentPayloadDto,
        conn: &mut sqlx::SqliteConnection,
        audit_lock: &AuditLock<'_>,
        tenant_id: &str,
        actor_role: &str,
    ) -> Result<(i64, String), String> {
        let now_iso = Utc::now().to_rfc3339();
        // Kimlik önceliği `actorId` → `cashierId`: onay jetonunun sahibi (self-approval
        // denetiminde karşılaştırılan kimlik) ile denetim kaydının aktörü aynı olmalı.
        let actor_id = payload
            .actor_id
            .as_deref()
            .or(payload.cashier_id.as_deref())
            .unwrap_or("SYSTEM_POS");

        // 4. Etki eşitsizliği (Idempotency) kontrolü.
        if PaymentRepository::check_idempotency(conn, &payload.transaction_id, tenant_id).await? {
            return Err(format!(
                "IDEMPOTENCY_CONFLICT: Transaction '{}' has already been processed.",
                payload.transaction_id
            ));
        }

        // 5. Sunucu tarafı toplam doğrulaması (öğe ve genel indirimler dahil).
        let server_truth = PaymentRepository::calculate_server_truth(
            conn,
            &payload.items,
            payload.global_discount.as_ref(),
        )
        .await?;
        let server_total_cents = server_truth.total_cents;
        let client_total_cents = payload.total_amount;
        let total_delta = (server_total_cents - client_total_cents).abs();
        if total_delta > 1 {
            return Err(format!(
                "TOTAL_MISMATCH: Server recalculated total {} cents differs from client total {} cents by {}.",
                server_total_cents, client_total_cents, total_delta
            ));
        }

        // 5.5 K2: sunucu hesabında indirim varsa anlık PIN onayı zorunludur.
        // Onay tüketimi, ödeme satırı yazılmadan **önce** olur: onaysız ödeme
        // denemesi kalıcı bir iz bırakmaz.
        let consumed_approval =
            crate::services::payment_approval::consume_discount_approval(
                conn,
                audit_lock,
                tenant_id,
                actor_id,
                actor_role,
                &payload.transaction_id,
                &server_truth,
                payload.approval_token.as_deref(),
            )
            .await?;

        // 6. Değiştirilemez (immutable) Satış Olayı (Sale Event) + Outbox kaydı ekle.
        PaymentRepository::insert_sale_event(conn, payload, tenant_id).await?;

        // 6.5 Uygulanabilirse siparişi kapat
        PaymentRepository::close_order_if_applicable(conn, payload.order_id.as_deref(), tenant_id).await?;

        // 7. FIFO stok maliyeti düşümü.
        let total_cogs_cents = InventoryService::execute_fifo_deduction(
            conn,
            &payload.transaction_id,
            &payload.items,
            &now_iso,
        )
        .await?;

        // 8. Denetim defteri kaydı ekle.
        //
        // Payload alan adları `get_daily_summary` ve `get_shift_summary`
        // tarafından JSON olarak okunuyor; yeniden adlandırılmaz.
        // `discountCents` patron ekranındaki "İndirim & İkram" filtresini besler:
        // indirim kodu `payment:settled_fifo` içinde taşındığı için filtre
        // ayrı bir işlem kodu aramaz.
        let ledger_payload = serde_json::json!({
            "transactionId": payload.transaction_id,
            "method": payload.method,
            "totalAmount": payload.total_amount,
            "cogsTotalCents": total_cogs_cents,
            "itemsCount": payload.items.len(),
            "grossCents": server_truth.gross_cents,
            "subtotalCents": server_truth.subtotal_cents,
            "taxCents": server_truth.tax_cents,
            "discountCents": server_truth.discount_cents,
            // Onay varsa kim verdi yazılır; yoksa alan `null` kalır. Ödeme
            // kaydı ile güvenlik kaydı birlikte okunduğunda "bu indirim kim
            // tarafından onaylandı" sorusu tek satırda cevaplanır.
            "discountApproval": match consumed_approval.as_ref() {
                Some(approval) => serde_json::json!({
                    "operation": approval.operation,
                    "approverId": approval.approver_id,
                    "approverRole": approval.approver_role,
                    "amountCents": approval.amount_cents,
                }),
                None => serde_json::Value::Null,
            },
        });

        let ctx = AuditContext::new(
            tenant_id.to_string(),
            actor_id.to_string(),
            actor_role.to_string(),
            category::ODEME,
            "payment:settled_fifo",
            payload.transaction_id.clone(),
            ledger_payload,
            now_iso.clone(),
        )?;

        AuditService::append(conn, audit_lock, &ctx).await?;

        Ok((total_cogs_cents, now_iso))
    }
}
