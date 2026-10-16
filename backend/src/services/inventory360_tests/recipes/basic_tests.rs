//! Temel reçete maliyeti, randıman/fire, bilinmeyen malzeme ve aktif reçete kısıtları.

use super::*;

#[tokio::test]
async fn recete_maliyeti_randiman_ve_fireyi_hesaplar() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_kruasan", "Kruasan", 12000).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_un", "Un", 0).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_yag", "Yağ", 0).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_tuz", "Tuz", 0).await;
    parti_ekle(&mut conn, KIRACI_A, "bat_un", "prd_un", 1000.0, 40, None).await;
    parti_ekle(&mut conn, KIRACI_A, "bat_yag", "prd_yag", 500.0, 200, None).await;
    parti_ekle(&mut conn, KIRACI_A, "bat_tuz", "prd_tuz", 200.0, 20, None).await;
    let recete = recete_olustur(
        &mut conn,
        KIRACI_A,
        recete_girdisi(
            "prd_kruasan",
            "Kruasan hamuru",
            80.0,
            1.0,
            vec![
                malzeme("prd_un", 1000.0, "g", None),
                malzeme("prd_yag", 100.0, "g", Some(50.0)),
                malzeme("prd_tuz", 10.0, "g", None),
            ],
        ),
    )
    .await;
    assert_eq!(recete.items.len(), 3, "kalemler kaydedilmeli");
    let maliyet = calculate_recipe_cost(&mut conn, KIRACI_A, &recete.id)
        .await
        .unwrap();
    // Fire payı işleme kaybıdır: %50 fire 100 g yağı 200 g ihtiyaca çıkarır.
    let yag = bilesen(&maliyet, "prd_yag");
    assert!((yag.quantity - 200.0).abs() < 1e-9, "fire ihtiyacı büyütür");
    assert_eq!(yag.unit_cost_cents, Some(200));
    assert_eq!(yag.line_cost_cents, Some(40000));
    assert_eq!(bilesen(&maliyet, "prd_un").line_cost_cents, Some(40000));
    assert_eq!(bilesen(&maliyet, "prd_tuz").line_cost_cents, Some(200));
    // 40000 + 40000 + 200 = 80200 kuruş; randıman %80 → maliyet 100250, kayıp 20050.
    assert_eq!(maliyet.materials_cost_cents, Some(80200));
    assert_eq!(maliyet.waste_cost_cents, Some(20050));
    assert_eq!(maliyet.unit_cost_cents, Some(100250));
    assert_ne!(maliyet.materials_cost_cents, Some(0));
    assert!(maliyet.unresolved.is_empty());
}

#[tokio::test]
async fn fiyatsiz_malzeme_maliyeti_sifir_degil_bilinmiyor_olur() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_kruasan", "Kruasan", 12000).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_un", "Un", 0).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_baharat", "Baharat", 0).await;
    parti_ekle(&mut conn, KIRACI_A, "bat_un", "prd_un", 1000.0, 40, None).await;
    let recete = recete_olustur(
        &mut conn,
        KIRACI_A,
        recete_girdisi(
            "prd_kruasan",
            "Kruasan hamuru",
            100.0,
            1.0,
            vec![
                malzeme("prd_un", 1000.0, "g", None),
                malzeme("prd_baharat", 50.0, "g", None),
            ],
        ),
    )
    .await;
    let maliyet = calculate_recipe_cost(&mut conn, KIRACI_A, &recete.id)
        .await
        .unwrap();
    let bilinmeyen = bilesen(&maliyet, "prd_baharat");
    assert_eq!(
        bilinmeyen.unit_cost_cents, None,
        "partisi olmayanın maliyeti bilinmez"
    );
    assert_eq!(
        bilinmeyen.line_cost_cents, None,
        "bilinmeyen maliyet 0 olmaz"
    );
    assert_ne!(bilinmeyen.line_cost_cents, Some(0));
    assert!(bilinmeyen.unresolved_reason.is_some(), "açıklama bulunmalı");
    // Tek bilinmeyen malzeme toplamı da bilinmez yapar; kalan malzeme 0 sayılmaz.
    assert_eq!(maliyet.materials_cost_cents, None);
    assert_eq!(maliyet.unit_cost_cents, None);
    assert_eq!(maliyet.waste_cost_cents, None);
    assert_ne!(maliyet.unit_cost_cents, Some(0));
    assert_ne!(maliyet.waste_cost_cents, Some(0));
    assert_eq!(maliyet.unresolved, vec!["Baharat"]);
    assert_eq!(bilesen(&maliyet, "prd_un").line_cost_cents, Some(40000));
    // Reçetesiz üründe de maliyet uydurulmaz: dönen şey sıfır maliyetli bir
    // döküm değil, dökümün kendisinin yokluğudur.
    urun_ekle(&mut conn, KIRACI_A, "prd_recetesiz", "Reçetesiz ürün", 3000).await;
    let yok = cost_for_active_recipe(&mut conn, KIRACI_A, "prd_recetesiz")
        .await
        .unwrap();
    assert!(yok.is_none(), "reçetesiz ürüne sıfır döküm uydurulmaz");
}

#[tokio::test]
async fn ikinci_aktif_recete_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, KIRACI_B, "prd_b", "B kruasanı", 9000).await;
    urun_ekle(&mut conn, KIRACI_B, "prd_b_un", "B unu", 0).await;
    let b_recetesi = recete_olustur(
        &mut conn,
        KIRACI_B,
        recete_girdisi(
            "prd_b",
            "B tarifi",
            100.0,
            1.0,
            vec![malzeme("prd_b_un", 500.0, "g", None)],
        ),
    )
    .await;
    urun_ekle(&mut conn, KIRACI_A, "prd_kruasan", "Kruasan", 12000).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_un", "Un", 0).await;
    parti_ekle(&mut conn, KIRACI_A, "bat_un", "prd_un", 1000.0, 40, None).await;
    let ilk = recete_olustur(
        &mut conn,
        KIRACI_A,
        recete_girdisi(
            "prd_kruasan",
            "Kruasan hamuru",
            80.0,
            1.0,
            vec![malzeme("prd_un", 1000.0, "g", None)],
        ),
    )
    .await;
    // B'nin aktif reçetesi A'nınkini engellemez; A'nınki B'yi de görmez.
    let ikinci = create_recipe(
        &mut conn,
        KIRACI_A,
        AKTOR,
        recete_girdisi(
            "prd_kruasan",
            "Kruasan hamuru v2",
            80.0,
            1.0,
            vec![malzeme("prd_un", 900.0, "g", None)],
        ),
    )
    .await;
    assert!(
        matches!(ikinci, Err(ref hata) if hata.starts_with("CONFLICT")),
        "aynı üründe ikinci aktif reçete maliyeti belirsizleştirir"
    );
    // Reddedilen deneme yarım kayıt bırakmamalı: yarım reçete kalırsa kullanıcı
    // hatayı düzeltip yeniden denediğinde yine aynı hatayı alır ve ürün kilitlenir.
    let recete_sayisi: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM recipes WHERE tenant_id = ?1")
            .bind(KIRACI_A)
            .fetch_one(&mut conn)
            .await
            .unwrap();
    assert_eq!(recete_sayisi, 1, "reddedilen deneme yarım reçete bırakmaz");
    let kalem_sayisi: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM recipe_items WHERE tenant_id = ?1")
            .bind(KIRACI_A)
            .fetch_one(&mut conn)
            .await
            .unwrap();
    assert_eq!(kalem_sayisi, 1, "reddedilen deneme kalem bırakmaz");
    // Pasife alma geçmiş maliyeti bozmaz: geçmiş hesaplar bu kaydı referans alır.
    deactivate_recipe(&mut conn, KIRACI_A, &ilk.id)
        .await
        .unwrap();
    let gecmis = calculate_recipe_cost(&mut conn, KIRACI_A, &ilk.id)
        .await
        .unwrap();
    assert_eq!(
        gecmis.unit_cost_cents,
        Some(50000),
        "pasif maliyet bozulmaz"
    );
    let yenisi = recete_olustur(
        &mut conn,
        KIRACI_A,
        recete_girdisi(
            "prd_kruasan",
            "Kruasan hamuru v2",
            80.0,
            1.0,
            vec![malzeme("prd_un", 900.0, "g", None)],
        ),
    )
    .await;
    assert!(
        yenisi.is_active,
        "önceki pasife alınınca yerine geçebilmeli"
    );
    assert_eq!(
        list_recipes(&mut conn, KIRACI_A, false)
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        list_recipes(&mut conn, KIRACI_A, true).await.unwrap().len(),
        2
    );
    // Çapraz kiracı: B'nin reçetesi A'da ne listelenir ne değiştirilebilir.
    let a_listesi = list_recipes(&mut conn, KIRACI_A, true).await.unwrap();
    assert!(
        a_listesi.iter().all(|r| r.product_id != "prd_b"),
        "yabancı görünmez"
    );
    let ele_gecirme = deactivate_recipe(&mut conn, KIRACI_A, &b_recetesi.id).await;
    assert!(ele_gecirme.is_err(), "yabancı reçete pasife alınamaz");
    let yabanci_maliyet = calculate_recipe_cost(&mut conn, KIRACI_A, &b_recetesi.id).await;
    assert!(
        matches!(yabanci_maliyet, Err(ref hata) if hata.starts_with("NOT_FOUND")),
        "yabancı reçetenin maliyeti çözülemez"
    );
    let yabanci_urun = cost_for_active_recipe(&mut conn, KIRACI_A, "prd_b")
        .await
        .unwrap();
    assert!(yabanci_urun.is_none(), "yabancı ürüne maliyet uydurulmaz");
    assert_eq!(
        list_recipes(&mut conn, KIRACI_B, false)
            .await
            .unwrap()
            .len(),
        1
    );
}
