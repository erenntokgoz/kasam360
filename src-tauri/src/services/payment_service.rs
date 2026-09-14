use crate::commands::PaymentPayloadDto;
use crate::repositories::payment_repository::PaymentRepository;
use crate::services::inventory_service::InventoryService;
use crate::services::audit_service::AuditService;
use chrono::Utc;

pub struct PaymentService;

impl PaymentService {
    pub async fn process_transaction(
        payload: &PaymentPayloadDto,
        conn: &mut sqlx::SqliteConnection,
    ) -> Result<(i64, String), String> {
        let now_iso = Utc::now().to_rfc3339();
        let actor_id = payload.cashier_id.as_deref().unwrap_or("SYSTEM_POS");

        // 4. Etki eşitsizliği (Idempotency) kontrolü.
        if PaymentRepository::check_idempotency(conn, &payload.transaction_id).await? {
            return Err(format!(
                "IDEMPOTENCY_CONFLICT: Transaction '{}' has already been processed.",
                payload.transaction_id
            ));
        }

        // 5. Sunucu tarafı toplam doğrulaması.
        let server_total_cents = PaymentRepository::calculate_server_truth_total(conn, &payload.items).await?;
        let client_total_cents = payload.total_amount;
        let total_delta = (server_total_cents - client_total_cents).abs();
        if total_delta > 1 {
            return Err(format!(
                "TOTAL_MISMATCH: Server recalculated total {} cents differs from client total {} cents by {}.",
                server_total_cents, client_total_cents, total_delta
            ));
        }

        // 6. Değiştirilemez (immutable) Satış Olayı (Sale Event) + Outbox kaydı ekle.
        PaymentRepository::insert_sale_event(conn, payload).await?;

        // 6.5 Uygulanabilirse siparişi kapat
        PaymentRepository::close_order_if_applicable(conn, payload.order_id.as_deref()).await?;

        // 7. FIFO stok maliyeti düşümü.
        let total_cogs_cents = InventoryService::execute_fifo_deduction(
            conn,
            &payload.transaction_id,
            &payload.items,
            &now_iso,
        )
        .await?;

        // 8. Denetim defteri kaydı ekle.
        AuditService::append_audit_entry(
            conn,
            &payload.transaction_id,
            &payload.method,
            payload.total_amount,
            total_cogs_cents,
            payload.items.len(),
            actor_id,
            &now_iso,
        )
        .await?;

        Ok((total_cogs_cents, now_iso))
    }
}
