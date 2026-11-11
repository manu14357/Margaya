//! State shared by commands, deep links, sockets and menus.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicI32, AtomicU32, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use tauri::async_runtime::JoinHandle;

use url::Url;

use crate::auth::PendingSignIns;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::opener::RecentOpens;
use crate::routing::{AnnouncedPopups, ChromeState};
use crate::servers::{Server, ServerStore};

/// A server window showing the offline page.
#[derive(Debug, Clone)]
pub struct Offline {
    /// Where the window goes back to once the server answers.
    pub target: Url,
    /// The offline page's own address in this window.
    pub page: Url,
    pub error: ErrorKind,
    pub attempt: u32,
    /// The window's load (`WindowInfo::load_seq`) that failed.
    pub load: u64,
}

/// What the app tracks about each server or popup window, by label.
#[derive(Debug, Clone, Default)]
pub struct WindowInfo {
    /// The current page listens for `margaya:navigate`.
    pub navigate_ready: bool,
    /// The web UI in this window has said it draws the title bar; sticky,
    /// so a reload doesn't flash the native frame.
    pub web_title_bar: bool,
    /// The window waits, hidden, for its first page to load.
    pub pending_reveal: bool,
    /// The window was opened for a link that turned out to be a download.
    pub download_only: bool,
    pub downloads: u32,
    /// The last main-frame load that started, and a counter of loads.
    pub loading: Option<Url>,
    pub load_seq: u64,
    pub chrome: Option<ChromeState>,
    pub offline: Option<Offline>,
}

/// Where a click on a native notification goes (macOS and Linux; Windows
/// toasts carry their own link).
#[cfg_attr(windows, allow(dead_code))]
#[derive(Debug, Clone)]
pub struct NotificationTarget {
    pub server_id: String,
    pub url: Option<String>,
}

pub struct AppState {
    pub store: Mutex<ServerStore>,
    pub pending: Mutex<PendingSignIns>,
    pub sockets: Mutex<HashMap<String, JoinHandle<()>>>,
    /// Unread counts by server id; the badge shows their sum.
    pub unread: Mutex<HashMap<String, u32>>,
    notification_targets: Mutex<VecDeque<(i32, NotificationTarget)>>,
    next_notification_id: AtomicI32,
    /// A server address from a deep link, waiting for the launcher to ask.
    pub launcher_prompt: Mutex<Option<String>>,
    pub available_update: Mutex<Option<String>>,
    /// webviewSecret from each server's last token exchange, in memory only,
    /// until that server's window takes it once.
    pub handoff_secrets: Mutex<HashMap<String, String>>,
    pub http: reqwest::Client,
    /// Links opened outside the app in the last second, to drop repeats.
    pub opens: Mutex<RecentOpens>,
    /// Sign-in URLs announced through the bridge's `openSignInPopup`.
    pub announced_popups: Mutex<AnnouncedPopups>,
    pub windows: Mutex<HashMap<String, WindowInfo>>,
    /// The server window the person used last, for the tray and second launch.
    pub last_focused: Mutex<Option<String>>,
    /// When a native notification last made a sound (one per burst).
    pub last_alert_sound: Mutex<Option<std::time::Instant>>,
    /// Held while a server's main window is found or created.
    pub opening_windows: Mutex<()>,
    next_window: AtomicU32,
    next_navigation: AtomicU64,
}

/// Locks a mutex, recovering the data if another thread panicked with it.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

const KEPT_NOTIFICATION_TARGETS: usize = 200;

impl AppState {
    pub fn new(store: ServerStore, version: &str) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(format!("MargayaDesktop/{version}"))
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .build()
            .expect("failed to build the HTTP client");
        Self {
            store: Mutex::new(store),
            pending: Mutex::default(),
            sockets: Mutex::default(),
            unread: Mutex::default(),
            notification_targets: Mutex::default(),
            next_notification_id: AtomicI32::new(1),
            launcher_prompt: Mutex::default(),
            available_update: Mutex::default(),
            handoff_secrets: Mutex::default(),
            http,
            opens: Mutex::default(),
            announced_popups: Mutex::default(),
            windows: Mutex::default(),
            last_focused: Mutex::default(),
            last_alert_sound: Mutex::default(),
            opening_windows: Mutex::default(),
            next_window: AtomicU32::new(1),
            next_navigation: AtomicU64::new(1),
        }
    }

    pub fn server(&self, id: &str) -> AppResult<Server> {
        lock(&self.store)
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::internal("unknown server"))
    }

    pub fn servers(&self) -> Vec<Server> {
        lock(&self.store).list().to_vec()
    }

    /// A number for the next additional window or popup label.
    pub fn next_window_number(&self) -> u32 {
        self.next_window.fetch_add(1, Ordering::Relaxed)
    }

    pub fn next_navigation_id(&self) -> u64 {
        self.next_navigation.fetch_add(1, Ordering::Relaxed)
    }

    /// Changes what the app tracks about a window, creating the entry.
    pub fn with_window<T>(&self, label: &str, change: impl FnOnce(&mut WindowInfo) -> T) -> T {
        change(lock(&self.windows).entry(label.to_string()).or_default())
    }

    pub fn window_info(&self, label: &str) -> WindowInfo {
        lock(&self.windows).get(label).cloned().unwrap_or_default()
    }

    pub fn total_unread(&self) -> u32 {
        lock(&self.unread).values().sum()
    }

    /// Remembers where a notification's click goes and returns its id.
    #[cfg_attr(windows, allow(dead_code))]
    pub fn remember_notification(&self, target: NotificationTarget) -> i32 {
        let id = self.next_notification_id.fetch_add(1, Ordering::Relaxed);
        let mut targets = lock(&self.notification_targets);
        targets.push_back((id, target));
        while targets.len() > KEPT_NOTIFICATION_TARGETS {
            targets.pop_front();
        }
        id
    }

    #[cfg_attr(windows, allow(dead_code))]
    pub fn notification_target(&self, id: i32) -> Option<NotificationTarget> {
        lock(&self.notification_targets)
            .iter()
            .find(|(known, _)| *known == id)
            .map(|(_, target)| target.clone())
    }
}
