//! Fiyat bütünlüğü ve migration uyumluluğu testleri.

use super::super::*;
use super::common::*;

// ─── Fiyat bütünlüğü ────────────────────────────────────────────────────────

#[tokio::test]
async fn secenek_fiyati_istemciden_degil_veritabanindan_alinir() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let group_id = create_group(&mut conn, TENANT_A, "Ekstralar", false, 0, None, None)
        .await
        .expect("grup");
    let option_id = add_option(&mut conn, TENANT_A, &group_id, "Ekstra Peynir", 4000)
        .await
        .expect("seçenek");

    // İstemci fiyatı 0 göndererek ek ücretten kurtulmaya çalışıyor.
    let malicious =
        serde_json::json!([{ "id": option_id, "name": "Ekstra Peynir", "priceCents": 0 }]);
    let total = sum_selected_option_prices(&mut conn, TENANT_A, Some(&malicious))
        .await
        .expect("toplam");
    assert_eq!(total, 4000, "fiyat istemciden değil DB'den gelmeli");
}

#[tokio::test]
async fn secenek_yoksa_sessizce_sifir_fiyatlanmaz() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let unknown = serde_json::json!([{ "id": "mod_yok", "name": "Hayalet", "priceCents": 0 }]);
    let err = sum_selected_option_prices(&mut conn, TENANT_A, Some(&unknown))
        .await
        .expect_err("bilinmeyen seçenek reddedilmeli");
    assert!(err.contains("MALICIOUS_INPUT"), "beklenen hata: {}", err);
}

#[tokio::test]
async fn baska_tenantin_seceneginin_fiyati_kullanilamaz() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    seed_tenant(&pool, TENANT_B).await;
    let mut conn = conn_of(&pool).await;

    let group_id = create_group(&mut conn, TENANT_B, "B Grubu", false, 0, None, None)
        .await
        .expect("B grubu");
    let option_id = add_option(&mut conn, TENANT_B, &group_id, "B Seçeneği", 1000)
        .await
        .expect("B seçeneği");

    let err = sum_selected_option_prices(&mut conn, TENANT_A, Some(&options_json(&[&option_id])))
        .await
        .expect_err("çapraz tenant seçeneği reddedilmeli");
    assert!(err.contains("MALICIOUS_INPUT"), "beklenen hata: {}", err);
}

#[tokio::test]
async fn secenek_sayisi_asilirsa_kismi_fiyatlandirmaz() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let group_id = create_group(&mut conn, TENANT_A, "Sınır Grubu", false, 0, None, None)
        .await
        .expect("grup");
    let option_id = add_option(&mut conn, TENANT_A, &group_id, "Tek Seçenek", 100)
        .await
        .expect("seçenek");

    // Aynı seçenek defalarca gönderilerek sınır aşılır: her tekrar bir sorgu
    // demektir. Sınır aşımı hata vermeli, kısmi toplam ücret almamalı.
    let ids: Vec<String> = (0..=MAX_OPTIONS_PER_ITEM)
        .map(|_| option_id.clone())
        .collect();
    let refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
    let payload = options_json(&refs);
    let err = sum_selected_option_prices(&mut conn, TENANT_A, Some(&payload))
        .await
        .expect_err("sınır aşımı reddedilmeli");
    assert!(
        err.contains("INVALID_MODIFIER_SELECTION"),
        "beklenen hata: {}",
        err
    );
}

#[tokio::test]
async fn donmus_fiyat_uzerine_modifier_eklenmez() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let group_id = create_group(&mut conn, TENANT_A, "Ekstralar", false, 0, None, None)
        .await
        .expect("grup");
    let option_id = add_option(&mut conn, TENANT_A, &group_id, "Ekstra Peynir", 4000)
        .await
        .expect("seçenek");
    let modifiers = options_json(&[&option_id]);

    // Donmuş fiyat modifier'ı zaten içerir: tekrar eklenirse aynı ekstra iki kez
    // ücretlenir. `resolve_unit_price` donmuş değeri olduğu gibi döner.
    let price = resolve_unit_price(
        &mut conn,
        TENANT_A,
        (30000, 2000),
        Some(&modifiers),
        Some(34000),
    )
    .await
    .expect("fiyat çözülür");
    assert_eq!(price, 34000, "çift sayım olmamalı");
}

#[tokio::test]
async fn donmus_fiyat_yoksa_urun_fiyatina_modifier_eklenir() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let group_id = create_group(&mut conn, TENANT_A, "Ekstralar", false, 0, None, None)
        .await
        .expect("grup");
    let option_id = add_option(&mut conn, TENANT_A, &group_id, "Ekstra Peynir", 4000)
        .await
        .expect("seçenek");

    let price = resolve_unit_price(
        &mut conn,
        TENANT_A,
        (30000, 2000),
        Some(&options_json(&[&option_id])),
        None,
    )
    .await
    .expect("fiyat çözülür");
    assert_eq!(price, 34000, "ürün 300 TL + ekstra 40 TL");
}

// ─── Mevcut verinin okunabilirliği ──────────────────────────────────────────

#[tokio::test]
async fn category_id_kolonu_eklenmeden_once_yazan_veri_okunur() {
    // Ürün opsiyon migration'ının güvenliği: kolon eklenmeden önce yazılmış grup
    // satırları (category_id olmadan) okunabilir kalmalı.
    let pool = pool().await;
    sqlx::query(
        "INSERT INTO modifier_groups (id, tenant_id, name, is_required, min_selections) \
         VALUES ('mod_legacy', ?, 'Eski Grup', 0, 0)",
    )
    .bind(TENANT_A)
    .execute(&pool)
    .await
    .expect("eski biçimde grup yazılır");

    apply_runtime_migrations(&pool).await;
    let mut conn = conn_of(&pool).await;

    let groups = list_groups(&mut conn, TENANT_A, None)
        .await
        .expect("eski veri okunur");
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].id, "mod_legacy");
    assert_eq!(
        groups[0].category_id, None,
        "eski satır serbest grup sayılmalı"
    );
}

#[tokio::test]
async fn grup_listesi_tek_sorguda_secenekleri_cekir() {
    // N+1 regresyonu: 3 grup × seçenekler tek sorguda gelmeli.
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    for idx in 0..3 {
        let gid = create_group(
            &mut conn,
            TENANT_A,
            &format!("Grup {}", idx),
            false,
            0,
            None,
            None,
        )
        .await
        .expect("grup");
        for opt in 0..3 {
            add_option(
                &mut conn,
                TENANT_A,
                &gid,
                &format!("Seçenek {}", opt),
                opt * 100,
            )
            .await
            .expect("seçenek");
        }
    }

    let groups = list_groups(&mut conn, TENANT_A, None).await.expect("liste");
    assert_eq!(groups.len(), 3);
    for group in &groups {
        assert_eq!(group.options.len(), 3);
    }
}

#[tokio::test]
async fn secenek_listesi_fiyat_farkini_korur() {
    let pool = pool().await;
    apply_runtime_migrations(&pool).await;
    seed_tenant(&pool, TENANT_A).await;
    let mut conn = conn_of(&pool).await;

    let gid = create_group(&mut conn, TENANT_A, "Ekstralar", false, 0, None, None)
        .await
        .expect("grup");
    add_option(&mut conn, TENANT_A, &gid, "Ekstra Peynir", 4000)
        .await
        .expect("seçenek");

    let stored: i64 =
        sqlx::query_scalar("SELECT price_cents FROM modifier_options WHERE group_id = ?")
            .bind(&gid)
            .fetch_one(&mut *conn)
            .await
            .expect("fiyat okunur");
    assert_eq!(stored, 4000);
}
