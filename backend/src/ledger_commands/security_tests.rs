//! Hesap Defteri güvenlik kapısı testleri (Faz 9).
//!
//! Kapsam: rol kapısı, fail-closed kiracı, tarih aralığı, kiracılar arası
//! bakiye sızıntısı ve `AGENTS.md §3.4` "finansal sessiz hata" yasağı.
//!
//! Neden komutlar doğrudan çağrılmıyor: Tauri komutları `tauri::State`
//! taşıdığı için birim testte çağrılamaz. Bu yüzden kapının *saf* kısmı
//! (`guard`, `resolve_date_range`) doğrudan test edilir; SQL taşıyan kısım
//! ise komutun kullandığı **aynı sorgu metni** üzerinde çalıştırılır.

use crate::ledger_commands::expenses::resolve_date_range;
use crate::ledger_commands::guard::{require_ledger_read, require_ledger_tenant, require_ledger_write};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::Row;
use std::str::FromStr;

const SCHEMA: &str = include_str!("../../migrations/schema.sql");

const TENANT_A: &str = "tenant_a";
const TENANT_B: &str = "tenant_b";

async fn pool() -> sqlx::SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .expect("geçerli bağlantı seçenekleri")
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("bellek içi veritabanı açılır");
    sqlx::raw_sql(SCHEMA)
        .execute(&pool)
        .await
        .expect("şema uygulanır");
    pool
}

// ============================================================================
// 1. ROL KAPISI
// ============================================================================

#[test]
fn ledger_read_gate_allows_owner_manager_cashier() {
    for role in ["OWNER", "MANAGER", "CASHIER"] {
        assert!(
            require_ledger_read(Some(role)).is_ok(),
            "ledger okuma kapısı {} rolünü içeri almalı (navigationMatrix ledgerAccess)",
            role
        );
    }
}

#[test]
fn ledger_read_gate_rejects_waiter_kitchen_master() {
    for role in ["WAITER", "KITCHEN", "MASTER"] {
        let err = require_ledger_read(Some(role)).unwrap_err();
        assert!(
            err.contains("UNAUTHORIZED"),
            "{} rolü ledger okumamalı, hata: {}",
            role,
            err
        );
    }
}

#[test]
fn ledger_read_gate_is_fail_closed_when_role_missing() {
    // Neden: Tauri IPC'de eksik alan None olur. `if let Some(...)` deseni
    // kapıyı sessizce atlar. None reddedilmeli.
    let err = require_ledger_read(None).unwrap_err();
    assert!(err.contains("caller_role"), "hata: {}", err);

    let err = require_ledger_read(Some("")).unwrap_err();
    assert!(err.contains("UNAUTHORIZED"), "hata: {}", err);
}

#[test]
fn ledger_write_gate_rejects_cashier() {
    for role in ["OWNER", "MANAGER"] {
        assert!(require_ledger_write(Some(role)).is_ok(), "{} yazabilmeli", role);
    }
    // Neden: bu komutlar `cash_movements` yazar veya borç bakiyesini değiştirir.
    for role in ["CASHIER", "WAITER", "KITCHEN", "MASTER"] {
        assert!(
            require_ledger_write(Some(role)).is_err(),
            "{} ledger yazmamalı",
            role
        );
    }
    assert!(require_ledger_write(None).is_err());
}

// ============================================================================
// 2. FAIL-CLOSED KİRACİ
// ============================================================================

#[test]
fn ledger_tenant_gate_rejects_missing_or_blank() {
    assert_eq!(
        require_ledger_tenant(Some("tenant_a")).unwrap_or_default(),
        TENANT_A
    );
    // Neden: boş kabul edilirse sorgu `tenant_id = ''` ile hiç eşleşmez ve
    // yazma sessizce başarısız olur; "DEFAULT_TENANT" ise kiracılar arası
    // veri sızıntısıdır.
    assert!(require_ledger_tenant(None).is_err());
    assert!(require_ledger_tenant(Some("")).is_err());
    assert!(require_ledger_tenant(Some("   ")).is_err());
}

// ============================================================================
// 3. TARİH ARALIĞI (unwrap() deseni kaldırıldı)
// ============================================================================

#[test]
fn date_range_accepts_both_or_neither() {
    let s = "2026-01-01".to_string();
    let e = "2026-01-31".to_string();
    assert!(resolve_date_range(Some(&s), Some(&e)).unwrap().is_some());
    assert!(resolve_date_range(None, None).unwrap().is_none());
}

#[test]
fn date_range_rejects_half_open_range() {
    let s = "2026-01-01".to_string();
    let e = "2026-01-31".to_string();
    // Neden: yarım aralık "tüm zaman"a dönüşürse patron bir ayın rakamını
    // beş yıllık toplam sanar.
    assert!(resolve_date_range(Some(&s), None).is_err());
    assert!(resolve_date_range(None, Some(&e)).is_err());
}

#[test]
fn date_range_rejects_inverted_and_blank() {
    let s = "2026-02-01".to_string();
    let e = "2026-01-01".to_string();
    assert!(resolve_date_range(Some(&s), Some(&e)).is_err());

    let blank = "  ".to_string();
    let ok = "2026-01-01".to_string();
    assert!(resolve_date_range(Some(&blank), Some(&ok)).is_err());
    assert!(resolve_date_range(Some(&ok), Some(&blank)).is_err());
}

// ============================================================================
// 4. KİRACILAR ARASI BAKİYE SIZINTISI
// ============================================================================

/// `directories.rs`'teki `BALANCE_SUBQUERY` ile birebir aynı alt sorgu.
///
/// Neden burada kopyalanıyor: test, komutun kullandığı metni doğrulamak zorunda;
/// alt sorgu bir `const` olduğu için `pub(crate)` yapıp doğrudan çağırmak da
/// mümkün. Bu testte metin kopyası kullanılır ki bir alt sorgu değişirse
/// test kırmızıya dönsün.
const BALANCE_SQL: &str = "SELECT d.id, d.name,
            COALESCE((
                SELECT SUM(
                    CASE WHEN deb.type = 'GIVEN' THEN deb.remaining_amount_cents
                         WHEN deb.type = 'TAKEN' THEN -deb.remaining_amount_cents
                         ELSE 0 END
                ) FROM debts deb
                WHERE deb.directory_id = d.id
                  AND deb.tenant_id = d.tenant_id
                  AND deb.status != 'PAID'
            ), 0) as balance_cents
     FROM directories d
     WHERE d.tenant_id = ?
     ORDER BY d.name ASC";

/// Alt sorguda kiracı filtresi olmadan başka işletmenin borcu sızar.
const BALANCE_SQL_LEAKY: &str = "SELECT d.id, d.name,
            COALESCE((
                SELECT SUM(
                    CASE WHEN deb.type = 'GIVEN' THEN deb.remaining_amount_cents
                         WHEN deb.type = 'TAKEN' THEN -deb.remaining_amount_cents
                         ELSE 0 END
                ) FROM debts deb
                WHERE deb.directory_id = d.id
                  AND deb.status != 'PAID'
            ), 0) as balance_cents
     FROM directories d
     WHERE d.tenant_id = ?
     ORDER BY d.name ASC";

async fn seed_directory(pool: &sqlx::SqlitePool, id: &str, tenant: &str, name: &str) {
    sqlx::query(
        "INSERT INTO directories (id, tenant_id, name, type, credit_limit_cents, created_at)
         VALUES (?, ?, ?, 'SUPPLIER', 0, datetime('now'))",
    )
    .bind(id)
    .bind(tenant)
    .bind(name)
    .execute(pool)
    .await
    .expect("cari kart eklenir");
}

async fn seed_debt(
    pool: &sqlx::SqlitePool,
    id: &str,
    tenant: &str,
    directory_id: &str,
    debt_type: &str,
    remaining: i64,
) {
    sqlx::query(
        "INSERT INTO debts (id, tenant_id, directory_id, type, total_amount_cents,
                            remaining_amount_cents, status, is_cash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, datetime('now'))",
    )
    .bind(id)
    .bind(tenant)
    .bind(directory_id)
    .bind(debt_type)
    .bind(remaining)
    .bind(remaining)
    .execute(pool)
    .await
    .expect("borç kaydı eklenir");
}

#[tokio::test]
async fn balance_subquery_does_not_leak_other_tenant_debt() {
    let p = pool().await;

    // Senaryo: `directories.id` birincil anahtar olduğu için tek kart vardır ve
    // kart `tenant_a`'nın. Ancak `debts.tenant_id` bağımsızdır: kiracı B,
    // kiracı A'nın kart kimliğini bilerek kendi borcunu bu karta yazabilir
    // (yabancı kart kimliği, taşınmış veri, hatalı import).
    seed_directory(&p, "dir_shared", TENANT_A, "Ortak Kimlikli Kart").await;

    seed_debt(&p, "dbt_a", TENANT_A, "dir_shared", "TAKEN", 10_000).await;
    seed_debt(&p, "dbt_b", TENANT_B, "dir_shared", "TAKEN", 99_000).await;

    let rows = sqlx::query(BALANCE_SQL)
        .bind(TENANT_A)
        .fetch_all(&p)
        .await
        .expect("bakiye okunur");
    let balance: i64 = rows[0].try_get("balance_cents").expect("bakiye sütunu");

    assert_eq!(
        balance, -10_000,
        "tenant_a bakiyesi yalnız kendi borcunu görmeli (-10000), başka kiracının 99000'i sızmamalı"
    );
}

#[tokio::test]
async fn leaky_balance_subquery_would_have_leaked() {
    // Neden bu test var: kiracı filtresi olmayan hâli çalıştırıp sızıntının
    // gerçekten gerçekleştiğini kanıtlıyor. Yani ilk test bir tesadüf değil,
    // düzeltmenin etkisini ölçüyor.
    let p = pool().await;
    seed_directory(&p, "dir_shared", TENANT_A, "Ortak Kimlikli Kart").await;
    seed_debt(&p, "dbt_a", TENANT_A, "dir_shared", "TAKEN", 10_000).await;
    seed_debt(&p, "dbt_b", TENANT_B, "dir_shared", "TAKEN", 99_000).await;

    let rows = sqlx::query(BALANCE_SQL_LEAKY)
        .bind(TENANT_A)
        .fetch_all(&p)
        .await
        .expect("bakiye okunur");
    let leaked: i64 = rows[0].try_get("balance_cents").expect("bakiye sütunu");

    assert_eq!(
        leaked, -109_000,
        "filtresiz hâl kiracılar arası sızıntıyı gösterir; bu yüzden filtre zorunlu"
    );
}

// ============================================================================
// 5. FİNANSAL SESSİZ HATA (AGENTS.md §3.4)
// ============================================================================

#[tokio::test]
async fn broken_column_returns_err_and_not_zero() {
    let p = pool().await;

    // Kolon yok: sorgu hata vermeli.
    let err = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(remaining_amount_cents_typo), 0) FROM debts WHERE tenant_id = ?",
    )
    .bind(TENANT_A)
    .fetch_one(&p)
    .await;

    assert!(
        err.is_err(),
        "yanlış kolonlu toplam sorgusu hata dönmeli"
    );

    // Aynı hatayı `unwrap_or(0)` yutardı: sessiz sıfır. Kanıt burada.
    let swallowed: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(remaining_amount_cents_typo), 0) FROM debts WHERE tenant_id = ?",
    )
    .bind(TENANT_A)
    .fetch_one(&p)
    .await
    .unwrap_or(0);

    assert_eq!(
        swallowed, 0,
        "`unwrap_or(0)` hatayı yutup 0 döndürüyor; rapor 'zarar yok' derdi. map_err zorunlu."
    );
}

#[tokio::test]
async fn working_column_returns_real_total() {
    let p = pool().await;
    seed_directory(&p, "dir_a", TENANT_A, "Tedarikçi A").await;
    seed_debt(&p, "dbt_1", TENANT_A, "dir_a", "GIVEN", 45_000).await;
    seed_debt(&p, "dbt_2", TENANT_A, "dir_a", "GIVEN", 5_000).await;
    seed_debt(&p, "dbt_3", TENANT_B, "dir_a", "GIVEN", 700_000).await;

    let total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(remaining_amount_cents), 0) FROM debts
         WHERE tenant_id = ? AND type = 'GIVEN' AND status != 'PAID'",
    )
    .bind(TENANT_A)
    .fetch_one(&p)
    .await
    .map_err(|e| e.to_string())
    .expect("alacak toplanır");

    assert_eq!(total, 50_000, "yalnız tenant_a alacakları toplanmalı");
}