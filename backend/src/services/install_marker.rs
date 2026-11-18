//! Yeniden kurulumda hesap oturumunun kapatılması.
//!
//! Neden: kaldırıcı uygulama verisini (SQLite) varsayılan olarak bırakır; satış ve
//! stok kaydı kaybolmasın diye bu doğrudur. Ama aynı klasördeki hesap oturumu da
//! kalırsa yeniden kurulan uygulama önceki hesapla açılır. Kurulum klasöründe
//! kurulumda yazılan bir kimlik dosyası vardır; kaldırınca silinir, güncellemede
//! kalır. Kimlik, uygulama verisindeki son kayıtlı kimlikten farklıysa bu yeni bir
//! kurulumdur: yalnız oturum ve kilit durumu sıfırlanır, işletme tabloları kalır.

use sqlx::SqlitePool;
use std::path::Path;

/// Kurulum klasöründeki kimlik dosyasının adı (NSIS kancası yazar).
pub const INSTALL_ID_FILE: &str = "install-id";
/// Uygulama verisinde son görülen kimliğin dosya adı.
pub const LAST_INSTALL_ID_FILE: &str = "last-install-id";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Kimlik dosyası yok (geliştirme, mobil, taşınabilir): hiçbir şey yapılmadı.
    NoMarker,
    /// Kimlik aynı: normal açılış veya güncelleme, oturum korundu.
    Unchanged,
    /// Yeni kurulum: oturum temizlendi.
    SessionCleared,
}

fn read_id(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => {
            let id = text.trim().to_string();
            Ok(if id.is_empty() { None } else { Some(id) })
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

/// Hesap oturumunu ve personel kilit durumunu sıfırlar; işletme tablolarına dokunmaz.
/// `sessions` ve `device_session` cihaza özel tablolardır, işletme verisi taşımaz.
pub async fn clear_session_state(pool: &SqlitePool) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        "UPDATE device_session
         SET user_id = NULL, tenant_id = NULL, keep_signed_in = 1,
             staff_idle_seconds = 120, signed_in_at = NULL
         WHERE slot = 1",
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    sqlx::query(
        "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP
         WHERE revoked_at IS NULL AND tenant_id IS NOT NULL",
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())
}

/// Açılışta, oturum okunmadan önce çağrılır. Kimlik değeri günlüğe yazılmaz.
pub async fn reconcile(
    pool: &SqlitePool,
    install_id_path: &Path,
    last_id_path: &Path,
) -> Result<Outcome, String> {
    let Some(current) = read_id(install_id_path)? else {
        return Ok(Outcome::NoMarker);
    };
    let stored = read_id(last_id_path)?;
    if stored.as_deref() == Some(current.as_str()) {
        return Ok(Outcome::Unchanged);
    }
    // Önce oturum temizlenir, kimlik sonra yazılır: yazma düşerse sonraki açılışta tekrar denenir.
    clear_session_state(pool).await?;
    std::fs::write(last_id_path, &current).map_err(|e| e.to_string())?;
    Ok(Outcome::SessionCleared)
}

#[cfg(test)]
#[path = "install_marker_tests.rs"]
mod tests;
