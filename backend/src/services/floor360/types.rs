//! Bu dosya tek doğruluk kaynağıdır: komut katmanı, şablonlar ve testler
//! aynı kuralları buradan çağırır. Kural iki yere yazılırsa kroki bir yerde
//! serbest, başka yerde reddeden bir sistem olur.
//!
//! Not: `ts_rs` türetimi kullanılmaz. Backend crate'i `ts-rs` bağımlılığı
//! taşımıyor; tip sözleşmesi frontend'de `krokiTypes.ts` ile elle tutulur ve
//! `inventory360Contract.test.ts` sözleşme testi iki tarafı karşılaştırır.

use serde::{Deserialize, Serialize};

/// Kroki tuvalinin genişliği (piksel). Sınırlar buradan okunur; frontend
/// `snap.ts` aynı sayıyı kendi sabiti olarak taşır.
pub const CANVAS_WIDTH: i64 = 4000;
/// Kroki tuvalinin yüksekliği (piksel).
pub const CANVAS_HEIGHT: i64 = 3000;
/// Izgara adımı (piksel). Snap bu değere göre yuvarlar.
pub const GRID: i64 = 20;
/// Döndürme adımı (derece). `rotation % ROTATION_STEP != 0` reddedilir.
pub const ROTATION_STEP: i64 = 15;
/// Sandalye sayıları. Katalog dışı değer reddedilir.
pub const ALLOWED_SEATS: [i64; 4] = [2, 4, 6, 8];

/// Mimari obje türleri. `floor_objects.kind` CHECK kısıtıyla aynı küme.
pub const OBJECT_KINDS: [&str; 4] = ["DOOR", "BAR", "WALL", "COLUMN"];

/// Mevcut masaların okunduğu DTO. Kart görünümünün verisinden ayrıdır:
/// burada krokinin çizimi için gereken geometri taşınır.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutTable {
    pub id: String,
    pub name: String,
    pub status: String,
    pub x: i64,
    pub y: i64,
    pub rotation: i64,
    pub seats: i64,
    pub zone_id: Option<String>,
    pub current_total_cents: i64,
}

/// Bölüm DTO'su.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FloorZone {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub is_active: bool,
}

/// Mimari obje DTO'su.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FloorObject {
    pub id: String,
    pub zone_id: Option<String>,
    pub kind: String,
    pub label: Option<String>,
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
    pub rotation: i64,
    pub is_active: bool,
}

/// Krokinin tamamı: masalar + bölümler + objeler.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FloorLayout {
    pub zones: Vec<FloorZone>,
    pub tables: Vec<LayoutTable>,
    pub objects: Vec<FloorObject>,
    pub canvas_width: i64,
    pub canvas_height: i64,
    pub grid: i64,
    pub rotation_step: i64,
}

/// Tek bir masanın istenen konumu. `table_id` kıracaıdır; çözümsüzse hata.
#[derive(Debug, Clone, Deserialize)]
pub struct TablePlacement {
    pub table_id: String,
    pub x: i64,
    pub y: i64,
    pub rotation: i64,
    pub seats: i64,
    pub zone_id: Option<String>,
}

/// Tek bir objenin istenen konumu.
#[derive(Debug, Clone, Deserialize)]
pub struct ObjectPlacement {
    pub object_id: String,
    pub zone_id: Option<String>,
    pub kind: String,
    pub label: Option<String>,
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
    pub rotation: i64,
}

/// Düzen kaydetme gövdesi.
#[derive(Debug, Clone, Deserialize)]
pub struct SaveLayoutInput {
    pub tables: Vec<TablePlacement>,
    pub objects: Vec<ObjectPlacement>,
}

/// Yeni mimari obje açma gövdesi.
///
/// Neden ayrı gövde: `SaveLayoutInput` yalnız **taşıma** yapar, yeni obje
/// yaratmaz. Sürükle-bırak ile kapı/bar koymanın bir yolu olmalıdır;
/// aksi halde salon yalnız şablonlarla kurulabilir ve kullanıcının gerçek
/// salonu şablona benzemez.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateObjectInput {
    pub zone_id: Option<String>,
    pub kind: String,
    pub label: Option<String>,
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
    pub rotation: i64,
}

/// Obje türlerinin varsayılan ölçüleri. Frontend "kapı ekle" dediğinde
/// kullanıcı 1 piksel kapı çizmemelidir; ölçü buradan gelir.
pub fn default_object_size(kind: &str) -> (i64, i64) {
    match kind {
        "DOOR" => (80, 80),
        "BAR" => (400, 60),
        "WALL" => (400, 20),
        _ => (40, 40),
    }
}

/// Konum doğrulaması. Sınır dışı değer reddedilir; ıskalanmaz.
pub fn validate_position(x: i64, y: i64) -> Result<(), String> {
    if !(0..=CANVAS_WIDTH).contains(&x) {
        return Err(format!(
            "VALIDATION: x sınır dışı ({x}); kroki {CANVAS_WIDTH} piksel genişliğinde"
        ));
    }
    if !(0..=CANVAS_HEIGHT).contains(&y) {
        return Err(format!(
            "VALIDATION: y sınır dışı ({y}); kroki {CANVAS_HEIGHT} piksel yüksekliğinde"
        ));
    }
    Ok(())
}

/// Döndürme doğrulaması. 15° adım dışı açı kabul edilmez: masa 7° döndüğünde
/// izgara hizasını kaybeder ve kaydetme sonrası konum kayar.
pub fn validate_rotation(rotation: i64) -> Result<(), String> {
    if !(0..360).contains(&rotation) {
        return Err(format!(
            "VALIDATION: döndürme 0-360 derece aralığında olmalı ({rotation})"
        ));
    }
    if rotation % ROTATION_STEP != 0 {
        return Err(format!(
            "VALIDATION: döndürme {ROTATION_STEP} derece adımında olmalı ({rotation})"
        ));
    }
    Ok(())
}

/// Sandalye doğrulaması. Katalog 2/4/6/8; aradaki değerler kasıtlı olarak
/// yoktur (yarım sandalye fiziksel olarak mümkün değildir).
pub fn validate_seats(seats: i64) -> Result<(), String> {
    if ALLOWED_SEATS.contains(&seats) {
        Ok(())
    } else {
        Err(format!(
            "VALIDATION: sandalye sayısı 2, 4, 6 veya 8 olmalı ({seats})"
        ))
    }
}

/// Obje türü doğrulaması.
pub fn validate_object_kind(kind: &str) -> Result<(), String> {
    if OBJECT_KINDS.contains(&kind) {
        Ok(())
    } else {
        Err(format!(
            "VALIDATION: bilinmeyen obje türü ({kind}); izin verilenler: {}",
            OBJECT_KINDS.join(", ")
        ))
    }
}

/// Obje ölçüsü doğrulaması. Sıfır ölçülü obje görünmez ama yer kaplar,
/// bu yüzden alt sınır var.
pub fn validate_object_size(width: i64, height: i64) -> Result<(), String> {
    if !(20..=2000).contains(&width) || !(20..=2000).contains(&height) {
        return Err(format!(
            "VALIDATION: obje ölçüsü 20-2000 piksel aralığında olmalı ({width}x{height})"
        ));
    }
    Ok(())
}

/// Tek bir masa yerleşimini doğrular.
pub fn validate_table_placement(yerlesim: &TablePlacement) -> Result<(), String> {
    validate_position(yerlesim.x, yerlesim.y)?;
    validate_rotation(yerlesim.rotation)?;
    validate_seats(yerlesim.seats)
}

/// Tek bir obje yerleşimini doğrular.
pub fn validate_object_placement(yerlesim: &ObjectPlacement) -> Result<(), String> {
    validate_position(yerlesim.x, yerlesim.y)?;
    validate_object_kind(&yerlesim.kind)?;
    validate_object_size(yerlesim.width, yerlesim.height)?;
    validate_rotation(yerlesim.rotation)
}
