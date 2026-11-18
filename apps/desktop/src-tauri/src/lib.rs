//! Margaya Desktop: a thin shell that loads each Margaya server's own web UI
//! in its own window, and adds what browsers can't (see apps/desktop/AGENTS.md).

mod acl;
mod api;
mod auth;
mod badge;
mod badge_view;
mod bridge;
mod capture;
mod commands;
mod diagnostics;
mod discovery;
mod download_progress;
mod downloads;
mod error;
mod files_scope;
mod files_window;
mod i18n;
mod jumplist;
mod launch;
mod menus;
mod notification_actions;
mod notify;
mod offline;
mod offline_cache;
mod opener;
mod pause;
mod prefs;
mod quick_add;
mod routing;
mod search_window;
mod servers;
mod shortcuts;
mod signin;
mod socket;
mod sound;
mod spellcheck;
mod state;
mod titlebar;
mod today_window;
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
#[cfg(not(windows))]
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_window_state::StateFlags;

use crate::servers::{ServerStore, WindowKind};
use crate::state::{lock, AppState};

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
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            // "Send to Margaya" files: quick add lists them to confirm.
            if quick_add::handle_send_to(app, &argv, std::path::Path::new(&cwd)) {
                return;
            }
            // A jump-list or .desktop action runs that action; any other
            // second launch brings back the window used last.
            if let Some(action) = launch::parse(&argv) {
                launch::run(app, action);
            } else if !launch::has_deep_link(&argv) {
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
        // Used from Rust only (the Files window's folder picker and "Save a
        // copy…"); no capability grants a page any `dialog:` command.
        .plugin(tauri_plugin_dialog::init())
        // Audio and video in the Files window, for that webview only.
        .register_asynchronous_uri_scheme_protocol(files_window::PROTOCOL, files_window::serve)
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // Whether such a start stays in the tray is a setting
            // (launch.rs, "Start minimized to the tray").
            Some(vec![launch::MINIMIZED_ARG]),
        ))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // The launcher and each server's main window keep their size
                // and place; quick add, extra windows and popups don't.
                .with_filter(|label| {
                    label == windows::LAUNCHER
                        || label == today_window::LABEL
                        || label == files_window::LABEL
                        || matches!(servers::parse_window_label(label), Some(WindowKind::Primary(_)))
                })
                // Visibility is the app's choice (the login item starts
                // hidden), and the frame belongs to the title-bar code.
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE - StateFlags::DECORATIONS)
                .build(),
        )
        .plugin(
            // The shortcuts themselves are registered in setup
            // (shortcuts.rs): another app may already hold one, and that
            // must not stop Margaya from starting.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(shortcuts::handle)
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
            commands::set_start_minimized,
            shortcuts::get_shortcuts,
            shortcuts::set_shortcut,
            shortcuts::reset_shortcut,
            shortcuts::pause_shortcuts,
            updates::set_update_channel,
            updates::whats_new_state,
            updates::dismiss_whats_new,
            updates::release_notes,
            commands::quick_add_targets,
            commands::quick_add_create,
            commands::quick_add_open,
            commands::close_quick_add,
            quick_add::quick_add_draft,
            quick_add::quick_add_remove_attachment,
            quick_add::quick_add_members,
            quick_add::quick_add_prefs,
            commands::bridge_message,
            search_window::search_query,
            search_window::search_recent,
            search_window::search_open,
            search_window::close_search,
            today_window::today_tasks,
            today_window::today_complete,
            today_window::today_open,
            today_window::close_today,
            offline::offline_state,
            offline::offline_retry,
            offline::show_servers,
            offline::offline_items,
            offline::offline_item,
            offline_cache::get_offline_reading,
            offline_cache::set_offline_reading,
            offline_cache::clear_offline_copies,
            spellcheck::get_spellcheck,
            spellcheck::set_spellcheck,
            pause::get_notification_pause,
            pause::set_notification_pause,
            files_window::show_files,
            files_window::files_overview,
            files_window::files_add_folder,
            files_window::files_remove_folder,
            files_window::files_list,
            files_window::files_read,
            files_window::files_stream_url,
            files_window::files_search,
            files_window::files_cancel_search,
            files_window::files_open,
            files_window::files_reveal,
            files_window::files_copy_path,
            files_window::files_save_copy,
            files_window::files_recent_add,
            files_window::files_recent_remove,
            files_window::files_start_drag,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            tokens::init(&app.config().identifier);
            let config_dir = app.path().app_config_dir()?;
            let store = ServerStore::load(config_dir.join("servers.json"));
            let version = app.package_info().version.to_string();
            app.manage(AppState::new(store, &version));
            app.manage(files_window::FilesState::load(&config_dir));
            log::info!("Margaya Desktop {version} starting");
            #[cfg(feature = "e2e")]
            log::warn!("test build: links are written to MARGAYA_E2E_OPEN_LOG, never opened");

            if let Some(launcher) = app.get_webview_window(windows::LAUNCHER) {
                let _ = launcher.set_background_color(Some(windows::background(&handle)));
            }

            // Screenshots and clipboard images an earlier run left behind
            // (a crash, or a quit with quick add open). Before any launch
            // action can take a new one; it is one small folder.
            quick_add::sweep_all_temp_files(&handle);

            prefs::init(&handle)?;
            shortcuts::init(&handle);
            jumplist::init(&handle);
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
            // Started by a click on a download's notification after the app
            // was quit: show the folder, and start in the tray like the
            // login item, so no window covers the file manager.
            let mut started_for_download = false;
            if let Ok(Some(links)) = app.deep_link().get_current() {
                started_for_download = auth::only_download_links(&links);
                signin::handle_deep_links(&handle, links);
            }
            // Started by "Send to Margaya": only quick add opens.
            let started_for_send_to = quick_add::handle_send_to(
                &handle,
                &std::env::args().collect::<Vec<_>>(),
                &std::env::current_dir().unwrap_or_default(),
            );

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
                } else if let (Some(button), Some(notification)) = (
                    notification_actions::Action::parse(action.action_id()),
                    action.notification(),
                ) {
                    notification_actions::on_plugin_action(&click_app, notification.id(), button);
                }
            });

            for server in app.state::<AppState>().servers() {
                acl::grant_bridge(&handle, &server);
                if tokens::get(&server.id).is_some() {
                    app.state::<AppState>().mark_signed_in(&server.id);
                    socket::start(&handle, &server.id);
                }
            }

            // Like a chat app: the server windows open last time come back;
            // the launcher shows only when there are none.
            // A jump-list or .desktop action shows only what it asked for;
            // the login item starts in the tray when the setting says so.
            let args: Vec<String> = std::env::args().collect();
            let launch_action = launch::parse(&args);
            let silent = launch::started_by_login(&args) && prefs::get(&handle).start_minimized;
            if let Some(action) = launch_action {
                launch::run(&handle, action);
            }
            updates::note_version(&handle);
            if !silent && !started_for_download && !started_for_send_to && launch_action.is_none() {
                windows::spawn_ui(&handle, |app| {
                    // After an update the launcher comes up too, with
                    // "What's new".
                    if !windows::open_startup_windows(app) || updates::whats_new_pending() {
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
                // Files and folders dropped on the Files window (server
                // windows have the drop handler off and never get here).
                WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. })
                    if window.label() == files_window::LABEL =>
                {
                    files_window::on_drop(app, paths.clone());
                }
                // Another monitor: redraw the taskbar badge at its scale.
                WindowEvent::ScaleFactorChanged { .. } => crate::badge_view::apply(app),
                WindowEvent::Destroyed => {
                    // Closing quick add drops its draft and temporary files.
                    if window.label() == windows::QUICK_ADD {
                        quick_add::discard();
                    }
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
        // Quitting: the draft's captures go with it.
        RunEvent::Exit => {
            quick_add::discard();
            quick_add::sweep_all_temp_files(app);
        }
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
