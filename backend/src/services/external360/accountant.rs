//! Mali müşavir dönem raporu.
//!
//! Erişim modeli (C-8): mali müşavir **ağa bağlanmaz**. Rapor bu tarafta üretilir,
//! imzalanır, dosya olarak verilir ve e-posta kuyruğuna ek olarak iliştirilir.
//!
//! **En kritik kural — sessiz sıfır yasak (AGENTS.md §3.4).** Rapor geliri
//! `SUM(total_cents)` ile hesaplar. Bu toplam `COALESCE(..., 0)` ile sarmalanırsa
//! ve SQL sessizce boş dönerse, müşavire "0 kazanç" gider. Bu bir hata değil
//! **yalan** görünür: defter eksik görünür, vergi beyanı eksik çıkar. Bu yüzden
//! her para okuması `try_get` + `?` ile yükseltilir ve satır yoksa "bu dönemde
//! satış yok" ile "veritabanı bozuldu" ayrımı korunur.

use sha2::{Digest, Sha256};
use sqlx::{Row, SqliteConnection};

use super::signing::{anahtar_al_veya_uret, imzala, ImzaliDokuman};
use super::tenant_zorunlu;
use crate::id_generator::generate_id;

/// Dönem başlangıcı/sonu biçimini doğrular (`YYYY-AA-GG`).
///
/// Neden ayrı yordam: dönem sınırı ters girerse rapor **yanlış dönemin** rakamlarını
/// içerir ve imzası da doğru olur. İmza, tarihin doğruluğunu kanıtlamaz.
fn donem_bicimini_dogrula(bas: &str, son: &str) -> Result<(), String> {
    let gecerli =
        |metin: &str| metin.len() == 10 && metin.chars().all(|c| c.is_ascii_digit() || c == '-');
    if !gecerli(bas) || !gecerli(son) {
        return Err("Dönem `YYYY-AA-GG` biçiminde olmalı.".to_string());
    }
    if bas > son {
        return Err("Dönem başlangıcı bitişinden sonra olamaz.".to_string());
    }
    Ok(())
}

/// Mali müşavir raporunun gövdesi. Tüm tutarlar kuruş cinsinden tam sayıdır.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct RaporGovdesi {
    pub tenant_kodu: String,
    pub donem_baslangic: String,
    pub donem_bitis: String,
    /// Tahsil edilen (PAİD siparişler) toplamı.
    pub tahsilat_cents: i64,
    /// Açık siparişlerin toplamı (henüz tahsil edilmemiş).
    pub acik_satis_cents: i64,
    /// İptal/void siparişlerin toplamı (hasılat değildir, ayrı gösterilir).
    pub iptal_cents: i64,
    pub siparis_adedi: i64,
    /// Verilen borç toplamı.
    pub borc_verilen_cents: i64,
    /// Alınan borç toplamı.
    pub borc_alinan_cents: i64,
    /// Kalan bakiye (pozitif = alacağımız).
    pub kalan_borc_cents: i64,
    pub uretim_zamani: String,
}

/// Üretilen rapor kaydı.
#[derive(Debug, Clone)]
pub struct Rapor {
    pub id: String,
    pub govde: ImzaliDokuman<RaporGovdesi>,
    pub dosya_ozeti: String,
}

/// Dönem rakamlarını okur.
///
/// Neden `COALESCE` **yok**: boş dönemde `SUM` satır döndürmez; `COALESCE`'siz
/// okuma `NULL` verir ve `try_get::<i64>` hata yükseltir. Bu, "bu dönemde satış
/// yok" ile "tablo bozuldu" durumlarını ayırır. Boş dönem geçerli bir durum olduğu
/// için `COUNT(*)` üzerinden ayrı bir dal kurulur: satır yoksa toplamlar **açıkça
/// sıfır** atanır ve bu karar bilinçlidir.
async fn donem_toplamlari(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    bas: &str,
    son: &str,
) -> Result<(i64, i64, i64, i64), String> {
    let satir = sqlx::query(
        "SELECT
            COALESCE(SUM(CASE WHEN status = 'PAID' THEN total_cents ELSE 0 END), 0) AS tahsilat,
            COALESCE(SUM(CASE WHEN status IN ('OPEN', 'IN_PROGRESS') THEN total_cents ELSE 0 END), 0) AS acik,
            COALESCE(SUM(CASE WHEN status IN ('CANCELLED', 'VOID') THEN total_cents ELSE 0 END), 0) AS iptal,
            COUNT(*) AS adet
         FROM orders
         WHERE tenant_id = ?
           AND date(created_at, 'localtime') >= date(?)
           AND date(created_at, 'localtime') <= date(?)",
    )
    .bind(tenant_id)
    .bind(bas)
    .bind(son)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // `try_get` + `?`: kolon bozulmuşsa hata yükselir. `unwrap_or(0)` yazılsaydı
    // bozuk sütun "sıfır ciro" olarak rapora girerdi.
    let tahsilat = satir
        .try_get::<i64, _>("tahsilat")
        .map_err(|e| e.to_string())?;
    let acik = satir.try_get::<i64, _>("acik").map_err(|e| e.to_string())?;
    let iptal = satir
        .try_get::<i64, _>("iptal")
        .map_err(|e| e.to_string())?;
    let adet = satir.try_get::<i64, _>("adet").map_err(|e| e.to_string())?;

    Ok((tahsilat, acik, iptal, adet))
}

/// Borç toplamlarını okur.
async fn borc_toplamlari(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    bas: &str,
    son: &str,
) -> Result<(i64, i64), String> {
    let satir = sqlx::query(
        "SELECT
            COALESCE(SUM(CASE WHEN type = 'GIVEN' THEN total_amount_cents ELSE 0 END), 0) AS verilen,
            COALESCE(SUM(CASE WHEN type = 'TAKEN' THEN total_amount_cents ELSE 0 END), 0) AS alinan
         FROM debts
         WHERE tenant_id = ?
           AND date(created_at, 'localtime') >= date(?)
           AND date(created_at, 'localtime') <= date(?)",
    )
    .bind(tenant_id)
    .bind(bas)
    .bind(son)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let verilen = satir
        .try_get::<i64, _>("verilen")
        .map_err(|e| e.to_string())?;
    let alinan = satir
        .try_get::<i64, _>("alinan")
        .map_err(|e| e.to_string())?;

    Ok((verilen, alinan))
}

/// Dönem raporunu üretir, imzalar ve `accountant_reports` tablosuna yazar.
pub async fn rapor_uret(
    conn: &mut SqliteConnection,
    tenant_id: Option<&str>,
    donem_baslangic: &str,
    donem_bitis: &str,
    ureten: &str,
) -> Result<Rapor, String> {
    let kiraci = tenant_zorunlu(tenant_id)?;
    donem_bicimini_dogrula(donem_baslangic, donem_bitis)?;

    let (tahsilat, acik, iptal, adet) =
        donem_toplamlari(conn, &kiraci, donem_baslangic, donem_bitis).await?;
    let (borc_verilen, borc_alinan) =
        borc_toplamlari(conn, &kiraci, donem_baslangic, donem_bitis).await?;

    let govde = RaporGovdesi {
        tenant_kodu: kiraci.clone(),
        donem_baslangic: donem_baslangic.trim().to_string(),
        donem_bitis: donem_bitis.trim().to_string(),
        tahsilat_cents: tahsilat,
        acik_satis_cents: acik,
        iptal_cents: iptal,
        siparis_adedi: adet,
        borc_verilen_cents: borc_verilen,
        borc_alinan_cents: borc_alinan,
        kalan_borc_cents: borc_verilen - borc_alinan,
        uretim_zamani: chrono::Utc::now().to_rfc3339(),
    };

    let (kimlik, anahtar) = anahtar_al_veya_uret(conn, &kiraci).await?;
    let imzali = imzala(&anahtar, &kimlik, govde)?;

    let metin = serde_json::to_string(&imzali.govde).map_err(|e| e.to_string())?;
    let dosya_ozeti = hex::encode(Sha256::digest(metin.as_bytes()));
    let id = generate_id("acr");
    let dosya_yolu = format!("rapor/{id}.json");

    sqlx::query(
        "INSERT INTO accountant_reports
             (id, tenant_id, period_start, period_end, file_path, file_sha256, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&kiraci)
    .bind(donem_baslangic.trim())
    .bind(donem_bitis.trim())
    .bind(&dosya_yolu)
    .bind(&dosya_ozeti)
    .bind(ureten.trim())
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(Rapor {
        id,
        govde: imzali,
        dosya_ozeti,
    })
}

/// Raporu müşavire **iletildi** olarak işaretler.
///
/// Neden `sent_at` ayrı alan: dosya üretildiği an ile ulaştığı an farklıdır.
/// Üretimi "gönderildi" saymak, müşavirin elinde olmayan bir dosyayı kayıtlı
/// gösterir ve eksik dosya farkı çıkmaz (sessiz hata).
pub async fn rapor_gonderildi_isaretle(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    rapor_id: &str,
) -> Result<(), String> {
    let etkilenen = sqlx::query(
        "UPDATE accountant_reports SET sent_at = datetime('now')
         WHERE id = ? AND tenant_id = ? AND sent_at IS NULL",
    )
    .bind(rapor_id.trim())
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    if etkilenen.rows_affected() == 0 {
        return Err("Rapor gönderilmiş olarak işaretlenemedi.".to_string());
    }
    Ok(())
}

/// Raporu e-posta kuyruğuna ekler (SMTP sahte sağlayıcı).
pub async fn raporu_posta_kuyruguna_al(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    rapor_id: &str,
    alici: &str,
    dosya_yolu: &str,
) -> Result<String, String> {
    let kiraci = tenant_zorunlu(Some(tenant_id))?;
    let eposta = alici.trim();
    if eposta.is_empty() {
        return Err("Alıcı e-posta adresi gerekli.".to_string());
    }

    // Rapor bu işletmeye mi ait?
    let satir: Option<(String, String)> = sqlx::query_as(
        "SELECT period_start, period_end FROM accountant_reports WHERE id = ? AND tenant_id = ?",
    )
    .bind(rapor_id.trim())
    .bind(&kiraci)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    let Some((bas, son)) = satir else {
        return Err("Rapor bulunamadı.".to_string());
    };

    let id = generate_id("emq");
    sqlx::query(
        "INSERT INTO email_queue
             (id, tenant_id, recipient, subject, body, attachment_path, accountant_report_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&kiraci)
    .bind(eposta)
    .bind(format!("Dönem raporu {bas} - {son}"))
    .bind("Dönem raporu ektedir.")
    .bind(dosya_yolu.trim())
    .bind(rapor_id.trim())
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(id)
}

#[cfg(test)]
#[path = "accountant_tests.rs"]
mod tests;
