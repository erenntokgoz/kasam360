//! Yasal ve kampanya servis testleri.
//!
//! Altı modül aynı şemayı ve aynı yardımcıları kullanır; dosya adları komut
//! modülleriyle birebir eşleşir (`legal_commands.rs` -> `legal_tests.rs`).
//!
//! `coupon_tests` ayrı dosyadır: kupon uygulama senaryoları kayıt testlerinden
//! hızlı büyür ve tek dosyada toplanınca 500 satır sınırını aşar. Ayrım
//! testlerin okunmasını da kolaylaştırır — kayıt mı kasa mı?

mod campaign_tests;
mod coupon_tests;
mod e_invoice_tests;
mod insurance_tests;
mod legal_tests;
mod music_license_tests;
mod special_day_tests;
mod support;
