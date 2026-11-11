//! Windows: the launcher, the quick-add window, and the server windows that
//! load a server's own web UI in that server's own data store. Each server
//! has a main window (`server-<id>`, hidden rather than closed) and may have
//! additional ones (`server-<id>-<n>`) and sign-in popups (`popup-<id>-<n>`).

use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::webview::{Color, DownloadEvent, NewWindowFeatures, NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};
use tauri_plugin_notification::NotificationExt;
use url::Url;

use crate::error::{AppError, AppResult};
use crate::routing::{self, ChromeState, Navigation, NewWindow, PopupNavigation};
use crate::servers::{self, Server, WindowKind};
use crate::state::{lock, AppState};
use crate::{bridge, i18n, offline, opener, urls};

pub const LAUNCHER: &str = "main";
pub const QUICK_ADD: &str = "quick-add";

/// A window that waits for its page shows anyway after this long.
const REVEAL_TIMEOUT: Duration = Duration::from_secs(5);
/// How long a finished page has to say it draws the title bar before the
/// window gets its native frame back.
const TITLE_BAR_GRACE: Duration = Duration::from_millis(1500);
/// Lets the other handlers of the same load event run first (a failed load
/// turns into the offline page instead of being shown).
const SETTLE: Duration = Duration::from_millis(80);

/// The smallest a server window gets (logical px): the web UI is responsive
/// down to a phone-width 360.
pub const SERVER_MIN_WIDTH: f64 = 360.0;
pub const SERVER_MIN_HEIGHT: f64 = 480.0;

/// A window or work-area rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Fits a window inside a monitor's work area: no larger than the area (but
/// never below the minimum size), and moved so it sits fully inside it. A
/// saved size or place from a larger or since-removed monitor can't leave the
/// window off screen, under the taskbar or bigger than the screen.
pub fn fit_to_work_area(window: Rect, area: Rect, min: (u32, u32)) -> Rect {
    let fit = |size: u32, room: u32, least: u32| size.min(room).max(least);
    let width = fit(window.width, area.width, min.0);
    let height = fit(window.height, area.height, min.1);
    let place = |pos: i32, size: u32, start: i32, room: u32| {
        let last = start.saturating_add(room.saturating_sub(size) as i32);
        pos.clamp(start, last.max(start))
    };
    Rect {
        x: place(window.x, width, area.x, area.width),
        y: place(window.y, height, area.y, area.height),
        width,
        height,
    }
}

/// Applies [`fit_to_work_area`] to a window after its saved state was restored.
fn fit_on_screen(window: &WebviewWindow) {
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return;
    }
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let (Some(monitor), Ok(position), Ok(outer), Ok(inner)) = (
        monitor,
        window.outer_position(),
        window.outer_size(),
        window.inner_size(),
    ) else {
        return;
    };
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    // The frame around the page counts towards what must fit.
    let frame = (
        outer.width.saturating_sub(inner.width),
        outer.height.saturating_sub(inner.height),
    );
    let min = (
        (SERVER_MIN_WIDTH * scale).round() as u32 + frame.0,
        (SERVER_MIN_HEIGHT * scale).round() as u32 + frame.1,
    );
    let current = Rect {
        x: position.x,
        y: position.y,
        width: outer.width,
        height: outer.height,
    };
    let fitted = fit_to_work_area(
        current,
        Rect {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        },
        min,
    );
    if fitted == current {
        return;
    }
    log::info!("moved a restored window back inside the screen");
    if (fitted.width, fitted.height) != (current.width, current.height) {
        let _ = window.set_size(tauri::PhysicalSize::new(
            fitted.width.saturating_sub(frame.0),
            fitted.height.saturating_sub(frame.1),
        ));
    }
    let _ = window.set_position(tauri::PhysicalPosition::new(fitted.x, fitted.y));
}

/// Runs `job` off the calling thread. Creating a window from a handler on the
/// main thread (tray, shortcut, deep link, a webview callback) can deadlock on
/// Windows, so those handlers hand the work over.
pub fn spawn_ui(app: &AppHandle, job: impl FnOnce(&AppHandle) + Send + 'static) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || job(&app));
}

/// Where a server window goes when it opens or is already open.
#[derive(Debug, Clone)]
pub enum Target {
    /// Just show the window.
    None,
    /// A page in the web app: an in-app route change when the window is
    /// already open (`margaya:navigate`), so nothing reloads.
    InApp(Url),
    /// A full page load (sign-in completion).
    Load(Url),
}

impl Target {
    fn url(&self) -> Option<&Url> {
        match self {
            Self::None => None,
            Self::InApp(url) | Self::Load(url) => Some(url),
        }
    }
}

pub fn show_launcher(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LAUNCHER) {
        show_window(&window);
    }
}

fn show_window(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// The window background before a page paints: the web app's own light or
/// dark background, by the system theme.
pub fn background(app: &AppHandle) -> Color {
    let dark = app
        .get_webview_window(LAUNCHER)
        .and_then(|window| window.theme().ok())
        .is_some_and(|theme| theme == Theme::Dark);
    let (r, g, b) = routing::background_rgb(dark);
    Color(r, g, b, 255)
}

/// Brings Margaya to the front the way a chat app does: the server window
/// used last, else the windows that open at startup, else the launcher.
/// Creates windows, so call it through [`spawn_ui`] from main-thread handlers.
pub fn show_main(app: &AppHandle) {
    let state = app.state::<AppState>();
    let last = lock(&state.last_focused).clone();
    let existing = last
        .and_then(|label| app.get_webview_window(&label))
        .or_else(|| {
            app.webview_windows()
                .into_iter()
                .find(|(label, _)| matches!(servers::parse_window_label(label), Some(WindowKind::Primary(_))))
                .map(|(_, window)| window)
        });
    if let Some(window) = existing {
        if let Some(kind) = servers::parse_window_label(window.label()) {
            if let WindowKind::Primary(id) = kind {
                let _ = lock(&state.store).set_reopen(id, true);
            }
        }
        show_window(&window);
        return;
    }
    if !open_startup_windows(app) {
        show_launcher(app);
    }
}

/// Opens the server windows chosen by [`servers::startup_servers`]; false
/// when there are none.
pub fn open_startup_windows(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let all = state.servers();
    let ids = servers::startup_servers(&all, |id| crate::tokens::get(id).is_some());
    let mut opened = false;
    for id in ids {
        if let Some(server) = all.iter().find(|server| server.id == id) {
            match open_server_window(app, server, Target::None) {
                Ok(()) => opened = true,
                Err(error) => log::warn!("could not reopen a server window: {}", error.message),
            }
        }
    }
    opened
}

pub fn show_quick_add(app: &AppHandle, server_id: Option<&str>) -> AppResult<()> {
    let hash = match server_id {
        Some(id) => format!("quick-add={id}"),
        None => "quick-add".to_string(),
    };
    if let Some(window) = app.get_webview_window(QUICK_ADD) {
        if server_id.is_some() {
            let hash = serde_json::to_string(&hash).unwrap_or_default();
            let _ = window.eval(format!(
                "window.location.hash = {hash}; window.location.reload();"
            ));
        }
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(
        app,
        QUICK_ADD,
        WebviewUrl::App(format!("index.html#{hash}").into()),
    )
    .title(i18n::t("quickAdd.title"))
    .inner_size(520.0, 300.0)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .background_color(background(app))
    .center()
    .focused(true)
    .build()?;
    let _ = window.set_focus();
    Ok(())
}

/// Opens (or shows) a server's main window, optionally at a URL on that
/// server. Creates a window, so never call it on the main thread.
pub fn open_server_window(app: &AppHandle, server: &Server, target: Target) -> AppResult<()> {
    let web = server
        .web()
        .ok_or_else(|| AppError::internal("invalid server URL"))?;
    if let Some(state) = app.try_state::<AppState>() {
        let mut store = lock(&state.store);
        let _ = store.touch(&server.id);
        let _ = store.set_reopen(&server.id, true);
    }

    // One opener at a time: a link that starts the app (a notification click
    // after quitting) and the startup windows open the same window at once,
    // and the second must find the first one's window, not fail. Every caller
    // runs off the main thread, so waiting here can't block window creation.
    let state = app.state::<AppState>();
    let _opening = lock(&state.opening_windows);
    let label = server.window_label();
    if let Some(window) = app.get_webview_window(&label) {
        match target {
            Target::InApp(url) if server.owns(&url) => navigate_in_app(app, &window, server, &url),
            Target::Load(url) if server.owns(&url) => {
                window.navigate(url)?;
            }
            _ => {}
        }
        show_window(&window);
        return Ok(());
    }

    let url = target
        .url()
        .filter(|url| server.owns(url))
        .cloned()
        .unwrap_or(web);
    build_server_window(app, server, &label, url)?;
    Ok(())
}

/// Another window on the same server and profile, for a link the web app
/// asked to open in a new window. The window that asked stays where it was.
pub fn open_additional_window(app: &AppHandle, server: &Server, url: Url) -> AppResult<()> {
    let state = app.state::<AppState>();
    let label = format!("{}-{}", server.window_label(), state.next_window_number());
    build_server_window(app, server, &label, url)?;
    Ok(())
}

/// Moves an open server page to `url` without reloading the web app when the
/// page listens for `margaya:navigate`; otherwise a normal load.
pub fn navigate_in_app(app: &AppHandle, window: &WebviewWindow, server: &Server, url: &Url) {
    let state = app.state::<AppState>();
    let on_web_ui = window
        .url()
        .ok()
        .is_some_and(|current| routing::is_web_page(server, &current));
    if !on_web_ui || !routing::is_web_page(server, url) {
        if let Err(error) = window.navigate(url.clone()) {
            log::warn!("could not navigate a server window: {error}");
        }
        return;
    }
    let listening = state.window_info(window.label()).navigate_ready;
    let script = routing::navigate_script(url, state.next_navigation_id(), listening);
    if let Err(error) = window.eval(script) {
        log::warn!("could not navigate a server window: {error}");
    }
}

fn build_server_window(
    app: &AppHandle,
    server: &Server,
    label: &str,
    url: Url,
) -> AppResult<WebviewWindow> {
    let web = server
        .web()
        .ok_or_else(|| AppError::internal("invalid server URL"))?;
    let state = app.state::<AppState>();
    state.with_window(label, |info| {
        *info = Default::default();
        info.pending_reveal = true;
    });
    let version = app.package_info().version.to_string();

    let nav = (app.clone(), server.clone(), label.to_string());
    let popup = (app.clone(), server.clone(), label.to_string());
    let load = (app.clone(), server.clone());
    let fallback_title = server.label.clone();
    let download_app = app.clone();

    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .title(&server.label)
        .inner_size(1280.0, 820.0)
        .min_inner_size(SERVER_MIN_WIDTH, SERVER_MIN_HEIGHT)
        // Shown once the first page has loaded, so it never flashes white.
        .visible(false)
        .background_color(background(app))
        .zoom_hotkeys_enabled(true)
        // HTML5 drag and drop (board cards, file drops) needs the page to get
        // the events, not Tauri's own file-drop handler.
        .disable_drag_drop_handler()
        .enable_clipboard_access()
        .initialization_script(bridge::init_script(&web, &version))
        .on_navigation(move |url| {
            let (app, server, label) = &nav;
            let state = app.state::<AppState>();
            let offline_page = state.window_info(label).offline.map(|offline| offline.page);
            let announced = !server.owns(url) && take_announced(&state, server, url);
            match routing::server_navigation(server, url, offline_page.as_ref(), announced) {
                Navigation::Allow => true,
                Navigation::Popup => {
                    let (server, opener_label, url) = (server.clone(), label.clone(), url.clone());
                    spawn_ui(app, move |app| {
                        if let Err(error) = build_popup(app, &server, &opener_label, &url, None) {
                            log::warn!("could not open a sign-in popup: {error}");
                        }
                    });
                    false
                }
                Navigation::Outside => {
                    opener::open_outside(app, &server.id, url);
                    false
                }
                Navigation::Deny => {
                    log::warn!("refused a navigation to a {} address", url.scheme());
                    false
                }
            }
        })
        .on_new_window(move |url, features| {
            let (app, server, opener_label) = &popup;
            route_new_window(app, server, opener_label, url, features)
        })
        .on_page_load(move |window, payload| {
            let (app, server) = &load;
            let url = payload.url().clone();
            match payload.event() {
                PageLoadEvent::Started => load_started(app, server, &window, url),
                PageLoadEvent::Finished => load_finished(app, server, &window, url),
            }
        })
        .on_document_title_changed(move |window, title| {
            let title = title.trim();
            let _ = window.set_title(if title.is_empty() { &fallback_title } else { title });
        })
        .on_download(move |webview, event| handle_download(&download_app, webview.label(), event));

    #[cfg(windows)]
    {
        // The web app draws the title bar and window controls.
        builder = builder.decorations(false).shadow(true);
    }
    // The same on Linux, on Wayland and X11: moving goes through
    // `start_dragging` (the bridge), and Tauri gives undecorated windows
    // 5 px resize borders. GTK draws no shadow for an undecorated window.
    #[cfg(target_os = "linux")]
    {
        builder = builder.decorations(false);
    }
    #[cfg(target_os = "macos")]
    {
        let (x, y) = crate::titlebar::traffic_lights_position();
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(x, y));
    }

    // Each server keeps its own cookies and storage, keyed by its UUID.
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.data_directory(profile_dir(app, &server.id)?);
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(identifier) = server.store_identifier() {
            builder = builder.data_store_identifier(identifier);
        }
    }

    let window = builder.build()?;
    // The saved size and place were restored during build; keep them on screen.
    fit_on_screen(&window);
    #[cfg(windows)]
    offline::watch_load_failures(app, &window, server);

    let timeout_app = app.clone();
    let timeout_label = label.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(REVEAL_TIMEOUT).await;
        let state = timeout_app.state::<AppState>();
        let info = state.window_info(&timeout_label);
        if info.pending_reveal && !info.download_only && info.offline.is_none() {
            if let Some(window) = timeout_app.get_webview_window(&timeout_label) {
                log::info!("showing a server window before its page finished loading");
                set_chrome(&window, info.web_title_bar);
                reveal(&timeout_app, &window);
            }
        }
    });
    crate::badge_view::apply(app);
    Ok(window)
}

fn route_new_window(
    app: &AppHandle,
    server: &Server,
    opener_label: &str,
    url: Url,
    features: NewWindowFeatures,
) -> NewWindowResponse<Wry> {
    let announced = !server.owns(&url) && take_announced(&app.state::<AppState>(), server, &url);
    match routing::new_window(server, &url, announced) {
        NewWindow::ServerWindow => {
            let server = server.clone();
            spawn_ui(app, move |app| {
                if let Err(error) = open_additional_window(app, &server, url) {
                    log::warn!("could not open another window: {}", error.message);
                }
            });
            NewWindowResponse::Deny
        }
        // Built here, on this thread, because WebView2 and WebKit hand the
        // popup to the page (window.opener) only through this response.
        NewWindow::Popup => match build_popup(app, server, opener_label, &url, Some(features)) {
            Ok(window) => NewWindowResponse::Create { window },
            Err(error) => {
                log::warn!("could not open a sign-in popup: {error}");
                NewWindowResponse::Deny
            }
        },
        NewWindow::Outside => {
            opener::open_outside(app, &server.id, &url);
            NewWindowResponse::Deny
        }
        NewWindow::Deny => NewWindowResponse::Deny,
    }
}

fn take_announced(state: &AppState, server: &Server, url: &Url) -> bool {
    lock(&state.announced_popups).take(&server.id, url, std::time::Instant::now())
}

/// How long an announced sign-in request waits for the page's own
/// `location.href` or `window.open` before the app opens the popup itself.
const ANNOUNCE_GRACE: Duration = Duration::from_millis(300);

/// `openSignInPopup(url)` from a server page, already checked by the caller
/// ([`routing::is_oauth_request`]). The URL is remembered for a few seconds:
/// when the page then navigates to it or `window.open`s it, that request
/// becomes the popup; when it doesn't, the app opens the popup itself. Either
/// way exactly one popup opens per announcement.
pub fn announce_sign_in_popup(app: &AppHandle, server: &Server, opener_label: &str, url: Url) {
    let state = app.state::<AppState>();
    lock(&state.announced_popups).announce(&server.id, &url, std::time::Instant::now());
    log::info!("sign-in popup announced for {}", opener::describe(&url));
    let (app, server, opener_label) = (app.clone(), server.clone(), opener_label.to_string());
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(ANNOUNCE_GRACE).await;
        if take_announced(&app.state::<AppState>(), &server, &url) {
            spawn_ui(&app, move |app| {
                if let Err(error) = build_popup(app, &server, &opener_label, &url, None) {
                    log::warn!("could not open a sign-in popup: {error}");
                }
            });
        }
    });
}

/// Closes a server's sign-in popups (sign-out, server removal).
pub fn close_popups(app: &AppHandle, server_id: &str) {
    for (label, window) in app.webview_windows() {
        if matches!(servers::parse_window_label(&label), Some(WindowKind::Popup(id, _)) if id == server_id)
        {
            let _ = window.close();
        }
    }
}

/// An in-app popup for account linking with an identity provider. It shares
/// the server's profile (the provider's callback needs this server's
/// cookies), gets no bridge and no commands, and closes itself once the flow
/// lands back on the server's web UI, which then shows in the window that
/// opened it.
///
/// With `features` it answers a `window.open` (built on the calling thread,
/// handed to the page through `NewWindowResponse::Create`); without, it runs
/// a top-level navigation the server window refused (`location.href` to the
/// provider) and must be built off the main thread.
fn build_popup(
    app: &AppHandle,
    server: &Server,
    opener_label: &str,
    url: &Url,
    features: Option<NewWindowFeatures>,
) -> tauri::Result<WebviewWindow> {
    let state = app.state::<AppState>();
    let label = format!(
        "{}{}-{}",
        servers::POPUP_PREFIX,
        server.id,
        state.next_window_number()
    );
    let nav = (
        app.clone(),
        server.clone(),
        label.clone(),
        opener_label.to_string(),
    );
    let new_window_app = app.clone();
    let scope = server.id.clone();
    log::info!("opening a sign-in popup for {}", opener::describe(url));
    // A window.open popup starts blank and WebView2/WebKit load the request
    // into it; a standalone one loads the provider page itself.
    let start = if features.is_some() {
        "about:blank".parse().expect("about:blank")
    } else {
        url.clone()
    };
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(start));
    match features {
        Some(features) => builder = builder.window_features(features),
        None => {
            builder = builder.inner_size(520.0, 720.0).center();
            #[cfg(not(target_os = "macos"))]
            if let Ok(dir) = profile_dir(app, &server.id) {
                builder = builder.data_directory(dir);
            }
            #[cfg(target_os = "macos")]
            if let Some(identifier) = server.store_identifier() {
                builder = builder.data_store_identifier(identifier);
            }
        }
    }
    builder
    // "<site> — <server>", from the address only, never the page's own title.
    .title(routing::popup_title(url, &server.label))
    .min_inner_size(360.0, 420.0)
    .background_color(background(app))
    .zoom_hotkeys_enabled(true)
    .focused(true)
    .on_navigation(move |url| {
        let (app, server, label, opener_label) = &nav;
        match routing::popup_navigation(server, url) {
            PopupNavigation::Allow => {
                if let Some(popup) = app.get_webview_window(label) {
                    let _ = popup.set_title(&routing::popup_title(url, &server.label));
                }
                true
            }
            PopupNavigation::Finish => {
                let (server, label, opener_label, url) =
                    (server.clone(), label.clone(), opener_label.clone(), url.clone());
                spawn_ui(app, move |app| finish_popup(app, &server, &label, &opener_label, url));
                false
            }
            PopupNavigation::Outside => {
                opener::open_outside(app, &server.id, url);
                false
            }
            PopupNavigation::Deny => false,
        }
    })
    .on_new_window(move |url, _features| {
        opener::open_outside(&new_window_app, &scope, &url);
        NewWindowResponse::Deny
    })
    .on_download(|_, _| false)
    .build()
}

fn finish_popup(app: &AppHandle, server: &Server, label: &str, opener_label: &str, url: Url) {
    if let Some(popup) = app.get_webview_window(label) {
        let _ = popup.close();
    }
    log::info!("sign-in popup finished");
    match app.get_webview_window(opener_label) {
        Some(window) => {
            navigate_in_app(app, &window, server, &url);
            show_window(&window);
        }
        None => {
            if let Err(error) = open_server_window(app, server, Target::InApp(url)) {
                log::warn!("could not show the page after a sign-in popup: {}", error.message);
            }
        }
    }
}

fn load_started(app: &AppHandle, server: &Server, window: &WebviewWindow, url: Url) {
    let state = app.state::<AppState>();
    state.with_window(window.label(), |info| {
        info.navigate_ready = false;
        info.loading = Some(url.clone());
        info.load_seq = info.load_seq.wrapping_add(1);
    });
    #[cfg(not(windows))]
    offline::probe_on_load(app, server, window.label(), url);
    #[cfg(windows)]
    let _ = (server, url);
}

fn load_finished(app: &AppHandle, server: &Server, window: &WebviewWindow, url: Url) {
    let (server, label) = (server.clone(), window.label().to_string());
    // Which load this is: a failure recorded for this same load means the
    // offline page is on its way.
    let load = app.state::<AppState>().window_info(&label).load_seq;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SETTLE).await;
        let Some(window) = app.get_webview_window(&label) else {
            return;
        };
        let state = app.state::<AppState>();
        let web_page = routing::is_web_page(&server, &url);
        let info = state.with_window(&label, |info| {
            if let Some(offline) = &info.offline {
                if offline.load == load && !routing::same_document(&offline.page, &url) {
                    return None;
                }
                // A server page loaded after all (a link or notification
                // while offline): the window is no longer offline.
                if web_page {
                    info.offline = None;
                }
            }
            Some(info.clone())
        });
        let Some(info) = info else {
            return;
        };
        if web_page && !info.web_title_bar && info.offline.is_none() {
            // Give the web app a moment to say it draws the title bar; an
            // older server never does and gets the native frame.
            tokio::time::sleep(TITLE_BAR_GRACE).await;
        }
        let info = state.window_info(&label);
        set_chrome(&window, web_page && info.web_title_bar);
        if !info.download_only {
            reveal(&app, &window);
        }
        report_chrome(&app, &window, None, true);
    });
}

/// Called when the page says it is up (bridge `ready`).
pub fn page_ready(app: &AppHandle, window: &WebviewWindow, navigate: bool, title_bar: bool) {
    let state = app.state::<AppState>();
    state.with_window(window.label(), |info| {
        info.navigate_ready = navigate;
        info.web_title_bar |= title_bar;
    });
    if title_bar {
        set_chrome(window, true);
        reveal(app, window);
    }
    report_chrome(app, window, None, true);
}

/// Shows a window that was waiting for its page, once.
fn reveal(app: &AppHandle, window: &WebviewWindow) {
    let state = app.state::<AppState>();
    if state.with_window(window.label(), |info| std::mem::take(&mut info.pending_reveal)) {
        show_window(window);
    }
}

/// The custom title bar (the web app draws it) or the native frame.
pub fn set_chrome(window: &WebviewWindow, custom: bool) {
    #[cfg(any(windows, target_os = "linux"))]
    if window.is_decorated().unwrap_or(true) == custom {
        let _ = window.set_decorations(!custom);
    }
    #[cfg(target_os = "macos")]
    {
        let style = if custom {
            tauri::TitleBarStyle::Overlay
        } else {
            tauri::TitleBarStyle::Visible
        };
        let _ = window.set_title_bar_style(style);
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    let _ = (window, custom);
}

/// Sends `margaya:window-state` to the page when it changed (or always,
/// with `force`, after a load or `ready`).
pub fn report_chrome(app: &AppHandle, window: &WebviewWindow, focused: Option<bool>, force: bool) {
    let chrome = ChromeState {
        maximized: window.is_maximized().unwrap_or(false),
        focused: focused.unwrap_or_else(|| window.is_focused().unwrap_or(false)),
        fullscreen: window.is_fullscreen().unwrap_or(false),
    };
    let state = app.state::<AppState>();
    let changed = state.with_window(window.label(), |info| {
        let changed = info.chrome != Some(chrome);
        info.chrome = Some(chrome);
        changed
    });
    if changed || force {
        let _ = window.eval(routing::window_state_script(chrome));
    }
}

/// Closing a server's main window hides it (the app stays in the tray and
/// reopens it instantly); other windows close.
pub fn close_server_window(app: &AppHandle, window: &WebviewWindow) {
    match servers::parse_window_label(window.label()) {
        Some(WindowKind::Primary(id)) => {
            let _ = window.hide();
            let _ = lock(&app.state::<AppState>().store).set_reopen(id, false);
        }
        _ => {
            let _ = window.close();
        }
    }
}

/// This server's webview data directory (Windows: WebView2's user data
/// folder; Linux: WebKitGTK's data and cache directories, cookies included,
/// so each server keeps its own session).
pub fn profile_dir(app: &AppHandle, server_id: &str) -> AppResult<PathBuf> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(AppError::internal)?;
    Ok(base.join("profiles").join(server_id))
}

/// Closes every window of a server and deletes its webview data.
pub fn forget_server_window(app: &AppHandle, server: &Server) {
    for (label, window) in app.webview_windows() {
        if servers::parse_window_label(&label).is_some_and(|kind| kind.server_id() == server.id) {
            let _ = window.destroy();
        }
    }
    #[cfg(not(target_os = "macos"))]
    if let Ok(dir) = profile_dir(app, &server.id) {
        // WebView2 may hold the folder for a moment after the window closes.
        tauri::async_runtime::spawn(async move {
            for _ in 0..10 {
                if !dir.exists() || std::fs::remove_dir_all(&dir).is_ok() {
                    return;
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
            log::warn!("could not delete a removed server's webview data");
        });
    }
    #[cfg(target_os = "macos")]
    if let Some(identifier) = server.store_identifier() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = app.remove_data_store(identifier).await {
                log::warn!("could not delete a removed server's data store: {error}");
            }
        });
    }
}

fn file_name_of(path: Option<&Path>, url: &Url) -> String {
    path.and_then(Path::file_name)
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .or_else(|| {
            url.path_segments()
                .and_then(|mut segments| segments.next_back())
                .map(str::to_string)
        })
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "download".to_string())
}

fn handle_download(app: &AppHandle, label: &str, event: DownloadEvent<'_>) -> bool {
    let state = app.state::<AppState>();
    match event {
        DownloadEvent::Requested { url, destination } => {
            let name = file_name_of(Some(destination.as_path()), &url);
            if let Ok(dir) = app.path().download_dir() {
                *destination = unique_path(&dir, &sanitize_file_name(&name), Path::exists);
            }
            state.with_window(label, |info| {
                info.downloads += 1;
                // A window opened for a link that turned out to be a file
                // never shows; it closes when the download ends.
                if info.pending_reveal {
                    info.pending_reveal = false;
                    info.download_only = true;
                }
            });
            true
        }
        DownloadEvent::Finished { url, path, success } => {
            let file = file_name_of(path.as_deref(), &url);
            let title = if success {
                i18n::tv("downloads.finished", &[("file", &file)])
            } else {
                log::warn!("a download failed");
                i18n::tv("downloads.failed", &[("file", &file)])
            };
            let _ = app.notification().builder().title(title).show();
            let close = state.with_window(label, |info| {
                info.downloads = info.downloads.saturating_sub(1);
                info.download_only && info.downloads == 0
            });
            if close && matches!(servers::parse_window_label(label), Some(WindowKind::Secondary(..))) {
                let label = label.to_string();
                spawn_ui(app, move |app| {
                    if let Some(window) = app.get_webview_window(&label) {
                        let _ = window.close();
                    }
                });
            }
            true
        }
        _ => true,
    }
}

/// Invisible direction marks and overrides: "report" + U+202E + "fdp.exe"
/// shows as "reportexe.pdf".
fn is_bidi_control(c: char) -> bool {
    matches!(
        c,
        '\u{061C}' | '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}'
    )
}

/// Names Windows reserves for devices, with or without an extension.
fn is_reserved_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or_default().trim_end();
    let upper = stem.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper.len() == 4
            && matches!(upper.as_bytes()[3], b'1'..=b'9'))
}

/// Removes path separators, characters Windows refuses in file names and
/// direction overrides, and steers clear of reserved device names.
pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control()
                || is_bidi_control(c)
                || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim().to_string();
    if cleaned.is_empty() {
        "download".to_string()
    } else if is_reserved_device_name(&cleaned) {
        format!("_{cleaned}")
    } else {
        cleaned
    }
}

/// `dir/name`, or `dir/name (2).ext` and so on when that file exists.
pub fn unique_path(dir: &Path, name: &str, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let candidate = dir.join(name);
    if !exists(&candidate) {
        return candidate;
    }
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem, format!(".{extension}")),
        _ => (name, String::new()),
    };
    (2..10_000)
        .map(|n| dir.join(format!("{stem} ({n}){extension}")))
        .find(|path| !exists(path))
        .unwrap_or(candidate)
}

/// A path on a server's web UI ("/dashboard/...") as an absolute URL,
/// keeping a base path the web UI is hosted under.
pub fn web_url_for_path(server: &Server, path: &str) -> Option<Url> {
    let path = urls::safe_relative_path(path)?;
    let base = server.web_url.trim_end_matches('/');
    let url = Url::parse(&format!("{base}{path}")).ok()?;
    // A page of the web UI only, never an API route on the same origin.
    routing::is_web_page(server, &url).then_some(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: Rect = Rect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };
    const MIN: (u32, u32) = (360, 480);

    fn rect(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect { x, y, width, height }
    }

    #[test]
    fn keeps_windows_that_fit_as_they_are() {
        let window = rect(100, 80, 1280, 820);
        assert_eq!(fit_to_work_area(window, AREA, MIN), window);
        // A narrow window is fine down to the minimum.
        let narrow = rect(10, 10, 360, 480);
        assert_eq!(fit_to_work_area(narrow, AREA, MIN), narrow);
    }

    #[test]
    fn brings_restored_windows_back_on_screen() {
        // Saved on a bigger monitor: shrunk to the work area, moved inside.
        assert_eq!(
            fit_to_work_area(rect(2000, 900, 2560, 1400), AREA, MIN),
            rect(0, 0, 1920, 1040)
        );
        // Hanging off the right edge and under the taskbar: moved back.
        assert_eq!(
            fit_to_work_area(rect(1500, 900, 800, 600), AREA, MIN),
            rect(1120, 440, 800, 600)
        );
        // Off the left or top (a monitor that was removed): moved back.
        assert_eq!(
            fit_to_work_area(rect(-3000, -50, 800, 600), AREA, MIN),
            rect(0, 0, 800, 600)
        );
        // Smaller than the minimum (an older saved state): grown to it.
        assert_eq!(
            fit_to_work_area(rect(50, 50, 200, 100), AREA, MIN),
            rect(50, 50, 360, 480)
        );
        // A second monitor to the left with its own origin.
        let left = rect(-1280, 0, 1280, 984);
        assert_eq!(
            fit_to_work_area(rect(-200, 100, 1280, 820), left, MIN),
            rect(-1280, 100, 1280, 820)
        );
        // A work area smaller than the minimum: the minimum wins, pinned to the corner.
        assert_eq!(
            fit_to_work_area(rect(40, 40, 400, 600), rect(0, 0, 320, 400), MIN),
            rect(0, 0, 360, 480)
        );
    }

    #[test]
    fn leaves_room_for_the_traffic_lights_at_the_minimum_width() {
        let (x, _) = crate::titlebar::traffic_lights_position();
        // The lights (about 54 px from x) and the inset the web keeps free fit
        // well inside the narrowest window, leaving most of the bar usable.
        assert!(x + 54.0 < f64::from(crate::titlebar::MACOS_LEFT_INSET));
        assert!(f64::from(crate::titlebar::MACOS_LEFT_INSET) * 3.0 < SERVER_MIN_WIDTH);
    }

    #[test]
    fn cleans_download_names() {
        assert_eq!(sanitize_file_name("report.csv"), "report.csv");
        assert_eq!(sanitize_file_name("../../evil.exe"), "_.._evil.exe");
        assert_eq!(sanitize_file_name("a:b?.txt"), "a_b_.txt");
        assert_eq!(sanitize_file_name(".."), "download");
        // Direction overrides can't disguise an extension.
        assert_eq!(
            sanitize_file_name("report\u{202E}fdp.exe"),
            "report_fdp.exe"
        );
        assert_eq!(sanitize_file_name("a\u{200E}b\u{2067}c\u{061C}.txt"), "a_b_c_.txt");
        // Reserved device names, any case, with or without an extension.
        for reserved in ["CON", "con.txt", "Nul", "aux.tar.gz", "COM1", "lpt9.log", "prn .txt"] {
            assert_eq!(sanitize_file_name(reserved), format!("_{reserved}"), "{reserved}");
        }
        for fine in ["console.txt", "COM0", "COM10.txt", "lpt.txt", "nullable.csv"] {
            assert_eq!(sanitize_file_name(fine), fine, "{fine}");
        }
        // Spaces left after trimming dots go too.
        assert_eq!(sanitize_file_name(" . report.csv . "), "report.csv");
        assert_eq!(sanitize_file_name(". ."), "download");
    }

    #[test]
    fn names_downloads() {
        let url = Url::parse("https://api.example/api/asset/a1").unwrap();
        assert_eq!(file_name_of(Some(Path::new("/d/report.csv")), &url), "report.csv");
        assert_eq!(file_name_of(None, &url), "a1");
        let bare = Url::parse("https://api.example/").unwrap();
        assert_eq!(file_name_of(None, &bare), "download");
    }

    #[test]
    fn numbers_existing_downloads() {
        let dir = Path::new("/downloads");
        let taken = |path: &Path| path.ends_with("report.csv") || path.ends_with("report (2).csv");
        assert_eq!(
            unique_path(dir, "report.csv", taken),
            dir.join("report (3).csv")
        );
        assert_eq!(unique_path(dir, "other.csv", taken), dir.join("other.csv"));
        let no_extension = |path: &Path| path.ends_with("README");
        assert_eq!(
            unique_path(dir, "README", no_extension),
            dir.join("README (2)")
        );
    }

    #[test]
    fn builds_urls_on_the_server_only() {
        let server = Server {
            id: "00000000-0000-4000-8000-000000000000".into(),
            label: "x".into(),
            web_url: "https://app.example/margaya".into(),
            api_url: "https://api.example".into(),
            server_version: None,
            added_at: 0,
            last_used_at: None,
            reopen: false,
            sound_muted: false,
        };
        assert_eq!(
            web_url_for_path(&server, "/dashboard?x=1")
                .unwrap()
                .as_str(),
            "https://app.example/margaya/dashboard?x=1"
        );
        assert!(web_url_for_path(&server, "//evil.example").is_none());
        assert!(web_url_for_path(&server, "@evil.example").is_none());
        // API and web on one origin: a deep link never opens an API route.
        let same = Server {
            web_url: "https://pm.example".into(),
            api_url: "https://pm.example".into(),
            ..server
        };
        assert!(web_url_for_path(&same, "/dashboard").is_some());
        assert!(web_url_for_path(&same, "/api/asset/a1?download=1").is_none());
        assert!(web_url_for_path(&same, "/api/auth/sign-out").is_none());
    }
}
