//! Commands. The launcher and quick-add windows may call all of them except
//! `bridge_message`; server pages may call only `bridge_message`
//! (capabilities/launcher.json and capabilities/server-bridge.json).

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, Webview};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_clipboard_manager::ClipboardExt;
use url::Url;

use crate::bridge::{self, BridgeMessage};
use crate::discovery::{self, Discovery};
use crate::error::{AppError, AppResult, ErrorKind};
use crate::servers::Server;
use crate::state::{lock, AppState};
use crate::{
    acl, api, badge_view, diagnostics, menus, opener, routing, signin, socket, tokens, updates,
    urls, windows,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerView {
    id: String,
    label: String,
    web_url: String,
    api_url: String,
    server_version: Option<String>,
    signed_in: bool,
    unread: u32,
    insecure: bool,
    last_used_at: Option<u64>,
}

fn view(state: &AppState, server: Server) -> ServerView {
    let insecure = [server.web(), server.api()]
        .into_iter()
        .flatten()
        .any(|url| urls::is_insecure(&url));
    ServerView {
        signed_in: tokens::get(&server.id).is_some(),
        unread: lock(&state.unread)
            .get(&server.id)
            .copied()
            .unwrap_or_default(),
        insecure,
        id: server.id,
        label: server.label,
        web_url: server.web_url,
        api_url: server.api_url,
        server_version: server.server_version,
        last_used_at: server.last_used_at,
    }
}

fn changed(app: &AppHandle) {
    let _ = app.emit("servers-changed", ());
    menus::refresh_tray(app);
}

fn token_for(server_id: &str) -> AppResult<String> {
    tokens::get(server_id).ok_or_else(|| AppError::new(ErrorKind::NotSignedIn, "not signed in"))
}

// Async so the keychain reads run off the main thread.
#[tauri::command]
pub async fn list_servers(state: State<'_, AppState>) -> AppResult<Vec<ServerView>> {
    Ok(state
        .servers()
        .into_iter()
        .map(|server| view(&state, server))
        .collect())
}

#[tauri::command]
pub async fn discover_server(
    app: AppHandle,
    state: State<'_, AppState>,
    input: String,
) -> AppResult<Discovery> {
    let version = app.package_info().version.to_string();
    discovery::discover(&state.http, &input, &version).await
}

#[tauri::command]
pub fn add_server(
    app: AppHandle,
    state: State<'_, AppState>,
    discovery: Discovery,
    label: String,
) -> AppResult<ServerView> {
    // Re-check what the launcher sends back: both URLs must be web URLs.
    let web = urls::normalize_server_input(&discovery.web_url);
    let api = urls::normalize_server_input(&discovery.api_url);
    if web.is_none() || api.is_none() {
        return Err(AppError::new(ErrorKind::InvalidUrl, "invalid server URLs"));
    }
    let server = lock(&state.store).add(&discovery, &label)?;
    acl::grant_bridge(&app, &server);
    changed(&app);
    Ok(view(&state, server))
}

#[tauri::command]
pub fn rename_server(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    label: String,
) -> AppResult<()> {
    lock(&state.store).rename(&id, &label)?;
    if let Ok(server) = state.server(&id) {
        if let Some(window) = app.get_webview_window(&server.window_label()) {
            let _ = window.set_title(&server.label);
        }
    }
    changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn remove_server(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    let server = state.server(&id)?;
    sign_out_server(&app, &state, &server).await;
    lock(&state.pending).cancel(&id);
    lock(&state.store).remove(&id)?;
    windows::forget_server_window(&app, &server);
    changed(&app);
    Ok(())
}

// Commands that create windows are async: a synchronous command runs on the
// main thread, and creating a webview there deadlocks on Windows.
#[tauri::command]
pub async fn open_server(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let server = state.server(&id)?;
    windows::open_server_window(&app, &server, windows::Target::None)?;
    // The launcher is a switcher: it steps aside once a server is open.
    if let Some(launcher) = app.get_webview_window(windows::LAUNCHER) {
        let _ = launcher.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn start_sign_in(app: AppHandle, id: String, show_code: bool) -> AppResult<()> {
    signin::start(&app, &id, show_code)
}

#[tauri::command]
pub async fn submit_sign_in_code(app: AppHandle, id: String, code: String) -> AppResult<()> {
    signin::submit_code(&app, &id, &code).await
}

#[tauri::command]
pub fn cancel_sign_in(state: State<'_, AppState>, id: String) {
    lock(&state.pending).cancel(&id);
}

pub async fn sign_out_server(app: &AppHandle, state: &AppState, server: &Server) {
    socket::stop(app, &server.id);
    windows::close_popups(app, &server.id);
    lock(&state.handoff_secrets).remove(&server.id);
    if let Some(token) = tokens::get(&server.id) {
        // Revoke on the server too; a server that can't be reached still
        // loses the token here.
        if let Err(error) = api::post(
            &state.http,
            server,
            &token,
            "/api/auth/desktop/sign-out",
            &serde_json::json!({}),
        )
        .await
        {
            log::warn!("server sign-out failed: {}", error.message);
        }
        tokens::delete(&server.id);
    }
}

#[tauri::command]
pub async fn sign_out(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let server = state.server(&id)?;
    sign_out_server(&app, &state, &server).await;
    changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> AppResult<()> {
    let url = bridge::external_url(&url)
        .ok_or_else(|| AppError::new(ErrorKind::InvalidUrl, "not a web link"))?;
    opener::open_outside(&app, "app", &url);
    Ok(())
}

#[tauri::command]
pub fn take_launcher_prompt(state: State<'_, AppState>) -> Option<String> {
    lock(&state.launcher_prompt).take()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    version: String,
    platform: &'static str,
    autostart: bool,
    /// False for a Linux .deb or .rpm: a new version comes from the
    /// download page, not from the app.
    self_update: bool,
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    let platform = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "other"
    };
    Settings {
        version: app.package_info().version.to_string(),
        platform,
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
        self_update: updates::self_update_supported(),
    }
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> AppResult<()> {
    let autolaunch = app.autolaunch();
    let result = if enabled {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    result.map_err(AppError::internal)
}

#[tauri::command]
pub fn copy_diagnostics(app: AppHandle) -> AppResult<()> {
    app.clipboard()
        .write_text(diagnostics::collect(&app))
        .map_err(AppError::internal)
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> AppResult<Option<String>> {
    updates::check(&app).await
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> AppResult<()> {
    updates::install(&app).await
}

#[tauri::command]
pub async fn quick_add_targets(
    state: State<'_, AppState>,
    server_id: String,
) -> AppResult<Vec<api::QuickAddTarget>> {
    let server = state.server(&server_id)?;
    let token = token_for(&server_id)?;
    api::quick_add_targets(&state.http, &server, &token).await
}

#[tauri::command]
pub async fn quick_add_create(
    state: State<'_, AppState>,
    server_id: String,
    workspace_id: String,
    project_id: String,
    title: String,
) -> AppResult<api::QuickAddResult> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::new(ErrorKind::QuickAddFailed, "empty title"));
    }
    let server = state.server(&server_id)?;
    let token = token_for(&server_id)?;
    api::create_task(
        &state.http,
        &server,
        &token,
        &workspace_id,
        &project_id,
        title,
    )
    .await
}

#[tauri::command]
pub async fn quick_add_open(
    app: AppHandle,
    state: State<'_, AppState>,
    server_id: String,
    url: String,
) -> AppResult<()> {
    let server = state.server(&server_id)?;
    let target = Url::parse(&url)
        .ok()
        .filter(|url| server.owns(url))
        .map_or(windows::Target::None, windows::Target::InApp);
    windows::open_server_window(&app, &server, target)?;
    if let Some(window) = app.get_webview_window(windows::QUICK_ADD) {
        let _ = window.close();
    }
    Ok(())
}

#[tauri::command]
pub fn close_quick_add(app: AppHandle) {
    if let Some(window) = app.get_webview_window(windows::QUICK_ADD) {
        let _ = window.close();
    }
}

/// The only command a server page may call. Messages from any page that is
/// not the server's own web origin, in one of that server's own windows, are
/// dropped. Window controls act only on the window that sent them.
#[tauri::command]
pub async fn bridge_message(
    app: AppHandle,
    webview: Webview,
    state: State<'_, AppState>,
    message: BridgeMessage,
) -> AppResult<serde_json::Value> {
    use serde_json::Value;
    let Ok(page) = webview.url() else {
        return Ok(Value::Null);
    };
    let servers = state.servers();
    let Some(server) = bridge::sender_server(&servers, webview.label(), &page).cloned() else {
        log::warn!("ignored a bridge message from an unknown page");
        return Ok(Value::Null);
    };
    let window = app.get_webview_window(webview.label());
    match message {
        BridgeMessage::StartBrowserSignIn => {
            if let Err(error) = signin::start(&app, &server.id, false) {
                log::warn!("browser sign-in failed to start: {}", error.message);
            }
        }
        BridgeMessage::OpenExternal { url } => {
            if let Some(url) = bridge::external_url(&url) {
                opener::open_outside(&app, &server.id, &url);
            }
        }
        BridgeMessage::SetBadge { count } => {
            lock(&state.unread).insert(server.id.clone(), count);
            badge_view::apply(&app);
            let _ = app.emit("servers-changed", ());
        }
        BridgeMessage::ShowQuickAdd => {
            let id = server.id.clone();
            windows::spawn_ui(&app, move |app| {
                let _ = windows::show_quick_add(app, Some(&id));
            });
        }
        BridgeMessage::TakeHandoffSecret => {
            return Ok(lock(&state.handoff_secrets)
                .remove(&server.id)
                .map_or(Value::Null, Value::String));
        }
        BridgeMessage::ShowServers => windows::show_launcher(&app),
        BridgeMessage::OpenSignInPopup { url } => {
            match Url::parse(&url)
                .ok()
                .filter(|url| routing::is_oauth_request(&server, url))
            {
                Some(url) => windows::announce_sign_in_popup(&app, &server, webview.label(), url),
                None => log::warn!(
                    "refused a sign-in popup that doesn't return to this server's sign-in callback"
                ),
            }
        }
        BridgeMessage::SignedOut => {
            log::info!("the web app signed out; signing this server out natively");
            sign_out_server(&app, &state, &server).await;
            changed(&app);
        }
        BridgeMessage::Ready {
            navigate,
            title_bar,
        } => {
            if let Some(window) = &window {
                windows::page_ready(&app, window, navigate, title_bar);
            }
        }
        BridgeMessage::SoundMuted { muted } => {
            if let Err(error) = lock(&state.store).set_sound_muted(&server.id, muted) {
                log::warn!("could not keep the sound setting: {}", error.message);
            }
        }
        BridgeMessage::Minimize => {
            if let Some(window) = &window {
                let _ = window.minimize();
            }
        }
        BridgeMessage::ToggleMaximize => {
            if let Some(window) = &window {
                let _ = if window.is_maximized().unwrap_or(false) {
                    window.unmaximize()
                } else {
                    window.maximize()
                };
            }
        }
        BridgeMessage::Close => {
            if let Some(window) = &window {
                windows::close_server_window(&app, window);
            }
        }
        BridgeMessage::StartDragging => {
            if let Some(window) = &window {
                let _ = window.start_dragging();
            }
        }
        BridgeMessage::IsMaximized => {
            return Ok(Value::Bool(
                window.is_some_and(|window| window.is_maximized().unwrap_or(false)),
            ));
        }
    }
    Ok(Value::Null)
}
