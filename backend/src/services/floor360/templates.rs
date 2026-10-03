//! Neden sabit veri: şablon bir "iyi fikir" değil, belirli bir yerleşimdir.
//! Rastgele üretilen şablonlar her seferinde farklı salon üretir ve
//! kullanıcı "Klasik Kafe" dediğinde aklında bir görüntü vardır.
//!
//! Koordinatlar 20 px ızgaraya oturur, böylece şablon uygulandıktan sonra
//! masalar ilk sürüklemede zıplamaz.

/// Şablondaki tek bir masa yerleşimi.
#[derive(Debug, Clone, Copy)]
pub struct TemplateTable {
    pub x: i64,
    pub y: i64,
    pub rotation: i64,
    pub seats: i64,
}

/// Şablondaki tek bir mimari obje.
#[derive(Debug, Clone, Copy)]
pub struct TemplateObject {
    pub kind: &'static str,
    pub label: Option<&'static str>,
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
    pub rotation: i64,
}

/// Tek bir hazır şablon.
#[derive(Debug, Clone, Copy)]
pub struct FloorTemplate {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    /// Şablonun kaç masa konumladığı. Dizinin uzunluğu değil bu sayı
    /// kullanılır: `izgara` üreteci sabit uzunluklu dizi döndürür ve
    /// kullanılmayan yuvaları (0,0) ayırt etmek kırılgan bir iş olurdu.
    pub table_count: usize,
    pub tables: &'static [TemplateTable],
    pub objects: &'static [TemplateObject],
}

/// Izgaraya oturan dikdörtgen masa dizisi üretir.
///
/// Neden fonksiyon: dört şablon da "sütun × satır" düzeninde masa ister ve
/// elle yazılmış koordinatlar bir gün kayar. Dizi üretici ızgarayı tek yerde
/// tutar, şablonlar yalnız satır/sütun sayısını söyler.
const fn izgara(
    dolu: usize,
    sutun: usize,
    baslangic_x: i64,
    baslangic_y: i64,
    adim: i64,
) -> [TemplateTable; 24] {
    let mut sonuc = [TemplateTable {
        x: 0,
        y: 0,
        rotation: 0,
        seats: 4,
    }; 24];
    let mut i = 0;
    while i < dolu && i < 24 {
        sonuc[i] = TemplateTable {
            x: baslangic_x + (i % sutun) as i64 * adim,
            y: baslangic_y + (i / sutun) as i64 * adim,
            rotation: 0,
            seats: 4,
        };
        i += 1;
    }
    sonuc
}

// Klasik Kafe: 4 sütun × 2 satır sekiz masa, arkada bar, tek kapı.
const KLASIK_TABLES: [TemplateTable; 24] = izgara(8, 4, 300, 400, 200);
const KLASIK_OBJECTS: [TemplateObject; 3] = [
    TemplateObject {
        kind: "BAR",
        label: Some("Bar"),
        x: 300,
        y: 180,
        width: 620,
        height: 60,
        rotation: 0,
    },
    TemplateObject {
        kind: "DOOR",
        label: Some("Giriş"),
        x: 940,
        y: 180,
        width: 60,
        height: 60,
        rotation: 0,
    },
    TemplateObject {
        kind: "COLUMN",
        label: None,
        x: 760,
        y: 520,
        width: 40,
        height: 40,
        rotation: 0,
    },
];

// Ocakbaşı: 5 sütun × 2 satır on masa, iki kolon, arkada mutfak geçidi.
// Adım 200: 190 gibi 20'nin katı olmayan adım ızgaraya oturmaz ve şablon
// uygulandıktan sonra masaların hepsi tek bir kaydırma ile kayar.
const OCAK_TABLES: [TemplateTable; 24] = izgara(10, 5, 260, 420, 200);
const OCAK_OBJECTS: [TemplateObject; 4] = [
    TemplateObject {
        kind: "BAR",
        label: Some("Mutfak Geçidi"),
        x: 260,
        y: 200,
        width: 500,
        height: 60,
        rotation: 0,
    },
    TemplateObject {
        kind: "DOOR",
        label: Some("Giriş"),
        x: 1240,
        y: 200,
        width: 60,
        height: 60,
        rotation: 0,
    },
    TemplateObject {
        kind: "COLUMN",
        label: None,
        x: 640,
        y: 460,
        width: 40,
        height: 40,
        rotation: 0,
    },
    TemplateObject {
        kind: "COLUMN",
        label: None,
        x: 1020,
        y: 460,
        width: 40,
        height: 40,
        rotation: 0,
    },
];

// Fast Food: sıkışık ızgara, on iki masa, uzun bar, ayrı çıkış kapısı.
const FASTFOOD_TABLES: [TemplateTable; 24] = izgara(12, 4, 280, 340, 180);
const FASTFOOD_OBJECTS: [TemplateObject; 3] = [
    TemplateObject {
        kind: "BAR",
        label: Some("Sipariş Hattı"),
        x: 280,
        y: 160,
        width: 560,
        height: 50,
        rotation: 0,
    },
    TemplateObject {
        kind: "DOOR",
        label: Some("Giriş"),
        x: 900,
        y: 160,
        width: 60,
        height: 60,
        rotation: 0,
    },
    TemplateObject {
        kind: "DOOR",
        label: Some("Çıkış"),
        x: 1020,
        y: 160,
        width: 60,
        height: 60,
        rotation: 0,
    },
];

// Teras: üç sütun × iki satır altı masa, bahçe çiti, bahçe barı.
const TERAS_TABLES: [TemplateTable; 24] = izgara(6, 3, 400, 420, 240);
const TERAS_OBJECTS: [TemplateObject; 3] = [
    TemplateObject {
        kind: "WALL",
        label: Some("Çit"),
        x: 380,
        y: 260,
        width: 700,
        height: 40,
        rotation: 0,
    },
    TemplateObject {
        kind: "DOOR",
        label: Some("Bahçe Kapısı"),
        x: 1120,
        y: 260,
        width: 60,
        height: 60,
        rotation: 0,
    },
    TemplateObject {
        kind: "BAR",
        label: Some("Bahçe Barı"),
        x: 400,
        y: 820,
        width: 300,
        height: 50,
        rotation: 0,
    },
];

/// Dört hazır şablon. Sıra arayüzdeki seçicinin sırasıdır.
pub const ALL: [FloorTemplate; 4] = [
    FloorTemplate {
        id: "klasik_kafe",
        name: "Klasik Kafe",
        description: "Sekiz masa, arka bar, tek giriş",
        table_count: 8,
        tables: &KLASIK_TABLES,
        objects: &KLASIK_OBJECTS,
    },
    FloorTemplate {
        id: "ocakbasi",
        name: "Ocakbaşı",
        description: "On masa, mutfak geçidi, iki kolon",
        table_count: 10,
        tables: &OCAK_TABLES,
        objects: &OCAK_OBJECTS,
    },
    FloorTemplate {
        id: "fast_food",
        name: "Fast Food",
        description: "On iki sıkışık masa, sipariş hattı",
        table_count: 12,
        tables: &FASTFOOD_TABLES,
        objects: &FASTFOOD_OBJECTS,
    },
    FloorTemplate {
        id: "teras",
        name: "Teras",
        description: "Altı masa, bahçe çiti, bahçe barı",
        table_count: 6,
        tables: &TERAS_TABLES,
        objects: &TERAS_OBJECTS,
    },
];

/// Şablon kimliğiyle arar. Bilinmeyen kimlik `None` döner; çağıran
/// `NOT_FOUND` hatasına çevirir.
pub fn find(id: &str) -> Option<&'static FloorTemplate> {
    ALL.iter().find(|sablon| sablon.id == id)
}
