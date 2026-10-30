//! Çok cihazlı modda IPC komutlarının tek kapısı.
//!
//! Neden merkezi: kapı komut başına yazılınca menü ve stok gibi yazmalar unutulmuştu;
//! bir cihazdaki değişiklik diğerine gitmiyor, cihazlar sessizce ayrışıyordu. Burada
//! liste kapalıdır: yeni bir komut açıkça eklenmedikçe çok cihazlı modda durur.
//!
//! Komut adından okuma varsaymak bu listeyi kısaltır; `get_`/`list_` ile başlayıp
//! yazan komut açılmamalıdır. Tek cihazda kapı devre dışıdır.

/// Yerel tablolara yazar veya oturumla ilgilidir; işletme verisini değiştirmez.
const DEVICE_LOCAL: [&str; 16] = [
    "create_backup_now",
    "set_backup_mirror",
    "auth_login",
    "auth_unlock",
    "account_sign_in",
    "account_sign_out",
    "set_session_policy",
    "pos_get_categories",
    "pos_get_products",
    "print_receipt",
    "print_z_report",
    "print_day_z_report",
    "print_cash_slip",
    "print_order_slip",
    "print_void_slip",
    "print_payment_receipt",
];

/// İşlem günlüğünden geçen veya eşitlemeyi yöneten komutlar. Kendi kapıları vardır.
const REPLICATED: [&str; 7] = [
    "create_directory",
    "update_directory",
    "create_debt",
    "pay_debt",
    "approve_supplier_document",
    "create_pairing_code",
    "set_device_passive",
];

fn is_read(command: &str) -> bool {
    ["get_", "list_", "find_", "export_"]
        .iter()
        .any(|prefix| command.starts_with(prefix))
}

pub fn allowed_in_cluster(command: &str) -> bool {
    is_read(command) || DEVICE_LOCAL.contains(&command) || REPLICATED.contains(&command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eslenmeyen_yazmalar_durur() {
        for command in [
            "create_product",
            "update_product",
            "adjust_stock",
            "create_staff_member",
            "process_payment",
            "submit_order",
            "void_order_item",
            "open_shift",
            "save_floor_layout",
            "yeni_eklenen_komut",
        ] {
            assert!(!allowed_in_cluster(command), "{command}");
        }
    }

    #[test]
    fn okuma_oturum_ve_cogaltilan_komutlar_calisir() {
        for command in [
            "get_sync_status",
            "list_staff_profiles",
            "auth_login",
            "account_sign_in",
            "pos_get_products",
            "pay_debt",
            "set_device_passive",
        ] {
            assert!(allowed_in_cluster(command), "{command}");
        }
    }
}
