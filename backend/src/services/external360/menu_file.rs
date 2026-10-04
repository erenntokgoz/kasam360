//! QR menü **dosyası**: menü belgesi, imzalı JSON ve tek dosya HTML.
//!
//! Neden ayrı dosya: `qr_menu.rs` oturum + talep + geri bildirim ile 500 satır
//! tavanını aşıyordu. Menü üretimi ayrı bir sorumluluktur (ürün kataloğunu okur,
//! imzalar, iki biçime çevirir) ve talep akışıyla aynı yaşam döngüsü yoktur.
//!
//! Erişim modeli (C-8): müşteri **ağa bağlanmaz**. Bu modülün çıktısı tek başına
//! bir dosyadır; HTML'de harici varlık (resim, betik) referansı yoktur, böylece
//! müşterinin tarayıcısı hiçbir sunucuya gitmeden menüyü görüntüler.

use sqlx::{Row, SqliteConnection};

use super::signing::{anahtar_al_veya_uret, imzala, ImzaliDokuman};
use super::tenant_zorunlu;

/// Menüde yayınlanan tek ürün.
///
/// Neden `fiyat_cents`: menüde gösterilen fiyat **gerçek** fiyattır (menü zaten
/// herkese açık), bu yüzden burada kuruş cinsinden tam sayı olması doğru olan
/// şey. Müşteri *talebinde* ise fiyat bulunmaz; bkz. `qr_menu` modül başlığı.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct MenuOgesi {
    pub urun_id: String,
    pub ad: String,
    pub aciklama: String,
    pub fiyat_cents: i64,
    pub kategori: String,
}

/// İmzalı menü belgesi.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct MenuBelgesi {
    pub tenant_kodu: String,
    pub uretim_zamani: String,
    pub ogeler: Vec<MenuOgesi>,
}

/// Müşteriye verilecek menü dosyası.
///
/// Neden iki biçim birlikte: JSON dosya **makine** içindir (doğrulama, içe
/// aktarma), HTML dosya **müşteri** içindir. İmza ikisinde de aynıdır; müşteri
/// dosyayı düzenlerse imza geçersizleşir ve işletme farkı görür.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ImzaliMenuCiktisi {
    pub json: String,
    pub html: String,
    pub imza: String,
    pub key_id: String,
}

/// Yayınlanan menüyü okur.
///
/// `is_active = 0` **veya** `is_86 = 1` olan ürünler dışarıda: 86 olan ürün
/// ("stok bitti, menüden kalktı") hâlâ `is_active` göstergesi taşısa da
/// müşteriye gösterilmemelidir.
pub async fn menu_ogeleri(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<MenuOgesi>, String> {
    let satirlar = sqlx::query(
        "SELECT p.id, p.name, p.description, p.price_cents, c.name AS kategori
         FROM products p
         JOIN categories c ON c.id = p.category_id AND c.tenant_id = p.tenant_id
         WHERE p.tenant_id = ? AND p.is_active = 1 AND p.is_86 = 0
         ORDER BY c.display_order, p.name",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut ogeler = Vec::with_capacity(satirlar.len());
    for satir in satirlar {
        ogeler.push(MenuOgesi {
            urun_id: satir.try_get("id").map_err(|e| e.to_string())?,
            ad: satir.try_get("name").map_err(|e| e.to_string())?,
            // `description` gerçekten NULL olabilir; bu yüzden `Option` okunur.
            // Ancak `try_get(...).ok()` **yazılmaz**: `.ok()` kolon bozulduğunda
            // hatayı yutar ve açıklamayı sessizce boş gösterir. Boş olması
            // meşru, okuma hatasının meşru olmaması gerekir.
            aciklama: satir
                .try_get::<Option<String>, _>("description")
                .map_err(|e| e.to_string())?
                .unwrap_or_default(),
            fiyat_cents: satir.try_get("price_cents").map_err(|e| e.to_string())?,
            kategori: satir.try_get("kategori").map_err(|e| e.to_string())?,
        });
    }
    Ok(ogeler)
}

/// İmzalı statik menü belgesi üretir.
pub async fn menu_belgesi_uret(
    conn: &mut SqliteConnection,
    tenant_id: Option<&str>,
) -> Result<ImzaliDokuman<MenuBelgesi>, String> {
    let kiraci = tenant_zorunlu(tenant_id)?;
    let (kimlik, anahtar) = anahtar_al_veya_uret(conn, &kiraci).await?;
    let ogeler = menu_ogeleri(conn, &kiraci).await?;

    imzala(
        &anahtar,
        &kimlik,
        MenuBelgesi {
            tenant_kodu: kiraci,
            uretim_zamani: chrono::Utc::now().to_rfc3339(),
            ogeler,
        },
    )
}

/// Menü dosyasını (JSON + HTML) üretir.
pub async fn menu_dosyasi_uret(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<ImzaliMenuCiktisi, String> {
    let belge = menu_belgesi_uret(conn, Some(tenant_id)).await?;
    let html = menu_html(&belge.govde, &belge.imza);
    let json = serde_json::to_string(&belge).map_err(|e| e.to_string())?;

    Ok(ImzaliMenuCiktisi {
        json,
        html,
        imza: belge.imza.clone(),
        key_id: belge.key_id.clone(),
    })
}

/// Tek dosya HTML menü (ağ gerektirmez).
///
/// Neden HTML: menü müşteriye **dosya** olarak veriliyor. Harici varlık (resim,
/// betik) referansı olmayan tek dosya çevrimdışı ve izlenebilir çalışır;
/// müşterinin tarayıcısı hiçbir sunucuya gitmez.
pub fn menu_html(belge: &MenuBelgesi, imza: &str) -> String {
    let mut satirlar = String::new();
    for oge in &belge.ogeler {
        // HTML kaçışı: ürün adı veritabanından gelir ve personel girebilir.
        // Kaçış yapılmazsa ad alanına yazılan `<script>` müşterinin
        // tarayıcısında çalışır.
        satirlar.push_str(&format!(
            "      <li class=\"oge\"><span class=\"ad\">{}</span> \
             <span class=\"fiyat\">{} kuruş</span> \
             <span class=\"aciklama\">{}</span></li>\n",
            kacis(&oge.ad),
            oge.fiyat_cents,
            kacis(&oge.aciklama)
        ));
    }

    format!(
        "<!doctype html>\n<html lang=\"tr\">\n  <head>\n    <meta charset=\"utf-8\">\n    <title>Menü</title>\n  </head>\n  <body>\n    <h1>Menü</h1>\n    <p>Üretim: {} · İmza: {}</p>\n    <ul>\n{}    </ul>\n  </body>\n</html>\n",
        kacis(&belge.uretim_zamani),
        kacis(imza),
        satirlar
    )
}

/// HTML kaçışı. Betik enjeksiyonunu etkisiz hale getirir.
fn kacis(metin: &str) -> String {
    metin
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
#[path = "menu_file_tests.rs"]
mod tests;
