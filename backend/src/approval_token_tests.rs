//! `approval_service` jeton testleri ayrı dosyada tutulur (AGENTS.md §10: dosya
//! başına en fazla 500 satır). Modül `#[path]` ile içeri alınır.

use super::super::*;
use super::{approval_pool, request, seed_user};

#[tokio::test]
async fn jeton_tek_kullanimliktir() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_owner", "tenant_a", "OWNER", "2222", 1).await;
    seed_user(&pool, "usr_cashier", "tenant_a", "CASHIER", "4444", 1).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let req = request("usr_cashier", operation::VOID, 0);
    let verified = verify_and_issue(&mut conn, &req, "2222")
        .await
        .expect("onay verilir");

    consume_token(&mut conn, &verified.token, &req)
        .await
        .expect("jeton tüketilir");

    let err = consume_token(&mut conn, &verified.token, &req)
        .await
        .expect_err("jeton ikinci kez kullanılamaz");
    assert_eq!(err, error::TOKEN_USED);
}

#[tokio::test]
async fn jeton_baska_kayna_isleme_veya_tutara_tasinamaz() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_owner", "tenant_a", "OWNER", "2222", 1).await;
    seed_user(&pool, "usr_cashier", "tenant_a", "CASHIER", "4444", 1).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let req = request("usr_cashier", operation::VOID, 0);
    let verified = verify_and_issue(&mut conn, &req, "2222")
        .await
        .expect("onay verilir");

    let other_table = ApprovalRequest {
        resource_id: "ord_02".to_string(),
        ..req.clone()
    };
    let err = consume_token(&mut conn, &verified.token, &other_table)
        .await
        .expect_err("jeton başka adisyona taşınamaz");
    assert_eq!(err, error::TOKEN_SCOPE);

    let other_operation = ApprovalRequest {
        operation: operation::DISCOUNT.to_string(),
        ..req.clone()
    };
    let err = consume_token(&mut conn, &verified.token, &other_operation)
        .await
        .expect_err("jeton başka işleme taşınamaz");
    assert_eq!(err, error::TOKEN_SCOPE);

    let other_amount = ApprovalRequest {
        amount_cents: 12_000,
        ..req
    };
    let err = consume_token(&mut conn, &verified.token, &other_amount)
        .await
        .expect_err("jeton başka tutara taşınamaz");
    assert_eq!(err, error::TOKEN_SCOPE);
}

#[tokio::test]
async fn sure_dolmus_jeton_reddedilir() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_owner", "tenant_a", "OWNER", "2222", 1).await;
    seed_user(&pool, "usr_cashier", "tenant_a", "CASHIER", "4444", 1).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let req = request("usr_cashier", operation::VOID, 0);
    let verified = verify_and_issue(&mut conn, &req, "2222")
        .await
        .expect("onay verilir");

    // Süre geçmiş jeton: expires_at geçmişe çekilir.
    let expired =
        (chrono::Utc::now() - chrono::Duration::seconds(TOKEN_TTL_SECONDS + 1)).to_rfc3339();
    sqlx::query("UPDATE approvals SET expires_at = ?")
        .bind(expired)
        .execute(&mut *conn)
        .await
        .expect("süre düzenlenir");

    let err = consume_token(&mut conn, &verified.token, &req)
        .await
        .expect_err("süresi dolmuş jeton reddedilir");
    assert_eq!(err, error::TOKEN_EXPIRED);
}

#[tokio::test]
async fn bilinmeyen_ve_bos_jeton_reddedilir() {
    let pool = approval_pool().await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let err = consume_token(
        &mut conn,
        "uydurma_jeton",
        &request("usr_cashier", operation::VOID, 0),
    )
    .await
    .expect_err("uydurma jeton reddedilir");
    assert_eq!(err, error::TOKEN_INVALID);

    let err = consume_token(
        &mut conn,
        "  ",
        &request("usr_cashier", operation::VOID, 0),
    )
    .await
    .expect_err("boş jeton reddedilir");
    assert_eq!(err, error::TOKEN_INVALID);
}

#[tokio::test]
async fn basta_tenantin_jetonu_tuketilemez() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_owner", "tenant_a", "OWNER", "2222", 1).await;
    seed_user(&pool, "usr_cashier", "tenant_a", "CASHIER", "4444", 1).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let req = request("usr_cashier", operation::VOID, 0);
    let verified = verify_and_issue(&mut conn, &req, "2222")
        .await
        .expect("onay verilir");

    // Aynı jeton başka bir tenant'ın isteğiyle tüketilemez.
    let other_tenant = ApprovalRequest {
        tenant_id: "tenant_b".to_string(),
        ..request("usr_cashier", operation::VOID, 0)
    };
    let err = consume_token(&mut conn, &verified.token, &other_tenant)
        .await
        .expect_err("başka tenant jetonu kullanamaz");
    assert_eq!(err, error::TOKEN_INVALID);

    // Doğru tenant'ta tüketim hâlâ mümkündür.
    consume_token(&mut conn, &verified.token, &req)
        .await
        .expect("jeton asıl tenant'ta tüketilir");
}

#[tokio::test]
async fn tuketilen_jeton_approver_rapor_icin_kayitli_kalir() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_manager", "tenant_a", "MANAGER", "3333", 1).await;
    seed_user(&pool, "usr_cashier", "tenant_a", "CASHIER", "4444", 1).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let req = request("usr_cashier", operation::VOID, 0);
    let verified = verify_and_issue(&mut conn, &req, "3333")
        .await
        .expect("onay verilir");
    consume_token(&mut conn, &verified.token, &req)
        .await
        .expect("jeton tüketilir");

    let row = sqlx::query(
        "SELECT status, approver_id, approved_by_role, consumed_at FROM approvals",
    )
    .fetch_one(&mut *conn)
    .await
    .expect("onay kaydı okunur");
    assert_eq!(row.try_get::<String, _>("status").unwrap(), "APPROVED");
    assert_eq!(
        row.try_get::<String, _>("approver_id").unwrap(),
        "usr_manager"
    );
    assert_eq!(
        row.try_get::<String, _>("approved_by_role").unwrap(),
        "MANAGER"
    );
    assert!(row
        .try_get::<Option<String>, _>("consumed_at")
        .unwrap()
        .is_some());
}

#[tokio::test]
async fn kalan_deneme_hakki_hatali_pinden_sonra_azalir_ve_basariyla_sifirlanir() {
    let pool = approval_pool().await;
    seed_user(&pool, "usr_owner", "tenant_a", "OWNER", "2222", 1).await;
    let mut conn = pool.acquire().await.expect("bağlantı alınır");

    let req = request("usr_cashier", operation::VOID, 0);
    assert_eq!(
        remaining_attempts(&mut conn, &req).await.unwrap_or(0),
        MAX_FAILED_ATTEMPTS
    );

    for expected in [4, 3] {
        let _ = verify_and_issue(&mut conn, &req, "9999").await;
        assert_eq!(
            remaining_attempts(&mut conn, &req).await.unwrap_or(0),
            expected
        );
    }

    verify_and_issue(&mut conn, &req, "2222")
        .await
        .expect("doğru PIN onay verir");
    assert_eq!(
        remaining_attempts(&mut conn, &req).await.unwrap_or(0),
        MAX_FAILED_ATTEMPTS,
        "başarılı denemeden sonra haklar sıfırlanır"
    );
}