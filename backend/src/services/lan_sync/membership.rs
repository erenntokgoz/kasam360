//! Üyelik işlemleri: planlı pasife alma ve kalıcı kayıpta devralma.

use super::op_log::{LogOp, Operation, OperationOutcome};
use super::runtime::{Command, LanSync};
use super::store::{self, Member};
use crate::services::device_identity::ensure_local_device;
use tokio::sync::oneshot;

impl LanSync {
    /// Diğer cihazlar geri dönmeyecekse bu cihaz işletmeyi tek başına sürdürür.
    pub async fn take_over(
        &self,
        tenant_id: &str,
        actor_id: &str,
        actor_role: &str,
    ) -> Result<OperationOutcome, String> {
        let (members, device_id) = {
            let mut conn = self.inner.pool.acquire().await.map_err(|e| e.to_string())?;
            let row = store::load_cluster(&mut conn)
                .await?
                .ok_or_else(|| "UNCONFIGURED: bu cihaz eşleştirilmemiş".to_string())?;
            (
                store::current_members(&mut conn, &row).await?,
                ensure_local_device(&mut conn, tenant_id).await?,
            )
        };
        if !matches!(self.status().state, "NO_CONNECTION" | "ISLAND") {
            return Err("CONFLICT: çoğunluk varken devralma yapılamaz".to_string());
        }
        let remaining: Vec<Member> = members
            .into_iter()
            .filter(|member| member.device_id == device_id)
            .collect();
        if remaining.is_empty() {
            return Err("UNAUTHORIZED: pasife alınmış cihaz devralamaz".to_string());
        }
        let operation = Operation {
            operation_id: crate::id_generator::generate_id("op"),
            tenant_id: tenant_id.to_string(),
            device_id,
            actor_id: actor_id.to_string(),
            actor_role: actor_role.to_string(),
            intent_sha256: String::new(),
            op: LogOp::SetMembers(remaining),
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        let sender = self
            .inner
            .commands
            .lock()
            .await
            .clone()
            .ok_or_else(|| "NO_CONNECTION: eşitleme çalışmıyor".to_string())?;
        let (reply, answer) = oneshot::channel();
        sender
            .send(Command::TakeOver {
                operation: Box::new(operation),
                reply,
            })
            .await
            .map_err(|_| "NO_CONNECTION: eşitleme çalışmıyor".to_string())?;
        answer
            .await
            .map_err(|_| "NO_CONNECTION: eşitleme çalışmıyor".to_string())?
    }

    /// Cihazı planlı olarak üyelikten çıkarır; otorite cihazdan yapılır.
    pub async fn set_device_passive(
        &self,
        tenant_id: &str,
        device_id: &str,
        actor_id: &str,
        actor_role: &str,
    ) -> Result<OperationOutcome, String> {
        let (members, local_device) = {
            let mut conn = self.inner.pool.acquire().await.map_err(|e| e.to_string())?;
            let row = store::load_cluster(&mut conn)
                .await?
                .ok_or_else(|| "UNCONFIGURED: bu cihaz eşleştirilmemiş".to_string())?;
            (
                store::current_members(&mut conn, &row).await?,
                ensure_local_device(&mut conn, tenant_id).await?,
            )
        };
        if !members.iter().any(|member| member.device_id == device_id) {
            return Err("NOT_FOUND: cihaz üyelikte değil".to_string());
        }
        let remaining: Vec<Member> = members
            .into_iter()
            .filter(|member| member.device_id != device_id)
            .collect();
        if remaining.is_empty() {
            return Err("CONFLICT: son cihaz pasife alınamaz".to_string());
        }
        self.submit(Operation {
            operation_id: crate::id_generator::generate_id("op"),
            tenant_id: tenant_id.to_string(),
            device_id: local_device,
            actor_id: actor_id.to_string(),
            actor_role: actor_role.to_string(),
            intent_sha256: String::new(),
            op: LogOp::SetMembers(remaining),
            created_at: chrono::Utc::now().to_rfc3339(),
        })
        .await
    }
}
