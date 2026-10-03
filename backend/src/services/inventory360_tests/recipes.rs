//! Faz 12 · Reçete maliyeti testleri.
//!
//! Kapsam: randıman ve fire payı, malzeme fiyatı bilinmediğinde `0` yerine
//! bilinmiyor (`None`) sayılması, ikinci aktif reçetenin reddi, özyinelemeli alt
//! reçete çözümü, ürün kimliğinden yol bulan giriş noktası ve döngüsel reçete
//! reddinin bozulmaması.
//!
//! Birim çevrimi testleri `units.rs` içindedir.

use super::support::*;
use crate::services::inventory360::*;

const KIRACI_A: &str = "tnt_a";
const KIRACI_B: &str = "tnt_b";
const AKTOR: &str = "usr_1";

/// Reçete kalemi kurar. `fire_payi` verilmemişse işleme kaybı yoktur.
fn malzeme(
    urun_id: &str,
    miktar: f64,
    birim: &str,
    fire_payi: Option<f64>,
) -> recipes::RecipeItemInput {
    recipes::RecipeItemInput {
        component_product_id: urun_id.into(),
        quantity: miktar,
        unit: birim.into(),
        waste_percent: fire_payi,
        notes: None,
    }
}

/// Reçete girdisi kurar.
fn recete_girdisi(
    urun_id: &str,
    ad: &str,
    randiman: f64,
    cikti_miktar: f64,
    kalemler: Vec<recipes::RecipeItemInput>,
) -> recipes::RecipeInput {
    recipes::RecipeInput {
        product_id: urun_id.into(),
        name: ad.into(),
        yield_percent: randiman,
        output_quantity: cikti_miktar,
        output_unit: "adet".into(),
        notes: None,
        items: kalemler,
    }
}

/// Reçeteyi açar ve dönen kaydı verir. Aynı uzun çağrıyı yedi testte tek
/// yerden kurmak, asıl konudan (maliyet) önce kalem kalabalığını okunur kılar.
async fn recete_olustur(
    conn: &mut sqlx::SqliteConnection,
    kiraci: &str,
    girdi: recipes::RecipeInput,
) -> Recipe {
    create_recipe(conn, kiraci, AKTOR, girdi).await.unwrap()
}

/// Dökümdeki malzemeyi ürün kimliğiyle bulur. Kalem sırası `created_at`'e bağlı
/// ve aynı saniyede yazılan kalemler arasında garanti olmadığı için sıraya
/// göre indekslemek teste yalan başarısızlık yazdırır.
fn bilesen<'a>(maliyet: &'a RecipeCost, urun_id: &str) -> &'a recipes::ComponentCost {
    maliyet
        .components
        .iter()
        .find(|b| b.component_product_id == urun_id)
        .unwrap_or_else(|| panic!("maliyet dökümünde {urun_id} yok"))
}

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
        recete_girdisi("prd_kruasan", "Kruasan hamuru", 80.0, 1.0, vec![
            malzeme("prd_un", 1000.0, "g", None),
            malzeme("prd_yag", 100.0, "g", Some(50.0)),
            malzeme("prd_tuz", 10.0, "g", None),
        ]),
    )
    .await;
    assert_eq!(recete.items.len(), 3, "kalemler kaydedilmeli");
    let maliyet = calculate_recipe_cost(&mut conn, KIRACI_A, &recete.id).await.unwrap();
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
        recete_girdisi("prd_kruasan", "Kruasan hamuru", 100.0, 1.0, vec![
            malzeme("prd_un", 1000.0, "g", None),
            malzeme("prd_baharat", 50.0, "g", None),
        ]),
    )
    .await;
    let maliyet = calculate_recipe_cost(&mut conn, KIRACI_A, &recete.id).await.unwrap();
    let bilinmeyen = bilesen(&maliyet, "prd_baharat");
    assert_eq!(bilinmeyen.unit_cost_cents, None, "partisi olmayanın maliyeti bilinmez");
    assert_eq!(bilinmeyen.line_cost_cents, None, "bilinmeyen maliyet 0 olmaz");
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
    let yok = cost_for_active_recipe(&mut conn, KIRACI_A, "prd_recetesiz").await.unwrap();
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
        recete_girdisi("prd_b", "B tarifi", 100.0, 1.0, vec![
            malzeme("prd_b_un", 500.0, "g", None),
        ]),
    )
    .await;
    urun_ekle(&mut conn, KIRACI_A, "prd_kruasan", "Kruasan", 12000).await;
    urun_ekle(&mut conn, KIRACI_A, "prd_un", "Un", 0).await;
    parti_ekle(&mut conn, KIRACI_A, "bat_un", "prd_un", 1000.0, 40, None).await;
    let ilk = recete_olustur(
        &mut conn,
        KIRACI_A,
        recete_girdisi("prd_kruasan", "Kruasan hamuru", 80.0, 1.0, vec![
            malzeme("prd_un", 1000.0, "g", None),
        ]),
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
    let recete_sayisi: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM recipes WHERE tenant_id = ?1")
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
    deactivate_recipe(&mut conn, KIRACI_A, &ilk.id).await.unwrap();
    let gecmis = calculate_recipe_cost(&mut conn, KIRACI_A, &ilk.id).await.unwrap();
    assert_eq!(gecmis.unit_cost_cents, Some(50000), "pasif maliyet bozulmaz");
    let yenisi = recete_olustur(
        &mut conn,
        KIRACI_A,
        recete_girdisi("prd_kruasan", "Kruasan hamuru v2", 80.0, 1.0, vec![
            malzeme("prd_un", 900.0, "g", None),
        ]),
    )
    .await;
    assert!(yenisi.is_active, "önceki pasife alınınca yerine geçebilmeli");
    assert_eq!(list_recipes(&mut conn, KIRACI_A, false).await.unwrap().len(), 1);
    assert_eq!(list_recipes(&mut conn, KIRACI_A, true).await.unwrap().len(), 2);
    // Çapraz kiracı: B'nin reçetesi A'da ne listelenir ne değiştirilebilir.
    let a_listesi = list_recipes(&mut conn, KIRACI_A, true).await.unwrap();
    assert!(a_listesi.iter().all(|r| r.product_id != "prd_b"), "yabancı görünmez");
    let ele_gecirme = deactivate_recipe(&mut conn, KIRACI_A, &b_recetesi.id).await;
    assert!(matches!(ele_gecirme, Err(_)), "yabancı reçete pasife alınamaz");
    let yabanci_maliyet = calculate_recipe_cost(&mut conn, KIRACI_A, &b_recetesi.id).await;
    assert!(
        matches!(yabanci_maliyet, Err(ref hata) if hata.starts_with("NOT_FOUND")),
        "yabancı reçetenin maliyeti çözülemez"
    );
    let yabanci_urun = cost_for_active_recipe(&mut conn, KIRACI_A, "prd_b").await.unwrap();
    assert!(yabanci_urun.is_none(), "yabancı ürüne maliyet uydurulmaz");
    assert_eq!(list_recipes(&mut conn, KIRACI_B, false).await.unwrap().len(), 1);
}

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
    parti_ekle(&mut conn, KIRACI_B, "bat_yabanci_un", "prd_un", 5000.0, 1, None).await;
    let hamur = recete_olustur(
        &mut conn,
        KIRACI_A,
        recete_girdisi("prd_hamur", "Hamur", 100.0, 10.0, vec![
            malzeme("prd_un", 1000.0, "g", None),
        ]),
    )
    .await;
    // Hamurun kendi partisi yok: maliyeti yalnız kendi reçetesinden gelebilir.
    let hamur_maliyeti = calculate_recipe_cost(&mut conn, KIRACI_A, &hamur.id).await.unwrap();
    assert_eq!(hamur_maliyeti.materials_cost_cents, Some(40000));
    // `standard_cost_cents` on adet üretimin **toplam** maliyetidir;
    // `unit_cost_cents` onun birime bölünmüş hâli. İkisi karıştırılırsa ekran
    // maliyeti on kat şişirir.
    assert_eq!(
        hamur_maliyeti.standard_cost_cents, Some(40000),
        "on adet uretimin toplam maliyeti 40000"
    );
    assert_eq!(
        hamur_maliyeti.unit_cost_cents, Some(4000),
        "birim maliyet 40000 / 10 adet"
    );
    let kruasan = recete_olustur(
        &mut conn,
        KIRACI_A,
        recete_girdisi("prd_kruasan", "Kruasan", 80.0, 1.0, vec![
            malzeme("prd_hamur", 2.0, "adet", None),
            malzeme("prd_un", 200.0, "g", None),
        ]),
    )
    .await;
    let maliyet = calculate_recipe_cost(&mut conn, KIRACI_A, &kruasan.id).await.unwrap();
    let hamur_bileseni = bilesen(&maliyet, "prd_hamur");
    assert_eq!(hamur_bileseni.unit_cost_cents, Some(4000), "adet maliyeti 4000");
    assert_eq!(hamur_bileseni.line_cost_cents, Some(8000));
    assert_eq!(bilesen(&maliyet, "prd_un").unit_cost_cents, Some(40), "yabancı yok");
    assert_eq!(bilesen(&maliyet, "prd_un").line_cost_cents, Some(8000));
    assert_eq!(maliyet.materials_cost_cents, Some(16000));
    assert_eq!(maliyet.standard_cost_cents, Some(20000), "%80 randiman 16000'i 20000'e cikarir");
    // Çıktı miktarı 1 adet olduğu için toplam ile birim maliyet aynıdır; bu eşitlik
    // `output_quantity` bölmesinin doğru çalıştığının kanıtı.
    assert_eq!(maliyet.output_quantity, 1.0);
    assert_eq!(maliyet.unit_cost_cents, Some(20000));
    assert_eq!(maliyet.waste_cost_cents, Some(4000));
    assert!(maliyet.unresolved.is_empty());
    assert!(
        maliyet.components.iter().all(|b| b.unit_cost_cents.is_some()),
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
        recete_girdisi("prd_ekmek", "Ekmek", 100.0, 10.0, vec![malzeme("prd_un", 1000.0, "g", None)]),
    )
    .await;

    // Ekran ürün seçer, reçete kimliği bilmez. Ürün kimliğinden yol bulan giriş
    // noktası çalışmazsa panel her açılışta hata alır.
    let cozulen = cost_for_active_recipe(&mut conn, KIRACI_A, "prd_ekmek")
        .await
        .expect("maliyet cozulmeli");
    let maliyet = cozulen.expect("aktif recete cozulmeli");
    assert_eq!(maliyet.recipe_id.is_empty(), false, "recete kimligi dolu olmali");
    assert_eq!(maliyet.materials_cost_cents, Some(40_000));
    assert_eq!(maliyet.standard_cost_cents, Some(40_000));
    assert_eq!(maliyet.unit_cost_cents, Some(4_000));

    // Reçetesiz ürün bilinmiyordur, sıfır değil.
    urun_ekle(&mut conn, KIRACI_A, "prd_cay", "Çay", 0).await;
    let recetesiz = cost_for_active_recipe(&mut conn, KIRACI_A, "prd_cay")
        .await
        .expect("sorgu hata vermemeli");
    assert!(recetesiz.is_none(), "recetesiz urun icin maliyet bilinmiyor");

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
        recete_girdisi("prd_a", "A", 100.0, 1.0, vec![malzeme("prd_b", 1.0, "adet", None)]),
    )
    .await;
    recete_olustur(
        &mut conn,
        KIRACI_A,
        recete_girdisi("prd_b", "B", 100.0, 1.0, vec![malzeme("prd_a", 1.0, "adet", None)]),
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
    assert_eq!(maliyet.standard_cost_cents, Some(50_000), "%80 randiman maliyeti 50000'e cikarir");
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