//! Kampanya motoru: kural çözümü, kupon doğrulama ve indirim hesabı.
//!
//! Neden kural JSON olarak saklanıyor: kampanya türleri çok (saat aralığı,
//! kategori, ürün, minimum sepet, sabit tutar) ve her biri ayrı tablo
//! kolonu olsaydı yeni kampanya türü şema migration'ı gerektirirdi. Kural
//! metni aynı zamanda **denetlenebilir**: şablonlar (`db/faz14.rs`) ve
//! kullanıcı kampanyaları aynı çözücüden geçer, ayrışma yakalanır.
//!
//! Kural **tipli** çözülür: `serde_json::from_str` hatası `Err` olarak yükselir.
//! `deny_unknown_fields` şart: bilinmeyen alan yok sayılırsa yazım hatası sessiz
//! bir **etkisiz kurala** dönüşür ve kampanya hiç indirim uygulamadan çalışır.
//! Bu, `db/faz14.rs` şablon testinin yakalamak için yazıldığı sessiz hatadır.
//!
//! Kural alan adları **yılan biçimindedir** (`discount_percent`). `camelCase`
//! burada yanlış olurdu: şema metni Rust alan adlarıyla birebir aynı olmalıdır,
//! aksi halde `{"discount_percent": 10}` yazımı `discount_percent = 0` olarak
//! çözülür ve kampanya hiç indirim vermez.
//!
//! Dosya 500 satır sınırını aşmasın diye kural tanımı ve kayıt işlemleri
//! burada, kupon uygulama ve listeleme `apply` alt modülündedir.

pub mod apply;

pub use apply::{apply_campaign, campaign_stats, list_campaign_templates, list_campaigns};

use serde::{Deserialize, Serialize};
use sqlx::SqliteConnection;

use super::{saat_dogrula, tutar_dogrula};
use crate::id_generator::generate_id;

#[derive(Debug, Deserialize, Serialize, Clone, Default, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct CampaignRule {
    /// Minimum sepet tutarı (kuruş). Altındaki sepet kuponu kullanamaz.
    pub min_total_cents: Option<i64>,
    /// Yüzde indirim. 0-90 arası olmalı.
    #[serde(default)]
    pub discount_percent: i64,
    /// Kupon kodu sabit indirim olarak uygulanırsa tutar (kuruş).
    pub fixed_discount_cents: Option<i64>,
    /// Yalnız bu ürünlere uygulanır. `None` = tüm ürünler.
    pub product_ids: Option<Vec<String>>,
    /// Yalnız bu kategorilere uygulanır.
    pub category_ids: Option<Vec<String>>,
    /// Yalnız bu saat aralığında (yerel saat, `SS:DD`).
    pub start_time: Option<String>,
    pub end_time: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
pub struct Campaign {
    pub id: String,
    pub name: String,
    pub rule: CampaignRule,
    pub coupon_code: Option<String>,
    pub usage_count: i64,
    pub max_usage: Option<i64>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignInput {
    pub id: Option<String>,
    pub name: String,
    /// Kural metni (JSON). Ayrıca `rule` alanı da kabul edilir; öncelik
    /// `rule`'dadır. Neden ikisi: arayüz kuralı geçici olarak metin olarak
    /// gönderebilir (yapıştırma), ikisi de gelirse metin kazanır çünkü
    /// kullanıcının gördüğü metin kastedilmiştir.
    pub rule_json: Option<String>,
    pub rule: Option<CampaignRule>,
    pub coupon_code: Option<String>,
    pub max_usage: Option<i64>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub is_active: Option<bool>,
}

/// Kampanya istatistiği. Sayaçlar tek sorguda okunur; her biri ayrı
/// `COUNT` ile çekilseydi "kaç kampanya var" sorusu ile "kaçı tükendi"
/// sorusu farklı anlara ait verilerle cevaplanırdı.
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CampaignStats {
    pub total_campaigns: i64,
    pub active_campaigns: i64,
    pub coupon_campaigns: i64,
    /// Kullanım limiti dolmuş kampanya sayısı. Bunlar `is_active = 1` görünür
    /// ama uygulanamaz; sayaç ayrı tutulur çünkü "aktif ama tükenmiş" durumu
    /// işletme sahibinin en sık sorduğu sorudur.
    pub exhausted_campaigns: i64,
    pub total_usage: i64,
}

/// Kupon uygulamasının sonucu. Kırpılmış indirim `discount_cents` olarak
/// ayrıca bildirilir: kural %50 indirim dese bile 300 kuruşluk sepette 150
/// kuruş indirim olur ve kasa bunu bilmelidir.
#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppliedCampaign {
    pub campaign_id: String,
    pub campaign_name: String,
    pub discount_cents: i64,
    pub remaining_total_cents: i64,
    pub usage_count: i64,
}

/// `rule_json` metnini çözer. Geçersiz JSON veya alan dışı değer `Err` verir.
pub fn parse_campaign_rule(rule_json: &str) -> Result<CampaignRule, String> {
    let kural: CampaignRule = serde_json::from_str(rule_json)
        .map_err(|e| format!("VALIDATION: kampanya kuralı okunamadı: {e}"))?;
    kural_dogrula(&kural)?;
    Ok(kural)
}

/// Kural alan sınırlarını doğrular.
///
/// Yüzde 90 sınırı özel gün indirimiyle aynıdır: %100 indirim zarar yazar.
fn kural_dogrula(kural: &CampaignRule) -> Result<(), String> {
    if !(0..=90).contains(&kural.discount_percent) {
        return Err("VALIDATION: kampanya indirimi 0-90 yüzde arasında olmalı".into());
    }
    tutar_dogrula("minimum sepet tutarı", kural.min_total_cents)?;
    tutar_dogrula("sabit indirim", kural.fixed_discount_cents)?;
    if let Some(saat) = kural.start_time.as_deref() {
        saat_dogrula("başlangıç saati", saat)?;
    }
    if let Some(saat) = kural.end_time.as_deref() {
        saat_dogrula("bitiş saati", saat)?;
    }
    Ok(())
}

pub async fn save_campaign(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    actor_id: &str,
    input: CampaignInput,
) -> Result<Campaign, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("VALIDATION: kampanya adı boş olamaz".into());
    }

    let kural = match (input.rule, input.rule_json.as_deref()) {
        (Some(kural), _) => {
            kural_dogrula(&kural)?;
            kural
        }
        (None, Some(metin)) => parse_campaign_rule(metin)?,
        (None, None) => {
            return Err(
                "VALIDATION: kampanya kuralı zorunlu (kural veya kural metni gönderilmeli)".into(),
            )
        }
    };

    let coupon_code = input
        .coupon_code
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty())
        .map(|k| k.to_ascii_uppercase());

    // Kupon kodu aynı işletmede iki kampanyada kullanılamaz: hangi kuponun
    // geçerli olduğu belirsizleşir ve kasa yanlış indirimi uygular.
    if let Some(kod) = coupon_code.as_deref() {
        let celisken: Option<String> = sqlx::query_scalar(
            "SELECT id FROM campaigns
              WHERE tenant_id = ? AND coupon_code = ? AND (? IS NULL OR id <> ?)",
        )
        .bind(tenant_id)
        .bind(kod)
        .bind(input.id.as_deref())
        .bind(input.id.as_deref())
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        if celisken.is_some() {
            return Err(format!(
                "VALIDATION: {kod} kupon kodu başka kampanyada kullanılıyor"
            ));
        }
    }

    let max_usage = input.max_usage;
    if let Some(limit) = max_usage {
        if limit <= 0 {
            return Err("VALIDATION: kullanım limiti sıfırdan büyük olmalı".into());
        }
    }

    let valid_from = match input.valid_from.as_deref() {
        Some(ham) if !ham.trim().is_empty() => {
            super::tarih_dogrula("başlangıç tarihi", ham)?;
            Some(ham.trim().to_string())
        }
        _ => None,
    };
    let valid_to = match input.valid_to.as_deref() {
        Some(ham) if !ham.trim().is_empty() => {
            super::tarih_dogrula("bitiş tarihi", ham)?;
            Some(ham.trim().to_string())
        }
        _ => None,
    };
    if let (Some(bas), Some(bit)) = (valid_from.as_deref(), valid_to.as_deref()) {
        if bit < bas {
            return Err("VALIDATION: bitiş tarihi başlangıçtan önce olamaz".into());
        }
    }

    let rule_json =
        serde_json::to_string(&kural).map_err(|e| format!("VALIDATION: kural yazılamadı: {e}"))?;
    let is_active = input.is_active.unwrap_or(true);

    let id = match input.id.as_deref() {
        Some(mevcut) => {
            crate::management_commands::ensure_owned(conn, "campaigns", mevcut, tenant_id).await?;
            sqlx::query(
                "UPDATE campaigns
                    SET name = ?, rule_json = ?, coupon_code = ?, max_usage = ?,
                        valid_from = ?, valid_to = ?, is_active = ?
                  WHERE id = ? AND tenant_id = ?",
            )
            .bind(name)
            .bind(&rule_json)
            .bind(&coupon_code)
            .bind(max_usage)
            .bind(&valid_from)
            .bind(&valid_to)
            .bind(is_active)
            .bind(mevcut)
            .bind(tenant_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            mevcut.to_string()
        }
        None => {
            let yeni = generate_id("cmp");
            sqlx::query(
                "INSERT INTO campaigns
                     (id, tenant_id, name, rule_json, coupon_code, max_usage,
                      valid_from, valid_to, is_active, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&yeni)
            .bind(tenant_id)
            .bind(name)
            .bind(&rule_json)
            .bind(&coupon_code)
            .bind(max_usage)
            .bind(&valid_from)
            .bind(&valid_to)
            .bind(is_active)
            .bind(actor_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
            yeni
        }
    };

    Ok(Campaign {
        id,
        name: name.to_string(),
        rule: kural,
        coupon_code,
        usage_count: 0,
        max_usage,
        valid_from,
        valid_to,
        is_active,
    })
}
