//! Yarı mamul, özyinelemeli reçete çözümü, ürün kimliği girişi ve döngüsel kısıt testleri.

use super::*;

#[tokio::test]
async fn yarin_mamul_recetesi_ozyinelemeli_cozulur() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_hamur", "Hamur", 0).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_un", "Un", 0).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_kruasan", "Kruasan", 12000).await;
    parti_ekle(&mut conn, KIRACI_A, "bat_un", "prd_un", 5000.0, 40, None).await;
    // Okuma tarafı `tenant_id` ile sınırlanmazsa ucuz yabancı parti kazanan olur
    // ve maliyet sessizce düşer; bu kayıt bilinçli olarak yerleştirilir.
    parti_ekle(
        &mut conn,
        KIRACI_B,
        "bat_yabanci_un",
        "prd_un",
        5000.0,
        1,
        None,
    )
    .await;
    let hamur = recete_olustur(
        &mut conn,
        KIRACI_A,
        recete_girdisi(
            "prd_hamur",
            "Hamur",
            100.0,
            10.0,
            vec![malzeme("prd_un", 1000.0, "g", None)],
        ),
    )
    .await;
    // Hamurun kendi partisi yok: maliyeti yalnız kendi reçetesinden gelebilir.
    let hamur_maliyeti = calculate_recipe_cost(&mut conn, KIRACI_A, &hamur.id)
        .await
        .unwrap();
    assert_eq!(hamur_maliyeti.materials_cost_cents, Some(40000));
    // `standard_cost_cents` on adet üretimin **toplam** maliyetidir;
    // `unit_cost_cents` onun birime bölünmüş hâli. İkisi karıştırılırsa ekran
    // maliyeti on kat şişirir.
    assert_eq!(
        hamur_maliyeti.standard_cost_cents,
        Some(40000),
        "on adet uretimin toplam maliyeti 40000"
    );
    assert_eq!(
        hamur_maliyeti.unit_cost_cents,
        Some(4000),
        "birim maliyet 40000 / 10 adet"
    );
    let kruasan = recete_olustur(
        &mut conn,
        KIRACI_A,
        recete_girdisi(
            "prd_kruasan",
            "Kruasan",
            80.0,
            1.0,
            vec![
                malzeme("prd_hamur", 2.0, "adet", None),
                malzeme("prd_un", 200.0, "g", None),
            ],
        ),
    )
    .await;
    let maliyet = calculate_recipe_cost(&mut conn, KIRACI_A, &kruasan.id)
        .await
        .unwrap();
    let hamur_bileseni = bilesen(&maliyet, "prd_hamur");
    assert_eq!(
        hamur_bileseni.unit_cost_cents,
        Some(4000),
        "adet maliyeti 4000"
    );
    assert_eq!(hamur_bileseni.line_cost_cents, Some(8000));
    assert_eq!(
        bilesen(&maliyet, "prd_un").unit_cost_cents,
        Some(40),
        "yabancı yok"
    );
    assert_eq!(bilesen(&maliyet, "prd_un").line_cost_cents, Some(8000));
    assert_eq!(maliyet.materials_cost_cents, Some(16000));
    assert_eq!(
        maliyet.standard_cost_cents,
        Some(20000),
        "%80 randiman 16000'i 20000'e cikarir"
    );
    // Çıktı miktarı 1 adet olduğu için toplam ile birim maliyet aynıdır; bu eşitlik
    // `output_quantity` bölmesinin doğru çalıştığının kanıtı.
    assert_eq!(maliyet.output_quantity, 1.0);
    assert_eq!(maliyet.unit_cost_cents, Some(20000));
    assert_eq!(maliyet.waste_cost_cents, Some(4000));
    assert!(maliyet.unresolved.is_empty());
    assert!(
        maliyet
            .components
            .iter()
            .all(|b| b.unit_cost_cents.is_some()),
        "özyineleme çalışmazsa hamur `None` dönerdi, sessiz sıfır değil"
    );
}

#[tokio::test]
async fn aktif_recete_maliyeti_urun_kimligiyle_cozulur() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_un", "Un", 0).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_ekmek", "Ekmek", 0).await;
    parti_ekle(&mut conn, KIRACI_A, "bat_un", "prd_un", 1000.0, 40, None).await;
    recete_olustur(
        &mut conn,
        KIRACI_A,
        recete_girdisi(
            "prd_ekmek",
            "Ekmek",
            100.0,
            10.0,
            vec![malzeme("prd_un", 1000.0, "g", None)],
        ),
    )
    .await;

    // Ekran ürün seçer, reçete kimliği bilmez. Ürün kimliğinden yol bulan giriş
    // noktası çalışmazsa panel her açılışta hata alır.
    let cozulen = cost_for_active_recipe(&mut conn, KIRACI_A, "prd_ekmek")
        .await
        .expect("maliyet cozulmeli");
    let maliyet = cozulen.expect("aktif recete cozulmeli");
    assert!(!maliyet.recipe_id.is_empty(), "recete kimligi dolu olmali");
    assert_eq!(maliyet.materials_cost_cents, Some(40_000));
    assert_eq!(maliyet.standard_cost_cents, Some(40_000));
    assert_eq!(maliyet.unit_cost_cents, Some(4_000));

    // Reçetesiz ürün bilinmiyordur, sıfır değil.
    urun_ekle(&mut conn, KIRACI_A, "prd_cay", "Çay", 0).await;
    let recetesiz = cost_for_active_recipe(&mut conn, KIRACI_A, "prd_cay")
        .await
        .expect("sorgu hata vermemeli");
    assert!(
        recetesiz.is_none(),
        "recetesiz urun icin maliyet bilinmiyor"
    );

    // Kapalı işletmenin ürünü görünmez: başarı hâli de sıfır maliyet de değil.
    urun_ekle(&mut conn, KIRACI_B, "prd_yabanci", "Ekmek", 0).await;
    let yabanci = cost_for_active_recipe(&mut conn, KIRACI_B, "prd_yabanci")
        .await
        .expect("sorgu hata vermemeli");
    assert!(yabanci.is_none(), "yabanci isletmenin recetesi gorunmemeli");
}

#[tokio::test]
async fn dongusel_recete_yine_reddedilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_a", "A", 0).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_b", "B", 0).await;
    parti_ekle(&mut conn, KIRACI_A, "bat_a", "prd_a", 100.0, 40, None).await;

    recete_olustur(
        &mut conn,
        KIRACI_A,
        recete_girdisi(
            "prd_a",
            "A",
            100.0,
            1.0,
            vec![malzeme("prd_b", 1.0, "adet", None)],
        ),
    )
    .await;
    recete_olustur(
        &mut conn,
        KIRACI_A,
        recete_girdisi(
            "prd_b",
            "B",
            100.0,
            1.0,
            vec![malzeme("prd_a", 1.0, "adet", None)],
        ),
    )
    .await;

    // A → B → A döngüsü sonsuz çözüm üretir; reddedilmelidir. Döngü kontrolü
    // giriş noktasında gevşetilirse bu test kızar.
    let hata = cost_for_active_recipe(&mut conn, KIRACI_A, "prd_a")
        .await
        .expect_err("dongusel recete reddedilmeli");
    assert!(hata.contains("döngüsel"), "neden belirtilmeli: {hata}");
}

#[tokio::test]
async fn birim_maliyet_standart_uretim_maliyetinden_ayrilir() {
    let pool = test_pool().await;
    let mut conn = conn_of(&pool).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_un", "Un", 0).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_kruasan", "Kruasan", 0).await;
    parti_ekle(&mut conn, KIRACI_A, "bat_un", "prd_un", 5000.0, 40, None).await;

    // 1000 g un → 10 adet kruasan, randıman %80.
    let recete = recete_olustur(
        &mut conn,
        KIRACI_A,
        recete_girdisi(
            "prd_kruasan",
            "Kruasan",
            80.0,
            10.0,
            vec![malzeme("prd_un", 1000.0, "g", None)],
        ),
    )
    .await;
    let maliyet = calculate_recipe_cost(&mut conn, KIRACI_A, &recete.id)
        .await
        .expect("maliyet cozulmeli");

    assert_eq!(maliyet.output_quantity, 10.0);
    assert_eq!(maliyet.materials_cost_cents, Some(40_000));
    assert_eq!(
        maliyet.standard_cost_cents,
        Some(50_000),
        "%80 randiman maliyeti 50000'e cikarir"
    );
    assert_eq!(
        maliyet.unit_cost_cents,
        Some(5_000),
        "birim maliyet standart toplamin 10 adede bolunmus hali"
    );
    // Karıştırma tuzağı: iki alan 10 kat farklıdır, ekran hangisini "birim
    // maliyet" diye gösteriyorsa alanı doğru seçmelidir.
    assert_ne!(maliyet.standard_cost_cents, maliyet.unit_cost_cents);
    assert_eq!(
        maliyet.unit_cost_cents.unwrap() * 10,
        maliyet.standard_cost_cents.unwrap()
    );
    assert_eq!(maliyet.waste_cost_cents, Some(10_000));
}
