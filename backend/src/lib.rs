pub mod analytics_commands;
pub mod approval_commands;
pub mod approval_service;
pub mod auth;
pub mod branch_commands;
pub mod cashier_commands;
pub mod commands;
pub mod db;
pub mod id_generator;
pub mod inventory360_commands;
pub mod inventory_commands;
pub mod kitchen_commands;
pub mod ledger_commands;
pub mod management_commands;
#[cfg(test)]
mod menu_tenant_tests;
pub mod modifier_commands;
pub mod platform_commands;
pub mod print_commands;
pub mod rbac;
pub mod report_commands;
pub mod repositories;
pub mod reservation_commands;
pub mod services;
#[cfg(test)]
mod shift_security_tests;
#[cfg(test)]
mod staff360_tests;
pub mod user_credentials;
pub mod waiter_commands;

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
        let database_url =
            std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://kasam360.db".to_string());
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
            // Faz 13: Kroki çizim. `get_floor_plan` ile karıştırılmamalı —
            // o komut kart görünümünün işletim verisini verir, bunlar kroki
            // geometrisini okur ve yazar.
            commands::floor_plan_commands::get_floor_layout,
            commands::floor_plan_commands::save_floor_layout,
            commands::floor_plan_commands::create_floor_zone,
            commands::floor_plan_commands::delete_floor_zone,
            commands::floor_plan_commands::create_floor_object,
            commands::floor_plan_commands::delete_floor_object,
            commands::floor_plan_commands::apply_floor_template,
            commands::floor_plan_commands::list_floor_templates,
            reservation_commands::get_reservations,
            reservation_commands::get_reservation_day,
            reservation_commands::reserve_table,
            reservation_commands::cancel_reservation,
            reservation_commands::mark_reservation_no_show,
            reservation_commands::mark_reservation_arrived,
            commands::pos_get_categories,
            commands::pos_get_products,
            commands::submit_order,
            commands::get_order_items,
            commands::try_lock_table,
            commands::unlock_table,
            management_commands::category::get_management_categories,
            management_commands::category::create_category,
            management_commands::category::update_category,
            management_commands::category::delete_category,
            management_commands::product::get_management_products,
            management_commands::product::create_product,
            management_commands::product::update_product,
            management_commands::product::update_product_status,
            management_commands::product::delete_product,
            analytics_commands::get_analytics_dashboard_data,
            analytics_commands::metrics::get_analytics_metrics,
            analytics_commands::metrics::set_monthly_target,
            analytics_commands::metrics::set_competitor_price,
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
            // Faz 7: Hesap Defteri finansal hareketleri. Fiş, ayrı ekranın
            // konusu olmaktan çıkıp harekete bağlı bağlantıya dönüştü.
            commands::get_financial_movements,
            commands::get_active_order_id,
            // Faz 7: fiş dışı basımları keyfi JSON değil, veritabanından okunur.
            print_commands::print_z_report,
            print_commands::print_day_z_report,
            print_commands::print_cash_slip,
            print_commands::print_order_slip,
            print_commands::print_void_slip,
            inventory_commands::get_inventory,
            inventory_commands::adjust_stock,
            inventory_commands::get_low_stock_alerts,
            inventory_commands::create_inventory_item,
            branch_commands::get_branches,
            branch_commands::create_branch,
            branch_commands::update_branch,
            branch_commands::archive_branch,
            // Faz 3: anlık PIN onayı. Kuyruk komutları (`request_approval`,
            // `get_pending_approvals`, `process_approval`) kaldırıldı: onay
            // anında PIN ile alınır, kuyrukta bekletilmez.
            approval_commands::verify_manager_pin,
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
            management_commands::staff::get_staff,
            management_commands::staff::create_staff_member,
            management_commands::staff::delete_staff_member,
            // Faz 4: modifier yönetimi bağımsız sekmeden kalktı; komutlar
            // CategoryForm/ProductForm yüzeyinden çağrılıyor ve yaşamaya devam ediyor.
            modifier_commands::get_modifier_groups,
            modifier_commands::create_modifier_group,
            modifier_commands::add_modifier_option,
            modifier_commands::delete_modifier_group,
            modifier_commands::set_product_modifier_groups,
            modifier_commands::get_product_modifier_group_ids,
            // Faz 5: tek rapor merkezi. `get_daily_summary`, `get_receipts` ve
            // `get_shift_history` tenant'sız kaldığı için bu kapıdan geçemez.
            report_commands::get_sales_report,
            report_commands::get_shift_report,
            report_commands::get_receipts_report,
            report_commands::get_adjustments_report,
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
            ledger_commands::export_financial_report,
            ledger_commands::record_owner_personal,
            ledger_commands::get_net_balance,
            ledger_commands::get_budget_status,
            ledger_commands::get_recurring_expenses,
            ledger_commands::get_directory_statement,
            ledger_commands::print_payment_receipt,
            // Faz 11: Personel 360°. Maaş tutarı görmek yalnız OWNER'a açıktır;
            // kapılar `commands::staff_commands` içinde `rbac` ile uygulanır.
            commands::staff_commands::list_staff_profiles,
            commands::staff_commands::save_staff_profile,
            commands::staff_commands::get_upcoming_birthdays,
            commands::staff_commands::list_shift_plans,
            commands::staff_commands::add_shift_plan,
            commands::staff_commands::list_leave_requests,
            commands::staff_commands::request_leave,
            commands::staff_commands::decide_leave,
            commands::staff_commands::list_custody_records,
            commands::staff_commands::add_custody_record,
            commands::staff_commands::close_custody_record,
            commands::staff_commands::list_staff_incidents,
            commands::staff_commands::record_staff_incident,
            commands::staff_commands::get_payroll_rules,
            commands::staff_commands::set_payroll_rule,
            commands::staff_commands::run_payroll,
            commands::staff_commands::get_tip_pool_summary,
            commands::staff_commands::distribute_tip_pool,
            commands::staff_commands::get_staff_kpi,
            commands::staff_commands::get_suspicious_activity,
            // Faz 12: Envanter 360°. Reçete ve raf ömrü komutları kendi feature
            // bayrağı kapalıyken 404 döner; bayrak kontrolü komutun ilk adımıdır.
            // Yollar tanım alt modülüne göre yazılır: `#[tauri::command]` gizli
            // `__cmd__` modülünü üretir ve bu modül `pub use` ile taşınamaz.
            inventory360_commands::pricing_commands::get_effective_price,
            inventory360_commands::pricing_commands::set_product_86d_command,
            inventory360_commands::menu_availability_commands::set_product_active_window,
            inventory360_commands::pricing_commands::bulk_update_product_prices,
            inventory360_commands::menu_availability_commands::get_service_windows,
            inventory360_commands::menu_availability_commands::upsert_service_window_command,
            inventory360_commands::menu_availability_commands::set_menu_window_product,
            inventory360_commands::pricing_commands::create_price_list_command,
            inventory360_commands::pricing_commands::delete_price_list_command,
            inventory360_commands::pricing_commands::create_price_freeze_command,
            inventory360_commands::menu_availability_commands::get_pricing_rules,
            inventory360_commands::menu_availability_commands::upsert_pricing_rule_command,
            inventory360_commands::pricing_commands::list_price_lists,
            inventory360_commands::recipe_commands::list_inventory_recipes,
            inventory360_commands::recipe_commands::create_recipe_command,
            inventory360_commands::recipe_commands::deactivate_recipe_command,
            inventory360_commands::recipe_commands::get_recipe_cost,
            inventory360_commands::supplier_commands::get_inventory_suppliers,
            inventory360_commands::supplier_commands::upsert_supplier_command,
            inventory360_commands::supplier_commands::set_supplier_product_command,
            inventory360_commands::supplier_commands::compare_supplier_prices_command,
            inventory360_commands::supplier_commands::create_purchase_order_command,
            inventory360_commands::supplier_commands::receive_purchase_order_command,
            inventory360_commands::shelf_life_commands::get_expiry_report,
            inventory360_commands::shelf_life_commands::list_shelf_life_policies_command,
            inventory360_commands::shelf_life_commands::upsert_shelf_life_policy_command,
            inventory360_commands::shelf_life_commands::set_batch_expiry_date,
            inventory360_commands::waste_commands::record_waste_command,
            inventory360_commands::waste_commands::list_waste_records_command,
            inventory360_commands::waste_commands::open_stock_count_command,
            inventory360_commands::waste_commands::record_count_line_command,
            inventory360_commands::waste_commands::close_stock_count_command,
            inventory360_commands::waste_commands::get_stock_count_command,
            inventory360_commands::waste_commands::list_stock_counts_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
