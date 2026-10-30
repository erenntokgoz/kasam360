//! Kümeye katılma: kod üretimi, anlık görüntü ve kiracı kabulü.
//!
//! Yeni cihaz yalnız boş kurulumsa katılır. Kayıtlı işlemi olan iki defter
//! otomatik birleştirilmez: hangi hareketin doğru olduğuna yazılım karar veremez.

use super::store::{self, ClusterRow, Member};
use crate::services::device_identity::ensure_local_device;
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqliteConnection;

const CODE_LIFETIME_MINUTES: i64 = 10;

/// Eşitlenen cari tabloları. `supplier_documents` stok tablolarına bağlı olduğu
/// için stok eşitlenene kadar taşınmaz.
const SNAPSHOT_TABLES: [(&str, &[&str]); 3] = [
    (
        "directories",
        &[
            "id",
            "tenant_id",
            "name",
            "type",
            "phone",
            "email",
            "tax_no",
            "tax_office",
            "address",
            "credit_limit_cents",
            "notes",
            "created_at",
        ],
    ),
    (
        "debts",
        &[
            "id",
            "tenant_id",
            "directory_id",
            "type",
            "total_amount_cents",
            "remaining_amount_cents",
            "due_date",
            "status",
            "is_cash",
            "order_id",
            "description",
            "created_at",
        ],
    ),
    (
        "debt_payments",
        &[
            "id",
            "tenant_id",
            "debt_id",
            "amount_cents",
            "payment_method",
            "shift_id",
            "actor_id",
            "notes",
            "created_at",
        ],
    ),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRequest {
    pub device_id: String,
    pub name: String,
    pub public_key: String,
    pub listen_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinGrant {
    pub tenant_id: String,
    pub cluster_id: String,
    pub authority_id: String,
    pub term: i64,
    pub base_index: i64,
    pub base_term: i64,
    pub base_members: Vec<Member>,
    pub snapshot: Vec<(String, String)>,
}

/// Eşleştirme kodu: `adres:port#gizli`. Gizli kısım 128 bit rastgeledir.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairingCode {
    pub address: String,
    pub secret: String,
}

impl PairingCode {
    pub fn parse(text: &str) -> Result<Self, String> {
        let (address, secret) = text
            .trim()
            .rsplit_once('#')
            .ok_or_else(|| "VALIDATION: eşleştirme kodu geçersiz".to_string())?;
        if address.is_empty() || secret.len() != 32 || hex::decode(secret).is_err() {
            return Err("VALIDATION: eşleştirme kodu geçersiz".to_string());
        }
        Ok(Self {
            address: address.to_string(),
            secret: secret.to_lowercase(),
        })
    }

    pub fn render(&self) -> String {
        format!("{}#{}", self.address, self.secret)
    }

    /// Kanala giren anahtar; veritabanında kodun kendisi yerine bu özet tutulur.
    pub fn psk(&self) -> Vec<u8> {
        Sha256::digest(self.secret.as_bytes()).to_vec()
    }
}

/// Yeni kod üretir; önceki kullanılmamış kodları geçersiz kılar.
pub async fn create_code(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    address: &str,
) -> Result<(PairingCode, String), String> {
    let mut secret = [0u8; 16];
    SystemRandom::new()
        .fill(&mut secret)
        .map_err(|_| "Rastgele kod üretilemedi".to_string())?;
    let code = PairingCode {
        address: address.to_string(),
        secret: hex::encode(secret),
    };
    let expires_at = (chrono::Utc::now() + chrono::Duration::minutes(CODE_LIFETIME_MINUTES))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    sqlx::query("DELETE FROM sync_pairing_codes WHERE tenant_id = ?")
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO sync_pairing_codes (secret_sha256, tenant_id, expires_at) VALUES (?, ?, ?)",
    )
    .bind(hex::encode(code.psk()))
    .bind(tenant_id)
    .bind(&expires_at)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok((code, expires_at))
}

/// Geçerli kodun kanal anahtarı. Kod yoksa bağlantı anlaşmaya bile başlamaz.
pub async fn active_psk(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Option<Vec<u8>>, String> {
    let stored: Option<String> = sqlx::query_scalar(
        "SELECT secret_sha256 FROM sync_pairing_codes
         WHERE tenant_id = ? AND used_at IS NULL AND expires_at > datetime('now')",
    )
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    stored
        .map(|text| hex::decode(text).map_err(|e| e.to_string()))
        .transpose()
}

/// Kod tek kullanımlıktır; yarışta ikinci cihaz reddedilir.
pub async fn consume_code(conn: &mut SqliteConnection, tenant_id: &str) -> Result<(), String> {
    let used = sqlx::query(
        "UPDATE sync_pairing_codes SET used_at = datetime('now')
         WHERE tenant_id = ? AND used_at IS NULL AND expires_at > datetime('now')",
    )
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if used.rows_affected() != 1 {
        return Err("UNAUTHORIZED: eşleştirme kodu kullanılmış veya süresi dolmuş".to_string());
    }
    Ok(())
}

/// Tek cihazlı kurulumu tek üyeli kümeye çevirir; mevcut günlük tabana dönüşür.
pub async fn init_cluster(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    device_name: &str,
    public_key: &str,
    listen_port: u16,
) -> Result<ClusterRow, String> {
    if let Some(existing) = store::load_cluster(conn).await? {
        return Ok(existing);
    }
    let device_id = ensure_local_device(conn, tenant_id).await?;
    let last: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(log_index), 0) FROM sync_operations WHERE tenant_id = ?",
    )
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let row = ClusterRow {
        tenant_id: tenant_id.to_string(),
        cluster_id: crate::id_generator::generate_id("cls"),
        term: 0,
        voted_for: None,
        commit_index: last,
        base_index: last,
        base_term: 0,
        base_members: vec![Member {
            device_id,
            name: device_name.to_string(),
            public_key: public_key.to_string(),
            address: String::new(),
        }],
        listen_port,
    };
    store::insert_cluster(conn, &row).await?;
    Ok(row)
}

fn columns_sql(columns: &[&str]) -> String {
    columns.join(", ")
}

/// Cari tablolarının kiracı kapsamlı kopyası.
pub async fn export_snapshot(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<(String, String)>, String> {
    let mut tables = Vec::with_capacity(SNAPSHOT_TABLES.len());
    for (table, columns) in SNAPSHOT_TABLES {
        let pairs = columns
            .iter()
            .map(|column| format!("'{column}', {column}"))
            .collect::<Vec<_>>()
            .join(", ");
        let rows: String = sqlx::query_scalar(&format!(
            "SELECT COALESCE(json_group_array(json_object({pairs})), '[]')
             FROM (SELECT * FROM {table} WHERE tenant_id = ? ORDER BY created_at, id)"
        ))
        .bind(tenant_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| format!("Anlık görüntü alınamadı: {e}"))?;
        tables.push((table.to_string(), rows));
    }
    Ok(tables)
}

/// Kurulumda iş kaydı varsa katılım reddedilir.
async fn require_empty(conn: &mut SqliteConnection) -> Result<(), String> {
    for table in ["directories", "debts", "orders", "cash_movements"] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        if count > 0 {
            return Err(format!(
                "CONFLICT: bu cihazda kayıtlı işlem var ({table}); defterler otomatik birleştirilmez"
            ));
        }
    }
    Ok(())
}

/// Boş kurulumun kendi kiracı kimliğini kümeninkine çevirir.
///
/// Her kurulum kendi kimliğini üretir. Denetim defteri güncellenemez olduğu için
/// eski kayıtlar eski kimlikte kalır; bu kurulumda iş kaydı olmadığı doğrulanmıştır.
async fn adopt_tenant(
    conn: &mut SqliteConnection,
    local_tenant: &str,
    cluster_tenant: &str,
) -> Result<(), String> {
    if local_tenant == cluster_tenant {
        return Ok(());
    }
    sqlx::query("PRAGMA defer_foreign_keys = ON")
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT m.name FROM sqlite_master m, pragma_table_info(m.name) p
         WHERE m.type = 'table' AND p.name = 'tenant_id' AND m.name != 'audit_ledger'",
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    for table in tables {
        sqlx::query(&format!(
            "UPDATE {table} SET tenant_id = ? WHERE tenant_id = ?"
        ))
        .bind(cluster_tenant)
        .bind(local_tenant)
        .execute(&mut *conn)
        .await
        .map_err(|e| format!("{table}: {e}"))?;
    }
    sqlx::query("UPDATE tenants SET id = ? WHERE id = ?")
        .bind(cluster_tenant)
        .bind(local_tenant)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Katılımı tek transaction'da uygular; yarım kalan katılım kurulumu bozmaz.
pub async fn accept_grant(
    conn: &mut SqliteConnection,
    local_tenant: &str,
    grant: &JoinGrant,
    listen_port: u16,
) -> Result<(), String> {
    if store::load_cluster(conn).await?.is_some() {
        return Err("CONFLICT: bu cihaz zaten bir kümeye bağlı".to_string());
    }
    require_empty(conn).await?;
    adopt_tenant(conn, local_tenant, &grant.tenant_id).await?;
    for (table, rows) in &grant.snapshot {
        let (name, columns) = SNAPSHOT_TABLES
            .iter()
            .find(|(name, _)| name == table)
            .ok_or_else(|| format!("UNAUTHORIZED: beklenmeyen tablo: {table}"))?;
        let extract = columns
            .iter()
            .map(|column| format!("json_extract(value, '$.{column}')"))
            .collect::<Vec<_>>()
            .join(", ");
        sqlx::query(&format!(
            "INSERT INTO {name} ({}) SELECT {extract} FROM json_each(?)",
            columns_sql(columns)
        ))
        .bind(rows)
        .execute(&mut *conn)
        .await
        .map_err(|e| format!("Anlık görüntü yüklenemedi: {e}"))?;
    }
    // Anlık görüntü başkasının defteridir; yalnız kümenin kiracısıyla kabul edilir.
    for (table, _) in SNAPSHOT_TABLES {
        let foreign: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM {table} WHERE tenant_id != ?"
        ))
        .bind(&grant.tenant_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        if foreign > 0 {
            return Err("UNAUTHORIZED: anlık görüntüde başka kiracının kaydı var".to_string());
        }
    }
    store::insert_cluster(
        conn,
        &ClusterRow {
            tenant_id: grant.tenant_id.clone(),
            cluster_id: grant.cluster_id.clone(),
            term: grant.term,
            voted_for: None,
            commit_index: grant.base_index,
            base_index: grant.base_index,
            base_term: grant.base_term,
            base_members: grant.base_members.clone(),
            listen_port,
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use sqlx::SqlitePool;

    async fn pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .in_memory(true)
                    .foreign_keys(true),
            )
            .await
            .expect("havuz");
        sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
            .execute(&pool)
            .await
            .expect("şema");
        pool
    }

    #[test]
    fn kod_cozulur_ve_bozuk_kod_reddedilir() {
        let code =
            PairingCode::parse("192.168.1.20:47360#00112233445566778899aabbccddeeff").expect("kod");
        assert_eq!(code.address, "192.168.1.20:47360");
        assert_eq!(PairingCode::parse(&code.render()).expect("yeniden"), code);
        assert!(PairingCode::parse("kod").is_err());
        assert!(PairingCode::parse("a#kisa").is_err());
    }

    #[tokio::test]
    async fn kod_tek_kullanimliktir_ve_sureye_baglidir() {
        let p = pool().await;
        let mut conn = p.acquire().await.expect("bağlantı");
        let (code, _) = create_code(&mut conn, "tnt_a", "h:1").await.expect("kod");
        assert_eq!(
            active_psk(&mut conn, "tnt_a").await.expect("psk"),
            Some(code.psk())
        );
        assert_eq!(active_psk(&mut conn, "tnt_b").await.expect("psk"), None);
        consume_code(&mut conn, "tnt_a")
            .await
            .expect("ilk kullanım");
        assert!(consume_code(&mut conn, "tnt_a").await.is_err());
        assert_eq!(active_psk(&mut conn, "tnt_a").await.expect("psk"), None);

        create_code(&mut conn, "tnt_a", "h:1").await.expect("kod");
        sqlx::query("UPDATE sync_pairing_codes SET expires_at = '2000-01-01 00:00:00'")
            .execute(&mut *conn)
            .await
            .expect("süre");
        assert_eq!(active_psk(&mut conn, "tnt_a").await.expect("psk"), None);
    }

    fn grant(tenant: &str, snapshot: Vec<(String, String)>) -> JoinGrant {
        JoinGrant {
            tenant_id: tenant.to_string(),
            cluster_id: "cls_1".to_string(),
            authority_id: "dev_a".to_string(),
            term: 3,
            base_index: 7,
            base_term: 2,
            base_members: Vec::new(),
            snapshot,
        }
    }

    #[tokio::test]
    async fn bos_kurulum_anlik_goruntuyu_ve_kiraciyi_kabul_eder() {
        let source = pool().await;
        sqlx::raw_sql(
            "INSERT INTO directories (id, tenant_id, name, type) VALUES ('dir_1', 'tnt_a', 'Ayşe', 'CUSTOMER');
             INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents, remaining_amount_cents)
             VALUES ('dbt_1', 'tnt_a', 'dir_1', 'GIVEN', 500, 200);
             INSERT INTO debt_payments (id, tenant_id, debt_id, amount_cents, payment_method, actor_id)
             VALUES ('pmt_1', 'tnt_a', 'dbt_1', 300, 'CASH', 'usr_1');
             INSERT INTO directories (id, tenant_id, name, type) VALUES ('dir_x', 'tnt_x', 'Başkası', 'CUSTOMER');",
        )
        .execute(&source)
        .await
        .expect("kaynak");
        let mut conn = source.acquire().await.expect("bağlantı");
        let snapshot = export_snapshot(&mut conn, "tnt_a").await.expect("görüntü");
        drop(conn);

        let target = pool().await;
        sqlx::raw_sql(
            "INSERT INTO tenants (id, name, status) VALUES ('tnt_b', 'Merkez', 'ACTIVE');
             INSERT INTO categories (id, tenant_id, name) VALUES ('cat_1', 'tnt_b', 'Genel');",
        )
        .execute(&target)
        .await
        .expect("hedef");
        let mut tx = target.begin().await.expect("tx");
        accept_grant(&mut tx, "tnt_b", &grant("tnt_a", snapshot), 9)
            .await
            .expect("katılım");
        tx.commit().await.expect("commit");

        let remaining: i64 = sqlx::query_scalar(
            "SELECT remaining_amount_cents FROM debts WHERE id = 'dbt_1' AND tenant_id = 'tnt_a'",
        )
        .fetch_one(&target)
        .await
        .expect("borç");
        assert_eq!(remaining, 200);
        let names: Vec<String> = sqlx::query_scalar("SELECT name FROM directories")
            .fetch_all(&target)
            .await
            .expect("kartlar");
        assert_eq!(names, vec!["Ayşe".to_string()], "başka kiracı taşınmaz");
        let category: String = sqlx::query_scalar("SELECT tenant_id FROM categories")
            .fetch_one(&target)
            .await
            .expect("kategori");
        assert_eq!(category, "tnt_a", "kurulum kümenin kiracısına geçer");
    }

    #[tokio::test]
    async fn dolu_kurulum_kumeye_katilamaz() {
        let target = pool().await;
        sqlx::query("INSERT INTO directories (id, tenant_id, name, type) VALUES ('dir_1', 'tnt_b', 'Yerel', 'CUSTOMER')")
            .execute(&target)
            .await
            .expect("kart");
        let mut tx = target.begin().await.expect("tx");
        let error = accept_grant(&mut tx, "tnt_b", &grant("tnt_a", Vec::new()), 9)
            .await
            .expect_err("red");
        assert!(error.starts_with("CONFLICT"), "{error}");
    }

    #[tokio::test]
    async fn baska_kiraci_iceren_goruntu_reddedilir() {
        let target = pool().await;
        let rows = serde_json::json!([{"id": "dir_x", "tenant_id": "tnt_x", "name": "X", "type": "CUSTOMER", "created_at": "2026-01-01"}]).to_string();
        let mut tx = target.begin().await.expect("tx");
        let error = accept_grant(
            &mut tx,
            "tnt_a",
            &grant("tnt_a", vec![("directories".to_string(), rows)]),
            9,
        )
        .await
        .expect_err("red");
        assert!(error.starts_with("UNAUTHORIZED"), "{error}");
    }
}
