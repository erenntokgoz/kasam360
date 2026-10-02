use super::*;
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
            true,
            &crate::services::staff360::staff_types::StaffProfileInput {
                user_id: uid.into(),
                full_name: ad.into(),
                base_salary_cents: Some(20_000),
                commission_percent: Some(0),
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

    let liste = staff_service::list_profiles(&p, "tenant_a", true).await.expect("liste");
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
        true,
        &crate::services::staff360::staff_types::StaffProfileInput {
            user_id: "usr_yok".into(),
            full_name: "Hayalet".into(),
            base_salary_cents: Some(0),
            commission_percent: Some(0),
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
        true,
        &crate::services::staff360::staff_types::StaffProfileInput {
            user_id: "usr_1".into(),
            full_name: "Ayşe".into(),
            base_salary_cents: Some(-1),
            commission_percent: Some(0),
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
        true,
        &crate::services::staff360::staff_types::StaffProfileInput {
            user_id: "usr_1".into(),
            full_name: "Ayşe".into(),
            base_salary_cents: Some(0),
            commission_percent: Some(0),
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
        true,
        &crate::services::staff360::staff_types::StaffProfileInput {
            user_id: "usr_2".into(),
            full_name: "Bora".into(),
            base_salary_cents: Some(0),
            commission_percent: Some(0),
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
        true,
        &crate::services::staff360::staff_types::StaffProfileInput {
            user_id: "usr_1".into(),
            full_name: "Ayşe".into(),
            base_salary_cents: Some(0),
            commission_percent: Some(0),
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
        true,
        &crate::services::staff360::staff_types::StaffProfileInput {
            user_id: "usr_1".into(),
            full_name: "Ayşe".into(),
            base_salary_cents: Some(0),
            commission_percent: Some(0),
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

