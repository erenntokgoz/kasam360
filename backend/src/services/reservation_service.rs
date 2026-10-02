//! Faz 8 — Rezervasyon veri katmanı.
//!
//! Neden ayrı servis: `commands.rs` 500 satır sınırını aştığı için rezervasyonun
//! SQL kuralları burada toplanır ve bellek içi SQLite ile doğrudan test edilir.
//!
//! # Eski modelin çelişkisi
//!
//! Rezervasyon `tables.status = 'RESERVED'` bayrağıydı. Bu model üç yanlışa yol
//! açıyordu:
//!
//! 1. **Dolu masaya rezervasyon:** `reserve_table` durum ön-koşulu taşımadığı için
//!    `OCCUPIED` masa `RESERVED` yapılabiliyordu; açık adisyon sessizce kayboluyordu.
//! 2. **Kaldırma imkânsızlığı:** "Rezervasyonu Kaldır" arayüzde görünse de komut
//!    tek yönlüydü; aynı UPDATE `RESERVED` üzerine `RESERVED` yazıyordu.
//! 3. **Kayıp bilgi:** müşteri adı, telefon, kişi sayısı ve randevu saati hiçbir
//!    yerde tutulmuyordu; "35 dk hareketsizlik" uyarısı rezerve masada hiç çalışmıyordu.
//!
//! Artık rezervasyon **kendi satırı olan bir kayıttır**; masanın `RESERVED` olması
//! bu satırın varlığından türetilir ve kısmi tekil indeks veritabanı seviyesinde
//! "bir masada tek açık rezervasyon" kuralını zorunlu kılar.
//!
//! # Değişmezler
//!
//! - **Kiracı izolasyonu:** her sorgu `tenant_id` ile daraltılır; çapraz kiracı
//!   rezervasyonu `NOT_FOUND` ile reddedilir (var/yok bilgisi sızdırılmaz).
//! - **Yalnız boş masa:** rezervasyon `AVAILABLE` olmayan masaya yazılamaz.
//! - **Kapanan kayıt silinmez:** `CANCELLED` / `NO_SHOW` / `SEATED` terminalleri
//!   tarihçe olarak kalır; salon planı yalnız `ACTIVE` ve `ARRIVED` kayıtlarından türer.

use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::id_generator::generate_id;

/// Hâlâ masayı bloke eden rezervasyon durumları.
///
/// Neden liste: `close_order_if_applicable`, `void_order`, `move_table` ve
/// `merge_tables` gibi birden fazla yol bu iki durumu "masayı boşaltmaya çalışan"
/// olarak görüyordu; tek kaynak liste sayesinde bu yollar artık rezervasyonu
/// **kapatır** (kaydı silmez).
pub const OPEN_STATUSES: [&str; 2] = ["ACTIVE", "ARRIVED"];

/// Terminal (kapanmış) rezervasyon durumları. Bunlar masayı artık bloklamaz.
const CLOSED_STATUSES: [&str; 3] = ["SEATED", "CANCELLED", "NO_SHOW"];

const OPEN_FILTER: &str = "status IN ('ACTIVE', 'ARRIVED')";

/// Rezervasyon kaydının arayüze giden görünümü.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReservationDto {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "table_id", alias = "tableId")]
    pub table_id: String,
    #[serde(rename = "table_name", alias = "tableName", default)]
    pub table_name: String,
    pub status: String,
    #[serde(rename = "customer_name", alias = "customerName")]
    pub customer_name: String,
    #[serde(rename = "customer_phone", alias = "customerPhone", default)]
    pub customer_phone: Option<String>,
    #[serde(rename = "party_size", alias = "partySize")]
    pub party_size: i64,
    #[serde(rename = "reserved_at", alias = "reservedAt")]
    pub reserved_at: String,
    #[serde(rename = "created_at", alias = "createdAt")]
    pub created_at: String,
    #[serde(rename = "arrived_at", alias = "arrivedAt", default)]
    pub arrived_at: Option<String>,
    #[serde(rename = "closed_at", alias = "closedAt", default)]
    pub closed_at: Option<String>,
    pub note: Option<String>,
    #[serde(rename = "created_by", alias = "createdBy", default)]
    pub created_by: Option<String>,
    #[serde(rename = "created_by_role", alias = "createdByRole", default)]
    pub created_by_role: Option<String>,
    #[serde(rename = "close_reason", alias = "closeReason", default)]
    pub close_reason: Option<String>,
}

/// Yeni rezervasyon isteği. Müşteri adı zorunludur; boş bir isim kabul edilmez,
/// çünkü salon planındaki rezerve bloğu bu adı gösterir ve boş etiketli bir
/// rezervasyon operasyonda kullanılamaz.
#[derive(Debug, Clone)]
pub struct NewReservation {
    pub customer_name: String,
    pub customer_phone: Option<String>,
    pub party_size: i64,
    pub reserved_at: String,
    pub note: Option<String>,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn trimmed(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn normalize_new(input: NewReservation) -> Result<NewReservation, String> {
    let customer_name = trimmed(&input.customer_name)
        .ok_or_else(|| "VALIDATION: müşteri adı zorunludur".to_string())?;
    if input.party_size < 1 || input.party_size > 500 {
        return Err("VALIDATION: kişi sayısı 1 ile 500 arasında olmalıdır".to_string());
    }
    let reserved_at = trimmed(&input.reserved_at).ok_or_else(|| {
        "VALIDATION: randevu saati zorunludur (ISO-8601, örn. 2026-10-02T20:30:00+03:00)".to_string()
    })?;
    Ok(NewReservation {
        customer_name,
        customer_phone: trimmed(input.customer_phone.as_deref().unwrap_or("")),
        party_size: input.party_size,
        reserved_at,
        note: trimmed(input.note.as_deref().unwrap_or("")),
    })
}

const SELECT_COLUMNS: &str = "r.id, r.table_id, t.name AS table_name, r.status, r.customer_name, \
     r.customer_phone, r.party_size, r.reserved_at, r.created_at, r.arrived_at, \
     r.closed_at, r.note, r.created_by, r.created_by_role, r.close_reason";

fn row_to_dto(row: &sqlx::sqlite::SqliteRow) -> ReservationDto {
    ReservationDto {
        id: row.try_get("id").unwrap_or_default(),
        table_id: row.try_get("table_id").unwrap_or_default(),
        table_name: row.try_get("table_name").unwrap_or_default(),
        status: row.try_get("status").unwrap_or_else(|_| "ACTIVE".to_string()),
        customer_name: row.try_get("customer_name").unwrap_or_default(),
        customer_phone: row.try_get("customer_phone").ok(),
        party_size: row.try_get("party_size").unwrap_or(1),
        reserved_at: row.try_get("reserved_at").unwrap_or_default(),
        created_at: row.try_get("created_at").unwrap_or_default(),
        arrived_at: row.try_get("arrived_at").ok(),
        closed_at: row.try_get("closed_at").ok(),
        note: row.try_get("note").ok(),
        created_by: row.try_get("created_by").ok(),
        created_by_role: row.try_get("created_by_role").ok(),
        close_reason: row.try_get("close_reason").ok(),
    }
}

/// Kiracının masasının açık rezervasyonunu getirir.
pub async fn open_for_table(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    table_id: &str,
) -> Result<Option<ReservationDto>, String> {
    let sql = format!(
        "SELECT {} FROM reservations r \
         JOIN tables t ON t.id = r.table_id AND t.tenant_id = r.tenant_id \
         WHERE r.tenant_id = ? AND r.table_id = ? AND r.{} \
         ORDER BY r.created_at DESC LIMIT 1",
        SELECT_COLUMNS, OPEN_FILTER
    );
    let row = sqlx::query(&sql)
        .bind(tenant_id)
        .bind(table_id)
        .fetch_optional(conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.as_ref().map(row_to_dto))
}

/// Kiracının masasının belirli bir rezervasyonunu getirir.
pub async fn find(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    reservation_id: &str,
) -> Result<ReservationDto, String> {
    let sql = format!(
        "SELECT {} FROM reservations r \
         JOIN tables t ON t.id = r.table_id AND t.tenant_id = r.tenant_id \
         WHERE r.tenant_id = ? AND r.id = ?",
        SELECT_COLUMNS
    );
    let row = sqlx::query(&sql)
        .bind(tenant_id)
        .bind(reservation_id)
        .fetch_optional(conn)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "NOT_FOUND: bu işletmeye ait rezervasyon bulunamadı".to_string())?;
    Ok(row_to_dto(&row))
}

/// Kiracının salon planında görünen açık rezervasyonları listeler.
pub async fn list_open(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
) -> Result<Vec<ReservationDto>, String> {
    let sql = format!(
        "SELECT {} FROM reservations r \
         JOIN tables t ON t.id = r.table_id AND t.tenant_id = r.tenant_id \
         WHERE r.tenant_id = ? AND r.{} \
         ORDER BY r.created_at ASC",
        SELECT_COLUMNS, OPEN_FILTER
    );
    let rows = sqlx::query(&sql)
        .bind(tenant_id)
        .fetch_all(conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(row_to_dto).collect())
}

/// Belirli bir günün rezervasyon günlüğü (kapalı kayıtlar dâhil).
///
/// Neden ayrı fonksiyon: salon planı yalnız açık kayıtları gösterir, ancak "bugün
/// kaç rezervasyon vardı, kaçı gelmedi" sorusunu yalnız kapanmış kayıtlar
/// yanıtlayabilir.
pub async fn list_day(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    day_prefix: &str,
) -> Result<Vec<ReservationDto>, String> {
    let like = format!("{}%", day_prefix);
    let sql = format!(
        "SELECT {} FROM reservations r \
         JOIN tables t ON t.id = r.table_id AND t.tenant_id = r.tenant_id \
         WHERE r.tenant_id = ? AND (r.created_at LIKE ? OR r.reserved_at LIKE ?) \
         ORDER BY r.created_at ASC",
        SELECT_COLUMNS
    );
    let rows = sqlx::query(&sql)
        .bind(tenant_id)
        .bind(&like)
        .bind(&like)
        .fetch_all(conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(row_to_dto).collect())
}

/// Yeni rezervasyon yazar ve masayı `RESERVED` yapar.
///
/// Neden ön koşul: eski `reserve_table` yalnız tenant filtresiyle UPDATE ediyordu;
/// `OCCUPIED` bir masa rezerve edilebiliyor ve açık adisyon kayboluyordu. Artık
/// ön koşul `status = 'AVAILABLE'` **ve** kısmi tekil indeks ile zorlanır.
pub async fn create(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    table_id: &str,
    actor_id: &str,
    actor_role: &str,
    input: NewReservation,
) -> Result<ReservationDto, String> {
    let input = normalize_new(input)?;

    let table_row = sqlx::query("SELECT status, name FROM tables WHERE id = ? AND tenant_id = ?")
        .bind(table_id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "NOT_FOUND: bu işletmeye ait masa bulunamadı".to_string())?;
    let status: String = table_row.try_get("status").unwrap_or_default();
    if status != "AVAILABLE" {
        return Err(format!(
            "CONFLICT: yalnızca boş masalar rezerve edilebilir (masa durumu: {})",
            status
        ));
    }

    let id = generate_id("rsv");
    let now = now_iso();
    sqlx::query(
        "INSERT INTO reservations (id, tenant_id, table_id, status, customer_name, customer_phone,
             party_size, reserved_at, created_at, note, created_by, created_by_role)
         VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(table_id)
    .bind(&input.customer_name)
    .bind(&input.customer_phone)
    .bind(input.party_size)
    .bind(&input.reserved_at)
    .bind(&now)
    .bind(&input.note)
    .bind(actor_id)
    .bind(actor_role)
    .execute(&mut *conn)
    .await
    .map_err(|error| classify_insert_error(&error.to_string()))?;

    sqlx::query("UPDATE tables SET status = 'RESERVED' WHERE id = ? AND tenant_id = ?")
        .bind(table_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    find(conn, tenant_id, &id).await
}

/// Kısmi tekil indeks ihlalini anlaşılır bir hataya çevirir.
fn classify_insert_error(raw: &str) -> String {
    // SQLite kısmi indeks ihlalinde indeks adını değil, ihlal edilen kolonları
    // bildirir; bu yüzden iki eşleşme de kontrol edilir.
    if raw.contains("idx_reservations_one_open_per_table")
        || raw.contains("UNIQUE constraint failed: reservations")
    {
        "CONFLICT: bu masada hâlâ açık bir rezervasyon var".to_string()
    } else if raw.contains("CHECK constraint failed") {
        "VALIDATION: rezervasyon alanları geçersiz".to_string()
    } else {
        format!("DB_ERROR: rezervasyon yazılamadı ({})", raw)
    }
}

async fn set_status(
    conn: &mut sqlx::SqliteConnection,
    reservation_id: &str,
    status: &str,
    arrived: bool,
    actor_id: &str,
    reason: Option<&str>,
) -> Result<(), String> {
    if CLOSED_STATUSES.contains(&status) && !matches!(status, "SEATED") {
        sqlx::query(
            "UPDATE reservations
             SET status = ?, closed_at = ?, closed_by = ?, close_reason = ?
             WHERE id = ? AND status IN ('ACTIVE', 'ARRIVED')",
        )
        .bind(status)
        .bind(now_iso())
        .bind(actor_id)
        .bind(reason)
        .bind(reservation_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    } else {
        let sql = if arrived {
            "UPDATE reservations
             SET status = ?, arrived_at = COALESCE(arrived_at, ?), closed_by = ?, close_reason = ?
             WHERE id = ? AND status IN ('ACTIVE', 'ARRIVED')"
        } else {
            "UPDATE reservations SET status = ? WHERE id = ? AND status IN ('ACTIVE', 'ARRIVED')"
        };
        let mut query = sqlx::query(sql).bind(status);
        if arrived {
            query = query.bind(now_iso()).bind(actor_id).bind(reason);
        }
        query
            .bind(reservation_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn free_table(conn: &mut sqlx::SqliteConnection, tenant_id: &str, table_id: &str) -> Result<(), String> {
    sqlx::query("UPDATE tables SET status = 'AVAILABLE' WHERE id = ? AND tenant_id = ? AND status = 'RESERVED'")
        .bind(table_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn expect_updated(
    conn: &mut sqlx::SqliteConnection,
    table_id: &str,
    tenant_id: &str,
) -> Result<(), String> {
    let open = open_for_table(conn, tenant_id, table_id).await?;
    match open {
        Some(current) => Err(format!(
            "CONFLICT: rezervasyon durumu '{}' iken başka bir işlem yapılamaz",
            current.status
        )),
        None => Ok(()),
    }
}

/// Rezervasyonu iptal eder ve masayı boşaltır.
pub async fn cancel(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    reservation_id: &str,
    actor_id: &str,
    reason: Option<&str>,
) -> Result<ReservationDto, String> {
    let reservation = find(conn, tenant_id, reservation_id).await?;
    if CLOSED_STATUSES.contains(&reservation.status.as_str()) {
        return Err(format!(
            "CONFLICT: rezervasyon zaten '{}' durumunda kapatılmış",
            reservation.status
        ));
    }
    let status = if reason.map(|r| r == "NO_SHOW").unwrap_or(false) {
        "NO_SHOW"
    } else {
        "CANCELLED"
    };
    set_status(conn, reservation_id, status, false, actor_id, reason).await?;
    free_table(conn, tenant_id, &reservation.table_id).await?;
    expect_updated(conn, &reservation.table_id, tenant_id).await?;
    find(conn, tenant_id, reservation_id).await
}

/// "Müşteri Geldi": rezervasyon `ARRIVED` olur, masa `RESERVED` kalır.
///
/// Neden masa hemen `OCCUPIED` olmuyor: müşteri geldiği ile adisyon açıldığı iki
/// ayrı gerçektir. Masa ancak sipariş gönderildiğinde `OCCUPIED` olur; bu
/// ayrım "masa dolu ama sipariş yok" karmasıklığını kaynağında keser.
pub async fn mark_arrived(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    reservation_id: &str,
    actor_id: &str,
) -> Result<ReservationDto, String> {
    let reservation = find(conn, tenant_id, reservation_id).await?;
    if reservation.status != "ACTIVE" {
        return Err(format!(
            "CONFLICT: yalnızca bekleyen (ACTIVE) rezervasyon 'geldi' işaretlenebilir (mevcut: {})",
            reservation.status
        ));
    }
    set_status(conn, reservation_id, "ARRIVED", true, actor_id, None).await?;
    find(conn, tenant_id, reservation_id).await
}

/// Sipariş gönderildiğinde açık rezervasyonu `SEATED` ile kapatır ve masayı
/// `OCCUPIED` yapar.
///
/// Neden burada: `submit_order` masayı işgal eden tek yoldur; rezervasyonun
/// "gerçekten oturdu" anı da burada kaydedilir. Rezervasyonu atlayan bir POS
/// açılışı yazılırsa `ARRIVED` olur — bu yüzden geçmiş "müşteri geldi" diye
/// saklanır, uydurulmaz.
pub async fn seat_for_order(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    table_id: &str,
    actor_id: &str,
) -> Result<Option<ReservationDto>, String> {
    let reservation = open_for_table(conn, tenant_id, table_id).await?;
    let Some(reservation) = reservation else {
        return Ok(None);
    };
    set_status(conn, &reservation.id, "SEATED", true, actor_id, Some("ADISYON")).await?;
    sqlx::query("UPDATE tables SET status = 'OCCUPIED', opened_at = COALESCE(opened_at, ?), \
                  current_total = 0 WHERE id = ? AND tenant_id = ?")
        .bind(now_iso())
        .bind(table_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Some(find(conn, tenant_id, &reservation.id).await?))
}

/// Masadaki açık rezervasyonu terminal duruma kapatır (ödeme, void, taşıma, birleştirme).
///
/// Neden genelleştirilmiş kapatıcı: eski kodda `close_order_if_applicable` yalnız
/// `tables.status = 'RESERVED'` masayı boşaltıyordu; dolu masadaki bir rezervasyon
/// kaydı bu yollardan geçince **açık** kalıyor ve masayı sonsuza kadar blokluyordu.
pub async fn close_open_for_table(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    table_id: &str,
    actor_id: &str,
    reason: &str,
) -> Result<Option<ReservationDto>, String> {
    let Some(reservation) = open_for_table(conn, tenant_id, table_id).await? else {
        return Ok(None);
    };
    set_status(
        conn,
        &reservation.id,
        if reason == "NO_SHOW" { "NO_SHOW" } else { "CANCELLED" },
        false,
        actor_id,
        Some(reason),
    )
    .await?;
    free_table(conn, tenant_id, table_id).await?;
    Ok(Some(find(conn, tenant_id, &reservation.id).await?))
}

/// Masa taşıma/birleştirme gibi işlemlerden önce kapı: açık rezervasyonlu masa
/// taşınamaz.
///
/// Neden: taşıma işlemi kaynak masayı `AVAILABLE` yapıyordu; rezervasyon kaydı
/// ortada kalırsa hedef masaya "hayalet" blok bindirilirdi.
pub async fn assert_no_open_reservation(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    table_id: &str,
) -> Result<(), String> {
    if open_for_table(conn, tenant_id, table_id).await?.is_some() {
        return Err(
            "CONFLICT: açık rezervasyonu olan masa taşınamaz/birleştirilemez; önce rezervasyonu kaldırın"
                .to_string(),
        );
    }
    Ok(())
}

#[cfg(test)]
#[path = "reservation_service_tests.rs"]
mod tests;
