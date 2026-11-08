//! Yazma transaction'ı: tek cihazda yerel onayla, çok cihazda çoğunluk onayıyla.
//!
//! Tek cihazda da her iş yazması günlüğe girer (`local_log`): buluta gönderim ve
//! sonradan katılan cihaz kip farkı gözetmeden aynı akışı okur.
//!
//! Komutlar yazma kurallarını değiştirmeden aynı kodla çalışır. Çok cihazlı kurulumda
//! transaction yalnız değişiklik listesini üretir: liste okunur, transaction geri alınır,
//! liste günlüğe önerilir ve çoğunluk onayından sonra her cihazda aynı sırayla uygulanır.
//! Böylece "işlem tamamlandı" cevabı onaysız yazılmış satırla verilmez.
//!
//! `base_state` iyimser kilittir. İki cihaz aynı durumdan yola çıkarsa ikincisinin
//! değişikliği eski bilgiye dayanır ve her cihazda aynı biçimde reddedilir; aynı kalemi
//! iki kasanın tahsil etmesini bu durdurur. İstemci aynı isteği taze durumla yeniden dener.

use super::actor::NO_AUTHORITY;
use super::capture::{self, RowChange};
use super::island::{self, IslandBase};
use super::island_queue::{self, SealMeta};
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

enum Mode {
    /// Eşitlemesiz havuz (test): transaction olduğu gibi onaylanır.
    Plain,
    /// Tek cihaz: yerelde onaylanır, değişiklik aynı transaction'da günlüğe girer.
    Local,
    /// Çok cihaz: değişiklik çoğunluk onayından geçer.
    Replicated(Replication),
    /// Çok cihaz, otorite yok: yerelde onaylanır, ada kaydına girer.
    Island(IslandBase),
}

/// Ada yazmasını onaylar: satırlar yerelde kalır, değişiklik önceki görüntüleriyle
/// aynı transaction'da ada kaydına eklenir.
async fn commit_island(
    mut tx: Transaction<'static, Sqlite>,
    base: IslandBase,
) -> Result<(), String> {
    island_queue::seal(&mut tx, &base, SealMeta::changes()).await?;
    tx.commit().await.map_err(|e| e.to_string())
}

pub struct WriteTx {
    tx: Transaction<'static, Sqlite>,
    mode: Mode,
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
        let replication = match std::mem::replace(&mut self.mode, Mode::Plain) {
            Mode::Plain => return self.tx.commit().await.map_err(|e| e.to_string()),
            Mode::Local => {
                super::local_log::flush(&mut self.tx).await?;
                return self.tx.commit().await.map_err(|e| e.to_string());
            }
            Mode::Island(base) => return commit_island(self.tx, base).await,
            Mode::Replicated(replication) => replication,
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
    async fn submit(self, captured: Vec<RowChange>) -> Result<(), String> {
        // Önceki görüntü yalnız yerel geri alma içindir; ağ iletisini büyütmez.
        let mut changes = captured.clone();
        for change in &mut changes {
            change.old = None;
        }
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
        match self.sync.submit(operation).await {
            Ok(outcome) => outcome.into_result().map(|_| ()),
            // İşlem hiçbir günlüğe girmedi: kasiyer beklemez, yazma ada kaydına geçer.
            Err(error) if error == NO_AUTHORITY || error.starts_with("QUORUM_LOST") => {
                fall_back_to_island(&self.sync, self.base_state, &captured).await
            }
            Err(error) => Err(error),
        }
    }
}

/// Kümeye gönderilemeyen değişikliği ada yazmasına çevirir.
///
/// Transaction geri alındığı için arada başka yazma girmiş olabilir; durum sayacı veya
/// yeni ada kaydı değiştiyse değişiklik eski bilgiye dayanır ve istemci yeniden dener.
/// Değişiklik ada kapısı altında yeniden oynatılır: tetikleyiciler önceki görüntüyü
/// taze yakalar, ana zincir kaydı cihazın alt zincirine mühürlenir.
async fn fall_back_to_island(
    sync: &LanSync,
    base_state: i64,
    changes: &[RowChange],
) -> Result<(), String> {
    let mut tx = sync
        .inner
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|e| e.to_string())?;
    let row = store::load_cluster(&mut tx)
        .await?
        .ok_or_else(|| "UNCONFIGURED: küme kaydı yok".to_string())?;
    if row.state_index != base_state || island::has_local(&mut tx, &row.tenant_id).await? {
        return Err("SYNC_RETRY: durum değişti; işlem yeniden denenmeli".to_string());
    }
    let me = ensure_local_device(&mut tx, &row.tenant_id).await?;
    let members = store::current_members(&mut tx, &row).await?;
    if !members.iter().any(|member| member.device_id == me) {
        return Err(NO_AUTHORITY.to_string());
    }
    sqlx::query("INSERT INTO sync_write_gate (mode) VALUES ('ISLAND')")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("PRAGMA defer_foreign_keys = ON")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    for change in changes {
        if change.table == "audit_ledger" {
            if let Some(entry) = &change.row {
                super::island_audit::append_row(&mut tx, entry).await?;
            }
            continue;
        }
        capture::apply_one(&mut tx, change).await?;
    }
    let base = IslandBase {
        tenant_id: row.tenant_id.clone(),
        device_id: me,
        base_commit_index: row.commit_index,
        base_state: row.state_index,
    };
    commit_island(tx, base).await
}

#[allow(async_fn_in_trait)]
pub trait WritePool {
    async fn begin_write(&self) -> Result<WriteTx, String>;
}

/// Ada kayıtları geri alınmış ve birleşme bekliyorsa yazma kısa süre bekler: o arada
/// açılan yazma ada satırlarını görmez, birleşmede gereksiz çakışma üretirdi. Süre dolarsa
/// yazma yine yapılır; kayıp olmaz, çakışma varsa kuyrukta görünür.
async fn wait_for_merge(pool: &SqlitePool) -> Result<(), String> {
    for _ in 0..MERGE_WAIT_STEPS {
        let queued = {
            let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
            match store::load_cluster(&mut conn).await? {
                Some(row) => island_queue::has_queued(&mut conn, &row.tenant_id).await?,
                None => false,
            }
        };
        if !queued {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    Ok(())
}

/// Birleşme beklemesi 50 ms adımlarla en çok 3 saniyedir.
const MERGE_WAIT_STEPS: u32 = 60;

impl WritePool for SqlitePool {
    async fn begin_write(&self) -> Result<WriteTx, String> {
        if registered(self).is_some() {
            wait_for_merge(self).await?;
        }
        let mut tx = self
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(|e| e.to_string())?;
        let Some(sync) = registered(self) else {
            return Ok(WriteTx {
                tx,
                mode: Mode::Plain,
            });
        };
        // Ekran önbelleği üyeliğin gerisinde kalabilir; yazma yolu kilit altındaki diske bakar.
        let Some(row) = store::load_cluster(&mut tx).await? else {
            return Ok(WriteTx {
                tx,
                mode: Mode::Local,
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
                mode: Mode::Local,
            });
        }
        // Bekleyen ada kaydı varsa yazma ada yolunda kalır; ada durumuna dayanan
        // değişiklik kümeye gönderilmez. Üyelikten çıkmış cihaz ada kipine giremez.
        let is_member = members.iter().any(|member| member.device_id == me);
        let island =
            island::has_local(&mut tx, &row.tenant_id).await? || sync.status().state == "ISLAND";
        if island && is_member {
            sqlx::query("INSERT INTO sync_write_gate (mode) VALUES ('ISLAND')")
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            return Ok(WriteTx {
                tx,
                mode: Mode::Island(IslandBase {
                    tenant_id: row.tenant_id.clone(),
                    device_id: me,
                    base_commit_index: row.commit_index,
                    base_state: row.state_index,
                }),
            });
        }
        // Kapı transaction'ın içindedir: diğer bağlantılar görmez, iz bırakmaz.
        sqlx::query("INSERT INTO sync_write_gate (mode) VALUES ('CAPTURE')")
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        Ok(WriteTx {
            tx,
            mode: Mode::Replicated(Replication {
                sync,
                base_state: row.state_index,
            }),
        })
    }
}
