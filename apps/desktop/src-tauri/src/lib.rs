//! Margaya Desktop: a thin shell that loads each Margaya server's own web UI
//! in its own window, and adds what browsers can't (see apps/desktop/AGENTS.md).

mod acl;
mod api;
mod auth;
mod badge;
mod badge_view;
mod bridge;
mod commands;
mod diagnostics;
mod discovery;
mod error;
mod i18n;
mod menus;
mod notify;
mod offline;
mod opener;
mod routing;
mod servers;
mod signin;
mod socket;
mod sound;
mod state;
mod titlebar;
mod tokens;
mod updates;
mod urls;
mod windows;

// The Windows resource (app manifest) for the unit-test binary; see build.rs.
#[cfg(all(test, margaya_test_resource))]
#[link(name = "resource", kind = "static", modifiers = "+whole-archive")]
unsafe extern "C" {}

use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
#[cfg(not(windows))]
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_window_state::StateFlags;

use crate::servers::{ServerStore, WindowKind};
use crate::state::{lock, AppState};

/// Passed by the login item, so the app starts in the tray.
const HIDDEN_ARG: &str = "--hidden";

pub fn run() {
    // A notification click or a link starts a second process with the
    // foreground right; it hands the link to the running app and exits, so
    // let that app take the foreground and bring its window up.
    #[cfg(windows)]
    unsafe {
        use ::windows::Win32::UI::WindowsAndMessaging::{AllowSetForegroundWindow, ASFW_ANY};
        let _ = AllowSetForegroundWindow(ASFW_ANY);
    }
    let app = tauri::Builder::default()
        // Must come first: on Windows a deep link starts a second process,
        // which hands its arguments (and the link) to this one and exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch brings back the window used last.
            if !argv.iter().any(|arg| arg.contains("://")) {
                windows::spawn_ui(app, windows::show_main);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: None,
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                .max_file_size(2_000_000)
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN_ARG]),
        ))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // The launcher and each server's main window keep their size
                // and place; quick add, extra windows and popups don't.
                .with_filter(|label| {
                    label == windows::LAUNCHER
                        || matches!(servers::parse_window_label(label), Some(WindowKind::Primary(_)))
                })
                // Visibility is the app's choice (the login item starts
                // hidden), and the frame belongs to the title-bar code.
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE - StateFlags::DECORATIONS)
                .build(),
        )
        .plugin(
            // The shortcut itself is registered in setup: another app may
            // already hold it, and that must not stop Margaya from starting.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        windows::spawn_ui(app, |app| {
                            if let Err(error) = windows::show_quick_add(app, None) {
                                log::warn!("quick add failed to open: {}", error.message);
                            }
                        });
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::list_servers,
            commands::discover_server,
            commands::add_server,
            commands::rename_server,
            commands::remove_server,
            commands::open_server,
            commands::start_sign_in,
            commands::submit_sign_in_code,
            commands::cancel_sign_in,
            commands::sign_out,
            commands::open_external,
            commands::take_launcher_prompt,
            commands::get_settings,
            commands::set_autostart,
            commands::copy_diagnostics,
            commands::check_for_update,
            commands::install_update,
            commands::quick_add_targets,
            commands::quick_add_create,
            commands::quick_add_open,
            commands::close_quick_add,
            commands::bridge_message,
            offline::offline_state,
            offline::offline_retry,
            offline::show_servers,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            tokens::init(&app.config().identifier);
            let config_dir = app.path().app_config_dir()?;
            let store = ServerStore::load(config_dir.join("servers.json"));
            let version = app.package_info().version.to_string();
            app.manage(AppState::new(store, &version));
            log::info!("Margaya Desktop {version} starting");
            #[cfg(feature = "e2e")]
            log::warn!("test build: links are written to MARGAYA_E2E_OPEN_LOG, never opened");

            if let Some(launcher) = app.get_webview_window(windows::LAUNCHER) {
                let _ = launcher.set_background_color(Some(windows::background(&handle)));
            }

            if let Err(error) = app.global_shortcut().register(menus::QUICK_ADD_SHORTCUT) {
                log::warn!("the quick-add shortcut is unavailable ({error}); use the tray instead");
            }
            menus::create_app_menu(&handle)?;
            menus::create_tray(&handle)?;

            // Installers register the schemes; a development build registers
            // itself so links reach `tauri dev`.
            #[cfg(all(debug_assertions, any(windows, target_os = "linux")))]
            if let Err(error) = app.deep_link().register_all() {
                log::warn!("deep link registration failed: {error}");
            }
            // The .deb and .rpm declare the schemes in their .desktop file.
            // An AppImage has no installer, so it registers itself at every
            // start (a handler in ~/.local/share/applications and xdg-mime),
            // which also follows the file when it was moved.
            #[cfg(all(not(debug_assertions), target_os = "linux"))]
            if app.env().appimage.is_some() {
                let register = handle.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    if let Err(error) = register.deep_link().register_all() {
                        log::warn!("deep link registration failed: {error}");
                    }
                });
            }
            let links_app = handle.clone();
            app.deep_link()
                .on_open_url(move |event| signin::handle_deep_links(&links_app, event.urls()));
            if let Ok(Some(links)) = app.deep_link().get_current() {
                signin::handle_deep_links(&handle, links);
            }

            // Windows toasts open a margaya://open link instead (notify.rs).
            // Elsewhere a click is the plugin's `tap` (on Linux the
            // notification's `default` action, over D-Bus).
            #[cfg(all(windows, any(debug_assertions, feature = "e2e")))]
            notify::register_app_id(&handle);
            #[cfg(not(windows))]
            let click_app = handle.clone();
            #[cfg(not(windows))]
            let _ = app.notification().on_action(move |action| {
                if action.action_id() == "tap" {
                    if let Some(notification) = action.notification() {
                        socket::on_notification_click(&click_app, notification.id());
                    }
                }
            });

            for server in app.state::<AppState>().servers() {
                acl::grant_bridge(&handle, &server);
                if tokens::get(&server.id).is_some() {
                    socket::start(&handle, &server.id);
                }
            }

            // Like a chat app: the server windows open last time come back;
            // the launcher shows only when there are none.
            if !std::env::args().any(|arg| arg == HIDDEN_ARG) {
                windows::spawn_ui(&handle, |app| {
                    if !windows::open_startup_windows(app) {
                        windows::show_launcher(app);
                    }
                });
            }
            updates::check_after_launch(&handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            let kind = servers::parse_window_label(window.label());
            match event {
                // Closing the server list or a server's main window hides
                // it; the app stays in the tray, and Quit exits.
                WindowEvent::CloseRequested { api, .. } => {
                    if window.label() == windows::LAUNCHER {
                        api.prevent_close();
                        let _ = window.hide();
                    } else if matches!(kind, Some(WindowKind::Primary(_))) {
                        api.prevent_close();
                        if let Some(window) = app.get_webview_window(window.label()) {
                            windows::close_server_window(app, &window);
                        }
                    }
                }
                WindowEvent::Focused(focused) => {
                    if let Some(server_window) = server_window(app, kind, window.label()) {
                        if *focused {
                            *lock(&app.state::<AppState>().last_focused) =
                                Some(window.label().to_string());
                        }
                        windows::report_chrome(app, &server_window, Some(*focused), false);
                    }
                }
                WindowEvent::Resized(_) => {
                    if let Some(server_window) = server_window(app, kind, window.label()) {
                        windows::report_chrome(app, &server_window, None, false);
                    }
                }
                // Another monitor: redraw the taskbar badge at its scale.
                WindowEvent::ScaleFactorChanged { .. } => crate::badge_view::apply(app),
                WindowEvent::Destroyed => {
                    if kind.is_some() {
                        let state = app.state::<AppState>();
                        lock(&state.windows).remove(window.label());
                        let mut last = lock(&state.last_focused);
                        if last.as_deref() == Some(window.label()) {
                            *last = None;
                        }
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Margaya Desktop");

    app.run(|app, event| match event {
        // Keep running in the tray when the last window closes; Quit exits.
        RunEvent::ExitRequested {
            code: None, api, ..
        } => api.prevent_exit(),
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => windows::spawn_ui(app, windows::show_main),
        _ => {
            let _ = app;
        }
    });
}

/// A server's own window (main or additional) by label, for window-state
/// events; popups and the app's own windows are left alone.
fn server_window(
    app: &tauri::AppHandle,
    kind: Option<WindowKind<'_>>,
    label: &str,
) -> Option<tauri::WebviewWindow> {
    match kind? {
        WindowKind::Primary(_) | WindowKind::Secondary(..) => app.get_webview_window(label),
        WindowKind::Popup(..) => None,
    }
}
