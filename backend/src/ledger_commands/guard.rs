//! Hesap Defteri komutlarının ortak güvenlik kapıları.
//!
//! Neden ayrı dosya: `AGENTS.md §3.3` kiracı izolasyonunu, `§3.4` finansal
//! sessiz hatayı yasaklar. Bu kapılar dokuz ledger komutunun tamamında
//! aynıdır; her komuta ayrı ayrı yazılırsa bir gün biri unutulur.

use crate::rbac::{self, Role};

/// Ledger okuma kapısı: cari kart, borç ve gider listesi.
///
/// Neden kasiyer de burada: `desktop/src/core/security/navigationMatrix.ts`
/// `ledgerAccess` satırı OWNER=FULL, MANAGER=PARTIAL, CASHIER=PARTIAL verir,
/// yani kasiyer bu ekranı görebilir. Garson, mutfak ve MASTER dışarıdadır.
const READ_ROLES: [Role; 3] = [Role::Owner, Role::Manager, Role::Cashier];

/// Ledger yazma kapısı: cari kart açma/güncelleme, borç açma/ödeme, gider fişi.
///
/// Neden kasiyer dışarıda: bu komutlar parayı hareket ettirir (`cash_movements`
/// satırı yazar) veya borç bakiyesini değiştirir. `ledgerAccess` satırındaki
/// "PARTIAL" yetki okumadır; tahsilat/ödeme kaydı işletme sahibi ve müdürün
/// yetkisindedir.
const WRITE_ROLES: [Role; 2] = [Role::Owner, Role::Manager];

/// [`Option`] taşıyan rol alanı için fail-closed okuma kapısı.
///
/// Neden: Tauri IPC'de eksik alan `None` olur. `if let Some(role) = ... { ... }`
/// deseni rolü hiç göndermeyen çağıranı sessizce geçirir — kapı kendisi
/// kapanırken açık kalır. Rolün varlığı da yetkidir; `None` reddedilir.
pub fn require_ledger_read(caller_role: Option<&str>) -> Result<Role, String> {
    rbac::require_any_present(caller_role, &READ_ROLES)
}

/// [`Option`] taşıyan rol alanı için fail-closed yazma kapısı.
pub fn require_ledger_write(caller_role: Option<&str>) -> Result<Role, String> {
    rbac::require_any_present(caller_role, &WRITE_ROLES)
}

/// Kiracı kimliğini fail-closed çözer.
///
/// Neden: `tenant_id` gelmezse ya da boşsa önceki davranış `DEFAULT_TENANT`
/// yazıyordu. Bu, oturumsuz bir çağıranın tek bir işletmenin verisini
/// okumasına veya kiracısız satır oluşturmasına yol açıyordu. Boş kabul
/// edilirse `tenant_id = ''` sorguları hiç eşleşmez ve yazma sessizce başarısız
/// olur; bu yüzden hata fırlatılır.
pub fn require_ledger_tenant(tenant_id: Option<&str>) -> Result<String, String> {
    tenant_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "UNAUTHORIZED: tenant_id is required".to_string())
}