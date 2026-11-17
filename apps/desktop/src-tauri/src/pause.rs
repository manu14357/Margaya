//! "Pause notifications": for an hour, until tomorrow morning (08:00 local
//! time) or until the person turns them back on. Kept in the app's
//! preferences (`notificationPause` in preferences.json), so a restart
//! keeps it. While paused no server alert shows and nothing sounds; the
//! badge still updates. Set from the tray submenu or the launcher's
//! settings.
//!
//! The system's own quiet modes are followed separately, in notify.rs:
//! Windows' Do Not Disturb, Focus or full screen, GNOME's Do Not Disturb.
//! macOS applies Focus to the app's notifications itself.

use std::sync::Once;
use std::time::Duration;

use chrono::{DateTime, Local, NaiveDateTime, NaiveTime, TimeZone};
use serde::{Deserialize, Serialize};
use tauri::menu::{CheckMenuItem, IsMenuItem, MenuEvent, Submenu};
use tauri::{AppHandle, Emitter, Wry};

use crate::error::{AppError, AppResult, ErrorKind};
use crate::i18n::t;

/// The event the launcher listens to after a change (from the tray, or the
/// end of a timed pause).
pub const CHANGED_EVENT: &str = "notification-pause-changed";
const MENU_PREFIX: &str = "notification-pause:";
/// "Until tomorrow" ends at this local time.
const MORNING_HOUR: u32 = 8;
const HOUR_MS: u64 = 60 * 60 * 1000;

/// The person's choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PauseMode {
    Off,
    Hour,
    Tomorrow,
    Forever,
}

impl PauseMode {
    const ALL: [PauseMode; 4] = [
        PauseMode::Off,
        PauseMode::Hour,
        PauseMode::Tomorrow,
        PauseMode::Forever,
    ];

    fn name(self) -> &'static str {
        match self {
            PauseMode::Off => "off",
            PauseMode::Hour => "hour",
            PauseMode::Tomorrow => "tomorrow",
            PauseMode::Forever => "forever",
        }
    }

    fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|mode| mode.name() == name)
    }

    fn tray_label(self) -> String {
        t(match self {
            PauseMode::Off => "tray.pauseOff",
            PauseMode::Hour => "tray.pauseHour",
            PauseMode::Tomorrow => "tray.pauseTomorrow",
            PauseMode::Forever => "tray.pauseForever",
        })
    }
}

/// A pause as stored: its mode and, unless it lasts until turned off, when
/// it ends (Unix milliseconds).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPause {
    pub mode: PauseMode,
    #[serde(default)]
    pub until: Option<u64>,
}

/// What the launcher shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseView {
    pub mode: PauseMode,
    pub until: Option<u64>,
}

/// The pause for a choice made at `now`; `morning` is the next 08:00.
pub fn pause_for(mode: PauseMode, now_ms: u64, morning_ms: u64) -> Option<NotificationPause> {
    let until = match mode {
        PauseMode::Off => return None,
        PauseMode::Hour => Some(now_ms + HOUR_MS),
        PauseMode::Tomorrow => Some(morning_ms),
        PauseMode::Forever => None,
    };
    Some(NotificationPause { mode, until })
}

/// The pause still in effect at `now`, if any (an ended one is off).
pub fn in_effect(pause: Option<NotificationPause>, now_ms: u64) -> Option<NotificationPause> {
    pause.filter(|pause| {
        pause.mode != PauseMode::Off && pause.until.is_none_or(|until| now_ms < until)
    })
}

/// The next 08:00 after `now`, in local wall-clock time: tomorrow's, or
/// today's when it is still early morning.
pub fn next_morning(now: NaiveDateTime) -> NaiveDateTime {
    let morning = NaiveTime::from_hms_opt(MORNING_HOUR, 0, 0).expect("a valid time");
    let today = now.date().and_time(morning);
    if now < today {
        today
    } else {
        (now.date() + chrono::Days::new(1)).and_time(morning)
    }
}

/// The next local 08:00 as Unix milliseconds. A morning that falls in a
/// daylight-saving gap takes the first valid moment after it.
fn next_morning_ms(now: DateTime<Local>) -> u64 {
    let wall = next_morning(now.naive_local());
    let at = Local
        .from_local_datetime(&wall)
        .earliest()
        .or_else(|| {
            Local
                .from_local_datetime(&(wall + chrono::Duration::hours(1)))
                .earliest()
        })
        .unwrap_or_else(|| now + chrono::Duration::hours(12));
    u64::try_from(at.timestamp_millis()).unwrap_or_default()
}

fn now_ms() -> u64 {
    crate::servers::now_millis()
}

/// The current pause (none when off or ended).
pub fn current(app: &AppHandle) -> Option<NotificationPause> {
    in_effect(crate::prefs::get(app).notification_pause, now_ms())
}

/// Whether server alerts stay hidden now.
pub fn is_paused(app: &AppHandle) -> bool {
    current(app).is_some()
}

pub fn view(app: &AppHandle) -> PauseView {
    match current(app) {
        Some(pause) => PauseView {
            mode: pause.mode,
            until: pause.until,
        },
        None => PauseView {
            mode: PauseMode::Off,
            until: None,
        },
    }
}

/// Pauses (or resumes) notifications, keeps it, and updates the tray and
/// the launcher.
pub fn set(app: &AppHandle, mode: PauseMode) -> AppResult<PauseView> {
    let pause = pause_for(mode, now_ms(), next_morning_ms(Local::now()));
    crate::prefs::update(app, |prefs| prefs.notification_pause = pause)?;
    log::info!("notifications paused: {}", mode.name());
    changed(app);
    if let Some(until) = pause.and_then(|pause| pause.until) {
        refresh_at(app, until);
    }
    Ok(view(app))
}

fn changed(app: &AppHandle) {
    crate::menus::refresh_tray(app);
    let _ = app.emit(CHANGED_EVENT, view(app));
}

/// Updates the tray and the launcher once a timed pause ends.
fn refresh_at(app: &AppHandle, until: u64) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let wait = until.saturating_sub(now_ms()) + 1_000;
        tokio::time::sleep(Duration::from_millis(wait)).await;
        // A newer choice may have replaced this pause; refreshing is harmless.
        changed(&app);
    });
}

/// The tray's "Pause notifications" submenu, its current choice checked.
/// The first call also starts listening to its items and, for a pause that
/// is still running from before, its end.
pub fn pause_submenu(app: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    static LISTEN: Once = Once::new();
    LISTEN.call_once(|| {
        // Tray menu events reach every global menu listener; this one acts
        // only on its own items.
        app.on_menu_event(|app, event| handle_menu_event(app, &event));
        if let Some(until) = current(app).and_then(|pause| pause.until) {
            refresh_at(app, until);
        }
    });
    let active = view(app).mode;
    let items = PauseMode::ALL
        .into_iter()
        .map(|mode| {
            CheckMenuItem::with_id(
                app,
                format!("{MENU_PREFIX}{}", mode.name()),
                mode.tray_label(),
                true,
                mode == active,
                None::<&str>,
            )
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let refs: Vec<&dyn IsMenuItem<Wry>> = items
        .iter()
        .map(|item| item as &dyn IsMenuItem<Wry>)
        .collect();
    Submenu::with_items(app, t("tray.pauseNotifications"), true, &refs)
}

fn handle_menu_event(app: &AppHandle, event: &MenuEvent) {
    let Some(mode) = event
        .id()
        .as_ref()
        .strip_prefix(MENU_PREFIX)
        .and_then(PauseMode::parse)
    else {
        return;
    };
    if let Err(error) = set(app, mode) {
        log::warn!("could not pause notifications: {}", error.message);
        // Put the check marks back as they were.
        crate::menus::refresh_tray(app);
    }
}

#[tauri::command]
pub fn get_notification_pause(app: AppHandle) -> PauseView {
    view(&app)
}

#[tauri::command]
pub fn set_notification_pause(app: AppHandle, mode: String) -> AppResult<PauseView> {
    let mode = PauseMode::parse(&mode)
        .ok_or_else(|| AppError::new(ErrorKind::Internal, "unknown pause choice"))?;
    set(&app, mode)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn at(day: u32, hour: u32, minute: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 11, day)
            .unwrap()
            .and_hms_opt(hour, minute, 0)
            .unwrap()
    }

    #[test]
    fn tomorrow_means_the_next_eight_oclock() {
        assert_eq!(next_morning(at(17, 15, 30)), at(18, 8, 0));
        assert_eq!(next_morning(at(17, 8, 0)), at(18, 8, 0));
        assert_eq!(next_morning(at(17, 23, 59)), at(18, 8, 0));
        // Past midnight, "tomorrow morning" is this morning.
        assert_eq!(next_morning(at(18, 1, 15)), at(18, 8, 0));
        assert_eq!(
            next_morning(
                NaiveDate::from_ymd_opt(2026, 12, 31)
                    .unwrap()
                    .and_hms_opt(22, 0, 0)
                    .unwrap()
            ),
            NaiveDate::from_ymd_opt(2027, 1, 1)
                .unwrap()
                .and_hms_opt(8, 0, 0)
                .unwrap()
        );
    }

    #[test]
    fn pauses_for_an_hour_until_morning_or_until_turned_off() {
        let now = 1_000_000;
        let morning = now + 9 * HOUR_MS;
        assert_eq!(pause_for(PauseMode::Off, now, morning), None);
        assert_eq!(
            pause_for(PauseMode::Hour, now, morning),
            Some(NotificationPause {
                mode: PauseMode::Hour,
                until: Some(now + HOUR_MS)
            })
        );
        assert_eq!(
            pause_for(PauseMode::Tomorrow, now, morning).and_then(|pause| pause.until),
            Some(morning)
        );
        assert_eq!(
            pause_for(PauseMode::Forever, now, morning),
            Some(NotificationPause {
                mode: PauseMode::Forever,
                until: None
            })
        );
    }

    #[test]
    fn a_pause_ends_on_time() {
        let hour = pause_for(PauseMode::Hour, 0, 0);
        assert!(in_effect(hour, HOUR_MS - 1).is_some());
        assert!(in_effect(hour, HOUR_MS).is_none());
        let forever = pause_for(PauseMode::Forever, 0, 0);
        assert!(in_effect(forever, u64::MAX).is_some());
        assert!(in_effect(None, 0).is_none());
        assert!(in_effect(
            Some(NotificationPause {
                mode: PauseMode::Off,
                until: None
            }),
            0
        )
        .is_none());
    }

    #[test]
    fn stores_and_reads_the_pause() {
        let pause = pause_for(PauseMode::Tomorrow, 0, 42).unwrap();
        let json = serde_json::to_value(pause).unwrap();
        assert_eq!(json, serde_json::json!({ "mode": "tomorrow", "until": 42 }));
        let forever: NotificationPause =
            serde_json::from_value(serde_json::json!({ "mode": "forever" })).unwrap();
        assert_eq!(forever.until, None);
        for mode in PauseMode::ALL {
            assert_eq!(PauseMode::parse(mode.name()), Some(mode));
            assert!(!mode.tray_label().starts_with("tray."));
        }
        assert_eq!(PauseMode::parse("week"), None);
        assert!(!t("tray.pauseNotifications").starts_with("tray."));
    }

    #[test]
    fn the_next_morning_is_ahead_of_now() {
        let now = Local::now();
        let morning = next_morning_ms(now);
        let now = u64::try_from(now.timestamp_millis()).unwrap();
        assert!(morning > now);
        assert!(morning <= now + 25 * HOUR_MS);
    }
}
