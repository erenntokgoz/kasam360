//! Domain hata tipi — tek kaynaklı, thiserror ile üretilir.
//!
//! Neden bu dosya: AGENTS.md §3.4'te "finansal toplamlarda unwrap_or(0) YASAK"
//! kuralı var. Hata senaryosu `Err` döndüğünü kanıtlamalı, `0` dönmediğini de.
//! Bu hata tipi, hataabove taşınan her yere tek bir şekilde hata verir:
//! `Result<T, DomainError>` — `?` ile automatik genişletilir, `String`'a çevrilebilir.
//!
//! Neden thiserror: manuel `impl Error` yazmak yerine derive, Display + Error
//! imzalarını tek satırda üretir. `From<sqlx::Error>` automap ile veritabanı
//! hataları domain hatasına dönüşür.

use thiserror::Error;

/// KASAM360 domain katmanının tek hata tipi.
///
/// Her varyant fail-closed prensibiyle üretilir: hata senaryosunda komut
/// `Err` döner ve upstream (Tauri IPC → frontend) hatayı gösterir.
/// Sessiz `0` dönüşü yoktur.
#[derive(Debug, Error)]
pub enum DomainError {
    /// Kiracı kimliği yok veya boş. Fail-closed.
    #[error("UNAUTHORIZED: tenant_id is required")]
    TenantRequired,

    /// Şube kimliği yok veya boş.
    #[error("UNAUTHORIZED: branch_id is required")]
    BranchRequired,

    /// Rol bilinmiyeti veya yetki eksikliği.
    #[error("UNAUTHORIZED: {0}")]
    Unauthorized(String),

    /// Kayıt yok. Başka kiracının kaydını sızdırmamak için tek mesaj.
    #[error("NOT_FOUND: {0}")]
    NotFound(String),

    /// Geçersiz girdi (valide edilemez alan).
    #[error("INVALID_ARGUMENT: {0}")]
    InvalidArgument(String),

    /// Para tutarı negatif. CHECK constraint + domain katmanı iki katlı koruma.
    #[error("INVALID_ARGUMENT: amount must be non-negative, got {0}")]
    NegativeAmount(i64),

    /// Vardiya kapalı iken işlem yapilmaya calisildi.
    #[error("SHIFT_CLOSED: {0}")]
    ShiftClosed(String),

    /// Kilitlenme (PIN deneme limiti, busy timeout).
    #[error("LOCKED: {0}")]
    Locked(String),

    /// Veritabanı hatası. `From<sqlx::Error>` ile otomatik dönüşüm.
    #[error("DATABASE_ERROR: {0}")]
    Database(#[from] sqlx::Error),

    /// Argon2 hatası.
    #[error("ARGON2_ERROR: {0}")]
    Argon2(String),

    /// Diğер beklenmeyen hata.
    #[error("INTERNAL_ERROR: {0}")]
    Internal(String),
}

impl DomainError {
    /// String hatasını DomainError'a dönüştürür (mevcut `Result<_, String>` kodu için geçiş).
    pub fn from_message(msg: String) -> Self {
        if msg.starts_with("UNAUTHORIZED") {
            DomainError::Unauthorized(msg)
        } else if msg.starts_with("NOT_FOUND") {
            DomainError::NotFound(msg)
        } else if msg.starts_with("INVALID_ARGUMENT") {
            DomainError::InvalidArgument(msg)
        } else if msg.starts_with("SHIFT_CLOSED") {
            DomainError::ShiftClosed(msg)
        } else if msg.starts_with("LOCKED") {
            DomainError::Locked(msg)
        } else {
            DomainError::Internal(msg)
        }
    }
}

/// Tauri IPC'nin `String` tipini desteklemesi için. DomainError → String.
impl From<DomainError> for String {
    fn from(err: DomainError) -> Self {
        err.to_string()
    }
}
