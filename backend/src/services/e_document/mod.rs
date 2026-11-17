//! e-Adisyon (GİB UBL-TR) belge altyapısı: XML üretimi, kalıcı kuyruk, sağlayıcı sözleşmesi.
//!
//! Kapsam bilinçli olarak gönderimsiz: gerçek bir özel entegratör henüz seçilmedi.
//! Belge üretilir ve kuyruğa yazılır; gönderim `EDocumentProvider` arkasındadır ve
//! üretimde sağlayıcı yapılandırılmamış sayılarak reddedilir (fail-closed).
//! Veri akışı ve entegratöre sorulacaklar: `docs/contracts/e-adisyon.md`.

pub mod auto_enqueue;
pub mod dispatcher;
pub mod model;
pub mod provider;
pub mod queue;
pub mod settings;
pub mod source;
pub mod tax_id;
pub mod xml;

#[cfg(test)]
mod test_support;

#[cfg(test)]
mod dispatcher_tests;
#[cfg(test)]
mod queue_tests;
#[cfg(test)]
mod xml_tests;
