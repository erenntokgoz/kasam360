use super::refresh_tenant_at;
use crate::services::{
    cloud_sync::{api::HttpApi, CloudSync},
    license,
};
use chrono::{Duration, SecondsFormat, Utc};
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use std::sync::Arc;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

const TENANT: &str = "tnt_01arz3ndektsv4rrffq69g5fav";
const OTHER_TENANT: &str = "tnt_01arz3ndektsv4rrffq69g5faw";
const OWNER: &str = "usr_01arz3ndektsv4rrffq69g5fav";
const TEST_A_DEVICE: &str = "dev_01arz3ndektsv4rrffq69g5fa9";

fn encode_base64url(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut result = String::new();
    for chunk in bytes.chunks(3) {
        let value = chunk
            .iter()
            .fold(0u32, |acc, byte| (acc << 8) | u32::from(*byte))
            << (8 * (3 - chunk.len()));
        for index in 0..(chunk.len() + 1) {
            result.push(TABLE[((value >> (18 - index * 6)) & 63) as usize] as char);
        }
    }
    result
}

async fn read_request(stream: &mut TcpStream) -> String {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let read = stream.read(&mut chunk).await.expect("request bytes");
        assert!(read > 0, "client closed before request completed");
        bytes.extend_from_slice(&chunk[..read]);
        let text = String::from_utf8_lossy(&bytes);
        if let Some((headers, body)) = text.split_once("\r\n\r\n") {
            let length = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().ok())
                        .flatten()
                })
                .unwrap_or(0);
            if body.len() >= length {
                return text.into_owned();
            }
        }
    }
}

async fn reply(stream: &mut TcpStream, value: Value) {
    let body = value.to_string();
    let response = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream
        .write_all(response.as_bytes())
        .await
        .expect("response bytes");
}

async fn database() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .in_memory(true)
                .foreign_keys(true),
        )
        .await
        .expect("temporary sqlite");
    sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("schema");
    sqlx::query("INSERT INTO tenants(id,name) VALUES(?, 'TEST_A Kafe')")
        .bind(TENANT)
        .execute(&pool)
        .await
        .expect("tenant");
    sqlx::query("INSERT INTO tenants(id,name) VALUES(?, 'TEST_B Kafe')")
        .bind(OTHER_TENANT)
        .execute(&pool)
        .await
        .expect("other tenant");
    sqlx::query("INSERT INTO app_setup(slot,status,origin,tenant_id,mode) VALUES(1,'COMPLETE','NEW',?,'NEW')")
        .bind(TENANT).execute(&pool).await.expect("setup");
    sqlx::query("INSERT INTO sync_cloud_state(slot,baseline_done) VALUES(1,1)")
        .execute(&pool)
        .await
        .expect("sync state");
    pool
}

#[tokio::test]
async fn native_activation_v2_license_and_tenant_sync_use_one_tenant_context() -> Result<(), String>
{
    let rng = ring::rand::SystemRandom::new();
    let pkcs8 = Ed25519KeyPair::generate_pkcs8(&rng).map_err(|_| "test key")?;
    let signing = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).map_err(|_| "test key")?;
    let pool = database().await;
    let device_id = {
        let mut conn = pool.acquire().await.map_err(|error| error.to_string())?;
        let stored = license::load(&mut conn).await?;
        license::save_key(&mut conn, "lk_isolated_acceptance").await?;
        stored.device_id
    };
    sqlx::query(
        "INSERT INTO devices(id,tenant_id,name,device_type) VALUES(?,?, 'TEST kasa','POS')",
    )
    .bind(&device_id)
    .bind(TENANT)
    .execute(&pool)
    .await
    .map_err(|error| error.to_string())?;
    sqlx::query("INSERT INTO local_device_identity(slot,tenant_id,device_id) VALUES(1,?,?)")
        .bind(TENANT)
        .bind(&device_id)
        .execute(&pool)
        .await
        .map_err(|error| error.to_string())?;
    let now = Utc::now();
    let paid_until = now + Duration::days(14);
    let offline_until = now + Duration::hours(12);
    let stamp = |date: chrono::DateTime<Utc>| date.to_rfc3339_opts(SecondsFormat::Millis, true);
    let digest = Sha256::digest(signing.public_key().as_ref());
    let claims = license::TenantLicenseClaims {
        version: 2,
        key_id: format!("key_{}", hex::encode(&digest[..16])),
        tenant_id: TENANT.into(),
        device_id: device_id.clone(),
        product_id: "prd_01arz3ndektsv4rrffq69g5fa7".into(),
        entitlement_revision: 17,
        feature_keys: vec!["feat_kds".into()],
        issued_at: stamp(now),
        refresh_after: stamp(now + Duration::hours(1)),
        offline_until: stamp(offline_until),
        paid_until: Some(stamp(paid_until)),
        mode: "active".into(),
        device_limit: None,
        package_name: None,
    };
    let signature = encode_base64url(
        signing
            .sign(&serde_json::to_vec(&claims).map_err(|error| error.to_string())?)
            .as_ref(),
    );
    let signed = json!({
        "version": claims.version, "keyId": claims.key_id, "tenantId": claims.tenant_id,
        "deviceId": claims.device_id, "productId": claims.product_id,
        "entitlementRevision": claims.entitlement_revision, "featureKeys": claims.feature_keys,
        "issuedAt": claims.issued_at, "refreshAfter": claims.refresh_after,
        "offlineUntil": claims.offline_until, "paidUntil": claims.paid_until,
        "mode": claims.mode, "signature": signature,
    });

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("{error:?}"))?;
    let origin = format!(
        "http://{}",
        listener.local_addr().map_err(|error| error.to_string())?
    );
    let expected_device_id = device_id.clone();
    let api = tokio::spawn(async move {
        let (mut activation, _) = listener.accept().await.expect("activation connection");
        let request = read_request(&mut activation).await;
        assert!(request.starts_with(&format!("POST /api/desktop/tenants/{TENANT}/activate ")));
        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: bearer lk_isolated_acceptance"));
        assert!(request
            .to_ascii_lowercase()
            .contains(&format!("x-device-id: {expected_device_id}")));
        let body: Value =
            serde_json::from_str(request.split_once("\r\n\r\n").expect("activation body").1)
                .expect("activation json");
        assert_eq!(body["tenantName"], "TEST_A Kafe");
        assert_eq!(body["platform"], "windows");
        assert!(body["label"]
            .as_str()
            .is_some_and(|label| !label.is_empty()));
        reply(&mut activation, json!({
                "deviceId": expected_device_id, "tenantId": TENANT, "label": "Test kasa", "platform": "windows",
            "status": "active", "registeredAt": "2026-11-07T10:00:00Z", "version": 1
        })).await;

        let (mut refresh, _) = listener.accept().await.expect("license connection");
        let request = read_request(&mut refresh).await;
        assert!(request.starts_with(&format!(
            "POST /api/desktop/tenants/{TENANT}/license/refresh "
        )));
        assert!(request
            .to_ascii_lowercase()
            .contains(&format!("x-device-id: {expected_device_id}")));
        reply(&mut refresh, signed).await;

        let (mut push, _) = listener.accept().await.expect("sync push connection");
        let request = read_request(&mut push).await;
        assert!(request.starts_with(&format!("POST /api/desktop/sync/tenants/{TENANT}/push ")));
        let payload: Value =
            serde_json::from_str(request.split_once("\r\n\r\n").expect("push body").1)
                .expect("push json");
        let operation = &payload["operations"][0];
        assert_eq!(operation["tenantId"], TENANT);
        assert_eq!(operation["deviceId"], expected_device_id);
        reply(
            &mut push,
            json!({
                "accepted": [{ "operationId": operation["operationId"], "seq": 1 }], "lastSeq": 1
            }),
        )
        .await;

        let (mut pull, _) = listener.accept().await.expect("sync pull connection");
        let request = read_request(&mut pull).await;
        assert!(request.starts_with(&format!(
            "GET /api/desktop/sync/tenants/{TENANT}/pull?after=0&limit="
        )));
        reply(
            &mut pull,
            json!({ "tenantId": TENANT, "operations": [], "nextAfter": 0, "hasMore": false }),
        )
        .await;
    });

    let refreshed = refresh_tenant_at(
        &pool,
        &device_id,
        "lk_isolated_acceptance",
        TENANT,
        "TEST_A Kafe",
        &origin,
        Some(signing.public_key().as_ref()),
    )
    .await?;
    assert_eq!(
        refreshed.state,
        license::LicenseState::Active,
        "license state rejected: {:?}",
        refreshed.last_error
    );
    assert_eq!(refreshed.tenant_id.as_deref(), Some(TENANT));
    assert_eq!(refreshed.features, vec!["feat_kds"]);
    let operation_id = "op_01arz3ndektsv4rrffq69g5fa2";
    let operation = json!({
        "operationId": operation_id, "tenantId": TENANT, "deviceId": device_id,
        "actorId": OWNER, "actorRole": "OWNER", "intentSha256": "a".repeat(64),
        "op": { "domain": "NOOP" }, "createdAt": now.to_rfc3339()
    });
    sqlx::query("INSERT INTO sync_cloud_baseline(position,tenant_id,operation_id,operation,pushed) VALUES(1,?,?,?,0)")
        .bind(TENANT).bind(operation_id).bind(operation.to_string())
        .execute(&pool).await.map_err(|error| error.to_string())?;
    let sync = CloudSync::new(pool.clone(), Arc::new(tokio::sync::Mutex::new(())));
    let report = sync
        .sync_once(&HttpApi::new(&origin)?, true)
        .await
        .map_err(|error| format!("{error:?}"))?;
    assert_eq!(report.pushed, 1);
    assert_eq!(report.pulled, Some(0));
    sqlx::query("UPDATE local_device_identity SET tenant_id=? WHERE slot=1")
        .bind(OTHER_TENANT)
        .execute(&pool)
        .await
        .map_err(|error| error.to_string())?;
    let rejected = sync.sync_once(&HttpApi::new(&origin)?, true).await;
    assert!(matches!(
        rejected,
        Err(crate::services::cloud_sync::SyncError::Local(message))
            if message.contains("TENANT_MISMATCH")
    ));
    api.await.map_err(|error| error.to_string())?;
    Ok(())
}

/// Gerçek, ayrı Labs ve API süreçlerine bağlanan yerel kabul testi.
#[tokio::test]
#[ignore = "run by scripts/run-local-device-sync-acceptance.mjs with isolated services"]
async fn native_process_activation_signed_v2_and_sync_acceptance() -> Result<(), String> {
    let api_origin = std::env::var("KASAM360_ACCEPTANCE_API_ORIGIN")
        .map_err(|_| "API acceptance origin is required".to_string())?;
    let key = std::env::var("KASAM360_ACCEPTANCE_LICENSE_KEY")
        .map_err(|_| "API acceptance license key is required".to_string())?;
    let public_hex = std::env::var("KASAM360_ACCEPTANCE_PUBLIC_KEY_HEX")
        .map_err(|_| "Sandbox public key is required".to_string())?;
    let public_key =
        hex::decode(public_hex).map_err(|_| "Sandbox public key is malformed".to_string())?;
    if public_key.len() != 32 || key.len() < 16 {
        return Err("Isolated acceptance credentials are malformed".to_string());
    }
    let pool = database().await;
    sqlx::query("INSERT INTO device_license(slot,device_id,license_key) VALUES(1,?,?)")
        .bind(TEST_A_DEVICE)
        .bind(&key)
        .execute(&pool)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("INSERT INTO devices(id,tenant_id,name,device_type) VALUES(?,?, 'TEST_A kabul kasası','POS')")
        .bind(TEST_A_DEVICE).bind(TENANT).execute(&pool).await.map_err(|error| error.to_string())?;
    sqlx::query("INSERT INTO local_device_identity(slot,tenant_id,device_id) VALUES(1,?,?)")
        .bind(TENANT)
        .bind(TEST_A_DEVICE)
        .execute(&pool)
        .await
        .map_err(|error| error.to_string())?;

    let status = refresh_tenant_at(
        &pool,
        TEST_A_DEVICE,
        &key,
        TENANT,
        "KASAM360 TEST_A",
        &api_origin,
        Some(&public_key),
    )
    .await?;
    if status.state != license::LicenseState::Active
        || status.tenant_id.as_deref() != Some(TENANT)
        || status.features != ["feat_kds"]
    {
        return Err(format!(
            "Sandbox V2 lisansı reddedildi: {:?}",
            status.last_error
        ));
    }
    let signed: String = sqlx::query_scalar("SELECT token FROM device_license WHERE slot=1")
        .fetch_one(&pool)
        .await
        .map_err(|error| error.to_string())?;
    let document: Value = serde_json::from_str(&signed).map_err(|error| error.to_string())?;
    if document["version"] != 2
        || document["tenantId"] != TENANT
        || document["deviceId"] != TEST_A_DEVICE
        || document["signature"].as_str().is_none()
    {
        return Err("V2 imzalı belge sınır alanlarını taşımıyor".to_string());
    }

    let now = Utc::now().to_rfc3339();
    let operation_id = "op_01arz3ndektsv4rrffq69g5fa2";
    let operation = json!({
        "operationId": operation_id, "tenantId": TENANT, "deviceId": TEST_A_DEVICE,
        "actorId": OWNER, "actorRole": "OWNER", "intentSha256": "a".repeat(64),
        "op": { "domain": "NOOP" }, "createdAt": now
    });
    sqlx::query("INSERT INTO sync_cloud_baseline(position,tenant_id,operation_id,operation,pushed) VALUES(1,?,?,?,0)")
        .bind(TENANT).bind(operation_id).bind(operation.to_string()).execute(&pool).await
        .map_err(|error| error.to_string())?;
    let sync = CloudSync::new(pool.clone(), Arc::new(tokio::sync::Mutex::new(())));
    let report = sync
        .sync_once(&HttpApi::new(&api_origin)?, true)
        .await
        .map_err(|error| format!("Gerçek API sync reddetti: {error:?}"))?;
    if report.pushed != 1 || report.pulled != Some(0) {
        return Err(format!("Gerçek API sync sonucu beklenmiyor: {report:?}"));
    }
    let accepted: i64 =
        sqlx::query_scalar("SELECT pushed FROM sync_cloud_baseline WHERE operation_id=?")
            .bind(operation_id)
            .fetch_one(&pool)
            .await
            .map_err(|error| error.to_string())?;
    if accepted != 1 {
        return Err("Native kuyruğu API kabulünden sonra işaretlenmedi".to_string());
    }
    Ok(())
}

/// Gerçek API/Labs akışından gelen V2 claim'lerini yerel lisans tüketicisinin okuduğunu doğrular.
#[tokio::test]
#[ignore = "run by scripts/run-manual-entitlement-acceptance.mjs with isolated services"]
async fn native_process_applies_current_manual_feature_entitlement() -> Result<(), String> {
    let api_origin = std::env::var("KASAM360_ACCEPTANCE_API_ORIGIN")
        .map_err(|_| "API acceptance origin is required".to_string())?;
    let key = std::env::var("KASAM360_ACCEPTANCE_LICENSE_KEY")
        .map_err(|_| "Sandbox license key is required".to_string())?;
    let public_hex = std::env::var("KASAM360_ACCEPTANCE_PUBLIC_KEY_HEX")
        .map_err(|_| "Sandbox public key is required".to_string())?;
    let mut expected: Vec<String> = std::env::var("KASAM360_ACCEPTANCE_EXPECTED_FEATURES")
        .unwrap_or_default()
        .split(',')
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect();
    expected.sort();
    let public_key =
        hex::decode(public_hex).map_err(|_| "Sandbox public key is malformed".to_string())?;
    if public_key.len() != 32 || key.len() < 16 {
        return Err("Isolated acceptance credentials are malformed".to_string());
    }
    let pool = database().await;
    sqlx::query("INSERT INTO device_license(slot,device_id,license_key) VALUES(1,?,?)")
        .bind(TEST_A_DEVICE)
        .bind(&key)
        .execute(&pool)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("INSERT INTO devices(id,tenant_id,name,device_type) VALUES(?,?, 'TEST_A entitlement kasası','POS')")
        .bind(TEST_A_DEVICE).bind(TENANT).execute(&pool).await.map_err(|error| error.to_string())?;
    sqlx::query("INSERT INTO local_device_identity(slot,tenant_id,device_id) VALUES(1,?,?)")
        .bind(TENANT)
        .bind(TEST_A_DEVICE)
        .execute(&pool)
        .await
        .map_err(|error| error.to_string())?;
    let status = refresh_tenant_at(
        &pool,
        TEST_A_DEVICE,
        &key,
        TENANT,
        "KASAM360 TEST_A",
        &api_origin,
        Some(&public_key),
    )
    .await?;
    if status.state != license::LicenseState::Active
        || status.tenant_id.as_deref() != Some(TENANT)
        || status.features != expected
    {
        return Err(format!(
            "Native V2 feature rights mismatch: got {:?}, expected {:?}",
            status.features, expected
        ));
    }
    let stored: String = sqlx::query_scalar("SELECT token FROM device_license WHERE slot=1")
        .fetch_one(&pool)
        .await
        .map_err(|error| error.to_string())?;
    let document: Value = serde_json::from_str(&stored).map_err(|error| error.to_string())?;
    if document["version"] != 2
        || document["tenantId"] != TENANT
        || document["featureKeys"] != serde_json::json!(expected)
    {
        return Err(
            "Native desktop did not retain current signed tenant feature claims".to_string(),
        );
    }
    Ok(())
}
