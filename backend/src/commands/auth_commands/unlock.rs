//! Kilitli oturumu yalnız oturum sahibinin PIN'iyle açar.
//!
//! Neden girişten ayrı: `auth_login` PIN'in sahibi kimse onun oturumunu açar.
//! Kilit ekranında kullanılsaydı başka personelin PIN'i, açık adisyonlarıyla
//! birlikte ekrandaki oturumu sessizce devralırdı.

use crate::db::DbPool;
use crate::services::security360::login_lockout::{
    basari_sifirla, hata_kaydet, kilit_kontrol, pin_kapsami,
};

pub async fn unlock_session(
    pool: &DbPool,
    tenant_id: &str,
    user_id: &str,
    pin: &str,
) -> Result<(), String> {
    let kapsam = pin_kapsami(tenant_id);
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    kilit_kontrol(&mut conn, &kapsam).await?;

    let owned: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM users WHERE id = ? AND tenant_id = ? AND is_active = 1")
            .bind(user_id)
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    let is_valid = if owned.is_some() {
        crate::user_credentials::verify_user_pin(&mut conn, user_id, pin).await?
    } else {
        // Platform hesabı `users` tablosunda değildir; işletmesi de yoktur.
        let admin: Option<Option<String>> =
            sqlx::query_scalar("SELECT pin_hash FROM platform_admins WHERE id = ?")
                .bind(user_id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
        admin
            .flatten()
            .is_some_and(|hash| crate::user_credentials::verify_stored_credential(pin, &hash))
    };

    if is_valid {
        return basari_sifirla(&mut conn, &kapsam).await;
    }
    let durum = hata_kaydet(&mut conn, tenant_id, &kapsam).await?;
    Err(if durum.kilitli {
        durum.mesaj
    } else {
        "Geçersiz PIN".to_string()
    })
}

#[tauri::command]
pub async fn auth_unlock(
    tenant_id: String,
    user_id: String,
    pin: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<(), String> {
    crate::services::setup::require_complete(&pool).await?;
    unlock_session(&pool, &tenant_id, &user_id, &pin).await
}
