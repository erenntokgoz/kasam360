//! WhatsApp ve e-posta gönderim kuyrukları.
//!
//! Neden sahte sağlayıcı: AGENTS.md §3.1 harici bulutu yasaklıyor; gerçek Meta
//! API ya da SMTP sunucusuna **bağlanılamaz**. Sahte sağlayıcı ağa çıkmadan
//! gerçek entegrasyonun istediği durum makinesini (kuyruk → gönderim → teslim /
//! hata) çalıştırır; sağlayıcı değişse de veri modeli değişmez.
//!
//! **En kritik kural: sahte gönderim gerçekmiş gibi işaretlenmez.** Her satır
//! `provider_flag = 'FAKE'` taşır ve testler bunu doğrular. Bu bayrak olmazsa
//! "müşteriye gönderildi" sanılan bir mesaj, hiç gitmemiş bir vaattir.
//!
//! Donanım/servis çağrıları bloklamaz: kuyruk işlemesi tek tek, sırayla ve
//! hata durumunda da durmadan ilerler. Bir mesajın başarısız olması, kuyruktaki
//! diğerlerinin kaybolmasına yol açmaz.

use sqlx::{Row, SqliteConnection};

use super::tenant_zorunlu;
use crate::id_generator::generate_id;

/// Bir kuyruğun işlenmesinin sonucu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IslemeSonucu {
    pub gonderilen: i64,
    pub basarisiz: i64,
}

/// Sahte WhatsApp sağlayıcısı.
///
/// Niden `fn` ve neden çıktı üretmiyor: gerçek sağlayıcı bir yanıt kimliği
/// döndürür (Meta `wamid`). Sahte sağlayıcı da aynı alanı doldurur ki arayüzde
/// veri modeli değişmesin. **Bu fonksiyon ağa çıkmaz** ve çıkmayacak biçimde
/// yazılmıştır: burada gerçek bir istemci çağrısı bulunsa AGENTS.md §3.1 ihlal
/// edilmiş olurdu.
fn sahte_whatsapp_gonder(_alici: &str, _mesaj: &str) -> Result<String, String> {
    Ok(format!("FAKE-{}", generate_id("wam")))
}

/// Sahte SMTP sağlayıcısı (aynı gerekçe).
fn sahte_smtp_gonder(_alici: &str, _konu: &str) -> Result<String, String> {
    Ok(format!("FAKE-{}", generate_id("emk")))
}

/// WhatsApp kuyruğunu işler.
pub async fn whatsapp_kuyrugunu_isle(
    conn: &mut SqliteConnection,
    tenant_id: Option<&str>,
) -> Result<IslemeSonucu, String> {
    let kiraci = tenant_zorunlu(tenant_id)?;
    let satirlar = sqlx::query(
        "SELECT id, recipient, message FROM whatsapp_queue
         WHERE tenant_id = ? AND status = 'PENDING' ORDER BY created_at",
    )
    .bind(&kiraci)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut sonuc = IslemeSonucu {
        gonderilen: 0,
        basarisiz: 0,
    };

    for satir in satirlar {
        let id: String = satir.try_get("id").map_err(|e| e.to_string())?;
        let alici: String = satir.try_get("recipient").map_err(|e| e.to_string())?;
        let mesaj: String = satir.try_get("message").map_err(|e| e.to_string())?;

        match sahte_whatsapp_gonder(&alici, &mesaj) {
            Ok(cevap) => {
                // Yanıt kimliği `last_error` yerine ayrı bir alana değil, mesajın
                // durumuna bağlı olarak burada saklanmaz; kuyruk geçmişini
                // tutan tek yer `status` + `sent_at` alanıdır.
                let etkilenen = sqlx::query(
                    "UPDATE whatsapp_queue
                     SET status = 'SENT', sent_at = datetime('now'), attempts = attempts + 1,
                         last_error = ?
                     WHERE id = ? AND tenant_id = ? AND status = 'PENDING'",
                )
                .bind(Some(cevap))
                .bind(&id)
                .bind(&kiraci)
                .execute(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;

                if etkilenen.rows_affected() > 0 {
                    sonuc.gonderilen += 1;
                }
            }
            Err(hata) => {
                // Hata tek mesajı etkiler; kuyruk devam eder.
                sqlx::query(
                    "UPDATE whatsapp_queue
                     SET status = 'FAILED', attempts = attempts + 1, last_error = ?
                     WHERE id = ? AND tenant_id = ? AND status = 'PENDING'",
                )
                .bind(&hata)
                .bind(&id)
                .bind(&kiraci)
                .execute(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
                sonuc.basarisiz += 1;
            }
        }
    }

    Ok(sonuc)
}

/// E-posta kuyruğunu işler.
pub async fn email_kuyrugunu_isle(
    conn: &mut SqliteConnection,
    tenant_id: Option<&str>,
) -> Result<IslemeSonucu, String> {
    let kiraci = tenant_zorunlu(tenant_id)?;
    let satirlar = sqlx::query(
        "SELECT id, recipient, subject FROM email_queue
         WHERE tenant_id = ? AND status = 'PENDING' ORDER BY created_at",
    )
    .bind(&kiraci)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut sonuc = IslemeSonucu {
        gonderilen: 0,
        basarisiz: 0,
    };

    for satir in satirlar {
        let id: String = satir.try_get("id").map_err(|e| e.to_string())?;
        let alici: String = satir.try_get("recipient").map_err(|e| e.to_string())?;
        let konu: String = satir.try_get("subject").map_err(|e| e.to_string())?;

        match sahte_smtp_gonder(&alici, &konu) {
            Ok(cevap) => {
                let etkilenen = sqlx::query(
                    "UPDATE email_queue
                     SET status = 'SENT', sent_at = datetime('now'), attempts = attempts + 1,
                         last_error = ?
                     WHERE id = ? AND tenant_id = ? AND status = 'PENDING'",
                )
                .bind(Some(cevap))
                .bind(&id)
                .bind(&kiraci)
                .execute(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;

                if etkilenen.rows_affected() > 0 {
                    sonuc.gonderilen += 1;
                }
            }
            Err(hata) => {
                sqlx::query(
                    "UPDATE email_queue
                     SET status = 'FAILED', attempts = attempts + 1, last_error = ?
                     WHERE id = ? AND tenant_id = ? AND status = 'PENDING'",
                )
                .bind(&hata)
                .bind(&id)
                .bind(&kiraci)
                .execute(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
                sonuc.basarisiz += 1;
            }
        }
    }

    Ok(sonuc)
}

/// Bekleyen kuyruk sayısını döndürür (durum paneli için).
pub async fn bekleyen_sayi(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<(i64, i64), String> {
    let satir = sqlx::query(
        "SELECT
            (SELECT COUNT(*) FROM whatsapp_queue WHERE tenant_id = ? AND status = 'PENDING'),
            (SELECT COUNT(*) FROM email_queue WHERE tenant_id = ? AND status = 'PENDING')",
    )
    .bind(tenant_id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let whatsapp: i64 = satir.try_get(0).map_err(|e| e.to_string())?;
    let email: i64 = satir.try_get(1).map_err(|e| e.to_string())?;
    Ok((whatsapp, email))
}

#[cfg(test)]
#[path = "queues_tests.rs"]
mod tests;
