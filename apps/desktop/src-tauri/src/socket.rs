//! One background user socket per signed-in server (`/api/ws/user` with the
//! keychain bearer token). Hints carry ids only; the core fetches the text of
//! a new notification and shows it natively, and refreshes the badge. While
//! quiet hours or focus mode hold desktop alerts the server leaves the id
//! out, and one summary alert follows when they end.

use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::{HeaderValue, AUTHORIZATION};
use tokio_tungstenite::tungstenite::{Error as WsError, Message};
use url::Url;

use crate::api;
use crate::error::ErrorKind;
use crate::servers::Server;
use crate::state::{lock, AppState, NotificationTarget};
use crate::{badge_view, i18n, notify, tokens, urls};

const KEEPALIVE: Duration = Duration::from_secs(25);
const PING: &str = r#"{"type":"ping"}"#;
/// Unread refreshes wait until the hints pause this long, so a burst (a
/// bulk read, many mentions at once) costs one refresh...
const REFRESH_QUIET: Duration = Duration::from_millis(500);
/// ...but no longer than this after the first hint of a burst.
const REFRESH_MAX_WAIT: Duration = Duration::from_secs(3);
/// A connection that stayed up this long starts the reconnect delays over;
/// one that drops sooner keeps backing off.
const STABLE_AFTER: Duration = Duration::from_secs(30);

/// Reconnect delay: 1, 2, 4 ... seconds, capped at 60, plus up to a quarter
/// of jitter so many clients don't return at once after an outage.
pub fn backoff(attempt: u32, jitter_fraction: f64) -> Duration {
    let base = 2u64.saturating_pow(attempt.min(6)).min(60);
    let jitter = (base as f64 * 0.25 * jitter_fraction.clamp(0.0, 1.0) * 1000.0) as u64;
    Duration::from_millis(base * 1000 + jitter)
}

/// The next reconnect attempt: back to the first delay after a connection
/// that stayed up [`STABLE_AFTER`], else one step further.
pub fn next_attempt(attempt: u32, stayed_up: Option<Duration>) -> u32 {
    match stayed_up {
        Some(up) if up >= STABLE_AFTER => 1,
        _ => attempt.saturating_add(1),
    }
}

/// When a burst of refresh requests is answered: once they pause for
/// `quiet`, and no later than `max_wait` after the first.
pub fn refresh_due(first: Instant, last: Instant, quiet: Duration, max_wait: Duration) -> Instant {
    (last + quiet).min(first + max_wait)
}

/// The badge and the launcher change only when a count did.
pub fn unread_changed(previous: Option<u32>, now: u32) -> bool {
    previous != Some(now)
}

fn jitter() -> f64 {
    let mut byte = [0u8; 1];
    let _ = getrandom::fill(&mut byte);
    f64::from(byte[0]) / 255.0
}

/// The user socket URL for an API base (http → ws, https → wss).
pub fn socket_url(api: &Url) -> Option<Url> {
    let mut url = urls::join_path(api, "/api/ws/user");
    let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
    url.set_scheme(scheme).ok()?;
    Some(url)
}

/// What a socket message asks the core to do.
#[derive(Debug, PartialEq, Eq)]
pub enum Hint {
    NotificationCreated(Option<String>),
    NotificationsUpdated,
    /// Quiet hours or focus mode ended; this many alerts were held back.
    NotificationsReleased(u64),
    Other,
}

pub fn read_hint(text: &str) -> Hint {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return Hint::Other;
    };
    match value.get("type").and_then(Value::as_str) {
        Some("NOTIFICATION_CREATED") => Hint::NotificationCreated(
            value
                .get("notificationId")
                .and_then(Value::as_str)
                .map(str::to_string),
        ),
        Some("NOTIFICATIONS_UPDATED") => Hint::NotificationsUpdated,
        Some("NOTIFICATIONS_RELEASED") => {
            Hint::NotificationsReleased(value.get("count").and_then(Value::as_u64).unwrap_or(0))
        }
        _ => Hint::Other,
    }
}

pub fn start(app: &AppHandle, server_id: &str) {
    stop(app, server_id);
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let handle = tauri::async_runtime::spawn(run(app.clone(), server_id.to_string()));
    lock(&state.sockets).insert(server_id.to_string(), handle);
}

pub fn stop(app: &AppHandle, server_id: &str) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    if let Some(handle) = lock(&state.sockets).remove(server_id) {
        handle.abort();
    }
    lock(&state.unread).remove(server_id);
    badge_view::apply(app);
}

enum Ended {
    /// The server refused the token: the user is signed out there.
    Unauthorized,
    /// With how long the connection was up, if it opened at all.
    Closed(Option<Duration>),
}

async fn run(app: AppHandle, server_id: String) {
    let mut attempt = 0u32;
    loop {
        let Some(server) = app.state::<AppState>().server(&server_id).ok() else {
            return;
        };
        let Some(token) = tokens::get(&server_id) else {
            return;
        };
        match connect(&app, &server, &token).await {
            Ended::Unauthorized => {
                log::info!("a server refused the stored token; signing out locally");
                app.state::<AppState>().mark_signed_out(&server_id);
                // Revoked (by the person elsewhere or an admin): a window's
                // session doesn't quietly sign the app back in.
                let _ = lock(&app.state::<AppState>().store).set_link_paused(&server_id, true);
                tokens::delete(&server_id);
                crate::search_window::forget_server(&server_id);
                crate::menus::forget_server(&app, &server_id);
                lock(&app.state::<AppState>().unread).remove(&server_id);
                badge_view::apply(&app);
                let _ = app.emit("servers-changed", ());
                crate::menus::refresh_tray(&app);
                return;
            }
            Ended::Closed(stayed_up) => attempt = next_attempt(attempt, stayed_up),
        }
        tokio::time::sleep(backoff(attempt, jitter())).await;
    }
}

async fn connect(app: &AppHandle, server: &Server, token: &str) -> Ended {
    let Some(url) = server.api().as_ref().and_then(socket_url) else {
        return Ended::Closed(None);
    };
    let Ok(mut request) = url.as_str().into_client_request() else {
        return Ended::Closed(None);
    };
    let Ok(header) = HeaderValue::from_str(&format!("Bearer {token}")) else {
        return Ended::Closed(None);
    };
    // No Origin header: the API lets native clients in on the bearer token.
    request.headers_mut().insert(AUTHORIZATION, header);

    let stream = match tokio_tungstenite::connect_async(request).await {
        Ok((stream, _)) => stream,
        Err(WsError::Http(response)) if response.status().as_u16() == 401 => {
            return Ended::Unauthorized
        }
        Err(error) => {
            log::warn!("user socket connect failed: {error}");
            return Ended::Closed(None);
        }
    };
    let opened = Instant::now();
    log::info!("user socket connected");
    // Unread refreshes go to the refresher, so a slow API never holds up
    // the next hint; it stops with this connection.
    let refresher = Refresher::start(app, server, token);
    refresher.request();
    let up = || Ended::Closed(Some(opened.elapsed()));

    let (mut write, mut read) = stream.split();
    let mut keepalive = tokio::time::interval(KEEPALIVE);
    keepalive.tick().await;
    loop {
        tokio::select! {
            message = read.next() => match message {
                Some(Ok(Message::Text(text))) => match read_hint(text.as_str()) {
                    Hint::NotificationCreated(id) => {
                        if let Some(id) = id {
                            show_notification(app, server, token, &id).await;
                        }
                        refresher.request();
                    }
                    Hint::NotificationsUpdated => refresher.request(),
                    Hint::NotificationsReleased(count) => {
                        if count > 0 {
                            show_release_summary(app, server, count);
                        }
                        refresher.request();
                    }
                    Hint::Other => {}
                },
                Some(Ok(Message::Close(_))) | None => return up(),
                Some(Ok(_)) => {}
                Some(Err(error)) => {
                    log::warn!("user socket error: {error}");
                    return up();
                }
            },
            _ = keepalive.tick() => {
                if write.send(Message::text(PING)).await.is_err() {
                    return up();
                }
            }
        }
    }
}

/// One connection's unread refreshes, with a trailing debounce: requests
/// that come in while one waits (or runs) fold into the next refresh.
/// Stops with the connection.
struct Refresher {
    requests: tokio::sync::mpsc::UnboundedSender<()>,
    task: tauri::async_runtime::JoinHandle<()>,
}

impl Refresher {
    fn start(app: &AppHandle, server: &Server, token: &str) -> Self {
        let (requests, mut received) = tokio::sync::mpsc::unbounded_channel::<()>();
        let (app, server, token) = (app.clone(), server.clone(), token.to_string());
        let task = tauri::async_runtime::spawn(async move {
            while received.recv().await.is_some() {
                let first = Instant::now();
                let mut last = first;
                loop {
                    let due = refresh_due(first, last, REFRESH_QUIET, REFRESH_MAX_WAIT);
                    tokio::select! {
                        more = received.recv() => match more {
                            Some(()) => last = Instant::now(),
                            None => return,
                        },
                        () = tokio::time::sleep_until(due.into()) => break,
                    }
                }
                refresh_unread(&app, &server, &token).await;
            }
        });
        Self { requests, task }
    }

    fn request(&self) {
        let _ = self.requests.send(());
    }
}

impl Drop for Refresher {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub async fn refresh_unread(app: &AppHandle, server: &Server, token: &str) {
    let state = app.state::<AppState>();
    match api::unread_count(&state.http, server, token).await {
        Ok(count) => {
            let previous = lock(&state.unread).insert(server.id.clone(), count);
            if unread_changed(previous, count) {
                badge_view::apply(app);
                let _ = app.emit("servers-changed", ());
            }
        }
        Err(error) if error.kind == ErrorKind::NotSignedIn => {}
        Err(error) => log::warn!("unread count unavailable: {}", error.message),
    }
}

/// Fetches one notification's text and shows it natively. Nothing while the
/// person paused notifications in the app (the badge still updates).
pub(crate) async fn show_notification(app: &AppHandle, server: &Server, token: &str, id: &str) {
    if crate::pause::is_paused(app) {
        log::info!("notification not shown: notifications are paused");
        return;
    }
    let state = app.state::<AppState>();
    let notification = match api::desktop_notification(&state.http, server, token, id).await {
        Ok(notification) => notification,
        Err(error) => {
            log::warn!("notification text unavailable: {}", error.message);
            return;
        }
    };
    if notification.held {
        log::info!("notification held by quiet time");
        return;
    }
    // Only a page on this server may be opened from a click.
    let url = notification
        .url
        .and_then(|raw| Url::parse(&raw).ok())
        .filter(|url| server.owns(url));
    // The server list holds this device's mute; read it fresh.
    let server = state.server(&server.id).unwrap_or_else(|_| server.clone());
    let sound = notify::sound_for(app, &server, notification.sound);
    let tone = (sound == notify::Sound::On).then(|| {
        crate::sound::Tone::from_server(notification.sound_name.as_deref(), notification.volume)
    });
    match tone {
        Some(tone) => log::info!(
            "showing a notification (sound: {sound:?}, {:?} at {})",
            tone.id,
            tone.volume
        ),
        None => log::info!("showing a notification (sound: {sound:?})"),
    }
    // Buttons only for a task the server names, as far as it says they apply.
    let offer = notification.task_id.map(|task_id| notify::ActionOffer {
        notification_id: id.to_string(),
        task_id,
        actions: crate::notification_actions::offered(&notification.actions, url.is_some()),
    });
    let alert = notify::Alert {
        server_id: server.id.clone(),
        server_label: server.label.clone(),
        title: notification.title,
        body: notification.body,
        url,
        tag: notification.tag.unwrap_or_else(|| id.to_string()),
        sound: tone,
    };
    notify::show_with_actions(app, &server, alert, offer);
}

/// One silent alert when the user's quiet hours or focus mode end, for the
/// alerts the server held back meanwhile (it sends no id for those). A
/// click opens the server's window.
fn show_release_summary(app: &AppHandle, server: &Server, count: u64) {
    if crate::pause::is_paused(app) {
        log::info!("quiet-time summary not shown: notifications are paused");
        return;
    }
    let state = app.state::<AppState>();
    let server = state.server(&server.id).unwrap_or_else(|_| server.clone());
    log::info!("showing the quiet-time summary");
    let alert = notify::Alert {
        server_id: server.id.clone(),
        server_label: server.label.clone(),
        title: i18n::t("notifications.releasedTitle"),
        body: i18n::tv(
            "notifications.releasedBody",
            &[("count", &count.to_string())],
        ),
        url: None,
        tag: "margaya-quiet-summary".to_string(),
        sound: None,
    };
    notify::show(app, &server, alert);
}

/// A click on a native notification (macOS and Linux) opens its URL in that
/// server's window, or shows a download in its folder. Windows toasts open
/// their `margaya://open` or `margaya://download` link instead.
#[cfg_attr(windows, allow(dead_code))]
pub fn on_notification_click(app: &AppHandle, local_id: i32) {
    let state = app.state::<AppState>();
    let (server_id, url) = match state.notification_target(local_id) {
        Some(NotificationTarget::Page { server_id, url }) => (server_id, url),
        Some(NotificationTarget::Download { id }) => {
            crate::downloads::show(app, id.as_deref());
            return;
        }
        None => return,
    };
    let Ok(server) = state.server(&server_id) else {
        return;
    };
    let target = url
        .and_then(|raw| Url::parse(&raw).ok())
        .map_or(crate::windows::Target::None, crate::windows::Target::InApp);
    crate::windows::spawn_ui(app, move |app| {
        if let Err(error) = crate::windows::open_server_window(app, &server, target) {
            log::warn!("could not open a notification: {}", error.message);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backs_off_exponentially_with_a_cap() {
        assert_eq!(backoff(0, 0.0), Duration::from_secs(1));
        assert_eq!(backoff(1, 0.0), Duration::from_secs(2));
        assert_eq!(backoff(3, 0.0), Duration::from_secs(8));
        assert_eq!(backoff(6, 0.0), Duration::from_secs(60));
        assert_eq!(backoff(40, 0.0), Duration::from_secs(60));
        assert_eq!(backoff(1, 1.0), Duration::from_millis(2500));
        assert_eq!(backoff(40, 1.0), Duration::from_secs(75));
    }

    #[test]
    fn starts_the_delays_over_only_after_a_connection_that_held() {
        // Never connected, or dropped right after opening: keep backing off.
        assert_eq!(next_attempt(0, None), 1);
        assert_eq!(next_attempt(3, None), 4);
        assert_eq!(next_attempt(3, Some(Duration::from_millis(200))), 4);
        assert_eq!(next_attempt(5, Some(Duration::from_secs(29))), 6);
        assert_eq!(next_attempt(u32::MAX, None), u32::MAX);
        // Stayed up: the next try comes after the first delay again.
        assert_eq!(next_attempt(5, Some(STABLE_AFTER)), 1);
        assert_eq!(next_attempt(0, Some(Duration::from_secs(600))), 1);
        assert_eq!(backoff(next_attempt(5, Some(STABLE_AFTER)), 0.0), Duration::from_secs(2));
    }

    #[test]
    fn answers_a_burst_of_hints_once_it_pauses() {
        let first = Instant::now();
        let quiet = Duration::from_millis(500);
        let max = Duration::from_secs(3);
        assert_eq!(refresh_due(first, first, quiet, max), first + quiet);
        // Each new hint pushes the refresh back...
        let later = first + Duration::from_millis(400);
        assert_eq!(refresh_due(first, later, quiet, max), later + quiet);
        // ...but never past the longest wait.
        let much_later = first + Duration::from_millis(2900);
        assert_eq!(refresh_due(first, much_later, quiet, max), first + max);
    }

    #[test]
    fn redraws_only_when_a_count_changed() {
        assert!(unread_changed(None, 0));
        assert!(unread_changed(Some(2), 3));
        assert!(!unread_changed(Some(3), 3));
        assert!(!unread_changed(Some(0), 0));
    }

    #[test]
    fn builds_the_socket_url() {
        let url = |raw: &str| socket_url(&Url::parse(raw).unwrap()).unwrap().to_string();
        assert_eq!(url("https://api.example"), "wss://api.example/api/ws/user");
        assert_eq!(
            url("http://localhost:1337"),
            "ws://localhost:1337/api/ws/user"
        );
        assert_eq!(
            url("https://example.com/margaya"),
            "wss://example.com/margaya/api/ws/user"
        );
    }

    #[test]
    fn reads_socket_hints() {
        assert_eq!(
            read_hint(
                r#"{"type":"NOTIFICATION_CREATED","notificationId":"n1","notificationType":"task_comment"}"#
            ),
            Hint::NotificationCreated(Some("n1".into()))
        );
        assert_eq!(
            read_hint(r#"{"type":"NOTIFICATION_CREATED"}"#),
            Hint::NotificationCreated(None)
        );
        assert_eq!(
            read_hint(r#"{"type":"NOTIFICATIONS_UPDATED","workspaceId":null}"#),
            Hint::NotificationsUpdated
        );
        assert_eq!(
            read_hint(r#"{"type":"NOTIFICATIONS_RELEASED","count":3}"#),
            Hint::NotificationsReleased(3)
        );
        assert_eq!(
            read_hint(r#"{"type":"NOTIFICATIONS_RELEASED"}"#),
            Hint::NotificationsReleased(0)
        );
        assert_eq!(read_hint(r#"{"type":"TASK_UPDATED"}"#), Hint::Other);
        assert_eq!(read_hint("pong"), Hint::Other);
    }
}
