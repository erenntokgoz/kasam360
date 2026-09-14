#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]


fn main() {
    let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
    let pool = rt.block_on(async {
        let database_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "sqlite://kasam360.db".to_string());
        kasam360_core::db::init_db(&database_url)
            .await
            .expect("Failed to initialize database")
    });

    tauri::Builder::default()
        .manage(pool)
        .manage(kasam360_core::AppState {
            payment_mutex: tokio::sync::Mutex::new(()),
        })
        .invoke_handler(tauri::generate_handler![
            kasam360_core::commands::process_payment,
            kasam360_core::commands::process_split_payment,
            kasam360_core::commands::kds_update_ticket_status,
            kasam360_core::commands::get_active_tickets,
            kasam360_core::commands::open_shift,
            kasam360_core::commands::close_shift,
            kasam360_core::commands::get_active_shift,
            kasam360_core::commands::get_floor_plan,
            kasam360_core::commands::move_table,
            kasam360_core::commands::reserve_table,
            kasam360_core::commands::pos_get_categories,
            kasam360_core::commands::pos_get_products,
            kasam360_core::commands::submit_order,
            kasam360_core::commands::get_order_items,
            kasam360_core::management_commands::get_management_categories,
            kasam360_core::management_commands::create_category,
            kasam360_core::management_commands::update_category,
            kasam360_core::management_commands::delete_category,
            kasam360_core::management_commands::get_management_products,
            kasam360_core::management_commands::create_product,
            kasam360_core::management_commands::update_product,
            kasam360_core::management_commands::update_product_status,
            kasam360_core::management_commands::delete_product,
            kasam360_core::commands::auth_login,
            kasam360_core::commands::auth_login_credentials,
            kasam360_core::commands::add_table,
            kasam360_core::commands::remove_table,
            kasam360_core::commands::update_table_name,
            kasam360_core::commands::get_daily_summary,
            kasam360_core::commands::get_receipts,
            kasam360_core::commands::get_receipt_details,
            kasam360_core::commands::void_order,
            kasam360_core::commands::get_audit_logs,
            kasam360_core::commands::print_receipt,
            kasam360_core::analytics_commands::get_analytics_dashboard_data,
            kasam360_core::platform_commands::get_tenants,
            kasam360_core::platform_commands::get_plans,
            kasam360_core::platform_commands::create_plan,
            kasam360_core::platform_commands::update_plan,
            kasam360_core::platform_commands::delete_plan,
            kasam360_core::platform_commands::get_subscriptions,
            kasam360_core::platform_commands::create_tenant,
            kasam360_core::inventory_commands::get_inventory,
            kasam360_core::inventory_commands::adjust_stock,
            kasam360_core::inventory_commands::get_low_stock_alerts,
            kasam360_core::inventory_commands::create_inventory_item,
            kasam360_core::branch_commands::get_branches,
            kasam360_core::branch_commands::create_branch,
            kasam360_core::approval_commands::request_approval,
            kasam360_core::approval_commands::get_pending_approvals,
            kasam360_core::approval_commands::process_approval,
            kasam360_core::cashier_commands::cash_in,
            kasam360_core::cashier_commands::cash_out,
            kasam360_core::cashier_commands::get_shift_summary,
            kasam360_core::commands::get_shift_history,
            kasam360_core::commands::close_day,
            kasam360_core::commands::merge_tables,
            kasam360_core::commands::get_live_orders,
            kasam360_core::commands::get_open_shifts,
            kasam360_core::kitchen_commands::get_stations,
            kasam360_core::kitchen_commands::create_station,
            kasam360_core::kitchen_commands::update_kds_item_status,
            kasam360_core::waiter_commands::get_product_modifiers,
            kasam360_core::waiter_commands::update_table_status,
            kasam360_core::waiter_commands::waiter_clock_in,
            kasam360_core::waiter_commands::get_table_ready_status,
            kasam360_core::platform_commands::suspend_tenant,
            kasam360_core::platform_commands::activate_tenant,
            kasam360_core::platform_commands::update_tenant_subscription,
            kasam360_core::platform_commands::get_devices,
            kasam360_core::platform_commands::record_device_heartbeat,
            kasam360_core::platform_commands::register_device,
            kasam360_core::platform_commands::get_global_users,
            kasam360_core::platform_commands::get_platform_audit_logs,
            kasam360_core::management_commands::get_staff,
            kasam360_core::management_commands::create_staff_member,
            kasam360_core::management_commands::delete_staff_member,
            kasam360_core::management_commands::get_modifier_groups,
            kasam360_core::management_commands::create_modifier_group,
            kasam360_core::management_commands::add_modifier_option,
            kasam360_core::management_commands::delete_modifier_group,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
