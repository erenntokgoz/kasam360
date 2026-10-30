//! TCP bağlantıları: kabul, arama ve eşleştirme yanıtı.
//!
//! Her bağlantı bir okuma ve bir yazma görevine ayrılır; tüm durum tek görevde
//! yaşadığından (`runtime`) bağlantı kopması veri yarışı üretmez.

use super::engine::Message;
use super::pairing::{self, JoinGrant, JoinRequest, PairingCode};
use super::runtime::Command;
use super::secure_channel::{Auth, DeviceKey, SecureChannel, SecureReader, SecureWriter};
use super::store;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const MODE_MEMBER: u8 = b'M';
const MODE_PAIR: u8 = b'P';
static NEXT_CONNECTION: AtomicU64 = AtomicU64::new(1);

/// Bağlantı açılınca taşınan, kimlik sayılmayan adres ipucu.
#[derive(Serialize, Deserialize)]
struct PeerInfo {
    listen_port: u16,
}

#[derive(Serialize, Deserialize)]
enum JoinReply {
    Granted(Box<JoinGrant>),
    Refused(String),
}

/// Üyelikteki açık anahtarlar; bağlantı anında diskten okunur ki çıkarılan
/// cihaz yeniden başlatma beklemeden reddedilsin.
async fn member_keys(pool: &SqlitePool) -> Result<(String, HashMap<String, String>), String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let row = store::load_cluster(&mut conn)
        .await?
        .ok_or_else(|| "UNCONFIGURED: küme kaydı yok".to_string())?;
    let members = store::current_members(&mut conn, &row).await?;
    Ok((
        row.cluster_id,
        members
            .into_iter()
            .map(|member| (member.device_id, member.public_key))
            .collect(),
    ))
}

async fn remember_address(pool: &SqlitePool, device_id: &str, address: &str) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO sync_peers (device_id, address, last_seen) VALUES (?, ?, datetime('now'))
         ON CONFLICT(device_id) DO UPDATE SET address = excluded.address, last_seen = excluded.last_seen",
    )
    .bind(device_id)
    .bind(address)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn spawn_peer(
    commands: mpsc::Sender<Command>,
    peer_id: String,
    initiated_here: bool,
    mut reader: SecureReader,
    mut writer: SecureWriter,
) {
    let connection = NEXT_CONNECTION.fetch_add(1, Ordering::Relaxed);
    let (outgoing, mut queue) = mpsc::channel::<Message>(256);
    tokio::spawn(async move {
        while let Some(message) = queue.recv().await {
            if writer.send(&message).await.is_err() {
                break;
            }
        }
    });
    tokio::spawn(async move {
        let up = Command::PeerUp {
            id: peer_id.clone(),
            connection,
            outgoing,
            initiated_here,
        };
        if commands.send(up).await.is_err() {
            return;
        }
        while let Ok(message) = reader.recv::<Message>().await {
            let inbound = Command::Inbound {
                from: peer_id.clone(),
                message,
            };
            if commands.send(inbound).await.is_err() {
                return;
            }
        }
        let _ = commands
            .send(Command::PeerDown {
                id: peer_id,
                connection,
            })
            .await;
    });
}

async fn member_session(
    stream: TcpStream,
    pool: &SqlitePool,
    key: &DeviceKey,
    me: &str,
    listen_port: u16,
    is_initiator: bool,
) -> Result<(String, SecureReader, SecureWriter), String> {
    let remote = stream.peer_addr().map_err(|e| e.to_string())?;
    let (cluster_id, keys) = member_keys(pool).await?;
    let resolve = move |id: &str| keys.get(id).cloned();
    let auth = Auth::Member {
        key,
        cluster_id: &cluster_id,
        resolve: &resolve,
    };
    let (mut channel, peer_id) = SecureChannel::establish(stream, me, auth, is_initiator).await?;
    channel.send(&PeerInfo { listen_port }).await?;
    let info: PeerInfo = channel.recv().await?;
    remember_address(
        pool,
        &peer_id,
        &SocketAddr::new(remote.ip(), info.listen_port).to_string(),
    )
    .await?;
    let (reader, writer) = channel.split();
    Ok((peer_id, reader, writer))
}

async fn handle_pairing(
    stream: TcpStream,
    pool: &SqlitePool,
    me: &str,
    tenant_id: &str,
    commands: &mpsc::Sender<Command>,
) -> Result<(), String> {
    let remote = stream.peer_addr().map_err(|e| e.to_string())?;
    let psk = {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        pairing::active_psk(&mut conn, tenant_id).await?
    }
    .ok_or_else(|| "UNAUTHORIZED: geçerli eşleştirme kodu yok".to_string())?;
    let (mut channel, _) =
        SecureChannel::establish(stream, me, Auth::Pairing { psk: &psk }, false).await?;
    let request: JoinRequest = channel.recv().await?;
    let address = SocketAddr::new(remote.ip(), request.listen_port).to_string();
    let (reply, answer) = oneshot::channel();
    commands
        .send(Command::Join {
            request,
            address,
            reply,
        })
        .await
        .map_err(|_| "Eşitleme motoru kapalı".to_string())?;
    let response = match answer.await {
        Ok(Ok(grant)) => JoinReply::Granted(Box::new(grant)),
        Ok(Err(reason)) => JoinReply::Refused(reason),
        Err(_) => JoinReply::Refused("Eşitleme motoru kapalı".to_string()),
    };
    channel.send(&response).await
}

/// Gelen bağlantıları kabul eder; kimliği doğrulanmayan bağlantı iz bırakmaz.
pub fn spawn_listener(
    listener: TcpListener,
    pool: SqlitePool,
    key: Arc<DeviceKey>,
    me: String,
    tenant_id: String,
    commands: mpsc::Sender<Command>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let listen_port = match listener.local_addr() {
            Ok(address) => address.port(),
            Err(_) => return,
        };
        while let Ok((mut stream, _)) = listener.accept().await {
            let (pool, key, me, tenant_id, commands) = (
                pool.clone(),
                key.clone(),
                me.clone(),
                tenant_id.clone(),
                commands.clone(),
            );
            tokio::spawn(async move {
                let session = async {
                    match stream.read_u8().await.map_err(|e| e.to_string())? {
                        MODE_PAIR => {
                            handle_pairing(stream, &pool, &me, &tenant_id, &commands).await
                        }
                        MODE_MEMBER => {
                            let (peer, reader, writer) =
                                member_session(stream, &pool, &key, &me, listen_port, false)
                                    .await?;
                            spawn_peer(commands.clone(), peer, false, reader, writer);
                            Ok(())
                        }
                        _ => Err("Bilinmeyen bağlantı kipi".to_string()),
                    }
                };
                if let Err(reason) = tokio::time::timeout(HANDSHAKE_TIMEOUT, session)
                    .await
                    .unwrap_or_else(|_| Err("Zaman aşımı".to_string()))
                {
                    tracing::warn!("Eşitleme bağlantısı reddedildi: {reason}");
                }
            });
        }
    })
}

/// Bir üyeye bağlanmayı dener; başarısızsa çalışma döngüsü yeniden dener.
pub fn spawn_dial(
    address: String,
    expected_peer: String,
    pool: SqlitePool,
    key: Arc<DeviceKey>,
    me: String,
    listen_port: u16,
    commands: mpsc::Sender<Command>,
) {
    tokio::spawn(async move {
        let session = async {
            let mut stream = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(&address))
                .await
                .map_err(|_| "Zaman aşımı".to_string())?
                .map_err(|e| e.to_string())?;
            stream
                .write_u8(MODE_MEMBER)
                .await
                .map_err(|e| e.to_string())?;
            let (peer, reader, writer) =
                member_session(stream, &pool, &key, &me, listen_port, true).await?;
            if peer != expected_peer {
                return Err("UNAUTHORIZED: beklenen cihaz değil".to_string());
            }
            spawn_peer(commands.clone(), peer, true, reader, writer);
            Ok::<(), String>(())
        };
        let result = tokio::time::timeout(HANDSHAKE_TIMEOUT, session).await;
        if !matches!(result, Ok(Ok(()))) {
            let _ = commands
                .send(Command::DialFailed { id: expected_peer })
                .await;
        }
    });
}

/// Yeni cihaz tarafı: kodla bağlanır, onay ve anlık görüntüyü alır.
pub async fn request_join(
    code: &PairingCode,
    me: &str,
    request: &JoinRequest,
) -> Result<JoinGrant, String> {
    let mut stream = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(&code.address))
        .await
        .map_err(|_| "Bağlantı zaman aşımına uğradı".to_string())?
        .map_err(|e| format!("Otorite cihaza bağlanılamadı: {e}"))?;
    stream
        .write_u8(MODE_PAIR)
        .await
        .map_err(|e| e.to_string())?;
    let psk = code.psk();
    let (mut channel, _) =
        SecureChannel::establish(stream, me, Auth::Pairing { psk: &psk }, true).await?;
    channel.send(request).await?;
    match channel.recv::<JoinReply>().await? {
        JoinReply::Granted(grant) => Ok(*grant),
        JoinReply::Refused(reason) => Err(reason),
    }
}
