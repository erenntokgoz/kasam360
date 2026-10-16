//! V1 ve V2 — `get_active_shift` ve `get_open_shifts` tenant izolasyonu testleri.

use super::common::*;
use sqlx::Row;

// ---------------------------------------------------------------------------
// V1 — get_active_shift tenant izolasyonu
// ---------------------------------------------------------------------------

#[tokio::test]
async fn v1_aktif_vardiya_baska_kiracininkini_gormez() {
    let p = pool().await;
    add_user(&p, "tenant_a", "usr_cash_a", "Kasiyer A", "CASHIER").await;
    add_user(&p, "tenant_b", "usr_cash_b", "Kasiyer B", "CASHIER").await;
    add_shift(&p, "tenant_a", "shf_a", "usr_cash_a", 50_000).await;
    add_shift(&p, "tenant_b", "shf_b", "usr_cash_b", 900_000).await;

    let a = active_shift_sql(&p, "tenant_a", "usr_cash_a")
        .await
        .expect("okunmali");
    assert_eq!(
        a.as_deref(),
        Some("shf_a"),
        "kiraci A yalnız kendi vardiyasini gormeli"
    );

    let b = active_shift_sql(&p, "tenant_b", "usr_cash_b")
        .await
        .expect("okunmali");
    assert_eq!(b.as_deref(), Some("shf_b"));
}

/// `users.id` global tekil olduğu için kimlik paylaşılamaz; sızıntı **bozuk
/// satırdan** doğar: `shifts.tenant_id` ile kasiyerin gerçek tenant'ı
/// ayrışmışsa (eski hata, hatalı toplu yazma, iptal edilmemiş geçiş) tenant
/// filtresi olmadan bu satır komşu kiracıya görünür.
#[tokio::test]
async fn v1_tenant_kirilmis_satir_komsu_kiraciya_sizmaz() {
    let p = pool().await;
    add_user(&p, "tenant_a", "usr_cash_a", "Kasiyer A", "CASHIER").await;
    // Satır `tenant_b` altında ama kasiyer `tenant_a`'nın kullanıcısı.
    add_shift(&p, "tenant_b", "shf_kirilmis", "usr_cash_a", 900_000).await;

    let a = active_shift_sql(&p, "tenant_a", "usr_cash_a")
        .await
        .expect("okunmali");
    assert!(
        a.is_none(),
        "kiraci A, tenant'i yanlis yazilmis vardiyayi gormemeli: {a:?}"
    );
}

#[tokio::test]
async fn v1_baska_kiracida_vardiya_yoksa_null_doner() {
    let p = pool().await;
    add_user(&p, "tenant_a", "usr_cash_a", "Kasiyer A", "CASHIER").await;
    add_shift(&p, "tenant_a", "shf_a", "usr_cash_a", 50_000).await;

    // `tenant_b` sorguladığında hiçbir satır görmemeli.
    let bos = active_shift_sql(&p, "tenant_b", "usr_cash_a")
        .await
        .expect("okunmali");
    assert_eq!(bos, None);
}

// ---------------------------------------------------------------------------
// V2 — get_open_shifts tenant izolasyonu
// ---------------------------------------------------------------------------

#[tokio::test]
async fn v2_acik_vardiyalar_yalniz_kendi_kiracini_listeler() {
    let p = pool().await;
    add_user(&p, "tenant_a", "usr_a1", "A1", "CASHIER").await;
    add_user(&p, "tenant_a", "usr_a2", "A2", "CASHIER").await;
    add_user(&p, "tenant_b", "usr_b1", "B1", "CASHIER").await;
    add_shift(&p, "tenant_a", "shf_a1", "usr_a1", 10_000).await;
    add_shift(&p, "tenant_a", "shf_a2", "usr_a2", 20_000).await;
    add_shift(&p, "tenant_b", "shf_b1", "usr_b1", 99_000).await;

    let a = open_shifts_sql(&p, "tenant_a").await.expect("okunmali");
    assert_eq!(a, vec!["shf_a1", "shf_a2"]);

    let b = open_shifts_sql(&p, "tenant_b").await.expect("okunmali");
    assert_eq!(b, vec!["shf_b1"]);
}

#[tokio::test]
async fn v2_tenant_kirilmis_satir_listelenmez() {
    let p = pool().await;
    add_user(&p, "tenant_a", "usr_a1", "A1", "CASHIER").await;
    // `tenant_b` vardiyası ama `tenant_a`'nın kullanıcısına bağlı.
    add_shift(&p, "tenant_b", "shf_kirilmis", "usr_a1", 99_000).await;

    let a = open_shifts_sql(&p, "tenant_a").await.expect("okunmali");
    assert!(
        !a.contains(&"shf_kirilmis".to_string()),
        "kiraci A komşunun vardiyasini asla gormemeli: {a:?}"
    );
}

#[tokio::test]
async fn v2_kapanmis_vardiya_listelenmez() {
    let p = pool().await;
    add_user(&p, "tenant_a", "usr_a1", "A1", "CASHIER").await;
    add_shift(&p, "tenant_a", "shf_acik", "usr_a1", 10_000).await;
    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, closed_at,
                             expected_amount_cents, actual_amount_cents, difference_cents)
         VALUES ('shf_kapali', 'tenant_a', 'usr_a1', 'CLOSED',
                 '2026-03-09T08:00:00Z', '2026-03-09T18:00:00Z', 10000, 10000, 0)",
    )
    .execute(&p)
    .await
    .expect("kapanmis vardiya eklenmeli");

    let a = open_shifts_sql(&p, "tenant_a").await.expect("okunmali");
    assert_eq!(a, vec!["shf_acik"]);
}

#[tokio::test]
async fn v2_kullanici_bulunamazsa_ad_null_doner_sifir_degil() {
    let p = pool().await;
    // `users` tablosunda karşılığı olmayan bir kasiyerle doğrudan INSERT
    // (eski satır kalıntısı simülasyonu). LEFT JOIN `u.name AS cashier_name`
    // kolonunu NULL bırakmalı; fallback olarak "0" vb. uydurulmamalı.
    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, expected_amount_cents)
         VALUES ('shf_hayalet', 'tenant_a', 'usr_yok', 'OPEN', '2026-03-10T08:00:00Z', 1000)",
    )
    .execute(&p)
    .await
    .expect("vardiya eklenmeli");

    let row = sqlx::query(
        "SELECT s.id, u.name AS cashier_name
           FROM shifts s
           LEFT JOIN users u ON u.id = s.cashier_id AND u.tenant_id = s.tenant_id
          WHERE s.tenant_id = ? AND s.id = 'shf_hayalet'",
    )
    .bind("tenant_a")
    .fetch_one(&p)
    .await
    .expect("satır okunmali");
    // Bilinmeyen kasiyer adı boş string olmamalı; null döner.
    assert_eq!(
        row.try_get::<Option<String>, _>("cashier_name")
            .expect("kolon okunmali"),
        None
    );
}
