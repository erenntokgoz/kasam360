//! Outbox dispatcher — harici sistemlere olay teslimatı.
//!
//! `outbox` tablosuna `PENDING` olarak yazılan olaylar (sipariş,
//! ödeme, FIFO parti) bu worker tarafından 30 saniyede bir
//! taranır. Teslimat başarısız olursa kayıt `retry_count` ile
//! yeniden denenir; `MAX_RETRY` üstünde `DEAD_LETTER` durumuna
//! düşer ve kaybolmaz (AGENTS.md §2: audit zinciri gibi,
//! outbox da sessiz kaybolan bir olay akışı değildir).
//!
//! Neden servis katmanı: dispatcher `tauri::State` taşımadan
//! sınanabilir; worker döngüsü (`spawn_outbox_worker`) üretim
//! sürecinde bir kez başlatılır, testlerde doğrudan
//! `dispatch_pending` tetiklenir.

use std::future::Future;
use std::time::Duration;

use sqlx::Row;

use crate::db::DbPool;

/// Başarısız deneme üstünde kayıt ölü mektup kutusuna düşer.
pub const MAX_RETRY: i64 = 3;

/// Worker tetikleme aralığı (saniye).
pub const DISPATCH_INTERVAL_SN: u64 = 30;

/// Bir teslimat çağrısının üst sınırı (saniye).
///
/// Neden zorunlu: AGENTS.md §3.1 — donanım/harici çağrılar
/// bloke edici olmamalıdır; 2 sn'yi aşan teslimat zaman aşımı
/// sayılır ve sonraki turda yeniden denenir.
const ZAMAN_ASIMI_SN: u64 = 2;

/// Bir dispatcher turunun özeti.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct DispathOzeti {
    /// Bu turda ele alınan PENDING kayıt sayısı.
    pub islenen: usize,
    /// Başarıyla teslim edilen sayısı.
    pub teslim_edilen: usize,
    /// Hatalı ama henüz `DEAD_LETTER` olmayan sayısı.
    pub yeniden_denenecek: usize,
    /// Bu turda ölü mektup kutusuna düşen sayısı.
    pub soluk_ileti: usize,
}

/// Bir outbox olayının teslimat sonucu.
pub type DispatchSonucu = Result<(), String>;

/// PENDING outbox kayıtlarını sırayla teslim eder.
///
/// Sıralama `created_at ASC, id ASC` — FIFO: eski olaylar
/// önce teslim edilir. Kiracı filtresi **yok**: dispatcher
/// platform seviyesinde çalışır ve her kiracının kendi
/// olaylarını kendi harici sistemine iletir; kiracı kimliği
/// teslimat kapatıcısına iletilir.
///
/// Tek kaydın teslimat hatası turu durdurmaz: hata kayda
/// `last_error` olarak yazılır ve sonraki turda yeniden
/// denenir. Şema/okuma hataları ise yükseltilir — sessiz
/// başarısızlık yasaktır (AGENTS.md §3.4).
pub async fn dispatch_pending<F, Fut>(
    pool: &DbPool,
    mut dispatch: F,
) -> Result<DispathOzeti, String>
where
    F: FnMut(&str, &str) -> Fut,
    Fut: Future<Output = DispatchSonucu>,
{
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let satirlar = sqlx::query(
        "SELECT id, tenant_id, event_id FROM outbox
         WHERE status = 'PENDING'
         ORDER BY created_at ASC, id ASC",
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut ozet = DispathOzeti::default();
    for satir in satirlar {
        ozet.islenen += 1;
        // Kolon okumaları `?` ile yükseltilir: kolon eksikse
        // satır sessizce atlanmaz, hata bildirilir (§3.4).
        let id: String = satir.try_get("id").map_err(|e| e.to_string())?;
        let kiraci: String = satir.try_get("tenant_id").map_err(|e| e.to_string())?;
        let olay: String = satir.try_get("event_id").map_err(|e| e.to_string())?;

        let teslimat = tokio::time::timeout(
            Duration::from_secs(ZAMAN_ASIMI_SN),
            dispatch(&kiraci, &olay),
        )
        .await;

        match teslimat {
            Ok(Ok(())) => {
                sqlx::query(
                    "UPDATE outbox SET status = 'DISPATCHED',
                         dispatched_at = datetime('now'), last_error = NULL
                     WHERE id = ?",
                )
                .bind(&id)
                .execute(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
                ozet.teslim_edilen += 1;
            }
            Ok(Err(hata)) => {
                yenile_veya_soluk_ileti(&mut conn, &id, &hata, &mut ozet).await?;
            }
            Err(_zaman_asimi) => {
                let hata = format!("ZAMAN_ASIMI: teslimat {} saniyeyi aştı", ZAMAN_ASIMI_SN);
                yenile_veya_soluk_ileti(&mut conn, &id, &hata, &mut ozet).await?;
            }
        }
    }
    Ok(ozet)
}

/// Başarısız teslimatı kaydeder: retry sayacını artırır,
/// üst sınırda kaydı `DEAD_LETTER` durumuna düşürür.
async fn yenile_veya_soluk_ileti(
    conn: &mut sqlx::SqliteConnection,
    id: &str,
    hata: &str,
    ozet: &mut DispathOzeti,
) -> Result<(), String> {
    let yeni: i64 = sqlx::query_scalar(
        "UPDATE outbox SET retry_count = retry_count + 1,
             last_error = ?
         WHERE id = ?
         RETURNING retry_count",
    )
    .bind(hata)
    .bind(id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if yeni >= MAX_RETRY {
        sqlx::query("UPDATE outbox SET status = 'DEAD_LETTER' WHERE id = ?")
            .bind(id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        ozet.soluk_ileti += 1;
    } else {
        ozet.yeniden_denenecek += 1;
    }
    Ok(())
}

/// 30 saniyede bir PENDING outbox'ı taramak üzere arka plan
/// işçisini başlatır.
///
/// Neden ayrı iş: dispatcher Tauri komutlarından bağımsız
/// çalışır — uygulama başlatılır başlatılmaz teslimat kuyruğu
/// boşaltılır. Hata döngüyü kıraca değildir:tek tur hatalıysa
/// günlüğe yazılır, sonraki tur yeniden denenir.
pub fn spawn_outbox_worker(pool: DbPool) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut aralik = tokio::time::interval(Duration::from_secs(DISPATCH_INTERVAL_SN));
        loop {
            aralik.tick().await;
            let ozet = dispatch_pending(&pool, |kiraci, olay| {
                let kiraci = kiraci.to_string();
                let olay = olay.to_string();
                async move {
                    // Yerel ön uç: olay yapılandırılmış günlüğe
                    // işlenir. Gerçek bir harici uç (QR menü,
                    // muhasebe) eklenince bu kapatıcı değiştirilir;
                    // retry/dead_letter sözleşmesi aynı kalır.
                    eprintln!(
                        "[INFO] outbox::dispatcher: teslim edildi kiraci={kiraci} olay={olay}"
                    );
                    Ok(())
                }
            })
            .await;
            match ozet {
                Ok(ozet) if ozet.islenen > 0 => {
                    eprintln!(
                        "[INFO] outbox::dispatcher: tur islenen={} teslim={} retry={} soluk_ileti={}",
                        ozet.islenen, ozet.teslim_edilen,
                        ozet.yeniden_denenecek, ozet.soluk_ileti
                    );
                }
                Ok(_) => {}
                Err(hata) => {
                    eprintln!("[WARN] outbox::dispatcher: tur hatasi: {hata}");
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;
    use uuid::Uuid;

    async fn havuz() -> DbPool {
        let secenek = SqliteConnectOptions::from_str("sqlite::memory:")
            .expect("gecerli secenekler")
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(secenek)
            .await
            .expect("havuz acilir");
        sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
            .execute(&pool)
            .await
            .expect("sema uygulanir");
        pool
    }

    /// Olay ve ona bağlı `PENDING` outbox satırı yazar;
    /// outbox kimliğini döner.
    async fn olay_yaz(pool: &DbPool, kiraci: &str, olay: &str) -> String {
        let mut conn = pool.acquire().await.expect("baglanti");
        sqlx::query(
            "INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload)
             VALUES (?, ?, 'agg_1', 'order', 'test', '{}')",
        )
        .bind(olay)
        .bind(kiraci)
        .execute(&mut *conn)
        .await
        .expect("olay yazilir");
        let id = format!("outbox_{}", Uuid::new_v4());
        sqlx::query(
            "INSERT INTO outbox (id, tenant_id, event_id, status, created_at)
             VALUES (?, ?, ?, 'PENDING', datetime('now'))",
        )
        .bind(&id)
        .bind(kiraci)
        .bind(olay)
        .execute(&mut *conn)
        .await
        .expect("outbox yazilir");
        id
    }

    /// Kaydın (durum, retry sayısı, son hata) üçlüsünü okur.
    async fn kayit(pool: &DbPool, id: &str) -> (String, i64, Option<String>) {
        let mut conn = pool.acquire().await.expect("baglanti");
        let satir = sqlx::query("SELECT status, retry_count, last_error FROM outbox WHERE id = ?")
            .bind(id)
            .fetch_one(&mut *conn)
            .await
            .expect("satir okunur");
        (
            satir.try_get("status").expect("durum okunur"),
            satir.try_get("retry_count").expect("sayaç okunur"),
            satir.try_get("last_error").expect("hata okunur"),
        )
    }

    /// T1: PENDING kayıt teslim edilir ve işaretlenir.
    #[tokio::test]
    async fn pending_olay_teslim_edilir() {
        let pool = havuz().await;
        let id = olay_yaz(&pool, "tnt_a", "evt_1").await;

        let ozet = dispatch_pending(&pool, |_, _| async { Ok(()) })
            .await
            .expect("tur");

        assert_eq!(ozet.islenen, 1);
        assert_eq!(ozet.teslim_edilen, 1);
        let (durum, _, hata) = kayit(&pool, &id).await;
        assert_eq!(durum, "DISPATCHED");
        assert!(hata.is_none(), "temiz teslimatta hata kalmamalı: {hata:?}");
    }

    /// T2: Başarısız teslimat retry sayacını artırır ve
    /// kayıt PENDING kalır (sonraki turda yeniden denenir).
    #[tokio::test]
    async fn hata_retry_sayacini_artirir() {
        let pool = havuz().await;
        let id = olay_yaz(&pool, "tnt_a", "evt_2").await;

        let ozet = dispatch_pending(&pool, |_, _| async {
            Err("bağlantı kurulamadı".to_string())
        })
        .await
        .expect("tur");

        assert_eq!(ozet.yeniden_denenecek, 1);
        assert_eq!(ozet.soluk_ileti, 0);
        let (durum, sayac, hata) = kayit(&pool, &id).await;
        assert_eq!(durum, "PENDING", "retry sonrası kuyrukta kalmalı");
        assert_eq!(sayac, 1);
        assert_eq!(hata.as_deref(), Some("bağlantı kurulamadı"));
    }

    /// T3: `MAX_RETRY` başarısız denemeden sonra kayıt
    /// `DEAD_LETTER` durumuna düşer ve artık taranmaz.
    #[tokio::test]
    async fn uc_hatali_deneme_soluk_ileti_olur() {
        let pool = havuz().await;
        let id = olay_yaz(&pool, "tnt_a", "evt_3").await;

        for _ in 0..MAX_RETRY {
            let ozet = dispatch_pending(&pool, |_, _| async { Err("svc down".to_string()) })
                .await
                .expect("tur");
            assert!(ozet.islenen >= 1);
        }

        let (durum, sayac, hata) = kayit(&pool, &id).await;
        assert_eq!(durum, "DEAD_LETTER");
        assert_eq!(sayac, MAX_RETRY);
        assert_eq!(hata.as_deref(), Some("svc down"));

        // Ölü mektup kutusundaki kayıt bir daha taranmaz.
        let ozet = dispatch_pending(&pool, |_, _| async { Ok(()) })
            .await
            .expect("tur");
        assert_eq!(ozet.islenen, 0);
    }

    /// T4: Teslim edilmiş kayıt sonraki turda tekrar işlenmez
    /// (idempotent tur).
    #[tokio::test]
    async fn teslim_edilen_tekrar_islenmez() {
        let pool = havuz().await;
        let id = olay_yaz(&pool, "tnt_a", "evt_4").await;

        dispatch_pending(&pool, |_, _| async { Ok(()) })
            .await
            .expect("birinci tur");

        let mut cagrim = 0usize;
        let ozet = dispatch_pending(&pool, |_, _| {
            cagrim += 1;
            async { Ok(()) }
        })
        .await
        .expect("ikinci tur");

        assert_eq!(ozet.islenen, 0);
        assert_eq!(cagrim, 0, "DISPATCHED kayıt sink'e ulaşmamalı");
        let (durum, _, _) = kayit(&pool, &id).await;
        assert_eq!(durum, "DISPATCHED");
    }

    /// T5: Boş outbox sessiz geçer; hata üretmez.
    #[tokio::test]
    async fn bos_outbox_sessiz_gecirir() {
        let pool = havuz().await;
        let ozet = dispatch_pending(&pool, |_, _| async { Ok(()) })
            .await
            .expect("tur");
        assert_eq!(ozet, DispathOzeti::default());
    }

    /// T6: Farklı kiracıların olayları aynı turda, sırayla
    /// işlenir (kiracı filtresi yok — dispatcher platform
    /// seviyesindedir).
    #[tokio::test]
    async fn kiracilar_birligde_islenir() {
        let pool = havuz().await;
        let id_a = olay_yaz(&pool, "tnt_a", "evt_a").await;
        let id_b = olay_yaz(&pool, "tnt_b", "evt_b").await;

        let mut gorulen: Vec<String> = Vec::new();
        let ozet = dispatch_pending(&pool, |kiraci, _| {
            gorulen.push(kiraci.to_string());
            async { Ok(()) }
        })
        .await
        .expect("tur");

        assert_eq!(ozet.teslim_edilen, 2);
        assert!(gorulen.contains(&"tnt_a".to_string()));
        assert!(gorulen.contains(&"tnt_b".to_string()));
        assert_eq!(gorulen.len(), 2, "her kayıt bir kez teslim edilir");
        let (durum_a, _, _) = kayit(&pool, &id_a).await;
        let (durum_b, _, _) = kayit(&pool, &id_b).await;
        assert_eq!(durum_a, "DISPATCHED");
        assert_eq!(durum_b, "DISPATCHED");
    }

    /// T7: Geçici hata sonrası sonraki tur başarılı olursa
    /// kayıt teslim edilir; retry sayısı geçmiş olarak kalır.
    #[tokio::test]
    async fn retry_sonraki_turde_basarili_olur() {
        let pool = havuz().await;
        let id = olay_yaz(&pool, "tnt_a", "evt_7").await;

        dispatch_pending(&pool, |_, _| async { Err("geçici".to_string()) })
            .await
            .expect("birinci tur");
        dispatch_pending(&pool, |_, _| async { Err("geçici".to_string()) })
            .await
            .expect("ikinci tur");

        let ozet = dispatch_pending(&pool, |_, _| async { Ok(()) })
            .await
            .expect("üçüncü tur");

        assert_eq!(ozet.teslim_edilen, 1);
        let (durum, sayac, hata) = kayit(&pool, &id).await;
        assert_eq!(durum, "DISPATCHED");
        assert_eq!(sayac, 2, "retry geçmişi korunur");
        assert!(hata.is_none());
    }
}
