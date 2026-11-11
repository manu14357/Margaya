//! The tray (menu bar) icon and, on macOS, the application menu, both in the
//! system's language from the `desktop.launcher` copy.

#[cfg(target_os = "macos")]
use tauri::menu::Submenu;
use tauri::menu::{IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

use crate::i18n::{t, tv};
use crate::state::{lock, AppState};
use crate::{diagnostics, updates, windows};

pub const TRAY_ID: &str = "margaya";
pub const QUICK_ADD_SHORTCUT: &str = "CommandOrControl+Shift+Space";

const OPEN: &str = "open";
const SERVERS: &str = "servers";
const QUICK_ADD: &str = "quick-add";
const QUIT: &str = "quit";
const UPDATE: &str = "install-update";
const CHECK_UPDATES: &str = "check-updates";
const RELOAD: &str = "reload";
const COPY_DIAGNOSTICS: &str = "copy-diagnostics";
const OPEN_LOGS: &str = "open-logs";
const SERVER_PREFIX: &str = "open-server:";

fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let state = app.state::<AppState>();
    let mut items: Vec<Box<dyn IsMenuItem<Wry>>> = vec![
        Box::new(MenuItem::with_id(
            app,
            OPEN,
            t("tray.open"),
            true,
            None::<&str>,
        )?),
        Box::new(MenuItem::with_id(
            app,
            SERVERS,
            t("tray.servers"),
            true,
            None::<&str>,
        )?),
        Box::new(PredefinedMenuItem::separator(app)?),
    ];
    for server in state.servers() {
        let label = tv("tray.openServer", &[("name", &server.label)]);
        items.push(Box::new(MenuItem::with_id(
            app,
            format!("{SERVER_PREFIX}{}", server.id),
            label,
            true,
            None::<&str>,
        )?));
    }
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(
        app,
        QUICK_ADD,
        t("tray.quickAdd"),
        true,
        Some(QUICK_ADD_SHORTCUT),
    )?));
    if let Some(version) = lock(&state.available_update).clone() {
        // A Linux .deb or .rpm can't replace itself: the item opens the
        // download page instead.
        let label = if updates::self_update_supported() {
            "tray.updateReady"
        } else {
            "tray.updateDownload"
        };
        items.push(Box::new(MenuItem::with_id(
            app,
            UPDATE,
            tv(label, &[("version", &version)]),
            true,
            None::<&str>,
        )?));
    }
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(
        app,
        QUIT,
        t("tray.quit"),
        true,
        None::<&str>,
    )?));
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|item| item.as_ref()).collect();
    Menu::with_items(app, &refs)
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Margaya")
        .menu(&tray_menu(app)?)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| handle_menu_event(app, &event))
        .on_tray_icon_event(|tray, event| {
            // A left click on Windows brings Margaya back (the last server
            // window, else the server list); the menu is on the right button.
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                if !cfg!(target_os = "macos") {
                    windows::spawn_ui(tray.app_handle(), windows::show_main);
                }
            }
        });
    // macOS: a black template image the menu bar tints. Elsewhere the
    // transparent green mark, from its 32 px render (the tray shows 16 to 24
    // px, which scale down from it cleanly).
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .icon(tauri::include_image!("icons/tray-template.png"))
            .icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.icon(tauri::include_image!("icons/32x32.png"));
    }
    builder.build(app)?;
    Ok(())
}

/// Rebuilds the tray menu after the server list or update state changes.
pub fn refresh_tray(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), tray_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

/// The macOS menu bar. Windows apps keep their menus in the tray instead.
#[cfg(target_os = "macos")]
pub fn create_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let app_menu = Submenu::with_items(
        app,
        "Margaya",
        true,
        &[
            &PredefinedMenuItem::about(app, Some(&t("menu.about")), None)?,
            &MenuItem::with_id(
                app,
                CHECK_UPDATES,
                t("menu.checkUpdates"),
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(&t("menu.hide")))?,
            &PredefinedMenuItem::hide_others(app, Some(&t("menu.hideOthers")))?,
            &PredefinedMenuItem::show_all(app, Some(&t("menu.showAll")))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, QUIT, t("menu.quit"), true, Some("CommandOrControl+Q"))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        t("menu.edit"),
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(&t("menu.undo")))?,
            &PredefinedMenuItem::redo(app, Some(&t("menu.redo")))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(&t("menu.cut")))?,
            &PredefinedMenuItem::copy(app, Some(&t("menu.copy")))?,
            &PredefinedMenuItem::paste(app, Some(&t("menu.paste")))?,
            &PredefinedMenuItem::select_all(app, Some(&t("menu.selectAll")))?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        t("menu.view"),
        true,
        &[
            &MenuItem::with_id(
                app,
                RELOAD,
                t("menu.reload"),
                true,
                Some("CommandOrControl+R"),
            )?,
            &MenuItem::with_id(app, SERVERS, t("menu.servers"), true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                QUICK_ADD,
                t("menu.quickAdd"),
                true,
                Some(QUICK_ADD_SHORTCUT),
            )?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        t("menu.window"),
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(&t("menu.minimize")))?,
            &PredefinedMenuItem::close_window(app, Some(&t("menu.closeWindow")))?,
        ],
    )?;
    let help = Submenu::with_items(
        app,
        t("menu.help"),
        true,
        &[
            &MenuItem::with_id(
                app,
                COPY_DIAGNOSTICS,
                t("menu.copyDiagnostics"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, OPEN_LOGS, t("menu.openLogs"), true, None::<&str>)?,
        ],
    )?;
    let menu = Menu::with_items(app, &[&app_menu, &edit, &view, &window, &help])?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| handle_menu_event(app, &event));
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn create_app_menu(_app: &AppHandle) -> tauri::Result<()> {
    Ok(())
}

pub fn handle_menu_event(app: &AppHandle, event: &MenuEvent) {
    let id = event.id().as_ref();
    match id {
        // Handlers run on the main thread; anything that may create a
        // window is handed off (see windows::spawn_ui).
        OPEN => windows::spawn_ui(app, windows::show_main),
        SERVERS => windows::show_launcher(app),
        QUICK_ADD => windows::spawn_ui(app, |app| {
            if let Err(error) = windows::show_quick_add(app, None) {
                log::warn!("quick add failed to open: {}", error.message);
            }
        }),
        QUIT => app.exit(0),
        UPDATE => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = updates::install(&app).await {
                    log::warn!("update failed: {}", error.message);
                }
            });
        }
        CHECK_UPDATES => {
            windows::show_launcher(app);
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = updates::check(&app).await;
            });
        }
        RELOAD => {
            if let Some(window) = app
                .webview_windows()
                .values()
                .find(|window| window.is_focused().unwrap_or(false))
            {
                let _ = window.eval("window.location.reload()");
            }
        }
        COPY_DIAGNOSTICS => {
            let _ = app.clipboard().write_text(diagnostics::collect(app));
            let _ = app.emit("diagnostics-copied", ());
        }
        OPEN_LOGS => {
            if let Ok(dir) = app.path().app_log_dir() {
                let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
            }
        }
        _ => {
            if let Some(server_id) = id.strip_prefix(SERVER_PREFIX) {
                if let Ok(server) = app.state::<AppState>().server(server_id) {
                    windows::spawn_ui(app, move |app| {
                        if let Err(error) =
                            windows::open_server_window(app, &server, windows::Target::None)
                        {
                            log::warn!("could not open a server window: {}", error.message);
                        }
                    });
                }
            }
        }
    }
}
