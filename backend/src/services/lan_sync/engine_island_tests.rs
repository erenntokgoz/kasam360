//! Bölünme, iki adada satış ve deterministik birleşme.
//!
//! Her cihaz kendi SQLite dosyasındadır; ada yazması komutların kullandığı kapı ve
//! tetikleyicilerden geçer. Sonuçlar iki cihazda birebir karşılaştırılır.

use super::super::super::capture::{self, TriggerMode};
use super::super::super::island::IslandBase;
use super::super::super::island_audit;
use super::super::super::island_queue::{self, SealMeta};
use super::*;
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};

const SEED: &str = "
    INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A');
    INSERT INTO devices (id, tenant_id, name, device_type) VALUES ('a', 'tnt_a', 'a', 'POS');
    INSERT INTO devices (id, tenant_id, name, device_type) VALUES ('b', 'tnt_a', 'b', 'POS');
    INSERT INTO devices (id, tenant_id, name, device_type) VALUES ('c', 'tnt_a', 'c', 'POS');
    INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_a', 'Genel');
    INSERT INTO products (id, tenant_id, category_id, name, price_cents)
        VALUES ('prd_1', 'tnt_a', 'cat_1', 'Çay', 1000);
    INSERT INTO inventory_batches (id, tenant_id, product_id, initial_quantity,
                                   remaining_quantity, unit_cost_cents, received_at)
        VALUES ('bat_1', 'tnt_a', 'prd_1', 3, 3, 10, '2026-01-01 00:00:00');
    INSERT INTO inventory_batches (id, tenant_id, product_id, initial_quantity,
                                   remaining_quantity, unit_cost_cents, received_at)
        VALUES ('bat_2', 'tnt_a', 'prd_1', 5, 5, 12, '2026-01-02 00:00:00');
    INSERT INTO tables (id, tenant_id, name, status, current_total)
        VALUES ('tbl_1', 'tnt_a', 'Masa 1', 'OCCUPIED', 1000);
    INSERT INTO orders (id, tenant_id, table_id, status, total_cents)
        VALUES ('ord_1', 'tnt_a', 'tbl_1', 'IN_PROGRESS', 1000);";

impl Sim {
    /// Aynı işletme verisiyle başlayan, yazmaları yakalanan iki cihaz.
    async fn shop(ids: &[&str]) -> Self {
        let mut sim = Sim::new(ids).await;
        for id in sim.ids() {
            let pool = sim.device(&id).pool.clone();
            sqlx::raw_sql(SEED).execute(&pool).await.expect("işletme");
            sqlx::query(
                "INSERT INTO local_device_identity (slot, tenant_id, device_id) VALUES (1, ?, ?)",
            )
            .bind(TENANT)
            .bind(&id)
            .execute(&pool)
            .await
            .expect("kimlik");
            let mut conn = pool.acquire().await.expect("bağlantı");
            capture::sync_triggers(&mut conn, TriggerMode::Cluster)
                .await
                .expect("kapı");
        }
        sim
    }

    /// Otoritesiz cihazın komut yolundaki yazması: ada kapısı, denetim alt zinciri, mühür.
    async fn island_write(&mut self, id: &str, statements: &str) {
        let pool = self.device(id).pool.clone();
        let mutex = Mutex::new(());
        let lock = AuditLock::new(mutex.lock().await);
        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.expect("tx");
        let row = store::load_cluster(&mut tx)
            .await
            .expect("küme")
            .expect("kayıt");
        sqlx::query("INSERT INTO sync_write_gate (mode) VALUES ('ISLAND')")
            .execute(&mut *tx)
            .await
            .expect("kapı");
        sqlx::raw_sql(statements)
            .execute(&mut *tx)
            .await
            .expect("yazma");
        let ctx = AuditContext::new(
            TENANT.to_string(),
            "usr_1".to_string(),
            "CASHIER".to_string(),
            category::ODEME,
            "test:tahsilat",
            "ord_1".to_string(),
            json!({ "cihaz": id }),
            "2026-11-05T12:00:00Z".to_string(),
        )
        .expect("kayıt");
        AuditService::append(&mut tx, &lock, &ctx)
            .await
            .expect("alt zincir");
        let base = IslandBase {
            tenant_id: TENANT.to_string(),
            device_id: id.to_string(),
            base_commit_index: row.commit_index,
            base_state: row.state_index,
        };
        island_queue::seal(&mut tx, &base, SealMeta::changes())
            .await
            .expect("mühür");
        tx.commit().await.expect("onay");
    }

    async fn scalar(&mut self, id: &str, sql: &str) -> i64 {
        let pool = self.device(id).pool.clone();
        sqlx::query_scalar(sql)
            .fetch_one(&pool)
            .await
            .expect("sorgu")
    }

    async fn text(&mut self, id: &str, sql: &str) -> String {
        let pool = self.device(id).pool.clone();
        sqlx::query_scalar(sql)
            .fetch_one(&pool)
            .await
            .expect("sorgu")
    }

    async fn real(&mut self, id: &str, sql: &str) -> f64 {
        let pool = self.device(id).pool.clone();
        sqlx::query_scalar(sql)
            .fetch_one(&pool)
            .await
            .expect("sorgu")
    }

    async fn settle_rounds(&mut self, rounds: usize) {
        for _ in 0..rounds {
            self.heartbeat().await;
        }
    }
}

fn settle(device: &str) -> String {
    format!(
        "UPDATE orders SET status = 'PAID' WHERE id = 'ord_1';
         UPDATE tables SET status = 'AVAILABLE' WHERE id = 'tbl_1';
         UPDATE inventory_batches SET remaining_quantity = remaining_quantity - 2 WHERE id = 'bat_1';
         INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload)
             VALUES ('evt_{device}', 'tnt_a', 'ord_1', 'ORDER', 'SALE_SETTLED', '{{}}');
         INSERT INTO products (id, tenant_id, category_id, name, price_cents)
             VALUES ('prd_{device}', 'tnt_a', 'cat_1', 'Yeni', 500);"
    )
}

/// İki taraf ayrılır, aynı adisyonu ve partiyi ayrı ayrı satar, sonra birleşir.
async fn split_and_merge() -> Sim {
    let mut sim = Sim::shop(&["a", "b"]).await;
    sim.elect("a").await;
    sim.isolate("a");
    sim.now += LEASE_MS + 1;
    sim.island_write("a", &settle("a")).await;
    sim.island_write("b", &settle("b")).await;
    // Otorite yokken küme kaydı uygulanmaz, ada satırları görünür kalır.
    sim.heartbeat().await;
    assert_eq!(
        sim.scalar("b", "SELECT COUNT(*) FROM products WHERE id = 'prd_b'")
            .await,
        1
    );
    sim.heal();
    sim.settle_rounds(8).await;
    sim
}

#[tokio::test]
async fn bolunmede_iki_tarafin_satisi_birlesir_iki_cihazda_ayni_sonuc() {
    let mut sim = split_and_merge().await;
    for id in ["a", "b"] {
        assert_eq!(
            sim.scalar(
                id,
                "SELECT COUNT(*) FROM sync_island_ops WHERE status != 'MERGED'"
            )
            .await,
            0,
            "{id}: ada kaydı birleşti"
        );
        assert_eq!(
            sim.scalar(
                id,
                "SELECT COUNT(*) FROM products WHERE id IN ('prd_a', 'prd_b')"
            )
            .await,
            2,
            "{id}: bağımsız kayıtlar doğrudan birleşir"
        );
        assert_eq!(
            sim.scalar(
                id,
                "SELECT COUNT(*) FROM events WHERE event_type = 'SALE_SETTLED'"
            )
            .await,
            2,
            "{id}: iki tahsilat da korunur"
        );
        assert_eq!(
            sim.text(id, "SELECT status FROM orders WHERE id = 'ord_1'")
                .await,
            "PAID"
        );
        // 3 − 2 − 2: açık sonraki partiden FIFO ile düşülür.
        assert_eq!(
            sim.real(
                id,
                "SELECT remaining_quantity FROM inventory_batches WHERE id = 'bat_1'"
            )
            .await,
            0.0
        );
        assert_eq!(
            sim.real(
                id,
                "SELECT remaining_quantity FROM inventory_batches WHERE id = 'bat_2'"
            )
            .await,
            4.0
        );
        assert_eq!(
            sim.scalar(id, "SELECT COUNT(*) FROM merge_conflicts").await,
            1,
            "{id}: çift tahsilat tek çakışma kaydı"
        );
        assert_eq!(
            sim.text(id, "SELECT kind FROM merge_conflicts").await,
            "ORDER_CONFLICT"
        );
    }
    let tail = "SELECT COUNT(*) || ':' || COALESCE(MAX(current_hash), '') FROM audit_ledger";
    assert_eq!(sim.text("a", tail).await, sim.text("b", tail).await);
    assert_eq!(
        sim.scalar("a", "SELECT state_index FROM sync_cluster")
            .await,
        sim.scalar("b", "SELECT state_index FROM sync_cluster")
            .await
    );
}

#[tokio::test]
async fn birlesmeden_sonra_ana_ve_alt_zincir_dogrulanir() {
    let mut sim = split_and_merge().await;
    for id in ["a", "b"] {
        let pool = sim.device(id).pool.clone();
        let mut conn = pool.acquire().await.expect("bağlantı");
        let main = AuditService::verify_chain(&mut conn)
            .await
            .expect("ana zincir");
        assert!(main.is_valid, "{id}: {:?}", main.failure_reason);
        for device in ["a", "b"] {
            assert_eq!(
                island_audit::verify(&mut conn, TENANT, device)
                    .await
                    .expect("alt zincir"),
                None,
                "{id}/{device}"
            );
        }
        let merges: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_ledger WHERE action = 'sync:island_merged'",
        )
        .fetch_one(&mut *conn)
        .await
        .expect("sayım");
        assert_eq!(merges, 2, "{id}: her ada için tek mühür kaydı");
    }
}

#[tokio::test]
async fn ayni_birlesme_tekrar_gelirse_ikinci_kez_uygulanmaz() {
    let mut sim = split_and_merge().await;
    let pool = sim.device("a").pool.clone();
    let payload: String = sqlx::query_scalar(
        "SELECT payload FROM sync_operations WHERE kind = 'ISLAND_MERGE' AND device_id = 'b'",
    )
    .fetch_one(&pool)
    .await
    .expect("birleşme");
    let op: LogOp = serde_json::from_str(&payload).expect("kayıt");
    let replay = Operation {
        operation_id: "op_replay".to_string(),
        tenant_id: TENANT.to_string(),
        device_id: "b".to_string(),
        actor_id: "SYSTEM".to_string(),
        actor_role: "System".to_string(),
        intent_sha256: "replay".to_string(),
        op,
        created_at: "2026-11-05T13:00:00Z".to_string(),
    };
    sim.propose("a", &replay).await.expect("öneri");
    sim.settle_rounds(3).await;
    for id in ["a", "b"] {
        assert_eq!(
            sim.scalar(
                id,
                "SELECT COUNT(*) FROM events WHERE event_type = 'SALE_SETTLED'"
            )
            .await,
            2
        );
        assert_eq!(
            sim.scalar(id, "SELECT COUNT(*) FROM merge_conflicts").await,
            1
        );
        assert_eq!(
            sim.scalar(id, "SELECT COUNT(*) FROM merged_island_ops")
                .await,
            2
        );
    }
}

#[tokio::test]
async fn geri_sarilmis_ada_gunlugu_reddedilir() {
    let mut sim = split_and_merge().await;
    let pool = sim.device("a").pool.clone();
    let payload: String = sqlx::query_scalar(
        "SELECT payload FROM sync_operations WHERE kind = 'ISLAND_MERGE' AND device_id = 'b'",
    )
    .fetch_one(&pool)
    .await
    .expect("birleşme");
    let LogOp::IslandMerge(mut batch) = serde_json::from_str(&payload).expect("kayıt") else {
        panic!("birleşme kaydı bekleniyordu");
    };
    // Yedekten dönen cihaz aynı sırayı başka bir satışla yeniden gönderir.
    batch.entries[0].operation_id = "op_restored".to_string();
    let forged = Operation {
        operation_id: "op_forged".to_string(),
        tenant_id: TENANT.to_string(),
        device_id: "b".to_string(),
        actor_id: "SYSTEM".to_string(),
        actor_role: "System".to_string(),
        intent_sha256: "forged".to_string(),
        op: LogOp::IslandMerge(batch),
        created_at: "2026-11-05T13:00:00Z".to_string(),
    };
    sim.propose("a", &forged).await.expect("öneri");
    sim.settle_rounds(3).await;
    for id in ["a", "b"] {
        let outcome = sim.outcome(id, "op_forged").await.expect("sonuç");
        assert_eq!(outcome.status, OperationStatus::Rejected);
        assert!(
            outcome
                .error
                .as_deref()
                .is_some_and(|e| e.starts_with("ROLLED_BACK")),
            "{outcome:?}"
        );
        assert_eq!(
            sim.scalar(
                id,
                "SELECT COUNT(*) FROM events WHERE event_type = 'SALE_SETTLED'"
            )
            .await,
            2
        );
    }
    assert!(
        sim.engine("b").halted.is_some(),
        "geri sarılmış cihaz müdahale bekler"
    );
}

#[tokio::test]
async fn otorite_dusunce_kalanlar_yeni_otoriteyle_surer_takipci_adaya_dusmez() {
    let mut sim = Sim::shop(&["a", "b", "c"]).await;
    sim.elect("a").await;
    sim.crash("a").await;
    sim.elect("b").await;
    assert_eq!(sim.engine("b").role, Role::Leader);
    sim.seed_debt("b").await;
    sim.propose("b", &payment_op("op_pay", 1_000, 0))
        .await
        .expect("yeni otorite");
    sim.settle_rounds(2).await;
    assert_eq!(sim.remaining("c").await, Some(9_000));
    assert_eq!(
        sim.scalar("c", "SELECT COUNT(*) FROM sync_island_ops")
            .await,
        0,
        "çoğunluk varken ada kaydı açılmaz"
    );
    // Düşen otorite döner: ada kaydı yoksa eksiğini günlükten tamamlar.
    sim.restart("a").await;
    sim.settle_rounds(3).await;
    assert_eq!(sim.remaining("a").await, Some(9_000));
}
