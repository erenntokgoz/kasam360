//! Cihaz kaybı ve bölünme senaryoları.
//!
//! Her cihaz kendi SQLite dosyasını kullanır; ağ, teslimatı denetlenebilen bir
//! kuyruktur ve saat sanaldır. Cihaz "kapatma" motoru bellekten silip dosyadan
//! yeniden açar, yani yalnız diske yazılan durum hayatta kalır.

use super::*;
use crate::services::audit_service::AuditLock;
use crate::services::cari::{CardFields, CariOp, OpenDebtInput, RecordPaymentInput};
use crate::services::lan_sync::op_log::{intent_hash, lookup};
use serde_json::json;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::collections::VecDeque;
use std::path::PathBuf;

const TENANT: &str = "tnt_a";

struct Device {
    id: String,
    path: PathBuf,
    pool: SqlitePool,
    engine: Option<Engine>,
}

struct Sim {
    devices: Vec<Device>,
    queue: VecDeque<(String, String, Message)>,
    /// (gönderen, alan) çiftleri arasındaki bağlantı kesik.
    cut: BTreeSet<(String, String)>,
    now: u64,
    results: Vec<OperationOutcome>,
    rejected: Vec<(String, String)>,
}

fn member(id: &str) -> Member {
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
    async fn new(ids: &[&str]) -> Self {
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

    fn device(&mut self, id: &str) -> &mut Device {
        self.devices
            .iter_mut()
            .find(|device| device.id == id)
            .expect("cihaz")
    }

    fn engine(&mut self, id: &str) -> &mut Engine {
        self.device(id).engine.as_mut().expect("cihaz açık")
    }

    fn collect(&mut self, from: &str, effects: Effects) {
        for (to, message) in effects.send {
            self.queue.push_back((from.to_string(), to, message));
        }
        self.results.extend(effects.applied);
        self.rejected.extend(effects.rejected);
    }

    async fn deliver(&mut self) {
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

    async fn heartbeat(&mut self) {
        self.now += 300;
        for id in self.ids() {
            if self.device(&id).engine.is_none() {
                continue;
            }
            let effects = self.engine(&id).on_heartbeat().await.expect("kalp atışı");
            self.collect(&id, effects);
        }
        self.deliver().await;
    }

    fn ids(&self) -> Vec<String> {
        self.devices
            .iter()
            .map(|device| device.id.clone())
            .collect()
    }

    async fn elect(&mut self, id: &str) {
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

    fn isolate(&mut self, id: &str) {
        for other in self.ids() {
            if other != id {
                self.cut.insert((id.to_string(), other.clone()));
                self.cut.insert((other, id.to_string()));
            }
        }
    }

    fn heal(&mut self) {
        self.cut.clear();
    }

    async fn crash(&mut self, id: &str) {
        self.device(id).engine = None;
    }

    async fn restart(&mut self, id: &str) {
        let path = self.device(id).path.clone();
        let pool = open_pool(&path).await;
        let engine = Engine::open(pool.clone(), Arc::new(Mutex::new(())), id.to_string())
            .await
            .expect("motor");
        let device = self.device(id);
        device.pool = pool;
        device.engine = engine;
    }

    async fn propose(&mut self, leader: &str, operation: &Operation) -> Result<(), String> {
        let now = self.now;
        let effects = self.engine(leader).propose(operation, now).await?;
        self.collect(leader, effects);
        Ok(())
    }

    async fn remaining(&mut self, id: &str) -> Option<i64> {
        let pool = self.device(id).pool.clone();
        sqlx::query_scalar(
            "SELECT remaining_amount_cents FROM debts WHERE id = 'dbt_1' AND tenant_id = ?",
        )
        .bind(TENANT)
        .fetch_optional(&pool)
        .await
        .expect("bakiye")
    }

    async fn payments(&mut self, id: &str) -> i64 {
        let pool = self.device(id).pool.clone();
        sqlx::query_scalar("SELECT COUNT(*) FROM debt_payments WHERE tenant_id = ?")
            .bind(TENANT)
            .fetch_one(&pool)
            .await
            .expect("sayı")
    }

    async fn outcome(&mut self, id: &str, operation_id: &str) -> Option<OperationOutcome> {
        let pool = self.device(id).pool.clone();
        let mut conn = pool.acquire().await.expect("bağlantı");
        lookup(&mut conn, TENANT, operation_id, None)
            .await
            .expect("sorgu")
    }

    async fn seed_debt(&mut self, leader: &str) {
        self.propose(leader, &card_op()).await.expect("kart");
        self.deliver().await;
        self.propose(leader, &debt_op()).await.expect("borç");
        self.deliver().await;
        self.heartbeat().await;
    }
}

fn operation(id: &str, op: CariOp) -> Operation {
    Operation {
        operation_id: id.to_string(),
        tenant_id: TENANT.to_string(),
        device_id: "dev_a".to_string(),
        actor_id: "usr_1".to_string(),
        actor_role: "OWNER".to_string(),
        intent_sha256: intent_hash(op.kind(), &json!(id)),
        op: LogOp::Cari(op),
        created_at: "2026-10-30T10:00:00Z".to_string(),
    }
}

fn card_op() -> Operation {
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

fn debt_op() -> Operation {
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

fn payment_op(id: &str, amount: i64, version: i64) -> Operation {
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

fn members_op(id: &str, ids: &[&str]) -> Operation {
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

#[tokio::test]
async fn tek_uyeli_kume_onay_beklemeden_calisir() {
    let mut sim = Sim::new(&["a"]).await;
    sim.elect("a").await;
    assert_eq!(sim.engine("a").role, Role::Leader);
    sim.seed_debt("a").await;
    sim.propose("a", &payment_op("op_pay", 4_000, 0))
        .await
        .expect("ödeme");
    assert_eq!(sim.remaining("a").await, Some(6_000));
}

#[tokio::test]
async fn islem_cogunluk_diske_yazmadan_uygulanmaz() {
    let mut sim = Sim::new(&["a", "b"]).await;
    sim.elect("a").await;
    sim.seed_debt("a").await;

    sim.propose("a", &payment_op("op_pay", 4_000, 0))
        .await
        .expect("günlüğe alınır");
    // Takipçiye ulaşmadan otoritede bile uygulanmış sayılmaz.
    assert_eq!(sim.remaining("a").await, Some(10_000));
    assert_eq!(
        sim.outcome("a", "op_pay").await.expect("kayıt").status,
        OperationStatus::Pending
    );

    sim.deliver().await;
    assert_eq!(sim.remaining("a").await, Some(6_000));
    sim.heartbeat().await;
    assert_eq!(
        sim.remaining("b").await,
        Some(6_000),
        "takipçi de aynı sonuca ulaşır"
    );
}

#[tokio::test]
async fn iki_cihazdan_biri_kaybolunca_finansal_yazma_durur() {
    let mut sim = Sim::new(&["a", "b"]).await;
    sim.elect("a").await;
    sim.seed_debt("a").await;

    sim.crash("b").await;
    sim.now += LEASE_MS + 1;
    let error = sim
        .propose("a", &payment_op("op_pay", 1_000, 0))
        .await
        .expect_err("çoğunluk yok");
    assert!(error.starts_with("QUORUM_LOST"), "{error}");
    assert!(
        sim.outcome("a", "op_pay").await.is_none(),
        "günlüğe bile girmez"
    );
    assert_eq!(sim.remaining("a").await, Some(10_000));

    // Takipçi geri gelince aynı kimlikle güvenle yeniden denenir.
    sim.restart("b").await;
    sim.heartbeat().await;
    sim.propose("a", &payment_op("op_pay", 1_000, 0))
        .await
        .expect("yeniden");
    sim.deliver().await;
    assert_eq!(sim.remaining("a").await, Some(9_000));
}

#[tokio::test]
async fn iki_cihazli_bolunmede_hicbir_taraf_yazamaz() {
    let mut sim = Sim::new(&["a", "b"]).await;
    sim.elect("a").await;
    sim.seed_debt("a").await;

    sim.isolate("a");
    sim.now += LEASE_MS + 1;
    assert!(sim
        .propose("a", &payment_op("op_a", 1_000, 0))
        .await
        .is_err());

    sim.elect("b").await;
    assert_ne!(
        sim.engine("b").role,
        Role::Leader,
        "tek oyla otorite olunamaz"
    );
    let error = sim
        .propose("b", &payment_op("op_b", 1_000, 0))
        .await
        .expect_err("çoğunluk yok");
    assert!(error.starts_with("NOT_LEADER"), "{error}");
    assert_eq!(sim.remaining("a").await, Some(10_000));
    assert_eq!(sim.remaining("b").await, Some(10_000));
}

#[tokio::test]
async fn otorite_yanit_vermeden_olurse_sonuc_sorgulanir_ve_tekrar_yazilmaz() {
    let mut sim = Sim::new(&["a", "b", "c"]).await;
    sim.elect("a").await;
    sim.seed_debt("a").await;

    // Kayıt b'ye ulaşır, a yanıt alamadan kapanır.
    sim.propose("a", &payment_op("op_pay", 4_000, 0))
        .await
        .expect("günlük");
    sim.cut.insert(("a".to_string(), "c".to_string()));
    sim.deliver().await;
    sim.cut.clear();
    sim.crash("a").await;

    sim.elect("b").await;
    assert_eq!(sim.engine("b").role, Role::Leader);
    sim.heartbeat().await;

    // İstemci yeni otoriteden aynı kimlikle sorar: ikinci ödeme yazılmaz.
    assert_eq!(
        sim.outcome("b", "op_pay").await.expect("kayıt").status,
        OperationStatus::Applied
    );
    sim.propose("b", &payment_op("op_pay", 4_000, 0))
        .await
        .expect("tekrar");
    sim.deliver().await;
    assert_eq!(sim.payments("b").await, 1);
    assert_eq!(sim.remaining("c").await, Some(6_000));

    sim.restart("a").await;
    sim.heartbeat().await;
    sim.heartbeat().await;
    assert_eq!(sim.remaining("a").await, Some(6_000));
    assert_eq!(sim.payments("a").await, 1);
}

#[tokio::test]
async fn onaysiz_kayit_eski_otoriteyle_birlikte_silinir() {
    let mut sim = Sim::new(&["a", "b", "c"]).await;
    sim.elect("a").await;
    sim.seed_debt("a").await;

    sim.isolate("a");
    sim.propose("a", &payment_op("op_lost", 4_000, 0))
        .await
        .expect("yalnız a günlüğünde");
    sim.deliver().await;

    sim.elect("b").await;
    assert_eq!(sim.engine("b").role, Role::Leader);
    sim.propose("b", &payment_op("op_new", 2_000, 0))
        .await
        .expect("yeni otorite");
    sim.deliver().await;
    sim.heartbeat().await;

    sim.heal();
    sim.heartbeat().await;
    sim.heartbeat().await;
    assert_eq!(sim.engine("a").role, Role::Follower);
    assert!(
        sim.outcome("a", "op_lost").await.is_none(),
        "onaysız kayıt düşer"
    );
    assert_eq!(sim.remaining("a").await, Some(8_000));
    assert_eq!(sim.remaining("b").await, Some(8_000));
    assert_eq!(sim.remaining("c").await, Some(8_000));
}

#[tokio::test]
async fn uc_cihazda_tek_kayip_yazmayi_durdurmaz_ve_geride_kalan_yetisir() {
    let mut sim = Sim::new(&["a", "b", "c"]).await;
    sim.elect("a").await;
    sim.seed_debt("a").await;

    sim.crash("c").await;
    sim.heartbeat().await;
    sim.propose("a", &payment_op("op_1", 1_000, 0))
        .await
        .expect("çoğunluk var");
    sim.deliver().await;
    assert_eq!(sim.remaining("a").await, Some(9_000));

    sim.restart("c").await;
    sim.heartbeat().await;
    sim.heartbeat().await;
    assert_eq!(sim.remaining("c").await, Some(9_000));
}

#[tokio::test]
async fn iki_uye_kaybolursa_uc_cihazda_da_yazma_durur() {
    let mut sim = Sim::new(&["a", "b", "c"]).await;
    sim.elect("a").await;
    sim.seed_debt("a").await;
    sim.crash("b").await;
    sim.crash("c").await;
    sim.now += LEASE_MS + 1;
    let error = sim
        .propose("a", &payment_op("op_1", 1_000, 0))
        .await
        .expect_err("çoğunluk yok");
    assert!(error.starts_with("QUORUM_LOST"), "{error}");
}

#[tokio::test]
async fn eski_gorunumlu_iki_cihaz_ayni_borcu_cift_odeyemez() {
    let mut sim = Sim::new(&["a", "b", "c"]).await;
    sim.elect("a").await;
    sim.seed_debt("a").await;

    // İki terminal aynı sürümü görüp aynı anda öder; otorite sıraya koyar.
    sim.propose("a", &payment_op("op_1", 10_000, 0))
        .await
        .expect("birinci");
    sim.propose("a", &payment_op("op_2", 10_000, 0))
        .await
        .expect("ikinci");
    sim.deliver().await;
    sim.heartbeat().await;

    let second = sim.outcome("b", "op_2").await.expect("kayıt");
    assert_eq!(second.status, OperationStatus::Rejected);
    assert_eq!(sim.remaining("a").await, Some(0));
    assert_eq!(sim.remaining("b").await, Some(0));
    assert_eq!(sim.payments("c").await, 1);
}

#[tokio::test]
async fn takipci_isi_otoriteye_iletir_sonuc_gunlukle_doner() {
    let mut sim = Sim::new(&["a", "b"]).await;
    sim.elect("a").await;
    sim.seed_debt("a").await;

    let now = sim.now;
    let effects = sim
        .engine("a")
        .handle(
            "b",
            Message::Forward {
                operation: payment_op("op_fwd", 2_500, 0),
            },
            now,
        )
        .await
        .expect("iletilen işlem");
    sim.collect("a", effects);
    sim.deliver().await;
    sim.heartbeat().await;
    assert_eq!(
        sim.outcome("b", "op_fwd").await.expect("kayıt").status,
        OperationStatus::Applied
    );
}

#[tokio::test]
async fn otorite_degilse_iletilen_islem_gerekceyle_reddedilir() {
    let mut sim = Sim::new(&["a", "b"]).await;
    let now = sim.now;
    let effects = sim
        .engine("b")
        .handle(
            "a",
            Message::Forward {
                operation: payment_op("op_fwd", 1, 0),
            },
            now,
        )
        .await
        .expect("yanıt");
    sim.collect("b", effects);
    sim.deliver().await;
    assert_eq!(sim.rejected.len(), 1);
    assert!(sim.rejected[0].1.starts_with("NOT_LEADER"));
}

#[tokio::test]
async fn planli_pasife_alma_kalan_cihazi_tek_cihaz_moduna_gecirir() {
    let mut sim = Sim::new(&["a", "b"]).await;
    sim.elect("a").await;
    sim.seed_debt("a").await;

    sim.propose("a", &members_op("op_pasif", &["a"]))
        .await
        .expect("üyelik");
    sim.deliver().await;
    sim.crash("b").await;
    sim.now += LEASE_MS + 1;

    let now = sim.now;
    assert!(sim.engine("a").has_quorum(now).await.expect("çoğunluk"));
    sim.propose("a", &payment_op("op_pay", 3_000, 0))
        .await
        .expect("tek cihaz yazar");
    assert_eq!(sim.remaining("a").await, Some(7_000));
}

#[tokio::test]
async fn yeniden_baslayan_cihaz_verdigi_oyu_unutmaz() {
    let mut sim = Sim::new(&["a", "b", "c"]).await;
    let now = sim.now;
    let effects = sim
        .engine("b")
        .handle(
            "a",
            Message::VoteRequest {
                term: 5,
                last_index: 0,
                last_term: 0,
            },
            now,
        )
        .await
        .expect("oy");
    assert!(matches!(
        effects.send[0].1,
        Message::VoteReply { granted: true, .. }
    ));

    sim.crash("b").await;
    sim.restart("b").await;
    let effects = sim
        .engine("b")
        .handle(
            "c",
            Message::VoteRequest {
                term: 5,
                last_index: 9,
                last_term: 4,
            },
            now,
        )
        .await
        .expect("oy");
    assert!(
        matches!(effects.send[0].1, Message::VoteReply { granted: false, .. }),
        "aynı dönemde ikinci oy verilemez"
    );
}

#[tokio::test]
async fn gunlugu_eksik_cihaz_otorite_secilemez() {
    let mut sim = Sim::new(&["a", "b", "c"]).await;
    sim.elect("a").await;
    sim.seed_debt("a").await;
    sim.isolate("c");
    sim.propose("a", &payment_op("op_1", 1_000, 0))
        .await
        .expect("ödeme");
    sim.deliver().await;
    sim.heartbeat().await;

    sim.crash("a").await;
    sim.heal();
    sim.now += LEADER_SILENCE_MS + 1;
    let now = sim.now;
    let effects = sim
        .engine("c")
        .on_election_timeout(now)
        .await
        .expect("seçim");
    sim.collect("c", effects);
    sim.deliver().await;
    assert_ne!(sim.engine("c").role, Role::Leader);

    sim.elect("b").await;
    assert_eq!(sim.engine("b").role, Role::Leader);
    sim.heartbeat().await;
    assert_eq!(sim.remaining("c").await, Some(9_000));
}

#[tokio::test]
async fn denetim_kilidi_tutulurken_islem_uygulanmaz() {
    // Motor uygulaması uygulama çapındaki denetim kilidini paylaşır; kilit
    // dışarıda tutulurken uygulama bekler, kilit bırakılınca sürer.
    let mut sim = Sim::new(&["a"]).await;
    sim.elect("a").await;
    let shared = sim.engine("a").audit.clone();
    let guard = AuditLock::new(shared.lock().await);
    let pending = tokio::time::timeout(
        std::time::Duration::from_millis(100),
        sim.propose("a", &card_op()),
    )
    .await;
    assert!(pending.is_err(), "denetim kilidi tutulurken uygulanmaz");
    drop(guard);
}
