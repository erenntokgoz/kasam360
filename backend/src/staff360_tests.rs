//! Faz 11 B4/B5 — bordro, bahşiş havuzu, KPI ve radar testleri.
//!
//! Her test gerçek SQLite şeması üzerinde çalışır ve **hesabın tutarlığını**
//! kanıtlar: kuruş kaybı yok, tenant sızmıyor, yetkisiz çağıran tutar görmüyor.

use chrono::Datelike;
use sqlx::SqlitePool;

use crate::services::staff360::payroll_types::{PayrollRuleInput, TipAllocationInput};
use crate::services::staff360::{
    kpi_service, payroll_service, staff_service, suspicious_service, tip_service,
};

async fn pool() -> SqlitePool {
    let p = SqlitePool::connect("sqlite::memory:").await.expect("hafıza");
    sqlx::raw_sql(include_str!("../migrations/schema.sql"))
        .execute(&p)
        .await
        .expect("şema");
    p
}

async fn kullanici(p: &SqlitePool, tenant: &str, id: &str, ad: &str, rol: &str) {
    sqlx::query("INSERT INTO users (id, tenant_id, role, name, is_active) VALUES (?1,?2,?3,?4,1)")
        .bind(id)
        .bind(tenant)
        .bind(rol)
        .bind(ad)
        .execute(p)
        .await
        .expect("kullanıcı");
}

async fn kasa(p: &SqlitePool, tenant: &str, id: &str) {
    sqlx::query(
        "INSERT INTO tables (id, tenant_id, name, status, waiter_id) VALUES (?1,?2,?3,'AVAILABLE',NULL)",
    )
    .bind(id)
    .bind(tenant)
    .bind(id)
    .execute(p)
    .await
    .expect("masa");
}

/// `tag` tenant'a özgüdür: `products.id` ve `categories.id` global birincil
/// anahtardır, iki kiracı aynı kimliği kullanamaz.
async fn urun(p: &SqlitePool, tenant: &str, tag: &str) {
    let kat = format!("cat_{tag}");
    let urun_id = format!("prd_{tag}");
    sqlx::query("INSERT INTO categories (id, tenant_id, name) VALUES (?1,?2,'Kahve')")
        .bind(&kat)
        .bind(tenant)
        .execute(p)
        .await
        .expect("kategori");
    sqlx::query(
        "INSERT INTO products (id, tenant_id, name, category_id, price_cents) VALUES (?1,?2,?3,?4,2500)",
    )
    .bind(&urun_id)
    .bind(tenant)
    .bind(format!("Espresso {tag}"))
    .bind(&kat)
    .execute(p)
    .await
    .expect("ürün");
}

/// Sipariş + kalem + istenen garson. `created_at` **açıkça** verilir: bordro
/// dönemi (`YYYY-MM`) ve KPI aralığı gerçek tarihle karşılaştırır, "bugün"
/// varsayımı testi sessizce boşa çıkarırdı.
async fn siparis(
    p: &SqlitePool,
    tenant: &str,
    oid: &str,
    kasiyer: &str,
    garson: &str,
    toplam: i64,
    durum: &str,
    created_at: &str,
) {
    sqlx::query(
        "INSERT INTO orders (id, tenant_id, table_id, status, total_cents, cashier_id, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
    )
    .bind(oid)
    .bind(tenant)
    .bind("tbl_1")
    .bind(durum)
    .bind(toplam)
    .bind(kasiyer)
    .bind(created_at)
    .execute(p)
    .await
    .expect("sipariş");
    // Ürün kimliği kiracının kendi ürünüdür: `product_id` global FK'dir, yanlış
    // işletmenin ürününe bağlamak testin konusunu bozardı.
    let urun_id: String = sqlx::query_scalar(
        "SELECT id FROM products WHERE tenant_id = ?1 ORDER BY id LIMIT 1",
    )
    .bind(tenant)
    .fetch_one(p)
    .await
    .expect("ürün");
    sqlx::query(
        "INSERT INTO order_items (id, tenant_id, order_id, product_id, quantity, total_cents, waiter_id)
         VALUES (?1,?2,?3,?4,1,?5,?6)",
    )
    .bind(format!("oi_{oid}"))
    .bind(tenant)
    .bind(oid)
    .bind(&urun_id)
    .bind(toplam)
    .bind(garson)
    .execute(p)
    .await
    .expect("kalem");
}

// ---------------------------------------------------------------------------
// Bahşiş havuzu
// ---------------------------------------------------------------------------

#[tokio::test]
async fn havuz_toplami_gercek_bahsis_toplamidir() {
    let p = pool().await;
    tip_service::record_tip(&p, "tenant_a", Some("ord_1"), 5_000, "2026-03-10T12:00:00Z")
        .await
        .expect("bahşiş");
    tip_service::record_tip(&p, "tenant_a", Some("ord_2"), 3_500, "2026-03-11T12:00:00Z")
        .await
        .expect("bahşiş");
    // Farklı dönem: toplama girmemeli.
    tip_service::record_tip(&p, "tenant_a", Some("ord_3"), 9_000, "2026-04-01T12:00:00Z")
        .await
        .expect("bahşiş");

    let mart = tip_service::pool_total(&p, "tenant_a", "2026-03").await.expect("toplam");
    assert_eq!(mart, 8_500, "dönem filtresi çalışmıyor");
    let nisan = tip_service::pool_total(&p, "tenant_a", "2026-04").await.expect("toplam");
    assert_eq!(nisan, 9_000);
}

#[tokio::test]
async fn havuz_baska_kiraci_tutarini_gormez() {
    let p = pool().await;
    tip_service::record_tip(&p, "tenant_a", None, 5_000, "2026-03-10T12:00:00Z")
        .await
        .expect("bahşiş");
    tip_service::record_tip(&p, "tenant_b", None, 77_000, "2026-03-10T12:00:00Z")
        .await
        .expect("bahşiş");

    let a = tip_service::pool_total(&p, "tenant_a", "2026-03").await.expect("toplam");
    assert_eq!(a, 5_000, "başka işletmenin bahşişi sızdı");
}

#[tokio::test]
async fn dagitimda_kurus_kaybi_olmaz() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    kullanici(&p, "tenant_a", "usr_2", "Bora", "WAITER").await;
    kullanici(&p, "tenant_a", "usr_3", "Ceren", "WAITER").await;
    // 100 kuruş, üç eşit olmayan tabana bölünecek: 33/33/34 gibi bir dağılım
    // olmalı ve toplam **tam olarak** 100 kalmalı.
    tip_service::record_tip(&p, "tenant_a", None, 100, "2026-03-10T12:00:00Z")
        .await
        .expect("bahşiş");

    let dagilim = tip_service::distribute_pool(
        &p,
        "tenant_a",
        "2026-03",
        &[
            TipAllocationInput { user_id: "usr_1".into(), basis_cents: 1, multiplier_percent: 100 },
            TipAllocationInput { user_id: "usr_2".into(), basis_cents: 1, multiplier_percent: 100 },
            TipAllocationInput { user_id: "usr_3".into(), basis_cents: 1, multiplier_percent: 100 },
        ],
    )
    .await
    .expect("dağıtım");

    let toplam: i64 = dagilim.iter().map(|d| d.amount_cents).sum();
    assert_eq!(toplam, 100, "dağıtım havuzla uyuşmuyor, {toplam} kuruş dağıtıldı");
    assert!(dagilim.iter().all(|d| d.amount_cents > 0), "bir kişi hiç pay almamalı");

    let ozet = tip_service::pool_summary(&p, "tenant_a", "2026-03").await.expect("özet");
    assert_eq!(ozet.leftover_cents, 0, "dağıtılmamış kuruş kalmalı");
}

#[tokio::test]
async fn dagitim_tabani_sifirsa_hata_verir_kayip_sessizce_olmaz() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    tip_service::record_tip(&p, "tenant_a", None, 5_000, "2026-03-10T12:00:00Z")
        .await
        .expect("bahşiş");

    let sonuc = tip_service::distribute_pool(
        &p,
        "tenant_a",
        "2026-03",
        &[TipAllocationInput { user_id: "usr_1".into(), basis_cents: 0, multiplier_percent: 100 }],
    )
    .await;
    assert!(sonuc.is_err(), "sıfır tabanla dağıtım yapılmamalı");

    // Havuz hâlâ tam durmalı: sessizce dağıtılmış gibi görünmemeli.
    let ozet = tip_service::pool_summary(&p, "tenant_a", "2026-03").await.expect("özet");
    assert_eq!(ozet.leftover_cents, 5_000, "hatalı dağıtım havuzu yemiş");
}

#[tokio::test]
async fn katsayi_payagini_gercekten_degistirir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    kullanici(&p, "tenant_a", "usr_2", "Bora", "WAITER").await;
    tip_service::record_tip(&p, "tenant_a", None, 10_000, "2026-03-10T12:00:00Z")
        .await
        .expect("bahşiş");

    let dagilim = tip_service::distribute_pool(
        &p,
        "tenant_a",
        "2026-03",
        &[
            TipAllocationInput { user_id: "usr_1".into(), basis_cents: 1_000, multiplier_percent: 200 },
            TipAllocationInput { user_id: "usr_2".into(), basis_cents: 1_000, multiplier_percent: 100 },
        ],
    )
    .await
    .expect("dağıtım");

    let a = dagilim.iter().find(|d| d.user_id == "usr_1").expect("kayıt");
    let b = dagilim.iter().find(|d| d.user_id == "usr_2").expect("kayıt");
    assert_eq!(a.amount_cents, 6_666, "200% katsayı iki kat pay vermeli");
    assert_eq!(b.amount_cents, 3_334);
    assert_eq!(a.amount_cents + b.amount_cents, 10_000);
}

#[tokio::test]
async fn bos_havuz_dagitim_hatasi_verir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    let sonuc = tip_service::distribute_pool(
        &p,
        "tenant_a",
        "2026-03",
        &[TipAllocationInput { user_id: "usr_1".into(), basis_cents: 1_000, multiplier_percent: 100 }],
    )
    .await;
    assert!(sonuc.is_err(), "havuz boşken dağıtım yapılmamalı");
}

#[tokio::test]
async fn negatif_bahsis_kaydedilmez() {
    let p = pool().await;
    let sonuc = tip_service::record_tip(&p, "tenant_a", None, -500, "2026-03-10T12:00:00Z").await;
    assert!(sonuc.is_err(), "negatif bahşiş havuzu küçültürdü");
    let sonuc = tip_service::record_tip(&p, "tenant_a", None, 0, "2026-03-10T12:00:00Z").await;
    assert!(sonuc.is_err(), "sıfır bahşiş kaydı kirlilik üretir");
}

// ---------------------------------------------------------------------------
// Maaş
// ---------------------------------------------------------------------------

#[tokio::test]
async fn sabit_maas_modeli_temiz_hesaplanir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "FIXED".into(),
            base_salary_cents: 25_000,
            commission_percent: 0,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
        },
    )
    .await
    .expect("kural");

    let runs = payroll_service::run_payroll(&p, "tenant_a", "2026-03", true)
        .await
        .expect("bordro");
    assert_eq!(runs.len(), 1);
    let a = runs[0].amounts.as_ref().expect("sahip tutarı görmeli");
    assert_eq!(a.base_cents, 25_000);
    assert_eq!(a.gross_cents, 25_000);
    assert_eq!(a.net_cents, 25_000);
    assert!(runs[0].warning.is_none(), "temiz hesapta uyarı olmamalı");
}

#[tokio::test]
async fn komisyon_kendi_satisindan_hesaplanir() {
    let p = pool().await;
    kasa(&p, "tenant_a", "tbl_1").await;
    urun(&p, "tenant_a", "a").await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    kullanici(&p, "tenant_a", "usr_k", "Kasiyer", "CASHIER").await;
    siparis(&p, "tenant_a", "ord_1", "usr_k", "usr_1", 20_000, "PAID", "2026-03-10 12:00:00").await;
    siparis(&p, "tenant_a", "ord_2", "usr_k", "usr_1", 10_000, "PAID", "2026-03-11 12:00:00").await;

    payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "COMMISSION".into(),
            base_salary_cents: 0,
            commission_percent: 10,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
        },
    )
    .await
    .expect("kural");

    let runs = payroll_service::run_payroll(&p, "tenant_a", "2026-03", true)
        .await
        .expect("bordro");
    let a = runs[0].amounts.as_ref().expect("tutar");
    // 30.000 kuruş satışın %10'u = 3.000 kuruş.
    assert_eq!(a.commission_cents, 3_000, "komisyon yanlış tabandan hesaplandı");
    assert_eq!(a.gross_cents, 3_000);
}

#[tokio::test]
async fn komisyon_satis_yoksa_uyari_verir_sifir_yazmaz() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "COMMISSION".into(),
            base_salary_cents: 0,
            commission_percent: 10,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
        },
    )
    .await
    .expect("kural");

    let runs = payroll_service::run_payroll(&p, "tenant_a", "2026-03", true)
        .await
        .expect("bordro");
    let uyari = runs[0].warning.as_ref().expect("uyari olmalı");
    assert!(uyari.contains("satış kaydı yok"), "uyari metni: {uyari}");
    // Tutar 0 çünkü gerçekten satış yok; ama ekranda "hesaplanmadı" yazar.
    assert_eq!(runs[0].amounts.as_ref().expect("tutar").commission_cents, 0);
}

#[tokio::test]
async fn saatlik_model_kapanmis_vardiye_saati_uzerinden_hesaplanir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "CASHIER").await;
    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, cashier_id, status, opened_at, closed_at, expected_amount_cents)
         VALUES ('shf_1','tenant_a','usr_1','CLOSED', '2026-03-10 09:00:00', '2026-03-10 17:00:00', 0)",
    )
    .execute(&p)
    .await
    .expect("vardiya");

    payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "HOURLY".into(),
            base_salary_cents: 0,
            commission_percent: 0,
            hourly_rate_cents: 500,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
        },
    )
    .await
    .expect("kural");

    let runs = payroll_service::run_payroll(&p, "tenant_a", "2026-03", true)
        .await
        .expect("bordro");
    let saat = runs[0].amounts.as_ref().expect("tutar").hourly_cents;
    // 8 saatlik vardiya, saat 500 kuruş → ~4.000 kuruş. Küçük zaman farkı
    // toleransı: yuvarlama 4.000 ± 10 aralığında olmalı.
    assert!(
        (3_990..=4_010).contains(&saat),
        "8 saat × 500 kuruş ≈ 4.000, gelen {saat}"
    );
}

#[tokio::test]
async fn müdür_maas_tutarini_gormez() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "FIXED".into(),
            base_salary_cents: 25_000,
            commission_percent: 0,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
        },
    )
    .await
    .expect("kural");

    // Müdür görünümü: kural ve model görünür, tutar `None`.
    let kurallar = payroll_service::list_rules(&p, "tenant_a", false).await.expect("kurallar");
    assert_eq!(kurallar.len(), 1, "müdür kural listesini görebilmeli");
    assert_eq!(kurallar[0].base_salary_cents, 0, "gizli görünümde tutar sıfırlanır");
    assert!(kurallar[0].base_salary_cents == 0);

    let bordro = payroll_service::run_payroll(&p, "tenant_a", "2026-03", false)
        .await
        .expect("bordro");
    assert!(
        bordro[0].amounts.is_none(),
        "müdüre maaş tutarı sızdı — `None` olmalıydı"
    );
    // Kişi, model ve dönem görünür: müdür planı anlayabilmeli.
    assert_eq!(bordro[0].full_name, "Ayşe");
    assert_eq!(bordro[0].model, "FIXED");
}

#[tokio::test]
async fn gecersiz_maas_modeli_reddedilir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    let sonuc = payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "HEDIYE".into(),
            base_salary_cents: 1_000,
            commission_percent: 0,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
        },
    )
    .await;
    assert!(sonuc.is_err(), "bilinmeyen model sessizce kabul edilmemeli");
}

#[tokio::test]
async fn bordro_olmayan_calisan_icin_hata_verir() {
    let p = pool().await;
    let sonuc = payroll_service::run_payroll(&p, "tenant_a", "2026-03", true).await;
    assert!(sonuc.is_err(), "kural yokken bordro \"0 kişi\" dönmemeli");
}

#[tokio::test]
async fn maas_kurali_baska_kiraciya_yazilamaz() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    let sonuc = payroll_service::set_rule(
        &p,
        "tenant_b",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "FIXED".into(),
            base_salary_cents: 1_000,
            commission_percent: 0,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
        },
    )
    .await;
    assert!(sonuc.is_err(), "başka kiracının çalışanına maaş yazılamaz");
}

#[tokio::test]
async fn ayni_donem_bordro_yeniden_hesaplanabilir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "FIXED".into(),
            base_salary_cents: 25_000,
            commission_percent: 0,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
        },
    )
    .await
    .expect("kural");
    payroll_service::run_payroll(&p, "tenant_a", "2026-03", true).await.expect("bordro");
    // Maaş değişti: yeniden hesapta tek satır kalmalı, ikiye katlanmamalı.
    payroll_service::set_rule(
        &p,
        "tenant_a",
        &PayrollRuleInput {
            user_id: "usr_1".into(),
            model: "FIXED".into(),
            base_salary_cents: 30_000,
            commission_percent: 0,
            hourly_rate_cents: 0,
            tip_multiplier_percent: 100,
            profit_share_percent: 0,
        },
    )
    .await
    .expect("kural");
    payroll_service::run_payroll(&p, "tenant_a", "2026-03", true).await.expect("bordro");

    let satir: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM payroll_runs WHERE tenant_id = 'tenant_a' AND user_id = 'usr_1' AND period = '2026-03'",
    )
    .fetch_one(&p)
    .await
    .expect("say");
    assert_eq!(satir, 1, "her hesapta yeni satır açılmamalı (UPSERT)");
    let brut: i64 = sqlx::query_scalar(
        "SELECT gross_cents FROM payroll_runs WHERE tenant_id = 'tenant_a' AND user_id = 'usr_1'",
    )
    .fetch_one(&p)
    .await
    .expect("brüt");
    assert_eq!(brut, 30_000, "güncel maaş uygulanmamış");
}

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

#[tokio::test]
async fn kpi_garson_kalemlerinden_dogru_hesaplanir() {
    let p = pool().await;
    kasa(&p, "tenant_a", "tbl_1").await;
    urun(&p, "tenant_a", "a").await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    kullanici(&p, "tenant_a", "usr_k", "Kasiyer", "CASHIER").await;
    siparis(&p, "tenant_a", "ord_1", "usr_k", "usr_1", 20_000, "PAID", "2026-03-10 12:00:00").await;
    siparis(&p, "tenant_a", "ord_2", "usr_k", "usr_1", 10_000, "PAID", "2026-03-11 12:00:00").await;

    let kpi = kpi_service::kpi(&p, "tenant_a", "2000-01-01", "2100-01-01", Some("usr_1"))
        .await
        .expect("KPI");
    assert_eq!(kpi.len(), 1);
    assert_eq!(kpi[0].item_count, 2, "garsonun iki kalemi olmalı");
    assert_eq!(kpi[0].gross_sales_cents, 30_000);
    assert_eq!(kpi[0].top_product.as_deref(), Some("Espresso a"));
}

#[tokio::test]
async fn kpi_baska_kiraciyi_gormez() {
    let p = pool().await;
    kasa(&p, "tenant_a", "tbl_1").await;
    kasa(&p, "tenant_b", "tbl_2").await;
    urun(&p, "tenant_a", "a").await;
    urun(&p, "tenant_b", "b").await;
    // `users.id` global birincil anahtardır: aynı kimlik iki kiracıda
    // kullanılamaz. Sızıntı testi bu yüzden farklı kimliklerle kurulur.
    kullanici(&p, "tenant_a", "usr_a", "Ayşe A", "WAITER").await;
    kullanici(&p, "tenant_b", "usr_b", "Ayşe B", "WAITER").await;
    kullanici(&p, "tenant_b", "usr_k", "Kasiyer", "CASHIER").await;
    siparis(&p, "tenant_a", "ord_a1", "usr_k", "usr_a", 20_000, "PAID", "2026-03-10 12:00:00").await;
    siparis(&p, "tenant_b", "ord_b1", "usr_k", "usr_b", 99_000, "PAID", "2026-03-10 12:00:00").await;

    let kpi = kpi_service::kpi(&p, "tenant_a", "2000-01-01", "2100-01-01", None)
        .await
        .expect("KPI");
    assert_eq!(kpi.len(), 1, "kiraci A yalnız kendi personelini görmeli");
    assert_eq!(kpi[0].gross_sales_cents, 20_000, "başka işletmenin cirosu sızdı");
}

#[tokio::test]
async fn kpi_ters_tarih_araligini_reddeder() {
    let p = pool().await;
    let sonuc = kpi_service::kpi(&p, "tenant_a", "2026-03-31", "2026-03-01", None).await;
    assert!(sonuc.is_err(), "ters aralık \"0 satış\" gibi görünmemeli");
}

// ---------------------------------------------------------------------------
// Şüpheli işlem radarı
// ---------------------------------------------------------------------------

#[tokio::test]
async fn radar_az_orneklemli_iptalde_uyar_uretmez() {
    let p = pool().await;
    kasa(&p, "tenant_a", "tbl_1").await;
    urun(&p, "tenant_a", "a").await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "CASHIER").await;
    // 2 siparişin 2'si de iptal: oran %100 ama örneklem 2 < 5 → uyarı yok.
    siparis(&p, "tenant_a", "ord_1", "usr_1", "usr_1", 10_000, "VOID", "2026-03-10 12:00:00").await;
    siparis(&p, "tenant_a", "ord_2", "usr_1", "usr_1", 10_000, "VOID", "2026-03-11 12:00:00").await;

    let bayrak = suspicious_service::radar(&p, "tenant_a", "2000-01-01", "2100-01-01")
        .await
        .expect("radar");
    assert!(bayrak.is_empty(), "az örneklemli yüksek oran iftira olurdu: {bayrak:?}");
}

#[tokio::test]
async fn radar_yuksek_iptal_oranini_yakinlar() {
    let p = pool().await;
    kasa(&p, "tenant_a", "tbl_1").await;
    urun(&p, "tenant_a", "a").await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "CASHIER").await;
    for i in 1..=4 {
        siparis(&p, "tenant_a", &format!("ord_v{i}"), "usr_1", "usr_1", 10_000, "VOID", "2026-03-10 12:00:00").await;
    }
    for i in 1..=6 {
        siparis(&p, "tenant_a", &format!("ord_p{i}"), "usr_1", "usr_1", 10_000, "PAID", "2026-03-10 12:00:00").await;
    }

    let bayrak = suspicious_service::radar(&p, "tenant_a", "2000-01-01", "2100-01-01")
        .await
        .expect("radar");
    let iptal = bayrak.iter().find(|b| b.rule.contains("iptal")).expect("iptal bayrağı");
    assert_eq!(iptal.measured, "%40", "4/10 iptal = %40");
    assert!(iptal.threshold.contains("asgari 5"), "eşik raporda görünmeli");
}

#[tokio::test]
async fn radar_normal_isletmede_sessiz_kalir() {
    let p = pool().await;
    kasa(&p, "tenant_a", "tbl_1").await;
    urun(&p, "tenant_a", "a").await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "CASHIER").await;
    for i in 1..=20 {
        siparis(&p, "tenant_a", &format!("ord_{i}"), "usr_1", "usr_1", 10_000, "PAID", "2026-03-10 12:00:00").await;
    }
    let bayrak = suspicious_service::radar(&p, "tenant_a", "2000-01-01", "2100-01-01")
        .await
        .expect("radar");
    assert!(bayrak.is_empty(), "sağlıklı işletmede uyarı üretilmemeli: {bayrak:?}");
}

#[tokio::test]
async fn radar_gunluk_onay_yogunlugunu_yakinlar() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "CASHIER").await;
    for gun in 1..=4 {
        for _ in 0..7 {
            sqlx::query(
                "INSERT INTO approvals (id, tenant_id, request_type, resource_id, requester_id, status, payload, created_at)
                 VALUES (?1,'tenant_a','DISCOUNT',?2,'usr_1','APPROVED','{}', ?3)",
            )
            .bind(format!("apr_{gun}_{}", sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM approvals").fetch_one(&p).await.unwrap_or(0)))
            .bind(format!("ord_{gun}"))
            .bind(format!("2026-03-0{gun} 10:00:00"))
            .execute(&p)
            .await
            .expect("onay");
        }
    }
    let bayrak = suspicious_service::radar(&p, "tenant_a", "2026-03-01", "2026-03-31")
        .await
        .expect("radar");
    let onay = bayrak.iter().find(|b| b.rule.contains("onay")).expect("onay bayrağı");
    assert!(onay.measured.contains("7 onay/gun"), "ölçüm: {}", onay.measured);
}

// ---------------------------------------------------------------------------
// Personel servisi
// ---------------------------------------------------------------------------

#[tokio::test]
async fn profil_listesi_yalniz_aktif_personeli_gosterir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    kullanici(&p, "tenant_a", "usr_2", "Bora", "CASHIER").await;
    sqlx::query("UPDATE users SET is_active = 0 WHERE id = 'usr_2'")
        .execute(&p)
        .await
        .expect("pasif");

    for (uid, ad) in [("usr_1", "Ayşe Y"), ("usr_2", "Bora Pasif")] {
        let _ = staff_service::upsert_profile(
            &p,
            "tenant_a",
            "usr_boss",
            &crate::services::staff360::staff_types::StaffProfileInput {
                user_id: uid.into(),
                full_name: ad.into(),
                base_salary_cents: 20_000,
                commission_percent: 0,
                birth_date: None,
                hire_date: None,
                phone: None,
                national_id: None,
                address: None,
                emergency_contact: None,
                notes: None,
            },
        )
        .await;
    }

    let liste = staff_service::list_profiles(&p, "tenant_a").await.expect("liste");
    assert_eq!(liste.len(), 1, "pasif personel raporda görünmemeli");
    assert_eq!(liste[0].full_name, "Ayşe Y");
}

#[tokio::test]
async fn profil_kaydi_olmayan_kullaniciya_acilamaz() {
    let p = pool().await;
    let sonuc = staff_service::upsert_profile(
        &p,
        "tenant_a",
        "usr_boss",
        &crate::services::staff360::staff_types::StaffProfileInput {
            user_id: "usr_yok".into(),
            full_name: "Hayalet".into(),
            base_salary_cents: 0,
            commission_percent: 0,
            birth_date: None,
            hire_date: None,
            phone: None,
            national_id: None,
            address: None,
            emergency_contact: None,
            notes: None,
        },
    )
    .await;
    assert!(sonuc.is_err(), "hayalet personel kaydı açılmamalı");
}

#[tokio::test]
async fn negatif_maas_reddedilir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    let sonuc = staff_service::upsert_profile(
        &p,
        "tenant_a",
        "usr_boss",
        &crate::services::staff360::staff_types::StaffProfileInput {
            user_id: "usr_1".into(),
            full_name: "Ayşe".into(),
            base_salary_cents: -1,
            commission_percent: 0,
            birth_date: None,
            hire_date: None,
            phone: None,
            national_id: None,
            address: None,
            emergency_contact: None,
            notes: None,
        },
    )
    .await;
    assert!(sonuc.is_err());
}

#[tokio::test]
async fn vardiya_plani_bitmesi_baslamadan_once_olamaz() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    let sonuc = staff_service::add_shift_plan(
        &p,
        "tenant_a",
        "usr_boss",
        &crate::services::staff360::staff_types::ShiftPlanInput {
            user_id: "usr_1".into(),
            plan_date: "2026-03-10".into(),
            start_time: "22:00".into(),
            end_time: "02:00".into(),
            planned_break_minutes: 30,
            role_required: "WAITER".into(),
            station: None,
        },
    )
    .await;
    assert!(sonuc.is_err(), "gece vardiyası negatif saat olarak kaydedilmemeli");
}

#[tokio::test]
async fn izin_cakismasi_reddedilir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    let talep = crate::services::staff360::staff_types::LeaveInput {
        user_id: "usr_1".into(),
        kind: "YILLIK".into(),
        start_date: "2026-03-10".into(),
        end_date: "2026-03-15".into(),
        reason: None,
    };
    staff_service::request_leave(&p, "tenant_a", &talep).await.expect("ilk talep");
    let cakisma = staff_service::request_leave(&p, "tenant_a", &talep).await;
    assert!(cakisma.is_err(), "çakışan ikinci izin talebi kabul edilmemeli");
}

#[tokio::test]
async fn kendi_iznini_kendin_onaylayamazsin() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "MANAGER").await;
    let id = staff_service::request_leave(
        &p,
        "tenant_a",
        &crate::services::staff360::staff_types::LeaveInput {
            user_id: "usr_1".into(),
            kind: "YILLIK".into(),
            start_date: "2026-03-10".into(),
            end_date: "2026-03-12".into(),
            reason: None,
        },
    )
    .await
    .expect("talep");

    let sonuc = staff_service::decide_leave(&p, "tenant_a", "usr_1", &id, true).await;
    assert!(sonuc.is_err(), "kendi iznini kendi onaylaması yasak");
    let sonuc = staff_service::decide_leave(&p, "tenant_a", "usr_boss", &id, true).await;
    assert!(sonuc.is_ok(), "yetkili başkasının iznini onaylayabilmeli");
}

#[tokio::test]
async fn zimmet_iki_kez_kapatilamaz() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    let id = staff_service::add_custody(&p, "tenant_a", "usr_1", "Tepsi", 4, None)
        .await
        .expect("zimmet");
    staff_service::return_custody(&p, "tenant_a", &id, false).await.expect("iade");
    let sonuc = staff_service::return_custody(&p, "tenant_a", &id, false).await;
    assert!(sonuc.is_err(), "kapalı zimmet tekrar iade edilemez");

    let acik = staff_service::list_custody(&p, "tenant_a", true).await.expect("liste");
    assert!(acik.is_empty(), "iade edilen kayıt açık listede görünmemeli");
}

#[tokio::test]
async fn tutanak_bos_ozetle_kaydedilmez() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    let sonuc = staff_service::record_incident(
        &p,
        "tenant_a",
        "usr_boss",
        &crate::services::staff360::staff_types::IncidentInput {
            user_id: "usr_1".into(),
            kind: "NOT".into(),
            severity: "Dusuk".into(),
            occurred_at: "2026-03-10T10:00:00Z".into(),
            summary: "   ".into(),
            details: None,
        },
    )
    .await;
    assert!(sonuc.is_err());
}

#[tokio::test]
async fn bozuk_dogum_tarihi_kaydedilmez_ve_liste_bozulmaz() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    kullanici(&p, "tenant_a", "usr_2", "Bora", "WAITER").await;

    // Takvimde olmayan tarih (`1990-13-45`) kaydedilmemeli: ekranda "45. ay"
    // gibi bir doğum günü göstermektense kayıt alınmaz.
    let bozuk = staff_service::upsert_profile(
        &p,
        "tenant_a",
        "usr_boss",
        &crate::services::staff360::staff_types::StaffProfileInput {
            user_id: "usr_1".into(),
            full_name: "Ayşe".into(),
            base_salary_cents: 0,
            commission_percent: 0,
            birth_date: Some("1990-13-45".into()),
            hire_date: None,
            phone: None,
            national_id: None,
            address: None,
            emergency_contact: None,
            notes: None,
        },
    )
    .await;
    assert!(bozuk.is_err(), "takvimde olmayan tarih kabul edilmemeli");

    let _ = staff_service::upsert_profile(
        &p,
        "tenant_a",
        "usr_boss",
        &crate::services::staff360::staff_types::StaffProfileInput {
            user_id: "usr_2".into(),
            full_name: "Bora".into(),
            base_salary_cents: 0,
            commission_percent: 0,
            birth_date: Some("1995-06-15".into()),
            hire_date: None,
            phone: None,
            national_id: None,
            address: None,
            emergency_contact: None,
            notes: None,
        },
    )
    .await;

    let liste = staff_service::upcoming_birthdays(&p, "tenant_a", 400)
        .await
        .expect("liste bozulmamalı");
    assert_eq!(liste.len(), 1, "yalnız geçerli tarihli kişi listelenmeli");
    let (_, _, tarih) = &liste[0];
    // Liste **doğum yılını** değil, sıradaki doğum gününü döner.
    assert!(
        tarih.ends_with("-06-15"),
        "ay/gün korunmalı, yıl sıradaki yıl olabilir: {tarih}"
    );
}

#[tokio::test]
async fn dogum_tarihi_bilinmeyen_personel_listelenmez() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    let _ = staff_service::upsert_profile(
        &p,
        "tenant_a",
        "usr_boss",
        &crate::services::staff360::staff_types::StaffProfileInput {
            user_id: "usr_1".into(),
            full_name: "Ayşe".into(),
            base_salary_cents: 0,
            commission_percent: 0,
            birth_date: None,
            hire_date: None,
            phone: None,
            national_id: None,
            address: None,
            emergency_contact: None,
            notes: None,
        },
    )
    .await;
    let liste = staff_service::upcoming_birthdays(&p, "tenant_a", 30).await.expect("liste");
    assert!(
        liste.is_empty(),
        "tarihi bilinmeyen kişi için \"doğum günü var\" uydurulmamalı"
    );
}

#[tokio::test]
async fn dogum_gunu_ufes_yil_dahil_yalniz_bir_kez_listelenir() {
    let p = pool().await;
    kullanici(&p, "tenant_a", "usr_1", "Ayşe", "WAITER").await;
    let _ = staff_service::upsert_profile(
        &p,
        "tenant_a",
        "usr_boss",
        &crate::services::staff360::staff_types::StaffProfileInput {
            user_id: "usr_1".into(),
            full_name: "Ayşe".into(),
            base_salary_cents: 0,
            commission_percent: 0,
            birth_date: Some("1990-01-01".into()),
            hire_date: None,
            phone: None,
            national_id: None,
            address: None,
            emergency_contact: None,
            notes: None,
        },
    )
    .await;
    // 400 günlük ufuk 1 Ocak'ı kapsar; kişi **bir kez** listelenmeli.
    let liste = staff_service::upcoming_birthdays(&p, "tenant_a", 400)
        .await
        .expect("liste");
    assert_eq!(liste.len(), 1, "aynı doğum günü birden fazla kez listelenmemeli");
    let (_, _, tarih) = &liste[0];
    assert!(
        tarih.ends_with("-01-01"),
        "ay/gün korunmalı: {tarih}"
    );
    // Yıl, bugünün yılı ya da bir sonraki yıl olmalı (geçmişe düşmez).
    let su_an = chrono::Utc::now().date_naive();
    let dogum = chrono::NaiveDate::parse_from_str(tarih, "%Y-%m-%d").expect("tarih");
    assert!(dogum >= su_an, "doğum günü geçmişe düşmüş: {tarih}");
    assert!(
        dogum.year() == su_an.year() || dogum.year() == su_an.year() + 1,
        "beklenmeyen yıl: {tarih}"
    );
}
