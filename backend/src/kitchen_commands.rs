use crate::db::DbPool;
use crate::rbac::{self, Role};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

/// Mutfak istasyonlarını okuyan roller.
///
/// Neden garson ve kasa dışlanıyor: istasyon listesi mutfağın üretim hattıdır
/// (hangi istasyon, kaç bilet). Garson sipariş alır, kasa tahsilat yapar;
/// ikisi de mutfak hattının okumasına ihtiyaç duymaz. SPEC §34
/// `kitchenPrepare`/`kitchenManage` satırları OWNER/MANAGER/KITCHEN'e FULL,
/// diğer rollere yalnız görüntü veriyor — buradaki kapı o görüntüyü de
/// mutfak akışına kilitler.
const ISTASYON_OKUMA_ROLES: [Role; 3] = [Role::Owner, Role::Manager, Role::Kitchen];

/// İstasyon **yazan** roller.
///
/// Neden garson ve kasa dışlanıyor: istasyon tanımı mutfağın üretim hattını
/// belirler. Şube kroğu, ekip ve kapasite planı işletme sahibi ile müdürün
/// kararıdır; mutfak kendi istasyonunu ekleyemez. SPEC §34 `kitchenManage`
/// satırı yalnız OWNER/MANAGER/KITCHEN'e FULL veriyor.
const ISTASYON_YAZMA_ROLES: [Role; 3] = [Role::Owner, Role::Manager, Role::Kitchen];

/// KDS bilet kalemi durumunu güncelleyen roller.
///
/// Neden kasa ve garson dışlanıyor: kalemin "hazır" işaretlenmesi mutfağın
/// kendi bildirimidir. Garson hazırlandı diyemez (kasada bekleyen müşteriye
/// yanlış haber verilir), kasa da diyemez. SPEC §34 `kitchenPrepare`
/// satırı yalnız OWNER/MANAGER/KITCHEN'e FULL veriyor.
const KDS_DURUM_ROLES: [Role; 3] = [Role::Owner, Role::Manager, Role::Kitchen];

/// İstasyon kapısını fail-closed geçirir ve kiracıyı çözer.
///
/// Neden ayrı fonksiyon: `tauri::State` içeren komutlar doğrudan test
/// edilemez. Kapı saf bir fonksiyona taşınırsa "rol alanı hiç gönderilmemişse
/// reddedilir" sözleşmesi testle kanıtlanabilir.
pub(crate) fn istasyon_okuma_kapisi(
    actor_role: Option<&str>,
    tenant_id: Option<&str>,
) -> Result<String, String> {
    rbac::require_any_present(actor_role, &ISTASYON_OKUMA_ROLES)?;
    kiraci_coz(tenant_id)
}

/// İstasyon yazma kapısını fail-closed geçirir ve kiracıyı çözer.
pub(crate) fn istasyon_yazma_kapisi(
    actor_role: Option<&str>,
    tenant_id: Option<&str>,
) -> Result<String, String> {
    rbac::require_any_present(actor_role, &ISTASYON_YAZMA_ROLES)?;
    kiraci_coz(tenant_id)
}

/// KDS durum kapısını fail-closed geçirir ve kiracıyı çözer.
pub(crate) fn kds_durum_kapisi(
    actor_role: Option<&str>,
    tenant_id: Option<&str>,
) -> Result<String, String> {
    rbac::require_any_present(actor_role, &KDS_DURUM_ROLES)?;
    kiraci_coz(tenant_id)
}

/// Kiracıyı fail-closed çözer. Boş veya eksik değer reddedilir; varsayılan
/// kiracıya düşmek, rol alanını hiç göndermeyen çağrıyı geçerli sayardı.
fn kiraci_coz(tenant_id: Option<&str>) -> Result<String, String> {
    tenant_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string())
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StationDto {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

/// İstasyonları bu kiracıya ait olanlarla sınırlar.
///
/// Neden zorunlu: `stations` tablosunda `tenant_id` kolonu var ama bu komut
/// filtrelemeden tüm istasyonları okuyordu. Varsayılan tohumlama da
/// kiracıya özel istasyon başkasının listesine karışıyordu. Varsayılan
/// kiracıya tohumlama yapıldığında her işletme aynı beş varsayılan
/// istasyonu görüyor ve kiracıya özel istasyon başkasının listesine karışıyordu.
#[tauri::command]
pub async fn get_stations(
    tenant_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<StationDto>, String> {
    let tenant = istasyon_okuma_kapisi(actor_role.as_deref(), tenant_id.as_deref())?;

    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let mut rows = sqlx::query(
        "SELECT id, name, description FROM stations WHERE tenant_id = ? ORDER BY name ASC",
    )
    .bind(&tenant)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    // Bu kiracının tablosu boşsa varsayılan istasyonları **bu kiracıya** tohumla
    // (Sıcak, Soğuk, İçecek, Izgara, Tatlı). `tenant_id` bağlanmadan yazılırsa
    // her işletme aynı satırları paylaşır ve biri diğerini silemez hale gelir.
    if rows.is_empty() {
        let default_stations = vec![
            ("st_sicak", "Sıcak", "Sıcak Mutfak ve Ana Yemekler"),
            ("st_soguk", "Soğuk", "Soğuk Mutfak, Salata ve Mezeler"),
            ("st_icecek", "İçecek", "Bar, Sıcak ve Soğuk İçecekler"),
            ("st_izgara", "Izgara", "Izgara, Döner ve Fırın"),
            ("st_tatli", "Tatlı", "Tatlılar ve Pastane"),
        ];
        for (id, name, desc) in default_stations {
            // Tohumlama reddedilirse hata yutulmaz: istasyonsuz bir mutfak
            // ekranı boş liste görür ve sebebini bilemez.
            sqlx::query(
                "INSERT OR IGNORE INTO stations (id, tenant_id, name, description, created_at) \
                 VALUES (?, ?, ?, ?, datetime('now'))",
            )
            .bind(format!("{}_{}", id, tenant))
            .bind(&tenant)
            .bind(name)
            .bind(desc)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        }
        rows = sqlx::query(
            "SELECT id, name, description FROM stations WHERE tenant_id = ? ORDER BY name ASC",
        )
        .bind(&tenant)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    }

    let mut res = Vec::new();
    for row in rows {
        res.push(StationDto {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            name: row.try_get("name").map_err(|e| e.to_string())?,
            description: row.try_get("description").ok(),
        });
    }

    Ok(res)
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CreateStationPayload {
    pub name: String,
    pub description: Option<String>,
}

/// İstasyon ekler.
///
/// Neden kapı eklendi: komut imzasında rol veya kiracı yoktu; boş bir oturumla
/// çağrılabiliyor ve kayıt varsayılan kiracıya düşüyordu. Yani herhangi bir
/// rol mutfağın üretim hattını değiştirebiliyordu (AGENTS.md §3.3).
#[tauri::command]
pub async fn create_station(
    payload: CreateStationPayload,
    tenant_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<StationDto, String> {
    let tenant = istasyon_yazma_kapisi(actor_role.as_deref(), tenant_id.as_deref())?;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let id = format!("st_{}", Uuid::new_v4());

    sqlx::query(
        "INSERT INTO stations (id, tenant_id, name, description, created_at) \
         VALUES (?, ?, ?, ?, datetime('now'))",
    )
    .bind(&id)
    .bind(&tenant)
    .bind(&payload.name)
    .bind(&payload.description)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(StationDto {
        id,
        name: payload.name,
        description: payload.description,
    })
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UpdateKdsItemStatusPayload {
    #[serde(rename = "itemId")]
    pub item_id: String,
    pub status: String,
}

/// KDS bilet kaleminin durumunu günceller ve tüm kalemler hazırsa siparişi
/// `Ready` yapar.
///
/// Neden kapı eklendi: komut ne rol ne kiracı denetliyordu ve `UPDATE
/// order_items SET status = ? WHERE id = ?` filtresizdi. Kasa ya da garson,
/// başka bir işletmenin kalemini "hazır" işaretleyebiliyordu (çapraz kiracı
/// yazma, AGENTS.md §3.3).
#[tauri::command]
pub async fn update_kds_item_status(
    payload: UpdateKdsItemStatusPayload,
    tenant_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<bool, String> {
    let tenant = kds_durum_kapisi(actor_role.as_deref(), tenant_id.as_deref())?;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Kalem bu kiracının mı? Yazmadan önce doğrulanır: `UPDATE ... WHERE
    // tenant_id = ?` koşulsuz yazsa "0 satır güncellendi" sessizce başarı
    // görünür ve mutfak bileti hiç ilerlemez.
    let item_tenant: Option<String> =
        sqlx::query_scalar("SELECT tenant_id FROM order_items WHERE id = ?")
            .bind(payload.item_id.trim())
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    match item_tenant {
        Some(t) if t == tenant => {}
        Some(_) => {
            return Err("NOT_FOUND: kalem bu işletmeye ait değil".to_string());
        }
        None => {
            return Err("NOT_FOUND: KDS kalemi bulunamadı".to_string());
        }
    }

    sqlx::query("UPDATE order_items SET status = ? WHERE id = ? AND tenant_id = ?")
        .bind(&payload.status)
        .bind(payload.item_id.trim())
        .bind(&tenant)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    // Siparişin updated_at alanını güncelle
    sqlx::query(
        "UPDATE orders SET updated_at = datetime('now') \
         WHERE id = (SELECT order_id FROM order_items WHERE id = ? AND tenant_id = ?)",
    )
    .bind(payload.item_id.trim())
    .bind(&tenant)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Kalemin ait olduğu sipariş ID'sini bul ve tüm kalemler hazırsa sipariş durumunu Ready yap
    let order_id_opt = sqlx::query_scalar::<_, String>(
        "SELECT order_id FROM order_items WHERE id = ? AND tenant_id = ?",
    )
    .bind(payload.item_id.trim())
    .bind(&tenant)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(order_id) = order_id_opt {
        let rows = sqlx::query("SELECT status FROM order_items WHERE order_id = ? AND tenant_id = ?")
            .bind(&order_id)
            .bind(&tenant)
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

        // Durum metni okunacaksa hata yükselir: boş string "hazır değil"
        // sayılır ve bilet "tüm kalemler hazır" yanlışlamasıyla kapanır.
        // `all()` içinde `?` kullanılamayacağı için döngü kurulur.
        let mut all_ready_or_completed = !rows.is_empty();
        for row in rows.iter() {
            let st: String = row.try_get("status").map_err(|e| e.to_string())?;
            let upper = st.to_uppercase();
            if !(upper == "READY" || upper == "COMPLETED" || upper == "SERVED") {
                all_ready_or_completed = false;
                break;
            }
        }

        if all_ready_or_completed {
            let event_id = format!("evt_kds_{}", Uuid::new_v4());
            let ticket_event = serde_json::json!({
                "orderId": order_id,
                "fromStatus": "Preparing",
                "toStatus": "Ready",
                "timestamp": chrono::Utc::now().to_rfc3339(),
                "actorId": "kitchen_item_progression",
                "actorRole": "Kitchen"
            });

            sqlx::query(
                "INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at) VALUES (?, ?, ?, 'KDS_TICKET', 'TICKET_STATUS_UPDATED', ?, datetime('now'))"
            )
            .bind(&event_id)
            .bind(&tenant)
            .bind(&order_id)
            .bind(ticket_event.to_string())
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(true)
}
