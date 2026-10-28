pub mod commands;
pub mod crdt;
pub mod db;
pub mod error;
pub mod hlc;
pub mod sync;

use crate::db::AppState;
use std::path::PathBuf;
use tauri::Manager;

fn parse_env_file_for_key(env_path: &std::path::Path, target_key: &str) -> Option<String> {
    let content = std::fs::read_to_string(env_path).ok()?;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            if k.trim() == target_key {
                let val = v.trim().trim_matches('"').trim_matches('\'').to_string();
                if !val.is_empty() {
                    return Some(val);
                }
            }
        }
    }
    None
}

fn resolve_project_root() -> PathBuf {
    if let Ok(cwd) = std::env::current_dir() {
        if cwd.file_name().and_then(|n| n.to_str()) == Some("src-tauri") {
            if let Some(parent) = cwd.parent() {
                return parent.to_path_buf();
            }
        }
        return cwd;
    }
    PathBuf::from(".")
}

fn resolve_app_data_dir(app: &tauri::App) -> PathBuf {
    let project_root = resolve_project_root();

    // 1. Explicit DMM_DATA_DIR environment variable
    let mut configured_dir = std::env::var("DMM_DATA_DIR")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // 2. Check ENV_FILE (e.g. .env.peer2 from scripts/dev-peer2.ps1) or default .env.peer1 / .env
    if configured_dir.is_none() {
        let env_file_candidates: Vec<PathBuf> =
            if let Ok(custom_env) = std::env::var("ENV_FILE") {
                let p = PathBuf::from(custom_env.trim());
                if p.is_absolute() {
                    vec![p]
                } else {
                    vec![project_root.join(&p), p]
                }
            } else {
                vec![
                    project_root.join(".env.peer1"),
                    project_root.join(".env"),
                ]
            };

        for candidate in env_file_candidates {
            if candidate.exists() {
                if let Some(val) = parse_env_file_for_key(&candidate, "DMM_DATA_DIR") {
                    configured_dir = Some(val);
                }
                if std::env::var("DMM_P2P_PORT").is_err() {
                    if let Some(port_val) = parse_env_file_for_key(&candidate, "DMM_P2P_PORT") {
                        std::env::set_var("DMM_P2P_PORT", port_val);
                    }
                }
                if configured_dir.is_some() {
                    break;
                }
            }
        }
    }

    if let Some(raw_dir) = configured_dir {
        let path = PathBuf::from(&raw_dir);
        if path.is_absolute() {
            return path;
        }
        return project_root.join(path);
    }

    app.path()
        .app_data_dir()
        .expect("failed to resolve OS app_data_dir")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = resolve_app_data_dir(app);
            let state =
                AppState::new(app_data_dir).expect("failed to initialize AppState and registry");
            let sync_engine = std::sync::Arc::clone(&state.sync);
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                sync_engine.set_app_handle(app_handle).await;
            });
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_books,
            commands::create_book,
            commands::rename_book,
            commands::delete_book,
            commands::open_book,
            commands::close_book,
            commands::export_book_encrypted,
            commands::list_accounts,
            commands::upsert_account,
            commands::delete_account,
            commands::merge_accounts,
            commands::list_categories,
            commands::upsert_category,
            commands::delete_category,
            commands::add_transaction,
            commands::update_transaction,
            commands::delete_transaction,
            commands::list_transactions,
            commands::transfer_between_books,
            commands::get_account_balances,
            commands::get_cash_flow_summary,
            commands::list_budgets,
            commands::upsert_budget,
            commands::delete_budget,
            commands::get_budget_progress,
            commands::get_monthly_report,
            commands::get_sync_status,
            commands::create_invite,
            commands::join_book_from_invite,
            commands::list_peers,
            commands::set_app_foreground,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Decentralize Money Manager application");
}
