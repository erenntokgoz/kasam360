//! Yazma transaction'ı: tek cihazda olduğu gibi, çok cihazda çoğunluk onayıyla.
//!
//! Komutlar yazma kurallarını değiştirmeden aynı kodla çalışır. Çok cihazlı kurulumda
//! transaction yalnız değişiklik listesini üretir: liste okunur, transaction geri alınır,
//! liste günlüğe önerilir ve çoğunluk onayından sonra her cihazda aynı sırayla uygulanır.
//! Böylece "işlem tamamlandı" cevabı onaysız yazılmış satırla verilmez.
//!
//! `base_state` iyimser kilittir. İki cihaz aynı durumdan yola çıkarsa ikincisinin
//! değişikliği eski bilgiye dayanır ve her cihazda aynı biçimde reddedilir; aynı kalemi
//! iki kasanın tahsil etmesini bu durdurur. İstemci aynı isteği taze durumla yeniden dener.

use super::capture::{self, RowChange};
use super::op_log::{intent_hash, LogOp, Operation};
use super::runtime::LanSync;
use super::store;
use crate::services::device_identity::ensure_local_device;
use sqlx::{Sqlite, SqliteConnection, SqlitePool, Transaction};
use std::collections::HashMap;
use std::ops::{Deref, DerefMut};
use std::sync::{LazyLock, RwLock};

/// Komutlar havuzu alır, eşitleme yüzünü değil. Havuz dosyaya göre eşlenir; bellek içi
/// test havuzları kayıtlı olmadığından tek cihaz gibi davranır.
static REGISTRY: LazyLock<RwLock<HashMap<String, LanSync>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

fn pool_key(pool: &SqlitePool) -> String {
    pool.connect_options()
        .get_filename()
        .to_string_lossy()
        .to_string()
}

pub(super) fn register(pool: &SqlitePool, sync: LanSync) {
    if let Ok(mut registry) = REGISTRY.write() {
        registry.insert(pool_key(pool), sync);
    }
}

fn registered(pool: &SqlitePool) -> Option<LanSync> {
    REGISTRY.read().ok()?.get(&pool_key(pool)).cloned()
}

struct Replication {
    sync: LanSync,
    base_state: i64,
}

pub struct WriteTx {
    tx: Transaction<'static, Sqlite>,
    replication: Option<Replication>,
}

impl Deref for WriteTx {
    type Target = SqliteConnection;

    fn deref(&self) -> &SqliteConnection {
        &self.tx
    }
}

impl DerefMut for WriteTx {
    fn deref_mut(&mut self) -> &mut SqliteConnection {
        &mut self.tx
    }
}

impl WriteTx {
    pub async fn commit(mut self) -> Result<(), String> {
        let Some(replication) = self.replication.take() else {
            return self.tx.commit().await.map_err(|e| e.to_string());
        };
        let changes = capture::read_capture(&mut self.tx).await?;
        // Yalnız yerel tablolara yazan işlem (oturum gibi) çoğunluk gerektirmez.
        if changes.is_empty() {
            sqlx::query("DELETE FROM sync_write_gate")
                .execute(&mut *self.tx)
                .await
                .map_err(|e| e.to_string())?;
            return self.tx.commit().await.map_err(|e| e.to_string());
        }
        self.tx.rollback().await.map_err(|e| e.to_string())?;
        replication.submit(changes).await
    }

    pub async fn rollback(self) -> Result<(), String> {
        self.tx.rollback().await.map_err(|e| e.to_string())
    }
}

impl Replication {
    async fn submit(self, changes: Vec<RowChange>) -> Result<(), String> {
        let intent = serde_json::to_value(&changes).map_err(|e| e.to_string())?;
        let (tenant_id, device_id) = self.sync.identity().await?;
        let operation = Operation {
            operation_id: crate::id_generator::generate_id("op"),
            tenant_id,
            device_id,
            actor_id: "SYSTEM".to_string(),
            actor_role: "System".to_string(),
            intent_sha256: intent_hash("CHANGES", &intent),
            op: LogOp::Changes {
                base_state: self.base_state,
                changes,
            },
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        self.sync.submit(operation).await?.into_result().map(|_| ())
    }
}

#[allow(async_fn_in_trait)]
pub trait WritePool {
    async fn begin_write(&self) -> Result<WriteTx, String>;
}

impl WritePool for SqlitePool {
    async fn begin_write(&self) -> Result<WriteTx, String> {
        let mut tx = self
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(|e| e.to_string())?;
        let Some(sync) = registered(self) else {
            return Ok(WriteTx {
                tx,
                replication: None,
            });
        };
        // Ekran önbelleği üyeliğin gerisinde kalabilir; yazma yolu kilit altındaki diske bakar.
        let Some(row) = store::load_cluster(&mut tx).await? else {
            return Ok(WriteTx {
                tx,
                replication: None,
            });
        };
        if store::has_pending_membership(&mut tx, &row.tenant_id).await? {
            return Err(
                "SYNC_RETRY: cihaz üyeliği onaylanıyor; işlem yeniden denenmeli".to_string(),
            );
        }
        let members = store::current_members(&mut tx, &row).await?;
        let me = ensure_local_device(&mut tx, &row.tenant_id).await?;
        if members.len() == 1 && members[0].device_id == me {
            return Ok(WriteTx {
                tx,
                replication: None,
            });
        }
        // Kapı transaction'ın içindedir: diğer bağlantılar görmez, iz bırakmaz.
        sqlx::query("INSERT INTO sync_write_gate (mode) VALUES ('CAPTURE')")
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        Ok(WriteTx {
            tx,
            replication: Some(Replication {
                sync,
                base_state: row.state_index,
            }),
        })
    }
}
