//! Shows the summed unread count: the dock badge on macOS, an overlay icon on
//! each taskbar button on Windows. Linux has no standard badge: the count
//! goes to the docks that read Unity's launcher API (Ubuntu Dock, Dash to
//! Dock, KDE Plasma's task manager, Plank) and next to the tray icon, where
//! the AppIndicator host shows it.

use tauri::{AppHandle, Manager};

use crate::state::AppState;

pub fn apply(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let total = state.total_unread();

    #[cfg(target_os = "macos")]
    if let Some(window) = app.webview_windows().values().next() {
        let _ = window.set_badge_count((total > 0).then_some(i64::from(total)));
    }

    #[cfg(windows)]
    {
        let text = crate::badge::badge_text(total);
        for window in app.webview_windows().values() {
            // Drawn for the window's own monitor scale, so it stays sharp.
            let icon = text.as_deref().map(|text| {
                let size = crate::badge::overlay_size(window.scale_factor().unwrap_or(1.0));
                tauri::image::Image::new_owned(crate::badge::overlay_rgba(text, size), size, size)
            });
            let _ = window.set_overlay_icon(icon);
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(tray) = app.tray_by_id(crate::menus::TRAY_ID) {
            let _ = tray.set_title(crate::badge::badge_text(total));
        }
        launcher_entry::update(total);
    }

    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    let _ = total;
}

/// The `com.canonical.Unity.LauncherEntry` signal. Docks match it to the
/// app by its .desktop file name, and drop the count when this connection
/// closes, so one session-bus connection stays open for the app's life.
#[cfg(target_os = "linux")]
mod launcher_entry {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{Mutex, OnceLock};

    use zbus::zvariant::Value;

    /// The .desktop file the .deb and .rpm install (the bundler names it
    /// after the product name).
    pub const APP_URI: &str = "application://Margaya.desktop";
    const PATH: &str = "/com/margaya/desktop/launcher";

    static LATEST: AtomicU32 = AtomicU32::new(u32::MAX);
    static CONNECTION: OnceLock<Option<zbus::blocking::Connection>> = OnceLock::new();
    static SENDING: Mutex<()> = Mutex::new(());

    /// Sends the count off the calling thread (D-Bus may block); a burst of
    /// changes sends only the newest.
    pub fn update(count: u32) {
        if LATEST.swap(count, Ordering::SeqCst) == count {
            return;
        }
        tauri::async_runtime::spawn_blocking(|| {
            let _sending = SENDING
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let count = LATEST.load(Ordering::SeqCst);
            let connection = CONNECTION.get_or_init(|| {
                zbus::blocking::Connection::session()
                    .map_err(|error| log::info!("no session bus for the dock badge: {error}"))
                    .ok()
            });
            let Some(connection) = connection else {
                return;
            };
            let sent = connection.emit_signal(
                None::<&str>,
                PATH,
                "com.canonical.Unity.LauncherEntry",
                "Update",
                &(APP_URI, properties(count)),
            );
            if let Err(error) = sent {
                log::debug!("could not update the dock badge: {error}");
            }
        });
    }

    pub fn properties(count: u32) -> HashMap<&'static str, Value<'static>> {
        HashMap::from([
            ("count", Value::from(i64::from(count))),
            ("count-visible", Value::from(count > 0)),
        ])
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn shows_the_count_only_when_there_is_one() {
            assert_eq!(properties(3)["count"], Value::from(3i64));
            assert_eq!(properties(3)["count-visible"], Value::from(true));
            assert_eq!(properties(0)["count-visible"], Value::from(false));
            assert_eq!(APP_URI, "application://Margaya.desktop");
        }
    }
}
