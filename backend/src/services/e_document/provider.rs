//! Özel entegratör sözleşmesi: imzala, gönder, durum sorgula.
//!
//! Neden trait: gerçek sağlayıcı (özel entegratör) henüz seçilmedi; kuyruk ve belge
//! üretimi sağlayıcıdan bağımsız kalır. Bu sürümde gerçek bir uygulama YOKTUR; üretimde
//! çözümlenen tek uygulama `UnconfiguredProvider`dır ve her çağrıyı reddeder
//! (fail-closed). Sahte sağlayıcı yalnız `#[cfg(test)]` altında bulunur.
//!
//! Sağlayıcıdan beklenen sözleşme: `send` ETTN'i idempotency anahtarı sayar; aynı ETTN
//! ikinci kez gelirse yeni belge açmaz, ilk makbuzu döndürür. Uygulama çökmesi
//! "gönderildi, kaydedilmedi" aralığı bırakabilir; bu aralığı yalnız bu özellik kapatır.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderError {
    /// Sağlayıcı yapılandırılmamış: belge kuyrukta bekler, deneme sayılmaz.
    NotConfigured,
    /// Ağ yok veya sağlayıcı geçici ulaşılamaz: belge kuyrukta bekler, deneme sayılmaz.
    Offline(String),
    /// Sağlayıcı belgeyi kalıcı reddetti: belge HATA durumuna geçer.
    Rejected(String),
}

impl ProviderError {
    pub fn message(&self) -> String {
        match self {
            ProviderError::NotConfigured => "e-Belge sağlayıcısı yapılandırılmamış".to_string(),
            ProviderError::Offline(detail) => format!("Sağlayıcıya ulaşılamadı: {detail}"),
            ProviderError::Rejected(detail) => format!("Sağlayıcı reddetti: {detail}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SendReceipt {
    /// Sağlayıcının belge için verdiği başvuru numarası.
    pub provider_ref: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteStatus {
    Accepted,
    Pending,
    Rejected(String),
}

pub trait EDocumentProvider: Send + Sync {
    /// Arayüz uyarısı için: gerçek bir sağlayıcı bağlı mı.
    fn is_configured(&self) -> bool {
        true
    }
    /// Mali mühür/e-imzayı ekleyerek imzalı XML'i döndürür.
    fn sign<'a>(&'a self, xml: &'a str) -> BoxFuture<'a, Result<String, ProviderError>>;
    /// İmzalı belgeyi gönderir; `ettn` idempotency anahtarıdır.
    fn send<'a>(
        &'a self,
        ettn: &'a str,
        signed_xml: &'a str,
    ) -> BoxFuture<'a, Result<SendReceipt, ProviderError>>;
    /// Gönderilmiş belgenin sağlayıcı/GİB tarafındaki durumunu sorgular.
    fn status<'a>(&'a self, ettn: &'a str) -> BoxFuture<'a, Result<RemoteStatus, ProviderError>>;
}

/// Üretimdeki tek çözümleme: her işlem "sağlayıcı yapılandırılmamış" ile reddedilir.
pub struct UnconfiguredProvider;

impl EDocumentProvider for UnconfiguredProvider {
    fn is_configured(&self) -> bool {
        false
    }

    fn sign<'a>(&'a self, _xml: &'a str) -> BoxFuture<'a, Result<String, ProviderError>> {
        Box::pin(async { Err(ProviderError::NotConfigured) })
    }

    fn send<'a>(
        &'a self,
        _ettn: &'a str,
        _signed_xml: &'a str,
    ) -> BoxFuture<'a, Result<SendReceipt, ProviderError>> {
        Box::pin(async { Err(ProviderError::NotConfigured) })
    }

    fn status<'a>(&'a self, _ettn: &'a str) -> BoxFuture<'a, Result<RemoteStatus, ProviderError>> {
        Box::pin(async { Err(ProviderError::NotConfigured) })
    }
}

/// Çalışma zamanı sağlayıcısı. Özel entegratör seçilip uygulandığında burası değişir;
/// o güne dek yapılandırılmamış sağlayıcı döner.
pub fn runtime_provider() -> Arc<dyn EDocumentProvider> {
    Arc::new(UnconfiguredProvider)
}

#[cfg(test)]
pub(crate) mod fake {
    //! Yalnız test için sahte sağlayıcı; derleme çıktısına girmez.

    use std::sync::Mutex;

    use super::*;

    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum Mode {
        Accept,
        Offline,
        Reject,
    }

    pub struct FakeProvider {
        pub mode: Mutex<Mode>,
        /// Her gerçek gönderimin ETTN'i; ikinci gönderimi yakalamak için sayılır.
        pub sent: Mutex<Vec<String>>,
    }

    impl FakeProvider {
        pub fn new(mode: Mode) -> Self {
            Self {
                mode: Mutex::new(mode),
                sent: Mutex::new(Vec::new()),
            }
        }

        pub fn set_mode(&self, mode: Mode) {
            if let Ok(mut guard) = self.mode.lock() {
                *guard = mode;
            }
        }

        pub fn sent_count(&self) -> usize {
            self.sent.lock().map(|s| s.len()).unwrap_or(usize::MAX)
        }

        fn current(&self) -> Mode {
            self.mode.lock().map(|m| *m).unwrap_or(Mode::Offline)
        }
    }

    impl EDocumentProvider for FakeProvider {
        fn sign<'a>(&'a self, xml: &'a str) -> BoxFuture<'a, Result<String, ProviderError>> {
            Box::pin(async move { Ok(format!("{xml}<!-- imzalı -->")) })
        }

        fn send<'a>(
            &'a self,
            ettn: &'a str,
            _signed_xml: &'a str,
        ) -> BoxFuture<'a, Result<SendReceipt, ProviderError>> {
            Box::pin(async move {
                match self.current() {
                    Mode::Offline => Err(ProviderError::Offline("ağ yok".to_string())),
                    Mode::Reject => Err(ProviderError::Rejected("şema hatası".to_string())),
                    Mode::Accept => {
                        if let Ok(mut sent) = self.sent.lock() {
                            sent.push(ettn.to_string());
                        }
                        Ok(SendReceipt {
                            provider_ref: format!("ref-{ettn}"),
                        })
                    }
                }
            })
        }

        fn status<'a>(
            &'a self,
            _ettn: &'a str,
        ) -> BoxFuture<'a, Result<RemoteStatus, ProviderError>> {
            Box::pin(async move {
                match self.current() {
                    Mode::Accept => Ok(RemoteStatus::Accepted),
                    Mode::Offline => Err(ProviderError::Offline("ağ yok".to_string())),
                    Mode::Reject => Ok(RemoteStatus::Rejected("GİB reddetti".to_string())),
                }
            })
        }
    }
}
