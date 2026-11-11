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

/// The toast's XML. `attribution` (the server's name) is shown when the
/// person uses more than one server.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn toast_xml(alert: &Alert, launch: &str, attribution: bool) -> String {
    let launch = escape_xml(launch);
    let title = escape_xml(&alert.title);
    let body = escape_xml(&alert.body);
    let source = if attribution {
        format!(
            r#"<text placement="attribution">{}</text>"#,
            escape_xml(&alert.server_label)
        )
    } else {
        String::new()
    };
    // Always silent: the app plays the Margaya sound itself.
    format!(
        r#"<toast launch="{launch}" activationType="protocol"><visual><binding template="ToastGeneric"><text hint-maxLines="2">{title}</text><text>{body}</text>{source}</binding></visual><audio silent="true"/></toast>"#
    )
}

/// Shows an alert natively.
pub fn show(app: &AppHandle, server: &Server, alert: Alert) {
    let state = app.state::<AppState>();
    let several = state.servers().len() > 1;
    let link = click_link(server, alert.url.as_ref());
    #[cfg(feature = "e2e")]
    e2e_record(&alert, &link);

    #[cfg(windows)]
    {
        let app_id = app.config().identifier.clone();
        let xml = toast_xml(&alert, &link, several);
        let (tag, group) = (toast_key(&alert.tag), toast_key(&alert.server_id));
        let tone = alert.sound;
        tauri::async_runtime::spawn_blocking(move || {
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
        let _ = (several, link);
        let local_id = state.remember_notification(crate::state::NotificationTarget {
            server_id: alert.server_id.clone(),
            url: alert.url.as_ref().map(Url::to_string),
        });
        #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
        let mut builder = app
            .notification()
            .builder()
            .id(local_id)
            .title(alert.title)
            .body(alert.body);
        #[cfg(target_os = "macos")]
        if alert.sound.is_some() {
            builder = builder.sound("default");
        }
        #[cfg(target_os = "linux")]
        if let Some(icon) = linux_icon(app) {
            builder = builder.icon(icon);
        }
        match builder.show() {
            #[cfg(target_os = "linux")]
            Ok(()) => play_linux_sound(alert.sound),
            #[cfg(not(target_os = "linux"))]
            Ok(()) => {}
            Err(error) => log::warn!("could not show a notification: {error}"),
        }
    }
}

/// Test builds: each alert's click link and sound go to the file named by
/// `MARGAYA_E2E_NOTIFY_LOG`, so a test can "click" it by starting the app
/// with that link (what Windows does) without touching the person's mouse.
#[cfg(feature = "e2e")]
fn e2e_record(alert: &Alert, link: &str) {
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
    });
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{line}");
    }
}

/// Linux: the Margaya sound, after the notification showed, unless GNOME's
/// Do Not Disturb is on. Off the UI thread: the player runs until it ends.
#[cfg(target_os = "linux")]
fn play_linux_sound(tone: Option<Tone>) {
    if let Some(tone) = tone {
        tauri::async_runtime::spawn_blocking(move || {
            if crate::sound::system_quiet() {
                log::info!("no sound: Do Not Disturb is on");
            } else {
                crate::sound::play(tone);
            }
        });
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
