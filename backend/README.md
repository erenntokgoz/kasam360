# KASAM360 — Backend & Çekirdek Servisler (Backend)

KASAM360'ın yerel veritabanı, finansal otorite motoru ve Tauri (Rust) IPC çekirdeğini barındıran backend katmanıdır.

## Dizin Yapısı & Sorumluluklar

- **`src/`**: Rust çekirdek modülleri ve komut işleyicileri (handlers)
  - `commands.rs`: Ana sipariş ve ödeme IPC komutları
  - `cashier_commands.rs`: Vardiya açılış/kapanış, nakit giriş/çıkış (Cash In/Out) ve Z-Raporu
  - `kitchen_commands.rs`: KDS mutfak istasyonları bilet ve kalem durum akışları
  - `management_commands.rs`: Kategori, ürün ve operasyonel yönetim komutları
  - `platform_commands.rs`: Multi-tenant işletme kaydı, lisans, vault ve şube yönetimi
  - `approval_commands.rs`: Yetkili PIN onayları (Void, Fire vb.)
  - `auth.rs`: Argon2 PHC şifreleme ve güvenli PIN doğrulama motoru
  - `db.rs`: SQLite WAL modu bağlantı havuzu ve DDL şema başlatıcı
  - `services/`:
    - `payment_service.rs`: Kuruş (cents) bazlı finansal tutar otoritesi ve AppState mutex kilidi
    - `inventory_service.rs`: FIFO COGS (Satılan Malın Maliyeti) ve stok hareketleri
    - `audit_service.rs`: SHA-256 hash zincirli değiştirilemez denetim defteri (immutable ledger)
  - `repositories/`: Kalıcı veri erişim katmanı (`PaymentRepository`)
- **`migrations/`**: SQLite şema dosyaları (`schema.sql`)
- **`kasam360.db`**: Yerel SQLite veritabanı (WAL modu)
- **`tauri.conf.json`**: Masaüstü derleme ve IPC güvenlik yapılandırması
- **`Cargo.toml` / `Cargo.lock`**: Rust bağımlılıkları (`sqlx`, `tauri`, `argon2`, `tokio`, vb.)

## Derleme ve Doğrulama
```bash
# Backend derleme kontrolü
cargo check
```
