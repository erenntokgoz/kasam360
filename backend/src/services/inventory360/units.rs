//! Birim çevrim (Spec §2.12).
//!
//! Neden ayrı servis: reçete ve sayım miktarları kilo, gram, adet, litre ve
//! paket arasında dolaşır. Çevrim olmadan "2 kg un" ile "2000 g un" aynı
//! değildir ve elle bölme sessiz hata üretir.
//!
//! Sessizlik yasağı: dönüşüm yolu bulunamazsa miktar **değiştirilmeden**
//! döndürülmez, hata verilir. `convert_quantity` çevrim uygulanamazsa
//! `1 kg = 1 kg` gibi bir sahte eşitlik üretirse stok ile tüketim farklı
//! birimde karşılaştırılır ve fire hesabı yanlış çıkar.

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

use crate::id_generator::generate_id;
use crate::management_commands::ensure_owned;
use crate::services::inventory360::optional_text;

/// Tek yönlü veya çift yönlü birim dönüşümü.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UnitConversion {
    pub id: String,
    pub from_unit: String,
    pub to_unit: String,
    pub factor: f64,
    pub is_bidirectional: bool,
    pub notes: Option<String>,
}

/// Dönüşüm adımı: graf üzerinde ilerlerken hangi çevrimin kullanıldığı.
#[derive(Debug, Clone)]
struct Edge {
    to_unit: String,
    factor: f64,
}

/// İşletmenin tüm dönüşümlerini çeker. Graf her çağrıda bellekte kurulur;
/// dönüşüm sayısı beş yüzü aşmadığı için sorgu maliyeti ihmal edilebilir.
async fn load_graph(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<(String, String, f64, bool)>, String> {
    let rows = sqlx::query(
        "SELECT from_unit, to_unit, factor, is_bidirectional
           FROM unit_conversions
          WHERE tenant_id = ?
          ORDER BY from_unit ASC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut graph = Vec::new();
    for row in rows {
        // `factor` oranıdır, tutar değildir; float kuralı tutarlar içindir.
        // Yine de sıfır veya negatif oran matematiksel olarak anlamsızdır ve
        // sessizce sonsuz döngüye yol açardı.
        let factor: f64 = row.try_get("factor").map_err(|e| e.to_string())?;
        if !(factor.is_finite() && factor > 0.0) {
            continue;
        }
        graph.push((
            row.try_get::<String, _>("from_unit")
                .map_err(|e| e.to_string())?,
            row.try_get::<String, _>("to_unit")
                .map_err(|e| e.to_string())?,
            factor,
            row.try_get::<bool, _>("is_bidirectional")
                .map_err(|e| e.to_string())?,
        ));
    }
    Ok(graph)
}

fn build_edges(graph: &[(String, String, f64, bool)]) -> Vec<(String, Edge)> {
    let mut edges: Vec<(String, Edge)> = Vec::new();
    for (from, to, factor, bidirectional) in graph {
        edges.push((
            from.clone(),
            Edge {
                to_unit: to.clone(),
                factor: *factor,
            },
        ));
        if *bidirectional {
            // Çift yönlü tanımın ters yönü de otomatik kurulur; ayrı satır
            // girilmesi gerekmez ve tutarsız çift kayıt oluşmaz.
            edges.push((
                to.clone(),
                Edge {
                    to_unit: from.clone(),
                    factor: 1.0 / factor,
                },
            ));
        }
    }
    edges
}

/// `from_unit` miktarını `to_unit` birimine çevirir.
///
/// Graf üzerinde en kısa yol aranır (BFS). Birden çok yol varsa kısa olan
/// seçilir: "kg -> g" ile "kg -> pount -> g" yolları aynı değildir ve
/// belirsizlik ölçüm hatasıdır.
///
/// Dönüşüm yolu yoksa hata verilir: miktarı olduğu gibi döndürmek, farklı
/// birimleri eşit sayar ve fire hesabını sessizce bozar.
pub async fn convert_quantity(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    from_unit: &str,
    to_unit: &str,
    quantity: f64,
) -> Result<f64, String> {
    if !quantity.is_finite() {
        return Err("VALIDATION: miktar sayı değil".into());
    }
    let from_unit = from_unit.trim().to_lowercase();
    let to_unit = to_unit.trim().to_lowercase();

    if from_unit == to_unit {
        return Ok(quantity);
    }

    let graph = load_graph(conn, tenant_id).await?;
    let edges = build_edges(&graph);

    // BFS: her adımda (birim, çarpan). Ziyaret edilen birimler tekrar
    // işlenmez, böylece tanımlı çevrimler sonsuz döngüye dönüşmez.
    let mut queue: Vec<(String, f64)> = vec![(from_unit.clone(), 1.0)];
    let mut visited: Vec<String> = vec![from_unit.clone()];

    while let Some((unit, accumulated)) = queue.first().cloned() {
        queue.remove(0);
        if unit == to_unit {
            return Ok(quantity * accumulated);
        }
        for (edge_from, edge) in &edges {
            if edge_from != &unit {
                continue;
            }
            if visited.contains(&edge.to_unit) {
                continue;
            }
            visited.push(edge.to_unit.clone());
            queue.push((edge.to_unit.clone(), accumulated * edge.factor));
        }
    }

    Err(format!(
        "VALIDATION: {from_unit} birimi {to_unit} birimine çevrilemiyor, tanımlı dönüşüm yolu yok"
    ))
}

pub async fn list_unit_conversions(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<UnitConversion>, String> {
    let rows = sqlx::query(
        "SELECT id, from_unit, to_unit, factor, is_bidirectional, notes
           FROM unit_conversions
          WHERE tenant_id = ?
          ORDER BY from_unit ASC, to_unit ASC",
    )
    .bind(tenant_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(UnitConversion {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            from_unit: row.try_get("from_unit").map_err(|e| e.to_string())?,
            to_unit: row.try_get("to_unit").map_err(|e| e.to_string())?,
            factor: row.try_get("factor").map_err(|e| e.to_string())?,
            is_bidirectional: row.try_get("is_bidirectional").map_err(|e| e.to_string())?,
            notes: optional_text(&row, "notes")?,
        });
    }
    Ok(result)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitConversionInput {
    pub from_unit: String,
    pub to_unit: String,
    pub factor: f64,
    pub is_bidirectional: bool,
    pub notes: Option<String>,
}

/// Dönüşüm tanımını ekler veya aynı çift için günceller.
///
/// Kendine veya zaten tanımlı ters yöne çevrim yazılması engellenir: aynı
/// birim çifti için iki farklı oran tutarsız maliyet üretir ve hangisinin
/// doğru olduğu sonradan anlaşılamaz.
pub async fn upsert_unit_conversion(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    input: UnitConversionInput,
) -> Result<UnitConversion, String> {
    let from_unit = input.from_unit.trim().to_lowercase();
    let to_unit = input.to_unit.trim().to_lowercase();

    if from_unit.is_empty() || to_unit.is_empty() {
        return Err("VALIDATION: birim adı boş olamaz".into());
    }
    if from_unit == to_unit {
        return Err("VALIDATION: kaynak ve hedef birim aynı olamaz".into());
    }
    if !(input.factor.is_finite() && input.factor > 0.0) {
        return Err("VALIDATION: dönüşüm oranı sıfırdan büyük olmalı".into());
    }

    // Aynı çiftin ters yönü zaten varsa ikinci bir tanım yazmak belirsizlik yaratır.
    let mevcut: Option<(String, bool)> = sqlx::query_as(
        "SELECT id, is_bidirectional
           FROM unit_conversions
          WHERE tenant_id = ? AND from_unit = ? AND to_unit = ?",
    )
    .bind(tenant_id)
    .bind(&to_unit)
    .bind(&from_unit)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if mevcut.is_some() {
        return Err(format!(
            "VALIDATION: {to_unit} → {from_unit} çevrimi zaten tanımlı, iki yönlü kullanılmalı"
        ));
    }

    let mevcut: Option<String> = sqlx::query_scalar(
        "SELECT id FROM unit_conversions WHERE tenant_id = ? AND from_unit = ? AND to_unit = ?",
    )
    .bind(tenant_id)
    .bind(&from_unit)
    .bind(&to_unit)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let id = match mevcut {
        Some(id) => {
            sqlx::query(
                "UPDATE unit_conversions
                    SET factor = ?, is_bidirectional = ?, notes = ?
                  WHERE id = ? AND tenant_id = ?",
            )
            .bind(input.factor)
            .bind(input.is_bidirectional)
            .bind(&input.notes)
            .bind(&id)
            .bind(tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            id
        }
        None => {
            let id = generate_id("ucv");
            sqlx::query(
                "INSERT INTO unit_conversions
                     (id, tenant_id, from_unit, to_unit, factor, is_bidirectional, notes, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(tenant_id)
            .bind(&from_unit)
            .bind(&to_unit)
            .bind(input.factor)
            .bind(input.is_bidirectional)
            .bind(&input.notes)
            .bind(actor_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            id
        }
    };

    Ok(UnitConversion {
        id,
        from_unit,
        to_unit,
        factor: input.factor,
        is_bidirectional: input.is_bidirectional,
        notes: input.notes,
    })
}

/// Dönüşümü siler. Silmeden önce başka kayıtların bu çevrime dayanıp
/// dayanmadığı denetlenmez; bunun yerine silme, tanımı kullanan reçete ve
/// sayım satırlarında "birim çevrimi yok" hatası üretir — sessiz yanlış
/// birim dönüşümünden iyidir.
pub async fn delete_unit_conversion(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    id: &str,
) -> Result<(), String> {
    ensure_owned(conn, "unit_conversions", id, tenant_id).await?;
    sqlx::query("DELETE FROM unit_conversions WHERE id = ? AND tenant_id = ?")
        .bind(id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
