//! Offline reading: read-only copies of the tasks and pages a person opened
//! recently, which the offline page lists when the server can't be reached.
//!
//! The web app sends a small snapshot through the bridge (`offlineSnapshot`)
//! when a task or page is on screen. A server page, a compromised one
//! included, can only ever write plain text into its own server's cache:
//! every field is validated and capped here, the path must be a page of that
//! server's web UI (never `/api`), and nothing in a snapshot is ever run,
//! opened or rendered as HTML. Copies live in the server's profile directory
//! (`profiles/<uuid>/offline/items.json`), the most recent 50 by last opened,
//! with a total size cap. No tokens or secrets ever go in them. Signing out,
//! removing the server, signing in as someone else, or turning the setting
//! off deletes them.
//!
//! Copies are kept only while the server is signed in natively (checked
//! again under the file's lock right before writing), and writes are
//! coalesced per server: at most about one a second, the newest snapshot
//! replacing one still waiting, so a page that loops can't keep the disk busy.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use url::Url;

use crate::error::{AppError, AppResult};
use crate::servers::{self, Server, WindowKind};
use crate::state::{lock, AppState};
use crate::{routing, urls};

/// The most recent items kept per server.
pub const MAX_ITEMS: usize = 50;
/// The body text of one item, in UTF-8 bytes. The web app cuts its text to
/// 200,000 bytes, a little under this.
pub const MAX_BODY_BYTES: usize = 200 * 1024;
/// All of one server's items together, on disk.
pub const MAX_TOTAL_BYTES: usize = 4 * 1024 * 1024;
const MAX_ID: usize = 128;
const MAX_PATH: usize = 2048;
const MAX_TITLE: usize = 1000;
const MAX_NAME: usize = 500;
const MAX_LABEL: usize = 200;
const MAX_DATE: usize = 64;
const MAX_ASSIGNEES: usize = 50;
/// A cache file larger than this was not written by this app: ignore it.
const MAX_FILE_BYTES: u64 = (MAX_TOTAL_BYTES as u64) * 2;
/// Snapshots that arrive this soon after a server's copies were deleted
/// (a debounced send racing a sign-out) are dropped.
const FORGET_GRACE: Duration = Duration::from_secs(5);
const ITEMS_FILE: &str = "items.json";
const SETTINGS_FILE: &str = "offline-reading.json";

/// A server's file is written at most this often; a newer snapshot replaces
/// one still waiting.
pub const MIN_WRITE_INTERVAL: Duration = Duration::from_secs(1);

/// One lock per server's cache directory, so one busy server never holds
/// up another.
static LOCKS: LazyLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = LazyLock::new(Mutex::default);
static FORGOTTEN: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);
/// Snapshots waiting to be written, by server id.
static WRITES: LazyLock<Mutex<Coalescer<Pending>>> = LazyLock::new(Mutex::default);

fn dir_lock(dir: &Path) -> Arc<Mutex<()>> {
    lock(&LOCKS).entry(dir.to_path_buf()).or_default().clone()
}

/// A snapshot waiting for its server's next write, with the sign-in it
/// arrived under.
struct Pending {
    item: Item,
    session: u64,
}

#[derive(Debug)]
struct Slot<T> {
    pending: Option<T>,
    /// A writer task is running (or about to start) for this key.
    writing: bool,
    last_write: Option<Instant>,
}

impl<T> Default for Slot<T> {
    fn default() -> Self {
        Self {
            pending: None,
            writing: false,
            last_write: None,
        }
    }
}

/// Keeps the newest value per key and paces its writer: at most one write
/// per [`MIN_WRITE_INTERVAL`] per key.
#[derive(Debug)]
pub struct Coalescer<T> {
    slots: HashMap<String, Slot<T>>,
}

impl<T> Default for Coalescer<T> {
    fn default() -> Self {
        Self {
            slots: HashMap::new(),
        }
    }
}

impl<T> Coalescer<T> {
    /// Keeps `value` as the newest for `key`, replacing one still waiting.
    /// Returns how long a new writer should wait before its first write, or
    /// None when a writer is already running for this key.
    pub fn offer(&mut self, key: &str, value: T, now: Instant) -> Option<Duration> {
        let slot = self.slots.entry(key.to_string()).or_default();
        slot.pending = Some(value);
        if slot.writing {
            return None;
        }
        slot.writing = true;
        let since = slot
            .last_write
            .map_or(MIN_WRITE_INTERVAL, |at| now.saturating_duration_since(at));
        Some(MIN_WRITE_INTERVAL.saturating_sub(since))
    }

    /// The writer takes the newest value and records the write; None ends
    /// the writer (the next offer starts another).
    pub fn take(&mut self, key: &str, now: Instant) -> Option<T> {
        let slot = self.slots.get_mut(key)?;
        match slot.pending.take() {
            Some(value) => {
                slot.last_write = Some(now);
                Some(value)
            }
            None => {
                slot.writing = false;
                None
            }
        }
    }

    /// Drops what is waiting for `key` (its copies were just deleted).
    pub fn discard(&mut self, key: &str) {
        if let Some(slot) = self.slots.get_mut(key) {
            slot.pending = None;
        }
    }

    pub fn discard_all(&mut self) {
        for slot in self.slots.values_mut() {
            slot.pending = None;
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Task,
    Page,
}

/// What the web app sends (`saveOfflineSnapshot` on the bridge). Unknown
/// fields and kinds are refused.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub kind: ItemKind,
    pub id: String,
    pub path: String,
    pub title: String,
    #[serde(default)]
    pub workspace_name: Option<String>,
    #[serde(default)]
    pub project_name: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub assignees: Vec<String>,
    #[serde(default)]
    pub body_text: String,
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// A saved copy, as stored and as the offline page reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub kind: ItemKind,
    pub id: String,
    pub path: String,
    pub title: String,
    pub workspace_name: Option<String>,
    pub project_name: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub due_date: Option<String>,
    pub assignees: Vec<String>,
    pub body_text: String,
    pub updated_at: Option<String>,
    /// When this copy was saved (Unix milliseconds).
    pub saved_at: u64,
}

/// One row of the offline page's "Recently opened" list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSummary {
    pub kind: ItemKind,
    pub id: String,
    pub title: String,
    pub workspace_name: Option<String>,
    pub project_name: Option<String>,
    pub saved_at: u64,
}

impl From<&Item> for ItemSummary {
    fn from(item: &Item) -> Self {
        Self {
            kind: item.kind,
            id: item.id.clone(),
            title: item.title.clone(),
            workspace_name: item.workspace_name.clone(),
            project_name: item.project_name.clone(),
            saved_at: item.saved_at,
        }
    }
}

/// Why a snapshot was refused (logged by name only, never its content).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rejected {
    Id,
    Path,
    Field(&'static str),
    Body,
}

fn has_control(text: &str, multiline: bool) -> bool {
    text.chars()
        .any(|c| c.is_control() && !(multiline && (c == '\n' || c == '\t')))
}

/// A single-line text: trimmed, at most `max` bytes, no control characters;
/// empty becomes None.
fn line(value: Option<String>, max: usize, name: &'static str) -> Result<Option<String>, Rejected> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.len() > max || has_control(value, false) {
        return Err(Rejected::Field(name));
    }
    Ok((!value.is_empty()).then(|| value.to_string()))
}

/// A path of this server's web UI ("/dashboard/..."), never an API route,
/// with the web UI's base path kept.
pub fn valid_path(server: &Server, path: &str) -> bool {
    if path.len() > MAX_PATH {
        return false;
    }
    let Some(path) = urls::safe_relative_path(path) else {
        return false;
    };
    let Some(web) = server.web() else {
        return false;
    };
    let base = server.web_url.trim_end_matches('/');
    let Ok(url) = Url::parse(&format!("{base}{path}")) else {
        return false;
    };
    // Dot segments (also percent-encoded) are resolved by the parser, so
    // check what the path turned into: still under the web UI's base, and
    // not its /api.
    let prefix = web.path().trim_end_matches('/');
    let Some(rest) = url.path().strip_prefix(prefix) else {
        return false;
    };
    if !(rest.is_empty() || rest.starts_with('/')) {
        return false;
    }
    let rest = rest.to_ascii_lowercase();
    if rest == "/api" || rest.starts_with("/api/") {
        return false;
    }
    routing::is_web_page(server, &url)
}

impl Snapshot {
    /// The copy to keep, or why this snapshot is refused.
    pub fn validate(self, server: &Server, now: u64) -> Result<Item, Rejected> {
        let id_ok = !self.id.is_empty()
            && self.id.len() <= MAX_ID
            && self
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        if !id_ok {
            return Err(Rejected::Id);
        }
        if !valid_path(server, &self.path) {
            return Err(Rejected::Path);
        }
        let title = line(Some(self.title), MAX_TITLE, "title")?.unwrap_or_default();
        if self.assignees.len() > MAX_ASSIGNEES {
            return Err(Rejected::Field("assignees"));
        }
        let mut assignees = Vec::with_capacity(self.assignees.len());
        for name in self.assignees {
            if let Some(name) = line(Some(name), MAX_NAME, "assignees")? {
                assignees.push(name);
            }
        }
        if self.body_text.len() > MAX_BODY_BYTES || has_control(&self.body_text, true) {
            return Err(Rejected::Body);
        }
        Ok(Item {
            kind: self.kind,
            id: self.id,
            path: self.path,
            title,
            workspace_name: line(self.workspace_name, MAX_NAME, "workspaceName")?,
            project_name: line(self.project_name, MAX_NAME, "projectName")?,
            status: line(self.status, MAX_LABEL, "status")?,
            priority: line(self.priority, MAX_LABEL, "priority")?,
            due_date: line(self.due_date, MAX_DATE, "dueDate")?,
            assignees,
            body_text: self.body_text,
            updated_at: line(self.updated_at, MAX_DATE, "updatedAt")?,
            saved_at: now,
        })
    }
}

#[derive(Default, Serialize, Deserialize)]
struct CacheFile {
    /// The user id of the account whose copies these are, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    owner: Option<String>,
    #[serde(default)]
    items: Vec<Item>,
}

fn item_size(item: &Item) -> usize {
    serde_json::to_vec(item).map_or(usize::MAX, |bytes| bytes.len())
}

/// The most recent `MAX_ITEMS`, then the oldest dropped while the total is
/// over `MAX_TOTAL_BYTES` (the newest one always stays).
fn trim(items: &mut Vec<Item>) {
    items.truncate(MAX_ITEMS);
    let mut total: usize = items.iter().map(item_size).fold(0, usize::saturating_add);
    while items.len() > 1 && total > MAX_TOTAL_BYTES {
        if let Some(dropped) = items.pop() {
            total = total.saturating_sub(item_size(&dropped));
        }
    }
}

/// One server's saved copies, in its own directory.
#[derive(Debug, Clone)]
pub struct Cache {
    dir: PathBuf,
}

impl Cache {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn file(&self) -> PathBuf {
        self.dir.join(ITEMS_FILE)
    }

    /// Items most recently opened first. A missing, oversized or unreadable
    /// file is an empty cache.
    fn read_file(&self) -> CacheFile {
        let file = self.file();
        let too_big = fs::metadata(&file).map_or(true, |meta| meta.len() > MAX_FILE_BYTES);
        if too_big {
            return CacheFile::default();
        }
        fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<CacheFile>(&bytes).ok())
            .unwrap_or_default()
    }

    fn read(&self) -> Vec<Item> {
        self.read_file().items
    }

    fn write(&self, file: &CacheFile) -> std::io::Result<()> {
        fs::create_dir_all(&self.dir)?;
        let bytes = serde_json::to_vec(file).map_err(std::io::Error::other)?;
        let temporary = self.dir.join(format!("{ITEMS_FILE}.tmp"));
        fs::write(&temporary, bytes)?;
        fs::rename(&temporary, self.file())
    }

    /// Keeps `item` as the most recently opened, replacing an older copy of
    /// the same task or page, if `allowed()` says so. It is asked while the
    /// file's lock is held, so a sign-out or clear that got there first
    /// wins. True when the copy was written.
    pub fn save(&self, item: Item, allowed: impl FnOnce() -> bool) -> std::io::Result<bool> {
        let guard = dir_lock(&self.dir);
        let _guard = lock(&guard);
        if !allowed() {
            return Ok(false);
        }
        let mut file = self.read_file();
        file.items
            .retain(|known| !(known.kind == item.kind && known.id == item.id));
        file.items.insert(0, item);
        trim(&mut file.items);
        self.write(&file).map(|()| true)
    }

    pub fn list(&self) -> Vec<ItemSummary> {
        let guard = dir_lock(&self.dir);
        let _guard = lock(&guard);
        self.read().iter().map(ItemSummary::from).collect()
    }

    pub fn get(&self, kind: ItemKind, id: &str) -> Option<Item> {
        let guard = dir_lock(&self.dir);
        let _guard = lock(&guard);
        self.read()
            .into_iter()
            .find(|item| item.kind == kind && item.id == id)
    }

    /// After a sign-in as `user` (None when the server didn't say who):
    /// keeps the copies only when they are known to be that same account's,
    /// deletes them otherwise, and records `user` as their owner. True when
    /// copies were deleted.
    pub fn claim(&self, user: Option<&str>) -> bool {
        let guard = dir_lock(&self.dir);
        let _guard = lock(&guard);
        let file = self.read_file();
        let same_account = user.is_some() && file.owner.as_deref() == user;
        let dropped = !same_account && !file.items.is_empty();
        let kept = CacheFile {
            owner: user.map(str::to_string),
            items: if same_account { file.items } else { Vec::new() },
        };
        if kept.owner.is_none() {
            self.remove_files();
        } else if let Err(error) = self.write(&kept) {
            log::warn!("could not update saved offline copies: {error}");
            self.remove_files();
        }
        dropped
    }

    fn remove_files(&self) {
        if self.dir.exists() {
            if let Err(error) = fs::remove_dir_all(&self.dir) {
                log::warn!("could not delete saved offline copies: {error}");
            }
        }
    }

    /// Deletes every copy, and the server's profile directory too when
    /// nothing else is in it.
    pub fn clear(&self) {
        let guard = dir_lock(&self.dir);
        let _guard = lock(&guard);
        self.remove_files();
        if let Some(profile) = self.dir.parent() {
            let _ = fs::remove_dir(profile);
        }
    }
}

/// `profiles/<id>/offline` under `profiles`.
pub fn server_dir(profiles: &Path, server_id: &str) -> PathBuf {
    profiles.join(server_id).join("offline")
}

/// The cache a server window may read: its own server's, from a main or
/// additional window. Popups and every other window get none.
pub fn cache_for_window(profiles: &Path, label: &str) -> Option<Cache> {
    match servers::parse_window_label(label)? {
        WindowKind::Primary(id) | WindowKind::Secondary(id, _) => {
            Some(Cache::new(server_dir(profiles, id)))
        }
        WindowKind::Popup(..) => None,
    }
}

/// Deletes the copies of every server under `profiles`, including servers
/// that are gone from the list.
pub fn clear_all_under(profiles: &Path) {
    let Ok(entries) = fs::read_dir(profiles) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if uuid::Uuid::parse_str(&name).is_ok() {
            Cache::new(server_dir(profiles, &name)).clear();
        }
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

/// The same base as `windows::profile_dir`.
pub fn profiles_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(AppError::internal)?;
    Ok(base.join("profiles"))
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineSettings {
    pub enabled: bool,
}

impl Default for OfflineSettings {
    fn default() -> Self {
        Self { enabled: true }
    }
}

fn settings_file(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app.path().app_config_dir().map_err(AppError::internal)?;
    Ok(dir.join(SETTINGS_FILE))
}

fn read_settings(path: &Path) -> OfflineSettings {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// "Keep recent items for offline reading" (on by default).
pub fn enabled(app: &AppHandle) -> bool {
    settings_file(app).is_ok_and(|path| read_settings(&path).enabled)
}

fn mark_forgotten(server_id: &str) {
    let mut forgotten = lock(&FORGOTTEN);
    let map = forgotten.get_or_insert_with(HashMap::new);
    map.retain(|_, at| at.elapsed() < FORGET_GRACE);
    map.insert(server_id.to_string(), Instant::now());
}

fn recently_forgotten(server_id: &str) -> bool {
    lock(&FORGOTTEN)
        .as_ref()
        .and_then(|map| map.get(server_id))
        .is_some_and(|at| at.elapsed() < FORGET_GRACE)
}

/// Whether a copy that arrived under sign-in `session` may still be
/// written: the same sign-in is current, its copies weren't just deleted, and
/// the setting is on.
fn still_wanted(app: &AppHandle, server_id: &str, session: u64) -> bool {
    app.state::<AppState>().session(server_id) == Some(session)
        && !recently_forgotten(server_id)
        && enabled(app)
}

/// Keeps a snapshot from the bridge. The sender was already checked
/// (`bridge::sender_server`): it is this server's page in its own window.
/// A window left open after a sign-out in the launcher keeps sending; only a
/// server signed in natively keeps copies.
pub fn save_snapshot(app: &AppHandle, server: &Server, snapshot: Snapshot) {
    let Some(session) = app.state::<AppState>().session(&server.id) else {
        return;
    };
    if recently_forgotten(&server.id) || !enabled(app) {
        return;
    }
    let item = match snapshot.validate(server, now_millis()) {
        Ok(item) => item,
        Err(reason) => {
            log::warn!("refused an offline snapshot ({reason:?})");
            return;
        }
    };
    let delay = lock(&WRITES).offer(&server.id, Pending { item, session }, Instant::now());
    if let Some(delay) = delay {
        let app = app.clone();
        let server_id = server.id.clone();
        tauri::async_runtime::spawn(write_pending(app, server_id, delay));
    }
}

/// One server's writer: writes the newest waiting snapshot, then waits
/// [`MIN_WRITE_INTERVAL`] before the next, until nothing is waiting.
async fn write_pending(app: AppHandle, server_id: String, delay: Duration) {
    tokio::time::sleep(delay).await;
    loop {
        // Its own statement, so the lock is released before any await.
        let next = lock(&WRITES).take(&server_id, Instant::now());
        let Some(Pending { item, session }) = next else {
            return;
        };
        if let Ok(profiles) = profiles_dir(&app) {
            let cache = Cache::new(server_dir(&profiles, &server_id));
            let check_app = app.clone();
            let check_id = server_id.clone();
            let saved = tauri::async_runtime::spawn_blocking(move || {
                cache.save(item, || still_wanted(&check_app, &check_id, session))
            })
            .await;
            if let Ok(Err(error)) = saved {
                log::warn!("could not keep an offline copy: {error}");
            }
        }
        tokio::time::sleep(MIN_WRITE_INTERVAL).await;
    }
}

/// Deletes one server's copies (sign-out, removal).
pub fn forget(app: &AppHandle, server_id: &str) {
    mark_forgotten(server_id);
    lock(&WRITES).discard(server_id);
    if let Ok(profiles) = profiles_dir(app) {
        Cache::new(server_dir(&profiles, server_id)).clear();
    }
}

/// After a server stored a token for `user` (None when unknown): deletes the
/// copies unless they are known to be that same account's.
pub fn claim(app: &AppHandle, server_id: &str, user: Option<&str>) {
    lock(&WRITES).discard(server_id);
    if let Ok(profiles) = profiles_dir(app) {
        if Cache::new(server_dir(&profiles, server_id)).claim(user) {
            log::info!("signed in as another account; deleted the saved offline copies");
        }
    }
}

fn forget_all(app: &AppHandle) {
    let servers: Vec<String> = app
        .state::<crate::state::AppState>()
        .servers()
        .into_iter()
        .map(|server| server.id)
        .collect();
    for id in &servers {
        mark_forgotten(id);
    }
    lock(&WRITES).discard_all();
    if let Ok(profiles) = profiles_dir(app) {
        clear_all_under(&profiles);
    }
}

#[tauri::command]
pub fn get_offline_reading(app: AppHandle) -> OfflineSettings {
    OfflineSettings {
        enabled: enabled(&app),
    }
}

/// Turning it off deletes every server's copies.
#[tauri::command]
pub async fn set_offline_reading(app: AppHandle, enabled: bool) -> AppResult<()> {
    let path = settings_file(&app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(AppError::internal)?;
    }
    let bytes = serde_json::to_vec(&OfflineSettings { enabled }).map_err(AppError::internal)?;
    fs::write(&path, bytes).map_err(AppError::internal)?;
    if !enabled {
        forget_all(&app);
    }
    Ok(())
}

/// "Clear saved copies": every server's.
#[tauri::command]
pub async fn clear_offline_copies(app: AppHandle) -> AppResult<()> {
    forget_all(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "11111111-1111-4111-8111-111111111111";
    const B: &str = "22222222-2222-4222-8222-222222222222";

    fn make_server(web: &str, api: &str) -> Server {
        Server {
            id: A.into(),
            label: "x".into(),
            web_url: web.into(),
            api_url: api.into(),
            server_version: None,
            added_at: 0,
            last_used_at: None,
            reopen: false,
            sound_muted: false,
        }
    }

    fn same_origin() -> Server {
        make_server("https://pm.example", "https://pm.example")
    }

    fn snapshot(id: &str) -> Snapshot {
        Snapshot {
            kind: ItemKind::Task,
            id: id.into(),
            path: format!("/dashboard/workspace/w/project/p/task/{id}"),
            title: "Fix the login".into(),
            workspace_name: Some("Acme".into()),
            project_name: Some("Web".into()),
            status: Some("In progress".into()),
            priority: Some("High".into()),
            due_date: Some("2026-11-20T00:00:00.000Z".into()),
            assignees: vec!["Ada".into()],
            body_text: "# Steps\n- one\n- two".into(),
            updated_at: None,
        }
    }

    fn item(id: &str, body: usize) -> Item {
        let mut snap = snapshot(id);
        snap.body_text = "x".repeat(body);
        snap.validate(&same_origin(), 1).unwrap()
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "margaya-offline-test-{name}-{}-{}",
            std::process::id(),
            now_millis()
        ));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn reads_the_bridge_message() {
        let json = r#"{"kind":"task","id":"t1","path":"/dashboard/x","title":"T","workspaceName":"W","projectName":null,"status":"Todo","priority":null,"dueDate":null,"assignees":["A"],"bodyText":"hi","updatedAt":null}"#;
        let parsed: Snapshot = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.kind, ItemKind::Task);
        assert_eq!(parsed.assignees, vec!["A".to_string()]);
        // Unknown kinds and fields are refused.
        assert!(serde_json::from_str::<Snapshot>(
            r#"{"kind":"whiteboard","id":"t1","path":"/x","title":"T"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<Snapshot>(
            r#"{"kind":"page","id":"t1","path":"/x","title":"T","bodyHtml":"<b>x</b>"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<Snapshot>(
            r#"{"kind":"page","id":"t1","path":"/x","title":"T","token":"secret"}"#
        )
        .is_err());
    }

    #[test]
    fn accepts_only_web_pages_of_the_server() {
        let server = same_origin();
        assert!(valid_path(&server, "/dashboard/workspace/w/project/p/task/t"));
        assert!(valid_path(&server, "/dashboard/x?taskId=1#top"));
        for bad in [
            "/api/task/1",
            "/API/task/1",
            "/api",
            "/dashboard/../api/task/1",
            "/dashboard/%2e%2e/api/task/1",
            "//evil.example/x",
            "https://evil.example/x",
            "/\\evil.example",
            "dashboard",
            "",
            "/a\nb",
        ] {
            assert!(!valid_path(&server, bad), "{bad:?}");
        }
        assert!(!valid_path(&server, &format!("/{}", "a".repeat(MAX_PATH))));
        // A web UI under a base path keeps it, and its own /api is refused.
        let based = make_server("https://pm.example/margaya", "https://pm.example/margaya");
        assert!(valid_path(&based, "/dashboard/x"));
        assert!(!valid_path(&based, "/api/task/1"));
        assert!(!valid_path(&based, "/../other"));
        // An API on another origin: /api on the web origin is still refused.
        let split = make_server("https://app.example", "https://api.example");
        assert!(!valid_path(&split, "/api/x"));
        assert!(valid_path(&split, "/dashboard"));
    }

    #[test]
    fn validates_and_caps_every_field() {
        let server = same_origin();
        assert!(snapshot("task-1_A").validate(&server, 5).is_ok());
        let check = |change: fn(&mut Snapshot)| {
            let mut snap = snapshot("t1");
            change(&mut snap);
            snap.validate(&server, 5).err()
        };
        assert_eq!(check(|s| s.id = String::new()), Some(Rejected::Id));
        assert_eq!(check(|s| s.id = "../x".into()), Some(Rejected::Id));
        assert_eq!(check(|s| s.id = "a".repeat(MAX_ID + 1)), Some(Rejected::Id));
        assert_eq!(check(|s| s.path = "/api/task/1".into()), Some(Rejected::Path));
        assert_eq!(
            check(|s| s.title = "a".repeat(MAX_TITLE + 1)),
            Some(Rejected::Field("title"))
        );
        assert_eq!(
            check(|s| s.title = "a\u{7}b".into()),
            Some(Rejected::Field("title"))
        );
        assert_eq!(
            check(|s| s.status = Some("a\nb".into())),
            Some(Rejected::Field("status"))
        );
        assert_eq!(
            check(|s| s.assignees = vec!["x".into(); MAX_ASSIGNEES + 1]),
            Some(Rejected::Field("assignees"))
        );
        assert_eq!(
            check(|s| s.body_text = "a".repeat(MAX_BODY_BYTES + 1)),
            Some(Rejected::Body)
        );
        assert_eq!(check(|s| s.body_text = "a\u{0}b".into()), Some(Rejected::Body));
        // Line breaks and tabs are fine in the body; blanks become None.
        let mut snap = snapshot("t1");
        snap.body_text = "a\n\tb".into();
        snap.project_name = Some("   ".into());
        let item = snap.validate(&server, 7).unwrap();
        assert_eq!(item.project_name, None);
        assert_eq!(item.saved_at, 7);
        let mut snap = snapshot("t1");
        snap.body_text = "a".repeat(MAX_BODY_BYTES);
        assert!(snap.validate(&server, 1).is_ok());
    }

    #[test]
    fn keeps_the_most_recent_items_first() {
        let dir = temp_dir("lru");
        let cache = Cache::new(dir.clone());
        for n in 0..(MAX_ITEMS + 5) {
            cache.save(item(&format!("t{n}"), 10), || true).unwrap();
        }
        let list = cache.list();
        assert_eq!(list.len(), MAX_ITEMS);
        assert_eq!(list[0].id, format!("t{}", MAX_ITEMS + 4));
        assert!(list.iter().all(|entry| entry.id != "t0"));
        // Opening an older item again moves it to the front, once.
        cache.save(item("t10", 10), || true).unwrap();
        let list = cache.list();
        assert_eq!(list[0].id, "t10");
        assert_eq!(list.iter().filter(|entry| entry.id == "t10").count(), 1);
        assert_eq!(list.len(), MAX_ITEMS);
        // A page and a task may share an id.
        let mut page = item("t10", 1);
        page.kind = ItemKind::Page;
        cache.save(page, || true).unwrap();
        assert!(cache.get(ItemKind::Page, "t10").is_some());
        assert!(cache.get(ItemKind::Task, "t10").is_some());
        assert!(cache.get(ItemKind::Task, "missing").is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn caps_the_total_size() {
        let dir = temp_dir("size");
        let cache = Cache::new(dir.clone());
        for n in 0..30 {
            cache
                .save(item(&format!("t{n}"), MAX_BODY_BYTES), || true)
                .unwrap();
        }
        let on_disk = fs::metadata(dir.join(ITEMS_FILE)).unwrap().len() as usize;
        assert!(on_disk <= MAX_TOTAL_BYTES + 1024, "{on_disk}");
        let list = cache.list();
        assert!(list.len() < 30);
        assert_eq!(list[0].id, "t29");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignores_a_damaged_file() {
        let dir = temp_dir("damaged");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(ITEMS_FILE), b"{not json").unwrap();
        let cache = Cache::new(dir.clone());
        assert!(cache.list().is_empty());
        cache.save(item("t1", 1), || true).unwrap();
        assert_eq!(cache.list().len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn answers_each_window_with_its_own_server_only() {
        let profiles = temp_dir("isolation");
        Cache::new(server_dir(&profiles, A))
            .save(item("only-a", 1), || true)
            .unwrap();
        let read = |label: &str| cache_for_window(&profiles, label).map(|cache| cache.list());
        let a = read(&format!("server-{A}")).unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(read(&format!("server-{A}-2")).unwrap(), a);
        assert!(read(&format!("server-{B}")).unwrap().is_empty());
        assert!(cache_for_window(&profiles, &format!("server-{B}"))
            .unwrap()
            .get(ItemKind::Task, "only-a")
            .is_none());
        assert!(read(&format!("popup-{A}-1")).is_none());
        assert!(read("main").is_none());
        assert!(read("quick-add").is_none());
        assert!(read("server-../x").is_none());
        let _ = fs::remove_dir_all(&profiles);
    }

    #[test]
    fn deletes_one_server_or_all() {
        let profiles = temp_dir("delete");
        for id in [A, B] {
            Cache::new(server_dir(&profiles, id))
                .save(item("t1", 1), || true)
                .unwrap();
        }
        // Another server's webview data next to it stays.
        fs::write(profiles.join(B).join("cookies"), b"x").unwrap();
        // Sign-out or removal of A.
        Cache::new(server_dir(&profiles, A)).clear();
        assert!(!server_dir(&profiles, A).exists());
        assert!(!profiles.join(A).exists());
        assert_eq!(Cache::new(server_dir(&profiles, B)).list().len(), 1);
        // The setting turned off, or "Clear saved copies".
        clear_all_under(&profiles);
        assert!(!server_dir(&profiles, B).exists());
        assert!(profiles.join(B).join("cookies").exists());
        let _ = fs::remove_dir_all(&profiles);
    }

    #[test]
    fn stores_no_secrets() {
        // The stored shape has exactly these fields; nothing else from a
        // page can reach the file.
        let value = serde_json::to_value(item("t1", 1)).unwrap();
        let mut keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "assignees",
                "bodyText",
                "dueDate",
                "id",
                "kind",
                "path",
                "priority",
                "projectName",
                "savedAt",
                "status",
                "title",
                "updatedAt",
                "workspaceName"
            ]
        );
    }

    #[test]
    fn forgets_recent_sign_outs_for_a_moment() {
        assert!(!recently_forgotten("x-server"));
        mark_forgotten("x-server");
        assert!(recently_forgotten("x-server"));
        assert!(!recently_forgotten("y-server"));
    }

    #[test]
    fn writes_only_while_allowed_under_the_lock() {
        let dir = temp_dir("allowed");
        let cache = Cache::new(dir.clone());
        // Signed out (or a newer sign-in) by the time the lock is held:
        // nothing is written, not even an empty file.
        assert!(!cache.save(item("t1", 1), || false).unwrap());
        assert!(!dir.join(ITEMS_FILE).exists());
        assert!(cache.save(item("t1", 1), || true).unwrap());
        assert_eq!(cache.list().len(), 1);
        // A save that was already in flight when the copies were cleared
        // asks again after the clear, and stays out.
        cache.clear();
        assert!(!cache.save(item("t2", 1), || false).unwrap());
        assert!(!dir.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn coalesces_writes_per_server() {
        let start = Instant::now();
        let mut writes = Coalescer::default();
        // The first snapshot is written at once.
        assert_eq!(writes.offer("a", 1, start), Some(Duration::ZERO));
        // While the writer runs, newer snapshots only replace the waiting
        // one: no second writer, and the newest wins.
        assert_eq!(writes.take("a", start), Some(1));
        assert_eq!(writes.offer("a", 2, start), None);
        assert_eq!(writes.offer("a", 3, start), None);
        // Another server has its own writer and pace.
        assert_eq!(writes.offer("b", 9, start), Some(Duration::ZERO));
        let later = start + MIN_WRITE_INTERVAL;
        assert_eq!(writes.take("a", later), Some(3));
        assert_eq!(
            writes.take("a", later),
            None,
            "nothing left: the writer ends"
        );
        // A snapshot soon after the last write waits out the rest of the
        // interval.
        let soon = later + Duration::from_millis(300);
        assert_eq!(
            writes.offer("a", 4, soon),
            Some(MIN_WRITE_INTERVAL - Duration::from_millis(300))
        );
        // Deleted copies drop what was waiting.
        writes.discard("a");
        assert_eq!(writes.take("a", soon), None);
        assert_eq!(
            writes.offer("a", 5, soon + MIN_WRITE_INTERVAL),
            Some(Duration::ZERO)
        );
        writes.discard_all();
        assert_eq!(writes.take("a", soon), None);
        assert_eq!(writes.take("b", soon), None);
        assert_eq!(writes.take("unknown", soon), None);
    }

    #[test]
    fn a_page_that_loops_gets_one_write_a_second() {
        let start = Instant::now();
        let mut writes = Coalescer::default();
        let mut written = 0;
        let mut writer_until: Option<Instant> = None;
        // 1,000 snapshots over 5 seconds, with the writer taking one per
        // interval, as write_pending does.
        for step in 0..1000u64 {
            let now = start + Duration::from_millis(step * 5);
            if let Some(delay) = writes.offer("a", step, now) {
                writer_until = Some(now + delay);
            }
            if writer_until.is_some_and(|due| now >= due) {
                match writes.take("a", now) {
                    Some(_) => {
                        written += 1;
                        writer_until = Some(now + MIN_WRITE_INTERVAL);
                    }
                    None => writer_until = None,
                }
            }
        }
        assert!((5..=6).contains(&written), "{written} writes");
    }

    #[test]
    fn keeps_copies_only_for_the_same_account() {
        let dir = temp_dir("claim");
        let cache = Cache::new(dir.clone());
        // Copies saved before anyone was known: a sign-in can't tell whose
        // they are, so they go.
        cache.save(item("t1", 1), || true).unwrap();
        assert!(cache.claim(Some("user-a")));
        assert!(cache.list().is_empty());
        // Now owned by user-a: saves keep the owner, and the same account
        // signing in again keeps them.
        cache.save(item("t2", 1), || true).unwrap();
        assert!(!cache.claim(Some("user-a")));
        assert_eq!(cache.list().len(), 1);
        // Another account signs in on the same server: deleted.
        assert!(cache.claim(Some("user-b")));
        assert!(cache.list().is_empty());
        cache.save(item("t3", 1), || true).unwrap();
        // Unknown identity (the server didn't answer): deleted, never kept.
        assert!(cache.claim(None));
        assert!(cache.list().is_empty());
        assert!(!dir.exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
