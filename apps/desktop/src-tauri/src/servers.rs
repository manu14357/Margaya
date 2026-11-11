//! The server list: an ordinary JSON file in the app's config directory.
//! Each server is keyed by a generated UUID, so it can be renamed or moved
//! without losing its webview profile or keychain entry. Secrets never go here.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use url::Url;
use uuid::Uuid;

use crate::discovery::Discovery;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::urls;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub label: String,
    pub web_url: String,
    pub api_url: String,
    #[serde(default)]
    pub server_version: Option<String>,
    #[serde(default)]
    pub added_at: u64,
    #[serde(default)]
    pub last_used_at: Option<u64>,
    /// The server's window was open when the app last ran, so it opens again
    /// at startup. Cleared when the person closes that window.
    #[serde(default)]
    pub reopen: bool,
    /// "Mute sounds on this device" in this server's web UI: its
    /// notifications stay silent here. The web app reports it through the
    /// bridge (`setSoundMuted`).
    #[serde(default)]
    pub sound_muted: bool,
}

impl Server {
    pub fn web(&self) -> Option<Url> {
        Url::parse(&self.web_url).ok()
    }

    pub fn api(&self) -> Option<Url> {
        Url::parse(&self.api_url).ok()
    }

    /// The label of this server's window ("server-<uuid>").
    pub fn window_label(&self) -> String {
        format!("{WINDOW_PREFIX}{}", self.id)
    }

    /// True when `url` is on this server's web or API origin.
    pub fn owns(&self, url: &Url) -> bool {
        [self.web(), self.api()]
            .into_iter()
            .flatten()
            .any(|own| urls::same_origin(&own, url))
    }

    /// 16 stable bytes for the macOS data store identifier.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub fn store_identifier(&self) -> Option<[u8; 16]> {
        Uuid::parse_str(&self.id).ok().map(|id| *id.as_bytes())
    }
}

pub const WINDOW_PREFIX: &str = "server-";
/// In-app sign-in popups (account linking), which never get the bridge.
pub const POPUP_PREFIX: &str = "popup-";

/// What a window label says about a window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowKind<'a> {
    /// `server-<id>`: the server's main window, hidden rather than closed.
    Primary(&'a str),
    /// `server-<id>-<n>`: another window on the same server and profile.
    Secondary(&'a str, u32),
    /// `popup-<id>-<n>`: a sign-in popup sharing the server's profile.
    Popup(&'a str, u32),
}

impl<'a> WindowKind<'a> {
    pub fn server_id(&self) -> &'a str {
        match *self {
            Self::Primary(id) | Self::Secondary(id, _) | Self::Popup(id, _) => id,
        }
    }
}

pub fn parse_window_label(label: &str) -> Option<WindowKind<'_>> {
    let (rest, popup) = if let Some(rest) = label.strip_prefix(WINDOW_PREFIX) {
        (rest, false)
    } else if let Some(rest) = label.strip_prefix(POPUP_PREFIX) {
        (rest, true)
    } else {
        return None;
    };
    // A hyphenated UUID is 36 ASCII characters.
    let id = rest.get(..36)?;
    if Uuid::parse_str(id).is_err() || id.bytes().filter(|b| *b == b'-').count() != 4 {
        return None;
    }
    let tail = &rest[36..];
    if tail.is_empty() {
        return (!popup).then_some(WindowKind::Primary(id));
    }
    let number = tail.strip_prefix('-')?;
    if number.is_empty() || number.len() > 9 || !number.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let number: u32 = number.parse().ok()?;
    Some(if popup {
        WindowKind::Popup(id, number)
    } else {
        WindowKind::Secondary(id, number)
    })
}

/// The server id behind a window label, if it is one of that server's own
/// windows (main or additional; never a sign-in popup).
pub fn id_from_window_label(label: &str) -> Option<&str> {
    match parse_window_label(label)? {
        WindowKind::Primary(id) | WindowKind::Secondary(id, _) => Some(id),
        WindowKind::Popup(..) => None,
    }
}

/// The servers whose windows open at startup: those that were open last
/// time, else the most recently used signed-in server, else none (the
/// launcher shows instead).
pub fn startup_servers(servers: &[Server], signed_in: impl Fn(&str) -> bool) -> Vec<String> {
    let mut reopen: Vec<&Server> = servers.iter().filter(|server| server.reopen).collect();
    if reopen.is_empty() {
        return servers
            .iter()
            .filter(|server| server.last_used_at.is_some() && signed_in(&server.id))
            .max_by_key(|server| server.last_used_at)
            .map(|server| vec![server.id.clone()])
            .unwrap_or_default();
    }
    // The most recently used opens last, so it ends up in front.
    reopen.sort_by_key(|server| server.last_used_at);
    reopen.into_iter().map(|server| server.id.clone()).collect()
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct StoreFile {
    version: u32,
    servers: Vec<Server>,
}

#[derive(Debug)]
pub struct ServerStore {
    path: PathBuf,
    servers: Vec<Server>,
}

pub fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

impl ServerStore {
    /// Loads the list; a missing or unreadable file starts an empty list
    /// (an unreadable one is kept aside rather than overwritten).
    pub fn load(path: PathBuf) -> Self {
        let servers = match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<StoreFile>(&text) {
                Ok(file) => file.servers,
                Err(error) => {
                    log::warn!("server list unreadable ({error}); starting empty");
                    let _ = fs::rename(&path, path.with_extension("json.broken"));
                    Vec::new()
                }
            },
            Err(_) => Vec::new(),
        };
        Self { path, servers }
    }

    fn save(&self) -> AppResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(AppError::internal)?;
        }
        let file = StoreFile {
            version: 1,
            servers: self.servers.clone(),
        };
        let text = serde_json::to_string_pretty(&file).map_err(AppError::internal)?;
        // Write then rename, so a crash never leaves half a file.
        let temp = self.path.with_extension("json.tmp");
        fs::write(&temp, text).map_err(AppError::internal)?;
        fs::rename(&temp, &self.path).map_err(AppError::internal)
    }

    pub fn list(&self) -> &[Server] {
        &self.servers
    }

    pub fn get(&self, id: &str) -> Option<&Server> {
        self.servers.iter().find(|server| server.id == id)
    }

    /// The server whose web or API origin matches `url`.
    pub fn find_by_url(&self, url: &Url) -> Option<&Server> {
        self.servers.iter().find(|server| server.owns(url))
    }

    pub fn add(&mut self, discovery: &Discovery, label: &str) -> AppResult<Server> {
        let web = Url::parse(&discovery.web_url)
            .map_err(|_| AppError::new(ErrorKind::InvalidUrl, "invalid webUrl"))?;
        if self.servers.iter().any(|server| {
            server
                .web()
                .is_some_and(|own| urls::same_origin(&own, &web))
        }) {
            return Err(AppError::new(ErrorKind::Duplicate, "server already added"));
        }
        let label = clean_label(label).unwrap_or_else(|| discovery.suggested_label.clone());
        let server = Server {
            id: Uuid::new_v4().to_string(),
            label,
            web_url: discovery.web_url.clone(),
            api_url: discovery.api_url.clone(),
            server_version: Some(discovery.server_version.clone()),
            added_at: now_millis(),
            last_used_at: None,
            reopen: false,
            sound_muted: false,
        };
        self.servers.push(server.clone());
        self.save()?;
        Ok(server)
    }

    pub fn rename(&mut self, id: &str, label: &str) -> AppResult<()> {
        let label = clean_label(label).ok_or_else(|| AppError::internal("empty name"))?;
        let server = self
            .servers
            .iter_mut()
            .find(|server| server.id == id)
            .ok_or_else(not_found)?;
        server.label = label;
        self.save()
    }

    pub fn remove(&mut self, id: &str) -> AppResult<Server> {
        let index = self
            .servers
            .iter()
            .position(|server| server.id == id)
            .ok_or_else(not_found)?;
        let removed = self.servers.remove(index);
        self.save()?;
        Ok(removed)
    }

    /// Remembers whether this server's window should open at startup.
    pub fn set_reopen(&mut self, id: &str, reopen: bool) -> AppResult<()> {
        let server = self
            .servers
            .iter_mut()
            .find(|server| server.id == id)
            .ok_or_else(not_found)?;
        if server.reopen == reopen {
            return Ok(());
        }
        server.reopen = reopen;
        self.save()
    }

    pub fn set_sound_muted(&mut self, id: &str, muted: bool) -> AppResult<()> {
        let server = self
            .servers
            .iter_mut()
            .find(|server| server.id == id)
            .ok_or_else(not_found)?;
        if server.sound_muted == muted {
            return Ok(());
        }
        server.sound_muted = muted;
        self.save()
    }

    pub fn touch(&mut self, id: &str) -> AppResult<()> {
        let server = self
            .servers
            .iter_mut()
            .find(|server| server.id == id)
            .ok_or_else(not_found)?;
        server.last_used_at = Some(now_millis());
        self.save()
    }
}

fn not_found() -> AppError {
    AppError::internal("unknown server")
}

fn clean_label(label: &str) -> Option<String> {
    let trimmed: String = label
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(80)
        .collect();
    (!trimmed.is_empty()).then_some(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn discovery(web: &str) -> Discovery {
        Discovery {
            web_url: web.into(),
            api_url: format!("{web}/api-host"),
            server_version: "1.0.0".into(),
            insecure: false,
            suggested_label: "example".into(),
        }
    }

    #[test]
    fn adds_renames_and_removes_servers_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("servers.json");
        let mut store = ServerStore::load(path.clone());
        assert!(store.list().is_empty());

        let server = store
            .add(&discovery("https://a.example"), "  Work  ")
            .unwrap();
        assert_eq!(server.label, "Work");
        assert!(Uuid::parse_str(&server.id).is_ok());
        store.add(&discovery("https://b.example"), "").unwrap();

        let reloaded = ServerStore::load(path.clone());
        assert_eq!(reloaded.list().len(), 2);
        assert_eq!(reloaded.list()[1].label, "example");

        store.rename(&server.id, "Office").unwrap();
        store.touch(&server.id).unwrap();
        let reloaded = ServerStore::load(path.clone());
        assert_eq!(reloaded.get(&server.id).unwrap().label, "Office");
        assert!(reloaded.get(&server.id).unwrap().last_used_at.is_some());

        store.remove(&server.id).unwrap();
        assert_eq!(ServerStore::load(path).list().len(), 1);
    }

    #[test]
    fn refuses_the_same_web_origin_twice() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = ServerStore::load(dir.path().join("servers.json"));
        store.add(&discovery("https://a.example"), "A").unwrap();
        let error = store
            .add(&discovery("https://a.example"), "Again")
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Duplicate);
    }

    #[test]
    fn rejects_empty_names_and_unknown_ids() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = ServerStore::load(dir.path().join("servers.json"));
        let server = store.add(&discovery("https://a.example"), "A").unwrap();
        assert!(store.rename(&server.id, "   ").is_err());
        assert!(store.rename("missing", "B").is_err());
        assert!(store.remove("missing").is_err());
    }

    #[test]
    fn keeps_a_broken_file_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("servers.json");
        fs::write(&path, "{ not json").unwrap();
        let store = ServerStore::load(path.clone());
        assert!(store.list().is_empty());
        assert!(path.with_extension("json.broken").exists());
    }

    #[test]
    fn matches_urls_to_their_server() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = ServerStore::load(dir.path().join("servers.json"));
        let server = store
            .add(
                &Discovery {
                    web_url: "https://app.example".into(),
                    api_url: "https://api.example".into(),
                    server_version: "1.0.0".into(),
                    insecure: false,
                    suggested_label: "x".into(),
                },
                "X",
            )
            .unwrap();
        let find = |url: &str| {
            store
                .find_by_url(&Url::parse(url).unwrap())
                .map(|found| found.id.clone())
        };
        assert_eq!(
            find("https://app.example/dashboard"),
            Some(server.id.clone())
        );
        assert_eq!(
            find("https://api.example/api/task/1"),
            Some(server.id.clone())
        );
        assert_eq!(find("https://app.example.evil.com/"), None);
        assert_eq!(find("http://app.example/"), None);
    }

    #[test]
    fn reads_window_labels() {
        let id = Uuid::new_v4().to_string();
        assert_eq!(
            id_from_window_label(&format!("server-{id}")),
            Some(id.as_str())
        );
        assert_eq!(
            id_from_window_label(&format!("server-{id}-2")),
            Some(id.as_str())
        );
        // Sign-in popups are never bridge senders.
        assert_eq!(id_from_window_label(&format!("popup-{id}-1")), None);
        assert_eq!(id_from_window_label("main"), None);
        assert_eq!(id_from_window_label("quick-add"), None);
        assert_eq!(id_from_window_label("server-not-a-uuid"), None);
    }

    #[test]
    fn tells_window_kinds_apart() {
        let id = "11111111-1111-4111-8111-111111111111";
        assert_eq!(
            parse_window_label(&format!("server-{id}")),
            Some(WindowKind::Primary(id))
        );
        assert_eq!(
            parse_window_label(&format!("server-{id}-12")),
            Some(WindowKind::Secondary(id, 12))
        );
        assert_eq!(
            parse_window_label(&format!("popup-{id}-3")),
            Some(WindowKind::Popup(id, 3))
        );
        assert_eq!(WindowKind::Popup(id, 3).server_id(), id);
        let bad = [
            format!("popup-{id}"),
            format!("server-{id}-"),
            format!("server-{id}-x"),
            format!("server-{id}--1"),
            format!("server-{id}-1-2"),
            format!("server-{id}-+1"),
            format!("server-{id}-1234567890"),
            format!("server-{id}x"),
            format!("server-{}", id.replace('-', "")),
            "server-{1111111-1111-4111-8111-111111111111}".to_string(),
            "server-".to_string(),
            "server-\u{e9}".to_string(),
            format!("other-{id}"),
        ];
        for label in bad {
            assert_eq!(parse_window_label(&label), None, "{label}");
        }
    }

    fn listed(id: &str, last_used_at: Option<u64>, reopen: bool) -> Server {
        Server {
            id: id.into(),
            label: id.into(),
            web_url: format!("https://{id}.example"),
            api_url: format!("https://{id}.example"),
            server_version: None,
            added_at: 0,
            last_used_at,
            reopen,
            sound_muted: false,
        }
    }

    #[test]
    fn chooses_the_servers_to_open_at_startup() {
        let signed_in = |id: &str| id != "c";
        // Nothing used yet: the launcher shows.
        assert!(startup_servers(&[listed("a", None, false)], signed_in).is_empty());
        // The most recently used signed-in server.
        let servers = [
            listed("a", Some(10), false),
            listed("b", Some(30), false),
            listed("c", Some(50), false),
        ];
        assert_eq!(startup_servers(&servers, signed_in), vec!["b"]);
        // Nothing signed in: the launcher.
        assert!(startup_servers(&servers, |_| false).is_empty());
        // Windows that were open last time come back, most recent last.
        let servers = [
            listed("a", Some(40), true),
            listed("b", Some(30), false),
            listed("c", Some(20), true),
        ];
        assert_eq!(startup_servers(&servers, signed_in), vec!["c", "a"]);
    }

    #[test]
    fn remembers_which_windows_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("servers.json");
        let mut store = ServerStore::load(path.clone());
        let server = store.add(&discovery("https://a.example"), "A").unwrap();
        assert!(!server.reopen);
        store.set_reopen(&server.id, true).unwrap();
        assert!(ServerStore::load(path.clone()).get(&server.id).unwrap().reopen);
        store.set_reopen(&server.id, false).unwrap();
        assert!(!ServerStore::load(path).get(&server.id).unwrap().reopen);
        assert!(store.set_reopen("missing", true).is_err());
    }
}
