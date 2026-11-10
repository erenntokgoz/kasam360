#![allow(clippy::too_many_arguments)]

pub mod approval_service;
pub mod auth;
pub mod commands;
pub mod db;
pub mod domain;
pub mod id_generator;
pub mod log;
pub mod rbac;
pub mod repositories;
pub mod services;
#[cfg(test)]
mod tests;
pub mod user_credentials;

pub use commands::{
    analytics_commands, approval_commands, branch_commands, cashier_commands,
    inventory360_commands, inventory_commands, kitchen_commands, ledger_commands,
    legal360_commands, management_commands, modifier_commands, platform_commands, print_commands,
    report_commands, reservation_commands, waiter_commands,
};

use tauri::Manager;

pub use db::{init_db, DbPool};

/// Tauri tarafından yönetilen global uygulama durumu.
/// `payment_mutex` tahsilatı, `audit_mutex` denetim defteri yazımını ayrı ayrı serileştirir.
pub struct AppState {
    pub payment_mutex: tokio::sync::Mutex<()>,
    pub audit_mutex: std::sync::Arc<tokio::sync::Mutex<()>>,
    pub table_locks: tokio::sync::Mutex<std::collections::HashMap<String, (String, i64)>>,
    /// Yerel ağ eşitlemesi; finansal yazma kapısı buradan geçer.
    pub lan_sync: services::lan_sync::LanSync,
    /// Dosya tabanlı veritabanının yolu; yedek klasörü buradan türer.
    pub db_path: Option<std::path::PathBuf>,
    /// PIN ile açılmış personel oturumu; IPC kimlik kapısı buradan okur.
    pub staff_session: services::staff_session::StaffSessions,
}

fn authorize_invoke(invoke: &tauri::ipc::Invoke<tauri::Wry>) -> Result<(), String> {
    let webview = invoke.message.webview();
    let state = webview
        .try_state::<AppState>()
        .ok_or_else(|| "UNAUTHORIZED: uygulama durumu hazır değil".to_string())?;
    let session = state.staff_session.current()?;
    let body = match invoke.message.payload() {
        tauri::ipc::InvokeBody::Json(value) => Some(value),
        tauri::ipc::InvokeBody::Raw(_) => None,
    };
    services::staff_session::authorize(session.as_ref(), invoke.message.command(), body)
}

/// Komut öncesi kapı: eşitlenmeyen yazma cihazları ayrıştırır.
fn gated(
    handler: impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static,
) -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    move |invoke| {
        if let Err(reason) = authorize_invoke(&invoke) {
            invoke.resolver.reject(reason);
            return true;
        }
        let gate = invoke
            .message
            .webview()
            .try_state::<AppState>()
            .map(|state| state.lan_sync.gate_command(invoke.message.command()));
        if let Some(Err(reason)) = gate {
            invoke.resolver.reject(reason);
            return true;
        }
        handler(invoke)
    }
}

/// Veritabanı yeri. Çalışma klasörüne bağlı kalırsa kısayoldan açılan uygulama boş
/// veritabanı açar; var olan dosya korunur, yeni kurulum kullanıcı klasörüne yazılır.
fn resolve_database_url(app: &tauri::App) -> Result<String, Box<dyn std::error::Error>> {
    if let Ok(url) = std::env::var("DATABASE_URL") {
        return Ok(url);
    }
    if std::path::Path::new("kasam360.db").exists() {
        return Ok("sqlite://kasam360.db".to_string());
    }
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let path = dir
        .join("kasam360.db")
        .display()
        .to_string()
        .replace('\\', "/");
    Ok(format!("sqlite:///{}", path.trim_start_matches('/')))
}

#[cfg_attr(
    any(target_os = "android", target_os = "ios"),
    tauri::mobile_entry_point
)]
pub fn run() {
    // Yapılandırılmış günlükleme (tracing + rolling file).
    // Loglama asla uygulamayı durdurmaz; hata olursa konsola fallback.
    crate::log::init();
    // reqwest sağlayıcısız rustls ile derlenir; sağlayıcı kurulmadan istemci açılırsa
    // komut panikler ve arayüz cevapsız kalır. Zaten kuruluysa hata önemsizdir.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let builder = tauri::Builder::default();
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_opener::init());
    // Tek örnek eklentisi desktop işletim sistemlerini hedefler; mobilde süreç zaten OS tarafından yönetilir.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));
    let builder = builder.setup(|app| {
        tauri::async_runtime::block_on(async {
            let database_url = resolve_database_url(app)?;
            let db_path = services::backup::db_path_from_url(&database_url);
            // Veritabanı açılmadan önce: çalışan havuzun altındaki dosya değiştirilemez.
            let mut restore_error = None;
            if let Some(path) = &db_path {
                if let Err(error) = services::backup::restore::apply_pending_restore(path).await {
                    tracing::error!("geri dönüş uygulanamadı: {error}");
                    services::backup::restore::abandon_pending_restore(path);
                    restore_error = Some(format!("Geri dönüş uygulanamadı: {error}"));
                }
            }
            let pool = init_db(&database_url)
                .await
                .map_err(|e| Box::new(std::io::Error::other(e.to_string())))?;
            if let Some(error) = &restore_error {
                services::backup::schedule::write_result(&pool, Some(error), None)
                    .await
                    .map_err(std::io::Error::other)?;
            }
            if let Err(error) = services::backup::schedule::record_restore_audit(&pool).await {
                tracing::warn!("geri dönüş kaydı yazılamadı: {error}");
            }
            if let Some(path) = &db_path {
                services::backup::schedule::spawn_periodic(pool.clone(), path.clone());
            }

            // Eşitleme de aynı denetim kilidini kullanır: iki yol aynı zinciri yazar.
            let audit_mutex = std::sync::Arc::new(tokio::sync::Mutex::new(()));
            let lan_sync =
                services::lan_sync::LanSync::new(pool.clone(), audit_mutex.clone(), "0.0.0.0");
            // iOS/Android arka plan servisi veya LAN lideri olarak çalışmaz; yerel veritabanı ve bulut kuyruğu korunur.
            if !cfg!(any(target_os = "android", target_os = "ios")) {
                lan_sync.resume().await;
            }
            let cloud_sync =
                services::cloud_sync::CloudSync::new(pool.clone(), audit_mutex.clone());
            let handle = app.handle().clone();
            cloud_sync.set_publisher(Box::new(move |status| {
                let _ = tauri::Emitter::emit(
                    &handle,
                    commands::cloud_sync_commands::STATUS_EVENT,
                    status,
                );
            }));
            cloud_sync.start(commands::account_commands::SITE_URL);
            app.manage(cloud_sync);

            app.manage(pool);
            app.manage(AppState {
                payment_mutex: tokio::sync::Mutex::new(()),
                audit_mutex,
                table_locks: tokio::sync::Mutex::new(std::collections::HashMap::new()),
                lan_sync,
                db_path,
                staff_session: Default::default(),
            });

            Ok::<(), Box<dyn std::error::Error>>(())
        })
    });
    let builder = builder.invoke_handler(gated(tauri::generate_handler![
        commands::process_payment,
        commands::process_split_payment,
        commands::kds_update_ticket_status,
        commands::get_active_tickets,
        commands::floor_commands::plan::get_floor_plan,
        commands::floor_commands::table_ops::move_table,
        commands::floor_plan_commands::get_floor_layout,
        commands::floor_plan_commands::save_floor_layout,
        commands::floor_plan_commands::rename_floor_zone,
        commands::floor_plan_commands::create_floor_zone,
        commands::floor_plan_commands::delete_floor_zone,
        commands::floor_plan_commands::create_floor_object,
        commands::floor_plan_commands::delete_floor_object,
        commands::floor_plan_commands::apply_floor_template,
        commands::floor_plan_commands::list_floor_templates,
        reservation_commands::get_reservations,
        reservation_commands::get_reservation_day,
        reservation_commands::reserve_table,
        reservation_commands::update_reservation,
        reservation_commands::get_reservation_lead,
        reservation_commands::set_reservation_lead,
        reservation_commands::cancel_reservation,
        reservation_commands::mark_reservation_no_show,
        reservation_commands::mark_reservation_arrived,
        commands::pos_get_categories,
        commands::pos_get_products,
        commands::submit_order,
        commands::get_order_items,
        commands::floor_commands::lock::try_lock_table,
        commands::floor_commands::lock::unlock_table,
        management_commands::category::get_management_categories,
        management_commands::category::create_category,
        management_commands::category::update_category,
        management_commands::category::delete_category,
        management_commands::product::get_management_products,
        management_commands::product::create_product,
        management_commands::product::update_product,
        management_commands::product::update_product_status,
        management_commands::product_extras::get_menu_extras,
        management_commands::product_extras::set_product_extras,
        management_commands::product_extras::set_product_order,
        management_commands::product_extras::set_category_parent,
        management_commands::product::delete_product,
        analytics_commands::get_analytics_dashboard_data,
        analytics_commands::metrics::get_analytics_metrics,
        analytics_commands::metrics::get_monthly_targets,
        analytics_commands::metrics::set_monthly_target,
        analytics_commands::metrics::set_competitor_price,
        commands::auth_login,
        commands::get_pin_lengths,
        commands::auth_commands::unlock::auth_unlock,
        commands::backup_commands::get_backup_status,
        commands::backup_commands::list_backups,
        commands::backup_commands::create_backup_now,
        commands::backup_commands::set_backup_mirror,
        commands::backup_commands::restore_backup,
        commands::backup_commands::delete_backup,
        commands::backup_commands::restore_backup_on_setup,
        commands::sync_commands::take_over_device,
        commands::account_commands::get_device_session,
        commands::account_commands::open_site_page,
        commands::account_commands::account_sign_in,
        commands::account_commands::account_sign_in_link,
        commands::license_commands::get_license_status,
        commands::license_commands::refresh_license,
        commands::license_commands::link_license,
        commands::license_commands::link_license_with_google,
        commands::account_commands::account_create,
        commands::account_commands::account_sign_out,
        commands::account_commands::set_session_policy,
        commands::cloud_sync_commands::get_cloud_sync_status,
        commands::cloud_sync_commands::retry_cloud_sync,
        commands::cloud_sync_commands::cloud_sign_out,
        commands::cloud_sync_commands::cloud_restore,
        commands::cloud_sync_commands::list_cloud_tenants,
        commands::cloud_sync_commands::cloud_restore_tenant,
        commands::setup_commands::get_setup_status,
        commands::setup_commands::save_setup_draft,
        commands::setup_commands::complete_business_setup,
        commands::setup_commands::join_existing_business,
        commands::floor_commands::table_ops::add_table,
        commands::floor_commands::table_ops::remove_table,
        commands::floor_commands::table_ops::set_bill_requested,
        commands::floor_commands::zero_close::close_zero_balance_table,
        commands::floor_commands::table_ops::update_table_name,
        commands::floor_commands::transfer::transfer_order_item,
        commands::get_daily_summary,
        commands::get_receipts,
        commands::threshold_commands::get_approval_threshold,
        commands::threshold_commands::set_approval_threshold,
        commands::threshold_commands::reset_approval_threshold,
        commands::get_receipt_details,
        commands::void_commands::order_void::void_order,
        commands::void_commands::order_void::create_compensation_void,
        commands::void_commands::item_void::void_order_item,
        commands::void_commands::item_void::comp_order_item,
        commands::create_compensation_refund,
        commands::get_audit_logs,
        commands::print_receipt,
        commands::get_financial_movements,
        commands::get_active_order_id,
        commands::pos_commands::queries::get_order_balance,
        commands::payment_commands::split::get_payment_status,
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
        approval_commands::verify_manager_pin,
        approval_commands::set_staff_approval,
        cashier_commands::cash_in,
        cashier_commands::cash_out,
        cashier_commands::get_shift_summary,
        cashier_commands::get_cash_movements,
        commands::get_shift_history,
        commands::cashier_commands::z_report::get_z_report,
        commands::cashier_commands::z_report::explain_shift_difference,
        commands::close_day,
        commands::floor_commands::table_ops::merge_tables,
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
        // Cihaz komutları alt modülde (`platform_commands::devices`). `generate_handler!`
        // `__cmd__` makrolarını hedef modülün **kendi yolunda** arar; yalnız `pub use`
        // yeniden dışa aktarımı yetmez, bu yüzden tam yol yazılır (yasal modülde
        // `legal360_commands` için aynı zorunluluk vardı).
        platform_commands::devices::get_devices,
        platform_commands::devices::record_device_heartbeat,
        platform_commands::devices::register_device,
        // Master vault komutları ayrı modüldedir.
        platform_commands::master_vault_commands::master_vault_configure,
        platform_commands::master_vault_commands::master_vault_unlock,
        platform_commands::master_vault_commands::master_vault_status,
        platform_commands::get_global_users,
        platform_commands::get_platform_audit_logs,
        management_commands::staff::get_staff,
        management_commands::staff::reset_staff_pin,
        management_commands::staff::create_staff_member,
        management_commands::staff::delete_staff_member,
        management_commands::staff::update_staff_member,
        // Modifier yönetimi: komutlar
        // CategoryForm/ProductForm yüzeyinden çağrılıyor ve yaşamaya devam ediyor.
        modifier_commands::get_modifier_groups,
        modifier_commands::create_modifier_group,
        modifier_commands::add_modifier_option,
        modifier_commands::delete_modifier_group,
        modifier_commands::delete_modifier_option,
        modifier_commands::set_product_modifier_groups,
        modifier_commands::get_product_modifier_group_ids,
        // Tek rapor merkezi. `get_daily_summary`, `get_receipts` ve
        // `get_shift_history` tenant'sız kaldığı için bu kapıdan geçemez.
        report_commands::get_panorama,
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
        commands::change_self_pin,
        commands::auth_logout,
        commands::auth_lock,
        platform_commands::devices::toggle_device_status,
        platform_commands::devices::delete_device,
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
        ledger_commands::delete_directory,
        ledger_commands::find_similar_directories,
        ledger_commands::get_debts,
        ledger_commands::create_debt,
        ledger_commands::pay_debt,
        ledger_commands::update_debt,
        ledger_commands::delete_debt,
        ledger_commands::get_expenses,
        ledger_commands::create_expense,
        ledger_commands::void_expense,
        ledger_commands::record_staff_advance,
        commands::archive_commands::get_legacy_archive_status,
        commands::archive_commands::export_legacy_archive,
        commands::pos_gateway_commands::get_test_pos_mode,
        commands::pos_gateway_commands::set_test_pos_mode,
        commands::pos_gateway_commands::test_pos_charge,
        commands::pos_gateway_commands::test_pos_void,
        commands::pos_gateway_commands::get_pos_payment_log,
        ledger_commands::get_financial_report,
        ledger_commands::export_financial_report,
        ledger_commands::record_owner_personal,
        ledger_commands::get_net_balance,
        ledger_commands::get_budget_status,
        ledger_commands::get_recurring_expenses,
        ledger_commands::set_budget_limit,
        ledger_commands::delete_budget_limit,
        ledger_commands::save_recurring_expense,
        ledger_commands::update_recurring_expense,
        ledger_commands::deactivate_recurring_expense,
        ledger_commands::get_directory_statement,
        ledger_commands::get_statement_order,
        ledger_commands::print_payment_receipt,
        ledger_commands::operations::get_operation_result,
        commands::sync_commands::get_sync_status,
        commands::sync_commands::create_pairing_code,
        commands::sync_commands::set_device_passive,
        commands::sync_commands::list_sync_conflicts,
        commands::sync_commands::resolve_sync_conflict,
        ledger_commands::supplier_documents::get_awaiting_supplier_documents,
        ledger_commands::supplier_documents::approve_supplier_document,
        ledger_commands::supplier_documents::receive_purchase,
        // Personel 360°. Maaş tutarı görmek yalnız OWNER'a açıktır;
        // kapılar `commands::staff_commands` içinde `rbac` ile uygulanır.
        commands::staff_commands::list_staff_profiles,
        commands::staff_commands::save_staff_profile,
        commands::staff_commands::get_upcoming_birthdays,
        commands::staff_commands::list_shift_plans,
        commands::staff_commands::add_shift_plan,
        commands::leave_commands::list_leave_requests,
        commands::leave_commands::request_leave,
        commands::leave_commands::update_leave,
        commands::leave_commands::decide_leave,
        commands::staff_commands::list_custody_records,
        commands::staff_commands::add_custody_record,
        commands::staff_commands::close_custody_record,
        commands::staff_commands::list_staff_incidents,
        commands::staff_commands::record_staff_incident,
        commands::payroll_rule_commands::delete_payroll_rule,
        commands::staff_commands::get_payroll_rules,
        commands::payroll_rule_commands::set_payroll_rule,
        commands::staff_commands::run_payroll,
        commands::staff_commands::get_tip_pool_summary,
        commands::staff_commands::record_tip_entry,
        commands::staff_commands::tip_recipients::list_tip_recipients,
        commands::staff_commands::list_tip_entries,
        commands::staff_commands::delete_tip_entry,
        commands::staff_commands::update_shift_plan,
        commands::leave_commands::delete_leave,
        commands::staff_commands::delete_shift_plan,
        commands::order_change_commands::create_order_change_request,
        commands::order_change_commands::list_order_change_requests,
        commands::order_change_commands::decide_order_change_request,
        commands::order_change_commands::resolve_order_change_request,
        commands::staff_commands::distribute_tip_pool,
        commands::staff_commands::get_staff_kpi,
        commands::staff_commands::get_staff_money_summary,
        commands::payroll_commands::set_tip_multiplier,
        commands::payroll_commands::get_hourly_earnings,
        commands::payroll_commands::correct_staff_advance,
        commands::work_session_commands::save_staff_work_session,
        commands::work_session_commands::list_staff_work_sessions,
        commands::staff_settlement_commands::list_staff_settlements,
        commands::staff_settlement_commands::get_staff_debts,
        commands::staff_settlement_commands::pay_staff_settlement,
        commands::payroll_commands::pay_payroll_run,
        commands::staff_commands::get_suspicious_activity,
        // Envanter 360°. Reçete ve raf ömrü komutları kendi feature
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
        inventory360_commands::stock_commands::list_stock_batches_command,
        inventory360_commands::stock_commands::get_stock_trail,
        commands::station_commands::get_station_settings,
        commands::station_commands::save_station,
        commands::station_commands::delete_station,
        commands::station_commands::list_printers,
        inventory360_commands::tariff_commands::get_price_tariffs,
        inventory360_commands::tariff_commands::get_active_price_tariff,
        inventory360_commands::tariff_commands::save_price_tariff,
        inventory360_commands::tariff_commands::set_active_price_tariff,
        inventory360_commands::tariff_commands::delete_price_tariff,
        inventory360_commands::supplier_commands::get_inventory_suppliers,
        inventory360_commands::supplier_commands::upsert_supplier_command,
        inventory360_commands::supplier_commands::set_supplier_product_command,
        inventory360_commands::supplier_commands::compare_supplier_prices_command,
        inventory360_commands::supplier_commands::create_purchase_order_command,
        inventory360_commands::supplier_commands::receive_purchase_order_command,
        inventory360_commands::supplier_commands::list_purchase_orders_command,
        // Dış aktörler entegrasyonu (dosya tabanlı takas; yeni port yok).
        commands::external360_commands::qr_customer_session_open,
        commands::external360_commands::qr_customer_session_revoke,
        commands::external360_commands::qr_menu_build,
        commands::external360_commands::qr_menu_publish,
        commands::external360_commands::qr_menu_status,
        commands::external360_commands::qr_pending_requests,
        commands::external360_commands::qr_request_accept,
        commands::external360_commands::qr_request_reject,
        commands::external360_commands::qr_feedback_create,
        commands::external360_commands::supplier_request_create,
        commands::external360_commands::supplier_request_export,
        commands::external360_commands::supplier_request_queue,
        commands::external360_commands::accountant_report_build,
        commands::external360_commands::accountant_report_mark_sent,
        commands::external360_commands::service_ticket_create,
        commands::external360_commands::service_ticket_update_status,
        commands::external360_commands::service_tickets_open,
        commands::external360_commands::outbound_queues_flush,
        commands::external360_commands::outbound_queues_pending,
        inventory360_commands::waste_commands::record_waste_command,
        inventory360_commands::waste_commands::list_waste_records_command,
        // Kampanya ve Özel Günler. İzin listelerinde MASTER yoktur:
        // platform hesabı işletmenin vergi belgesine erişemez. Yazma yalnız OWNER'dır (prim, KDV ve indirim para
        // etkisidir); kupon uygulama komutu MANAGER'a açıktır çünkü
        // mevcut bir indirimi kasada geçirmek satış anı kararıdır.
        // Yollar alt modüle göre yazılır: `#[tauri::command]` gizli
        // `__cmd__` modülünü üretir ve bu modül `pub use` ile taşınamaz.
        legal360_commands::special_day_commands::list_special_days_command,
        legal360_commands::special_day_commands::list_upcoming_special_days_command,
        legal360_commands::special_day_commands::save_special_day_command,
        legal360_commands::campaign_commands::list_campaigns_command,
        legal360_commands::campaign_commands::list_campaign_templates_command,
        legal360_commands::campaign_commands::get_campaign_stats,
        legal360_commands::campaign_commands::save_campaign_command,
        legal360_commands::campaign_commands::apply_campaign_command,
        legal360_commands::e_invoice_commands::generate_e_invoice_command,
        legal360_commands::e_invoice_commands::get_e_invoice_command,
        legal360_commands::e_invoice_commands::list_e_invoices_command,
        legal360_commands::e_invoice_commands::mark_e_invoice_sent_command,
        legal360_commands::e_invoice_commands::mark_e_invoice_accepted_command,
        legal360_commands::e_invoice_commands::mark_e_invoice_rejected_command,
        legal360_commands::e_invoice_commands::cancel_e_invoice_command,
    ]));

    if let Err(err) = builder.run(tauri::generate_context!()) {
        tracing::error!("Tauri uygulaması çalıştırılamadı: {err}");
    }
}
