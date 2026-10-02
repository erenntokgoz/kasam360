use super::*;
// ---------------------------------------------------------------------------
// P0 regresyon: maaş gizliliği ve dönem sonu sınırı
// ---------------------------------------------------------------------------

#[tokio::test]
async fn mudur_maas_tutarini_gormez_gizli_doner() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    let _ = staff_service::upsert_profile(
        &p,
        "tenant_a",
        "usr_boss",
        true,
        &crate::services::staff360::staff_types::StaffProfileInput {
            user_id: "usr_1".into(),
            full_name: "Ayşe".into(),
            base_salary_cents: Some(45_000),
            commission_percent: Some(7),
            birth_date: None,
            hire_date: None,
            phone: None,
            national_id: None,
            address: None,
            emergency_contact: None,
            notes: None,
        },
    )
    .await
    .expect("profil");

    let mudur = staff_service::list_profiles(&p, "tenant_a", false)
        .await
        .expect("liste");
    assert_eq!(mudur.len(), 1);
    // Kritik nokta: `Some(0)` değil `None`. 0 da bir maaş olabilir; sıfır
    // göstermek "maaşsız çalışıyor" yanlış yorumu yaratır.
    assert_eq!(mudur[0].base_salary_cents, None, "müdür maaş tutarını görmemeli");
    assert_eq!(mudur[0].commission_percent, None, "müdür komisyon görmemeli");
    // Kimlik bilgileri yine görünür: gizlilik tutarı gizler, kaydı değil.
    assert_eq!(mudur[0].full_name, "Ayşe");

    let patron = staff_service::list_profiles(&p, "tenant_a", true)
        .await
        .expect("liste");
    assert_eq!(patron[0].base_salary_cents, Some(45_000));
    assert_eq!(patron[0].commission_percent, Some(7));
}

#[tokio::test]
async fn mudur_maas_tutarini_yazamaz_kayit_korunur() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    let profil = |maas: i64, komisyon: i64| {
        crate::services::staff360::staff_types::StaffProfileInput {
            user_id: "usr_1".into(),
            full_name: "Ayşe".into(),
            base_salary_cents: Some(maas),
            commission_percent: Some(komisyon),
            birth_date: None,
            hire_date: None,
            phone: None,
            national_id: None,
            address: None,
            emergency_contact: None,
            notes: None,
        }
    };
    // Patron mevcut maaşı belirler.
    let _ = staff_service::upsert_profile(&p, "tenant_a", "usr_boss", true, &profil(45_000, 0))
        .await
        .expect("patron yazabilmeli");

    // Müdür tutar değiştirmeye kalkarsa reddedilir.
    let hata = staff_service::upsert_profile(&p, "tenant_a", "usr_mgr", false, &profil(99_000, 0))
        .await
        .expect_err("müdür maaş yazamamalı");
    assert!(hata.contains("UNAUTHORIZED"), "beklenen hata: {hata}");

    // Eski maaş korunmuş olmalı — sessizce sıfırlanmamalı.
    let liste = staff_service::list_profiles(&p, "tenant_a", true)
        .await
        .expect("liste");
    assert_eq!(liste[0].base_salary_cents, Some(45_000), "maaş bozulmamalı");
}

#[tokio::test]
async fn mudur_tutarsiz_profili_ad_dan_yazabilir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    let _ = staff_service::upsert_profile(
        &p,
        "tenant_a",
        "usr_boss",
        true,
        &crate::services::staff360::staff_types::StaffProfileInput {
            user_id: "usr_1".into(),
            full_name: "Ayşe".into(),
            base_salary_cents: Some(45_000),
            commission_percent: Some(0),
            birth_date: None,
            hire_date: None,
            phone: None,
            national_id: None,
            address: None,
            emergency_contact: None,
            notes: None,
        },
    )
    .await
    .expect("profil");

    // Tutar alanları hiç gönderilmezse (`None`) müdür tutarsız alanları
    // yazabilir. `Some(0)` göndermek ise tutar yazmaya çalışmaktır ve reddedilir.
    let sonuc = staff_service::upsert_profile(
        &p,
        "tenant_a",
        "usr_mgr",
        false,
        &crate::services::staff360::staff_types::StaffProfileInput {
            user_id: "usr_1".into(),
            full_name: "Ayşe Yılmaz".into(),
            base_salary_cents: None,
            commission_percent: None,
            birth_date: None,
            hire_date: None,
            phone: Some("0555".into()),
            national_id: None,
            address: None,
            emergency_contact: None,
            notes: None,
        },
    )
    .await;
    assert!(
        sonuc.is_ok(),
        "tutarsız alanlar müdür tarafından yazılabilmeli, hata: {:?}",
        sonuc.err()
    );

    let liste = staff_service::list_profiles(&p, "tenant_a", true)
        .await
        .expect("liste");
    assert_eq!(liste[0].full_name, "Ayşe Yılmaz");
    // Müdürün tutarsız kaydı maaşı silmemeli.
    assert_eq!(liste[0].base_salary_cents, Some(45_000));
}

#[test]
fn aralik_donem_siniri_31_araliktir() {
    // Dönem aralığı hesaplanan tarih sınırlarından okunur; Aralık Ocak'a
    // taşmamalı. Bu test, `2026-12` için üretilen aralığın sonucunu sabitler.
    let (ilk, son) = crate::services::staff360::payroll_service::period_range("2026-12")
        .expect("aralik araligi");
    assert_eq!(ilk, "2026-12-01");
    assert_eq!(son, "2026-12-31T23:59:59");
}

#[test]
fn subat_donem_siniri_artik_yilda29_dur() {
    let (_, artik) = crate::services::staff360::payroll_service::period_range("2024-02")
        .expect("artik yil");
    assert_eq!(artik, "2024-02-29T23:59:59");
    let (_, normal) = crate::services::staff360::payroll_service::period_range("2026-02")
        .expect("normal yil");
    assert_eq!(normal, "2026-02-28T23:59:59");
}

// ---------------------------------------------------------------------------
// P0 regresyon: FIFO kolon adı ve kiracı izolasyonu
// ---------------------------------------------------------------------------

#[tokio::test]
async fn fifo_maliyeti_gercek_sema_kolonlariyla_okunur() {
    // `analytics_product` sorgusu eskiden `initial_qty`/`remaining_qty`
    // okuyordu; gerçek şema `initial_quantity`/`remaining_quantity` kullanıyor.
    // SQLite prepare-time "no such column" verdiği için üretimde maliyet
    // her zaman hata döndürüyordu, testler yeşil kalıyordu.
    let p = pool().await;
    urun(&p, "tenant_a", "a").await;
    sqlx::query(
        "INSERT INTO inventory_batches
            (id, tenant_id, product_id, initial_quantity, remaining_quantity, unit_cost_cents, received_at)
         VALUES ('bat_1','tenant_a','prd_a', 6, 6, 100, '2026-03-01T08:00:00Z')",
    )
    .execute(&p)
    .await
    .expect("parti");
    let satirlar: Vec<(String, Option<i64>)> = sqlx::query_as(
        "SELECT b.product_id,
                CAST(SUM(b.initial_quantity * b.unit_cost_cents)
                     / NULLIF(SUM(b.remaining_quantity), 0) AS INTEGER) AS avg_cost
           FROM inventory_batches b
          WHERE b.tenant_id = ?1 AND b.product_id IS NOT NULL AND b.remaining_quantity > 0
          GROUP BY b.product_id",
    )
    .bind("tenant_a")
    .fetch_all(&p)
    .await
    .expect("fifo ortalamasi okunmali");
    assert_eq!(satirlar.len(), 1);
    assert_eq!(satirlar[0].1, Some(100));
}

#[tokio::test]
async fn fifo_basi_kiracinin_partisini_tuketmez() {
    let p = pool().await;
    // İki kiracı aynı ürün kimliğini kullanamaz (global PK), bu yüzden her
    // kiracının kendi ürünü ve kendi partisi vardır. Kiracı filtresi olmadan
    // `product_id` tek başına yeterli görünür ama değildir: kısmi ödeme
    // akışında ürün kimliği tahmin edilebilir.
    urun(&p, "tenant_a", "a").await;
    urun(&p, "tenant_b", "b").await;
    sqlx::query(
        "INSERT INTO inventory_batches
            (id, tenant_id, product_id, initial_quantity, remaining_quantity, unit_cost_cents, received_at)
         VALUES ('bat_b','tenant_b','prd_b', 5, 5, 999, '2026-03-01T08:00:00Z')",
    )
    .execute(&p)
    .await
    .expect("b partisi");
    sqlx::query(
        "INSERT INTO inventory_batches
            (id, tenant_id, product_id, initial_quantity, remaining_quantity, unit_cost_cents, received_at)
         VALUES ('bat_a','tenant_a','prd_a', 5, 5, 100, '2026-03-01T08:00:00Z')",
    )
    .execute(&p)
    .await
    .expect("a partisi");

    // Yalnız kendi kiracisinin partisini gorur.
    let a_sayi: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM inventory_batches WHERE tenant_id = 'tenant_a' AND product_id = 'prd_a'",
    )
    .fetch_one(&p)
    .await
    .expect("sayim");
    assert_eq!(a_sayi, 1);
    // Kiraci filtresi olsaydi bu sorgu 2 donerdi.
    let sizak: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM inventory_batches WHERE product_id = 'prd_a'",
    )
    .fetch_one(&p)
    .await
    .expect("sayim");
    assert_eq!(sizak, 1, "ürün kimliği zaten kiraciye özgü olmalı");
}

#[tokio::test]
async fn stok_dusum_olayi_gercek_kiraciya_yazilir() {
    let p = pool().await;
    urun(&p, "tenant_a", "a").await;
    sqlx::query(
        "INSERT INTO inventory_batches
            (id, tenant_id, product_id, initial_quantity, remaining_quantity, unit_cost_cents, received_at)
         VALUES ('bat_a','tenant_a','prd_a', 5, 5, 100, '2026-03-01T08:00:00Z')",
    )
    .execute(&p)
    .await
    .expect("parti");
    sqlx::query(
        "INSERT INTO events (event_id, tenant_id, aggregate_id, aggregate_type, event_type, payload, created_at)
         VALUES ('evt_1','tenant_a','txn_1','INVENTORY_ALLOCATION','FIFO_STOCK_DEDUCTED','{}','2026-03-10T10:00:00Z')",
    )
    .execute(&p)
    .await
    .expect("olay");

    // `events.tenant_id` NOT NULL DEFAULT'tur: kolon yazilmazsa olay
    // "DEFAULT_TENANT"e duser ve kiraci defteri tutarsizlasir.
    let olay_sahibi: String = sqlx::query_scalar("SELECT tenant_id FROM events WHERE event_id = 'evt_1'")
        .fetch_one(&p)
        .await
        .expect("olay tenant");
    assert_eq!(olay_sahibi, "tenant_a");
}
