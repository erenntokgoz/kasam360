//! Yeniden kurulumda yalnız oturumun temizlendiği, işletme verisinin kaldığı doğrulanır.

use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// Gerçek kullanıcı verisine dokunmamak için teste özel geçici klasör.
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "kasam360_install_marker_{}_{n}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("klasör");
        Self(path)
    }
    fn file(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().in_memory(true))
        .await
        .expect("havuz");
    sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
        .execute(&pool)
        .await
        .expect("şema");
    sqlx::query(
        "INSERT INTO tenants (id, name) VALUES ('tnt_a', 'A');
         INSERT INTO users (id, tenant_id, role, name, email, credential_hash)
            VALUES ('usr_1', 'tnt_a', 'OWNER', 'Sahip', 'a@b.co', 'hash');
         INSERT INTO device_session (slot, user_id, tenant_id, keep_signed_in, staff_idle_seconds)
            VALUES (1, 'usr_1', 'tnt_a', 0, 0);",
    )
    .execute(&pool)
    .await
    .expect("oturum");
    pool
}

async fn signed_in(pool: &SqlitePool) -> bool {
    let id: Option<String> =
        sqlx::query_scalar("SELECT user_id FROM device_session WHERE slot = 1")
            .fetch_one(pool)
            .await
            .expect("oku");
    id.is_some()
}

#[tokio::test]
async fn missing_marker_is_noop() {
    let pool = pool().await;
    let d = TempDir::new();
    let out = reconcile(&pool, &d.file("install-id"), &d.file("last"))
        .await
        .expect("uzlaştır");
    assert_eq!(out, Outcome::NoMarker);
    assert!(signed_in(&pool).await);
}

#[tokio::test]
async fn same_id_keeps_session() {
    let pool = pool().await;
    let d = TempDir::new();
    std::fs::write(d.file("install-id"), "A1\n").expect("yaz");
    std::fs::write(d.file("last"), "A1").expect("yaz");
    let out = reconcile(&pool, &d.file("install-id"), &d.file("last"))
        .await
        .expect("uzlaştır");
    assert_eq!(out, Outcome::Unchanged);
    assert!(signed_in(&pool).await);
}

#[tokio::test]
async fn different_or_missing_stored_id_clears_session_only() {
    for stored in [Some("ESKI"), None] {
        let pool = pool().await;
        let d = TempDir::new();
        std::fs::write(d.file("install-id"), "YENI").expect("yaz");
        if let Some(value) = stored {
            std::fs::write(d.file("last"), value).expect("yaz");
        }
        let out = reconcile(&pool, &d.file("install-id"), &d.file("last"))
            .await
            .expect("uzlaştır");
        assert_eq!(out, Outcome::SessionCleared);
        assert!(!signed_in(&pool).await);
        let (keep, idle): (i64, i64) = sqlx::query_as(
            "SELECT keep_signed_in, staff_idle_seconds FROM device_session WHERE slot = 1",
        )
        .fetch_one(&pool)
        .await
        .expect("ayar");
        assert_eq!((keep, idle), (1, 120));
        // İşletme verisi yerinde kalır.
        let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE tenant_id = 'tnt_a'")
            .fetch_one(&pool)
            .await
            .expect("say");
        assert_eq!(users, 1);
        assert_eq!(
            std::fs::read_to_string(d.file("last")).expect("oku"),
            "YENI"
        );
        // İkinci açılış oturumu yeniden bozmaz.
        let again = reconcile(&pool, &d.file("install-id"), &d.file("last"))
            .await
            .expect("uzlaştır");
        assert_eq!(again, Outcome::Unchanged);
    }
}
