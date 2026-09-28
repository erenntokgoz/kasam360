#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Uygulama giriş noktası: Tüm Tauri komutları ve durum yönetimi lib.rs üzerinden koordine edilir.
fn main() {
    kasam360_core::run();
}
