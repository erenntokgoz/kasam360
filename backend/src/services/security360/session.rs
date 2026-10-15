//! Oturum yönetimi (D1).
//!
//! Neden katmanlı ve neden `caller_role` **kaldırılmıyor**: AGENTS.md §9/P0-10
//! `caller_role` alanının yalnız çağrıya güvenmesini açık bir açık olarak
//! listeler. Tamamen kaldırmak tüm komutların imzasını ve arayüzün IPC
//! sözleşmesini kırardı. Katmanlı çözüm: `caller_role` korunur, ancak
//! **yüksek riskli komutlar** ek olarak oturum jetonu ister. Saldırgan
//! çağıran rolü taklit edebilir; jetonu taklit edemez.
//!
//! Neden jeton **özet** olarak saklanır: jetonun kendisi veritabanına yazılırsa
//! veritabanını okuyan bir saldırgan (yedekleme, kopyalanan dosya) doğrudan
//! oturum hırsızlığı yapar. `approval_service` ile aynı yaklaşım.
//!
//! Neden süre sonu: kayıp bir cihazın jetonu süresiz geçerli kalmamalıdır.
//! Vardiya uzunluğu bir günü aşmaz; süre sonu gün sonunda otomatik gelir.

use sha2::{Digest, Sha256};
use sqlx::{Row, SqliteConnection};

use super::simdi_sn;
use crate::id_generator::generate_id;

/// Oturum süresi (saniye). Vardiya günü aşmaz; süre sonu gün sonuyla örtüşür.
pub const OTURUM_SURESI_SN: i64 = 43_200;

/// Jetondan kriptografik özet üretir.
///
/// Neden SHA-256 ve neden ayrı tuz yok: jeton zaten 256 bit rastgelelik
/// taşıyor; özet, jetonu tahmin edilemez kılan şey değil, **veritabanından
/// geri alınamaz** kılan şeydir. Tuz eklemek jetonun kendisine değer
/// katar (o zaten rastgele) ve yalnız geri açılabilirliği zorlaştırır.
fn jeton_ozeti(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.trim().as_bytes());
    hex::encode(hasher.finalize())
}

/// Yeni oturum jetonu üretir.
///
/// Format: `<32 haneli özet>_<rastgelelik>`. Özet kanonik girdiyi
/// (`approval_service` ile aynı fikir), rastgelelik tahmin edilemezliği
/// sağlar: aynı kişi ikinci kez girse bile jeton farklıdır, aksi halde
/// eski jetonla yeni oturum açılabilirdi.
fn jeton_uret() -> String {
    let rastgelelik = uuid::Uuid::new_v4().simple().to_string();
    format!("{}_{}", &jeton_ozeti(&rastgelelik)[..32], rastgelelik)
}

/// Yeni oturum açar ve jetonu döndürür.
///
/// Jeton **yalnız burada** düz metin olarak görünür; çağıran bir kez alır ve
/// saklar. Tabloya yalnız özeti girer.
pub async fn oturum_ac(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: &str,
    device_label: &str,
) -> Result<SessionTicket, String> {
    let id = generate_id("ses");
    let jeton = jeton_uret();
    let bitis = simdi_sn() + OTURUM_SURESI_SN;

    sqlx::query(
        "INSERT INTO sessions
            (id, tenant_id, user_id, token_hash, device_label, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(user_id)
    .bind(jeton_ozeti(&jeton))
    .bind(device_label.trim())
    .bind(bitis)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(SessionTicket {
        session_id: id,
        token: jeton,
        expires_at: bitis,
    })
}

/// Oturum bileti. `token` yalnız açılışta döner, sonra bir daha okunamaz.
#[derive(Debug, Clone)]
pub struct SessionTicket {
    pub session_id: String,
    pub token: String,
    pub expires_at: i64,
}

/// Doğrulanmış oturum.
#[derive(Debug, Clone)]
pub struct Session {
    pub id: String,
    pub tenant_id: String,
    pub user_id: String,
    pub device_label: String,
}

/// Jetonu doğrular ve oturumu döndürür.
///
/// Sıra önemli: süre sonu **önce** denetlenir. Süresi dolmuş bir oturum
/// "geçerli" görünmemeli; yenileme kararı çağıra bırakılır.
pub async fn oturum_dogrula(
    conn: &mut SqliteConnection,
    token: &str,
    beklenen_tenant: &str,
) -> Result<Session, String> {
    let temiz = token.trim();
    if temiz.is_empty() {
        return Err(error::SESSION_REQUIRED.to_string());
    }

    // Kiracı filtresi **SQL'de**: `sessions` sorgusu kiracısız çalışırsa başka
    // işletmenin jeton özeti belleğe alınır. Eşleşme sonrası Rust tarafında
    // ayrıca karşılaştırmaya gerek kalmaz; bulunamayan satır tek hata yolunu
    // kullanır (bilinmeyen jeton ile yanlış kiracı ayırt edilemez).
    let satir = sqlx::query(
        "SELECT id, tenant_id, user_id, device_label, expires_at, revoked_at
         FROM sessions WHERE token_hash = ? AND tenant_id = ?",
    )
    .bind(jeton_ozeti(temiz))
    .bind(beklenen_tenant.trim())
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // Jeton bilinmiyorsa ve başka kiracının jetonuysa **aynı** hata döner:
    // ayrım, çapraz kiracıda oturum keşfine yol açar.
    let Some(satir) = satir else {
        return Err(error::INVALID_SESSION.to_string());
    };

    // `revoked_at` okunacaksa okunmalı: `try_get(...).ok()` yazılırsa kolon
    // bozulduğunda oturum **açık** sayılır. AGENTS.md §3.4'ün güvenlik
    // karşılığı — sessizce "oturum yok sayılır" bir oturum iptali değildir.
    let revoked: Option<String> = satir.try_get("revoked_at").map_err(|e| e.to_string())?;
    if revoked.is_some() {
        return Err(error::SESSION_REVOKED.to_string());
    }

    let expires_at: i64 = satir.try_get("expires_at").map_err(|e| e.to_string())?;
    if expires_at <= simdi_sn() {
        return Err(error::SESSION_EXPIRED.to_string());
    }

    Ok(Session {
        id: satir.try_get("id").map_err(|e| e.to_string())?,
        tenant_id: satir.try_get("tenant_id").map_err(|e| e.to_string())?,
        user_id: satir.try_get("user_id").map_err(|e| e.to_string())?,
        device_label: satir.try_get("device_label").map_err(|e| e.to_string())?,
    })
}

/// Oturumu kapatır (logout).
///
/// **Yan etki:** `sessions` satırı güncellenir. `revoked_at` yazılır, satır
/// silinmez — kim, ne zaman, hangi cihazdan çıkış yaptı denetim izi kalsın.
pub async fn oturum_kapat(conn: &mut SqliteConnection, token: &str) -> Result<bool, String> {
    let etkilenen = sqlx::query(
        "UPDATE sessions SET revoked_at = datetime('now')
         WHERE token_hash = ? AND revoked_at IS NULL",
    )
    .bind(jeton_ozeti(token.trim()))
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(etkilenen.rows_affected() > 0)
}

/// Kullanıcının **tüm** oturumlarını kapatır.
///
/// Kullanım: parola sıfırlama ve şüpheli giriş. Tek bir oturumu kapatmak
/// saldırganın açtığı diğer oturumları açık bırakır; parola değiştiyse **hepsi**
/// düşmelidir.
pub async fn tum_oturumlari_kapat(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: &str,
) -> Result<i64, String> {
    let etkilenen = sqlx::query(
        "UPDATE sessions SET revoked_at = datetime('now')
         WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL",
    )
    .bind(tenant_id)
    .bind(user_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(etkilenen.rows_affected() as i64)
}

/// Süresi dolmuş oturumları temizler.
///
/// Neden ayrı yordam: tablo şişerse her doğrulama yavaşlar. Temizlik
/// giriş sırasında yapılırsa "tüm oturumları birden kapat" işlemi bekletmez.
pub async fn sure_dolmuslari_temizle(conn: &mut SqliteConnection) -> Result<i64, String> {
    let etkilenen = sqlx::query("DELETE FROM sessions WHERE expires_at <= ?")
        .bind(simdi_sn())
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    Ok(etkilenen.rows_affected() as i64)
}

/// Oturum hataları. Metinler arayüze gösterilir; hiçbiri oturumun varlığını
/// sızdırmaz.
pub mod error {
    pub const SESSION_REQUIRED: &str = "SESSION_REQUIRED: Bu işlem için oturum açmanız gerekir.";
    pub const INVALID_SESSION: &str = "UNAUTHORIZED: Oturum geçersiz.";
    pub const SESSION_EXPIRED: &str =
        "SESSION_EXPIRED: Oturum süresi doldu. Lütfen tekrar giriş yapın.";
    pub const SESSION_REVOKED: &str = "UNAUTHORIZED: Oturum kapatıldı.";
}

/// Oturum doğrulaması bu kiracı için zorunlu mu?
pub async fn zorunlu_kil(conn: &mut SqliteConnection, tenant_id: &str) -> Result<bool, String> {
    let satir = sqlx::query("SELECT is_enforced FROM session_policies WHERE tenant_id = ?")
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    // Satır yoksa zorunlu değildir: arayüz oturum jetonunu gönderene kadar
    // kadar mevcut davranış korunur. Yanlışlıkla `true` dönmek, jeton
    // göndermeyen her çağrıyı kılar.
    Ok(satir.is_some_and(|s| s.get::<i64, _>("is_enforced") == 1))
}

/// Zorunluluk bayrağını ayarlar (yalnız işletme sahibi çağırabilir).
pub async fn zorunlu_kil_ayarla(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    zorunlu: bool,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO session_policies (tenant_id, is_enforced, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(tenant_id) DO UPDATE SET
             is_enforced = excluded.is_enforced,
             updated_at = excluded.updated_at",
    )
    .bind(tenant_id)
    .bind(i64::from(zorunlu))
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Yüksek riskli komutların tek oturum kapısı (D1).
///
/// Kural:
///   * Kiracı doğrulamayı zorunlu kıldıysa jeton **zorunludur**; eksik jeton
///     işlemi durdurur (fail-closed).
///   * Jeton verilmişse kiracı zorunlu kılmasa da **doğrulanır**: yanlış veya
///     süresi dolmuş jetonla işlem yapılamaz. Bu, saldırganın "jeton yok,
///     zorunlu da değil" diyerek kapıyı atlamasını engeller.
///   * Jeton yoksa ve zorunluluk kapalıysa `None` döner: çağıran, denetim
///     kaydında oturumla doğrulanmamış olarak işaretlenir.
pub async fn oturum_kapisi(
    conn: &mut SqliteConnection,
    token: Option<&str>,
    tenant_id: &str,
) -> Result<Option<Session>, String> {
    let zorunlu = zorunlu_kil(conn, tenant_id).await?;

    match token.map(str::trim).filter(|deger| !deger.is_empty()) {
        Some(jeton) => oturum_dogrula(conn, jeton, tenant_id).await.map(Some),
        None if zorunlu => Err(error::SESSION_REQUIRED.to_string()),
        None => Ok(None),
    }
}

/// Oturumdaki kullanıcının **gerçek** rolünü veritabanından okur.
///
/// Neden ayrı yordam ve neden `caller_role` değil: D1'nin çözdüğü sorun tam olarak
/// budur — rol çağrıdan gelen metindir. Oturum doğrulandığında rol de
/// doğrulanmalıdır, yoksa saldırgan geçerli bir oturumla `OWNER` yazarak kendi
/// onayını kendine verir (ayrım gözetimi zaten onay akışında var, burada kapı
/// katmanında kapanır).
///
/// Kullanıcı silinmiş veya pasifleştirilmişse oturum geçersizdir: yalnız PIN'i
/// bilmek oturumu canlı tutmaz.
pub async fn oturum_rolu(conn: &mut SqliteConnection, oturum: &Session) -> Result<String, String> {
    let satir =
        sqlx::query("SELECT role FROM users WHERE id = ? AND tenant_id = ? AND is_active = 1")
            .bind(&oturum.user_id)
            .bind(&oturum.tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

    let Some(satir) = satir else {
        return Err(error::INVALID_SESSION.to_string());
    };

    let ham: String = satir.try_get("role").map_err(|e| e.to_string())?;
    crate::rbac::canonical_role(&ham)
        .map(|rol| rol.as_str().to_string())
        .ok_or_else(|| error::INVALID_SESSION.to_string())
}

/// Yüksek riskli komutların aktör çözümlemesi: kimlik **ve** rol (D1).
///
/// Oturum doğrulandıysa ikisi de oturumdan gelir; doğrulanmadıysa çağıranın
/// bildirdiği değerler kullanılır (arayüz oturum göndermeye başlayınca
/// `zorunlu_kil_ayarla` ile zorunlu hale gelir).
///
/// Bu yordam komutlardan ayrı tutulur çünkü Tauri komutları `State` taşıdığı
/// için test edilemez; kural burada tek yerde durur ve iki para komutu aynı
/// çözümlemeyi kullanır.
pub async fn oturum_aktoru(
    conn: &mut SqliteConnection,
    token: Option<&str>,
    tenant_id: &str,
    bildirilen_actor_id: &str,
    bildirilen_rol: &str,
) -> Result<(String, String), String> {
    match oturum_kapisi(conn, token, tenant_id).await? {
        Some(oturum) => {
            let rol = oturum_rolu(conn, &oturum).await?;
            Ok((oturum.user_id, rol))
        }
        None => Ok((
            bildirilen_actor_id.trim().to_string(),
            bildirilen_rol.trim().to_string(),
        )),
    }
}

#[cfg(test)]
#[path = "session_tests.rs"]
mod tests;
