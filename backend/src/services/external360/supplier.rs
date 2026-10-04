//! Tedarikçiye giden talep ve tedarikçi dosya takası.
//!
//! Erişim modeli (C-8): tedarikçi **ağa bağlanmaz**. Talep bu tarafta oluşturulur,
//! imzalı dosya olarak dışa aktarılır veya WhatsApp kuyruğuna girer; tedarikçinin
//! cevabı da imzalı dosya olarak içe alınır.
//!
//! Neden `suppliers` tablosu yeniden yazılmadı: tedarikçi tanımı zaten
//! `inventory360/suppliers` tarafında yaşıyor. İkinci bir tablo iki gerçek üretirdi
//! ve fiyat karşılaştırma hangi tedarikçiye baktığını bilemezdi.
//!
//! Fiyat kuralı: talep **fiyat taşımaz**. Tedarikçi fiyatı bildirir (karşılaştırma
//! ekranı), kararı personel verir. Tedarikçinin yazdığı fiyatı otomatik kabul etmek
//! stok maliyetini ve P&L'ı değiştirirdi (AGENTS.md §2 para kaynağı).

use sqlx::{Row, SqliteConnection};

use super::signing::{anahtar_al_veya_uret, dogrula, imzala, ImzaliDokuman};
use super::tenant_zorunlu;
use crate::id_generator::generate_id;

/// Tedarikçiye gönderilen talep.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct TedarikciTalebi {
    pub talep_id: String,
    pub tenant_kodu: String,
    pub tedarikci_id: String,
    pub tedarikci_adi: String,
    /// `[{ "product_id": "...", "qty": 10 }]` — fiyat **yok**.
    pub urunler: String,
    pub not_: String,
    pub olusturma_zamani: String,
}

/// Talep oluşturur (durum: taslak).
pub async fn talep_olustur(
    conn: &mut SqliteConnection,
    tenant_id: Option<&str>,
    supplier_id: &str,
    urunler: &str,
    not_: &str,
) -> Result<String, String> {
    let kiraci = tenant_zorunlu(tenant_id)?;
    tedarikci_var_mi(conn, &kiraci, supplier_id).await?;
    urun_govdesini_sinirla(urunler)?;

    let id = generate_id("spo");
    sqlx::query(
        "INSERT INTO supplier_orders (id, tenant_id, supplier_id, items, note)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&kiraci)
    .bind(supplier_id.trim())
    .bind(urunler.trim())
    .bind(not_.trim())
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(id)
}

/// Tedarikçi bu işletmeye mi ait?
///
/// Neden ayrı kontrol: `supplier_orders.supplier_id` yabancı anahtar tanımlar ama
/// kiracıyı **getirmez** (SQLite FK'si tek sütuna bakar). Başka işletmenin
/// tedarikçisine talep açmak, o tedarikçinin fiyatının bu işletmeye sızmasıdır.
pub async fn tedarikci_var_mi(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    supplier_id: &str,
) -> Result<(), String> {
    let satir: Option<String> =
        sqlx::query_scalar("SELECT id FROM suppliers WHERE id = ? AND tenant_id = ?")
            .bind(supplier_id.trim())
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

    if satir.is_none() {
        return Err("Tedarikçi bulunamadı.".to_string());
    }
    Ok(())
}

/// Ürün listesini doğrular.
fn urun_govdesini_sinirla(urunler: &str) -> Result<(), String> {
    let cozulmus: serde_json::Value =
        serde_json::from_str(urunler).map_err(|_| "Ürün listesi okunamadı.".to_string())?;
    let dizi = cozulmus
        .as_array()
        .ok_or_else(|| "Ürün listesi olmalı.".to_string())?;
    if dizi.is_empty() {
        return Err("Ürün listesi boş olamaz.".to_string());
    }
    for oge in dizi {
        if oge.get("product_id").and_then(|v| v.as_str()).is_none() {
            return Err("Her ürünün `product_id` alanı olmalı.".to_string());
        }
        let adet = oge.get("qty").and_then(|v| v.as_i64()).unwrap_or(1);
        if adet <= 0 {
            return Err("Ürün adedi sıfırdan büyük olmalı.".to_string());
        }
        if oge.get("price_cents").is_some() {
            return Err("Tedarikçi talebi fiyat içeremez.".to_string());
        }
    }
    Ok(())
}

/// Talebi okur.
pub async fn talep_getir(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    talep_id: &str,
) -> Result<TedarikciTalebi, String> {
    let satir = sqlx::query(
        "SELECT s.id, s.tenant_id, s.supplier_id, sup.name AS tedarikci_adi,
                s.items, s.note, s.created_at
         FROM supplier_orders s
         JOIN suppliers sup ON sup.id = s.supplier_id AND sup.tenant_id = s.tenant_id
         WHERE s.id = ? AND s.tenant_id = ?",
    )
    .bind(talep_id.trim())
    .bind(tenant_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let satir = satir.ok_or_else(|| "Talep bulunamadı.".to_string())?;
    Ok(TedarikciTalebi {
        talep_id: satir.try_get("id").map_err(|e| e.to_string())?,
        tenant_kodu: satir.try_get("tenant_id").map_err(|e| e.to_string())?,
        tedarikci_id: satir.try_get("supplier_id").map_err(|e| e.to_string())?,
        tedarikci_adi: satir.try_get("tedarikci_adi").map_err(|e| e.to_string())?,
        urunler: satir.try_get("items").map_err(|e| e.to_string())?,
        not_: satir.try_get("note").map_err(|e| e.to_string())?,
        olusturma_zamani: satir.try_get("created_at").map_err(|e| e.to_string())?,
    })
}

/// Talebi imzalı dosya olarak dışa aktarır.
pub async fn talep_disa_aktar(
    conn: &mut SqliteConnection,
    tenant_id: Option<&str>,
    talep_id: &str,
) -> Result<ImzaliDokuman<TedarikciTalebi>, String> {
    let kiraci = tenant_zorunlu(tenant_id)?;
    let (kimlik, anahtar) = anahtar_al_veya_uret(conn, &kiraci).await?;
    let talep = talep_getir(conn, &kiraci, talep_id).await?;

    imzala(&anahtar, &kimlik, talep)
}

/// Tedarikçinin imzalı cevabını içe alır.
///
/// Neden imza zorunlu: dosya elle taşınır. İmzasız bir cevap dosyası kabul
/// edilirse, "bu tedarikçi 120 kuruş istiyor" satırını **herhangi biri**
/// yazabilir ve stok maliyeti o rakamla güncellenir.
pub async fn cevap_ice_al(
    conn: &mut SqliteConnection,
    tenant_id: Option<&str>,
    dokuman: &ImzaliDokuman<TedarikciTalebi>,
) -> Result<(), String> {
    let kiraci = tenant_zorunlu(tenant_id)?;
    let (kimlik, anahtar) = anahtar_al_veya_uret(conn, &kiraci).await?;
    let cevap = dogrula(&anahtar, &kimlik, dokuman)?;

    // Talep yine de bu işletmeye mi ait?
    let var = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM supplier_orders WHERE id = ? AND tenant_id = ?",
    )
    .bind(&cevap.talep_id)
    .bind(&kiraci)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if var == 0 {
        return Err("Talep bulunamadı.".to_string());
    }

    sqlx::query(
        "UPDATE supplier_orders SET status = 'DELIVERED', updated_at = datetime('now')
         WHERE id = ? AND tenant_id = ?",
    )
    .bind(&cevap.talep_id)
    .bind(&kiraci)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Talebi WhatsApp kuyruğuna alır.
///
/// Neden kuyruk: AGENTS.md §3.1 harici bulutu yasaklıyor. Kuyruk, gerçek
/// sağlayıcının istediği durum makinesini (kuyruk → gönderim → teslim) sahte
/// sağlayıcıyla bugünden test edilebilir kılar.
///
/// Neden önce durum kontrolü: kuyruk satırı `UPDATE`'den **önce** yazılır. Durum
/// kontrolü yapılmazsa iptal edilmiş bir talep kuyruğa girer, `UPDATE` 0 satır
/// etkiler ve çağıran **başarı** görür — sessiz bir kayıp. Bu, AGENTS.md §3.4'ün
/// "sıfıra düşen hata" sınıfıdır: iş yapılmadı ama yapıldı sanılır.
pub async fn talep_kuyruga_al(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    talep_id: &str,
) -> Result<String, String> {
    let talep = talep_getir(conn, tenant_id, talep_id).await?;

    let durum: String =
        sqlx::query_scalar("SELECT status FROM supplier_orders WHERE id = ? AND tenant_id = ?")
            .bind(talep_id.trim())
            .bind(tenant_id)
            .fetch_one(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    if durum != "DRAFT" {
        return Err(format!(
            "Talep yalnızca taslaktan kuyruğa alınabilir (durum: {durum})."
        ));
    }

    let alici = sqlx::query_scalar::<_, Option<String>>(
        "SELECT phone FROM suppliers WHERE id = ? AND tenant_id = ?",
    )
    .bind(&talep.tedarikci_id)
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Tedarikçi telefon numarası yok.".to_string())?;

    let mesaj = format!(
        "Sipariş talebi ({}): {}{}",
        talep.talep_id,
        talep.urunler,
        if talep.not_.is_empty() {
            String::new()
        } else {
            format!(" — {}", talep.not_)
        }
    );

    let kuyruk_id = generate_id("waq");
    sqlx::query(
        "INSERT INTO whatsapp_queue (id, tenant_id, recipient, message, supplier_order_id)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&kuyruk_id)
    .bind(tenant_id)
    .bind(alici.trim())
    .bind(&mesaj)
    .bind(talep_id.trim())
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let etkilenen = sqlx::query(
        "UPDATE supplier_orders
         SET status = 'QUEUED', whatsapp_message_id = ?, updated_at = datetime('now')
         WHERE id = ? AND tenant_id = ? AND status = 'DRAFT'",
    )
    .bind(&kuyruk_id)
    .bind(talep_id.trim())
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if etkilenen.rows_affected() == 0 {
        return Err("Talep durumu değişti; kuyruğa alınamadı.".to_string());
    }

    Ok(kuyruk_id)
}

/// Talebi iptal eder.
///
/// Neden `rows_affected` denetimi: olmayan ya da zaten kapanmış bir talep için
/// "başarılı" dönmek, arayüzde "iptal edildi" yazıp gerçekte hiçbir şey
/// değiştirmemek demektir.
pub async fn talep_iptal(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    talep_id: &str,
) -> Result<(), String> {
    let etkilenen = sqlx::query(
        "UPDATE supplier_orders SET status = 'CANCELLED', updated_at = datetime('now')
         WHERE id = ? AND tenant_id = ? AND status IN ('DRAFT', 'QUEUED')",
    )
    .bind(talep_id.trim())
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if etkilenen.rows_affected() == 0 {
        return Err("Talep iptal edilemedi: bulunamadı veya zaten kapandı.".to_string());
    }
    Ok(())
}

#[cfg(test)]
#[path = "supplier_tests.rs"]
mod tests;
