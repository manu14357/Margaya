//! Native notifications: their text, whether they make a sound, and where a
//! click goes.
//!
//! Windows: a toast of our own (WinRT `ToastNotification`) under the app's
//! AppUserModelID (the identifier, which the installers put on the Start menu
//! shortcut, so Windows shows "Margaya" with the app icon). A click is a
//! protocol activation of `margaya://open?server=…&path=…`: Windows starts
//! the registered app with the link, the single-instance handoff passes it to
//! the running app, and the deep-link handler shows that server's window and
//! moves it to the page without a reload. That works on screen, from the
//! notification centre, and after the app was quit (the link starts it).
//! Toasts are tagged by the server's tag and grouped by server, so a newer
//! one with the same tag replaces the older.
//!
//! macOS and Linux keep the notification plugin; its click handler opens the
//! same target. On Linux the plugin sends the notification over D-Bus to the
//! desktop's notification server (GNOME Shell, Plasma, dunst, mako...) with
//! a `default` action, so a click comes back as `tap` while Margaya runs;
//! the icon is the app's own PNG, so it shows for an AppImage too.
//!
//! Finished and failed downloads get their own silent notification
//! (`show_download`); a click shows the file in its folder through
//! `margaya://download` or the plugin's `tap` (see downloads.rs).
//!
//! Task alerts can carry buttons ("Mark done", "Snooze 1 hour", "Reply"; see
//! notification_actions.rs): on Windows toast actions that open
//! `margaya://notification-action` links, on macOS and Linux the plugin's
//! action buttons (Linux: one button each; macOS: an "Options" menu).
//!
//! Paused notifications (pause.rs) show nothing. Windows: no toast either
//! while Windows holds notifications back (Do Not Disturb or Focus, a
//! presentation or a full-screen app); Linux: none while GNOME's Do Not
//! Disturb is on. macOS applies Focus itself. The badge still updates.
//!
//! Sound: the alert makes a sound when the server says the user's Margaya
//! sound settings call for one (`sound` in
//! `GET /api/notification/{id}/desktop`), unless sounds are muted on this
//! device, and at most once per burst. The web app inside the window then
//! stays silent (bridge `notificationSound: "system"`). On Windows the toast
//! itself is always silent (an unpackaged app's toast can't play its own
//! audio) and the app plays the Margaya sound the server names
//! (`soundName`, at `volume`; see `sound.rs`), unless Windows holds
//! notifications back (Do Not Disturb, full screen) or turned them off for
//! the app. macOS plays the system notification sound with the alert.
//! Linux plays the same Margaya sound as Windows (`sound.rs`), through the
//! desktop's sound server, unless GNOME's Do Not Disturb is on.

use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use url::Url;

use crate::auth::ALIAS_SCHEME;
use crate::notification_actions::{self, Action};
use crate::servers::Server;
use crate::sound::Tone;
use crate::state::{lock, AppState};

/// One sound per burst, as in the web app (`SOUND_WINDOW_MS`).
pub const SOUND_WINDOW: Duration = Duration::from_secs(4);

/// Windows keeps tags and groups to 64 characters.
const MAX_TAG: usize = 64;

/// A notification ready to show.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone)]
pub struct Alert {
    pub server_id: String,
    pub server_label: String,
    pub title: String,
    pub body: String,
    /// A page of this server's web UI, already checked.
    pub url: Option<Url>,
    pub tag: String,
    /// The sound to play, if any (already decided by `decide_sound`).
    pub sound: Option<Tone>,
}

/// Why an alert does or doesn't make a sound (logged, never the text).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sound {
    On,
    /// The user's Margaya settings call for silence.
    OffBySettings,
    /// An older server that doesn't say; its web app plays its own sound.
    OffServerSilent,
    MutedOnDevice,
    /// Another alert sounded a moment ago.
    OffBurst,
}

/// Decides the sound from the server's answer, this device's mute and the
/// last time an alert sounded; updates `last` when it sounds.
pub fn decide_sound(
    server_says: Option<bool>,
    muted: bool,
    last: &mut Option<Instant>,
    now: Instant,
) -> Sound {
    let sound = match server_says {
        None => Sound::OffServerSilent,
        Some(false) => Sound::OffBySettings,
        Some(true) if muted => Sound::MutedOnDevice,
        Some(true) if last.is_some_and(|at| now.duration_since(at) < SOUND_WINDOW) => {
            Sound::OffBurst
        }
        Some(true) => Sound::On,
    };
    if sound == Sound::On {
        *last = Some(now);
    }
    sound
}

/// The web UI path (with query and fragment) of a page on this server,
/// relative to the server's base path, as `margaya://open` takes it.
pub fn web_path(server: &Server, url: &Url) -> Option<String> {
    let base = server.web()?;
    if !crate::routing::is_web_page(server, url) {
        return None;
    }
    let base = base.as_str().trim_end_matches('/');
    let rest = url.as_str().strip_prefix(base)?;
    let path = match rest.chars().next() {
        None => "/".to_string(),
        Some('/') => rest.to_string(),
        Some('?' | '#') => format!("/{rest}"),
        // Another path that only shares a prefix ("/margaya2").
        Some(_) => return None,
    };
    crate::urls::safe_relative_path(&path).map(str::to_string)
}

/// The link a click on the alert opens: `margaya://open` for this server at
/// the alert's page, or at its start page.
pub fn click_link(server: &Server, url: Option<&Url>) -> String {
    let path = url
        .and_then(|url| web_path(server, url))
        .unwrap_or_else(|| "/".to_string());
    let mut link = Url::parse(&format!("{ALIAS_SCHEME}://open")).expect("static URL");
    link.query_pairs_mut()
        .append_pair("server", server.api_url.trim_end_matches('/'))
        .append_pair("path", &path);
    link.to_string()
}

/// A toast tag or group: the server's value when it fits, else a stable hash.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn toast_key(value: &str) -> String {
    if !value.is_empty() && value.len() <= MAX_TAG {
        return value.to_string();
    }
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(value.as_bytes());
    digest
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg_attr(not(windows), allow(dead_code))]
fn escape_xml(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            // XML 1.0 has no place for other control characters.
            c if c.is_control() && !matches!(c, '\n' | '\t') => {}
            c => out.push(c),
        }
    }
    out
}

/// A protocol-activated toast: a click opens `launch`, each button (label,
/// link) its own link. Always silent: the app plays the Margaya sound itself.
#[cfg_attr(not(windows), allow(dead_code))]
fn toast_document(
    title: &str,
    body: &str,
    attribution: Option<&str>,
    launch: &str,
    buttons: &[(String, String)],
) -> String {
    let actions = if buttons.is_empty() {
        String::new()
    } else {
        let list: String = buttons
            .iter()
            .map(|(label, link)| {
                format!(
                    r#"<action content="{}" arguments="{}" activationType="protocol"/>"#,
                    escape_xml(label),
                    escape_xml(link)
                )
            })
            .collect();
        format!("<actions>{list}</actions>")
    };
    let launch = escape_xml(launch);
    let title = escape_xml(title);
    let body = escape_xml(body);
    let source = attribution.map_or_else(String::new, |source| {
        format!(
            r#"<text placement="attribution">{}</text>"#,
            escape_xml(source)
        )
    });
    format!(
        r#"<toast launch="{launch}" activationType="protocol"><visual><binding template="ToastGeneric"><text hint-maxLines="2">{title}</text><text>{body}</text>{source}</binding></visual>{actions}<audio silent="true"/></toast>"#
    )
}

/// The toast's XML. `attribution` (the server's name) is shown when the
/// person uses more than one server.
#[cfg(test)]
pub fn toast_xml(alert: &Alert, launch: &str, attribution: bool) -> String {
    toast_xml_with_buttons(alert, launch, attribution, &[])
}

/// The toast's XML with buttons, as (label, link) pairs.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn toast_xml_with_buttons(
    alert: &Alert,
    launch: &str,
    attribution: bool,
    buttons: &[(String, String)],
) -> String {
    let source = attribution.then_some(alert.server_label.as_str());
    toast_document(&alert.title, &alert.body, source, launch, buttons)
}

/// A download's toast: the file name in the title, what a click does below.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn download_toast_xml(title: &str, body: &str, launch: &str) -> String {
    toast_document(title, body, None, launch, &[])
}

/// The toast group of download notifications. Each has its own tag (its id),
/// so several downloads at once keep one notification each.
#[cfg_attr(not(windows), allow(dead_code))]
const DOWNLOAD_GROUP: &str = "downloads";

/// Shows a download's notification: a click shows the file in its folder
/// (`id`, from [`crate::downloads::Downloads::remember`]) or, without one,
/// opens the Downloads folder. Silent everywhere: the person just asked for
/// the file. Margaya's quiet hours hold only the server's alerts; the
/// system's Do Not Disturb applies to this one as to any other.
pub fn show_download(app: &AppHandle, title: String, body: String, id: Option<String>) {
    let link = crate::downloads::click_link(id.as_deref());
    #[cfg(feature = "e2e")]
    e2e_record_download(&link);

    #[cfg(windows)]
    {
        let app_id = app.config().identifier.clone();
        let xml = download_toast_xml(&title, &body, &link);
        // A failed download has no id; its toast still needs a tag of its own.
        let tag = id.unwrap_or_else(|| uuid::Uuid::new_v4().hyphenated().to_string());
        let tag = toast_key(&tag);
        tauri::async_runtime::spawn_blocking(move || {
            match toast::show(&app_id, &xml, &tag, DOWNLOAD_GROUP) {
                Ok(true) => {}
                Ok(false) => {
                    log::info!("download notification not shown: notifications are off for the app")
                }
                Err(error) => log::warn!("could not show a download notification: {error}"),
            }
        });
    }

    #[cfg(not(windows))]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = link;
        let local_id = app
            .state::<AppState>()
            .remember_notification(crate::state::NotificationTarget::Download { id });
        let app = app.clone();
        // Not on the UI thread: the download callback runs there, and the
        // plugin talks to the notification server (D-Bus on Linux).
        tauri::async_runtime::spawn_blocking(move || {
            #[cfg_attr(not(target_os = "linux"), allow(unused_mut))]
            let mut builder = app
                .notification()
                .builder()
                .id(local_id)
                .title(title)
                .body(body);
            #[cfg(target_os = "linux")]
            if let Some(icon) = linux_icon(&app) {
                builder = builder.icon(icon);
            }
            if let Err(error) = builder.show() {
                log::warn!("could not show a download notification: {error}");
            }
        });
    }
}

/// What an alert's buttons act on (from the server's `taskId` and
/// `actions`).
#[derive(Debug, Clone)]
pub struct ActionOffer {
    pub notification_id: String,
    pub task_id: String,
    pub actions: Vec<Action>,
}

/// Shows an alert natively.
pub fn show(app: &AppHandle, server: &Server, alert: Alert) {
    show_with_actions(app, server, alert, None);
}

/// Windows' toast actions for an alert: (label, link) per button.
#[cfg_attr(not(windows), allow(dead_code))]
fn toast_buttons(id: &str, actions: &[Action]) -> Vec<(String, String)> {
    actions
        .iter()
        .map(|action| {
            (
                action.label(),
                notification_actions::action_link(id, *action),
            )
        })
        .collect()
}

/// The plugin's action type for a set of buttons (macOS and Linux): one per
/// combination, registered again on use (registering replaces).
#[cfg(not(windows))]
fn action_type_id(app: &AppHandle, actions: &[Action]) -> String {
    use tauri_plugin_notification::{Action as PluginAction, ActionType, NotificationExt};
    let names: Vec<&str> = actions.iter().map(|action| action.name()).collect();
    let id = format!("margaya-{}", names.join("-"));
    let buttons = actions
        .iter()
        .map(|action| PluginAction::builder(action.name(), action.label()).build())
        .collect();
    let _ = app
        .notification()
        .register_action_types(vec![ActionType::builder(&id).actions(buttons).build()]);
    id
}

/// Shows an alert natively, with buttons when `offer` has any.
pub fn show_with_actions(
    app: &AppHandle,
    server: &Server,
    alert: Alert,
    offer: Option<ActionOffer>,
) {
    let state = app.state::<AppState>();
    let several = state.servers().len() > 1;
    let link = click_link(server, alert.url.as_ref());
    let target = offer
        .filter(|offer| !offer.actions.is_empty())
        .map(|offer| notification_actions::Target {
            server_id: alert.server_id.clone(),
            notification_id: offer.notification_id,
            task_id: offer.task_id,
            url: alert.url.clone(),
            tag: alert.tag.clone(),
            actions: offer.actions,
        });

    #[cfg(windows)]
    {
        let buttons = target.map_or_else(Vec::new, |target| {
            let actions = target.actions.clone();
            let id = notification_actions::remember(target, None);
            toast_buttons(&id, &actions)
        });
        #[cfg(feature = "e2e")]
        e2e_record(&alert, &link, &buttons);
        let app_id = app.config().identifier.clone();
        let xml = toast_xml_with_buttons(&alert, &link, several, &buttons);
        let (tag, group) = (toast_key(&alert.tag), toast_key(&alert.server_id));
        let tone = alert.sound;
        tauri::async_runtime::spawn_blocking(move || {
            // Do Not Disturb, Focus, a presentation or a full-screen app:
            // Windows says not now, so no toast and no sound.
            if crate::sound::windows_holds_toasts() {
                log::info!("notification not shown: Windows is holding notifications back");
                return;
            }
            match toast::show(&app_id, &xml, &tag, &group) {
                Ok(enabled) => {
                    if let Some(tone) = tone {
                        if !enabled {
                            log::info!("no sound: notifications are off for the app");
                        } else if crate::sound::system_quiet() {
                            log::info!("no sound: Windows is holding notifications back");
                        } else {
                            crate::sound::play(tone);
                        }
                    }
                }
                Err(error) => log::warn!("could not show a notification: {error}"),
            }
        });
    }

    #[cfg(not(windows))]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = several;
        #[cfg(feature = "e2e")]
        e2e_record(&alert, &link, &[]);
        let _ = link;
        let local_id = state.remember_notification(crate::state::NotificationTarget::Page {
            server_id: alert.server_id.clone(),
            url: alert.url.as_ref().map(Url::to_string),
        });
        let action_type = target.map(|target| {
            let id = action_type_id(app, &target.actions);
            notification_actions::remember(target, Some(local_id));
            id
        });
        let app = app.clone();
        // Off the async runtime's threads: GNOME's Do Not Disturb is read by
        // running gsettings, and the plugin talks to the notification server.
        tauri::async_runtime::spawn_blocking(move || {
            #[cfg(target_os = "linux")]
            if crate::sound::system_quiet() {
                log::info!("notification not shown: Do Not Disturb is on");
                return;
            }
            let mut builder = app
                .notification()
                .builder()
                .id(local_id)
                .title(alert.title)
                .body(alert.body);
            if let Some(action_type) = action_type {
                builder = builder.action_type_id(action_type);
            }
            #[cfg(target_os = "macos")]
            if alert.sound.is_some() {
                builder = builder.sound("default");
            }
            #[cfg(target_os = "linux")]
            if let Some(icon) = linux_icon(&app) {
                builder = builder.icon(icon);
            }
            match builder.show() {
                // Do Not Disturb was checked just above.
                #[cfg(target_os = "linux")]
                Ok(()) => {
                    if let Some(tone) = alert.sound {
                        crate::sound::play(tone);
                    }
                }
                #[cfg(not(target_os = "linux"))]
                Ok(()) => {}
                Err(error) => log::warn!("could not show a notification: {error}"),
            }
        });
    }
}

/// A short silent notification after a button ran (or failed): it replaces
/// the alert (same tag) and a click opens the alert's page. Shown even while
/// notifications are paused: the person just pressed the button.
pub fn show_confirmation(
    app: &AppHandle,
    server: &Server,
    title: String,
    body: String,
    url: Option<Url>,
    tag: &str,
) {
    let link = click_link(server, url.as_ref());
    #[cfg(windows)]
    {
        let app_id = app.config().identifier.clone();
        let xml = toast_document(&title, &body, None, &link, &[]);
        let (tag, group) = (toast_key(tag), toast_key(&server.id));
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = toast::show(&app_id, &xml, &tag, &group) {
                log::warn!("could not show a confirmation: {error}");
            }
        });
    }
    #[cfg(not(windows))]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = (link, tag);
        let local_id =
            app.state::<AppState>()
                .remember_notification(crate::state::NotificationTarget::Page {
                    server_id: server.id.clone(),
                    url: url.as_ref().map(Url::to_string),
                });
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            #[cfg_attr(not(target_os = "linux"), allow(unused_mut))]
            let mut builder = app
                .notification()
                .builder()
                .id(local_id)
                .title(title)
                .body(body);
            #[cfg(target_os = "linux")]
            if let Some(icon) = linux_icon(&app) {
                builder = builder.icon(icon);
            }
            if let Err(error) = builder.show() {
                log::warn!("could not show a confirmation: {error}");
            }
        });
    }
}

/// Test builds: each alert's click link and sound go to the file named by
/// `MARGAYA_E2E_NOTIFY_LOG`, so a test can "click" it by starting the app
/// with that link (what Windows does) without touching the person's mouse.
#[cfg(feature = "e2e")]
fn e2e_record(alert: &Alert, link: &str, buttons: &[(String, String)]) {
    use std::io::Write;
    let Ok(path) = std::env::var("MARGAYA_E2E_NOTIFY_LOG") else {
        return;
    };
    let line = serde_json::json!({
        "server": alert.server_id,
        "tag": alert.tag,
        "sound": alert.sound.is_some(),
        "soundName": alert.sound.map(|tone| tone.id.name()),
        "volume": alert.sound.map(|tone| tone.volume),
        "link": link,
        "actions": buttons.iter().map(|(_, link)| link.as_str()).collect::<Vec<_>>(),
    });
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{line}");
    }
}

/// Test builds: a download notification's click link, as for alerts.
#[cfg(feature = "e2e")]
fn e2e_record_download(link: &str) {
    use std::io::Write;
    let Ok(path) = std::env::var("MARGAYA_E2E_NOTIFY_LOG") else {
        return;
    };
    let line = serde_json::json!({ "kind": "download", "link": link });
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{line}");
    }
}

/// The notification icon on Linux: the app's 128 px PNG, written once to the
/// app's cache directory. An icon name would need the icon installed in the
/// system theme, which a .deb or .rpm does but an AppImage doesn't.
#[cfg(target_os = "linux")]
fn linux_icon(app: &AppHandle) -> Option<String> {
    use std::sync::OnceLock;
    static ICON: OnceLock<Option<String>> = OnceLock::new();
    ICON.get_or_init(|| {
        let path = app
            .path()
            .app_cache_dir()
            .ok()?
            .join("notification-icon.png");
        let bytes: &[u8] = include_bytes!("../icons/128x128.png");
        if std::fs::read(&path).ok().as_deref() != Some(bytes) {
            std::fs::create_dir_all(path.parent()?).ok()?;
            std::fs::write(&path, bytes).ok()?;
        }
        Some(path.to_string_lossy().into_owned())
    })
    .clone()
}

/// Remembers when an alert last sounded, across servers.
pub fn sound_for(app: &AppHandle, server: &Server, server_says: Option<bool>) -> Sound {
    let state = app.state::<AppState>();
    let mut last = lock(&state.last_alert_sound);
    decide_sound(server_says, server.sound_muted, &mut last, Instant::now())
}

#[cfg(windows)]
mod toast {
    use ::windows::core::{Result, HSTRING};
    use ::windows::Data::Xml::Dom::XmlDocument;
    use ::windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    use ::windows::UI::Notifications::{
        NotificationSetting, ToastNotification, ToastNotificationManager,
    };

    /// Shows the toast; true when Windows lets the app's notifications
    /// through (not turned off for the app, by the user or by policy).
    pub fn show(app_id: &str, xml: &str, tag: &str, group: &str) -> Result<bool> {
        // WinRT needs COM on this (pool) thread; a second call is harmless.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let document = XmlDocument::new()?;
        document.LoadXml(&HSTRING::from(xml))?;
        let toast = ToastNotification::CreateToastNotification(&document)?;
        toast.SetTag(&HSTRING::from(tag))?;
        toast.SetGroup(&HSTRING::from(group))?;
        let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?;
        notifier.Show(&toast)?;
        Ok(notifier
            .Setting()
            .map_or(true, |setting| setting == NotificationSetting::Enabled))
    }
}

/// Test and development builds run from `target/`, where no Start menu
/// shortcut names their AppUserModelID; Windows then needs the ID in the
/// registry to show their toasts (as "Margaya", with the app icon).
#[cfg(all(windows, any(debug_assertions, feature = "e2e")))]
pub fn register_app_id(app: &AppHandle) {
    use ::windows::core::HSTRING;
    use ::windows::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};

    let identifier = app.config().identifier.clone();
    let icon = app
        .path()
        .app_local_data_dir()
        .ok()
        .map(|dir| dir.join("toast-icon.png"));
    if let Some(icon) = &icon {
        let _ = std::fs::create_dir_all(icon.parent().unwrap_or(icon));
        let _ = std::fs::write(icon, include_bytes!("../icons/128x128.png"));
    }
    let key = HSTRING::from(format!("Software\\Classes\\AppUserModelId\\{identifier}"));
    let set = |name: &str, value: &str| {
        let wide: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
        // Creates the key on first use.
        let status = unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                &key,
                &HSTRING::from(name),
                REG_SZ.0,
                Some(wide.as_ptr().cast()),
                (wide.len() * 2) as u32,
            )
        };
        if status.is_err() {
            log::warn!("could not register the test build's notification identity");
        }
    };
    set("DisplayName", &app.package_info().name);
    if let Some(icon) = &icon {
        set("IconUri", &icon.to_string_lossy());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{parse_deep_link, DeepLink};

    fn server(web: &str, api: &str) -> Server {
        Server {
            id: "5b0c8a52-3f7e-4c1d-9a7e-2d4f1c6b8e91".into(),
            label: "Acme & Co".into(),
            web_url: web.into(),
            api_url: api.into(),
            server_version: None,
            added_at: 0,
            last_used_at: None,
            reopen: false,
            sound_muted: false,
            link_paused: false,
        }
    }

    fn alert(sound: Option<Tone>) -> Alert {
        Alert {
            server_id: "s1".into(),
            server_label: "Acme & Co".into(),
            title: "Adam replied to a comment".into(),
            body: "New comment on <Draft> the \"pricing\" page".into(),
            url: None,
            tag: "n1".into(),
            sound,
        }
    }

    #[test]
    fn a_click_opens_the_page_on_its_server_through_margaya_open() {
        let s = server("https://app.example/margaya", "https://api.example");
        let page = Url::parse(
            "https://app.example/margaya/dashboard/workspace/w1/project/p1/task/t1?tab=activity#c9",
        )
        .unwrap();
        let link = click_link(&s, Some(&page));
        assert!(link.starts_with("margaya://open?"), "{link}");
        // The deep-link handler reads back exactly this server and page.
        match parse_deep_link(&Url::parse(&link).unwrap()) {
            Some(DeepLink::Open { server, path }) => {
                assert_eq!(server, "https://api.example");
                assert_eq!(
                    path,
                    "/dashboard/workspace/w1/project/p1/task/t1?tab=activity#c9"
                );
                assert_eq!(crate::windows::web_url_for_path(&s, &path).unwrap(), page);
            }
            other => panic!("not an open link: {other:?}"),
        }
    }

    #[test]
    fn a_click_without_a_page_of_this_server_opens_its_start_page() {
        let s = server("https://app.example/margaya", "https://api.example");
        let path_of = |link: String| match parse_deep_link(&Url::parse(&link).unwrap()) {
            Some(DeepLink::Open { path, .. }) => path,
            other => panic!("{other:?}"),
        };
        assert_eq!(path_of(click_link(&s, None)), "/");
        for other in [
            "https://evil.example/margaya/dashboard",
            "https://app.example/margaya2/dashboard",
            "https://app.example/other",
        ] {
            let url = Url::parse(other).unwrap();
            assert_eq!(path_of(click_link(&s, Some(&url))), "/", "{other}");
        }
        // The API's own routes are never a page.
        let same_origin = server("http://localhost:1337", "http://localhost:1337");
        let api = Url::parse("http://localhost:1337/api/notification").unwrap();
        assert_eq!(web_path(&same_origin, &api), None);
        let root = Url::parse("https://app.example/margaya").unwrap();
        assert_eq!(web_path(&s, &root).as_deref(), Some("/"));
    }

    #[test]
    fn builds_a_protocol_toast_with_escaped_text() {
        let xml = toast_xml(&alert(None), "margaya://open?server=x&path=%2F", false);
        assert!(xml.starts_with(
            r#"<toast launch="margaya://open?server=x&amp;path=%2F" activationType="protocol">"#
        ));
        assert!(xml.contains("<text hint-maxLines=\"2\">Adam replied to a comment</text>"));
        assert!(
            xml.contains("<text>New comment on &lt;Draft&gt; the &quot;pricing&quot; page</text>")
        );
        assert!(xml.contains(r#"<audio silent="true"/>"#));
        assert!(!xml.contains("attribution"));
        // With a sound the toast stays silent too: the app plays its own.
        let loud = toast_xml(&alert(Some(crate::sound::FALLBACK)), "margaya://open", true);
        assert!(loud.contains(r#"<audio silent="true"/>"#));
        assert!(!loud.contains("ms-winsoundevent"));
        assert!(loud.contains(r#"<text placement="attribution">Acme &amp; Co</text>"#));
        assert!(!toast_xml(
            &Alert {
                title: "a\u{0}b\u{1b}c".into(),
                ..alert(None)
            },
            "x",
            false
        )
        .contains('\u{0}'));
    }

    #[test]
    fn puts_protocol_buttons_on_a_task_alert() {
        let id = "5b0c8a52-3f7e-4c1d-9a7e-2d4f1c6b8e91";
        let buttons = toast_buttons(id, &[Action::Done, Action::Snooze, Action::Reply]);
        let xml = toast_xml_with_buttons(&alert(None), "margaya://open?server=x", false, &buttons);
        assert!(xml.contains("</visual><actions><action content="));
        assert!(xml.contains("</actions><audio silent=\"true\"/></toast>"));
        assert_eq!(xml.matches("<action ").count(), 3);
        assert_eq!(xml.matches(r#"activationType="protocol""#).count(), 4);
        for action in ["done", "snooze", "reply"] {
            assert!(
                xml.contains(&format!(
                    r#"arguments="margaya://notification-action?id={id}&amp;action={action}""#
                )),
                "{action}"
            );
        }
        // Labels are the app's own copy, escaped like any text.
        assert!(xml.contains(&format!(
            r#"content="{}""#,
            escape_xml(&Action::Snooze.label())
        )));
        // Without buttons nothing changes.
        assert!(!toast_xml(&alert(None), "x", false).contains("<actions>"));
    }

    #[test]
    fn builds_a_download_toast_with_escaped_names() {
        let id = "5b0c8a52-3f7e-4c1d-9a7e-2d4f1c6b8e91";
        let link = crate::downloads::click_link(Some(id));
        // What windows.rs puts in the title: the cleaned file name.
        let name = crate::windows::sanitize_file_name("Q3 <plan> & \"notes\" 'v2'\u{202E}gnp.exe");
        let xml = download_toast_xml(
            &format!("Downloaded {name}"),
            "Click to show in folder",
            &link,
        );
        assert!(xml.starts_with(&format!(
            r#"<toast launch="margaya://download?id={id}" activationType="protocol">"#
        )));
        assert!(xml.contains(
            "<text hint-maxLines=\"2\">Downloaded Q3 _plan_ &amp; _notes_ &apos;v2&apos;_gnp.exe</text>"
        ));
        assert!(xml.contains("<text>Click to show in folder</text>"));
        assert!(xml.contains(r#"<audio silent="true"/>"#));
        assert!(!xml.contains("attribution"));
        assert!(!xml.contains('\u{202E}'));
        // Names in any script stay as they are; markup in them doesn't.
        let xml = download_toast_xml("Скачан отчёт_<b>.csv 報告.png", "x", "margaya://download");
        assert!(xml.contains("Скачан отчёт_&lt;b&gt;.csv 報告.png"));
        assert!(!xml.contains("<b>"));
        assert_eq!(xml.matches("<toast ").count(), 1);
    }

    #[test]
    fn keeps_tags_within_the_windows_limit() {
        assert_eq!(toast_key("cmh1x2y3z"), "cmh1x2y3z");
        let long = "x".repeat(65);
        let key = toast_key(&long);
        assert_eq!(key.len(), 32);
        assert_eq!(key, toast_key(&long));
        assert_ne!(key, toast_key(&"y".repeat(65)));
        assert_eq!(toast_key("").len(), 32);
    }

    #[test]
    fn sounds_once_per_burst_when_the_settings_ask_and_the_device_isnt_muted() {
        let start = Instant::now();
        let mut last = None;
        assert_eq!(
            decide_sound(None, false, &mut last, start),
            Sound::OffServerSilent
        );
        assert_eq!(
            decide_sound(Some(false), false, &mut last, start),
            Sound::OffBySettings
        );
        assert_eq!(
            decide_sound(Some(true), true, &mut last, start),
            Sound::MutedOnDevice
        );
        assert_eq!(last, None);
        assert_eq!(decide_sound(Some(true), false, &mut last, start), Sound::On);
        let soon = start + Duration::from_secs(1);
        assert_eq!(
            decide_sound(Some(true), false, &mut last, soon),
            Sound::OffBurst
        );
        let later = start + SOUND_WINDOW;
        assert_eq!(decide_sound(Some(true), false, &mut last, later), Sound::On);
        assert_eq!(last, Some(later));
    }
}
