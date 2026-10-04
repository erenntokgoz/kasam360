//! Teknik servis kaydı.
//!
//! Neden ayrı tablo: cihaz/bakım kaydı satışla, envanterle veya cariyle ilişkili
//! değildir. Müşteri borcu ya da stok hareketi üretmez; yalnız işletmenin kendi
//! işleyişini denetler.
//!
//! Yabancı teknisyen hesabı **yoktur** (`users` tablosuna yazılmaz): "teknisyen
//! sisteme girdi" kuralı, rol matrisiyle denetlenebilir olmayan bir kimlik yaratır.
//! Dış teknisyen için `assigned_to` boş bırakılır ve iş kaydı işletme içinde tutulur.

use sqlx::{Row, SqliteConnection};

use super::tenant_zorunlu;
use crate::id_generator::generate_id;

/// Bir kaydın durumunu okur; yoksa hata döner.
async fn kayit_var_mi(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    kayit_id: &str,
) -> Result<(), String> {
    let adet: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM service_tickets WHERE id = ? AND tenant_id = ?")
            .bind(kayit_id.trim())
            .bind(tenant_id)
            .fetch_one(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

    if adet == 0 {
        return Err("Servis kaydı bulunamadı.".to_string());
    }
    Ok(())
}

/// Servis kaydı açar.
#[allow(clippy::too_many_arguments)]
pub async fn kayit_ac(
    conn: &mut SqliteConnection,
    tenant_id: Option<&str>,
    kategori: &str,
    onem: &str,
    baslik: &str,
    aciklama: &str,
    atanan: Option<&str>,
) -> Result<String, String> {
    let kiraci = tenant_zorunlu(tenant_id)?;

    let baslik_temiz = baslik.trim();
    if baslik_temiz.is_empty() {
        return Err("Başlık gerekli.".to_string());
    }
    // Kategori ve aciliyet serbest metin olsaydı ekranda filtrelemek imkânsız
    // olurdu; izin verilen küme burada tek yerde tanımlıdır.
    if !["CIHAZ", "YAZICI", "KASA", "AG", "YAZILIM", "DIGER"].contains(&kategori.trim()) {
        return Err("Geçersiz kategori.".to_string());
    }
    if !["LOW", "MEDIUM", "HIGH", "CRITICAL"].contains(&onem.trim()) {
        return Err("Geçersiz aciliyet.".to_string());
    }

    if let Some(kisi) = atanan {
        atanan_kullanici_var_mi(conn, &kiraci, kisi).await?;
    }

    let id = generate_id("svc");
    sqlx::query(
        "INSERT INTO service_tickets
             (id, tenant_id, category, severity, title, description, assigned_to)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&kiraci)
    .bind(kategori.trim())
    .bind(onem.trim())
    .bind(baslik_temiz)
    .bind(aciklama.trim())
    .bind(atanan.map(str::trim))
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(id)
}

/// Atanan kişi bu işletmenin **aktif** personeli mi?
///
/// Neden ayrı kontrol: `service_tickets.assigned_to` yabancı anahtar tanımlar ama
/// kiracıyı getirmez (SQLite FK tek sütuna bakar). Başka işletmenin personelinin
/// kimliği yazılırsa, işletme "bu arıza X'e verildi" derken başka bir işletmenin
/// personeline haber vermiş olur.
pub async fn atanan_kullanici_var_mi(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    user_id: &str,
) -> Result<(), String> {
    let adet: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users WHERE id = ? AND tenant_id = ? AND is_active = 1",
    )
    .bind(user_id.trim())
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if adet == 0 {
        return Err("Atanacak personel bulunamadı veya pasif.".to_string());
    }
    Ok(())
}

/// Durumu ilerletir.
pub async fn durum_guncelle(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    kayit_id: &str,
    yeni_durum: &str,
) -> Result<(), String> {
    if !["OPEN", "IN_PROGRESS", "WAITING_PARTS", "RESOLVED", "CLOSED"].contains(&yeni_durum.trim())
    {
        return Err("Geçersiz durum.".to_string());
    }
    kayit_var_mi(conn, tenant_id, kayit_id).await?;

    // `resolved_at` yalnızca gerçekten çözüldüğünde yazılır; elle tarih
    // verilemez, çünkü "ne zaman çözüldü" sorusunun tek cevabı kayıt anıdır.
    let etkilenen = sqlx::query(
        "UPDATE service_tickets
         SET status = ?,
             resolved_at = CASE WHEN ? IN ('RESOLVED', 'CLOSED') THEN datetime('now') ELSE NULL END,
             updated_at = datetime('now')
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(yeni_durum.trim())
    .bind(yeni_durum.trim())
    .bind(kayit_id.trim())
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if etkilenen.rows_affected() == 0 {
        return Err("Kayıt güncellenemedi.".to_string());
    }
    Ok(())
}

/// Personel atar.
pub async fn personel_ata(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    kayit_id: &str,
    user_id: Option<&str>,
) -> Result<(), String> {
    if let Some(kisi) = user_id {
        atanan_kullanici_var_mi(conn, tenant_id, kisi).await?;
    }
    kayit_var_mi(conn, tenant_id, kayit_id).await?;

    let etkilenen = sqlx::query(
        "UPDATE service_tickets SET assigned_to = ?, updated_at = datetime('now')
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(user_id.map(str::trim))
    .bind(kayit_id.trim())
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if etkilenen.rows_affected() == 0 {
        return Err("Atama yapılamadı.".to_string());
    }
    Ok(())
}

/// Aciliyete göre açık kayıtları listeler.
pub async fn acik_kayitlar(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<(String, String, String)>, String> {
    let satirlar = sqlx::query(
        "SELECT id, severity, title FROM service_tickets
         WHERE tenant_id = ? AND status NOT IN ('RESOLVED', 'CLOSED')
         ORDER BY CASE severity
                    WHEN 'CRITICAL' THEN 0
                    WHEN 'HIGH' THEN 1
                    WHEN 'MEDIUM' THEN 2
                    ELSE 3 END,
                  created_at",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut liste = Vec::with_capacity(satirlar.len());
    for satir in satirlar {
        liste.push((
            satir.try_get("id").map_err(|e| e.to_string())?,
            satir.try_get("severity").map_err(|e| e.to_string())?,
            satir.try_get("title").map_err(|e| e.to_string())?,
        ));
    }
    Ok(liste)
}

#[cfg(test)]
#[path = "tickets_tests.rs"]
mod tests;
