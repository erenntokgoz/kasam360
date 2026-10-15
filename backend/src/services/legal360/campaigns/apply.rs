//! Kupon uygulama, listeleme ve istatistik.
//!
//! Kupon doğrulaması **beş kapıdan** geçer ve her kapı ayrı hata döndürür:
//! bilinmeyen kod, pasif kampanya, tarih penceresi, kullanım limiti, asgari
//! sepet. Tek bir "kupon geçersiz" mesajı kasa ekranında kullanıcıya ne
//! yapması gerektiğini söylemez; müşteri kasada beklerken hangi kapının
//! engellediğini bilmek zorundadır.
//!
//! Dönüşümün kuralı: kupon **kabul edilirse** `usage_count` bir artar. Kabul
//! edilmeyen kupon sayacı değiştirmez; müşteri kuponu denemekten vazgeçse
//! bile sayacın ilerlemesi kuponu gereksiz yere tüketir.

use sqlx::{Row, SqliteConnection};

use super::kural_dogrula;
use crate::services::legal360::campaigns::{Campaign, CampaignRule, CampaignStats};
use crate::services::legal360::{bayrak_al, bugun, metin_al, tam_sayi_al};

/// Kupon koduyla kampanyayı bulur. Kod büyük harfe çevrilerek aranır.
///
/// Neden büyük harf: müşteri `kahve20`, kasa `KAHVE20` yazar. Küçük/büyük
/// harf ayrımı kuponu kullanılamaz yapar ve sebebi görünmez.
pub async fn find_campaign_by_coupon(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    coupon_code: &str,
) -> Result<
    Option<(
        String,
        String,
        String,
        i64,
        Option<i64>,
        Option<String>,
        Option<String>,
        bool,
    )>,
    String,
> {
    let satir = sqlx::query(
        "SELECT id, name, rule_json, usage_count, max_usage, valid_from, valid_to, is_active
           FROM campaigns
          WHERE tenant_id = ? AND coupon_code = ?",
    )
    .bind(tenant_id)
    .bind(coupon_code.trim().to_ascii_uppercase())
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let Some(row) = satir else {
        return Ok(None);
    };
    Ok(Some((
        row.try_get("id").map_err(|e| e.to_string())?,
        row.try_get("name").map_err(|e| e.to_string())?,
        row.try_get("rule_json").map_err(|e| e.to_string())?,
        row.try_get("usage_count").map_err(|e| e.to_string())?,
        tam_sayi_al(&row, "max_usage")?,
        metin_al(&row, "valid_from")?,
        metin_al(&row, "valid_to")?,
        bayrak_al(&row, "is_active")?,
    )))
}

/// Kuponu bir sepet tutarına uygular ve indirimi hesaplar.
///
/// **Yan etki:** `usage_count` bir artar ve kampanya `updated_at` sılanır.
/// Çağıran bu işlemi `BEGIN IMMEDIATE` içinde yapmalıdır; iki kasa aynı anda
/// son kullanımdaki kuponu kullanırsa sayaç yarışır (AGENTS.md §3.1 donanım
/// yarışı yasağı).
///
/// Ürün/kategori kapsamı burada **kontrol edilmez**: sepet kalemleri kasa
/// tarafında zaten toplanır, kural yalnız sepet **toplamına** uygulanır.
/// Kapsam denetimi `campaign_scope_matches` ile ayrıca yapılır ve kasa bu
/// bilgiyi "bu kampanya şu ürünlere" göstermek için kullanır. Kapsam
/// denetlenmeden indirim uygulamak, kuralın amaçladığından fazla indirim
/// demektir; bu yüzden kapsamı içeren kuralda kapsam sağlanmıyorsa hata
/// döner.
pub async fn apply_campaign(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    coupon_code: &str,
    sepet_cents: i64,
    urun_kapsam_duruyor_mu: bool,
) -> Result<super::AppliedCampaign, String> {
    let kod = coupon_code.trim();
    if kod.is_empty() {
        return Err("VALIDATION: kupon kodu boş olamaz".into());
    }
    if sepet_cents < 0 {
        return Err("VALIDATION: sepet tutarı negatif olamaz".into());
    }

    let bulunan = find_campaign_by_coupon(conn, tenant_id, kod).await?;
    let (id, ad, rule_json, usage_count, max_usage, valid_from, valid_to, is_active) =
        bulunan.ok_or_else(|| format!("KUPON_GECERSIZ: {kod} kuponu bulunamadı"))?;

    if !is_active {
        return Err(format!("KUPON_GECERSIZ: {ad} kampanyası pasif durumda"));
    }

    let bugun = bugun();
    if let Some(bas) = valid_from.as_deref() {
        if bugun.as_str() < bas {
            return Err(format!(
                "KUPON_GECERSIZ: {ad} kampanyası {bas} tarihinde başlıyor"
            ));
        }
    }
    if let Some(bit) = valid_to.as_deref() {
        if bugun.as_str() > bit {
            return Err(format!("KUPON_GECERSIZ: {ad} kampanyasının süresi doldu"));
        }
    }

    // Limit dolmuşsa "geçersiz" değil "tükendi" demek gerekir: müşteri kuponun
    // geçerli olduğunu bilmeli, sadece kullanılamadığını.
    if let Some(limit) = max_usage {
        if usage_count >= limit {
            return Err(format!(
                "KUPON_TUKENDI: {ad} kampanyasının kullanım limiti doldu"
            ));
        }
    }

    let kural: CampaignRule = super::parse_campaign_rule(&rule_json)?;
    kural_dogrula(&kural)?;

    if let Some(asgari) = kural.min_total_cents {
        if sepet_cents < asgari {
            return Err(format!(
                "KUPON_GECERSIZ: {ad} kampanyası için sepet en az {} kuruş olmalı",
                asgari
            ));
        }
    }

    let kapsam_var = kural.product_ids.is_some() || kural.category_ids.is_some();
    if kapsam_var && !urun_kapsam_duruyor_mu {
        return Err(format!(
            "KUPON_KAPSAM_DISI: {ad} kampanyası sepetinizdeki ürünlere uygulanmıyor"
        ));
    }

    let indirim = kural_indirimi(&kural, sepet_cents);
    if indirim <= 0 {
        return Err(format!(
            "KUPON_GECERSIZ: {ad} kampanyası bu sepette indirim üretmiyor"
        ));
    }

    let yeni_sayac = usage_count + 1;
    sqlx::query(
        "UPDATE campaigns
            SET usage_count = ?
          WHERE id = ? AND tenant_id = ?",
    )
    .bind(yeni_sayac)
    .bind(&id)
    .bind(tenant_id)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(super::AppliedCampaign {
        campaign_id: id,
        campaign_name: ad,
        discount_cents: indirim,
        remaining_total_cents: sepet_cents - indirim,
        usage_count: yeni_sayac,
    })
}

/// Kuralın bu sepete uyguladığı indirim (kuruş).
///
/// Üç kural birlikte uygulanır:
///   * yüzde indirim tam sayı bölmesiyle **aşağı** yuvarlanır,
///   * sabit indirim eklenir,
///   * toplam indirim sepeti **aşamaz** (aksi halde kasa tahsilat yerine para
///     öder).
///
/// Neden aşağı yuvarlama: yukarı yuvarlama her kuruşta bir kazanç yaratır ve
/// yüzlerce sepette ölçülebilir bir fark oluşur. Kuruş, işletmenin en küçük
/// birimidir ve bu fark müşteriye aittir.
pub(crate) fn kural_indirimi(kural: &CampaignRule, sepet_cents: i64) -> i64 {
    let yuzde = sepet_cents.saturating_mul(kural.discount_percent) / 100;
    let sabit = kural.fixed_discount_cents.unwrap_or(0);
    let toplam = yuzde.saturating_add(sabit);
    if toplam > sepet_cents {
        sepet_cents
    } else {
        toplam
    }
}

pub async fn list_campaigns(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    only_active: bool,
) -> Result<Vec<Campaign>, String> {
    let mut sql = String::from(
        "SELECT id, name, rule_json, coupon_code, usage_count, max_usage,
                valid_from, valid_to, is_active
           FROM campaigns
          WHERE tenant_id = ?",
    );
    if only_active {
        sql.push_str(" AND is_active = 1");
    }
    sql.push_str(" ORDER BY is_active DESC, name ASC");

    let rows = sqlx::query(&sql)
        .bind(tenant_id)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let mut sonuc = Vec::new();
    for row in rows {
        let rule_json: String = row.try_get("rule_json").map_err(|e| e.to_string())?;
        sonuc.push(Campaign {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            name: row.try_get("name").map_err(|e| e.to_string())?,
            rule: super::parse_campaign_rule(&rule_json)?,
            coupon_code: metin_al(&row, "coupon_code")?,
            usage_count: row.try_get("usage_count").map_err(|e| e.to_string())?,
            max_usage: tam_sayi_al(&row, "max_usage")?,
            valid_from: metin_al(&row, "valid_from")?,
            valid_to: metin_al(&row, "valid_to")?,
            is_active: bayrak_al(&row, "is_active")?,
        });
    }
    Ok(sonuc)
}

/// Sistem kampanya şablonları.
///
/// Bu tek sorgu `tenant_id` filtresi **uygulamaz** ve bu bilinçlidir:
/// `campaign_templates` bir işletme verisi değil, uygulama kataloğudur
/// (bkz. `db/campaign_seeds.rs`). Kiracı filtresi eklendiği anda her işletme kendi
/// on kopyasını görmeye başlar ve şablonlar kopar. Katalog tablosunda kiracı
/// verisi **yoktur**; bu yüzden sızıntı da yoktur.
pub async fn list_campaign_templates(
    conn: &mut SqliteConnection,
) -> Result<Vec<(String, String, String)>, String> {
    let rows = sqlx::query(
        "SELECT id, name, rule_json
           FROM campaign_templates
          WHERE is_system = 1
          ORDER BY name ASC",
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    let mut sonuc = Vec::new();
    for row in rows {
        sonuc.push((
            row.try_get("id").map_err(|e| e.to_string())?,
            row.try_get("name").map_err(|e| e.to_string())?,
            row.try_get("rule_json").map_err(|e| e.to_string())?,
        ));
    }
    Ok(sonuc)
}

/// Kampanya istatistiği. Tek sorguda hesaplanır; sayaçlar `SUM`/`COUNT` ile
/// gelir ve `unwrap_or(0)` **yoktur** — sıfır değil `COALESCE` uygulanır, çünkü
/// burada "kayıt yok" ile "toplam sıfır" aynı sonuçtur ve bu bir para
/// toplamı değildir.
pub async fn campaign_stats(
    conn: &mut SqliteConnection,
    tenant_id: &str,
) -> Result<CampaignStats, String> {
    let satir = sqlx::query(
        "SELECT COUNT(*) AS toplam,
                COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0) AS aktif,
                COALESCE(SUM(CASE WHEN coupon_code IS NOT NULL THEN 1 ELSE 0 END), 0) AS kuponlu,
                COALESCE(SUM(CASE WHEN max_usage IS NOT NULL AND usage_count >= max_usage
                                  THEN 1 ELSE 0 END), 0) AS tukenmis,
                COALESCE(SUM(usage_count), 0) AS toplam_kullanim
           FROM campaigns
          WHERE tenant_id = ?",
    )
    .bind(tenant_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(CampaignStats {
        total_campaigns: satir.try_get("toplam").map_err(|e| e.to_string())?,
        active_campaigns: satir.try_get("aktif").map_err(|e| e.to_string())?,
        coupon_campaigns: satir.try_get("kuponlu").map_err(|e| e.to_string())?,
        exhausted_campaigns: satir.try_get("tukenmis").map_err(|e| e.to_string())?,
        total_usage: satir
            .try_get("toplam_kullanim")
            .map_err(|e| e.to_string())?,
    })
}
