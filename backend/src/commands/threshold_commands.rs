//! Çift onay eşiğinin yönetimi (D3).
//!
//! Neden ayrı dosya: eşik bir **yönetim** ayarıdır; cihaz komutlarıyla aynı
//! dosyaya gömülürse 500 satır tavanı aşılır. `ledger_commands` vekiliyle aynı
//! desen: karar mantığı `&mut SqliteConnection` alan saf bir yordamdadır,
//! Tauri sarmalayıcıları yalnızca durum ve yetki bağlar. Böylece kural
//! komutsuz testlenir.
//!
//! Yetki: **yalnız işletme sahibi** eşiği değiştirebilir. Kasa çıkışı, gün sonu
//! ve yüksek tutarlı ödeme için onay kapısını açıp kapatan ayar, müdürün de
//! değiştirebileceği türden değildir: yönetici kendi işlemini onaylamamak için
//! eşiği kaldırabilirdi. Okuma sahip ve müdüre açıktır.
//!
//! Neden denetim kaydı: eşiği düşüren bir işlem, sonradan "neden onay
//! istemedi?" sorusunun tek cevabıdır.

use serde::{Deserialize, Serialize};
use sqlx::SqliteConnection;

use crate::db::DbPool;
use crate::services::audit_service::{category, AuditContext, AuditLock, AuditService};
use crate::services::security360::threshold;

/// Eşiğin okunduğu sonuç.
///
/// `amount_cents` `None` ise kiracı eşik tanımlamamıştır ve D3 gereği yeni
/// yüzeylerde onay kapalıdır. Arayüz "eşik tanımlı değil" ile "eşik şu" ayrımını
/// bu alandan görür.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalThresholdDto {
    pub tenant_id: String,
    pub amount_cents: Option<i64>,
    /// `true` ise kayıt yok ve kod içindeki varsayılan geçerli.
    pub is_default: bool,
}

/// Eşik değişikliğinin sonucu.
#[derive(Debug, Clone, PartialEq)]
pub struct ThresholdChange {
    pub amount_cents: Option<i64>,
    /// `false` ise kiracının zaten kaydı yoktu (sıfırlama etkisiz).
    pub changed: bool,
}

/// Eşiği değiştirir veya siler.
///
/// `amount_cents: None` = sıfırlama; kiracı indirim yüzeyindeki kod içi
/// varsayılana döner ve yeni yüzeylerde onay kapanır.
pub async fn esik_degistir(
    conn: &mut SqliteConnection,
    audit_lock: &AuditLock<'_>,
    actor_role: &str,
    actor_id: &str,
    tenant_id: &str,
    amount_cents: Option<i64>,
) -> Result<ThresholdChange, String> {
    // Yetki kapısı yazmadan **önce** gelir: yetkisiz çağıran hiçbir satıra
    // dokunmaz, denetim kaydı da yazılmaz.
    crate::rbac::require_any(actor_role, &[crate::rbac::Role::Owner])?;

    let tenant = tenant_id.trim();
    if tenant.is_empty() {
        return Err("VALIDATION: Kiracı belirtilmedi.".to_string());
    }

    // Önceki değer **yazmadan önce** okunur. Yazdıktan sonra okumak her zaman
    // yeni değeri döndürür: hem `changed` hep `false` olur hem de denetim
    // kaydındaki "önceki tutar" alanı yanlış (yeni) değeri taşır.
    let onceki = threshold::esik_oku(conn, tenant).await?;

    let (yeni_tutar, degisti, eylem) = match amount_cents {
        Some(tutar) => {
            let yazilan = threshold::esik_ayarla(conn, tenant, tutar).await?;
            (
                Some(yazilan),
                onceki != Some(yazilan),
                "security:approval_threshold_set",
            )
        }
        None => {
            threshold::esik_sifirla(conn, tenant).await?;
            (None, onceki.is_some(), "security:approval_threshold_reset")
        }
    };

    // Değişiklik olmadıysa kayıt yine de yazılır: "eşiği aynı değere ayarladım"
    // olayı da bir denetim izi bırakmalıdır. Aksi halde patron "kimi ne zaman
    // sıfırladı?" sorusunun cevabını bulamaz.
    let ctx = AuditContext::new(
        tenant.to_string(),
        actor_id.trim().to_string(),
        actor_role.trim().to_string(),
        category::GUVENLIK,
        eylem,
        tenant.to_string(),
        serde_json::json!({
            "amountCents": yeni_tutar,
            "previousAmountCents": onceki,
            "isDefault": yeni_tutar.is_none(),
            "changed": degisti,
        }),
        chrono::Utc::now().to_rfc3339(),
    )?;
    AuditService::append(conn, audit_lock, &ctx).await?;

    Ok(ThresholdChange {
        amount_cents: yeni_tutar,
        changed: degisti,
    })
}

/// Eşiği okur. Okuma yetkisi: sahip ve müdür.
pub async fn esik_okut(
    conn: &mut SqliteConnection,
    actor_role: &str,
    tenant_id: &str,
) -> Result<ApprovalThresholdDto, String> {
    crate::rbac::require_any(
        actor_role,
        &[crate::rbac::Role::Owner, crate::rbac::Role::Manager],
    )?;

    let tenant = tenant_id.trim();
    if tenant.is_empty() {
        return Err("VALIDATION: Kiracı belirtilmedi.".to_string());
    }

    let tutar = threshold::esik_oku(conn, tenant).await?;
    Ok(ApprovalThresholdDto {
        tenant_id: tenant.to_string(),
        amount_cents: tutar,
        is_default: tutar.is_none(),
    })
}

#[tauri::command]
pub async fn get_approval_threshold(
    actor_role: String,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
) -> Result<ApprovalThresholdDto, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    esik_okut(&mut conn, &actor_role, &tenant_id).await
}

#[tauri::command]
pub async fn set_approval_threshold(
    actor_role: String,
    actor_id: String,
    tenant_id: String,
    amount_cents: i64,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ApprovalThresholdDto, String> {
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    esik_degistir(
        &mut tx,
        &audit_lock,
        &actor_role,
        &actor_id,
        &tenant_id,
        Some(amount_cents),
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    esik_okut(&mut conn, &actor_role, &tenant_id).await
}

#[tauri::command]
pub async fn reset_approval_threshold(
    actor_role: String,
    actor_id: String,
    tenant_id: String,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ApprovalThresholdDto, String> {
    let audit_lock = AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    esik_degistir(
        &mut tx,
        &audit_lock,
        &actor_role,
        &actor_id,
        &tenant_id,
        None,
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    esik_okut(&mut conn, &actor_role, &tenant_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::security360::test_db::bellek;
    use sqlx::Row;

    async fn lock_for<'a>(mutex: &'a tokio::sync::Mutex<()>) -> AuditLock<'a> {
        AuditLock::new(mutex.lock().await)
    }

    #[tokio::test]
    async fn sahip_esik_ayarlayabilir() {
        let mut conn = bellek().await;
        let mutex = tokio::sync::Mutex::new(());
        let lock = lock_for(&mutex).await;

        let sonuc = esik_degistir(
            &mut conn,
            &lock,
            "OWNER",
            "usr_owner",
            "tenant_a",
            Some(250_000),
        )
        .await
        .expect("ayarlanır");

        assert_eq!(sonuc.amount_cents, Some(250_000));
        assert!(sonuc.changed);
        assert_eq!(
            threshold::esik_oku(&mut conn, "tenant_a").await.unwrap(),
            Some(250_000)
        );
    }

    #[tokio::test]
    async fn mudur_ve_kasa_esik_ayarlayamaz() {
        let mut conn = bellek().await;
        let mutex = tokio::sync::Mutex::new(());
        let lock = lock_for(&mutex).await;

        for rol in ["MANAGER", "CASHIER", "WAITER", "MASTER"] {
            let hata = esik_degistir(&mut conn, &lock, rol, "usr_1", "tenant_a", Some(250_000))
                .await
                .expect_err("yetkisiz rol reddedilmeli");
            assert!(!hata.is_empty(), "{rol} için hata metni olmalı");
        }

        // Reddedilen denemeler eşiğe dokunmaz.
        assert_eq!(
            threshold::esik_oku(&mut conn, "tenant_a").await.unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn yetkisiz_deneme_denetim_kaydi_yazmaz() {
        let mut conn = bellek().await;
        let mutex = tokio::sync::Mutex::new(());
        let lock = lock_for(&mutex).await;

        let _ = esik_degistir(
            &mut conn,
            &lock,
            "CASHIER",
            "usr_1",
            "tenant_a",
            Some(1_000),
        )
        .await;

        let adet: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_ledger")
            .fetch_one(&mut conn)
            .await
            .expect("sayılır");
        assert_eq!(adet, 0, "yetkisiz deneme iz bırakmamalı");
    }

    #[tokio::test]
    async fn esik_degistikligi_denetim_kaydi_yazar() {
        let mut conn = bellek().await;
        let mutex = tokio::sync::Mutex::new(());
        let lock = lock_for(&mutex).await;

        esik_degistir(
            &mut conn,
            &lock,
            "OWNER",
            "usr_owner",
            "tenant_a",
            Some(300_000),
        )
        .await
        .expect("ayarlanır");

        let satir = sqlx::query("SELECT action, category, payload FROM audit_ledger")
            .fetch_one(&mut conn)
            .await
            .expect("kayıt okunur");
        let eylem: String = satir.try_get("action").expect("eylem");
        let kategori: String = satir.try_get("category").expect("kategori");
        let payload: String = satir.try_get("payload").expect("payload");

        assert_eq!(eylem, "security:approval_threshold_set");
        assert_eq!(kategori, category::GUVENLIK, "güvenlik olayı GUVENLIK'te");
        assert!(payload.contains("300000"), "payload yeni tutarı taşımalı");
    }

    #[tokio::test]
    async fn ayni_deger_yazilmasi_degisiklik_saymaz_ama_iz_birakir() {
        let mut conn = bellek().await;
        let mutex = tokio::sync::Mutex::new(());
        let lock = lock_for(&mutex).await;

        esik_degistir(
            &mut conn,
            &lock,
            "OWNER",
            "usr_owner",
            "tenant_a",
            Some(300_000),
        )
        .await
        .expect("ayarlanır");
        let ikinci = esik_degistir(
            &mut conn,
            &lock,
            "OWNER",
            "usr_owner",
            "tenant_a",
            Some(300_000),
        )
        .await
        .expect("ayarlanır");

        assert!(!ikinci.changed, "aynı değer değişiklik değildir");

        let adet: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_ledger")
            .fetch_one(&mut conn)
            .await
            .expect("sayılır");
        assert_eq!(adet, 2, "her deneme iz bırakmalı");
    }

    #[tokio::test]
    async fn sifirlama_kaydi_siler_ve_kayit_yoksa_etkisizdir() {
        let mut conn = bellek().await;
        let mutex = tokio::sync::Mutex::new(());
        let lock = lock_for(&mutex).await;

        let etkisiz = esik_degistir(&mut conn, &lock, "OWNER", "usr_owner", "tenant_a", None)
            .await
            .expect("sıfırlama hata vermemeli");
        assert!(!etkisiz.changed, "kayıt yokken sıfırlama etkisizdir");

        esik_degistir(
            &mut conn,
            &lock,
            "OWNER",
            "usr_owner",
            "tenant_a",
            Some(300_000),
        )
        .await
        .expect("ayarlanır");
        let sonuc = esik_degistir(&mut conn, &lock, "OWNER", "usr_owner", "tenant_a", None)
            .await
            .expect("sıfırlanır");
        assert!(sonuc.changed);
        assert_eq!(sonuc.amount_cents, None);
        assert_eq!(
            threshold::esik_oku(&mut conn, "tenant_a").await.unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn okuma_sahip_ve_mudure_acik_kasaya_degil() {
        let mut conn = bellek().await;
        threshold::esik_ayarla(&mut conn, "tenant_a", 100_000)
            .await
            .expect("yazılır");

        for rol in ["OWNER", "MANAGER"] {
            let okunan = esik_okut(&mut conn, rol, "tenant_a").await.expect("okunur");
            assert_eq!(okunan.amount_cents, Some(100_000));
            assert!(!okunan.is_default);
        }

        assert!(esik_okut(&mut conn, "CASHIER", "tenant_a").await.is_err());
    }

    #[tokio::test]
    async fn okuma_kaydi_yoksa_varsayilani_bildirir() {
        let mut conn = bellek().await;
        let okunan = esik_okut(&mut conn, "OWNER", "tenant_a")
            .await
            .expect("okunur");
        assert_eq!(okunan.amount_cents, None, "kayıt yoksa eşik yoktur");
        assert!(okunan.is_default, "arayüz varsayılanı göstermeli");
    }

    #[tokio::test]
    async fn bos_kiraci_kimligi_reddedilir() {
        let mut conn = bellek().await;
        assert!(esik_okut(&mut conn, "OWNER", "   ").await.is_err());
    }

    #[tokio::test]
    async fn kiracilar_arasi_karisma_olmaz() {
        let mut conn = bellek().await;
        let mutex = tokio::sync::Mutex::new(());
        let lock = lock_for(&mutex).await;

        esik_degistir(
            &mut conn,
            &lock,
            "OWNER",
            "usr_owner",
            "tenant_a",
            Some(900_000),
        )
        .await
        .expect("ayarlanır");

        let diger = esik_okut(&mut conn, "OWNER", "tenant_b")
            .await
            .expect("okunur");
        assert_eq!(diger.amount_cents, None, "başka kiracının eşiği etkilemez");
    }
}
