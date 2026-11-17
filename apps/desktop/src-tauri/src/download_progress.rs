//! Download progress on the app's icon while server windows download: the
//! taskbar buttons on Windows, the Dock icon on macOS, and on Linux the
//! docks that read Unity's launcher API (the same signal as the unread
//! badge). Several downloads at once show their combined bytes; it clears
//! when the last one finishes or fails.
//!
//! - Windows: WebView2's download operations report their bytes.
//! - Linux: WebKitGTK's downloads report theirs.
//! - macOS: only the start and the end are known (`on_download`), so the
//!   Dock shows a bar without a value while downloads run.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::AppHandle;

use crate::state::lock;

/// A transfer that hasn't reported for this long (its window went away
/// mid-download) no longer holds the bar up once another download starts.
const STALE: Duration = Duration::from_secs(10 * 60);

/// What the icon shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shown {
    Hidden,
    /// Downloads run, but their combined size isn't known.
    Indeterminate,
    Percent(u8),
}

#[derive(Debug, Clone, Copy)]
struct Transfer {
    received: u64,
    /// None until known (no Content-Length, or not reported yet).
    total: Option<u64>,
    updated: Instant,
}

/// The running downloads, by an id their source gives them.
#[derive(Debug, Default)]
pub struct Transfers {
    running: BTreeMap<u64, Transfer>,
}

impl Transfers {
    pub const fn new() -> Self {
        Self {
            running: BTreeMap::new(),
        }
    }

    pub fn start(&mut self, id: u64, now: Instant) {
        self.running
            .retain(|_, transfer| now.saturating_duration_since(transfer.updated) < STALE);
        self.running.insert(
            id,
            Transfer {
                received: 0,
                total: None,
                updated: now,
            },
        );
    }

    /// Bytes so far, and the size when known (0 means unknown).
    pub fn update(&mut self, id: u64, received: u64, total: Option<u64>, now: Instant) {
        if let Some(transfer) = self.running.get_mut(&id) {
            transfer.received = received;
            transfer.total = total.filter(|total| *total > 0);
            transfer.updated = now;
        }
    }

    pub fn end(&mut self, id: u64) {
        self.running.remove(&id);
    }

    /// The combined bytes of every running download, as a percentage; one
    /// without a known size makes the whole indeterminate.
    pub fn shown(&self) -> Shown {
        if self.running.is_empty() {
            return Shown::Hidden;
        }
        let mut received: u128 = 0;
        let mut total: u128 = 0;
        for transfer in self.running.values() {
            let Some(size) = transfer.total else {
                return Shown::Indeterminate;
            };
            received += u128::from(transfer.received.min(size));
            total += u128::from(size);
        }
        Shown::Percent((received * 100 / total).min(100) as u8)
    }
}

static TRANSFERS: Mutex<Transfers> = Mutex::new(Transfers::new());
/// The newest state asked for, and the one the icons show.
static REQUESTED: Mutex<Shown> = Mutex::new(Shown::Hidden);
static APPLIED: Mutex<Shown> = Mutex::new(Shown::Hidden);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// A fresh id for a download whose source has none of its own.
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub fn next_id() -> u64 {
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

pub fn started(app: &AppHandle, id: u64) {
    lock(&TRANSFERS).start(id, Instant::now());
    refresh(app);
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
pub fn progressed(app: &AppHandle, id: u64, received: u64, total: Option<u64>) {
    lock(&TRANSFERS).update(id, received, total, Instant::now());
    refresh(app);
}

pub fn ended(app: &AppHandle, id: u64) {
    lock(&TRANSFERS).end(id);
    refresh(app);
}

/// Called from webview callbacks on the UI thread, often (every chunk): it
/// only notes the new state, and a worker shows the newest one, so a burst
/// of updates shows once and an older update never wins over a newer one.
fn refresh(app: &AppHandle) {
    let shown = lock(&TRANSFERS).shown();
    {
        let mut requested = lock(&REQUESTED);
        if *requested == shown {
            return;
        }
        *requested = shown;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut applied = lock(&APPLIED);
        let latest = *lock(&REQUESTED);
        if *applied != latest {
            *applied = latest;
            show(&app, latest);
        }
    });
}

#[cfg(any(windows, target_os = "macos"))]
fn bar_state(shown: Shown) -> tauri::window::ProgressBarState {
    use tauri::window::{ProgressBarState, ProgressBarStatus};
    match shown {
        Shown::Hidden => ProgressBarState {
            status: Some(ProgressBarStatus::None),
            progress: None,
        },
        Shown::Indeterminate => ProgressBarState {
            status: Some(ProgressBarStatus::Indeterminate),
            progress: None,
        },
        Shown::Percent(percent) => ProgressBarState {
            status: Some(ProgressBarStatus::Normal),
            progress: Some(u64::from(percent)),
        },
    }
}

fn show(app: &AppHandle, shown: Shown) {
    // Each taskbar button has its own bar: every server window shows it.
    #[cfg(windows)]
    {
        use tauri::Manager;
        for (label, window) in app.webview_windows() {
            if is_server_window(&label) {
                let _ = window.set_progress_bar(bar_state(shown));
            }
        }
    }
    // One Dock icon for the whole app.
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        if let Some(window) = app.webview_windows().values().next() {
            let _ = window.set_progress_bar(bar_state(shown));
        }
    }
    // Unity's launcher API has no indeterminate bar: none until a size is known.
    #[cfg(target_os = "linux")]
    {
        let _ = app;
        crate::badge_view::show_progress(match shown {
            Shown::Percent(percent) => Some(f64::from(percent) / 100.0),
            Shown::Hidden | Shown::Indeterminate => None,
        });
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    let _ = (app, shown);
}

#[cfg_attr(not(windows), allow(dead_code))]
fn is_server_window(label: &str) -> bool {
    use crate::servers::{parse_window_label, WindowKind};
    matches!(
        parse_window_label(label),
        Some(WindowKind::Primary(_) | WindowKind::Secondary(..))
    )
}

/// macOS: a download from `on_download`, by its window and URL.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn key(label: &str, url: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    (label, url).hash(&mut hasher);
    // Apart from the ids `next_id` hands out.
    hasher.finish() | (1 << 63)
}

/// Follows the bytes of every download a server window starts (WebView2's
/// download operations).
#[cfg(windows)]
pub fn watch(app: &AppHandle, window: &tauri::WebviewWindow) {
    use ::windows::core::{Interface, BOOL};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2DownloadOperation, ICoreWebView2_4, COREWEBVIEW2_DOWNLOAD_STATE,
        COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS,
    };
    use webview2_com::{
        BytesReceivedChangedEventHandler, DownloadStartingEventHandler, StateChangedEventHandler,
    };

    fn report(app: &AppHandle, id: u64, operation: &ICoreWebView2DownloadOperation) {
        let mut received: i64 = 0;
        let mut total: i64 = 0;
        // SAFETY: two out-parameters of a live download operation.
        let read = unsafe {
            operation
                .BytesReceived(&mut received)
                .and_then(|()| operation.TotalBytesToReceive(&mut total))
        };
        if read.is_ok() {
            let total = u64::try_from(total).ok().filter(|total| *total > 0);
            progressed(app, id, u64::try_from(received).unwrap_or(0), total);
        }
    }

    let app = app.clone();
    let result = window.with_webview(move |webview| {
        let handler = DownloadStartingEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            // wry's own handler ran first and may have refused it.
            let mut cancel = BOOL::default();
            // SAFETY: reading the event's own arguments.
            let operation = unsafe {
                args.Cancel(&mut cancel)?;
                if cancel.as_bool() {
                    return Ok(());
                }
                args.DownloadOperation()?
            };
            let id = next_id();
            started(&app, id);
            let bytes_app = app.clone();
            let bytes = BytesReceivedChangedEventHandler::create(Box::new(move |operation, _| {
                if let Some(operation) = operation {
                    report(&bytes_app, id, &operation);
                }
                Ok(())
            }));
            let state_app = app.clone();
            let state = StateChangedEventHandler::create(Box::new(move |operation, _| {
                let Some(operation) = operation else {
                    return Ok(());
                };
                let mut state = COREWEBVIEW2_DOWNLOAD_STATE::default();
                // SAFETY: an out-parameter of a live download operation.
                unsafe { operation.State(&mut state)? };
                // Completed, or interrupted (failed, cancelled): either way over.
                if state != COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS {
                    ended(&state_app, id);
                }
                Ok(())
            }));
            let mut token: i64 = 0;
            // SAFETY: subscribing to the operation this event hands over.
            let added = unsafe {
                operation
                    .add_BytesReceivedChanged(&bytes, &mut token)
                    .and_then(|()| operation.add_StateChanged(&state, &mut token))
            };
            match added {
                Ok(()) => report(&app, id, &operation),
                Err(error) => {
                    log::debug!("could not follow a download's progress: {error}");
                    ended(&app, id);
                }
            }
            Ok(())
        }));
        let mut token: i64 = 0;
        // SAFETY: the controller belongs to this live webview, on its own thread.
        let added = unsafe {
            webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.cast::<ICoreWebView2_4>())
                .and_then(|core| core.add_DownloadStarting(&handler, &mut token))
        };
        if let Err(error) = added {
            log::warn!("could not follow a server window's downloads: {error}");
        }
    });
    if let Err(error) = result {
        log::warn!("could not follow a server window's downloads: {error}");
    }
}

/// Follows the bytes of every download a server's web context starts
/// (WebKitGTK). The windows of one server share a context: it is watched once.
#[cfg(target_os = "linux")]
pub fn watch(app: &AppHandle, window: &tauri::WebviewWindow) {
    let app = app.clone();
    let result = window.with_webview(move |webview| {
        use webkit2gtk::glib::prelude::ObjectExt;
        use webkit2gtk::{DownloadExt, URIResponseExt, WebContextExt, WebViewExt};

        const WATCHED: &str = "margaya-download-progress";
        let Some(context) = webview.inner().context() else {
            return;
        };
        // SAFETY: only this function sets or reads this key, always as a bool.
        unsafe {
            if context.data::<bool>(WATCHED).is_some() {
                return;
            }
            context.set_data(WATCHED, true);
        }
        context.connect_download_started(move |_, download| {
            let id = next_id();
            started(&app, id);
            let data_app = app.clone();
            #[allow(deprecated)] // received-data: still emitted, and carries the count
            download.connect_received_data(move |download, _| {
                let total = download
                    .response()
                    .map(|response| response.content_length())
                    .filter(|total| *total > 0);
                progressed(&data_app, id, download.received_data_length(), total);
            });
            // Also after "failed": a failed or cancelled download finishes too.
            let end_app = app.clone();
            download.connect_finished(move |_| ended(&end_app, id));
        });
    });
    if let Err(error) = result {
        log::warn!("could not follow a server window's downloads: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shows_nothing_without_downloads() {
        assert_eq!(Transfers::new().shown(), Shown::Hidden);
    }

    #[test]
    fn combines_the_bytes_of_every_download() {
        let now = Instant::now();
        let mut transfers = Transfers::new();
        transfers.start(1, now);
        // Size not known yet.
        assert_eq!(transfers.shown(), Shown::Indeterminate);
        transfers.update(1, 25, Some(100), now);
        assert_eq!(transfers.shown(), Shown::Percent(25));
        transfers.start(2, now);
        transfers.update(2, 0, Some(300), now);
        // 25 of 400 bytes.
        assert_eq!(transfers.shown(), Shown::Percent(6));
        transfers.update(2, 300, Some(300), now);
        assert_eq!(transfers.shown(), Shown::Percent(81));
        transfers.end(1);
        assert_eq!(transfers.shown(), Shown::Percent(100));
        transfers.end(2);
        assert_eq!(transfers.shown(), Shown::Hidden);
        // Ending an unknown or ended download changes nothing.
        transfers.end(2);
        assert_eq!(transfers.shown(), Shown::Hidden);
    }

    #[test]
    fn an_unknown_size_makes_the_whole_indeterminate() {
        let now = Instant::now();
        let mut transfers = Transfers::new();
        transfers.start(1, now);
        transfers.update(1, 50, Some(100), now);
        transfers.start(2, now);
        // No Content-Length: 0 means unknown.
        transfers.update(2, 10, Some(0), now);
        assert_eq!(transfers.shown(), Shown::Indeterminate);
        transfers.end(2);
        assert_eq!(transfers.shown(), Shown::Percent(50));
    }

    #[test]
    fn never_shows_past_full_or_overflows() {
        let now = Instant::now();
        let mut transfers = Transfers::new();
        transfers.start(1, now);
        transfers.update(1, 500, Some(100), now);
        assert_eq!(transfers.shown(), Shown::Percent(100));
        transfers.start(2, now);
        transfers.update(2, u64::MAX / 2, Some(u64::MAX), now);
        transfers.update(1, u64::MAX, Some(u64::MAX), now);
        assert_eq!(transfers.shown(), Shown::Percent(74));
        // An update for a download that isn't running is ignored.
        transfers.update(9, 1, Some(1), now);
        transfers.end(1);
        transfers.end(2);
        assert_eq!(transfers.shown(), Shown::Hidden);
    }

    #[test]
    fn drops_downloads_that_stopped_reporting() {
        let then = Instant::now();
        let mut transfers = Transfers::new();
        transfers.start(1, then);
        transfers.start(2, then + STALE - Duration::from_secs(1));
        transfers.update(2, 1, Some(2), then + STALE - Duration::from_secs(1));
        // A new download clears the one silent for too long, not the other.
        transfers.start(3, then + STALE);
        transfers.update(3, 1, Some(2), then + STALE);
        assert_eq!(transfers.shown(), Shown::Percent(50));
    }

    #[test]
    fn keys_mac_downloads_apart_from_counted_ids() {
        let key = key("server-a", "https://x/a");
        assert_eq!(key, super::key("server-a", "https://x/a"));
        assert_ne!(key, super::key("server-a-2", "https://x/a"));
        assert!(key >= 1 << 63);
        assert!(next_id() < 1 << 63);
    }
}
