//! Credential primitives used by the desktop authentication commands.
//!
//! The database stores only an Argon2 PHC string.  Raw PINs/passwords must
//! never be selected from, or returned by, an IPC command.

use argon2::{password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString}, Argon2};

pub fn hash_credential(credential: &str) -> Result<String, String> {
    if credential.trim().is_empty() {
        return Err("Credential cannot be empty".to_string());
    }

    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(credential.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| "Could not protect credential".to_string())
}

pub fn verify_credential(credential: &str, encoded_hash: &str) -> bool {
    if credential.is_empty() || encoded_hash.is_empty() {
        return false;
    }

    PasswordHash::new(encoded_hash)
        .ok()
        .and_then(|parsed| Argon2::default().verify_password(credential.as_bytes(), &parsed).ok())
        .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_hash_is_one_way_and_verifiable() {
        let hash = hash_credential("correct-secret").unwrap();
        assert_ne!(hash, "correct-secret");
        assert!(verify_credential("correct-secret", &hash));
        assert!(!verify_credential("wrong-secret", &hash));
    }
}
