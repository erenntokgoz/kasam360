//! Faz 14 · Yasal & özel gün şema tohumlaması.
//!
//! Neden ayrı dosya: `init_db` 500 satır sınırında kalmalı. Faz 14'ün yedi
//! tablosu `migrations/schema.sql` içinde `CREATE TABLE IF NOT EXISTS` ile
//! kurulur (yeni tablo olduğu için `ALTER TABLE` migration'ı gerekmez), ama
//! **içerik** tohumlanması gerekir: sistem kampanya şablonları.
//!
//! `campaign_templates` bilinçli olarak kiracısızdır. Bu tablo bir işletmenin
//! verisi değil, uygulamanın kataloğudur: on şablon her işletmede aynıdır ve
//! `tenant_id` taşısaydı her kurulumda on satır kopyalanırdı. Kiracı verisi
//! taşımadığı için `all` sorgusu filtre uygulamaz; tek istisna burasıdır ve
//! gerekçesi bu satırın üstündedir.

use crate::db::DbPool;

/// Sistem kampanya şablonlarını idempotent olarak tohumlar.
///
/// `INSERT OR IGNORE` seçildi: uygulama her açılışta çalışır ve şablon
/// kimlikleri kararlıdır (`tpl_f14_*`). Yeniden tohumlama kullanıcının
/// oluşturduğu kampanyalara dokunmaz, yalnız eksik satırları tamamlar.
///
/// `rule_json` alanları `services/legal360/campaigns.rs` içindeki
/// `CampaignRule` ile birebir aynıdır. Şablon kodu ile servis ayrışırsa
/// şablon uygulandığında kural çözülemez ve kampanya sessizce boşa düşer.
const SISTEM_SABLONLARI: [(&str, &str, &str); 10] = [
    (
        "tpl_f14_01",
        "Hafta Sonu Kahvaltı",
        r#"{"min_total_cents":15000,"discount_percent":10}"#,
    ),
    (
        "tpl_f14_02",
        "Öğle Menüsü",
        r#"{"min_total_cents":12000,"discount_percent":15,"start_time":"12:00","end_time":"15:00"}"#,
    ),
    (
        "tpl_f14_03",
        "Mutfak Akşamı",
        r#"{"min_total_cents":20000,"discount_percent":20,"start_time":"19:00","end_time":"23:00"}"#,
    ),
    (
        "tpl_f14_04",
        "İki Getir Al",
        r#"{"min_total_cents":30000,"discount_percent":5}"#,
    ),
    (
        "tpl_f14_05",
        "Doğum Günü İkramı",
        r#"{"min_total_cents":0,"discount_percent":25}"#,
    ),
    (
        "tpl_f14_06",
        "Sadakat Beşinci Alışveriş",
        r#"{"min_total_cents":20000,"discount_percent":10}"#,
    ),
    (
        "tpl_f14_07",
        "Bayram Öncesi",
        r#"{"min_total_cents":25000,"discount_percent":15}"#,
    ),
    (
        "tpl_f14_08",
        "Menü Tadım",
        r#"{"min_total_cents":5000,"discount_percent":50}"#,
    ),
    (
        "tpl_f14_09",
        "Çay Saati",
        r#"{"min_total_cents":8000,"discount_percent":10,"start_time":"15:00","end_time":"18:00"}"#,
    ),
    (
        "tpl_f14_10",
        "Paylaşım İndirimi",
        r#"{"min_total_cents":10000,"discount_percent":15}"#,
    ),
];

/// On sistem kampanya şablonunu ekler (varsa dokunmaz).
pub(crate) async fn seed_campaign_templates(pool: &DbPool) -> Result<(), sqlx::Error> {
    for (id, name, rule_json) in SISTEM_SABLONLARI {
        sqlx::query(
            "INSERT OR IGNORE INTO campaign_templates (id, name, rule_json, is_system, created_at)
             VALUES (?1, ?2, ?3, 1, CURRENT_TIMESTAMP)",
        )
        .bind(id)
        .bind(name)
        .bind(rule_json)
        .execute(pool)
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    /// Test şeması doğrudan migration dosyasından okunur. Kopyalanmış bir şema
    /// kullanılsaydı tohumlama testleri yeşil kalırken üretim kırılırdı.
    async fn havuz() -> DbPool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("bellek ici veritabani acilmali");
        sqlx::raw_sql(include_str!("../../migrations/schema.sql"))
            .execute(&pool)
            .await
            .expect("migrations/schema.sql uygulanmali");
        pool
    }

    /// Şablonlar boş katalog bırakmamalıdır: kullanıcı "kampanya ekle" ekranını
    /// açtığında hazır şablonları görmelidir, aksi halde ekran boş gelir ve
    /// kural yazmayı bilmeyen işletme sahibi çıkmaza girer.
    #[tokio::test]
    async fn on_sistem_sablonu_tohumlanir() {
        let pool = havuz().await;
        seed_campaign_templates(&pool)
            .await
            .expect("sablonlar tohumlanmali");

        let sayi: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM campaign_templates")
            .fetch_one(&pool)
            .await
            .expect("sablon sayisi okunmali");
        assert_eq!(sayi, 10, "on sistem sablonu beklenir, {sayi} bulundu");
    }

    /// Tohumlama idempotent olmalıdır: uygulama her açılışta çalıştığı için ikinci
    /// çağrı satır sayısını değiştirmemeli, aksi halde şablon listesi her
    /// açılışta büyür.
    #[tokio::test]
    async fn tohumlama_idempotent() {
        let pool = havuz().await;
        seed_campaign_templates(&pool)
            .await
            .expect("birinci tohumlama");
        seed_campaign_templates(&pool)
            .await
            .expect("ikinci tohumlama");

        let sayi: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM campaign_templates")
            .fetch_one(&pool)
            .await
            .expect("sablon sayisi okunmali");
        assert_eq!(sayi, 10, "tekrarlanan tohumlama satir eklememeli");
    }

    /// Şablon kuralı servis tarafından çözülebilir olmalıdır. Şablon kodu ile
    /// `CampaignRule` ayrışırsa şablon uygulandığında kural okunamaz ve
    /// kampanya sessizce boşa düşer; bu test ayrışmayı baştan yakalar.
    #[tokio::test]
    async fn sablon_kurallari_cozulebilir() {
        use crate::services::legal360::campaigns::parse_campaign_rule;

        for (id, name, rule_json) in SISTEM_SABLONLARI {
            let kural = parse_campaign_rule(rule_json)
                .unwrap_or_else(|hata| panic!("{id} ({name}) kuralı çözülemedi: {hata}"));
            assert!(
                kural.discount_percent > 0 || kural.fixed_discount_cents.is_some(),
                "{id} ({name}) kuralı indirim üretmiyor"
            );
        }
    }
}
