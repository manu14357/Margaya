//! The offline page. When a server window's page can't load (no network,
//! server down, untrusted certificate), the window shows the launcher bundle's
//! offline page (`index.html#offline`) instead of the webview's own error
//! page. It retries with a growing delay and goes back to the page it was on
//! once the server answers.
//!
//! The page runs on the app's own origin in the server window, so it may call
//! only `offline_state`, `offline_retry` and `show_servers`
//! (capabilities/offline.json, local pages only), and Rust answers only the
//! window that is actually showing it.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, State, Webview};
use url::Url;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::routing;
use crate::servers::{self, Server};
use crate::state::{AppState, Offline};
use crate::{discovery, windows};

const PROBE_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineView {
    server_name: String,
    web_url: String,
    error_kind: ErrorKind,
    attempt: u32,
    retry_in_ms: u64,
}

fn view(server: &Server, offline: &Offline) -> OfflineView {
    OfflineView {
        server_name: server.label.clone(),
        web_url: server.web_url.clone(),
        error_kind: offline.error,
        attempt: offline.attempt,
        retry_in_ms: routing::offline_backoff(offline.attempt).as_millis() as u64,
    }
}

/// The offline page's address on the app's own origin (the launcher's).
pub fn page_url(app: &AppHandle) -> Option<Url> {
    let mut url = app.get_webview_window(windows::LAUNCHER)?.url().ok()?;
    url.set_path("/index.html");
    url.set_query(None);
    url.set_fragment(Some("offline"));
    Some(url)
}

/// Whether the server's web UI answers at all (any HTTP response counts).
pub async fn probe(http: &reqwest::Client, web: &Url) -> Result<(), ErrorKind> {
    http.get(web.clone())
        .timeout(PROBE_TIMEOUT)
        .send()
        .await
        .map(|_| ())
        .map_err(|error| discovery::classify_request_error(&error).kind)
}

/// Shows the offline page in `label`, remembering `target` to go back to.
pub fn went_offline(app: &AppHandle, server: &Server, label: &str, target: Url, error: ErrorKind) {
    if !routing::is_web_page(server, &target) {
        return;
    }
    let Some(page) = page_url(app) else {
        return;
    };
    log::info!("a server window can't reach its server ({error:?}); showing the offline page");
    let state = app.state::<AppState>();
    state.with_window(label, |info| {
        let attempt = info.offline.as_ref().map_or(0, |offline| offline.attempt + 1);
        info.offline = Some(Offline {
            target,
            page: page.clone(),
            error,
            attempt,
            load: info.load_seq,
        });
    });
    let label = label.to_string();
    windows::spawn_ui(app, move |app| {
        if let Some(window) = app.get_webview_window(&label) {
            if let Err(error) = window.navigate(page) {
                log::warn!("could not show the offline page: {error}");
            }
        }
    });
}

/// Windows: WebView2 says exactly why a main-frame load failed.
#[cfg(windows)]
pub fn watch_load_failures(app: &AppHandle, window: &tauri::WebviewWindow, server: &Server) {
    let app = app.clone();
    let server = server.clone();
    let label = window.label().to_string();
    let result = window.with_webview(move |webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_WEB_ERROR_STATUS;
        use webview2_com::NavigationCompletedEventHandler;
        use ::windows::core::BOOL;

        let handler = NavigationCompletedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut success = BOOL::default();
            let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
            // SAFETY: reading two out-parameters of the event's own arguments.
            unsafe {
                args.IsSuccess(&mut success)?;
                args.WebErrorStatus(&mut status)?;
            }
            if success.as_bool() {
                return Ok(());
            }
            let Some(error) = routing::offline_error_for_web_status(status.0) else {
                return Ok(());
            };
            let state = app.state::<AppState>();
            if let Some(target) = state.window_info(&label).loading {
                went_offline(&app, &server, &label, target, error);
            }
            Ok(())
        }));
        let mut token: i64 = 0;
        // SAFETY: the controller belongs to this live webview, on its own thread.
        let added = unsafe {
            webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.add_NavigationCompleted(&handler, &mut token))
        };
        if let Err(error) = added {
            log::warn!("could not watch a server window's page loads: {error}");
        }
    });
    if let Err(error) = result {
        log::warn!("could not watch a server window's page loads: {error}");
    }
}

/// Elsewhere: check the server when a page of its web UI starts loading.
#[cfg(not(windows))]
pub fn probe_on_load(app: &AppHandle, server: &Server, label: &str, url: Url) {
    if !routing::is_web_page(server, &url) {
        return;
    }
    let Some(web) = server.web() else {
        return;
    };
    let (app, server, label) = (app.clone(), server.clone(), label.to_string());
    tauri::async_runtime::spawn(async move {
        let http = app.state::<AppState>().http.clone();
        if let Err(error) = probe(&http, &web).await {
            went_offline(&app, &server, &label, url, error);
        }
    });
}

/// The server window calling, when it is showing the offline page.
fn caller(state: &AppState, webview: &Webview) -> AppResult<(Server, Offline)> {
    let refused = || AppError::internal("not an offline page");
    let id = servers::id_from_window_label(webview.label()).ok_or_else(refused)?;
    let server = state.server(id)?;
    let offline = state
        .window_info(webview.label())
        .offline
        .ok_or_else(refused)?;
    let page = webview.url().map_err(AppError::internal)?;
    if !routing::same_document(&page, &offline.page) {
        return Err(refused());
    }
    Ok((server, offline))
}

#[tauri::command]
pub fn offline_state(webview: Webview, state: State<'_, AppState>) -> AppResult<OfflineView> {
    let (server, offline) = caller(&state, &webview)?;
    Ok(view(&server, &offline))
}

/// Tries the server again. `manual` (the Retry button) always reloads the
/// page; an automatic retry checks the server first and stays here while it
/// is still unreachable. Returns None when the window is going back.
#[tauri::command]
pub async fn offline_retry(
    app: AppHandle,
    webview: Webview,
    state: State<'_, AppState>,
    manual: bool,
) -> AppResult<Option<OfflineView>> {
    let (server, offline) = caller(&state, &webview)?;
    if !manual {
        let web = server
            .web()
            .ok_or_else(|| AppError::internal("invalid server URL"))?;
        if let Err(error) = probe(&state.http, &web).await {
            let updated = state.with_window(webview.label(), |info| {
                let offline = info.offline.as_mut()?;
                offline.attempt = offline.attempt.saturating_add(1);
                offline.error = error;
                Some(offline.clone())
            });
            return Ok(updated.map(|offline| view(&server, &offline)));
        }
    }
    state.with_window(webview.label(), |info| info.offline = None);
    log::info!("leaving the offline page");
    let label = webview.label().to_string();
    windows::spawn_ui(&app, move |app| {
        if let Some(window) = app.get_webview_window(&label) {
            if let Err(error) = window.navigate(offline.target) {
                log::warn!("could not leave the offline page: {error}");
            }
        }
    });
    Ok(None)
}

/// The launcher (server switcher), from the offline page only.
#[tauri::command]
pub fn show_servers(app: AppHandle, webview: Webview, state: State<'_, AppState>) -> AppResult<()> {
    caller(&state, &webview)?;
    windows::show_launcher(&app);
    Ok(())
}
