//! Cihaz kaybı senaryolarının ortak düzeneği.
//!
//! Her cihaz kendi SQLite dosyasını kullanır; ağ, teslimatı denetlenebilen bir
//! kuyruktur ve saat sanaldır. Cihaz "kapatma" motoru bellekten silip dosyadan
//! yeniden açar, yani yalnız diske yazılan durum hayatta kalır.

use super::super::op_log::{intent_hash, lookup};
use super::*;
use crate::services::cari::{CardFields, CariOp, OpenDebtInput, RecordPaymentInput};
use serde_json::json;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::collections::VecDeque;
use std::path::PathBuf;

const TENANT: &str = "tnt_a";

pub(super) struct Device {
    id: String,
    path: PathBuf,
    pool: SqlitePool,
    engine: Option<Engine>,
}

pub(super) struct Sim {
    pub(super) devices: Vec<Device>,
    pub(super) queue: VecDeque<(String, String, Message)>,
    /// (gönderen, alan) çiftleri arasındaki bağlantı kesik.
    pub(super) cut: BTreeSet<(String, String)>,
    pub(super) now: u64,
    pub(super) results: Vec<OperationOutcome>,
    pub(super) rejected: Vec<(String, String)>,
}

pub(super) fn member(id: &str) -> Member {
    Member {
        device_id: id.to_string(),
        name: id.to_string(),
        public_key: String::new(),
        address: String::new(),
    }
}

async fn open_pool(path: &PathBuf) -> SqlitePool {
    SqlitePoolOptions::new()
        .max_connections(2)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(path)
                .create_if_missing(true)
                .foreign_keys(true),
        )
        .await
        .expect("havuz")
}

impl Sim {
    pub(super) async fn new(ids: &[&str]) -> Self {
        let dir = std::env::temp_dir().join(format!("kasam360_sim_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("klasör");
        let mut devices = Vec::new();
        let members: Vec<Member> = ids.iter().map(|id| member(id)).collect();
        for id in ids {
            let path = dir.join(format!("{id}.sqlite"));
            let pool = open_pool(&path).await;
            sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
                .execute(&pool)
                .await
                .expect("şema");
            let mut conn = pool.acquire().await.expect("bağlantı");
            store::insert_cluster(
                &mut conn,
                &ClusterRow {
                    tenant_id: TENANT.to_string(),
                    cluster_id: "cls_1".to_string(),
                    term: 0,
                    voted_for: None,
                    commit_index: 0,
                    base_index: 0,
                    base_term: 0,
                    base_members: members.clone(),
                    listen_port: 1,
                    state_index: 0,
                },
            )
            .await
            .expect("küme");
            drop(conn);
            let engine = Engine::open(pool.clone(), Arc::new(Mutex::new(())), (*id).to_string())
                .await
                .expect("motor");
            devices.push(Device {
                id: (*id).to_string(),
                path,
                pool,
                engine,
            });
        }
        Self {
            devices,
            queue: VecDeque::new(),
            cut: BTreeSet::new(),
            now: 10_000,
            results: Vec::new(),
            rejected: Vec::new(),
        }
    }

    pub(super) fn device(&mut self, id: &str) -> &mut Device {
        self.devices
            .iter_mut()
            .find(|device| device.id == id)
            .expect("cihaz")
    }

    pub(super) fn engine(&mut self, id: &str) -> &mut Engine {
        self.device(id).engine.as_mut().expect("cihaz açık")
    }

    pub(super) fn collect(&mut self, from: &str, effects: Effects) {
        for (to, message) in effects.send {
            self.queue.push_back((from.to_string(), to, message));
        }
        self.results.extend(effects.applied);
        self.rejected.extend(effects.rejected);
    }

    pub(super) async fn deliver(&mut self) {
        while let Some((from, to, message)) = self.queue.pop_front() {
            if self.cut.contains(&(from.clone(), to.clone())) {
                continue;
            }
            let now = self.now;
            let device = self.device(&to);
            let Some(engine) = device.engine.as_mut() else {
                continue;
            };
            let effects = engine
                .handle(&from, message, now)
                .await
                .expect("ileti işlenir");
            self.collect(&to, effects);
        }
    }

    pub(super) async fn heartbeat(&mut self) {
        self.now += 300;
        for id in self.ids() {
            if self.device(&id).engine.is_none() {
                continue;
            }
            let now = self.now;
            let effects = self
                .engine(&id)
                .on_heartbeat(now)
                .await
                .expect("kalp atışı");
            self.collect(&id, effects);
        }
        self.deliver().await;
    }

    pub(super) fn ids(&self) -> Vec<String> {
        self.devices
            .iter()
            .map(|device| device.id.clone())
            .collect()
    }

    pub(super) async fn elect(&mut self, id: &str) {
        self.now += LEADER_SILENCE_MS + 1;
        let now = self.now;
        let effects = self
            .engine(id)
            .on_election_timeout(now)
            .await
            .expect("seçim");
        self.collect(id, effects);
        self.deliver().await;
        self.heartbeat().await;
    }

    pub(super) fn isolate(&mut self, id: &str) {
        for other in self.ids() {
            if other != id {
                self.cut.insert((id.to_string(), other.clone()));
                self.cut.insert((other, id.to_string()));
            }
        }
    }

    pub(super) fn heal(&mut self) {
        self.cut.clear();
    }

    pub(super) async fn crash(&mut self, id: &str) {
        self.device(id).engine = None;
    }

    pub(super) async fn restart(&mut self, id: &str) {
        let path = self.device(id).path.clone();
        let pool = open_pool(&path).await;
        let engine = Engine::open(pool.clone(), Arc::new(Mutex::new(())), id.to_string())
            .await
            .expect("motor");
        let device = self.device(id);
        device.pool = pool;
        device.engine = engine;
    }

    pub(super) async fn propose(
        &mut self,
        leader: &str,
        operation: &Operation,
    ) -> Result<(), String> {
        let now = self.now;
        let effects = self.engine(leader).propose(operation, now).await?;
        self.collect(leader, effects);
        Ok(())
    }

    pub(super) async fn remaining(&mut self, id: &str) -> Option<i64> {
        let pool = self.device(id).pool.clone();
        sqlx::query_scalar(
            "SELECT remaining_amount_cents FROM debts WHERE id = 'dbt_1' AND tenant_id = ?",
        )
        .bind(TENANT)
        .fetch_optional(&pool)
        .await
        .expect("bakiye")
    }

    pub(super) async fn payments(&mut self, id: &str) -> i64 {
        let pool = self.device(id).pool.clone();
        sqlx::query_scalar("SELECT COUNT(*) FROM debt_payments WHERE tenant_id = ?")
            .bind(TENANT)
            .fetch_one(&pool)
            .await
            .expect("sayı")
    }

    pub(super) async fn outcome(
        &mut self,
        id: &str,
        operation_id: &str,
    ) -> Option<OperationOutcome> {
        let pool = self.device(id).pool.clone();
        let mut conn = pool.acquire().await.expect("bağlantı");
        lookup(&mut conn, TENANT, operation_id, None)
            .await
            .expect("sorgu")
    }

    pub(super) async fn seed_debt(&mut self, leader: &str) {
        self.propose(leader, &card_op()).await.expect("kart");
        self.deliver().await;
        self.propose(leader, &debt_op()).await.expect("borç");
        self.deliver().await;
        self.heartbeat().await;
    }
}

pub(super) fn operation(id: &str, op: CariOp) -> Operation {
    Operation {
        operation_id: id.to_string(),
        tenant_id: TENANT.to_string(),
        device_id: "dev_a".to_string(),
        actor_id: "usr_1".to_string(),
        actor_role: "OWNER".to_string(),
        intent_sha256: intent_hash(op.kind(), &json!(id)),
        op: LogOp::Cari(Box::new(op)),
        created_at: "2026-10-30T10:00:00Z".to_string(),
    }
}

pub(super) fn card_op() -> Operation {
    operation(
        "op_card",
        CariOp::CreateCard {
            directory_type: "CUSTOMER".to_string(),
            card: CardFields {
                directory_id: "dir_1".to_string(),
                name: "Ayşe".to_string(),
                phone: None,
                email: None,
                tax_no: None,
                tax_office: None,
                address: None,
                credit_limit_cents: None,
                notes: None,
            },
            created_at: "2026-10-30T10:00:00Z".to_string(),
        },
    )
}

pub(super) fn debt_op() -> Operation {
    operation(
        "op_debt",
        CariOp::OpenDebt(OpenDebtInput {
            debt_id: "dbt_1".to_string(),
            directory_id: "dir_1".to_string(),
            debt_type: "GIVEN".to_string(),
            amount_cents: 10_000,
            due_date: None,
            is_cash: false,
            order_id: None,
            description: None,
            created_at: "2026-10-30T10:00:00Z".to_string(),
        }),
    )
}

pub(super) fn payment_op(id: &str, amount: i64, version: i64) -> Operation {
    operation(
        id,
        CariOp::RecordPayment(RecordPaymentInput {
            payment_id: format!("pmt_{id}"),
            debt_id: "dbt_1".to_string(),
            amount_cents: amount,
            payment_method: "BANK_TRANSFER".to_string(),
            actor_id: "usr_1".to_string(),
            notes: None,
            expected_version: version,
            cash_movement_id: None,
            shift_id: None,
            created_at: "2026-10-30T11:00:00Z".to_string(),
        }),
    )
}

pub(super) fn members_op(id: &str, ids: &[&str]) -> Operation {
    Operation {
        operation_id: id.to_string(),
        tenant_id: TENANT.to_string(),
        device_id: "dev_a".to_string(),
        actor_id: "usr_1".to_string(),
        actor_role: "OWNER".to_string(),
        intent_sha256: id.to_string(),
        op: LogOp::SetMembers(ids.iter().map(|id| member(id)).collect()),
        created_at: "2026-10-30T10:00:00Z".to_string(),
    }
}

#[cfg(test)]
#[path = "engine_island_tests.rs"]
mod island;
