//! Net bakiye motoru (Faz 9 — Spec §2.3 "Net bakiye motoru: kayıt yığmak
//! yerine birleştirme (AR−AP)").
//!
//! Neden ayrı servis: Hesap Defteri ekranı beş ayrı hesap türünü (Tedarikçi /
//! Müşteri Veresiye / Personel / Sabit Gider / Patron Şahsi) ayrı ayrı kartlar
//! hâlinde gösteriyordu ve toplamı elle topluyordu. Elle toplama iki hata
//! üretir: aynı borç iki kere sayılır veya hiç sayılmaz. Bu servis tek bir
//! sorgudan tüm açık bakiyeleri okur, hesap türüne göre **birleştirir** ve tek
//! bir net rakam üretir.
//!
//! ## Sınıflandırma kuralı
//!
//! Bir borç kaydının (`debts`) hesap türü **cari kartın tipinden** gelir
//! (`directories.type`), yönü (`alacak`/`borç`) ise **borcun kendisinden**
//! (`debts.type`):
//!
//! | `directories.type` | Hesap sınıfı | `GIVEN` yönü | `TAKEN` yönü |
//! |---|---|---|---|
//! | `SUPPLIER` | Toptancı | alacak | borç |
//! | `CUSTOMER` | Müşteri Veresiye | alacak | borç |
//! | `STAFF` | Personel | alacak (avans) | borç (hakediş) |
//! | `FIXED_EXPENSE` | Sabit Gider | alacak | borç (fatura) |
//! | `OWNER_PERSONAL` | Patron Şahsi | sermaye çekimi | sermaye çekimi |
//!
//! Patron Şahsi ayrıdır çünkü bir alacak/borç değil **sermaye çekimidir**:
//! işletmeden para çıkar, geri gelmez ve borç listesinde görünmemelidir.
//!
//! ## Net formülü
//!
//! ```text
//! net_balance_cents = alacaklar - borçlar - patron_şahsi_çekimi
//! ```
//!
//! ## Para okuma kuralı (AGENTS.md §3.4)
//!
//! Bu modüldeki **hiçbir** toplam `unwrap_or(0)` ile yutulmaz. SQL hatası
//! `Err` olarak yukarı çıkar; aksi hâlde bir şema bozulması patrona "net
//! bakiye sıfır" diye hatasız bir rapor gösterirdi.

use sqlx::{Row, SqlitePool};

/// Hesap sınıfı — arayüzün kart başlığını ve işaret yönünü belirler.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountClass {
    /// Toptancı: mal aldığımız firma.
    Supplier,
    /// Müşteri veresiye: masaya gelen müşterinin borcu.
    CustomerVeresiye,
    /// Personel: avans aldığı için borçlu olan veya hakedişi ödenmeyen çalışan.
    Staff,
    /// Sabit gider: kira, stopaj, fatura gibi tekrarlayan ödeme.
    FixedExpense,
    /// Patron Şahsi: işletme sahibinin kendi hesabı (sermaye çekimi).
    OwnerPersonal,
}

impl AccountClass {
    /// `directories.type` sütunundaki değeri hesap sınıfına çevirir.
    ///
    /// Neden `Result`: bilinmeyen bir tip sessizce varsayılan sınıfa
    /// düşürülürse yanlış yönde (alacak yerine borç) rapor edilir. Şema
    /// `CHECK` kısıtı sayesinde yeni tip kolayca gelmez ama hata yine de
    /// yukarı taşınır.
    pub fn from_directory_type(raw: &str) -> Result<Self, String> {
        match raw {
            "SUPPLIER" => Ok(Self::Supplier),
            "CUSTOMER" => Ok(Self::CustomerVeresiye),
            "STAFF" => Ok(Self::Staff),
            "FIXED_EXPENSE" => Ok(Self::FixedExpense),
            "OWNER_PERSONAL" => Ok(Self::OwnerPersonal),
            other => Err(format!(
                "Bilinmeyen cari tipi: '{}'. Net bakiye hesaplanamaz.",
                other
            )),
        }
    }

    /// Arayüzde gösterilecek Türkçe başlık.
    pub fn label(self) -> &'static str {
        match self {
            Self::Supplier => "Toptancı Borcu",
            Self::CustomerVeresiye => "Müşteri Veresiye",
            Self::Staff => "Personel",
            Self::FixedExpense => "Sabit Gider",
            Self::OwnerPersonal => "Patron Şahsi",
        }
    }

    /// Kısa simge — rozet metni (emoji yasak, AGENTS.md §3.2).
    pub fn badge(self) -> &'static str {
        match self {
            Self::Supplier => "TB",
            Self::CustomerVeresiye => "MV",
            Self::Staff => "PS",
            Self::FixedExpense => "SG",
            Self::OwnerPersonal => "PŞ",
        }
    }

    /// Patron Şahsi alacak/borç değildir; sermaye çekimidir.
    pub fn is_equity_withdrawal(self) -> bool {
        matches!(self, Self::OwnerPersonal)
    }
}

/// Tek bir cari kartın açık bakiye durumu.
#[derive(Debug, Clone)]
pub struct AccountPosition {
    pub account_class: AccountClass,
    pub directory_id: String,
    pub directory_name: String,
    /// Bu karta bağlı açık alacak (veresiye/avans) toplamı, kuruş.
    pub receivable_cents: i64,
    /// Bu karta bağlı açık borç toplamı, kuruş.
    pub payable_cents: i64,
    /// Patron Şahsi ise sermaye çekimi; diğer sınıflarda `0`.
    pub owner_withdrawal_cents: i64,
    /// Hâlâ açık borç kayıtı sayısı (tahsilat/ödeme bekleyen).
    pub open_debts: i64,
}

impl AccountPosition {
    /// İki tarafı birleştirir: `+` alacak, `-` borç, `-` sermaye çekimi.
    pub fn signed_balance_cents(&self) -> i64 {
        self.receivable_cents - self.payable_cents - self.owner_withdrawal_cents
    }
}

/// Net bakiye raporu — kart listesi + tek satır toplam.
#[derive(Debug, Clone)]
pub struct NetBalanceReport {
    pub positions: Vec<AccountPosition>,
    pub receivable_cents: i64,
    pub payable_cents: i64,
    pub owner_withdrawal_cents: i64,
    pub net_balance_cents: i64,
    /// Anahtar sırasına göre sınıf toplamları (arayüzün kart grupları).
    pub by_class: Vec<(AccountClass, i64)>,
}

/// Açık bakiyeleri okuyup hesap türüne göre birleştirir.
///
/// `include_zero` false ise sıfır bakiyeli (tamamen kapanmış) kartlar
/// rapordan düşer; rapor "kimin ne kadar borcu var" sorusunu yanıtlar, "kimi
/// tanıyoruz" sorusunu değil.
pub async fn net_balance(
    pool: &SqlitePool,
    tenant_id: &str,
    include_zero: bool,
) -> Result<NetBalanceReport, String> {
    let rows = sqlx::query(
        "SELECT d.id as directory_id,
                d.name as directory_name,
                d.type as directory_type,
                COALESCE(SUM(CASE WHEN deb.type = 'GIVEN' THEN deb.remaining_amount_cents
                                  ELSE 0 END), 0) as receivable_cents,
                COALESCE(SUM(CASE WHEN deb.type = 'TAKEN' THEN deb.remaining_amount_cents
                                  ELSE 0 END), 0) as payable_cents,
                COUNT(deb.id) as open_debts
         FROM directories d
         LEFT JOIN debts deb
                ON deb.directory_id = d.id
               AND deb.tenant_id = d.tenant_id
               AND deb.status != 'PAID'
         WHERE d.tenant_id = ?
         GROUP BY d.id, d.name, d.type
         ORDER BY d.name ASC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Açık bakiyeler okunamadı: {}", e))?;

    let mut positions: Vec<AccountPosition> = Vec::with_capacity(rows.len());
    for r in rows {
        let directory_type: String = r
            .try_get("directory_type")
            .map_err(|e| e.to_string())?;
        let account_class = AccountClass::from_directory_type(&directory_type)?;
        let receivable_cents: i64 = r.try_get("receivable_cents").map_err(|e| e.to_string())?;
        let payable_cents: i64 = r.try_get("payable_cents").map_err(|e| e.to_string())?;
        let open_debts: i64 = r.try_get("open_debts").map_err(|e| e.to_string())?;

        // Patron Şahsi ne alacak ne borç: çekilen para sermayeden düşer.
        let owner_withdrawal_cents = if account_class.is_equity_withdrawal() {
            receivable_cents + payable_cents
        } else {
            0
        };

        positions.push(AccountPosition {
            account_class,
            directory_id: r.try_get("directory_id").map_err(|e| e.to_string())?,
            directory_name: r.try_get("directory_name").map_err(|e| e.to_string())?,
            receivable_cents: if owner_withdrawal_cents > 0 { 0 } else { receivable_cents },
            payable_cents: if owner_withdrawal_cents > 0 { 0 } else { payable_cents },
            owner_withdrawal_cents,
            open_debts,
        });
    }

    if !include_zero {
        positions.retain(|p| p.open_debts > 0 && p.signed_balance_cents() != 0);
    }

    let receivable_cents: i64 = positions.iter().map(|p| p.receivable_cents).sum();
    let payable_cents: i64 = positions.iter().map(|p| p.payable_cents).sum();
    let owner_withdrawal_cents: i64 = positions.iter().map(|p| p.owner_withdrawal_cents).sum();

    let mut by_class: Vec<(AccountClass, i64)> = Vec::new();
    for class in [
        AccountClass::Supplier,
        AccountClass::CustomerVeresiye,
        AccountClass::Staff,
        AccountClass::FixedExpense,
        AccountClass::OwnerPersonal,
    ] {
        let total: i64 = positions
            .iter()
            .filter(|p| p.account_class == class)
            .map(|p| p.signed_balance_cents())
            .sum();
        by_class.push((class, total));
    }

    Ok(NetBalanceReport {
        net_balance_cents: receivable_cents - payable_cents - owner_withdrawal_cents,
        positions,
        receivable_cents,
        payable_cents,
        owner_withdrawal_cents,
        by_class,
    })
}

// ============================================================================
// VERESİYE İLE MASA KAPATMA
// VERESİYE İLE MASA KAPATMA
// ============================================================================

/// Veresiye tahsilatının sonucu.
#[derive(Debug, Clone)]
pub struct VeresiyeSettlement {
    pub debt_id: String,
    pub directory_name: String,
    pub amount_cents: i64,
}

/// Veresiye ile kapatılan adisyonun cari borcunu açar.
///
/// ## Nakit kasaya dokunmaz
///
/// Bu fonksiyon **tek bir tabloya** yazar: `debts`. `cash_movements`
/// tablosuna hiçbir satır yazılmaz. Bunun sebebi: veresiye tahsilat değildir,
/// müşteri parayı şimdi vermemiştir; kasada hareket olmadığı için kasa
/// hareketi de olmamalıdır. Yazılırsa kasa mutabakatı yanlış tutar ve vardiya
/// kapanışında "kasa eksik çıktı" hatası üretilir.
///
/// ## Bakiye yönü
///
/// `GIVEN` = müşteri bize borçlu. Tutar tamamen (`remaining = total`) açılır;
/// müşteri sonradan `pay_debt` ile kapatır, o zaman kasa hareketi `pay_debt`
/// yazar, burada değil.
pub async fn record_veresiye_settlement(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    tenant_id: &str,
    directory_id: &str,
    order_id: &str,
    amount_cents: i64,
    description: Option<&str>,
) -> Result<VeresiyeSettlement, String> {
    if amount_cents <= 0 {
        return Err("Veresiye tutarı 0'dan büyük olmalıdır.".to_string());
    }

    // Neden tip kontrolü: `debts` tablosu tip denetmez, ama net bakiye motoru
    // `directories.type` ile sınıflandırır. Veresiye bir müşteri alacağıdır;
    // yanlışlıkla bir tedarikçiye veya patron kartına yazılırsa P&L yanlış
    // yönde kayar.
    let row = sqlx::query(
        "SELECT name, type FROM directories WHERE id = ? AND tenant_id = ?",
    )
    .bind(directory_id)
    .bind(tenant_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("Veresiye cari kartı okunamadı: {}", e))?
    .ok_or_else(|| {
        "Veresiye için geçerli bir müşteri cari kartı seçilmelidir.".to_string()
    })?;

    let directory_type: String = row
        .try_get("type")
        .map_err(|e| e.to_string())?;
    if directory_type != "CUSTOMER" && directory_type != "STAFF" {
        return Err(format!(
            "Veresiye yalnız müşteri (CUSTOMER) veya personel (STAFF) kartına açılabilir; seçilen kart '{}'.",
            directory_type
        ));
    }

    let directory_name: String = row.try_get("name").map_err(|e| e.to_string())?;
    let debt_id = crate::id_generator::generate_id("dbt");

    sqlx::query(
        "INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents,
                            remaining_amount_cents, due_date, status, is_cash,
                            order_id, description, created_at)
         VALUES (?, ?, ?, 'GIVEN', ?, ?, NULL, 'PENDING', 0, ?, ?, datetime('now'))",
    )
    .bind(&debt_id)
    .bind(tenant_id)
    .bind(directory_id)
    .bind(amount_cents)
    .bind(amount_cents)
    .bind(order_id)
    .bind(description)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("Veresiye borcu açılamadı: {}", e))?;

    Ok(VeresiyeSettlement {
        debt_id,
        directory_name,
        amount_cents,
    })
}


#[cfg(test)]
#[path = "ledger_service_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "ledger_settlement_tests.rs"]
mod settlement_tests;

