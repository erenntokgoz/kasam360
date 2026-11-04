//! Sunucu tarafı personel oturumu ve IPC kimlik kapısı.
//!
//! Neden: komutlar rol, kiracı ve aktörü istemciden parametre olarak alır. Arayüz
//! kodunda çalışan herhangi bir betik `actorRole: "OWNER"` yazarak maaş görebilir,
//! kiracı değiştirebilirdi. PIN doğrulandığında oturum burada tutulur; kapı her
//! komuttan önce çalışır ve bildirilen kimlik oturumla aynı değilse komutu durdurur.
//! Komutların 280 imzasını tek tek değiştirmek yerine tek kapı kullanılır: yeni komut
//! da kendiliğinden kapsanır, liste yalnız oturumsuz çalışabilecekleri sayar.

use std::sync::Mutex;

use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaffSession {
    pub user_id: String,
    pub tenant_id: String,
    pub role: String,
    /// Kilit ekranı arayüz perdesi değildir: kilitliyken sunucu komut çalıştırmaz.
    pub locked: bool,
}

/// Bellekte kalır: uygulama kapanınca personel yeniden PIN girer.
#[derive(Default)]
pub struct StaffSessions(Mutex<Option<StaffSession>>);

impl StaffSessions {
    pub fn set(&self, session: StaffSession) -> Result<(), String> {
        *self.lock()? = Some(session);
        Ok(())
    }

    pub fn clear(&self) -> Result<(), String> {
        *self.lock()? = None;
        Ok(())
    }

    pub fn set_locked(&self, locked: bool) -> Result<(), String> {
        if let Some(session) = self.lock()?.as_mut() {
            session.locked = locked;
        }
        Ok(())
    }

    pub fn current(&self) -> Result<Option<StaffSession>, String> {
        Ok(self.lock()?.clone())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Option<StaffSession>>, String> {
        self.0
            .lock()
            .map_err(|_| "UNAUTHORIZED: oturum durumu okunamadı".to_string())
    }
}

/// Oturum açılmadan çalışması gereken komutlar: kurulum, hesap girişi ve PIN ekranı.
/// Liste kapalıdır: yeni komut buraya eklenmedikçe oturum ister.
const NO_SESSION: [&str; 16] = [
    "get_setup_status",
    "save_setup_draft",
    "complete_business_setup",
    "join_existing_business",
    "restore_backup_on_setup",
    "get_device_session",
    "open_site_page",
    "get_pin_lengths",
    "account_sign_in",
    // Google ile cihaz girişi personel oturumundan önce gelir; kimliği sunucu doğrular.
    "account_sign_in_link",
    "account_create",
    "auth_login",
    "auth_logout",
    "auth_lock",
    "get_sync_status",
    "take_over_device",
];

/// Parametresi kullanıcı kimliği olan ve yalnız kişinin kendisi için çalışan komutlar.
const SELF_ONLY: [&str; 2] = ["auth_unlock", "change_self_pin"];

fn normalized(key: &str) -> String {
    key.replace('_', "").to_ascii_lowercase()
}

fn mismatch(field: &str) -> String {
    format!("UNAUTHORIZED: {field} oturumla eşleşmiyor")
}

fn expect_session_value(value: &Value, expected: &str, field: &str) -> Result<(), String> {
    match value {
        Value::Null => Ok(()),
        Value::String(text) if text.eq_ignore_ascii_case(expected) => Ok(()),
        _ => Err(mismatch(field)),
    }
}

/// Gövdedeki tüm düzeyler taranır: kimlik alanları `payload` veya `args` içinde de gelir.
fn check_value(session: &StaffSession, self_only: bool, value: &Value) -> Result<(), String> {
    match value {
        Value::Object(fields) => {
            for (key, inner) in fields {
                match normalized(key).as_str() {
                    "tenantid" | "callertenantid" if session.role != "MASTER" => {
                        expect_session_value(inner, &session.tenant_id, "kiracı")?
                    }
                    "actorrole" | "callerrole" => {
                        expect_session_value(inner, &session.role, "rol")?
                    }
                    "actorid" | "callerid" => {
                        expect_session_value(inner, &session.user_id, "kullanıcı")?
                    }
                    "userid" if self_only => {
                        expect_session_value(inner, &session.user_id, "kullanıcı")?
                    }
                    _ => check_value(session, self_only, inner)?,
                }
            }
            Ok(())
        }
        Value::Array(items) => items
            .iter()
            .try_for_each(|item| check_value(session, self_only, item)),
        _ => Ok(()),
    }
}

/// Oturum gerekmeyen komut değilse oturum şarttır; bildirilen kimlik oturumla aynı olmalı.
pub fn authorize(
    session: Option<&StaffSession>,
    command: &str,
    payload: Option<&Value>,
) -> Result<(), String> {
    if NO_SESSION.contains(&command) {
        return Ok(());
    }
    let session = session.ok_or_else(|| "UNAUTHORIZED: oturum açılmamış".to_string())?;
    if session.locked && command != "auth_unlock" {
        return Err("SESSION_LOCKED: oturum kilitli; PIN ile açın".to_string());
    }
    let payload = payload.ok_or_else(|| "UNAUTHORIZED: komut gövdesi okunamıyor".to_string())?;
    check_value(session, SELF_ONLY.contains(&command), payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cashier() -> StaffSession {
        StaffSession {
            user_id: "usr_kasiyer".to_string(),
            tenant_id: "tnt_a".to_string(),
            role: "CASHIER".to_string(),
            locked: false,
        }
    }

    #[test]
    fn oturumsuz_komut_reddedilir_giris_komutlari_calisir() {
        assert!(authorize(None, "open_site_page", None).is_ok());
        let body = json!({});
        assert!(authorize(None, "run_payroll", Some(&body)).is_err());
        assert!(authorize(None, "yeni_eklenen_komut", Some(&body)).is_err());
        assert!(authorize(None, "auth_login", Some(&body)).is_ok());
        assert!(authorize(None, "account_sign_in", Some(&body)).is_ok());
    }

    #[test]
    fn kasiyer_rolunu_sahip_diye_bildiremez() {
        let body = json!({ "actorRole": "OWNER", "tenantId": "tnt_a" });
        let error = authorize(Some(&cashier()), "get_payroll_rules", Some(&body));
        assert!(error.is_err_and(|text| text.contains("rol")));
    }

    #[test]
    fn baska_kiraci_ve_aktor_ic_gövdede_de_reddedilir() {
        let session = cashier();
        for body in [
            json!({ "tenantId": "tnt_b" }),
            json!({ "tenant_id": "tnt_b" }),
            json!({ "callerTenantId": "tnt_b" }),
            json!({ "payload": { "tenantId": "tnt_b" } }),
            json!({ "args": { "items": [{ "actorId": "usr_baska" }] } }),
            json!({ "actorRole": 1 }),
        ] {
            assert!(
                authorize(Some(&session), "create_expense", Some(&body)).is_err(),
                "{body}"
            );
        }
    }

    #[test]
    fn dogru_kimlik_ve_buyuk_kucuk_harf_farki_gecer() {
        let body = json!({
            "actorRole": "Cashier",
            "actorId": "usr_kasiyer",
            "tenantId": "tnt_a",
            "note": null,
            "payload": { "userId": "usr_baska", "tenantId": null },
        });
        assert!(authorize(Some(&cashier()), "create_expense", Some(&body)).is_ok());
    }

    #[test]
    fn baskasinin_pini_degistirilemez() {
        let body = json!({ "userId": "usr_baska" });
        assert!(authorize(Some(&cashier()), "change_self_pin", Some(&body)).is_err());
        assert!(authorize(Some(&cashier()), "auth_unlock", Some(&body)).is_err());
        let own = json!({ "userId": "usr_kasiyer" });
        assert!(authorize(Some(&cashier()), "change_self_pin", Some(&own)).is_ok());
    }

    #[test]
    fn platform_hesabi_hedef_kiraciyi_secebilir_rolu_degil() {
        let master = StaffSession {
            user_id: "adm_1".to_string(),
            tenant_id: "PLATFORM".to_string(),
            role: "MASTER".to_string(),
            locked: false,
        };
        let tenant = json!({ "tenantId": "tnt_b", "actorRole": "MASTER" });
        assert!(authorize(Some(&master), "update_tenant", Some(&tenant)).is_ok());
        let role = json!({ "actorRole": "OWNER" });
        assert!(authorize(Some(&master), "update_tenant", Some(&role)).is_err());
    }

    #[test]
    fn kilitli_oturum_yalniz_kilit_acma_ve_oturumsuz_komutlari_gecirir() {
        let locked = StaffSession {
            locked: true,
            ..cashier()
        };
        let body = json!({ "userId": "usr_kasiyer", "tenantId": "tnt_a" });
        let error = authorize(Some(&locked), "create_expense", Some(&body));
        assert!(error.is_err_and(|text| text.starts_with("SESSION_LOCKED")));
        assert!(authorize(Some(&locked), "auth_unlock", Some(&body)).is_ok());
        assert!(authorize(Some(&locked), "auth_logout", Some(&body)).is_ok());
        let other = json!({ "userId": "usr_baska" });
        assert!(authorize(Some(&locked), "auth_unlock", Some(&other)).is_err());
    }

    #[tokio::test]
    async fn kilit_durumu_oturumda_tutulur() {
        let sessions = StaffSessions::default();
        sessions.set(cashier()).expect("oturum");
        sessions.set_locked(true).expect("kilit");
        assert!(sessions.current().expect("oku").is_some_and(|s| s.locked));
        sessions.set_locked(false).expect("açma");
        assert!(sessions.current().expect("oku").is_some_and(|s| !s.locked));
    }

    #[test]
    fn okunamayan_govde_kapali_kalir() {
        assert!(authorize(Some(&cashier()), "create_expense", None).is_err());
    }
}
