//! Gerçek TCP ve şifreli kanal üzerinden uçtan uca senaryo.
//!
//! Tek makinede iki ayrı SQLite dosyasıyla çalışır; gerçek cihaz, kablosuz ağ
//! ya da güvenlik duvarı davranışını kanıtlamaz.

use super::op_log::{intent_hash, LogOp};
use super::runtime::LanSync;
use super::{Operation, OperationStatus};
use crate::services::cari::{CardFields, CariOp, OpenDebtInput, RecordPaymentInput};
use serde_json::json;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

const TENANT: &str = "tnt_a";

async fn device(name: &str) -> (SqlitePool, LanSync) {
    let dir = std::env::temp_dir().join(format!("kasam360_net_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("klasör");
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(dir.join(format!("{name}.sqlite")))
                .create_if_missing(true)
                .foreign_keys(true),
        )
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    let sync = LanSync::new(pool.clone(), Arc::new(Mutex::new(())), "127.0.0.1");
    (pool, sync)
}

fn operation(id: &str, device: &str, op: CariOp) -> Operation {
    Operation {
        operation_id: id.to_string(),
        tenant_id: TENANT.to_string(),
        device_id: device.to_string(),
        actor_id: "usr_1".to_string(),
        actor_role: "OWNER".to_string(),
        intent_sha256: intent_hash(op.kind(), &json!(id)),
        op: LogOp::Cari(Box::new(op)),
        created_at: "2026-10-30T10:00:00Z".to_string(),
    }
}

fn card() -> CariOp {
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
    }
}

fn debt() -> CariOp {
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
    })
}

fn payment(id: &str, amount: i64, version: i64) -> CariOp {
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
    })
}

/// İletilen işlem bağlantı kimliğiyle eşleşmelidir.
fn local_id(sync: &LanSync) -> String {
    sync.status()
        .members
        .into_iter()
        .find(|member| member.is_local)
        .map(|member| member.device_id)
        .expect("yerel cihaz üyelikte")
}

async fn remaining(pool: &SqlitePool) -> Option<i64> {
    sqlx::query_scalar(
        "SELECT remaining_amount_cents FROM debts WHERE id = 'dbt_1' AND tenant_id = ?",
    )
    .bind(TENANT)
    .fetch_optional(pool)
    .await
    .expect("bakiye")
}

/// Koşul sağlanana kadar bekler; süresi dolarsa testi düşürür.
macro_rules! wait_until {
    ($what:literal, $condition:expr) => {{
        let mut satisfied = false;
        for _ in 0..800 {
            if $condition {
                satisfied = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(satisfied, "beklenen durum oluşmadı: {}", $what);
    }};
}

/// Kümede tam bir otorite görünene kadar bekler; otoriteyi ve diğer cihazı döndürür.
///
/// Disk onayı ya da zamanlayıcı yüzünden kalp atışı otorite süresini aşarsa takipçi seçim
/// başlatır ve otorite el değiştirir; bu güvenlidir. Senaryo hangi cihazın otorite
/// olduğunu varsaymaz, kimin olduğunu kayıp anında okur.
async fn settled_authority<'a>(
    first: &'a (SqlitePool, LanSync),
    second: &'a (SqlitePool, LanSync),
) -> (&'a (SqlitePool, LanSync), &'a (SqlitePool, LanSync)) {
    let is_authority = |device: &(SqlitePool, LanSync)| {
        let status = device.1.status();
        status.role == Some(super::engine::Role::Leader) && status.state == "READY"
    };
    wait_until!(
        "tek otorite ve iki cihaz hazır",
        (is_authority(first) != is_authority(second)) && first.1.status().members.len() == 2
    );
    if is_authority(first) {
        (first, second)
    } else {
        (second, first)
    }
}

/// Sonucu belirsiz kalan işlemi aynı kimlikle yeniden sorar; ikinci kez yazılmaz.
async fn submit_until_resolved(
    sync: &LanSync,
    build: impl Fn() -> Operation,
) -> Result<super::OperationOutcome, String> {
    let mut last = String::new();
    for _ in 0..40 {
        match sync.submit(build()).await {
            Ok(outcome) if outcome.status == OperationStatus::Pending => {
                last = "PENDING_RESULT".to_string();
            }
            Err(error) if error.starts_with("SYNC_RETRY") => last = error,
            other => return other,
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err(last)
}

#[tokio::test]
async fn iki_kurulum_eslesir_para_cogunlukla_yazilir_cihaz_kaybinda_durur() {
    let device_a = device("a").await;
    let device_b = device("b").await;
    let ((_, sync_a), (pool_b, sync_b)) = (&device_a, &device_b);

    let (code, _) = sync_a
        .create_pairing_code(TENANT, "Kasa", "127.0.0.1", 0)
        .await
        .expect("kod");
    wait_until!("tek üyede otorite", sync_a.status().state == "READY");

    // Eşleşmeden önceki kayıtlar yeni cihaza anlık görüntüyle ulaşır.
    let done = sync_a
        .submit(operation("op_card", "a", card()))
        .await
        .expect("kart");
    assert_eq!(done.status, OperationStatus::Applied);
    sync_a
        .submit(operation("op_debt", "a", debt()))
        .await
        .expect("borç");

    sync_b
        .join(&code, TENANT, "Garson", 0)
        .await
        .expect("katılım");
    assert_eq!(remaining(pool_b).await, Some(10_000));
    assert!(
        sync_b.join(&code, TENANT, "Garson", 0).await.is_err(),
        "ikinci katılım reddedilir"
    );
    wait_until!(
        "iki üye bağlandı",
        sync_a.status().members.len() == 2 && sync_a.status().state == "READY"
    );
    wait_until!("takipçi hazır", sync_b.status().state == "READY");
    assert!(sync_a.is_multi_device());

    // Ödeme, hangi cihaz o an otorite olursa olsun diğerinden gönderilir ve iki diske yazılır.
    let (authority, follower) = settled_authority(&device_a, &device_b).await;
    let follower_id = local_id(&follower.1);
    let paid = submit_until_resolved(&follower.1, || {
        operation("op_pay", &follower_id, payment("op_pay", 4_000, 0))
    })
    .await
    .expect("ödeme");
    assert_eq!(paid.status, OperationStatus::Applied);
    assert_eq!(remaining(&follower.0).await, Some(6_000));
    wait_until!(
        "otorite uyguladı",
        remaining(&authority.0).await == Some(6_000)
    );

    // Aynı kimlik tekrarı ikinci ödeme üretmez.
    let again = follower
        .1
        .submit(operation(
            "op_pay",
            &follower_id,
            payment("op_pay", 4_000, 0),
        ))
        .await
        .expect("tekrar");
    assert_eq!(again, paid);

    // Takipçi kaybolur: kalan cihaz çoğunluğu yitirir ve yazmayı durdurur. Otorite el
    // değiştirmiş olabilir; kaybı yaşayan cihaz kayıp anında otorite olandır.
    let (survivor, lost) = settled_authority(&device_a, &device_b).await;
    let survivor_id = local_id(&survivor.1);
    lost.1.shutdown().await;
    wait_until!(
        "çoğunluk kaybı görüldü",
        survivor.1.status().state == "NO_CONNECTION"
    );
    // Son ACK kiralaması dolana kadar otoritenin eski çoğunluğu kullanması güvenlidir.
    // Kaybın kesinleşmesinden sonra yazma gecikmeden reddedilmeli.
    tokio::time::sleep(std::time::Duration::from_millis(2_100)).await;
    // Kayıptan önce otorite el değiştirmişse kalan cihaz takipçidir ve otoriteye
    // ulaşılamadığını bildirir; otorite ise çoğunluk kaybını bildirir. İkisi de
    // yazmayı reddeder.
    let still_authority = survivor.1.status().role == Some(super::engine::Role::Leader);
    let expected_refusal = if still_authority {
        "QUORUM_LOST"
    } else {
        "NO_CONNECTION"
    };
    let refused = survivor
        .1
        .submit(operation(
            "op_lost",
            &survivor_id,
            payment("op_lost", 1_000, 1),
        ))
        .await;
    assert!(
        refused
            .as_ref()
            .is_err_and(|error| error.starts_with(expected_refusal)),
        "{refused:?}"
    );
    assert_eq!(remaining(&survivor.0).await, Some(6_000));
    assert_eq!(
        remaining(&lost.0).await,
        Some(6_000),
        "kapanan cihazda da onaysız tahsilat yok"
    );

    // Otorite kalan cihaz planlı pasife alır; takipçi kalan cihaz sahibin devralmasıyla
    // tek cihaz moduna geçer. İkisi de güvenle yazmaya döner.
    if still_authority {
        let members = survivor.1.status().members;
        let gone = members.iter().find(|m| !m.is_local).expect("diğer cihaz");
        survivor
            .1
            .set_device_passive(TENANT, &gone.device_id, "usr_1", "OWNER")
            .await
            .expect("pasif");
    } else {
        survivor
            .1
            .take_over(TENANT, "usr_1", "OWNER")
            .await
            .expect("devralma");
    }
    wait_until!(
        "tek cihaz",
        !survivor.1.is_multi_device() && survivor.1.status().state == "READY"
    );
    assert!(survivor.1.require_local_write().is_ok());
    let resumed = survivor
        .1
        .submit(operation(
            "op_after",
            &survivor_id,
            payment("op_after", 1_000, 1),
        ))
        .await
        .expect("devam");
    assert_eq!(resumed.status, OperationStatus::Applied);
    assert_eq!(remaining(&survivor.0).await, Some(5_000));
    survivor.1.shutdown().await;
}

#[tokio::test]
async fn yanlis_kodla_katilim_reddedilir_ve_kume_etkilenmez() {
    let (_pool_a, sync_a) = device("a").await;
    let (_pool_b, sync_b) = device("b").await;
    let (code, _) = sync_a
        .create_pairing_code(TENANT, "Kasa", "127.0.0.1", 0)
        .await
        .expect("kod");
    let (address, _) = code.rsplit_once('#').expect("kod");
    let wrong = format!("{address}#{}", "0".repeat(32));
    assert!(sync_b.join(&wrong, TENANT, "Saldırgan", 0).await.is_err());
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(sync_a.status().members.len(), 1);
    sync_a.shutdown().await;
}

#[tokio::test]
async fn yeniden_baslayan_uye_otoriteye_baglanip_eksigini_alir() {
    let (pool_a, sync_a) = device("a").await;
    let (pool_b, sync_b) = device("b").await;
    let (code, _) = sync_a
        .create_pairing_code(TENANT, "Kasa", "127.0.0.1", 0)
        .await
        .expect("kod");
    wait_until!("otorite", sync_a.status().state == "READY");
    sync_a
        .submit(operation("op_card", "a", card()))
        .await
        .expect("kart");
    sync_a
        .submit(operation("op_debt", "a", debt()))
        .await
        .expect("borç");
    sync_b
        .join(&code, TENANT, "Garson", 0)
        .await
        .expect("katılım");
    wait_until!(
        "hazır",
        sync_a.status().state == "READY" && sync_a.is_multi_device()
    );
    // Üyelik kaydı takipçiye ulaşmadan otorite kapanırsa takipçi kendini üyelikte bulamaz.
    wait_until!("takipçi üyeliği aldı", sync_b.is_multi_device());
    // Eşitlenmeden önceki `NO_CONNECTION` kopma sayılmaz: otorite hâlâ canlıdır.
    wait_until!("takipçi eşitlendi", sync_b.status().state == "READY");

    sync_a.shutdown().await;
    wait_until!(
        "takipçi bağlantıyı yitirdi",
        sync_b.status().state == "NO_CONNECTION"
    );
    let cut_off = sync_b
        .submit(operation(
            "op_x",
            &local_id(&sync_b),
            payment("op_x", 1_000, 0),
        ))
        .await;
    assert!(cut_off.is_err(), "ağdan kopmuş cihaz yeni işlem açmaz");
    assert_eq!(remaining(&pool_b).await, Some(10_000));

    // Otorite yeniden açılınca seçim tamamlanır, ikisi de aynı sonuca ulaşır.
    let restarted = LanSync::new(pool_a.clone(), Arc::new(Mutex::new(())), "127.0.0.1");
    restarted.resume().await;
    wait_until!(
        "küme toparlandı",
        restarted.status().state == "READY" && sync_b.status().state == "READY"
    );
    let paid = restarted
        .submit(operation("op_y", "a", payment("op_y", 1_000, 0)))
        .await;
    let paid = match paid {
        Ok(outcome) => outcome,
        Err(_) => sync_b
            .submit(operation(
                "op_y",
                &local_id(&sync_b),
                payment("op_y", 1_000, 0),
            ))
            .await
            .expect("yeni otorite üzerinden"),
    };
    assert_eq!(paid.status, OperationStatus::Applied);
    wait_until!(
        "iki defter eşit",
        remaining(&pool_a).await == Some(9_000) && remaining(&pool_b).await == Some(9_000)
    );
    restarted.shutdown().await;
    sync_b.shutdown().await;
}

/// Onay yanıtı cihaza ulaşmadan kesilen katılım, yeni kodla aynı cihazdan sürer.
#[tokio::test]
async fn yarim_kalan_katilim_yeni_kodla_tamamlanir() {
    use crate::services::device_identity::ensure_local_device;
    use crate::services::lan_sync::pairing::{JoinRequest, PairingCode};
    use crate::services::lan_sync::secure_channel::DeviceKey;

    let (_pool_a, sync_a) = device("kasa").await;
    let (pool_b, sync_b) = device("yeni").await;
    let (code, _) = sync_a
        .create_pairing_code(TENANT, "Kasa", "127.0.0.1", 0)
        .await
        .expect("kod");
    wait_until!("tek üyede otorite", sync_a.status().state == "READY");

    // Kesintiyi yalnız ilk yarıyla kurar: üyelik yazılır, cihaz onayı işlemez.
    let (me, public_key) = {
        let mut conn = pool_b.acquire().await.expect("bağlantı");
        let key = DeviceKey::load_or_create(&mut conn).await.expect("anahtar");
        let me = ensure_local_device(&mut conn, TENANT).await.expect("cihaz");
        (me, key.public_key)
    };
    let request = JoinRequest {
        device_id: me.clone(),
        name: "Garson".to_string(),
        public_key,
        listen_port: 1,
    };
    let parsed = PairingCode::parse(&code).expect("kod");
    super::transport::request_join(&parsed, &me, &request)
        .await
        .expect("ilk katılım");
    wait_until!(
        "üyelik işlendi",
        sync_a.status().members.iter().any(|m| m.device_id == me)
    );

    let (retry, _) = sync_a
        .create_pairing_code(TENANT, "Kasa", "127.0.0.1", 0)
        .await
        .expect("yeni kod");
    sync_b
        .join(&retry, TENANT, "Garson", 0)
        .await
        .expect("yeniden deneme");
    wait_until!(
        "iki cihaz hazır",
        sync_a.status().state == "READY" && sync_b.status().state == "READY"
    );
    assert_eq!(sync_a.status().members.len(), 2, "cihaz çift eklenmez");
}
