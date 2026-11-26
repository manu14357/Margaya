//! Shows the summed unread count: the dock badge on macOS, an overlay icon on
//! each taskbar button on Windows. Linux has no standard badge: the count
//! goes to the docks that read Unity's launcher API (Ubuntu Dock, Dash to
//! Dock, KDE Plasma's task manager, Plank) and next to the tray icon, where
//! the AppIndicator host shows it.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use tauri::{AppHandle, Manager};

use crate::state::{lock, AppState};

/// What the badge shows now: the total, and on Windows the server windows
/// whose taskbar button has the overlay, by the scale it was drawn for.
#[derive(Debug, Default)]
struct Drawn {
    total: Option<u32>,
    windows: HashMap<String, f64>,
}

static DRAWN: LazyLock<Mutex<Drawn>> = LazyLock::new(Mutex::default);

/// The windows whose overlay must be drawn: every one when the total
/// changed, else only those that are new or now on a monitor of another
/// scale.
#[cfg_attr(not(windows), allow(dead_code))]
fn windows_to_draw(drawn: &Drawn, total: u32, windows: &[(String, f64)]) -> Vec<String> {
    let changed = drawn.total != Some(total);
    windows
        .iter()
        .filter(|(label, scale)| changed || drawn.windows.get(label) != Some(scale))
        .map(|(label, _)| label.clone())
        .collect()
}

/// A destroyed window's label may come back on a new window, which then
/// needs its own overlay.
pub fn forget_window(label: &str) {
    lock(&DRAWN).windows.remove(label);
}

pub fn apply(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    // The tray lists each server's own count.
    crate::menus::unread_changed(app);

    // Only server windows carry the count; hidden ones too, since showing a
    // window doesn't redraw it. Their scales are read before taking the
    // lock: a getter waits for the main thread, which may be waiting here.
    #[cfg(windows)]
    let windows: Vec<(String, tauri::WebviewWindow, f64)> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| crate::servers::id_from_window_label(label).is_some())
        .map(|(label, window)| {
            let scale = window.scale_factor().unwrap_or(1.0);
            (label, window, scale)
        })
        .collect();

    // Held while drawing (the setters only post to the main thread), so a
    // slower caller can't draw an older count over a newer one.
    let mut drawn = lock(&DRAWN);
    let total = state.total_unread();
    let changed = drawn.total != Some(total);

    // The Dock badge is the app's, set through any window. With none open
    // yet (the count arrived before the first window), it isn't marked as
    // shown, so the next apply (a window opening calls it) sets it.
    #[cfg(target_os = "macos")]
    let shown = !changed
        || app.webview_windows().values().next().is_some_and(|window| {
            window
                .set_badge_count((total > 0).then_some(i64::from(total)))
                .is_ok()
        });

    #[cfg(windows)]
    {
        let scales: Vec<(String, f64)> = windows
            .iter()
            .map(|(label, _, scale)| (label.clone(), *scale))
            .collect();
        let todo = windows_to_draw(&drawn, total, &scales);
        let text = crate::badge::badge_text(total);
        for (label, window, scale) in &windows {
            if !todo.contains(label) {
                continue;
            }
            // Drawn for the window's own monitor scale, so it stays sharp.
            let icon = text.as_deref().map(|text| {
                let size = crate::badge::overlay_size(*scale);
                tauri::image::Image::new_owned(crate::badge::overlay_rgba(text, size), size, size)
            });
            let _ = window.set_overlay_icon(icon);
        }
        drawn.windows = scales.into_iter().collect();
    }

    #[cfg(target_os = "macos")]
    if shown {
        drawn.total = Some(total);
    }
    #[cfg(not(target_os = "macos"))]
    {
        drawn.total = Some(total);
    }
    drop(drawn);

    // The tray call waits for the main thread: outside the lock.
    #[cfg(target_os = "linux")]
    if changed {
        if let Some(tray) = app.tray_by_id(crate::menus::TRAY_ID) {
            let _ = tray.set_title(crate::badge::badge_text(total));
        }
        launcher_entry::update(total);
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let _ = changed;
}

/// Linux: download progress (0 to 1) on the docks that show the count, or
/// none (download_progress.rs). Blocking: call it off the UI thread.
#[cfg(target_os = "linux")]
pub fn show_progress(value: Option<f64>) {
    launcher_entry::progress(value);
}

/// The `com.canonical.Unity.LauncherEntry` signal. Docks match it to the
/// app by its .desktop file name, and drop the count when this connection
/// closes, so one session-bus connection stays open for the app's life.
#[cfg(test)]
mod tests {
    use super::*;

    fn windows(list: &[(&str, f64)]) -> Vec<(String, f64)> {
        list.iter().map(|(label, scale)| (label.to_string(), *scale)).collect()
    }

    #[test]
    fn redraws_only_what_changed() {
        let open = windows(&[("server-a", 1.0), ("server-b", 1.5)]);
        let mut drawn = Drawn::default();
        assert_eq!(windows_to_draw(&drawn, 0, &open), ["server-a", "server-b"]);

        drawn.total = Some(3);
        drawn.windows = open.iter().cloned().collect();
        // Same count, same windows: nothing to touch.
        assert!(windows_to_draw(&drawn, 3, &open).is_empty());
        // A new count: every window.
        assert_eq!(windows_to_draw(&drawn, 4, &open), ["server-a", "server-b"]);
        // A new window, or one moved to another scale: only that one.
        let moved = windows(&[("server-a", 2.0), ("server-b", 1.5), ("server-c", 1.0)]);
        assert_eq!(windows_to_draw(&drawn, 3, &moved), ["server-a", "server-c"]);
        // A destroyed window's label comes back on a new window.
        drawn.windows.remove("server-b");
        assert_eq!(windows_to_draw(&drawn, 3, &open), ["server-b"]);
    }
}

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

    /// Download progress (0 to 1), or none, on the same connection as the
    /// count. Blocking: call it off the UI thread.
    pub fn progress(value: Option<f64>) {
        let _sending = SENDING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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
            &(APP_URI, progress_properties(value)),
        );
        if let Err(error) = sent {
            log::debug!("could not update the dock's download progress: {error}");
        }
    }

    pub fn progress_properties(value: Option<f64>) -> HashMap<&'static str, Value<'static>> {
        HashMap::from([
            ("progress", Value::from(value.unwrap_or(0.0).clamp(0.0, 1.0))),
            ("progress-visible", Value::from(value.is_some())),
        ])
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

        #[test]
        fn shows_download_progress_only_while_known() {
            assert_eq!(progress_properties(Some(0.25))["progress"], Value::from(0.25));
            assert_eq!(progress_properties(Some(0.25))["progress-visible"], Value::from(true));
            assert_eq!(progress_properties(Some(7.0))["progress"], Value::from(1.0));
            assert_eq!(progress_properties(None)["progress-visible"], Value::from(false));
        }
    }
}
