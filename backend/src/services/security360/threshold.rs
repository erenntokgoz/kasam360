//! Çift onay eşiği (D3).
//!
//! Neden DB'de: eşik `LARGE_DISCOUNT_CENTS` sabitiydi ve kod değiştirilmeden
//! değiştirilemiyordu. "500 TL üzeri indirim yöneticiden onay ister" kuralı
//! kafenin büyüklüğüne göre değişir; Hardcoded sabit ya çok sıkı ya çok gevşek
//! olur. Eşik artık kiracı başına tek satırda tutulur.
//!
//! Neden satır yoksa **kapalı** sayılmıyor: mevcut davranış korunur. Varsayılan
//! değer `approval_service::LARGE_DISCOUNT_CENTS`'tir; böylece hiçbir işletme
//! eşiği kendiliğinden kaybetmez. Fail-closed bir varsayılan ("satır yoksa
//! onay istenmez") mevcut güvenlik seviyesini düşürürdü.

use sqlx::{Row, SqliteConnection};

/// Eşiği okur. Satır yoksa `varsayilan_esik()`.
pub async fn esik_oku(conn: &mut SqliteConnection, tenant_id: &str) -> Result<i64, String> {
    let satir = sqlx::query("SELECT amount_cents FROM approval_thresholds WHERE tenant_id = ?")
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    // Satır okunamadıysa hata yükselir, sıfır dönmez: AGENTS.md §3.4. Eşiği
    // sıfır sanmak "her işlem onay ister" demektir; sessizce yükselen bir
    // onay yükü patronun kasa önünde bekletir.
    let Some(satir) = satir else {
        return Ok(varsayilan_esik());
    };

    let tutar: i64 = satir.try_get("amount_cents").map_err(|e| e.to_string())?;
    Ok(tutar.max(1))
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
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;

    async fn conn() -> SqliteConnection {
        let secenek = SqliteConnectOptions::from_str("sqlite::memory:")
            .expect("gecerli secenekler")
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(secenek)
            .await
            .expect("havuz acilir");
        sqlx::raw_sql(include_str!("../../../migrations/schema.sql"))
            .execute(&pool)
            .await
            .expect("sema uygulanir");
        pool.acquire().await.expect("baglanti").detach()
    }

    #[tokio::test]
    async fn kayit_yoksa_varsayilan_esik_geometrye_gelir() {
        let mut conn = conn().await;
        assert_eq!(esik_oku(&mut conn, "tenant_yok").await.expect("okunur"), varsayilan_esik());
    }

    #[tokio::test]
    async fn esik_kiraci_bazinda_kaydedilir() {
        let mut conn = conn().await;
        esik_ayarla(&mut conn, "tenant_a", 250_000).await.expect("yazilir");
        esik_ayarla(&mut conn, "tenant_b", 50_000).await.expect("yazilir");

        assert_eq!(esik_oku(&mut conn, "tenant_a").await.expect("okunur"), 250_000);
        assert_eq!(esik_oku(&mut conn, "tenant_b").await.expect("okunur"), 50_000);
    }

    #[tokio::test]
    async fn esik_ayni_kiracida_guncellenir() {
        let mut conn = conn().await;
        esik_ayarla(&mut conn, "tenant_a", 100_000).await.expect("yazilir");
        esik_ayarla(&mut conn, "tenant_a", 900_000).await.expect("guncellenir");

        assert_eq!(esik_oku(&mut conn, "tenant_a").await.expect("okunur"), 900_000);

        let satir_sayisi: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM approval_thresholds WHERE tenant_id = ?")
            .bind("tenant_a")
            .fetch_one(&mut conn)
            .await
            .expect("sayilir");
        assert_eq!(satir_sayisi, 1, "guncelleme yeni satir acmamali");
    }

    #[tokio::test]
    async fn sifirlama_varsayilana_dondurur() {
        let mut conn = conn().await;
        esik_ayarla(&mut conn, "tenant_a", 1_000).await.expect("yazilir");
        esik_sifirla(&mut conn, "tenant_a").await.expect("silinir");

        assert_eq!(esik_oku(&mut conn, "tenant_a").await.expect("okunur"), varsayilan_esik());
    }

    #[tokio::test]
    async fn sifir_ve_negatif_esik_birime_kilitlenir() {
        let mut conn = conn().await;

        assert_eq!(esik_ayarla(&mut conn, "tenant_a", 0).await.expect("yazilir"), 1);
        assert_eq!(esik_ayarla(&mut conn, "tenant_b", -50_000).await.expect("yazilir"), 1);

        assert_eq!(esik_oku(&mut conn, "tenant_a").await.expect("okunur"), 1);
        assert_eq!(esik_oku(&mut conn, "tenant_b").await.expect("okunur"), 1);
    }
}