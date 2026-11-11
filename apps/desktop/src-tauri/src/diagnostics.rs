//! "Copy diagnostics": versions, platform, servers and the end of the local
//! log. Tokens never reach logs or this text.

use std::fs;

use tauri::{AppHandle, Manager};

use crate::state::{lock, AppState};
use crate::tokens;

const LOG_LINES: usize = 200;

pub fn collect(app: &AppHandle) -> String {
    let mut text = String::new();
    let info = app.package_info();
    text.push_str(&format!("Margaya Desktop {}\n", info.version));
    text.push_str(&format!("Tauri {}\n", tauri::VERSION));
    text.push_str(&format!(
        "OS: {} {}\n",
        std::env::consts::OS,
        std::env::consts::ARCH
    ));
    text.push_str(&format!(
        "Locale: {}\n",
        sys_locale::get_locale().unwrap_or_default()
    ));
    #[cfg(target_os = "linux")]
    text.push_str(&linux_session());

    if let Some(state) = app.try_state::<AppState>() {
        let sockets = lock(&state.sockets);
        text.push_str("\nServers:\n");
        for server in state.servers() {
            text.push_str(&format!(
                "- {} | web {} | api {} | server {} | signed in: {} | socket: {}\n",
                server.label,
                server.web_url,
                server.api_url,
                server.server_version.as_deref().unwrap_or("?"),
                tokens::get(&server.id).is_some(),
                sockets.contains_key(&server.id),
            ));
        }
    }

    if let Ok(dir) = app.path().app_log_dir() {
        let newest = fs::read_dir(&dir).ok().and_then(|entries| {
            entries
                .flatten()
                .filter(|entry| {
                    entry
                        .path()
                        .extension()
                        .is_some_and(|extension| extension == "log")
                })
                .max_by_key(|entry| entry.metadata().and_then(|meta| meta.modified()).ok())
        });
        if let Some(entry) = newest {
            if let Ok(log) = fs::read_to_string(entry.path()) {
                let lines: Vec<&str> = log.lines().collect();
                let start = lines.len().saturating_sub(LOG_LINES);
                text.push_str(&format!("\nLog ({}):\n", entry.path().display()));
                text.push_str(&lines[start..].join("\n"));
                text.push('\n');
            }
        }
    }
    text
}

/// The display server, desktop and package, which explain most Linux
/// window, tray and keychain reports.
#[cfg(target_os = "linux")]
fn linux_session() -> String {
    let env = |name: &str| std::env::var(name).unwrap_or_else(|_| "?".into());
    let package = match tauri::utils::platform::bundle_type() {
        Some(tauri::utils::config::BundleType::AppImage) => "AppImage",
        Some(tauri::utils::config::BundleType::Deb) => "deb",
        Some(tauri::utils::config::BundleType::Rpm) => "rpm",
        _ => "unbundled",
    };
    format!(
        "Session: {} ({}), package: {package}\n",
        env("XDG_SESSION_TYPE"),
        env("XDG_CURRENT_DESKTOP"),
    )
}
