//! Faz 13 · Mimari obje yazımı ve hazır şablon uygulaması.
//!
//! Neden ayrı dosya: `layout.rs` okuma + düzen yazımıyla uğraşırken 500
//! satır sınırını aştı. Obje yaşam döngüsü (oluştur, sil, şablonla yerleştir)
//! kroki okumasından bağımsız bir konudur ve kendi dosyasında daha okunur.

use super::layout::{list_layout_tables, zone_belongs_to_tenant};
use super::templates;
use super::types::{
    validate_object_kind, validate_object_size, validate_position, validate_rotation,
    CreateObjectInput,
};
use crate::id_generator::generate_id;
use sqlx::SqliteConnection;

/// Yeni mimari obje ekler (kapı, bar, duvar, kolon).
///
/// `template_id` **bilinçli olarak NULL** yazılır: elle konulan bir obje
/// şablona ait değildir ve şablon yeniden uygulandığında korunmalıdır.
pub async fn create_object(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    giris: &CreateObjectInput,
) -> Result<String, String> {
    // Tüm doğrulama tek yerde: konum, tür, ölçü, döndürme, bölüm. Yarım
    // geçerli bir obje yazmak, sonradan bulunup düzeltilmesi gereken kırık
    // bir kroki bırakır.
    validate_object_kind(&giris.kind)?;
    validate_position(giris.x, giris.y)?;
    validate_object_size(giris.width, giris.height)?;
    validate_rotation(giris.rotation)?;

    if let Some(bolum) = &giris.zone_id {
        zone_belongs_to_tenant(conn, tenant_id, bolum).await?;
    }

    let id = generate_id("obj");
    let simdi = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO floor_objects
            (id, tenant_id, zone_id, template_id, kind, label, x, y, width,
             height, rotation, is_active, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(giris.zone_id.as_deref())
    .bind(&giris.kind)
    .bind(giris.label.as_deref())
    .bind(giris.x)
    .bind(giris.y)
    .bind(giris.width)
    .bind(giris.height)
    .bind(giris.rotation)
    .bind(&simdi)
    .bind(&simdi)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

/// Obje kaldırır. Obje bir masaya bağlı olmadığı için engel yoktur; ama
/// başka kiracının objesi silinemez.
pub async fn delete_object(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    object_id: &str,
) -> Result<(), String> {
    let sonuc = sqlx::query("DELETE FROM floor_objects WHERE id = ? AND tenant_id = ?")
        .bind(object_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    if sonuc.rows_affected() == 0 {
        return Err("NOT_FOUND: obje bulunamadı".into());
    }
    Ok(())
}

/// Hazır şablonu uygular.
///
/// Mevcut masaları **yeniden konumlandırır**, yeni masa yaratmaz: şablon
/// bir masa listesi değil, bir yerleşim önerisidir. İşletmenin masaları
/// şablondan azsa yalnız var olanlar konumlanır; kalanı (0,0)'da kalır ve
/// kullanıcı onları krokiye kendisi yerleştirir.
pub async fn apply_template(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    template_id: &str,
) -> Result<String, String> {
    let sablon = templates::find(template_id)
        .ok_or_else(|| format!("NOT_FOUND: bilinmeyen şablon ({template_id})"))?;

    let mevcut = list_layout_tables(conn, tenant_id, None).await?;
    if mevcut.is_empty() {
        return Err("VALIDATION: şablon uygulanacak masa yok".into());
    }

    let yerlestirilecek = mevcut.len().min(sablon.table_count);
    for (sira, masa) in mevcut.iter().take(yerlestirilecek).enumerate() {
        let hedef = sablon.tables[sira];
        sqlx::query(
            "UPDATE tables SET x = ?, y = ?, rotation = ?, seats = ? WHERE id = ? AND tenant_id = ?",
        )
        .bind(hedef.x)
        .bind(hedef.y)
        .bind(hedef.rotation)
        .bind(hedef.seats)
        .bind(&masa.id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Şablonun kendi objeleri yeniden yazılır: aynı şablon ikinci kez
    // uygulandığında çift kapı oluşmamalıdır.
    //
    // Silme **yalnız bu şablonun** objelerini hedefler (`template_id = ?`).
    // Etiketsiz bir silme ("kind != 'WALL'") kullanıcının elle koyduğu kapı
    // ve barları da yok eder; şablon uygulamak "baştan çiz" değil, "şu
    // yerleşimi öner" işlemidir.
    sqlx::query("DELETE FROM floor_objects WHERE tenant_id = ? AND template_id = ?")
        .bind(tenant_id)
        .bind(sablon.id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let simdi = chrono::Utc::now().to_rfc3339();
    for obje in sablon.objects {
        sqlx::query(
            "INSERT INTO floor_objects
                (id, tenant_id, zone_id, template_id, kind, label, x, y, width,
                 height, rotation, is_active, created_at, updated_at)
             VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
        )
        .bind(generate_id("obj"))
        .bind(tenant_id)
        .bind(sablon.id)
        .bind(obje.kind)
        .bind(obje.label)
        .bind(obje.x)
        .bind(obje.y)
        .bind(obje.width)
        .bind(obje.height)
        .bind(obje.rotation)
        .bind(&simdi)
        .bind(&simdi)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(sablon.name.to_string())
}

/// Şablon kimliklerinin listesi. Frontend seçici bu listeyi tek kaynaktan alır;
/// iki tarafta ayrı liste tutulursa şablon sayısı zamanla ayrışır.
pub async fn list_templates() -> Result<Vec<(String, String, String)>, String> {
    Ok(templates::ALL
        .iter()
        .map(|s| {
            (
                s.id.to_string(),
                s.name.to_string(),
                s.description.to_string(),
            )
        })
        .collect())
}
