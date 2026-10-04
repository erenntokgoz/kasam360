//! Çift onay eşiği (D3).
//!
//! Neden DB'de: eşik `LARGE_DISCOUNT_CENTS` sabitiydi ve kod değiştirilmeden
//! değiştirilemiyordu. "500 TL üzeri indirim yöneticiden onay ister" kuralı
//! kafenin büyüklüğüne göre değişir; hardcoded sabit ya çok sıkı ya çok gevşek
//! olur. Eşik artık kiracı başına tek satırda tutulur.
//!
//! **Neden satır yoksa `None`:** D3'ün kapsamı üç yeni yüzey ekledi (ödeme
//! toplamı, kasa çıkışı, gün sonu) ve bunların bugün onayı yoktur. Satır yoksa
//! `None` dönmek bu yüzeyleri mevcut davranışta bırakır. `varsayilan_esik()`
//! (500 TL) her işletmede zorlanırsa gün sonu ve kasa çıkışı onay jetonu
//! ister; jeton üreten arayüz Faz 17'de olduğu için patron günü kapatamaz.
//! Kullanılamayan bir güvenlik kapatması, hiç konmamış bir kapatmadan kötüdür.
//!
//! **Neden indirim farklı:** `DISCOUNT` yüzeyinde eşik zaten kod içindeydi ve
//! mevcut güvenlik seviyesi düşmemelidir. `esik_oku_indirim_icin` satır yoksa
//! sabite düşer.

use sqlx::{Row, SqliteConnection};

/// Eşiği okur. Satır yoksa `None` (onay kapalı).
///
/// Neden hata yükseliyor: satır okunamazsa `None` dönmek "eşik yok" demek
/// olurdu; oysa eşiği **bilmiyoruz**. Eşiği bilmeden onay kararı vermek, eşiği
/// yok saymaktan farksızdır (AGENTS.md §3.4).
pub async fn esik_oku(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Option<i64>, String> {
    let satir = sqlx::query("SELECT amount_cents FROM approval_thresholds WHERE tenant_id = ?")
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let Some(satir) = satir else {
        return Ok(None);
    };

    let tutar: i64 = satir.try_get("amount_cents").map_err(|e| e.to_string())?;
    Ok(Some(tutar.max(1)))
}

/// İndirim yüzeyi için eşik: satır yoksa kod içindeki sabit kullanılır.
///
/// Neden ayrı yordam: D3 yalnız **yeni** yüzeyleri kapatıyor. `DISCOUNT`
/// bugün `LARGE_DISCOUNT_CENTS` ile çalışıyor; aynı okuma yordamı kullanılsaydı
/// indirim onayı sessizce kapanırdı.
pub async fn esik_oku_indirim_icin(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<i64, String> {
    Ok(esik_oku(conn, tenant_id)
        .await?
        .unwrap_or_else(varsayilan_esik))
}

/// Eşiği yazar (varsayılan: hatalı eşiği geri al).
///
/// Alt sınır 1 kuruştur; sıfır veya negatif eşik "her işlem onay ister" gibi
/// görünür ama pratikte onayı işlevsiz kılar (her işlemde modal).
pub async fn esik_ayarla(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    amount_cents: i64,
) -> Result<i64, String> {
    let temiz = amount_cents.max(1);

    sqlx::query(
        "INSERT INTO approval_thresholds (tenant_id, amount_cents, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(tenant_id) DO UPDATE SET
             amount_cents = excluded.amount_cents,
             updated_at = excluded.updated_at",
    )
    .bind(tenant_id)
    .bind(temiz)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(temiz)
}

/// Eşiği sil; kiracı varsayılana döner.
pub async fn esik_sifirla(conn: &mut SqliteConnection, tenant_id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM approval_thresholds WHERE tenant_id = ?")
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Eşik kaydı olmayan kiracılar için kullanılan tutar (500,00 TL).
pub fn varsayilan_esik() -> i64 {
    crate::approval_service::LARGE_DISCOUNT_CENTS
}

#[cfg(test)]
mod tests {
    use super::super::test_db::bellek;
    use super::*;

    async fn conn() -> SqliteConnection {
        bellek().await
    }

    #[tokio::test]
    async fn kayit_yoksa_esik_yoktur() {
        let mut conn = conn().await;
        assert_eq!(
            esik_oku(&mut conn, "tenant_yok").await.expect("okunur"),
            None,
            "kayit yoksa yeni yuzeyler kapali kalmali"
        );
    }

    #[tokio::test]
    async fn indirim_yuzeyi_kayit_yoksa_sabite_duser() {
        let mut conn = conn().await;
        assert_eq!(
            esik_oku_indirim_icin(&mut conn, "tenant_yok").await.expect("okunur"),
            varsayilan_esik(),
            "mevcut indirim guvenligi dusmemeli"
        );

        esik_ayarla(&mut conn, "tenant_yok", 250_000).await.expect("yazilir");
        assert_eq!(
            esik_oku_indirim_icin(&mut conn, "tenant_yok").await.expect("okunur"),
            250_000,
            "kayit varsa db ustun gelir"
        );
    }

    #[tokio::test]
    async fn esik_kiraci_bazinda_kaydedilir() {
        let mut conn = conn().await;
        esik_ayarla(&mut conn, "tenant_a", 250_000).await.expect("yazilir");
        esik_ayarla(&mut conn, "tenant_b", 50_000).await.expect("yazilir");

        assert_eq!(
            esik_oku(&mut conn, "tenant_a").await.expect("okunur"),
            Some(250_000)
        );
        assert_eq!(
            esik_oku(&mut conn, "tenant_b").await.expect("okunur"),
            Some(50_000)
        );
        assert_eq!(
            esik_oku(&mut conn, "tenant_c").await.expect("okunur"),
            None,
            "kaydi olmayan kiralar etkilenmemeli"
        );
    }

    #[tokio::test]
    async fn esik_ayni_kiracida_guncellenir() {
        let mut conn = conn().await;
        esik_ayarla(&mut conn, "tenant_a", 100_000).await.expect("yazilir");
        esik_ayarla(&mut conn, "tenant_a", 900_000).await.expect("guncellenir");

        assert_eq!(
            esik_oku(&mut conn, "tenant_a").await.expect("okunur"),
            Some(900_000)
        );

        let satir_sayisi: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM approval_thresholds WHERE tenant_id = ?")
            .bind("tenant_a")
            .fetch_one(&mut conn)
            .await
            .expect("sayilir");
        assert_eq!(satir_sayisi, 1, "guncelleme yeni satir acmamali");
    }

    #[tokio::test]
    async fn sifirlama_yuzeyleri_kapatir() {
        let mut conn = conn().await;
        esik_ayarla(&mut conn, "tenant_a", 1_000).await.expect("yazilir");
        esik_sifirla(&mut conn, "tenant_a").await.expect("silinir");

        assert_eq!(esik_oku(&mut conn, "tenant_a").await.expect("okunur"), None);
    }

    #[tokio::test]
    async fn sifir_ve_negatif_esik_birime_kilitlenir() {
        let mut conn = conn().await;

        assert_eq!(esik_ayarla(&mut conn, "tenant_a", 0).await.expect("yazilir"), 1);
        assert_eq!(esik_ayarla(&mut conn, "tenant_b", -50_000).await.expect("yazilir"), 1);

        assert_eq!(
            esik_oku(&mut conn, "tenant_a").await.expect("okunur"),
            Some(1)
        );
        assert_eq!(
            esik_oku(&mut conn, "tenant_b").await.expect("okunur"),
            Some(1)
        );
    }
}