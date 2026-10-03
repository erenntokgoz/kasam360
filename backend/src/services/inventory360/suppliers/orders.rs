use crate::id_generator::generate_id;
use crate::management_commands::ensure_owned;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PurchaseOrder {
    pub id: String,
    pub supplier_id: String,
    pub order_number: String,
    pub status: String,
    pub total_cents: i64,
    pub expected_at: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseOrderLineInput {
    pub product_id: String,
    pub quantity: f64,
    /// Sipariş anındaki birim fiyat (kuruş). Boşsa tedarikçinin güncel fiyatı
    /// kullanılır; ikisi de yoksa sipariş reddedilir.
    pub unit_cost_cents: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseOrderInput {
    pub supplier_id: String,
    pub order_number: String,
    pub expected_at: Option<String>,
    pub notes: Option<String>,
    pub items: Vec<PurchaseOrderLineInput>,
}

/// Satın alma siparişi açar ve toplam maliyeti hesaplar.
///
/// Fiyatı bilinmeyen kalem kabul edilmez: toplam sıfır çıkarsa maliyet
/// görünmez ama gerçek değildir, sonradan maliyet raporu yalan söyler.
pub async fn create_purchase_order(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    input: PurchaseOrderInput,
) -> Result<PurchaseOrder, String> {
    // Sipariş başlığı ve kalemleri birlikte yazılır: kalemlerden biri
    // reddedilirse başsız sipariş ya da kalemsiz başlık kalmamalıdır. Doğrulama
    // başlıktan önce bittiği için servis tek başına da bu değişmezi korur;
    // çağıran komut ayrıca `BEGIN IMMEDIATE` ile sarar.
    ensure_owned(conn, "suppliers", &input.supplier_id, tenant_id).await?;
    if input.items.is_empty() {
        return Err("VALIDATION: sipariş en az bir kalem içermeli".into());
    }
    let order_number = input.order_number.trim();
    if order_number.is_empty() {
        return Err("VALIDATION: sipariş numarası boş olamaz".into());
    }

    let mut toplam: i64 = 0;
    // Kalem doğrulaması başlıktan **önce** yapılır. Aksi halde reddedilen bir
    // kalem, `total_cents = 0` ve kalemsiz bir `TASI` başlığı bırakırdı: sipariş
    // ekranda görünür, toplamı sıfır okunur ve maliyet raporu yalan söylerdi.
    // Çağıran komut `BEGIN IMMEDIATE` ile sarıyor olsa da doğrulama yazmadan
    // önce bitmeli; servisin tek başına doğru davranması bir tesadüfe
    // bırakılmamalıdır.
    let mut kalemler: Vec<(String, f64, i64)> = Vec::with_capacity(input.items.len());
    for item in &input.items {
        if !(item.quantity.is_finite() && item.quantity > 0.0) {
            return Err("VALIDATION: sipariş miktarı sıfırdan büyük olmalı".into());
        }
        ensure_owned(conn, "products", &item.product_id, tenant_id).await?;

        let unit_cost = match item.unit_cost_cents {
            Some(cost) => {
                if cost < 0 {
                    return Err("VALIDATION: alış fiyatı negatif olamaz".into());
                }
                cost
            }
            None => sqlx::query_scalar(
                "SELECT unit_cost_cents FROM supplier_products
                  WHERE tenant_id = ? AND supplier_id = ? AND product_id = ?",
            )
            .bind(tenant_id)
            .bind(&input.supplier_id)
            .bind(&item.product_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| {
                format!(
                    "VALIDATION: bu ürün için tedarikçi fiyatı girilmemiş, sipariş fiyatı belirsiz"
                )
            })?,
        };

        toplam += (unit_cost as f64 * item.quantity).round() as i64;
        kalemler.push((item.product_id.clone(), item.quantity, unit_cost));
    }

    let id = generate_id("por");
    sqlx::query(
        "INSERT INTO purchase_orders
             (id, tenant_id, supplier_id, order_number, status, ordered_at,
              expected_at, total_cents, created_by, notes)
         VALUES (?, ?, ?, ?, 'TASI', ?, ?, 0, ?, ?)",
    )
    .bind(&id)
    .bind(tenant_id)
    .bind(&input.supplier_id)
    .bind(order_number)
    .bind(chrono::Utc::now().to_rfc3339())
    .bind(&input.expected_at)
    .bind(actor_id)
    .bind(&input.notes)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    for (product_id, quantity, unit_cost) in &kalemler {
        sqlx::query(
            "INSERT INTO purchase_order_items
                 (id, tenant_id, purchase_order_id, product_id, quantity, unit_cost_cents)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(generate_id("poi"))
        .bind(tenant_id)
        .bind(&id)
        .bind(product_id)
        .bind(quantity)
        .bind(unit_cost)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    }

    sqlx::query("UPDATE purchase_orders SET total_cents = ? WHERE id = ? AND tenant_id = ?")
        .bind(toplam)
        .bind(&id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let siparis = PurchaseOrder {
        id,
        supplier_id: input.supplier_id,
        order_number: order_number.to_string(),
        status: "TASI".to_string(),
        total_cents: toplam,
        expected_at: input.expected_at,
        notes: input.notes,
    };
    Ok(siparis)
}

/// Teslim alınan kalemleri FIFO partilerine yazar.
///
/// Teslim kısmi değildir: siparişin kalan miktarının tamamı tek seferde alınır.
/// Kısmi teslim henüz desteklenmiyor ve alttaki `received_quantity` yazımı
/// bu yüzden alınan miktarı yazar; sipariş ikinci kez alınamaz (`ALINDI`
/// durumunda ikinci çağrı reddedilir).
pub async fn receive_purchase_order(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    order_id: &str,
) -> Result<i64, String> {
    // Her kalem bir parti açar, kalem alanını ve ürün stoğunu günceller. Çağıran
    // komut `BEGIN IMMEDIATE` ile sarar: ortada hata olursa yalnız ilk kalemler
    // alınmış görünür ve stok hareket defteriyle tutmaz.
    ensure_owned(conn, "purchase_orders", order_id, tenant_id).await?;

    let status: String =
        sqlx::query_scalar("SELECT status FROM purchase_orders WHERE id = ? AND tenant_id = ?")
            .bind(order_id)
            .bind(tenant_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "NOT_FOUND: sipariş bulunamadı".to_string())?;
    if status != "TASI" {
        return Err(format!(
            "CONFLICT: sipariş {status} durumunda, yalnız TASI sipariş alınabilir"
        ));
    }

    let kalemler = sqlx::query(
        "SELECT id, product_id, quantity, received_quantity, unit_cost_cents
           FROM purchase_order_items
          WHERE tenant_id = ? AND purchase_order_id = ?",
    )
    .bind(tenant_id)
    .bind(order_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut toplam_maliyet: i64 = 0;
    let now = chrono::Utc::now().to_rfc3339();

    for kalem in &kalemler {
        let kalem_id: String = kalem.try_get("id").map_err(|e| e.to_string())?;
        let product_id: String = kalem.try_get("product_id").map_err(|e| e.to_string())?;
        let quantity: f64 = kalem.try_get("quantity").map_err(|e| e.to_string())?;
        let received: f64 = kalem
            .try_get("received_quantity")
            .map_err(|e| e.to_string())?;
        let unit_cost: i64 = kalem
            .try_get("unit_cost_cents")
            .map_err(|e| e.to_string())?;
        let kalan = quantity - received;

        if kalan <= f64::EPSILON {
            continue;
        }

        let batch_id = generate_id("bat");
        sqlx::query(
            "INSERT INTO inventory_batches
                 (id, tenant_id, product_id, received_at, initial_quantity,
                  remaining_quantity, unit_cost_cents)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&batch_id)
        .bind(tenant_id)
        .bind(&product_id)
        .bind(&now)
        .bind(kalan)
        .bind(kalan)
        .bind(unit_cost)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        sqlx::query(
            "UPDATE purchase_order_items SET received_quantity = ? WHERE id = ? AND tenant_id = ?",
        )
        .bind(kalan)
        .bind(&kalem_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        sqlx::query(
            "UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + ?
              WHERE id = ? AND tenant_id = ?",
        )
        .bind(kalan)
        .bind(&product_id)
        .bind(tenant_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

        toplam_maliyet += (unit_cost as f64 * kalan).round() as i64;
    }

    sqlx::query(
        "UPDATE purchase_orders
            SET status = 'ALINDI', received_at = ?
          WHERE id = ? AND tenant_id = ?",
    )
    .bind(&now)
    .bind(order_id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(toplam_maliyet)
}
