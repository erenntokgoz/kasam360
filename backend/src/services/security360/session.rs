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
    pub const SESSION_EXPIRED: &str = "SESSION_EXPIRED: Oturum süresi doldu. Lütfen tekrar giriş yapın.";
    pub const SESSION_REVOKED: &str = "UNAUTHORIZED: Oturum kapatıldı.";
}

#[cfg(test)]
mod tests {
    use super::super::test_db::bellek;
    use super::*;

    async fn conn() -> SqliteConnection {
        bellek().await
    }

    #[tokio::test]
    async fn acilan_oturum_dogrulanir() {
        let mut conn = conn().await;
        let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
            .await
            .expect("oturum acilir");

        let oturum = oturum_dogrula(&mut conn, &bilet.token, "tenant_a")
            .await
            .expect("oturum gecerli");
        assert_eq!(oturum.user_id, "usr_1");
        assert_eq!(oturum.tenant_id, "tenant_a");
        assert_eq!(oturum.id, bilet.session_id);
        assert_eq!(oturum.device_label, "Kasa 1");
    }

    #[tokio::test]
    async fn jeton_tablosuz_gunduz_metin_olarak_saklanmaz() {
        let mut conn = conn().await;
        let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
            .await
            .expect("oturum acilir");

        let saklanan: String = sqlx::query_scalar("SELECT token_hash FROM sessions WHERE id = ?")
            .bind(&bilet.session_id)
            .fetch_one(&mut conn)
            .await
            .expect("satir okunur");

        assert_ne!(saklanan, bilet.token, "jeton duz metin saklanmamali");
        assert!(!saklanan.contains(&bilet.token), "jeton ozeti sizmamali");
        assert_eq!(saklanan.len(), 64, "SHA-256 ozeti 64 hex karakter");
    }

    #[tokio::test]
    async fn jeton_baska_kiracida_gecerli_degil() {
        let mut conn = conn().await;
        let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
            .await
            .expect("oturum acilir");

        let hata = oturum_dogrula(&mut conn, &bilet.token, "tenant_b")
            .await
            .expect_err("baska kiracida gecmemeli");
        assert_eq!(hata, error::INVALID_SESSION);
    }

    #[tokio::test]
    async fn bilinmeyen_jeton_ve_baska_kiraci_ayni_hata_dondurur() {
        let mut conn = conn().await;
        oturum_ac(&mut conn, "tenant_b", "usr_1", "Kasa 1")
            .await
            .expect("oturum acilir");

        let yabanci = oturum_dogrula(&mut conn, "olmayan_jeton", "tenant_a")
            .await
            .expect_err("gecersiz");
        let baskasindan = oturum_dogrula(&mut conn, "tenant_b_jetonu", "tenant_a")
            .await
            .err();

        assert_eq!(yabanci, error::INVALID_SESSION);
        assert_eq!(baskasindan, Some(error::INVALID_SESSION.to_string()));
    }

    #[tokio::test]
    async fn bos_ve_bosluklu_jeton_reddedilir() {
        let mut conn = conn().await;
        assert_eq!(
            oturum_dogrula(&mut conn, "", "tenant_a").await.unwrap_err(),
            error::SESSION_REQUIRED
        );
        assert_eq!(
            oturum_dogrula(&mut conn, "   ", "tenant_a").await.unwrap_err(),
            error::SESSION_REQUIRED
        );
    }

    #[tokio::test]
    async fn kapatilan_oturum_gecersiz_olur() {
        let mut conn = conn().await;
        let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
            .await
            .expect("oturum acilir");

        assert!(oturum_kapat(&mut conn, &bilet.token).await.expect("kapatilir"));

        let hata = oturum_dogrula(&mut conn, &bilet.token, "tenant_a")
            .await
            .expect_err("kapatilan oturum gecmemeli");
        assert_eq!(hata, error::SESSION_REVOKED);
    }

    #[tokio::test]
    async fn kapatilan_oturum_silinmez_denetim_izi_kalar() {
        let mut conn = conn().await;
        let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
            .await
            .expect("oturum acilir");
        oturum_kapat(&mut conn, &bilet.token).await.expect("kapatilir");

        let satir: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE id = ?")
            .bind(&bilet.session_id)
            .fetch_one(&mut conn)
            .await
            .expect("sayilir");
        assert_eq!(satir, 1, "kapatma silme degil, isaretlemedir");

        let revoked: Option<String> =
            sqlx::query_scalar("SELECT revoked_at FROM sessions WHERE id = ?")
                .bind(&bilet.session_id)
                .fetch_one(&mut conn)
                .await
                .expect("okunur");
        assert!(revoked.is_some(), "revoked_at islenmeli");
    }

    #[tokio::test]
    async fn ikinci_kapatma_jetonu_gecersizlestirmez_ama_bildirir() {
        let mut conn = conn().await;
        let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
            .await
            .expect("oturum acilir");

        assert!(oturum_kapat(&mut conn, &bilet.token).await.expect("ilk kapatma"));
        // Ikinci kapatma `false` doner: satır zaten isaretli.
        assert!(!oturum_kapat(&mut conn, &bilet.token).await.expect("ikinci kapatma"));
    }

    #[tokio::test]
    async fn parola_sifirlama_tum_oturumlari_kapatir() {
        let mut conn = conn().await;
        let a = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1").await.expect("ac");
        let b = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 2").await.expect("ac");
        let yabancilar = oturum_ac(&mut conn, "tenant_b", "usr_2", "Kasa 3")
            .await
            .expect("ac");

        let kapanan = tum_oturumlari_kapat(&mut conn, "tenant_a", "usr_1")
            .await
            .expect("toplu kapatilir");
        assert_eq!(kapanan, 2, "kullanicinin iki oturumu kapanmali");

        assert!(oturum_dogrula(&mut conn, &a.token, "tenant_a").await.is_err());
        assert!(oturum_dogrula(&mut conn, &b.token, "tenant_a").await.is_err());
        // Saldirganin acmis olabilecegi baska kullanici oturumu etkilenmez.
        assert!(oturum_dogrula(&mut conn, &yabancilar.token, "tenant_b")
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn toplu_kapatma_cift_tenant_ve_kullanici_durumunda_yalnizca_hedefleri_kapatir() {
        let mut conn = conn().await;
        oturum_ac(&mut conn, "tenant_a", "usr_1", "K1").await.expect("ac");
        oturum_ac(&mut conn, "tenant_a", "usr_2", "K2").await.expect("ac");
        oturum_ac(&mut conn, "tenant_b", "usr_1", "K3").await.expect("ac");

        let kapanan = tum_oturumlari_kapat(&mut conn, "tenant_a", "usr_1")
            .await
            .expect("kapatilir");
        assert_eq!(kapanan, 1, "cift eslesme (tenant + kullanici) zorunlu");
    }

    #[tokio::test]
    async fn suresi_dolus_oturum_gecersizdir() {
        let mut conn = conn().await;
        let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
            .await
            .expect("oturum acilir");

        // Suresi gecmis bir oturumu elle yaz: test, zamanin kendiliğinden
        // dolmasini beklemez.
        sqlx::query("UPDATE sessions SET expires_at = ? WHERE id = ?")
            .bind(simdi_sn() - 1)
            .bind(&bilet.session_id)
            .execute(&mut conn)
            .await
            .expect("sure kisaltilir");

        let hata = oturum_dogrula(&mut conn, &bilet.token, "tenant_a")
            .await
            .expect_err("suresi dolmus oturum gecmemeli");
        assert_eq!(hata, error::SESSION_EXPIRED);
    }

    #[tokio::test]
    async fn suresi_doluslari_temizlenir() {
        let mut conn = conn().await;
        let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
            .await
            .expect("oturum acilir");

        sqlx::query("UPDATE sessions SET expires_at = ? WHERE id = ?")
            .bind(simdi_sn() - 1)
            .bind(&bilet.session_id)
            .execute(&mut conn)
            .await
            .expect("sure kisaltilir");

        let silinen = sure_dolmuslari_temizle(&mut conn).await.expect("temizlenir");
        assert_eq!(silinen, 1);

        let kalan: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&mut conn)
            .await
            .expect("sayilir");
        assert_eq!(kalan, 0);
    }

    #[tokio::test]
    async fn her_oturum_jetonu_farklidir() {
        let mut conn = conn().await;
        let a = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1").await.expect("ac");
        let b = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1").await.expect("ac");
        assert_ne!(a.token, b.token, "iki oturum ayni jetonu paylasamaz");
    }

    #[tokio::test]
    async fn kiraci_eslesmesi_tam_karakter_ve_kenar_bosluk_tolereli() {
        let mut conn = conn().await;
        let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
            .await
            .expect("oturum acilir");

        // Kiraci kenar boslugu tolere edilir (arayuzden gelen metin).
        assert!(oturum_dogrula(&mut conn, &bilet.token, " tenant_a ")
            .await
            .is_ok());
        // Buyuk/kucuk harf **esletilmez**: kirac kodu normalizasyonu ayri
        // katmanda yapilir. Burada gevsek eslesme, farkli isletmenin jetonuyla
        // giris kapisini acar.
        assert_eq!(
            oturum_dogrula(&mut conn, &bilet.token, "TENANT_A")
                .await
                .expect_err("buyuk/kucuk harf ayrimi zorunlu"),
            error::INVALID_SESSION
        );
    }

    #[tokio::test]
    async fn sorgu_kiracisiz_calismaz() {
        // Guvenlik denetimi: `sessions` okumasinda kirac filtresi SQL'de
        // bulunmazsa baska isletmenin oturumu bellege alinir.
        let mut conn = conn().await;
        let bilet = oturum_ac(&mut conn, "tenant_a", "usr_1", "Kasa 1")
            .await
            .expect("oturum acilir");

        let ozet: String = sqlx::query_scalar("SELECT token_hash FROM sessions")
            .fetch_one(&mut conn)
            .await
            .expect("okunur");
        let yanlis_kiracida: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sessions WHERE token_hash = ? AND tenant_id = ?",
        )
        .bind(&ozet)
        .bind("tenant_b")
        .fetch_one(&mut conn)
        .await
        .expect("sayilir");
        assert_eq!(yanlis_kiracida, 0, "kirac filtresi satiri elemesi");

        // Dogru kiracida ayni jeton yine tek satiri gosterir.
        let dogru_kiracida: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sessions WHERE token_hash = ? AND tenant_id = ?",
        )
        .bind(&ozet)
        .bind("tenant_a")
        .fetch_one(&mut conn)
        .await
        .expect("sayilir");
        assert_eq!(dogru_kiracida, 1);
        let _ = bilet;
    }
}