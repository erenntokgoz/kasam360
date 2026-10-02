//! POS komutları (kategori, ürün, sipariş, açık sipariş listesi)
//!
//! Bu dosya commands.rs 500 satır tavanını aştığı için bölündü; içerik
//! olduğu gibi taşındı, davranış değiştirilmedi.

use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;
use crate::commands::command_helpers::audit_actor;
use crate::commands::payment_commands::CartItemDto;
use crate::commands::receipt_commands::require_tenant_scope;


#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PosCategoryDto {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PosProductDto {
    pub id: String,
    pub sku: String,
    pub barcode: Option<String>,
    pub name: String,
    #[serde(rename = "priceCents", alias = "price_cents")]
    pub price_cents: i32,
    #[serde(rename = "taxRate", alias = "tax_rate")]
    pub tax_rate: f64,
    pub category: String,
    pub description: Option<String>,
    #[serde(rename = "inStock", alias = "in_stock")]
    pub in_stock: bool,
    #[serde(rename = "stockQuantity", alias = "stock_quantity")]
    pub stock_quantity: Option<i32>,
    pub color: Option<String>,
    #[serde(rename = "imageUrl", alias = "image_url")]
    pub image_url: Option<String>,
}

#[tauri::command]
pub async fn pos_get_categories(tenant_id: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<PosCategoryDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT id, name, icon FROM categories WHERE tenant_id = ? ORDER BY display_order ASC")
        .bind(&tenant_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        
    let mut res = Vec::new();
    for row in rows {
        res.push(PosCategoryDto {
            id: row.try_get("id").unwrap_or_default(),
            name: row.try_get("name").unwrap_or_default(),
            icon: row.try_get("icon").ok(),
        });
    }
    Ok(res)
}

#[tauri::command]
pub async fn pos_get_products(tenant_id: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<PosProductDto>, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    // Akıllı Sipariş Motoru: En sık sipariş edilen ürünler en başta yer alır
    let rows = sqlx::query(
        "SELECT p.id, p.sku, p.barcode, p.name, p.price_cents, p.tax_rate, p.category_id, p.description, p.is_active, p.stock_quantity, p.color, p.image_url,
                COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.product_id = p.id), 0) as frequency
         FROM products p
         WHERE p.is_active = 1 AND p.tenant_id = ?
         ORDER BY frequency DESC, p.name ASC"
    )
        .bind(&tenant_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        
    let mut res = Vec::new();
    for row in rows {
        let price_cents: i32 = row.try_get("price_cents").unwrap_or(0);
        res.push(PosProductDto {
            id: row.try_get("id").unwrap_or_default(),
            sku: row.try_get("sku").unwrap_or_default(),
            barcode: row.try_get("barcode").ok(),
            name: row.try_get("name").unwrap_or_default(),
            price_cents,
            tax_rate: row.try_get::<f64, _>("tax_rate").unwrap_or(10.0),
            category: row.try_get("category_id").unwrap_or_default(),
            description: row.try_get("description").ok(),
            in_stock: row.try_get::<bool, _>("is_active").unwrap_or(true),
            stock_quantity: row.try_get("stock_quantity").ok(),
            color: row.try_get("color").ok(),
            image_url: row.try_get("image_url").ok(),
        });
    }
    Ok(res)
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SubmitOrderPayloadDto {
    #[serde(rename = "orderId")]
    pub order_id: String,
    #[serde(rename = "tableId")]
    pub table_id: String,
    pub items: Vec<CartItemDto>,
    pub notes: Option<String>,
}

/// Seçenek snapshot'ını **veritabanı fiyatlarıyla** yeniden yazar.
///
/// Neden: sipariş kalemi `order_items.modifiers` alanına JSON olarak dondurulur
/// ve fiş/KDS bu snapshot'tan okur. İstemcinin gönderdiği `priceCents` değeri
/// yazılırsa, tahsil edilen tutar ile fişte görünen ekstre ayrışır. Seçenek
/// kimliği tenant'a ait değilse hata verilir (sessizce düşürülmez).
pub(crate) async fn authoritative_modifier_snapshot(
    conn: &mut sqlx::SqliteConnection,
    tenant_id: &str,
    modifiers: Option<&serde_json::Value>,
) -> Result<Option<String>, String> {
    let arr = match modifiers.and_then(|m| m.as_array()) {
        Some(a) if !a.is_empty() => a,
        _ => return Ok(None),
    };

    let mut snapshot: Vec<serde_json::Value> = Vec::with_capacity(arr.len());
    for entry in arr {
        let option_id = entry
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "MALICIOUS_INPUT: Seçenek kimliği eksik.".to_string())?;

        let row: Option<(String, String, i64)> = sqlx::query_as(
            "SELECT mo.id, mo.name, mo.price_cents FROM modifier_options mo \
             JOIN modifier_groups mg ON mg.id = mo.group_id \
             WHERE mo.id = ? AND mg.tenant_id = ?",
        )
        .bind(option_id)
        .bind(tenant_id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        let (id, name, price_cents) = row.ok_or_else(|| {
            "MALICIOUS_INPUT: Seçenek bu işletmeye ait değil veya silinmiş.".to_string()
        })?;

        snapshot.push(serde_json::json!({
            "id": id,
            "name": name,
            "priceCents": price_cents,
        }));
    }

    Ok(Some(serde_json::to_string(&snapshot).map_err(|e| e.to_string())?))
}

#[tauri::command]
pub async fn submit_order(    payload: SubmitOrderPayloadDto,
    tenant_id: String,
    actor_id: Option<String>,
    actor_role: Option<String>,
    pool: tauri::State<'_, DbPool>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    let audit_lock =
        crate::services::audit_service::AuditLock::new(state.audit_mutex.lock().await);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // 1. Calculate authoritative totals and prepared items
    struct PreparedOrderItem {
        id: String,
        product_id: String,
        quantity: i64,
        unit_price_cents: i64,
        tax_rate: f64,
        subtotal_cents: i64,
        tax_amount_cents: i64,
        total_cents: i64,
        modifiers_json: Option<String>,
    }

    let mut prepared_items: Vec<PreparedOrderItem> = Vec::with_capacity(payload.items.len());
    let mut total_cents: i64 = 0;

    for item in &payload.items {
        let product_id = item.product.get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
            
        let row = sqlx::query("SELECT price_cents, tax_rate FROM products WHERE id=? AND tenant_id=?")
            .bind(product_id)
            .bind(&tenant_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| format!("Product not found: {}", e))?;

            let price_cents: i32 = row.try_get("price_cents").unwrap_or(0);
            let db_tax_rate: f64 = row.try_get::<f64, _>("tax_rate").unwrap_or(0.0);
            let qty = item.quantity;
            // Fiyat farkı istemciden değil `modifier_options`'tan okunur: ekstre
            // ücreti `0` gönderilerek ödenemez. Donmuş fiyat bu aşamada henüz
            // yoktur (kayıt aşağıda yazılıyor), dolayısıyla hep ürün + DB ekstre.
            let item_unit_price = crate::services::modifier_service::resolve_unit_price(
                &mut tx,
                &tenant_id,
                (price_cents as i64, db_tax_rate),
                item.modifiers.as_ref(),
                None,
            )
            .await?;
            let item_subtotal = item_unit_price * qty;
        let tax_rate_int = db_tax_rate.round() as i64;
        let item_tax = (item_subtotal * tax_rate_int) / 100;
        let item_total = item_subtotal + item_tax;
        total_cents += item_total;

        // Snapshot: seçenek adları ve **gerçekten ücretlenen** fiyat farkı
        // yazılır. İstemcinin gönderdiği fiyat değeri kullanılmaz; aksi hâlde
        // fişte görünen ekstre ile tahsil edilen tutar ayrışırdı.
        let modifiers_json = match authoritative_modifier_snapshot(&mut tx, &tenant_id, item.modifiers.as_ref()).await? {
            Some(json) => Some(json),
            None => None,
        };

        prepared_items.push(PreparedOrderItem {
            id: format!("item_{}", Uuid::new_v4()),
            product_id: product_id.to_string(),
            quantity: qty,
            unit_price_cents: item_unit_price,
            tax_rate: db_tax_rate,
            subtotal_cents: item_subtotal,
            tax_amount_cents: item_tax,
            total_cents: item_total,
            modifiers_json,
        });
    }

    // 2. Insert parent order first (satisfying FK constraint on order_items)
// Garson kimliği: siparişi açan kişidir. Garson KPI'sı (Faz 11) bu kolonu
    // okur; yazılmadığı sürece karnesi hep boş döner. `tables.waiter_id` önce
    // denir, yoksa komutu çağıran `actor_id` kullanılır (müdür açtıysa
    // masadaki garson kaydedilir, kişi bazlı kırılım doğru kalır).
    let waiter_id: Option<String> = sqlx::query_scalar::<_, Option<String>>(
        "SELECT waiter_id FROM tables WHERE tenant_id = ? AND id = ?",
    )
    .bind(&tenant_id)
    .bind(&payload.table_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .flatten()
    .filter(|v| !v.trim().is_empty())
    .or_else(|| actor_id.clone().filter(|v| !v.trim().is_empty()));

    sqlx::query("INSERT INTO orders (id, table_id, tenant_id, status, total_cents, notes, cashier_id, created_at, updated_at) VALUES (?, ?, ?, 'IN_PROGRESS', ?, ?, ?, datetime('now'), datetime('now'))")
        .bind(&payload.order_id)
        .bind(&payload.table_id)
        .bind(&tenant_id)
        .bind(total_cents)
        .bind(&payload.notes)
        .bind(&waiter_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

// 3. Insert child order_items with valid FK reference
    for p_item in prepared_items {
        sqlx::query("INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents, tax_rate, subtotal_cents, tax_amount_cents, total_cents, modifiers, waiter_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&p_item.id)
            .bind(&payload.order_id)
            .bind(&p_item.product_id)
            .bind(p_item.quantity)
            .bind(p_item.unit_price_cents)
            .bind(p_item.tax_rate)
            .bind(p_item.subtotal_cents)
            .bind(p_item.tax_amount_cents)
            .bind(p_item.total_cents)
            .bind(&p_item.modifiers_json)
            // Kalem bazlı garson: sipariş kalemleri farklı garsonlara ait
            // olabilir (ortak masa devri). Sipariş seviyesindeki `waiter_id`
            // yalnız masanın sahibidir; karnesin gerçek kaynağı bu kolondur.
            .bind(&waiter_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Faz 8: masada açık bir rezervasyon varsa kayıt `SEATED` ile kapatılır.
    // Eski davranışta rezervasyon kaydı hiç oluşmadığı için rezerve masaya
    // sipariş açıldığında "müşteri geldi" gerçeği kayboluyordu. Çağrı toplam
    // hesabından **önce** yapılır; aşağıdaki UPDATE `current_total`'ı doğru yazar.
    let _seat = crate::services::reservation_service::seat_for_order(
        &mut tx,
        &tenant_id,
        &payload.table_id,
        "POS",
    )
    .await?;

    sqlx::query("UPDATE tables SET status='OCCUPIED', current_total = (SELECT COALESCE(SUM(total_cents), 0) FROM orders WHERE table_id = ? AND status IN ('OPEN', 'IN_PROGRESS')), opened_at = COALESCE(opened_at, datetime('now')) WHERE id=? AND tenant_id=?")
        .bind(&payload.table_id)
        .bind(&payload.table_id)
        .bind(&tenant_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let event_id = format!("evt_order_{}", Uuid::new_v4());
    let event_payload = serde_json::json!({
        "orderId": payload.order_id,
        "tableId": payload.table_id,
        "totalCents": total_cents,
        "itemCount": payload.items.len(),
    });
    let _ = sqlx::query("INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at) VALUES (?, ?, ?, 'ORDER', 'ORDER_SUBMITTED', ?, datetime('now'))")
        .bind(&event_id)
        .bind(&tenant_id)
        .bind(&payload.order_id)
        .bind(serde_json::to_string(&event_payload).unwrap_or_default())
        .execute(&mut *tx)
        .await;

    let outbox_id = format!("outbox_{}", Uuid::new_v4());
    let _ = sqlx::query("INSERT INTO outbox (id, tenant_id, event_id, status, created_at) VALUES (?, ?, ?, 'PENDING', datetime('now'))")
        .bind(&outbox_id)
        .bind(&tenant_id)
        .bind(&event_id)
        .execute(&mut *tx)
        .await;

    // Sipariş açılışı denetim defterine yazılır: kayıt defterinde yoksa
    // iptal/ödeme kayıtlarının hangi siparişe ait olduğu izlenemez.
    let now_iso = chrono::Utc::now().to_rfc3339();
    let (actor_id, actor_role) = audit_actor(actor_id, actor_role);
    let audit_payload = serde_json::json!({
        "orderId": payload.order_id,
        "tableId": payload.table_id,
        "totalCents": total_cents,
        "itemCount": payload.items.len(),
    });
    let ctx = crate::services::audit_service::AuditContext::new(
        tenant_id.clone(),
        actor_id,
        actor_role,
        crate::services::audit_service::category::SIPARIS_MASA,
        "order:submitted",
        payload.order_id.clone(),
        audit_payload,
        now_iso,
    )?;
    crate::services::audit_service::AuditService::append(&mut *tx, &audit_lock, &ctx).await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(true)
}

/// Masanın açık sipariş kimliği — adisyon fişi basımının kaynak kimliğidir.
///
/// Neden ayrı komut: `print_order_slip` sipariş kimliği ister, çağıran elinde yalnız
/// masa kimliği vardır. Bu komut tenant içinde çözer; filtre dışı sorgu yapılmaz.
#[tauri::command]
pub async fn get_active_order_id(
    table_id: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Option<String>, String> {
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let order_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM orders WHERE table_id = ? AND tenant_id = ?
         AND status IN ('OPEN', 'IN_PROGRESS') ORDER BY created_at DESC LIMIT 1",
    )
    .bind(&table_id)
    .bind(&tenant)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(order_id)
}

#[tauri::command]
pub async fn get_order_items(
    table_id: String,
    tenant_id: Option<String>,
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<CartItemDto>, String> {
    // Tenant filtresi zorunludur: filtreli olmayan sorgu başka işletmenin masasının
    // kalemlerini bu kasaya getirirdi.
    let tenant = require_tenant_scope(tenant_id.as_deref())?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let row = sqlx::query("SELECT id FROM orders WHERE table_id = ? AND tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS') ORDER BY created_at DESC LIMIT 1")
        .bind(&table_id)
        .bind(&tenant)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let order_id: String = match row {
        Some(r) => r.try_get("id").unwrap_or_default(),
        None => return Ok(vec![]),
    };

    let items = sqlx::query("
        SELECT oi.*, p.name as product_name, p.category_id as product_category_id, p.barcode as product_barcode
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
    ")
    .bind(&order_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in items {
        let modifiers_str: Option<String> = row.try_get("modifiers").ok();
        let modifiers_val: Option<serde_json::Value> = modifiers_str.and_then(|m| serde_json::from_str(&m).ok());

        let product_json = serde_json::json!({
            "id": row.try_get::<String, _>("product_id").unwrap_or_default(),
            "name": row.try_get::<String, _>("product_name").unwrap_or_default(),
            "category": row.try_get::<String, _>("product_category_id").unwrap_or_default(),
            "categoryId": row.try_get::<String, _>("product_category_id").unwrap_or_default(),
            "price": row.try_get::<i32, _>("unit_price_cents").unwrap_or(0) as i64,
            "taxRate": row.try_get::<f64, _>("tax_rate").unwrap_or(10.0),
            "barcode": row.try_get::<Option<String>, _>("product_barcode").unwrap_or_default(),
            "inStock": true,
        });

        result.push(CartItemDto {
            id: row.try_get("id").unwrap_or_default(),
            product: product_json,
            quantity: row.try_get::<i32, _>("quantity").unwrap_or(0) as i64,
            unit_price: row.try_get::<i32, _>("unit_price_cents").unwrap_or(0) as i64,
            tax_rate: Some(row.try_get::<f64, _>("tax_rate").unwrap_or(0.0) as i64),
            subtotal: Some(row.try_get::<i32, _>("subtotal_cents").unwrap_or(0) as i64),
            tax_amount: Some(row.try_get::<i32, _>("tax_amount_cents").unwrap_or(0) as i64),
            total: Some(row.try_get::<i32, _>("total_cents").unwrap_or(0) as i64),
            modifiers: modifiers_val,
            note: row.try_get("notes").ok(),
            discount: None,
        });
    }

    Ok(result)
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct LiveOrderDto {
    pub id: String,
    pub table_name: String,
    pub status: String,
    pub total_cents: i64,
    pub created_at: String,
    pub item_count: i64,
}

#[tauri::command]
pub async fn get_live_orders(actor_role: String, pool: tauri::State<'_, DbPool>) -> Result<Vec<LiveOrderDto>, String> {
    crate::rbac::require_reporting(&actor_role)?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("
        SELECT o.id, t.name as table_name, o.status, o.total_cents, o.created_at,
               (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
        FROM orders o
        JOIN tables t ON o.table_id = t.id
        WHERE o.status IN ('OPEN', 'IN_PROGRESS')
        ORDER BY o.created_at ASC
    ").fetch_all(&mut *conn).await.map_err(|e| e.to_string())?;
    
    let orders = rows.into_iter().map(|r| LiveOrderDto {
        id: r.try_get("id").unwrap_or_default(),
        table_name: r.try_get("table_name").unwrap_or_default(),
        status: r.try_get("status").unwrap_or_default(),
        total_cents: r.try_get("total_cents").unwrap_or(0),
        created_at: r.try_get("created_at").unwrap_or_default(),
        item_count: r.try_get("item_count").unwrap_or(0),
    }).collect();
    Ok(orders)
}
