//! The Files window (`#files` in the launcher bundle): a read-only explorer
//! over folders the person picked, with an in-app preview, "Save a copy…"
//! and dragging a file out onto a task in a server window.
//!
//! Nothing here writes to a picked folder. The page reads only through these
//! commands, each of which checks its window is `files` and every path
//! against [`files_scope::Scope`]: places come only from the system folder
//! picker (or a folder dropped on the window), single files only from a drop.
//! The places persist in `files.json` next to `servers.json` and are granted
//! again at start only while each folder still resolves where it did when
//! it was picked. Remove a place and it grants nothing from then on.
//!
//! Audio and video stream through `margaya-file:` (Range requests) under
//! one-time ids this module hands out; the handler answers only the `files`
//! webview, so a server page can't use it even with an id. No static
//! capability grants `fs:`, `dialog:` or `opener:` to any page.

use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, Emitter, Manager, State, UriSchemeContext, UriSchemeResponder, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, Wry,
};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::files_scope::{self, Crumb, Denied, Entry, EntryKind, Listing, Root, Scope, SearchOutcome};
use crate::state::lock;
use crate::{i18n, opener, windows};

pub const LABEL: &str = "files";
const STORE_FILE: &str = "files.json";
/// The custom scheme audio and video stream through.
pub const PROTOCOL: &str = "margaya-file";
/// Recent files kept.
pub const RECENT_LIMIT: usize = 20;
/// Places kept.
pub const MAX_PLACES: usize = 50;
/// Largest file read whole into the page for a preview.
pub const MAX_READ_BYTES: u64 = 200 * 1024 * 1024;
/// Most bytes one streamed range answers with.
const STREAM_CHUNK: u64 = 4 * 1024 * 1024;
/// Stream ids kept (the newest).
const MAX_STREAMS: usize = 32;
/// How long checking the places (and, separately, the Recent files) may
/// take. A mapped drive whose server is unreachable can hold one
/// file-system call for the whole network timeout; past this the place or
/// file shows as unavailable and grants nothing until a later check.
const DISK_WAIT: Duration = Duration::from_millis(1500);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct StoredPlace {
    id: String,
    /// As the person picked it.
    path: String,
    /// Resolved when it was picked.
    canonical: String,
    added_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct StoredRecent {
    path: String,
    canonical: String,
    /// Readable only because it was dropped on the window (not in a place):
    /// it stays readable while it is in Recent.
    via_drop: bool,
    opened_at: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    #[serde(default)]
    places: Vec<StoredPlace>,
    #[serde(default)]
    recent: Vec<StoredRecent>,
}

#[derive(Default)]
struct Inner {
    file: Option<PathBuf>,
    places: Vec<StoredPlace>,
    roots: Vec<Root>,
    recent: Vec<StoredRecent>,
    /// Files dropped on the window this run.
    dropped: HashSet<PathBuf>,
    /// Stream ids handed out, oldest first.
    streams: VecDeque<(String, PathBuf)>,
    searches: HashMap<u32, Arc<AtomicBool>>,
    /// Places are checked against the disk once before the first read.
    roots_checked: bool,
    /// Counts changes to what `files.json` holds.
    revision: u64,
}

/// The Files window's state: places, Recent and what they grant.
#[derive(Default)]
pub struct FilesState {
    inner: Mutex<Inner>,
    /// The revision `files.json` was last written at. Held while writing,
    /// so an older snapshot never lands after a newer one.
    written: Mutex<u64>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// A place's root: granted only while its folder resolves (`now`) where it
/// did when it was picked.
fn root_with(place: &StoredPlace, now: Option<&Path>) -> Root {
    let canonical = PathBuf::from(&place.canonical);
    Root {
        id: place.id.clone(),
        display: PathBuf::from(&place.path),
        available: now.is_some_and(|now| now == canonical),
        canonical,
    }
}

/// Paths a bounded check is still waiting on. A path stays here until its
/// call returns, so an unreachable drive ties up at most one thread per
/// path however often the window asks.
fn pending_checks() -> &'static Mutex<HashSet<PathBuf>> {
    static PENDING: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    PENDING.get_or_init(Mutex::default)
}

struct PendingGuard(PathBuf);

impl Drop for PendingGuard {
    fn drop(&mut self) {
        lock(pending_checks()).remove(&self.0);
    }
}

type DiskJob<T> = Box<dyn FnOnce() -> T + Send>;

/// Runs each job on its own thread, keyed by the path it touches, and waits
/// for them together until `limit` has passed. A job still running then, or
/// one whose path an earlier call is still waiting on, gives None.
fn bounded_all<T: Send + 'static>(jobs: Vec<(PathBuf, DiskJob<T>)>, limit: Duration) -> Vec<Option<T>> {
    let deadline = Instant::now() + limit;
    let receivers: Vec<Option<mpsc::Receiver<T>>> = jobs
        .into_iter()
        .map(|(key, job)| {
            if !lock(pending_checks()).insert(key.clone()) {
                return None;
            }
            let guard = PendingGuard(key);
            let (sender, receiver) = mpsc::channel();
            std::thread::Builder::new()
                .name("files-check".into())
                .spawn(move || {
                    let result = job();
                    // Free the path before answering: freed after, a check
                    // made right after this one could still find it busy
                    // and report the place unavailable.
                    drop(guard);
                    let _ = sender.send(result);
                })
                .ok()
                .map(|_| receiver)
        })
        .collect();
    receivers
        .into_iter()
        .map(|receiver| {
            receiver?
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .ok()
        })
        .collect()
}

/// Every place's root, resolved off the state lock and at most
/// [`DISK_WAIT`] in all. Network and device paths are never touched.
fn check_roots(places: &[StoredPlace]) -> Vec<Root> {
    let jobs = places
        .iter()
        .map(|place| {
            let display = PathBuf::from(&place.path);
            let job: DiskJob<Option<PathBuf>> = Box::new(move || {
                if files_scope::is_remote_or_device_path(&display) {
                    return None;
                }
                files_scope::canonical(&display).ok()
            });
            (PathBuf::from(&place.path), job)
        })
        .collect();
    places
        .iter()
        .zip(bounded_all(jobs, DISK_WAIT))
        .map(|(place, now)| root_with(place, now.flatten().as_deref()))
        .collect()
}

/// Checks a folder the person picked or dropped. Touches the disk: call it
/// without holding the state lock.
fn check_place(picked: &Path) -> AppResult<PathBuf> {
    if !picked.is_absolute() || files_scope::is_remote_or_device_path(picked) {
        return Err(denied(Denied::Outside));
    }
    let canonical = files_scope::canonical(picked).map_err(denied)?;
    if !canonical.is_dir() {
        return Err(AppError::new(ErrorKind::FileWrongKind, "not a folder"));
    }
    Ok(canonical)
}

fn write_store(file: &Path, stored: &Stored) {
    let Ok(text) = serde_json::to_string_pretty(stored) else {
        return;
    };
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    // Write then rename, so a crash never leaves half a file.
    let temp = file.with_extension("json.tmp");
    if let Err(error) = fs::write(&temp, text).and_then(|()| fs::rename(&temp, file)) {
        log::warn!("could not save the Files window's places: {error}");
    }
}

impl Inner {
    fn scope(&self) -> Scope {
        let mut files = self.dropped.clone();
        files.extend(
            self.recent
                .iter()
                .filter(|item| item.via_drop)
                .map(|item| PathBuf::from(&item.canonical)),
        );
        Scope {
            roots: self.roots.clone(),
            files,
        }
    }

    fn stored(&self) -> Stored {
        Stored {
            places: self.places.clone(),
            recent: self.recent.clone(),
        }
    }

    fn changed(&mut self) {
        self.revision += 1;
    }

    /// Adds a folder [`check_place`] resolved to `canonical`; returns its id.
    fn insert_place(&mut self, picked: &Path, canonical: PathBuf) -> AppResult<String> {
        let canonical_text = canonical.to_string_lossy().into_owned();
        if let Some(existing) = self.places.iter().find(|place| place.canonical == canonical_text) {
            return Ok(existing.id.clone());
        }
        if self.places.len() >= MAX_PLACES {
            return Err(AppError::new(ErrorKind::FileTooMany, "too many places"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let place = StoredPlace {
            id: id.clone(),
            path: files_scope::simplified(picked).to_string_lossy().into_owned(),
            canonical: canonical_text,
            added_at: now_ms(),
        };
        // Just resolved, so granted now; the other places keep their check.
        self.roots.push(root_with(&place, Some(&canonical)));
        self.places.push(place);
        self.changed();
        Ok(id)
    }

    #[cfg(test)]
    fn add_place(&mut self, picked: &Path) -> AppResult<String> {
        let canonical = check_place(picked)?;
        self.insert_place(picked, canonical)
    }

    /// Removes a place. Recent files it granted go with it, and so do the
    /// stream ids under it.
    fn remove_place(&mut self, id: &str) {
        let Some(index) = self.places.iter().position(|place| place.id == id) else {
            return;
        };
        let place = self.places.remove(index);
        let canonical = PathBuf::from(&place.canonical);
        self.recent
            .retain(|item| item.via_drop || !Path::new(&item.canonical).starts_with(&canonical));
        self.streams.retain(|(_, path)| !path.starts_with(&canonical));
        self.roots.retain(|root| root.id != place.id);
        self.changed();
    }

    fn add_recent(&mut self, resolved: &files_scope::Resolved) {
        let canonical = resolved.canonical.to_string_lossy().into_owned();
        // A file once granted by a drop keeps that grant while in Recent.
        let was_dropped = self
            .recent
            .iter()
            .any(|item| item.canonical == canonical && item.via_drop);
        self.recent.retain(|item| item.canonical != canonical);
        self.recent.insert(
            0,
            StoredRecent {
                path: resolved.display.to_string_lossy().into_owned(),
                canonical,
                via_drop: resolved.root.is_none() || was_dropped,
                opened_at: now_ms(),
            },
        );
        self.recent.truncate(RECENT_LIMIT);
        self.changed();
    }

    fn remove_recent(&mut self, path: &str) {
        let removed: Vec<StoredRecent> = self
            .recent
            .iter()
            .filter(|item| item.path == path)
            .cloned()
            .collect();
        self.recent.retain(|item| item.path != path);
        for item in removed {
            self.dropped.remove(Path::new(&item.canonical));
        }
        self.changed();
    }
}

impl FilesState {
    /// Loads `files.json` from the app's config folder; a missing or broken
    /// file starts empty (a broken one is kept aside).
    pub fn load(dir: &Path) -> Self {
        let file = dir.join(STORE_FILE);
        let stored: Stored = match fs::read_to_string(&file) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|error| {
                log::warn!("the Files window's places couldn't be read ({error}); starting empty");
                let _ = fs::rename(&file, file.with_extension("json.broken"));
                Stored::default()
            }),
            Err(_) => Stored::default(),
        };
        let mut inner = Inner {
            file: Some(file),
            places: stored.places,
            recent: stored.recent,
            ..Inner::default()
        };
        inner.places.truncate(MAX_PLACES);
        inner.recent.truncate(RECENT_LIMIT);
        // Granted only once checked (`scope`): this runs at start, on the
        // main thread, where an unreachable drive must not hold it.
        inner.roots = inner.places.iter().map(|place| root_with(place, None)).collect();
        Self {
            inner: Mutex::new(inner),
            written: Mutex::default(),
        }
    }

    /// What the window may read now. The first call checks the places
    /// against the disk: call it off the main thread.
    fn scope(&self) -> Scope {
        if !lock(&self.inner).roots_checked {
            self.refresh_roots();
        }
        lock(&self.inner).scope()
    }

    /// Checks every place against the disk again, without holding the lock
    /// while it does.
    fn refresh_roots(&self) {
        let places = lock(&self.inner).places.clone();
        let checked = check_roots(&places);
        let mut inner = lock(&self.inner);
        // A place added or removed meanwhile keeps what that change set.
        let roots = inner
            .places
            .iter()
            .map(|place| {
                checked
                    .iter()
                    .chain(inner.roots.iter())
                    .find(|root| root.id == place.id)
                    .cloned()
                    .unwrap_or_else(|| root_with(place, None))
            })
            .collect();
        inner.roots = roots;
        inner.roots_checked = true;
    }

    /// Writes `files.json` when it changed since it was last written. Call
    /// it after a change, off the main thread and without the state lock.
    fn persist(&self) {
        let (file, revision, stored) = {
            let inner = lock(&self.inner);
            (inner.file.clone(), inner.revision, inner.stored())
        };
        let Some(file) = file else {
            return;
        };
        let mut written = lock(&self.written);
        if revision > *written {
            write_store(&file, &stored);
            *written = revision;
        }
    }
}

fn denied(reason: Denied) -> AppError {
    match reason {
        Denied::Outside => AppError::new(ErrorKind::FileOutside, "outside the Files window's places"),
        Denied::Missing => AppError::new(ErrorKind::FileMissing, "no such file or folder"),
        Denied::NoAccess => AppError::new(ErrorKind::FileNoAccess, "the system refused access"),
    }
}

/// Only the Files window may call these commands (the capability says so
/// too; this keeps it true if a capability file is ever widened).
fn check_caller(window: &WebviewWindow) -> AppResult<()> {
    if window.label() == LABEL {
        Ok(())
    } else {
        Err(AppError::new(ErrorKind::FileOutside, "not the Files window"))
    }
}

fn resolve(state: &FilesState, path: &str) -> AppResult<files_scope::Resolved> {
    state.scope().resolve(path).map_err(denied)
}

/// Touches the disk: call it inside [`blocking`].
fn resolve_file(state: &FilesState, path: &str) -> AppResult<(files_scope::Resolved, fs::Metadata)> {
    let resolved = resolve(state, path)?;
    let meta = fs::metadata(&resolved.canonical).map_err(|_| denied(Denied::Missing))?;
    if !meta.is_file() {
        return Err(AppError::new(ErrorKind::FileWrongKind, "not a file"));
    }
    Ok((resolved, meta))
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(AppError::internal)?
}

/// [`blocking`] with the Files window's state.
async fn with_state<T: Send + 'static>(
    app: &AppHandle,
    job: impl FnOnce(&FilesState) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let app = app.clone();
    blocking(move || job(&app.state::<FilesState>())).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceView {
    id: String,
    name: String,
    path: String,
    /// False when the folder is gone or now resolves somewhere else.
    available: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentView {
    #[serde(flatten)]
    entry: Entry,
    available: bool,
    opened_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    places: Vec<PlaceView>,
    recent: Vec<RecentView>,
}

/// Places and Recent as they are on disk now. Every check runs off the
/// state lock and is bounded by [`DISK_WAIT`].
fn overview(state: &FilesState) -> Overview {
    state.refresh_roots();
    let (roots, recent, scope) = {
        let inner = lock(&state.inner);
        (inner.roots.clone(), inner.recent.clone(), Arc::new(inner.scope()))
    };
    let places = roots
        .iter()
        .map(|root| PlaceView {
            id: root.id.clone(),
            name: files_scope::name_of(&root.display),
            path: root.display.to_string_lossy().into_owned(),
            available: root.available,
        })
        .collect();
    let jobs = recent
        .iter()
        .map(|item| {
            let (scope, path) = (scope.clone(), item.path.clone());
            let job: DiskJob<Option<Entry>> = Box::new(move || {
                let resolved = scope.resolve(&path).ok()?;
                files_scope::entry_for(&resolved.canonical, &resolved.display)
            });
            (PathBuf::from(&item.canonical), job)
        })
        .collect();
    let entries = bounded_all(jobs, DISK_WAIT);
    let recent = recent
        .iter()
        .zip(entries)
        .map(|(item, entry)| {
            let display = PathBuf::from(&item.path);
            let entry = entry.flatten();
            RecentView {
                available: entry.is_some(),
                entry: entry.unwrap_or_else(|| Entry {
                    name: files_scope::name_of(&display),
                    path: item.path.clone(),
                    kind: EntryKind::File,
                    size: None,
                    modified: None,
                    hidden: false,
                    link: false,
                    folder: None,
                }),
                opened_at: item.opened_at,
            }
        })
        .collect();
    Overview { places, recent }
}

// The Files commands that touch the disk are async and do it in `blocking`:
// a synchronous command runs on the main thread, where a slow or
// unreachable drive would freeze every window.
#[tauri::command]
pub async fn files_overview(window: WebviewWindow, app: AppHandle) -> AppResult<Overview> {
    check_caller(&window)?;
    with_state(&app, |state| Ok(overview(state))).await
}

/// The folder picker the person uses to add a place. In test builds,
/// `MARGAYA_E2E_PICK_FOLDER` stands in for the system dialog.
fn pick_folder(window: &WebviewWindow) -> Option<PathBuf> {
    #[cfg(feature = "e2e")]
    if let Some(path) = std::env::var_os("MARGAYA_E2E_PICK_FOLDER") {
        return Some(PathBuf::from(path));
    }
    use tauri_plugin_dialog::DialogExt;
    window
        .dialog()
        .file()
        .set_parent(window)
        .set_title(i18n::t("files.addFolderTitle"))
        .blocking_pick_folder()?
        .into_path()
        .ok()
}

/// Shows the system folder picker and adds what the person picked.
/// None when they cancelled.
#[tauri::command]
pub async fn files_add_folder(window: WebviewWindow, app: AppHandle) -> AppResult<Option<String>> {
    check_caller(&window)?;
    let picker = window.clone();
    let Some(picked) = blocking(move || Ok(pick_folder(&picker))).await? else {
        return Ok(None);
    };
    with_state(&app, move |state| {
        let canonical = check_place(&picked)?;
        let id = lock(&state.inner).insert_place(&picked, canonical)?;
        state.persist();
        Ok(Some(id))
    })
    .await
}

#[tauri::command]
pub async fn files_remove_folder(window: WebviewWindow, app: AppHandle, id: String) -> AppResult<()> {
    check_caller(&window)?;
    with_state(&app, move |state| {
        lock(&state.inner).remove_place(&id);
        state.persist();
        Ok(())
    })
    .await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderView {
    path: String,
    place_id: Option<String>,
    crumbs: Vec<Crumb>,
    #[serde(flatten)]
    listing: Listing,
}

#[tauri::command]
pub async fn files_list(window: WebviewWindow, app: AppHandle, path: String) -> AppResult<FolderView> {
    check_caller(&window)?;
    with_state(&app, move |state| {
        let scope = state.scope();
        let resolved = scope.resolve(&path).map_err(denied)?;
        if !resolved.canonical.is_dir() {
            return Err(AppError::new(ErrorKind::FileWrongKind, "not a folder"));
        }
        let listing = files_scope::list_dir(&resolved.canonical, &resolved.display, files_scope::MAX_LIST_ENTRIES)
            .map_err(denied)?;
        let crumbs = resolved
            .root
            .as_deref()
            .and_then(|id| scope.root(id))
            .map(|root| files_scope::crumbs(root, &resolved.display))
            .unwrap_or_default();
        Ok(FolderView {
            path: resolved.display.to_string_lossy().into_owned(),
            place_id: resolved.root,
            crumbs,
            listing,
        })
    })
    .await
}

/// A file's bytes, for the preview (at most [`MAX_READ_BYTES`]).
#[tauri::command]
pub async fn files_read(
    window: WebviewWindow,
    app: AppHandle,
    path: String,
) -> AppResult<tauri::ipc::Response> {
    check_caller(&window)?;
    with_state(&app, move |state| {
        let resolved = resolve(state, &path)?;
        let meta = fs::metadata(&resolved.canonical).map_err(|_| denied(Denied::Missing))?;
        if !meta.is_file() {
            return Err(AppError::new(ErrorKind::FileWrongKind, "not a file"));
        }
        if meta.len() > MAX_READ_BYTES {
            return Err(AppError::new(ErrorKind::FileTooLarge, "too large to preview"));
        }
        let bytes = fs::read(&resolved.canonical).map_err(|_| denied(Denied::NoAccess))?;
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
}

/// The address a media file streams from in the Files window.
#[tauri::command]
pub async fn files_stream_url(window: WebviewWindow, app: AppHandle, path: String) -> AppResult<String> {
    check_caller(&window)?;
    with_state(&app, move |state| {
        let (resolved, _) = resolve_file(state, &path)?;
        let id = uuid::Uuid::new_v4().simple().to_string();
        let mut inner = lock(&state.inner);
        inner.streams.push_back((id.clone(), resolved.canonical));
        while inner.streams.len() > MAX_STREAMS {
            inner.streams.pop_front();
        }
        Ok(stream_url(&id))
    })
    .await
}

/// `http://margaya-file.localhost/<id>` on Windows (WebView2 serves custom
/// schemes over http), `margaya-file://localhost/<id>` elsewhere.
pub fn stream_url(id: &str) -> String {
    if cfg!(windows) {
        format!("http://{PROTOCOL}.localhost/{id}")
    } else {
        format!("{PROTOCOL}://localhost/{id}")
    }
}

fn plain(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain")
        .body(Vec::new())
        .unwrap_or_default()
}

/// The `margaya-file:` handler: a byte range of a file the Files window was
/// given an id for, still inside its scope; nothing for any other webview.
pub fn serve(ctx: UriSchemeContext<'_, Wry>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    if ctx.webview_label() != LABEL {
        responder.respond(plain(StatusCode::FORBIDDEN));
        return;
    }
    let app = ctx.app_handle().clone();
    let id = request.uri().path().trim_start_matches('/').to_string();
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    tauri::async_runtime::spawn_blocking(move || {
        responder.respond(stream(&app, &id, range.as_deref()));
    });
}

fn stream(app: &AppHandle, id: &str, range: Option<&str>) -> Response<Vec<u8>> {
    let state = app.state::<FilesState>();
    let (path, scope) = {
        let inner = lock(&state.inner);
        let Some(path) = inner.streams.iter().find(|(known, _)| known == id).map(|(_, path)| path.clone()) else {
            return plain(StatusCode::NOT_FOUND);
        };
        (path, inner.scope())
    };
    // Checked again: the place may have been removed, or the file swapped
    // for a link, since the id was handed out.
    match files_scope::canonical(&path) {
        Ok(now) if now == path && scope.allows(&now) => {}
        _ => return plain(StatusCode::FORBIDDEN),
    }
    let Ok(mut file) = fs::File::open(&path) else {
        return plain(StatusCode::NOT_FOUND);
    };
    let size = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    let Some((start, end)) = files_scope::byte_range(range, size, STREAM_CHUNK) else {
        return Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{size}"))
            .body(Vec::new())
            .unwrap_or_default();
    };
    let length = end - start + 1;
    let mut body = vec![0; length as usize];
    if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut body).is_err() {
        return plain(StatusCode::INTERNAL_SERVER_ERROR);
    }
    let name = files_scope::name_of(&path);
    Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_TYPE, files_scope::media_type(&name))
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"))
        .header(header::CONTENT_LENGTH, length.to_string())
        .header("X-Content-Type-Options", "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap_or_else(|_| plain(StatusCode::INTERNAL_SERVER_ERROR))
}

#[tauri::command]
pub async fn files_search(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, FilesState>,
    path: String,
    query: String,
    include_hidden: bool,
    search_id: u32,
) -> AppResult<SearchOutcome> {
    check_caller(&window)?;
    let stop = Arc::new(AtomicBool::new(false));
    {
        let mut inner = lock(&state.inner);
        // One search at a time: a new one stops the last.
        for (_, other) in inner.searches.drain() {
            other.store(true, Ordering::Relaxed);
        }
        inner.searches.insert(search_id, stop.clone());
    }
    let flag = stop.clone();
    let outcome = with_state(&app, move |state| {
        let resolved = resolve(state, &path)?;
        if !resolved.canonical.is_dir() {
            return Err(AppError::new(ErrorKind::FileWrongKind, "not a folder"));
        }
        Ok(files_scope::search(
            &resolved.canonical,
            &resolved.display,
            &query,
            include_hidden,
            &flag,
        ))
    })
    .await;
    lock(&state.inner).searches.remove(&search_id);
    outcome
}

#[tauri::command]
pub fn files_cancel_search(window: WebviewWindow, state: State<'_, FilesState>, search_id: u32) -> AppResult<()> {
    check_caller(&window)?;
    if let Some(stop) = lock(&state.inner).searches.remove(&search_id) {
        stop.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Opens a file with its default app. Files that would run code are never
/// opened this way; the page offers "Show in folder" for them.
#[tauri::command]
pub async fn files_open(window: WebviewWindow, app: AppHandle, path: String) -> AppResult<()> {
    check_caller(&window)?;
    with_state(&app, move |state| {
        let (resolved, _) = resolve_file(state, &path)?;
        if files_scope::runs_code(&files_scope::name_of(&resolved.display)) {
            return Err(AppError::new(ErrorKind::FileRunsCode, "this file runs code"));
        }
        opener::open_file(files_scope::simplified(&resolved.canonical));
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn files_reveal(window: WebviewWindow, app: AppHandle, path: String) -> AppResult<()> {
    check_caller(&window)?;
    with_state(&app, move |state| {
        let resolved = resolve(state, &path)?;
        let target = crate::downloads::Reveal::Select(files_scope::simplified(&resolved.canonical));
        if let Err(error) = opener::show_in_folder(&target) {
            log::warn!("could not show a file in its folder: {error}");
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn files_copy_path(window: WebviewWindow, app: AppHandle, path: String) -> AppResult<()> {
    check_caller(&window)?;
    let resolved = with_state(&app, move |state| resolve(state, &path)).await?;
    app.clipboard()
        .write_text(resolved.display.to_string_lossy().into_owned())
        .map_err(AppError::internal)
}

/// Where "Save a copy…" writes: the system save dialog's answer. In test
/// builds, `MARGAYA_E2E_SAVE_PATH` stands in for the dialog.
fn pick_save_path(window: &WebviewWindow, name: &str) -> Option<PathBuf> {
    #[cfg(feature = "e2e")]
    if let Some(path) = std::env::var_os("MARGAYA_E2E_SAVE_PATH") {
        return Some(PathBuf::from(path));
    }
    use tauri_plugin_dialog::DialogExt;
    window
        .dialog()
        .file()
        .set_parent(window)
        .set_title(i18n::t("files.saveCopyTitle"))
        .set_file_name(name)
        .blocking_save_file()?
        .into_path()
        .ok()
}

/// Copies the file to where the person chose in the save dialog, and only
/// there; never onto itself. Returns the new file's path, or None when they
/// cancelled.
#[tauri::command]
pub async fn files_save_copy(window: WebviewWindow, app: AppHandle, path: String) -> AppResult<Option<String>> {
    check_caller(&window)?;
    let (resolved, _) = with_state(&app, move |state| resolve_file(state, &path)).await?;
    let name = files_scope::name_of(&resolved.display);
    let picker = window.clone();
    blocking(move || {
        let Some(target) = pick_save_path(&picker, &name) else {
            return Ok(None);
        };
        if !target.is_absolute() || target.is_dir() {
            return Err(AppError::new(ErrorKind::FileWrongKind, "not a file path"));
        }
        if fs::canonicalize(&target).is_ok_and(|existing| existing == resolved.canonical) {
            return Err(AppError::new(ErrorKind::FileSameFile, "that is the file itself"));
        }
        fs::copy(&resolved.canonical, &target).map_err(|error| {
            log::warn!("could not save a copy: {error}");
            AppError::new(ErrorKind::FileNoAccess, "could not write the copy")
        })?;
        Ok(Some(target.to_string_lossy().into_owned()))
    })
    .await
}

#[tauri::command]
pub async fn files_recent_add(window: WebviewWindow, app: AppHandle, path: String) -> AppResult<()> {
    check_caller(&window)?;
    with_state(&app, move |state| {
        let (resolved, _) = resolve_file(state, &path)?;
        lock(&state.inner).add_recent(&resolved);
        state.persist();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn files_recent_remove(window: WebviewWindow, app: AppHandle, path: String) -> AppResult<()> {
    check_caller(&window)?;
    with_state(&app, move |state| {
        lock(&state.inner).remove_recent(&path);
        state.persist();
        Ok(())
    })
    .await
}

/// Starts a native file drag of one file out of the Files window, so it can
/// be dropped on a task, a comment or an editor in a server window (or any
/// other app). Test builds record `drag <path>` in `MARGAYA_E2E_OPEN_LOG`
/// instead: a synthetic drag would drop wherever the real pointer is.
#[tauri::command]
pub async fn files_start_drag(window: WebviewWindow, app: AppHandle, path: String) -> AppResult<()> {
    check_caller(&window)?;
    let (resolved, _) = with_state(&app, move |state| resolve_file(state, &path)).await?;
    let file = files_scope::simplified(&resolved.canonical);
    start_drag(&app, window, file)
}

#[cfg(feature = "e2e")]
fn start_drag(_app: &AppHandle, _window: WebviewWindow, file: PathBuf) -> AppResult<()> {
    opener::record(&format!("drag {}", file.display())).map_err(AppError::internal)
}

#[cfg(not(feature = "e2e"))]
fn start_drag(app: &AppHandle, window: WebviewWindow, file: PathBuf) -> AppResult<()> {
    // The OS drag loop needs the window's own (main) thread, while the
    // pointer is still down.
    const ICON: &[u8] = include_bytes!("../icons/64x64.png");
    app.run_on_main_thread(move || {
        #[cfg(target_os = "linux")]
        let target = window.gtk_window();
        #[cfg(not(target_os = "linux"))]
        let target: tauri::Result<WebviewWindow> = Ok(window.clone());
        let result = target.map_err(|error| error.to_string()).and_then(|target| {
            drag::start_drag(
                &target,
                drag::DragItem::Files(vec![file]),
                drag::Image::Raw(ICON.to_vec()),
                |_, _| {},
                drag::Options::default(),
            )
            .map_err(|error| error.to_string())
        });
        if let Err(error) = result {
            log::warn!("could not start dragging a file: {error}");
        }
    })
    .map_err(AppError::from)
}

/// What a drop on the Files window gave it.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Dropped {
    files: Vec<Entry>,
    places: usize,
    refused: usize,
}

/// Files and folders dropped on the Files window: a file becomes readable
/// (that exact file, for this run, or while it stays in Recent) and is
/// previewed; a folder becomes a place. Network and device paths are
/// refused untouched.
pub fn on_drop(app: &AppHandle, paths: Vec<PathBuf>) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<FilesState>();
        let mut dropped = Dropped::default();
        for path in paths.into_iter().take(100) {
            if !path.is_absolute() || files_scope::is_remote_or_device_path(&path) {
                dropped.refused += 1;
                continue;
            }
            let Ok(canonical) = files_scope::canonical(&path) else {
                dropped.refused += 1;
                continue;
            };
            if canonical.is_dir() {
                let added = check_place(&path)
                    .and_then(|canonical| lock(&state.inner).insert_place(&path, canonical));
                match added {
                    Ok(_) => dropped.places += 1,
                    Err(_) => dropped.refused += 1,
                }
            } else if canonical.is_file() {
                let display = files_scope::simplified(&path);
                if let Some(entry) = files_scope::entry_for(&canonical, &display) {
                    lock(&state.inner).dropped.insert(canonical);
                    dropped.files.push(entry);
                }
            } else {
                dropped.refused += 1;
            }
        }
        state.persist();
        let _ = app.emit_to(LABEL, "files-dropped", dropped);
    });
}

/// The app's own pages: the Files window never leaves them.
fn is_app_page(url: &url::Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || (cfg!(debug_assertions) && url.host_str() == Some("localhost") && url.port() == Some(1420))
        }
        _ => false,
    }
}

/// Opens the Files window, or brings it forward. Safe from any thread.
pub fn show(app: &AppHandle) {
    windows::spawn_ui(app, |app| {
        if let Some(window) = app.get_webview_window(LABEL) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            let _ = app.emit_to(LABEL, "files-shown", ());
            return;
        }
        if let Err(error) = create(app) {
            log::warn!("the Files window failed to open: {}", error.message);
        }
    });
}

fn create(app: &AppHandle) -> AppResult<()> {
    // Size and place come back through the window-state plugin (lib.rs).
    // The drop handler stays on (unlike server windows): dropped paths come
    // to Rust as a window event, never as page-readable paths.
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#files".into()))
        .title(i18n::t("files.title"))
        .inner_size(1080.0, 680.0)
        .min_inner_size(560.0, 400.0)
        .resizable(true)
        .background_color(windows::background(app))
        .center()
        .focused(true)
        .on_navigation(is_app_page)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build()?;
    let _ = window.set_focus();
    Ok(())
}

/// The launcher's "Files" button.
#[tauri::command]
pub fn show_files(app: AppHandle) {
    show(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inner_in(dir: &Path) -> Inner {
        Inner {
            file: Some(dir.join(STORE_FILE)),
            ..Inner::default()
        }
    }

    fn resolved(scope: &Scope, path: &Path) -> files_scope::Resolved {
        scope.resolve(&path.to_string_lossy()).unwrap()
    }

    fn save(inner: &Inner) {
        write_store(inner.file.as_ref().unwrap(), &inner.stored());
    }

    #[test]
    fn places_persist_and_come_back_only_where_they_were() {
        let config = tempfile::tempdir().unwrap();
        let files = tempfile::tempdir().unwrap();
        let place = files.path().join("docs");
        fs::create_dir(&place).unwrap();
        fs::write(place.join("a.txt"), "a").unwrap();

        let mut inner = inner_in(config.path());
        let id = inner.add_place(&place).unwrap();
        assert_eq!(inner.add_place(&place).unwrap(), id, "the same folder twice is one place");
        assert!(inner.scope().resolve(&place.join("a.txt").to_string_lossy()).is_ok());
        save(&inner);

        let loaded = FilesState::load(config.path());
        assert!(loaded.scope().resolve(&place.join("a.txt").to_string_lossy()).is_ok());

        // Moved away: the place stays listed but grants nothing.
        fs::rename(&place, files.path().join("moved")).unwrap();
        let loaded = FilesState::load(config.path());
        let scope = loaded.scope();
        assert_eq!(scope.roots.len(), 1);
        assert!(!scope.roots[0].available);
        // A new folder at the old path resolves the same, so it is granted
        // again only if it is the same path (it is: same name, same parent).
        fs::create_dir(&place).unwrap();
        assert!(FilesState::load(config.path()).scope().roots[0].available);
    }

    #[test]
    fn removing_a_place_takes_back_what_it_granted() {
        let config = tempfile::tempdir().unwrap();
        let files = tempfile::tempdir().unwrap();
        let place = files.path().join("docs");
        fs::create_dir(&place).unwrap();
        let file = place.join("a.txt");
        fs::write(&file, "a").unwrap();

        let mut inner = inner_in(config.path());
        let id = inner.add_place(&place).unwrap();
        let found = resolved(&inner.scope(), &file);
        inner.add_recent(&found);
        inner.streams.push_back(("s1".into(), found.canonical.clone()));
        assert_eq!(inner.recent.len(), 1);
        assert!(!inner.recent[0].via_drop);

        inner.remove_place(&id);
        assert_eq!(inner.scope().resolve(&file.to_string_lossy()), Err(Denied::Outside));
        assert!(inner.recent.is_empty());
        assert!(inner.streams.is_empty());
        // Added again in the same run: granted again.
        inner.add_place(&place).unwrap();
        assert!(inner.scope().resolve(&file.to_string_lossy()).is_ok());
    }

    #[test]
    fn a_dropped_file_stays_readable_while_in_recent() {
        let config = tempfile::tempdir().unwrap();
        let files = tempfile::tempdir().unwrap();
        let file = files.path().join("drop.pdf");
        fs::write(&file, "x").unwrap();
        let canonical = fs::canonicalize(&file).unwrap();

        let mut inner = inner_in(config.path());
        assert!(inner.scope().resolve(&file.to_string_lossy()).is_err());
        inner.dropped.insert(canonical);
        let found = resolved(&inner.scope(), &file);
        inner.add_recent(&found);
        assert!(inner.recent[0].via_drop);
        save(&inner);

        // Next run: still readable through Recent.
        let loaded = FilesState::load(config.path());
        assert!(loaded.scope().resolve(&file.to_string_lossy()).is_ok());

        let path = inner.recent[0].path.clone();
        inner.remove_recent(&path);
        assert!(inner.scope().resolve(&file.to_string_lossy()).is_err());
    }

    #[test]
    fn grants_saved_places_only_once_checked_and_writes_each_change_once() {
        let config = tempfile::tempdir().unwrap();
        let files = tempfile::tempdir().unwrap();
        let file = files.path().join("a.txt");
        fs::write(&file, "a").unwrap();

        let state = FilesState::load(config.path());
        lock(&state.inner).add_place(files.path()).unwrap();
        state.persist();
        let store = config.path().join(STORE_FILE);
        assert!(store.exists());
        // Nothing changed since: not written again.
        fs::remove_file(&store).unwrap();
        state.persist();
        assert!(!store.exists());
        lock(&state.inner).remove_recent("nothing");
        state.persist();
        assert!(store.exists());

        // Loading never touches the places (it runs on the main thread at
        // start); the first read checks them.
        let loaded = FilesState::load(config.path());
        assert!(!lock(&loaded.inner).scope().roots[0].available);
        assert!(loaded.scope().resolve(&file.to_string_lossy()).is_ok());
        let overview = overview(&loaded);
        assert_eq!(overview.places.len(), 1);
        assert!(overview.places[0].available);
    }

    #[test]
    fn disk_checks_give_up_on_a_slow_path_and_never_pile_up() {
        let base = tempfile::tempdir().unwrap();
        let (fast, slow) = (base.path().join("fast"), base.path().join("slow"));
        let job = |value: u32, wait: u64| -> DiskJob<u32> {
            Box::new(move || {
                std::thread::sleep(Duration::from_millis(wait));
                value
            })
        };
        let started = Instant::now();
        let results = bounded_all(
            vec![(fast.clone(), job(1, 0)), (slow.clone(), job(2, 400))],
            Duration::from_millis(100),
        );
        assert_eq!(results, [Some(1), None]);
        assert!(started.elapsed() < Duration::from_millis(350), "waited for the slow path");

        // The slow path is still busy: asking again doesn't start another.
        let again = bounded_all(vec![(slow.clone(), job(3, 0))], Duration::from_millis(100));
        assert_eq!(again, [None]);

        std::thread::sleep(Duration::from_millis(450));
        let later = bounded_all(vec![(slow, job(4, 0))], Duration::from_millis(500));
        assert_eq!(later, [Some(4)]);
    }

    #[test]
    fn keeps_twenty_recent_files_newest_first() {
        let config = tempfile::tempdir().unwrap();
        let files = tempfile::tempdir().unwrap();
        let mut inner = inner_in(config.path());
        inner.add_place(files.path()).unwrap();
        for index in 0..25 {
            let file = files.path().join(format!("{index}.txt"));
            fs::write(&file, "x").unwrap();
            let found = resolved(&inner.scope(), &file);
            inner.add_recent(&found);
        }
        assert_eq!(inner.recent.len(), RECENT_LIMIT);
        assert!(inner.recent[0].path.ends_with("24.txt"));
        let again = resolved(&inner.scope(), &files.path().join("10.txt"));
        inner.add_recent(&again);
        assert!(inner.recent[0].path.ends_with("10.txt"));
        assert_eq!(inner.recent.len(), RECENT_LIMIT);
    }

    #[test]
    fn refuses_odd_places() {
        let config = tempfile::tempdir().unwrap();
        let files = tempfile::tempdir().unwrap();
        let file = files.path().join("a.txt");
        fs::write(&file, "x").unwrap();
        let mut inner = inner_in(config.path());
        assert_eq!(inner.add_place(&file).unwrap_err().kind, ErrorKind::FileWrongKind);
        assert_eq!(inner.add_place(Path::new("relative")).unwrap_err().kind, ErrorKind::FileOutside);
        #[cfg(windows)]
        for odd in [r"\\host\share", r"\\?\C:\Windows", r"\\.\C:\"] {
            assert_eq!(inner.add_place(Path::new(odd)).unwrap_err().kind, ErrorKind::FileOutside, "{odd}");
        }
        assert!(inner.places.is_empty());
    }

    #[test]
    fn streams_from_the_files_window_scheme() {
        let url = stream_url("abc");
        if cfg!(windows) {
            assert_eq!(url, "http://margaya-file.localhost/abc");
        } else {
            assert_eq!(url, "margaya-file://localhost/abc");
        }
    }

    /// The boundary as the capability files state it: only the `files`
    /// window (local pages) may call the Files commands, and no window,
    /// server or bundled, gets the file system, dialog or opener plugins.
    #[test]
    fn only_the_files_window_may_read_files() {
        let capabilities = [
            include_str!("../capabilities/launcher.json"),
            include_str!("../capabilities/quick-add.json"),
            include_str!("../capabilities/search.json"),
            include_str!("../capabilities/today.json"),
            include_str!("../capabilities/offline.json"),
            include_str!("../capabilities/files.json"),
        ];
        let listed = fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities"))
            .unwrap()
            .count();
        assert_eq!(listed, capabilities.len(), "a capability file isn't covered here");
        for text in capabilities {
            let capability: serde_json::Value = serde_json::from_str(text).unwrap();
            let id = capability["identifier"].as_str().unwrap();
            let windows: Vec<&str> = capability["windows"]
                .as_array()
                .unwrap()
                .iter()
                .map(|window| window.as_str().unwrap())
                .collect();
            assert!(capability.get("remote").is_none(), "{id} must not allow remote pages");
            let permissions: Vec<&str> = capability["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .map(|permission| permission.as_str().unwrap())
                .collect();
            for permission in &permissions {
                for plugin in ["fs:", "dialog:", "opener:", "shell:", "clipboard-manager:"] {
                    assert!(!permission.starts_with(plugin), "{id} grants {permission}");
                }
                if permission.starts_with("allow-files-") {
                    assert_eq!(id, "files", "{id} grants {permission}");
                }
            }
            if id == "files" {
                assert_eq!(windows, [LABEL]);
                assert_ne!(capability["local"], serde_json::Value::Bool(false));
                assert!(permissions.iter().all(|permission| {
                    permission.starts_with("allow-files-") || *permission == "core:event:default"
                }));
            } else {
                assert!(!windows.contains(&LABEL), "{id} also applies to the Files window");
                assert!(windows.iter().all(|window| !window.starts_with("file")));
            }
        }
    }

    #[test]
    fn stays_on_the_apps_own_pages() {
        let ok = |text: &str| is_app_page(&url::Url::parse(text).unwrap());
        assert!(ok("http://tauri.localhost/index.html#files"));
        assert!(ok("tauri://localhost/index.html#files"));
        assert!(!ok("https://example.com/"));
        assert!(!ok("http://margaya-file.localhost/abc"));
        assert!(!ok("file:///C:/Windows/win.ini"));
    }
}
