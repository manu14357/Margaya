//! Sign-in and deep links, wired to the app: opening the system browser,
//! finishing a callback, and opening `margaya://open` and
//! `margaya://download` links.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

use crate::auth::{self, DeepLink, PendingSignIn};
use crate::error::{AppError, AppResult, ErrorKind};
use crate::state::{lock, AppState};
use crate::{api, menus, opener, socket, tokens, urls, windows};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SignInFinished {
    server_id: String,
    ok: bool,
    error_kind: Option<ErrorKind>,
}

/// Opens the system browser on the server's desktop sign-in page (on its
/// own thread; see opener.rs).
pub fn start(app: &AppHandle, server_id: &str, show_code: bool) -> AppResult<()> {
    let state = app.state::<AppState>();
    let server = state.server(server_id)?;
    let api = server
        .api()
        .ok_or_else(|| AppError::internal("invalid API URL"))?;
    let (sign_in_state, verifier) = lock(&state.pending).start(server_id);
    let url = auth::sign_in_url(&api, &sign_in_state, &auth::challenge(&verifier), show_code);
    opener::open_outside(app, server_id, &url);
    Ok(())
}

/// Exchanges the code, keeps the token, starts the socket and signs the
/// server window in through the one-time webview URL.
pub async fn finish(app: &AppHandle, pending: PendingSignIn, code: &str) -> AppResult<()> {
    let state = app.state::<AppState>();
    let (server, response) = establish(app, pending, code, true)
        .await?
        .ok_or_else(|| AppError::internal("sign-in replaced"))?;
    // The person signed in: a window's session may sign the app in again
    // after a later sign-out.
    if let Err(error) = lock(&state.store).set_link_paused(&server.id, false) {
        log::warn!("could not keep the sign-in setting: {}", error.message);
    }
    let web = server
        .web()
        .ok_or_else(|| AppError::internal("invalid web URL"))?;
    match response.webview_secret {
        Some(secret) => lock(&state.handoff_secrets).insert(server.id.clone(), secret),
        None => lock(&state.handoff_secrets).remove(&server.id),
    };
    let target = auth::checked_webview_url(&response.webview_url, &web)
        .map_or(windows::Target::None, windows::Target::Load);
    let window_app = app.clone();
    let window_server = server.clone();
    tauri::async_runtime::spawn_blocking(move || {
        windows::open_server_window(&window_app, &window_server, target)
    })
    .await
    .map_err(AppError::internal)??;
    menus::refresh_tray(app);
    log::info!("desktop sign-in finished");
    Ok(())
}

/// Signs the app in for a page that is signed in already (password or email
/// code inside the window), with the code the page minted for the app's
/// pending sign-in. The window keeps its own session, so nothing reloads;
/// the app gets the token its notifications, badge and quick add need.
pub async fn link(app: &AppHandle, pending: PendingSignIn, code: &str) -> AppResult<()> {
    let state = app.state::<AppState>();
    let server_id = pending.server_id.clone();
    let result = establish(app, pending, code, false).await;
    lock(&state.pending).link_done(&server_id);
    let result = match result {
        Ok(Some(_)) => {
            menus::refresh_tray(app);
            log::info!("desktop sign-in linked to the window's session");
            Ok(())
        }
        // Signed in meanwhile (the person's own sign-in won): nothing to do.
        Ok(None) => return Ok(()),
        Err(error) => {
            // No keychain: every page load would try again and fail the same
            // way, so windows stop asking until the person signs in.
            if error.kind == ErrorKind::KeychainUnavailable {
                let _ = lock(&state.store).set_link_paused(&server_id, true);
            }
            Err(error)
        }
    };
    report(app, &server_id, &result);
    result
}

/// The part every sign-in shares: trade the code for the app's token, keep
/// it in the keychain and start the user socket. With `replace` false (a
/// window's link), a session the app got meanwhile wins: the new token is
/// revoked and None comes back. A token the keychain refuses is revoked too,
/// so no session is left behind on the server.
async fn establish(
    app: &AppHandle,
    pending: PendingSignIn,
    code: &str,
    replace: bool,
) -> AppResult<Option<(crate::servers::Server, auth::TokenResponse)>> {
    let state = app.state::<AppState>();
    let server = state.server(&pending.server_id)?;
    let api = server
        .api()
        .ok_or_else(|| AppError::internal("invalid API URL"))?;
    let response = auth::exchange_code(
        &state.http,
        &api,
        code.trim(),
        &pending.verifier,
        &pending.state,
    )
    .await?;
    if !replace && state.session(&server.id).is_some() {
        revoke(app, &server, &response.token).await;
        return Ok(None);
    }
    if !tokens::set(&server.id, &response.token) {
        revoke(app, &server, &response.token).await;
        return Err(AppError::new(
            ErrorKind::KeychainUnavailable,
            "could not store the token in the keychain",
        ));
    }
    // A new session: work still running for an earlier one (offline
    // snapshots on their way) is now stale.
    state.mark_signed_in(&server.id);
    // The token may be another account's than the one whose offline copies
    // are kept: those go unless the server confirms it is the same person.
    let user = api::session_user_id(&state.http, &server, &response.token).await;
    crate::offline_cache::claim(app, &server.id, user.as_deref());
    socket::start(app, &server.id);
    Ok(Some((server, response)))
}

/// Ends a session the app just got but won't keep.
async fn revoke(app: &AppHandle, server: &crate::servers::Server, token: &str) {
    let state = app.state::<AppState>();
    if let Err(error) = api::post(
        &state.http,
        server,
        token,
        "/api/auth/desktop/sign-out",
        &serde_json::json!({}),
    )
    .await
    {
        log::warn!("could not end an unused desktop session: {}", error.message);
    }
}

fn report(app: &AppHandle, server_id: &str, result: &AppResult<()>) {
    if let Err(error) = result {
        log::warn!("desktop sign-in failed: {:?}", error.kind);
    }
    let _ = app.emit(
        "sign-in-finished",
        SignInFinished {
            server_id: server_id.to_string(),
            ok: result.is_ok(),
            error_kind: result.as_ref().err().map(|error| error.kind),
        },
    );
    let _ = app.emit("servers-changed", ());
}

/// Finishes a sign-in with a code the user pasted into the launcher.
pub async fn submit_code(app: &AppHandle, server_id: &str, code: &str) -> AppResult<()> {
    let pending = lock(&app.state::<AppState>().pending)
        .take_for_server(server_id)
        .ok_or_else(|| AppError::new(ErrorKind::CodeInvalid, "no sign-in in progress"))?;
    let result = finish(app, pending, code).await;
    report(app, server_id, &result);
    result
}

pub fn handle_deep_links(app: &AppHandle, links: Vec<Url>) {
    for url in links {
        match auth::parse_deep_link(&url) {
            Some(DeepLink::AuthCallback {
                code,
                state,
                server,
            }) => handle_callback(app, code, state, server),
            Some(DeepLink::Open { server, path }) => handle_open(app, &server, &path),
            Some(DeepLink::Download { id }) => crate::downloads::show(app, id.as_deref()),
            Some(DeepLink::NotificationAction { id, action }) => {
                crate::notification_actions::handle(app, id.as_deref(), action)
            }
            None => log::warn!("ignored a deep link the app does not understand"),
        }
    }
}

fn handle_callback(app: &AppHandle, code: String, sign_in_state: String, server: Option<String>) {
    let state = app.state::<AppState>();
    let Some(pending) = lock(&state.pending).take_by_state(&sign_in_state) else {
        log::warn!("ignored a sign-in callback with an unknown or used state");
        return;
    };
    // The callback names the server it came from; it must be the one asked.
    if let Some(named) = server.as_deref().and_then(urls::normalize_server_input) {
        let expected = state
            .server(&pending.server_id)
            .ok()
            .and_then(|server| server.api());
        if !expected.is_some_and(|api| urls::same_origin(&api, &named)) {
            log::warn!("ignored a sign-in callback from another server");
            report(
                app,
                &pending.server_id,
                &Err(AppError::new(ErrorKind::SignInFailed, "server mismatch")),
            );
            return;
        }
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let server_id = pending.server_id.clone();
        let result = finish(&app, pending, &code).await;
        report(&app, &server_id, &result);
    });
}

fn handle_open(app: &AppHandle, server: &str, path: &str) {
    let state = app.state::<AppState>();
    let found = urls::normalize_server_input(server)
        .and_then(|url| lock(&state.store).find_by_url(&url).cloned());
    match found {
        Some(server) => {
            let target = windows::web_url_for_path(&server, path)
                .map_or(windows::Target::None, windows::Target::InApp);
            windows::spawn_ui(app, move |app| {
                if let Err(error) = windows::open_server_window(app, &server, target) {
                    log::warn!("could not open a deep link: {}", error.message);
                }
            });
        }
        None => {
            // Never add a server from a link without asking: it may be a phishing server.
            let Some(address) = urls::normalize_server_input(server) else {
                return;
            };
            let address = address.to_string().trim_end_matches('/').to_string();
            *lock(&state.launcher_prompt) = Some(address.clone());
            windows::show_launcher(app);
            let _ = app.emit("deep-link-add-server", address);
        }
    }
}
