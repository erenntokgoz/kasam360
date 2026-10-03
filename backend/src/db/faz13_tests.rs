//! Faz 13 · Kroki çizim migration regresyonları.
//!
//! Kapsam dışı bırakılırsa iki sessiz hata geri gelir:
//!   1. `floor_zones.tenant_id` üzerinde `DEFAULT 'DEFAULT_TENANT'` durursa
//!      bind edilmemiş bir bölüm diğer işletmelerin salonunda görünür.
//!   2. `tables` rebuild'i kroki geometrisini sessizce düşürür.

use crate::db::faz13::migrate_floor_plan_layout;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::Row;

async fn legacy_tables_pool() -> sqlx::Pool<sqlx::Sqlite> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::raw_sql(
        "CREATE TABLE tables (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'AVAILABLE',
            opened_at DATETIME,
            waiter_id TEXT,
            current_total INTEGER NOT NULL DEFAULT 0
         );
         INSERT INTO tables (id, tenant_id, name, status, current_total) VALUES
             ('tbl_1', 'tenant-a', 'Masa 1', 'AVAILABLE', 0),
             ('tbl_2', 'tenant-b', 'Masa 2', 'OCCUPIED', 15000);",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool
}

/// `tables` rebuild'inin **gerçekten çalıştığını** gösteren legacy şema.
///
/// Neden ayrı havuz: `CREATE TABLE ... AS SELECT` kolon kısıtlarını (NOT NULL,
/// DEFAULT) ve bildirilen tipi **düşürür**. Bu yüzden onunla tetiklenen
/// "rebuild testleri" rebuild'i hiç çalıştırmadan yeşil görünür; test kendi
/// konusunu test etmeden geçer. Gerçek tetikleyici `current_total REAL`
/// olmak üzere tipin kendisidir.
async fn legacy_real_tables_pool() -> sqlx::Pool<sqlx::Sqlite> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::raw_sql(
        "CREATE TABLE tables (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'AVAILABLE',
            opened_at DATETIME,
            waiter_id TEXT,
            current_total REAL NOT NULL DEFAULT 0
         );
         INSERT INTO tables (id, tenant_id, name, status, current_total) VALUES
             ('tbl_1', 'tenant-a', 'Masa 1', 'AVAILABLE', 0),
             ('tbl_2', 'tenant-b', 'Masa 2', 'OCCUPIED', 15000);",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool
}

/// Kolonun bildirilen tipi. `REAL` kaldıysa rebuild çalışmamıştır.
async fn column_type(pool: &sqlx::Pool<sqlx::Sqlite>, table: &str, column: &str) -> String {
    let sql = format!("SELECT type FROM pragma_table_info('{table}') WHERE name = '{column}'");
    sqlx::query_scalar::<_, String>(&sql)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn column_exists(pool: &sqlx::Pool<sqlx::Sqlite>, table: &str, column: &str) -> bool {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?")
        .bind(table)
        .bind(column)
        .fetch_one(pool)
        .await
        .unwrap()
        > 0
}

/// `tenant_id` kolonunda varsayılan değer taşıyan satır sayısı. 0 ise kolon
/// NOT NULL ve varsayımansız demektir.
async fn tenant_default_count(pool: &sqlx::Pool<sqlx::Sqlite>, table: &str) -> i64 {
    let sql = format!(
        "SELECT COUNT(*) FROM pragma_table_info('{table}')
          WHERE name = 'tenant_id' AND dflt_value IS NOT NULL"
    );
    sqlx::query_scalar::<_, i64>(&sql)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn floor_migration_masa_geometrisi_kolonlarini_ekler() {
    let pool = legacy_tables_pool().await;
    migrate_floor_plan_layout(&pool).await.unwrap();

    for kolon in ["x", "y", "rotation", "seats", "zone"] {
        assert!(
            column_exists(&pool, "tables", kolon).await,
            "masa geometrisi kolonu eksik: {kolon}"
        );
    }
}

#[tokio::test]
async fn floor_migration_geometri_varsayilanlari_bos_masa_yiginini_agir_lastirmesin() {
    let pool = legacy_tables_pool().await;
    migrate_floor_plan_layout(&pool).await.unwrap();

    // Varsayılanlar bilinçli: yeni kolonlar NOT NULL olmalı ki mevcut satırlar
    // geçerli kalsın, ama x/y sıfır olmak "kimse çizmedi" demektir.
    let satir = sqlx::query("SELECT x, y, rotation, seats, zone FROM tables WHERE id = 'tbl_1'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(satir.try_get::<i64, _>("x").unwrap(), 0);
    assert_eq!(satir.try_get::<i64, _>("y").unwrap(), 0);
    assert_eq!(satir.try_get::<i64, _>("rotation").unwrap(), 0);
    assert_eq!(satir.try_get::<i64, _>("seats").unwrap(), 4);
    assert!(
        satir
            .try_get::<Option<String>, _>("zone")
            .unwrap()
            .is_none(),
        "bölümlenmemiş masa None vermeli, boş string değil"
    );
}

#[tokio::test]
async fn floor_migration_her_kiracinin_mazasini_korur() {
    let pool = legacy_tables_pool().await;
    migrate_floor_plan_layout(&pool).await.unwrap();

    let kiranci: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM tables WHERE tenant_id = 'tenant-b'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(kiranci, 1, "başka kiracının masası kayboldu");

    let isim: String = sqlx::query_scalar("SELECT name FROM tables WHERE tenant_id = 'tenant-b'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(isim, "Masa 2");
}

#[tokio::test]
async fn floor_migration_tekrar_calistirilir() {
    let pool = legacy_tables_pool().await;
    migrate_floor_plan_layout(&pool).await.unwrap();
    // İkinci koşu aynı sonucu vermeli; eklenmeye çalışılan kolon hatası
    // yutulur, kalan iş yine tamamlanır.
    migrate_floor_plan_layout(&pool).await.unwrap();

    let masa: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tables")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(masa, 2, "ikinci koşu satır kaybettirmemeli");
}

#[tokio::test]
async fn floor_migration_bolum_ve_obje_tablolarini_kurur() {
    let pool = legacy_tables_pool().await;
    migrate_floor_plan_layout(&pool).await.unwrap();

    for tablo in ["floor_zones", "floor_objects"] {
        assert!(
            column_exists(&pool, tablo, "id").await,
            "tablo kurulmamış: {tablo}"
        );
    }
}

#[tokio::test]
async fn floor_migration_yeni_tablolarda_tenant_varsayilani_yok() {
    let pool = legacy_tables_pool().await;
    migrate_floor_plan_layout(&pool).await.unwrap();

    // AGENTS.md §3.3: bind edilmemiş satır ortak havuza düşerse çapraz kiracı
    // sızıntısı olur. Varsayılan olmayınca SQLite hata verir.
    assert_eq!(
        tenant_default_count(&pool, "floor_zones").await,
        0,
        "floor_zones.tenant_id varsayılan taşıyor; çapraz kiracı sızıntısı kapısı açık"
    );
    assert_eq!(
        tenant_default_count(&pool, "floor_objects").await,
        0,
        "floor_objects.tenant_id varsayılan taşıyor; çapraz kiracı sızıntısı kapısı açık"
    );
}

#[tokio::test]
async fn floor_migration_tenant_id_silinince_yazma_hata_verir() {
    let pool = legacy_tables_pool().await;
    migrate_floor_plan_layout(&pool).await.unwrap();

    // Kanıt: tenant_id bind edilmediğinde satır yazılamaz.
    let sonuc = sqlx::query(
        "INSERT INTO floor_zones (id, name, created_at, updated_at)
         VALUES ('zon_1', 'Ana Salon', '2026-01-01', '2026-01-01')",
    )
    .execute(&pool)
    .await;
    assert!(
        sonuc.is_err(),
        "tenant_id verilmeden bölüm yazılabiliyor; varsayılan sızıntısı var"
    );
}

#[tokio::test]
async fn floor_migration_obje_turleri_kisitli() {
    let pool = legacy_tables_pool().await;
    migrate_floor_plan_layout(&pool).await.unwrap();

    sqlx::query(
        "INSERT INTO floor_objects (id, tenant_id, kind, created_at, updated_at)
         VALUES ('obj_1', 'tenant-a', 'BAR', '2026-01-01', '2026-01-01')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let bozuk = sqlx::query(
        "INSERT INTO floor_objects (id, tenant_id, kind, created_at, updated_at)
         VALUES ('obj_2', 'tenant-a', 'HAVUZ', '2026-01-01', '2026-01-01')",
    )
    .execute(&pool)
    .await;
    assert!(
        bozuk.is_err(),
        "katalog dışı obje türü kabul edildi; CHECK kısıtı çalışmıyor"
    );
}

#[tokio::test]
async fn floor_migration_obje_sahiplik_etiketi_ekler() {
    let pool = legacy_tables_pool().await;
    migrate_floor_plan_layout(&pool).await.unwrap();

    // `template_id` hangi objenin şablondan geldiğini işaretler. Kolon
    // eklenmezse şablon yeniden uygulandığında kullanıcının elle koyduğu
    // objeleri silmekten başka çare kalmaz.
    assert!(
        column_exists(&pool, "floor_objects", "template_id").await,
        "floor_objects.template_id kolonu eksik; şablon el emeğini siler"
    );
}

#[tokio::test]
async fn floor_migration_elle_olan_obje_sablondan_ayirt_edilir() {
    let pool = legacy_tables_pool().await;
    migrate_floor_plan_layout(&pool).await.unwrap();

    sqlx::query(
        "INSERT INTO floor_objects (id, tenant_id, kind, template_id, created_at, updated_at)
         VALUES ('obj_1', 'tenant-a', 'BAR', NULL, '2026-01-01', '2026-01-01'),
                ('obj_2', 'tenant-a', 'BAR', 'klasik_kafe', '2026-01-01', '2026-01-01')",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Yalnız etiketli obje şablon hedefidir.
    let elle: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM floor_objects WHERE template_id IS NULL")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(elle, 1, "elle konan obje şablona bağlandı");
}

/// Rebuild'in gerçekten çalıştığını doğrular. `CREATE TABLE AS SELECT` ile
/// tetiklenen testler bunu atlardı; tip değişmeden "rebuild geçti" denemez.
async fn rebuildin_tetiklendigini_kanitla(pool: &sqlx::Pool<sqlx::Sqlite>) {
    assert_eq!(
        column_type(pool, "tables", "current_total").await,
        "INTEGER",
        "rebuild çalışmamış; bu test kendi konusunu sınamadan geçiyor"
    );
}

#[tokio::test]
async fn tables_rebuild_tenant_varsayilanini_kaldirir() {
    use crate::db::tables_migration::migrate_tables_current_total_to_integer;

    let pool = legacy_real_tables_pool().await;
    migrate_floor_plan_layout(&pool).await.unwrap();

    // Legacy şemada `tenant_id DEFAULT 'DEFAULT_TENANT'` var. Rebuild sonrası
    // hedef tanımda varsayılan **kalmamalı**: kalsa bind edilmemiş bir
    // INSERT sessizce ortak havuza düşer (AGENTS.md §3.3).
    assert_eq!(
        tenant_default_count(&pool, "tables").await,
        1,
        "test ön koşulu bozuldu; legacy şema artık varsayılan taşımıyor"
    );

    migrate_tables_current_total_to_integer(&pool)
        .await
        .unwrap();
    rebuildin_tetiklendigini_kanitla(&pool).await;

    assert_eq!(
        tenant_default_count(&pool, "tables").await,
        0,
        "rebuild tenant varsayılanını kaldırmadı; çapraz kiracı sızıntısı kapısı açık"
    );
}

#[tokio::test]
async fn tables_rebuild_tenant_verilmeden_yazma_hata_verir() {
    use crate::db::tables_migration::migrate_tables_current_total_to_integer;

    let pool = legacy_real_tables_pool().await;
    migrate_floor_plan_layout(&pool).await.unwrap();
    migrate_tables_current_total_to_integer(&pool)
        .await
        .unwrap();
    rebuildin_tetiklendigini_kanitla(&pool).await;

    let sonuc = sqlx::query(
        "INSERT INTO tables (id, name, status, current_total)
         VALUES ('tbl_9', 'Sizma Denemesi', 'AVAILABLE', 0)",
    )
    .execute(&pool)
    .await;
    assert!(
        sonuc.is_err(),
        "tenant_id verilmeden masa yazılabiliyor; kiracı izolasyonu delinmiş"
    );
}

#[tokio::test]
async fn tables_rebuild_gecmis_satirlari_kaybetmez() {
    use crate::db::tables_migration::migrate_tables_current_total_to_integer;

    let pool = legacy_real_tables_pool().await;
    migrate_floor_plan_layout(&pool).await.unwrap();
    migrate_tables_current_total_to_integer(&pool)
        .await
        .unwrap();
    rebuildin_tetiklendigini_kanitla(&pool).await;

    // Varsayılan kaldırıldı ama geçmiş satırların kirası korunmalı:
    // migration bir veri kaybı aracı olamaz.
    let adet: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tables WHERE tenant_id IS NOT NULL")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(adet, 2, "rebuild geçmiş masa kayıtlarını kaybetti");

    // Kuruş tutarı da korunmalı: 15000 -> 15000, float'a dönüşmemeli.
    let tutar: i64 = sqlx::query_scalar("SELECT current_total FROM tables WHERE id = 'tbl_2'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(tutar, 15000, "rebuild kuruş tutarını bozdu");
}

#[tokio::test]
async fn tables_rebuild_kroki_geometrisini_kaybetmez() {
    use crate::db::tables_migration::migrate_tables_current_total_to_integer;

    let pool = legacy_real_tables_pool().await;
    // Önce kroki geometrisi eklenir, sonra rebuild tetiklenir: hedef tanım
    // geometriyi de taşımalı, yoksa salon sessizce eski haline döner.
    migrate_floor_plan_layout(&pool).await.unwrap();
    sqlx::query("UPDATE tables SET x = 120, y = 240, rotation = 90, seats = 6, zone = 'zon_1' WHERE id = 'tbl_1'")
        .execute(&pool)
        .await
        .unwrap();

    migrate_tables_current_total_to_integer(&pool)
        .await
        .unwrap();
    // Kanıt: rebuild gerçekten çalıştı. Aksi halde geometri korunmuş
    // görünür çünkü hiçbir şey değişmedi.
    rebuildin_tetiklendigini_kanitla(&pool).await;

    let satir = sqlx::query("SELECT x, y, rotation, seats, zone FROM tables WHERE id = 'tbl_1'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        satir.try_get::<i64, _>("x").unwrap(),
        120,
        "rebuild kroki x koordinatını düşürdü"
    );
    assert_eq!(satir.try_get::<i64, _>("y").unwrap(), 240);
    assert_eq!(satir.try_get::<i64, _>("rotation").unwrap(), 90);
    assert_eq!(satir.try_get::<i64, _>("seats").unwrap(), 6);
    assert_eq!(
        satir.try_get::<Option<String>, _>("zone").unwrap(),
        Some("zon_1".to_string())
    );
}
