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

/// Cihaza özel tablolar: oturum, giriş sayacı, teslim kuyrukları ve eşitleme
/// durumu. Dış teslim kuyruğu taşınırsa aynı e-posta iki cihazdan gönderilir;
/// PIN deneme sayacı ve onay jetonları da yalnız üretildikleri cihazda anlamlıdır.
const LOCAL_ONLY_TABLES: [&str; 14] = [
    "app_setup",
    "approval_attempts",
    "approvals",
    "conflict_log",
    "device_backup",
    "device_session",
    "email_queue",
    "local_device_identity",
    "login_attempts",
    "outbox",
    "sessions",
    "snapshots",
    "two_factor_verifications",
    "whatsapp_queue",
];

/// Kiracı kolonu olmayan alt tablolar üst tablodan süzülür. Yeni tablolar kiracı
/// kolonu taşıdığı sürece kendiliğinden taşınır.
const CHILD_FILTERS: [(&str, &str); 3] = [
    ("tenants", "id = ?"),
    (
        "modifier_options",
        "group_id IN (SELECT id FROM modifier_groups WHERE tenant_id = ?)",
    ),
    (
        "product_modifier_groups",
        "group_id IN (SELECT id FROM modifier_groups WHERE tenant_id = ?)",
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

fn is_local_only(table: &str) -> bool {
    table.starts_with("sync_") || LOCAL_ONLY_TABLES.contains(&table)
}

async fn table_columns(conn: &mut SqliteConnection, table: &str) -> Result<Vec<String>, String> {
    sqlx::query_scalar("SELECT name FROM pragma_table_info(?)")
        .bind(table)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())
}

/// Taşınan tablolar ve satır süzgeçleri; eşleşmeyen tablo cihaz seviyesindedir.
async fn snapshot_sources(
    conn: &mut SqliteConnection,
) -> Result<Vec<(String, Vec<String>, String)>, String> {
    let names: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\'
         ORDER BY name",
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let mut sources = Vec::with_capacity(names.len());
    for table in names {
        if is_local_only(&table) {
            continue;
        }
        let columns = table_columns(conn, &table).await?;
        let filter = CHILD_FILTERS
            .iter()
            .find(|(name, _)| *name == table)
            .map(|(_, filter)| (*filter).to_string())
            .or_else(|| {
                columns
                    .iter()
                    .any(|column| column == "tenant_id")
                    .then(|| "tenant_id = ?".to_string())
            });
        if let Some(filter) = filter {
            sources.push((table, columns, filter));
        }
    }
    Ok(sources)
}

/// İşletmenin kiracı kapsamlı tam kopyası.
///
/// Yeni cihaz giriş, menü, stok ve cari ekranlarını bu kopyayla açar. Denetim
/// zinciri bozulmasın diye satırlar yazılma sırasıyla ve olduğu gibi taşınır.
pub async fn export_snapshot(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<(String, String)>, String> {
    let sources = snapshot_sources(conn).await?;
    let mut tables = Vec::with_capacity(sources.len());
    for (table, columns, filter) in sources {
        let pairs = columns
            .iter()
            .map(|column| format!("'{column}', \"{column}\""))
            .collect::<Vec<_>>()
            .join(", ");
        let rows: String = sqlx::query_scalar(&format!(
            "SELECT COALESCE(json_group_array(json_object({pairs})), '[]')
             FROM (SELECT * FROM \"{table}\" WHERE {filter} ORDER BY rowid)"
        ))
        .bind(tenant_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| format!("Anlık görüntü alınamadı ({table}): {e}"))?;
        if rows != "[]" {
            tables.push((table, rows));
        }
    }
    Ok(tables)
}

/// Kurulumda iş kaydı veya kullanıcı varsa katılım reddedilir.
async fn require_empty(conn: &mut SqliteConnection) -> Result<(), String> {
    for table in ["users", "directories", "debts", "orders", "cash_movements"] {
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

/// Görüntü satırlarını yerel şemaya yazar.
///
/// Sütun adları eşten geldiği için SQL'e yalnız yerel şemada bulunanlar girer;
/// bilinmeyen sütun sürüm farkıdır ve sessizce atılırsa veri kaybolurdu.
async fn insert_snapshot_rows(
    conn: &mut SqliteConnection,
    table: &str,
    columns: &[String],
    rows: &str,
) -> Result<(), String> {
    let keys: Vec<String> = sqlx::query_scalar("SELECT key FROM json_each(?, '$[0]')")
        .bind(rows)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| format!("Anlık görüntü okunamadı: {e}"))?;
    if let Some(unknown) = keys.iter().find(|key| !columns.contains(key)) {
        return Err(format!(
            "CONFLICT: sürüm uyuşmuyor; {table}.{unknown} bu cihazda yok, iki cihazı aynı sürüme yükseltin"
        ));
    }
    let names = keys
        .iter()
        .map(|key| format!("\"{key}\""))
        .collect::<Vec<_>>()
        .join(", ");
    let extract = keys
        .iter()
        .map(|key| format!("json_extract(value, '$.\"{key}\"')"))
        .collect::<Vec<_>>()
        .join(", ");
    // Yarım kalan katılımın yeniden denenmesinde bu cihazın kendi satırı görüntüde gelir.
    let on_conflict = if table == "devices" {
        " ON CONFLICT(id) DO NOTHING"
    } else {
        ""
    };
    sqlx::query(&format!(
        "INSERT INTO \"{table}\" ({names})
         SELECT {extract} FROM json_each(?) WHERE true ORDER BY key{on_conflict}"
    ))
    .bind(rows)
    .execute(&mut *conn)
    .await
    .map_err(|e| format!("Anlık görüntü yüklenemedi ({table}): {e}"))?;
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
    sqlx::query("PRAGMA defer_foreign_keys = ON")
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    adopt_tenant(conn, local_tenant, &grant.tenant_id).await?;
    // Geçici kiracı küme kimliğine taşındı; asıl satır görüntüden gelir. Silme
    // yazımdan önce olmalı: sonra yapılırsa alt kayıtlar cascade ile giderdi.
    if grant.snapshot.iter().any(|(table, _)| table == "tenants") {
        sqlx::query("DELETE FROM tenants WHERE id = ?")
            .bind(&grant.tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    }
    let sources = snapshot_sources(conn).await?;
    for (table, rows) in &grant.snapshot {
        let (name, columns, _) = sources
            .iter()
            .find(|(name, _, _)| name == table)
            .ok_or_else(|| format!("UNAUTHORIZED: beklenmeyen tablo: {table}"))?;
        insert_snapshot_rows(conn, name, columns, rows).await?;
    }
    // Anlık görüntü başkasının defteridir; yalnız kümenin kiracısıyla kabul edilir.
    for (table, columns, _) in &sources {
        if !columns.iter().any(|column| column == "tenant_id") {
            continue;
        }
        let foreign: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM \"{table}\" WHERE tenant_id != ?"
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
#[path = "pairing_tests.rs"]
mod tests;
