pub mod commands;
pub mod auth;
pub mod db;
pub mod services;
pub mod repositories;
pub mod management_commands;
pub mod platform_commands;
pub mod inventory_commands;
pub mod branch_commands;
pub mod approval_commands;
pub mod cashier_commands;
pub mod waiter_commands;
pub mod kitchen_commands;
pub mod analytics_commands;
pub mod id_generator;
pub mod ledger_commands;
pub mod rbac;
pub mod user_credentials;

pub use db::{init_db, DbPool};

/// Aşama 2 - Tauri tarafından yönetilen global uygulama durumu.
///
/// `payment_mutex`, tüm `process_payment` ve `process_split_payment` çağrılarını serileştirir.
/// `audit_mutex`, denetim defteri (audit ledger) kayıtlarını serileştirir; menü ve ürün
/// yönetim komutlarının kasayı kilitlenmesini engeller.
pub struct AppState {
    pub payment_mutex: tokio::sync::Mutex<()>,
    pub audit_mutex: tokio::sync::Mutex<()>,
    pub table_locks: tokio::sync::Mutex<std::collections::HashMap<String, (String, i64)>>,
}

pub fn run() {
    let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
    let pool = rt.block_on(async {
        let database_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "sqlite://kasam360.db".to_string());
        init_db(&database_url)
            .await
            .expect("Failed to initialize database")
    });

    tauri::Builder::default()
        .manage(pool)
        .manage(AppState {
            payment_mutex: tokio::sync::Mutex::new(()),
            audit_mutex: tokio::sync::Mutex::new(()),
            table_locks: tokio::sync::Mutex::new(std::collections::HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::process_payment,
            commands::process_split_payment,
            commands::kds_update_ticket_status,
            commands::get_active_tickets,
            commands::get_floor_plan,
            commands::move_table,
            commands::reserve_table,
            commands::pos_get_categories,
            commands::pos_get_products,
            commands::submit_order,
            commands::get_order_items,
            commands::try_lock_table,
            commands::unlock_table,
            management_commands::get_management_categories,
            management_commands::create_category,
            management_commands::update_category,
            management_commands::delete_category,
            management_commands::get_management_products,
            management_commands::create_product,
            management_commands::update_product,
            management_commands::update_product_status,
            management_commands::delete_product,
            analytics_commands::get_analytics_dashboard_data,
            commands::auth_login,
            commands::add_table,
            commands::remove_table,
            commands::update_table_name,
            commands::get_daily_summary,
            commands::get_receipts,
            commands::get_receipt_details,
            commands::void_order,
            commands::get_audit_logs,
            commands::print_receipt,
            inventory_commands::get_inventory,
            inventory_commands::adjust_stock,
            inventory_commands::get_low_stock_alerts,
            inventory_commands::create_inventory_item,
            branch_commands::get_branches,
            branch_commands::create_branch,
            approval_commands::request_approval,
            approval_commands::get_pending_approvals,
            approval_commands::process_approval,
            cashier_commands::cash_in,
            cashier_commands::cash_out,
            cashier_commands::get_shift_summary,
            commands::get_shift_history,
            commands::close_day,
            commands::merge_tables,
            commands::get_live_orders,
            commands::get_open_shifts,
            waiter_commands::get_product_modifiers,
            waiter_commands::update_table_status,
            waiter_commands::waiter_clock_in,
            waiter_commands::get_table_ready_status,
            platform_commands::get_tenants,
            platform_commands::create_tenant,
            platform_commands::update_tenant,
            platform_commands::suspend_tenant,
            platform_commands::activate_tenant,
            platform_commands::update_tenant_modules,
            platform_commands::get_devices,
            platform_commands::record_device_heartbeat,
            platform_commands::register_device,
            platform_commands::get_global_users,
            platform_commands::get_platform_audit_logs,
            management_commands::get_staff,
            management_commands::create_staff_member,
            management_commands::delete_staff_member,
            management_commands::get_modifier_groups,
            management_commands::create_modifier_group,
            management_commands::add_modifier_option,
            management_commands::delete_modifier_group,
            kitchen_commands::get_stations,
            kitchen_commands::create_station,
            kitchen_commands::update_kds_item_status,
            commands::open_shift,
            commands::close_shift,
            commands::get_active_shift,
            commands::auth_login_credentials,
            commands::change_self_pin,
            platform_commands::toggle_device_status,
            platform_commands::delete_device,
            platform_commands::verify_audit_ledger_integrity,
            platform_commands::create_remote_session,
            platform_commands::execute_it_action,
            platform_commands::get_user_credentials,
            platform_commands::reset_user_password,
            platform_commands::change_user_pin,
            platform_commands::regenerate_license_key,
            waiter_commands::get_all_table_statuses,
            ledger_commands::get_directories,
            ledger_commands::create_directory,
            ledger_commands::update_directory,
            ledger_commands::get_debts,
            ledger_commands::create_debt,
            ledger_commands::pay_debt,
            ledger_commands::get_expenses,
            ledger_commands::create_expense,
            ledger_commands::get_financial_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
