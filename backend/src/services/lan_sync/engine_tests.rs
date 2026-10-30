//! Cihaz kaybı ve bölünme senaryoları.

use super::sim::{card_op, members_op, payment_op, Sim};
use super::*;
use crate::services::audit_service::AuditLock;

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
                operation: Box::new(Operation {
                    device_id: "b".to_string(),
                    ..payment_op("op_fwd", 2_500, 0)
                }),
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
                operation: Box::new(Operation {
                    device_id: "a".to_string(),
                    ..payment_op("op_fwd", 1, 0)
                }),
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
async fn kapsam_disi_iletilen_islem_reddedilir() {
    let mut sim = Sim::new(&["a", "b"]).await;
    sim.elect("a").await;
    sim.seed_debt("a").await;
    let forged = [
        // Başka cihaz adına.
        payment_op("op_1", 1_000, 0),
        // Başka kiracı adına.
        Operation {
            tenant_id: "tnt_x".to_string(),
            device_id: "b".to_string(),
            ..payment_op("op_2", 1_000, 0)
        },
        // Takipçi üyeliği değiştiremez.
        Operation {
            device_id: "b".to_string(),
            ..members_op("op_3", &["b"])
        },
    ];
    for operation in forged {
        let now = sim.now;
        let effects = sim
            .engine("a")
            .handle(
                "b",
                Message::Forward {
                    operation: Box::new(operation),
                },
                now,
            )
            .await
            .expect("yanıt");
        sim.collect("a", effects);
        sim.deliver().await;
    }
    assert_eq!(sim.rejected.len(), 3);
    assert!(sim
        .rejected
        .iter()
        .all(|(_, error)| error.starts_with("UNAUTHORIZED")));
    assert_eq!(sim.remaining("a").await, Some(10_000));
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
