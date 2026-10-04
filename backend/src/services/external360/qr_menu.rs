//! QR menü: müşteri oturumu, statik menü dosyası, müşteri talebi, geri bildirim.
//!
//! Erişim modeli (C-8): müşteri **ağa bağlanmaz**. Menü, işletme tarafından
//! üretilen **statik** bir dosyadır (imzalı JSON + tek dosya HTML); müşteri onu
//! okur, talebini dosya olarak geri getirir veya personel aracılığıyla iletir.
//!
//! Neden müşteri oturumu var: menü dosyası herkese açıktır, ama "sipariş
//! verdim" diyebilen bir oturum olmamalıdır. Jeton tabloya yalnız özet olarak
//! girer (`security360::session` ile aynı yaklaşım).
//!
//! **Sınır — QR talebi siparişe kendisi dönüşmez.** `customer_orders` bir talep
//! kuyruğudur; kabulünde personel mevcut POS akışıyla `orders` satırını oluşturur
//! ve `order_id` ile bağlar. Neden: `orders.table_id` `NOT NULL` ve masaya
//! bağlıdır; QR (gel al) siparişi masasız olduğu için yeni sipariş yaratma
//! mantığı burada ikinci bir gerçek doğururdu (KDV, toplam, stok düşümü iki yerde).
//! Para üreten tek yer POS'tur.

use sha2::{Digest, Sha256};
use sqlx::{Row, SqliteConnection};

use super::signing::ANAHTAR_BAYT;
use super::tenant_zorunlu;
use crate::id_generator::generate_id;
use crate::services::security360::simdi_sn;

/// Müşteri oturum süresi (saniye). 2 saat.
///
/// Neden kısa: menü dosyası zaten açıktır; oturum yalnız "bu kişi talebimi
/// gönderebiliyor" bilgisini taşır. Uzun süre, kayıp bir telefondan talep
/// gönderme penceresi bırakırdı.
pub const MUSTERI_SURESI_SN: i64 = 7_200;

/// Müşteri oturum açılış bileti. `token` yalnız burada görünür.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MusteriOturumu {
    pub session_id: String,
    pub token: String,
    pub expires_at: i64,
}

/// Doğrulanmış müşteri oturumu.
#[derive(Debug, Clone)]
pub struct Oturum {
    pub id: String,
    pub musteri_etiketi: String,
}

/// Jetonun tabloya giren özeti.
fn jeton_ozeti(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.trim().as_bytes());
    hex::encode(hasher.finalize())
}

/// Rastgele müşteri jetonu üretir.
fn jeton_uret() -> Result<String, String> {
    use argon2::password_hash::rand_core::{OsRng, RngCore};

    let mut bayt = vec![0u8; ANAHTAR_BAYT];
    OsRng.fill_bytes(&mut bayt);
    Ok(hex::encode(bayt))
}

/// Müşteri oturumu açar.
pub async fn oturum_ac(
    conn: &mut SqliteConnection,
    tenant_id: Option<&str>,
    etiket: &str,
) -> Result<MusteriOturumu, String> {
    let kiraci = tenant_zorunlu(tenant_id)?;
    let id = generate_id("cxs");
    let jeton = jeton_uret()?;
    let bitis = simdi_sn() + MUSTERI_SURESI_SN;

    sqlx::query(
        "INSERT INTO customer_sessions
             (id, tenant_id, qr_token_hash, customer_label, expires_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&kiraci)
    .bind(jeton_ozeti(&jeton))
    .bind(etiket.trim())
    .bind(bitis)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(MusteriOturumu {
        session_id: id,
        token: jeton,
        expires_at: bitis,
    })
}

/// Müşteri oturumunu doğrular.
///
/// Sıra önemli: süre sonu kontrolü `revoked_at`'ten önce yapılır ve `revoked_at`
/// `try_get` ile okunur. Kolon bozulduğunda oturum "açık" sayılmaz; AGENTS.md
/// §3.4'ün güvenlik karşılığı — "oturum yok sayılır" bir iptal değildir.
pub async fn oturum_dogrula(
    conn: &mut SqliteConnection,
    tenant_id: Option<&str>,
    token: &str,
) -> Result<Oturum, String> {
    let kiraci = tenant_zorunlu(tenant_id)?;
    let temiz = token.trim();
    if temiz.is_empty() {
        return Err("SESSION_REQUIRED: Oturum jetonu gerekli.".to_string());
    }

    // Kiracı filtresi SQL'de: filtrelemesiz arama başka işletmenin jeton
    // özetini belleğe alırdı.
    let satir = sqlx::query(
        "SELECT id, customer_label, expires_at, revoked_at
         FROM customer_sessions WHERE qr_token_hash = ? AND tenant_id = ?",
    )
    .bind(jeton_ozeti(temiz))
    .bind(&kiraci)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let Some(satir) = satir else {
        return Err("UNAUTHORIZED: Oturum geçersiz.".to_string());
    };

    let iptal: Option<String> = satir.try_get("revoked_at").map_err(|e| e.to_string())?;
    if iptal.is_some() {
        return Err("UNAUTHORIZED: Oturum kapatıldı.".to_string());
    }

    let bitis: i64 = satir.try_get("expires_at").map_err(|e| e.to_string())?;
    if bitis <= simdi_sn() {
        return Err("SESSION_EXPIRED: Oturum süresi doldu.".to_string());
    }

    Ok(Oturum {
        id: satir.try_get("id").map_err(|e| e.to_string())?,
        musteri_etiketi: satir.try_get("customer_label").map_err(|e| e.to_string())?,
    })
}

/// Müşteri oturumunu iptal eder.
pub async fn oturum_iptal(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    token: &str,
) -> Result<bool, String> {
    let etkilenen = sqlx::query(
        "UPDATE customer_sessions SET revoked_at = datetime('now')
         WHERE qr_token_hash = ? AND tenant_id = ? AND revoked_at IS NULL",
    )
    .bind(jeton_ozeti(token.trim()))
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(etkilenen.rows_affected() > 0)
}

/// Yayınlanan menüyü okur.
///
/// `is_active = 0` **veya** `is_86 = 1` olan ürünler dışarıda: 86 olan ürün
/// ("stok bitti, menüden kalktı") hâlâ `is_active` göstergesi taşısa da
/// müşteriye gösterilmemelidir.
/// tartışma çıkar ve fiyat kayması açığı doğar (AGENTS.md P0-7).
pub async fn talep_kaydet(
    conn: &mut SqliteConnection,
    tenant_id: Option<&str>,
    token: &str,
    items: &str,
    not_: &str,
) -> Result<String, String> {
    let kiraci = tenant_zorunlu(tenant_id)?;
    let oturum = oturum_dogrula(conn, Some(&kiraci), token).await?;
    let id = generate_id("cxo");

    talep_govdesini_sinirla(items)?;

    sqlx::query(
        "INSERT INTO customer_orders (id, tenant_id, session_id, items, note)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&kiraci)
    .bind(&oturum.id)
    .bind(items.trim())
    .bind(not_.trim())
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(id)
}

/// Talep gövdesini doğrular: bozuk veya eksik alanlı talep **kaydedilmez**.
///
/// Neden ayrı yordam: kayıt öncesi ve içe aktarımda aynı kural uygulanır; iki
/// yerde kural yazılırsa biri unutulur ve davranış sessizce ayrışır.
fn talep_govdesini_sinirla(items: &str) -> Result<(), String> {
    let cozulmus: serde_json::Value =
        serde_json::from_str(items).map_err(|_| "Talep okunamadı.".to_string())?;
    let dizi = cozulmus
        .as_array()
        .ok_or_else(|| "Talep ürün listesi olmalı.".to_string())?;
    if dizi.is_empty() {
        return Err("Talep boş olamaz.".to_string());
    }
    for oge in dizi {
        if oge.get("product_id").and_then(|v| v.as_str()).is_none() {
            return Err("Talepte her ürünün `product_id` alanı olmalı.".to_string());
        }
        let adet = oge.get("qty").and_then(|v| v.as_i64()).unwrap_or(1);
        if adet <= 0 {
            return Err("Ürün adedi sıfırdan büyük olmalı.".to_string());
        }
        // Fiyat alanı reddedilir: talep fiyat taşımamalı.
        if oge.get("price_cents").is_some() {
            return Err("Talep fiyat içeremez; fiyat işletmece belirlenir.".to_string());
        }
    }
    Ok(())
}

/// Talebi kabul eder ve mevcut siparişe bağlar.
///
/// Neden `order_id` zorunlu: bkz. modül başlığı — para üreten tek yer POS'tur.
/// Burada yeni sipariş yaratılmaz; yalnız "bu talep karşılandı" gerçeği ve
/// bağlandığı sipariş kaydedilir.
pub async fn talep_onayla(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    talep_id: &str,
    order_id: &str,
) -> Result<(), String> {
    // Sipariş gerçekten bu işletmenin mi? Çapraz kiracı bağlantısı kurulmasın.
    let siparis: Option<String> =
        sqlx::query_scalar("SELECT id FROM orders WHERE id = ? AND tenant_id = ?")
            .bind(order_id.trim())
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    if siparis.is_none() {
        return Err("Sipariş bulunamadı: talep bu işletmenin siparişine bağlanamaz.".to_string());
    }

    let etkilenen = sqlx::query(
        "UPDATE customer_orders
         SET status = 'ACCEPTED', order_id = ?, updated_at = datetime('now')
         WHERE id = ? AND tenant_id = ? AND status = 'PENDING'",
    )
    .bind(order_id.trim())
    .bind(talep_id.trim())
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // Sessiz sıfır yasak: bulunamayan ya da kapanmış talep için "başarılı"
    // dönmek, arayüzde yanlış bir onay göstermek demektir (AGENTS.md §3.4).
    if etkilenen.rows_affected() == 0 {
        return Err("Talep onaylanamadı: bulunamadı veya zaten işlendi.".to_string());
    }

    Ok(())
}

/// Talebi reddeder.
pub async fn talep_reddet(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    talep_id: &str,
) -> Result<(), String> {
    let etkilenen = sqlx::query(
        "UPDATE customer_orders SET status = 'REJECTED', updated_at = datetime('now')
         WHERE id = ? AND tenant_id = ? AND status = 'PENDING'",
    )
    .bind(talep_id.trim())
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if etkilenen.rows_affected() == 0 {
        return Err("Talep reddedilemedi: bulunamadı veya zaten işlendi.".to_string());
    }
    Ok(())
}

/// Bekleyen talepleri listeler (personel ekranı için).
pub async fn bekleyen_talepler(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<(String, String, String)>, String> {
    let satirlar = sqlx::query(
        "SELECT id, items, note FROM customer_orders
         WHERE tenant_id = ? AND status = 'PENDING' ORDER BY created_at",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut liste = Vec::with_capacity(satirlar.len());
    for satir in satirlar {
        liste.push((
            satir.try_get("id").map_err(|e| e.to_string())?,
            satir.try_get("items").map_err(|e| e.to_string())?,
            satir.try_get("note").map_err(|e| e.to_string())?,
        ));
    }
    Ok(liste)
}

/// Müşteri geri bildirimi kaydeder.
pub async fn geri_bildirim_kaydet(
    conn: &mut SqliteConnection,
    tenant_id: Option<&str>,
    token: &str,
    rating: i64,
    yorum: &str,
) -> Result<String, String> {
    let kiraci = tenant_zorunlu(tenant_id)?;
    // Geri bildirim de oturum ister: oturumsuz istek, oturum kapatıldıktan sonra
    // da yazılabilirdi ve "kaç müşteri şikayetçi" sayımı şişerdi.
    let oturum = oturum_dogrula(conn, Some(&kiraci), token).await?;

    if !(1..=5).contains(&rating) {
        return Err("Puan 1 ile 5 arasında olmalı.".to_string());
    }
    let id = generate_id("cxf");

    sqlx::query(
        "INSERT INTO customer_feedback (id, tenant_id, session_id, rating, comment)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&kiraci)
    .bind(&oturum.id)
    .bind(rating)
    .bind(yorum.trim())
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(id)
}
#[cfg(test)]
#[path = "qr_menu_tests.rs"]
mod tests;
