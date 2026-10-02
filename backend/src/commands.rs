//! Tauri komutlarının dış yüzeyi (facade).
//!
//! AGENTS.md dosya boyutunda 500 satır tavanı koyar. Bu dosya artık yalnızca
//! domain modüllerini tanımlar ve `pub use` ile eski isimleri korur; böylece
//! `crate::commands::*` ve `tauri::generate_handler!` yolları değişmez.

pub mod audit_commands;
pub mod auth_commands;
pub mod command_helpers;
pub mod day_close_commands;
pub mod floor_commands;
pub mod kds_commands;
pub mod payment_commands;
pub mod pos_commands;
pub mod receipt_commands;
pub mod shift_commands;
pub mod staff_commands;
pub mod void_commands;

pub use audit_commands::*;
pub use auth_commands::*;
pub use day_close_commands::*;
pub use floor_commands::*;
pub use kds_commands::*;
pub use payment_commands::*;
pub use pos_commands::*;
pub use receipt_commands::*;
pub use shift_commands::*;
pub use void_commands::*;

// Testler bu modülün üzerine bağlandığı için paylaşılan yardımcılar da
// burada görünür olmalı.
#[cfg(test)]
pub(crate) use pos_commands::authoritative_modifier_snapshot;
#[cfg(test)]
pub(crate) use void_commands::{require_void_approval, void_approval_request};
#[cfg(test)]
#[path = "commands_approval_tests.rs"]
mod approval_tests;

#[cfg(test)]
#[path = "price_integrity_tests.rs"]
mod price_integrity_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    /// MASTER platform hesabı artık yalnızca Argon2 hash'iyle tanınır.
    /// Düz metin `pin` sütunu kaldırıldığı için eski `h == secret` fallback'i
    /// hem gereksiz hem de tehlikelidir: bir hash yerine düz metin kalmış bir
    /// veritabanında kimlik doğrulama bypass edilirdi.
    #[tokio::test]
    async fn platform_admin_kimlik_dogrulamasi_argon2_ile_calisir_duz_metni_kabul_etmez() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE platform_admins (
                id TEXT PRIMARY KEY,
                pin_hash TEXT,
                name TEXT NOT NULL,
                email TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
             );",
        )
        .execute(&pool)
        .await
        .unwrap();

        // Hash'li MASTER hesabı doğru kimlikle giriş yapabilir.
        let hash = crate::auth::hash_credential("Master-3736!").unwrap();
        sqlx::query("INSERT INTO platform_admins (id, pin_hash, name, email) VALUES ('adm_1', ?, 'Süper Admin', 'master@kasam360.com')")
            .bind(&hash)
            .execute(&pool)
            .await
            .unwrap();

        let matched = authenticate_by_identifier(&pool, "master@kasam360.com", "Master-3736!").await;
        assert!(matched.is_ok(), "hash'li MASTER girişi başarısız: {:?}", matched.err());
        assert_eq!(matched.unwrap().role, "MASTER");

        // Yanlış kimlik reddedilir.
        assert!(authenticate_by_identifier(&pool, "master@kasam360.com", "yanlis").await.is_err());

        // Hash yerine düz metin kalmış bir satır kabul edilmez (fallback kaldırıldı).
        sqlx::query("UPDATE platform_admins SET pin_hash = 'Master-3736!' WHERE id = 'adm_1'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            authenticate_by_identifier(&pool, "master@kasam360.com", "Master-3736!")
                .await
                .is_err(),
            "düz metn saklanan kimlik kabul edildi"
        );
    }

    /// `authenticate_by_pin` MASTER dalı da aynı kurala uyar.
    #[tokio::test]
    async fn platform_admin_pin_dogrulamasi_argon2_ile_calisir() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE platform_admins (
                id TEXT PRIMARY KEY,
                pin_hash TEXT,
                name TEXT NOT NULL,
                email TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE users (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL DEFAULT 'DEFAULT_TENANT',
                role TEXT NOT NULL,
                name TEXT NOT NULL,
                credential_hash TEXT,
                pin_hash TEXT,
                login_identifier TEXT,
                email TEXT,
                is_active INTEGER NOT NULL DEFAULT 1
             );
             CREATE TABLE tenant_modules (tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1);
             INSERT INTO platform_admins (id, pin_hash, name, email) VALUES ('adm_1', ?, 'Süper Admin', 'master@kasam360.com');",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE platform_admins SET pin_hash = ? WHERE id = 'adm_1'")
            .bind(crate::auth::hash_credential("7373").unwrap())
            .execute(&pool)
            .await
            .unwrap();

        let matched = authenticate_by_pin(&pool, "7373", Some("DEFAULT_TENANT")).await;
        assert!(matched.is_ok(), "hash'li MASTER PIN girişi başarısız: {:?}", matched.err());
        assert_eq!(matched.unwrap().role, "MASTER");

        assert!(authenticate_by_pin(&pool, "9999", Some("DEFAULT_TENANT")).await.is_err());

        // Düz metne dönen satır artık kabul edilmez.
        sqlx::query("UPDATE platform_admins SET pin_hash = '7373' WHERE id = 'adm_1'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            authenticate_by_pin(&pool, "7373", Some("DEFAULT_TENANT")).await.is_err(),
            "düz metn saklanan MASTER PIN kabul edildi"
        );
    }

    /// `managerPin` kaldırıldı: düz PIN artık hiçbir komuta taşınmaz.
    /// Sözleşmede yalnız tek kullanımlık `approvalToken` vardır ve alan
    /// opsiyoneldir — eksik jetonu sunucu reddeder, istemci bir "boş PIN"
    /// taklidi gönderemez.
    #[test]
    fn test_void_order_payload_dto_deserialization() {
        let json_data = r#"{
            "orderId": "ORD-101",
            "tableId": "TABLE-5",
            "reason": "Customer cancellation",
            "actorId": "CASHIER_01",
            "actorRole": "Cashier",
            "approvalToken": "9f2c_token"
        }"#;

        let dto: VoidOrderPayloadDto = serde_json::from_str(json_data).expect("Failed to deserialize");
        assert_eq!(dto.order_id, "ORD-101");
        assert_eq!(dto.table_id, "TABLE-5");
        assert_eq!(dto.reason, "Customer cancellation");
        assert_eq!(dto.actor_id, "CASHIER_01");
        assert_eq!(dto.actor_role, "Cashier");
        assert_eq!(dto.approval_token.unwrap(), "9f2c_token");

        // Eski alan gönderilse de DTO'ya girmez: düz PIN yüzeyi tamamen kapalı.
        let legacy = r#"{
            "orderId": "ORD-101",
            "tableId": "TABLE-5",
            "reason": "x",
            "actorId": "CASHIER_01",
            "actorRole": "Cashier",
            "managerPin": "1234"
        }"#;
        let legacy_dto: VoidOrderPayloadDto =
            serde_json::from_str(legacy).expect("Eski alan yüzeyi kırılmamalı");
        assert!(
            legacy_dto.approval_token.is_none(),
            "managerPin alanı onay yerine geçmemeli"
        );
    }

    /// Denetim kaydı istemciye giderken mühürlü bilgisi taşır; ham hash
    /// alanı DTO'da **yoktur** ve JSON'a sızmamalıdır.
    #[test]
    fn test_audit_log_dto_serialization() {
        let dto = AuditLogDto {
            id: "audit-001".to_string(),
            sequence: 42,
            timestamp: "2026-09-13T12:00:00Z".to_string(),
            actor_id: "SYS_ADMIN".to_string(),
            actor_role: "Owner".to_string(),
            category: crate::services::audit_service::category::SIPARIS_MASA.to_string(),
            action: "order:voided".to_string(),
            resource_id: "ORD-101".to_string(),
            payload: serde_json::json!({ "reason": "müşteri iptali" }),
            sealed: true,
        };

        let json_str = serde_json::to_string(&dto).expect("Failed to serialize");
        assert!(json_str.contains("\"actor_id\":\"SYS_ADMIN\""));
        assert!(json_str.contains("\"sequence\":42"));
        assert!(json_str.contains("\"action\":\"order:voided\""));
        assert!(json_str.contains("\"sealed\":true"));
        assert!(!json_str.contains("current_hash"));
        assert!(!json_str.contains("previous_hash"));
        assert!(!json_str.contains("hash\""));
    }

    #[test]
    fn test_cart_item_dto_deserialization_all_fields_present() {
        let json = r#"{
            "id": "item-1",
            "product": { "id": "prod-1", "name": "Tea" },
            "quantity": 2,
            "unitPrice": 1000,
            "taxRate": 10,
            "subtotal": 2000,
            "taxAmount": 200,
            "total": 2200,
            "modifiers": [{ "name": "Sugar" }],
            "note": "Extra hot",
            "discount": { "type": "PERCENTAGE", "value": 10 }
        }"#;
        let item: CartItemDto = serde_json::from_str(json).expect("Must deserialize when all fields present");
        assert_eq!(item.id, "item-1");
        assert_eq!(item.quantity, 2);
        assert_eq!(item.unit_price, 1000);
        assert_eq!(item.tax_rate, Some(10));
        assert_eq!(item.subtotal, Some(2000));
        assert_eq!(item.tax_amount, Some(200));
        assert_eq!(item.total, Some(2200));
        assert_eq!(item.note, Some("Extra hot".to_string()));
    }

    #[test]
    fn test_cart_item_dto_deserialization_nullable_and_null_optional_fields() {
        let json = r#"{
            "id": "item-2",
            "product": { "id": "prod-1" },
            "quantity": 1,
            "unitPrice": 2000,
            "taxRate": null,
            "subtotal": null,
            "taxAmount": null,
            "total": null,
            "modifiers": null,
            "note": null,
            "discount": null
        }"#;
        let item: CartItemDto = serde_json::from_str(json).expect("Must deserialize null optional fields");
        assert_eq!(item.id, "item-2");
        assert_eq!(item.unit_price, 2000);
        assert_eq!(item.tax_rate, None);
        assert_eq!(item.subtotal, None);
        assert_eq!(item.tax_amount, None);
        assert_eq!(item.total, None);
    }

    #[test]
    fn test_cart_item_dto_deserialization_missing_optional_fields() {
        let json = r#"{
            "id": "item-3",
            "product": { "id": "prod-2" },
            "quantity": 1,
            "unitPrice": 1500
        }"#;
        let item: CartItemDto = serde_json::from_str(json).expect("Must deserialize missing optional fields");
        assert_eq!(item.id, "item-3");
        assert_eq!(item.unit_price, 1500);
        assert_eq!(item.tax_rate, None);
        assert_eq!(item.subtotal, None);
        assert_eq!(item.total, None);
    }

    #[test]
    fn test_cart_item_dto_deserialization_malformed_numeric_rejected() {
        let json = r#"{
            "id": "item-4",
            "product": { "id": "prod-3" },
            "quantity": "not-a-number",
            "unitPrice": 1000
        }"#;
        let result: Result<CartItemDto, _> = serde_json::from_str(json);
        assert!(result.is_err(), "Must reject malformed quantity string");
    }

    #[test]
    fn test_cart_item_dto_deserialization_normal_pos_order() {
        let json = r#"{
            "id": "item-normal",
            "product": { "id": "prd-001", "name": "Turk Kahvesi" },
            "quantity": 1,
            "unitPrice": 2000,
            "taxRate": 8,
            "subtotal": 2000,
            "taxAmount": 160,
            "total": 2160
        }"#;
        let item: CartItemDto = serde_json::from_str(json).expect("Must deserialize standard normal POS item");
        assert_eq!(item.id, "item-normal");
        assert_eq!(item.unit_price, 2000);
        assert_eq!(item.total, Some(2160));
    }
}
