//! `try_lock_table` / `unlock_table` testleri (G5).
//!
//! Katılıksız kilit mantığı `try_acquire_table_lock` / `release_table_lock`
//! olarak çıkarıldı; burada doğrudan çağrılır. Testler 30 sn'lık prod TTL yerine
//! 1–5 ms'lık TTL ile çalışır.

use crate::commands::command_helpers::require_tenant_id;
use crate::commands::floor_commands::{release_table_lock, try_acquire_table_lock};
use std::collections::HashMap;
use tokio::sync::Mutex;

type LockMap = Mutex<HashMap<String, (String, i64)>>;

fn locks() -> LockMap {
    Mutex::new(HashMap::new())
}

#[tokio::test]
async fn ilk_kilit_alimi_basarili_olur() {
    let l = locks();
    let result = try_acquire_table_lock(&l, "tenant_a", "tbl_1", "waiter_1", 30_000).await;
    assert!(
        result.is_ok(),
        "ilk kilit alınmalı, hata: {:?}",
        result.err()
    );
    assert!(result.unwrap());
}

#[tokio::test]
async fn ayni_kullanici_yeniden_kilit_alir() {
    let l = locks();
    try_acquire_table_lock(&l, "tenant_a", "tbl_1", "waiter_1", 30_000)
        .await
        .expect("ilk kilit");
    // Aynı waiter tekrar kilit alabilir (lock yenilenir).
    let result = try_acquire_table_lock(&l, "tenant_a", "tbl_1", "waiter_1", 30_000).await;
    assert!(
        result.is_ok(),
        "yeniden kilit alma hatalı: {:?}",
        result.err()
    );
}

#[tokio::test]
async fn baska_kullanici_kilitliyken_hata_verir() {
    let l = locks();
    try_acquire_table_lock(&l, "tenant_a", "tbl_1", "waiter_1", 30_000)
        .await
        .expect("ilk kilit");

    let err = try_acquire_table_lock(&l, "tenant_a", "tbl_1", "waiter_2", 30_000)
        .await
        .expect_err("farklı waiter kilitliyken hata vermeli");
    assert!(err.contains("TABLE_LOCKED"), "beklenen hata: {err}");
    assert!(
        err.contains("waiter_1"),
        "hatada kilidi tutan kişi olmalı: {err}"
    );
}

#[tokio::test]
async fn farkli_kiracilar_bagimsiz_kilit_alir() {
    let l = locks();
    // tenant_a kilit alır
    let r1 = try_acquire_table_lock(&l, "tenant_a", "tbl_1", "w1", 30_000).await;
    assert!(r1.is_ok());
    // tenant_b aynı table_id'yi kullanabilir — kilit key tenant-scoped
    let r2 = try_acquire_table_lock(&l, "tenant_b", "tbl_1", "w2", 30_000).await;
    assert!(r2.is_ok(), "farklı tenant bağımsız kilit almalı");
}

#[tokio::test]
async fn ttl_sonunda_kilit_otomatik_birlacaker() {
    let l = locks();
    // 1 ms TTL — hemen süre dolacak.
    try_acquire_table_lock(&l, "tenant_a", "tbl_1", "w1", 1)
        .await
        .expect("ilk kilit");
    tokio::time::sleep(std::time::Duration::from_millis(5)).await;

    // TTL süresi geçti, farklı waiter kilit alabilir.
    let r = try_acquire_table_lock(&l, "tenant_a", "tbl_1", "w2", 1).await;
    assert!(r.is_ok(), "TTL sonra kilit alma hatalı: {:?}", r.err());
}

#[tokio::test]
async fn unlock_sonra_kilit_serbest() {
    let l = locks();
    try_acquire_table_lock(&l, "tenant_a", "tbl_1", "w1", 30_000)
        .await
        .expect("ilk kilit");

    release_table_lock(&l, "tenant_a", "tbl_1", "w1")
        .await
        .expect("unlock");

    // w2 hemen kilit alabilir
    let r = try_acquire_table_lock(&l, "tenant_a", "tbl_1", "w2", 30_000).await;
    assert!(r.is_ok());
}

#[tokio::test]
async fn unlock_baskan_kisi_yapamaz() {
    let l = locks();
    try_acquire_table_lock(&l, "tenant_a", "tbl_1", "w1", 30_000)
        .await
        .expect("ilk kilit");

    // w2 kiliti bırakamaz
    release_table_lock(&l, "tenant_a", "tbl_1", "w2")
        .await
        .expect("unlock hata dönmeli ama başarısızdır");

    // hâlâ w1'in kilitli olduğu kontrol et
    let err = try_acquire_table_lock(&l, "tenant_a", "tbl_1", "w3", 30_000)
        .await
        .expect_err("w1 hâlâ kilitli");
    assert!(err.contains("TABLE_LOCKED"));
}

// ============================================================================
// 7. fail-closed: try_lock_table tenant_id: String zorunlu

#[test]
fn tenant_id_string_olarak_zorunlu_ornegi() {
    // try_lock_table ve unlock_table imzası tenant_id: String.
    // Tauri bu parametreyi zorunlu kılar: frontend göndermezse IPC hata döner,
    // Rust tarafında Option hiç yoktur. Boş string ise require_tenant_id reddeder.
    assert!(require_tenant_id(None).is_err(), "None → Err");
    assert!(require_tenant_id(Some("")).is_err(), "'' → Err");
    assert!(require_tenant_id(Some("   ")).is_err(), "whitespace → Err");
    assert_eq!(
        require_tenant_id(Some("tenant_a")).expect("gecerli"),
        "tenant_a",
        "geçerli tenant korunur"
    );
}
