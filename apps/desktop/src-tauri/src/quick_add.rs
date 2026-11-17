//! What quick add brings along besides a typed title: a draft filled from a
//! screenshot, the clipboard or "Send to Margaya" files, the attachments it
//! uploads once the task exists, and the last used server and project.
//!
//! Attachments stay in the Rust core. The quick-add page sees only an id, a
//! name, a size and (for images the app captured) a small preview; it sends
//! ids back, never paths, so it can't make the core read any other file.
//! Files named by "Send to" are not opened until the person creates the task.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::api;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::servers::Server;
use crate::state::{lock, AppState};
use crate::{tokens, windows};

/// Caps on what quick add takes in. The API's own default upload limit is
/// 10 MB (S3_MAX_IMAGE_UPLOAD_BYTES); a server set lower still refuses.
pub const MAX_TITLE_CHARS: usize = 255;
pub const MAX_DESCRIPTION_BYTES: usize = 20 * 1024;
pub const MAX_ATTACHMENT_BYTES: u64 = 10 * 1024 * 1024;
pub const MAX_ATTACHMENTS: usize = 10;

/// The argument the Windows "Send to" shortcut passes before the files.
pub const SEND_TO_ARG: &str = "--send-to";

/// Event sent to the quick-add window when its draft changed.
pub const DRAFT_EVENT: &str = "quick-add-draft";

/// Something the person should know about what was (not) taken in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NoticeKind {
    TitleTrimmed,
    DescriptionTrimmed,
    /// A file or image over [`MAX_ATTACHMENT_BYTES`].
    TooLarge,
    /// More than [`MAX_ATTACHMENTS`] files.
    TooMany,
    /// A folder, or something else that isn't a plain file.
    NotAFile,
    Unreadable,
    ClipboardEmpty,
    /// macOS: the screenshot came back empty (Screen Recording permission).
    #[cfg_attr(windows, allow(dead_code))]
    ScreenPermission,
    ScreenshotFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub kind: NoticeKind,
    /// The file it is about, by name only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl Notice {
    pub fn new(kind: NoticeKind) -> Self {
        Self { kind, name: None }
    }

    pub fn about(kind: NoticeKind, name: impl Into<String>) -> Self {
        Self {
            kind,
            name: Some(name.into()),
        }
    }
}

/// A file waiting to be attached to the next task.
#[derive(Debug, Clone)]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub size: u64,
    pub content_type: String,
    /// The app's own temporary file (a screenshot or clipboard image),
    /// deleted after the upload or when the draft is dropped.
    pub temp: bool,
    /// A small PNG data URL, only for images the app captured itself.
    pub preview: Option<String>,
}

impl Attachment {
    fn view(&self) -> AttachmentView {
        AttachmentView {
            id: self.id.clone(),
            name: self.name.clone(),
            size: self.size,
            image: self.content_type.starts_with("image/"),
            preview: self.preview.clone(),
        }
    }

    fn drop_file(&self) {
        if self.temp {
            if let Err(error) = fs::remove_file(&self.path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    log::warn!("could not delete a quick-add temporary file: {error}");
                }
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentView {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub image: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

/// What a capture adds to the draft.
#[derive(Debug, Default)]
pub struct DraftUpdate {
    pub title: Option<String>,
    pub description: Option<String>,
    pub attachments: Vec<Attachment>,
    pub notices: Vec<Notice>,
}

struct Draft {
    revision: u64,
    title: Option<String>,
    description: Option<String>,
    attachments: Vec<Attachment>,
    notices: Vec<Notice>,
}

impl Draft {
    const EMPTY: Draft = Draft {
        revision: 0,
        title: None,
        description: None,
        attachments: Vec::new(),
        notices: Vec::new(),
    };
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftView {
    /// Changes with every update; the page applies title and description
    /// once per revision.
    pub revision: u64,
    pub title: Option<String>,
    pub description: Option<String>,
    pub attachments: Vec<AttachmentView>,
    pub notices: Vec<Notice>,
}

static DRAFT: Mutex<Draft> = Mutex::new(Draft::EMPTY);
static REVISION: AtomicU64 = AtomicU64::new(1);

fn view(draft: &Draft) -> DraftView {
    DraftView {
        revision: draft.revision,
        title: draft.title.clone(),
        description: draft.description.clone(),
        attachments: draft.attachments.iter().map(Attachment::view).collect(),
        notices: draft.notices.clone(),
    }
}

/// Merges an update into the draft: a new title or description replaces the
/// old one, attachments add up to [`MAX_ATTACHMENTS`]; the temporary files
/// of those that don't fit are deleted.
fn merge(draft: &mut Draft, update: DraftUpdate) {
    draft.revision = REVISION.fetch_add(1, Ordering::Relaxed);
    if update.title.is_some() {
        draft.title = update.title;
    }
    if update.description.is_some() {
        draft.description = update.description;
    }
    draft.notices = update.notices;
    let mut overflow = false;
    for attachment in update.attachments {
        if draft.attachments.len() < MAX_ATTACHMENTS {
            draft.attachments.push(attachment);
        } else {
            attachment.drop_file();
            overflow = true;
        }
    }
    if overflow && !draft.notices.iter().any(|n| n.kind == NoticeKind::TooMany) {
        draft.notices.push(Notice::new(NoticeKind::TooMany));
    }
}

/// Adds to the draft and brings quick add up (from any thread).
pub fn add_to_draft(app: &AppHandle, update: DraftUpdate) {
    let needs_room = {
        let mut draft = lock(&DRAFT);
        merge(&mut draft, update);
        !draft.attachments.is_empty() || draft.description.is_some() || !draft.notices.is_empty()
    };
    windows::spawn_ui(app, move |app| {
        if let Err(error) = windows::show_quick_add(app, None) {
            log::warn!("quick add failed to open: {}", error.message);
            return;
        }
        if let Some(window) = app.get_webview_window(windows::QUICK_ADD) {
            // The window opens small for a title alone; previews, files and
            // a description need more height.
            if needs_room {
                let _ = window.set_size(tauri::LogicalSize::new(520.0, 520.0));
            }
        }
        let _ = app.emit_to(windows::QUICK_ADD, DRAFT_EVENT, ());
    });
}

/// Drops the whole draft and deletes its temporary files (quick add closed).
pub fn discard() {
    let mut draft = lock(&DRAFT);
    for attachment in draft.attachments.drain(..) {
        attachment.drop_file();
    }
    *draft = Draft::EMPTY;
}

/// Takes the draft's attachments with these ids (what the page showed when
/// the person pressed Create) and clears the prefilled text. Attachments
/// added since stay for the next task.
fn take_for_task(ids: &[String]) -> Vec<Attachment> {
    let mut draft = lock(&DRAFT);
    let (taken, kept): (Vec<Attachment>, Vec<Attachment>) = std::mem::take(&mut draft.attachments)
        .into_iter()
        .partition(|attachment| ids.contains(&attachment.id));
    draft.attachments = kept;
    draft.title = None;
    draft.description = None;
    draft.notices.clear();
    taken
}

/// Temporary files the draft still refers to.
fn draft_temp_paths() -> Vec<PathBuf> {
    lock(&DRAFT)
        .attachments
        .iter()
        .filter(|attachment| attachment.temp)
        .map(|attachment| attachment.path.clone())
        .collect()
}

// --- Text -----------------------------------------------------------------

/// Cuts `text` to at most `max` characters; true when something was cut.
pub fn cut_chars(text: &str, max: usize) -> (String, bool) {
    match text.char_indices().nth(max) {
        Some((end, _)) => (text[..end].trim_end().to_string(), true),
        None => (text.to_string(), false),
    }
}

/// Cuts `text` to at most `max` bytes, at a character boundary.
pub fn cut_bytes(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

fn is_web_link(text: &str) -> bool {
    !text.chars().any(char::is_whitespace)
        && url::Url::parse(text)
            .is_ok_and(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
}

/// Clipboard text as a draft: the first line is the title and the rest the
/// description. A lone link becomes the title, or the description when it
/// is too long for a title.
pub fn text_update(text: &str) -> DraftUpdate {
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let text = text.trim();
    let mut update = DraftUpdate::default();
    if text.is_empty() {
        update.notices.push(Notice::new(NoticeKind::ClipboardEmpty));
        return update;
    }
    if !text.contains('\n') && is_web_link(text) {
        if text.chars().count() <= MAX_TITLE_CHARS {
            update.title = Some(text.to_string());
        } else {
            update.description = Some(cut_bytes(text, MAX_DESCRIPTION_BYTES));
        }
        return update;
    }
    let (first, rest) = text.split_once('\n').unwrap_or((text, ""));
    let (title, cut) = cut_chars(first.trim(), MAX_TITLE_CHARS);
    if cut {
        update.notices.push(Notice::new(NoticeKind::TitleTrimmed));
    }
    update.title = Some(title);
    let rest = rest.trim();
    if !rest.is_empty() {
        let description = cut_bytes(rest, MAX_DESCRIPTION_BYTES);
        if description.len() < rest.len() {
            update
                .notices
                .push(Notice::new(NoticeKind::DescriptionTrimmed));
        }
        update.description = Some(description);
    }
    update
}

// --- Files ----------------------------------------------------------------

/// The MIME type of a file to attach, by its extension.
pub fn content_type_for(name: &str) -> &'static str {
    let extension = Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "heic" => "image/heic",
        "pdf" => "application/pdf",
        "txt" | "log" => "text/plain",
        "md" => "text/markdown",
        "csv" => "text/csv",
        "json" => "application/json",
        "zip" => "application/zip",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

/// The paths after `--send-to`, or None when it isn't a "Send to": the
/// flag must be the first argument (where the Send To shortcut puts it), and
/// no argument may be a link (a deep link's sender controls the rest of its
/// command line). Other flags are skipped; relative paths are taken from
/// `cwd`.
pub fn send_to_paths(args: &[String], cwd: &Path) -> Option<Vec<PathBuf>> {
    if args.get(1).map(String::as_str) != Some(SEND_TO_ARG) || crate::launch::has_deep_link(args) {
        return None;
    }
    Some(
        args[2..]
            .iter()
            .filter(|arg| !arg.is_empty() && !arg.starts_with("--"))
            // Windows can hand over a quoted path with its quotes.
            .map(|arg| arg.trim_matches('"'))
            .map(|arg| {
                let path = PathBuf::from(arg);
                if path.is_absolute() {
                    path
                } else {
                    cwd.join(path)
                }
            })
            .collect(),
    )
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

/// A network share (`\\host\share`, `//host/share`) or a device or NT path
/// (`\\?\…`, `\\.\…`, `\??\…`). Even reading the metadata of a share can
/// send the person's credentials to that host, so these are refused before
/// anything touches the file system.
pub fn is_remote_or_device_path(path: &Path) -> bool {
    let text = path.as_os_str().to_string_lossy();
    let mut chars = text.chars();
    let separator = |c: Option<char>| matches!(c, Some('\\' | '/'));
    let first = chars.next();
    let second = chars.next();
    (separator(first) && separator(second)) || text.starts_with("\\??\\")
}

/// Checks files named by "Send to" without opening them: plain files only,
/// at most [`MAX_ATTACHMENTS`], each at most [`MAX_ATTACHMENT_BYTES`];
/// network shares and device paths are refused unread.
pub fn check_files(paths: &[PathBuf]) -> DraftUpdate {
    let mut update = DraftUpdate::default();
    for (index, path) in paths.iter().enumerate() {
        if index >= MAX_ATTACHMENTS {
            update.notices.push(Notice::new(NoticeKind::TooMany));
            break;
        }
        let name = file_name(path);
        if is_remote_or_device_path(path) {
            update
                .notices
                .push(Notice::about(NoticeKind::Unreadable, name));
            continue;
        }
        let meta = match fs::metadata(path) {
            Ok(meta) => meta,
            Err(_) => {
                update
                    .notices
                    .push(Notice::about(NoticeKind::Unreadable, name));
                continue;
            }
        };
        if !meta.is_file() {
            update
                .notices
                .push(Notice::about(NoticeKind::NotAFile, name));
        } else if meta.len() > MAX_ATTACHMENT_BYTES {
            update
                .notices
                .push(Notice::about(NoticeKind::TooLarge, name));
        } else {
            update.attachments.push(Attachment {
                id: uuid::Uuid::new_v4().to_string(),
                content_type: content_type_for(&name).to_string(),
                name,
                path: path.clone(),
                size: meta.len(),
                temp: false,
                preview: None,
            });
        }
    }
    update
}

/// Handles `--send-to <paths…>` from the app's own start or a second launch
/// (single-instance). True when the arguments were a "Send to".
pub fn handle_send_to(app: &AppHandle, args: &[String], cwd: &Path) -> bool {
    let Some(paths) = send_to_paths(args, cwd) else {
        return false;
    };
    log::info!("Send to Margaya: {} item(s)", paths.len());
    let update = check_files(&paths);
    add_to_draft(app, update);
    true
}

// --- Temporary files ------------------------------------------------------

const TEMP_PREFIX: &str = "capture-";

/// A new temporary file name; never derived from anything outside the app.
pub fn temp_file_name(id: &uuid::Uuid, extension: &str) -> String {
    format!("{TEMP_PREFIX}{}.{extension}", id.simple())
}

pub fn is_temp_file_name(name: &str) -> bool {
    name.strip_prefix(TEMP_PREFIX)
        .and_then(|rest| rest.split_once('.'))
        .is_some_and(|(id, extension)| {
            id.len() == 32
                && id.bytes().all(|b| b.is_ascii_hexdigit())
                && matches!(extension, "png" | "jpg")
        })
}

fn temp_dir_path(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(AppError::internal)?
        .join("quick-add"))
}

/// Removes the screenshots and clipboard images in `dir` that `keep` doesn't
/// name. Only files this app names (`capture-<uuid>.png|jpg`) are touched.
pub fn sweep_temp_files(dir: &Path, keep: &[PathBuf]) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if is_temp_file_name(&name) && !keep.contains(&entry.path()) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// At start and on exit: every capture left over goes, so a screenshot or
/// copied image never waits on disk for the next capture.
pub fn sweep_all_temp_files(app: &AppHandle) {
    if let Ok(dir) = temp_dir_path(app) {
        sweep_temp_files(&dir, &[]);
    }
}

/// The app's private folder for captures (0700 on Unix), with files left
/// from an earlier run removed.
pub fn temp_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = temp_dir_path(app)?;
    fs::create_dir_all(&dir).map_err(AppError::internal)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    sweep_temp_files(&dir, &draft_temp_paths());
    Ok(dir)
}

/// A path for a new capture in `dir`; the file doesn't exist yet.
pub fn temp_path(dir: &Path, extension: &str) -> PathBuf {
    dir.join(temp_file_name(&uuid::Uuid::new_v4(), extension))
}

/// Restricts a capture file to its owner (Unix; on Windows the cache folder
/// in the profile is already private).
#[cfg_attr(windows, allow(dead_code))]
pub fn make_private(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// Writes `bytes` to a new private temporary file.
pub fn write_temp(dir: &Path, extension: &str, bytes: &[u8]) -> std::io::Result<PathBuf> {
    use std::io::Write;
    let path = temp_path(dir, extension);
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path)?;
    if let Err(error) = file.write_all(bytes) {
        drop(file);
        let _ = fs::remove_file(&path);
        return Err(error);
    }
    Ok(path)
}

/// A captured image in a temporary file, as an attachment.
pub fn temp_image(path: PathBuf, name: String, size: u64, preview: Option<String>) -> Attachment {
    Attachment {
        id: uuid::Uuid::new_v4().to_string(),
        content_type: content_type_for(&name).to_string(),
        name,
        path,
        size,
        temp: true,
        preview,
    }
}

// --- Last used target -----------------------------------------------------

/// The server, workspace and project quick add used last, in
/// `quick-add.json` next to `servers.json`. Ids only, never secrets.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuickAddPrefs {
    pub server_id: Option<String>,
    pub workspace_id: Option<String>,
    pub project_id: Option<String>,
}

fn prefs_path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("quick-add.json"))
}

fn remember(app: &AppHandle, prefs: &QuickAddPrefs) {
    let Some(path) = prefs_path(app) else {
        return;
    };
    let Ok(text) = serde_json::to_string_pretty(prefs) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    // Write then rename, so a crash never leaves half a file.
    let temp = path.with_extension("json.tmp");
    if fs::write(&temp, text)
        .and_then(|()| fs::rename(&temp, &path))
        .is_err()
    {
        log::warn!("could not remember quick add's last project");
    }
}

// --- Commands -------------------------------------------------------------

#[tauri::command]
pub fn quick_add_draft() -> DraftView {
    view(&lock(&DRAFT))
}

#[tauri::command]
pub fn quick_add_remove_attachment(id: String) {
    let mut draft = lock(&DRAFT);
    if let Some(index) = draft.attachments.iter().position(|item| item.id == id) {
        draft.attachments.remove(index).drop_file();
    }
}

#[tauri::command]
pub fn quick_add_prefs(app: AppHandle) -> QuickAddPrefs {
    prefs_path(&app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn quick_add_members(
    state: State<'_, AppState>,
    server_id: String,
    workspace_id: String,
) -> AppResult<Vec<api::QuickAddMember>> {
    let server = state.server(&server_id)?;
    let token = tokens::get(&server_id)
        .ok_or_else(|| AppError::new(ErrorKind::NotSignedIn, "not signed in"))?;
    api::quick_add_members(&state.http, &server, &token, &workspace_id).await
}

/// Reads one attachment for upload, checking it again: it may have changed
/// since it was listed.
fn read_attachment(attachment: &Attachment) -> std::io::Result<Vec<u8>> {
    let meta = fs::metadata(&attachment.path)?;
    if !meta.is_file() || meta.len() > MAX_ATTACHMENT_BYTES {
        return Err(std::io::Error::other("not a plain file within the cap"));
    }
    let bytes = fs::read(&attachment.path)?;
    if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err(std::io::Error::other("over the cap"));
    }
    Ok(bytes)
}

/// Creates the task, then uploads the draft's attachments the page listed
/// (by id) and remembers the target. A failed upload doesn't undo the task;
/// its name comes back in `failedAttachments`.
#[allow(clippy::too_many_arguments)]
pub async fn create(
    app: &AppHandle,
    state: &AppState,
    server: &Server,
    token: &str,
    workspace_id: &str,
    project_id: &str,
    title: &str,
    details: &api::TaskDetails,
    attachment_ids: &[String],
) -> AppResult<api::QuickAddResult> {
    let mut result = api::create_task(
        &state.http,
        server,
        token,
        workspace_id,
        project_id,
        title,
        details,
    )
    .await?;
    remember(
        app,
        &QuickAddPrefs {
            server_id: Some(server.id.clone()),
            workspace_id: Some(workspace_id.to_string()),
            project_id: Some(project_id.to_string()),
        },
    );
    for attachment in take_for_task(attachment_ids) {
        let reading = attachment.clone();
        let bytes = tauri::async_runtime::spawn_blocking(move || read_attachment(&reading))
            .await
            .map_err(AppError::internal)
            .and_then(|read| read.map_err(AppError::internal));
        let uploaded = match bytes {
            Ok(bytes) => {
                api::upload_attachment(
                    &state.http,
                    server,
                    token,
                    &result.task_id,
                    &attachment.name,
                    &attachment.content_type,
                    bytes,
                )
                .await
            }
            Err(error) => Err(error),
        };
        if let Err(error) = uploaded {
            log::warn!(
                "quick add: an attachment wasn't uploaded: {}",
                error.message
            );
            result.failed_attachments.push(attachment.name.clone());
        }
        attachment.drop_file();
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| arg.to_string()).collect()
    }

    #[test]
    fn reads_send_to_arguments() {
        let cwd = std::env::temp_dir();
        assert_eq!(send_to_paths(&args(&["margaya-desktop.exe"]), &cwd), None);
        assert_eq!(
            send_to_paths(&args(&["app", "--hidden"]), &cwd),
            None,
            "no flag, no Send to"
        );
        let absolute = cwd.join("a b.txt");
        let paths = send_to_paths(
            &args(&[
                "app",
                "--send-to",
                absolute.to_str().unwrap(),
                "--hidden",
                "",
                "rel.png",
            ]),
            &cwd,
        )
        .unwrap();
        assert_eq!(paths, vec![absolute, cwd.join("rel.png")]);
        assert_eq!(
            send_to_paths(&args(&["app", "--send-to"]), &cwd),
            Some(vec![])
        );
    }

    #[test]
    fn takes_send_to_only_as_the_first_argument_and_never_next_to_a_link() {
        let cwd = std::env::temp_dir();
        let file = cwd.join("a.txt");
        let file = file.to_str().unwrap();
        assert!(send_to_paths(&args(&["app", "--send-to", file]), &cwd).is_some());
        // Anywhere else it isn't a Send to.
        assert_eq!(
            send_to_paths(&args(&["app", "--minimized", "--send-to", file]), &cwd),
            None
        );
        assert_eq!(send_to_paths(&args(&["--send-to", file]), &cwd), None);
        // A deep link's sender controls the rest of its command line.
        assert_eq!(
            send_to_paths(
                &args(&["app", "--send-to", "margaya://open?server=a", file]),
                &cwd
            ),
            None
        );
        assert_eq!(
            send_to_paths(
                &args(&["app", "--send-to", file, "https://evil.example/x"]),
                &cwd
            ),
            None
        );
    }

    #[test]
    fn refuses_network_shares_and_device_paths_unread() {
        for path in [
            r"\\attacker.example\share\a.txt",
            "//attacker.example/share/a.txt",
            r"\\?\C:\secret.txt",
            r"\\?\UNC\host\share\a.txt",
            r"\\.\PhysicalDrive0",
            r"\??\C:\secret.txt",
            r"/\host\share",
        ] {
            let path = PathBuf::from(path);
            assert!(is_remote_or_device_path(&path), "{path:?}");
            let update = check_files(&[path]);
            assert!(update.attachments.is_empty());
            assert_eq!(update.notices.len(), 1);
            assert_eq!(update.notices[0].kind, NoticeKind::Unreadable);
        }
        // A share as the working directory of a relative path counts too.
        let joined = send_to_paths(
            &args(&["app", "--send-to", "a.txt"]),
            Path::new(r"\\host\share"),
        )
        .unwrap();
        assert!(is_remote_or_device_path(&joined[0]));
        for local in [
            r"C:\Users\a\b.txt",
            "/home/a/b.txt",
            r"\Users\a.txt",
            "rel.txt",
        ] {
            assert!(!is_remote_or_device_path(Path::new(local)), "{local}");
        }
    }

    #[test]
    fn checks_send_to_files_without_reading_them() {
        let dir = tempfile::tempdir().unwrap();
        let small = dir.path().join("notes.txt");
        fs::write(&small, b"hello").unwrap();
        let big = dir.path().join("big.bin");
        fs::File::create(&big)
            .unwrap()
            .set_len(MAX_ATTACHMENT_BYTES + 1)
            .unwrap();
        let folder = dir.path().join("folder");
        fs::create_dir(&folder).unwrap();
        let missing = dir.path().join("gone.pdf");
        let update = check_files(&[small.clone(), big, folder, missing]);
        assert_eq!(update.attachments.len(), 1);
        let attachment = &update.attachments[0];
        assert_eq!(
            (attachment.name.as_str(), attachment.size, attachment.temp),
            ("notes.txt", 5, false)
        );
        assert_eq!(attachment.content_type, "text/plain");
        assert_eq!(attachment.path, small);
        assert_eq!(
            update.notices,
            vec![
                Notice::about(NoticeKind::TooLarge, "big.bin"),
                Notice::about(NoticeKind::NotAFile, "folder"),
                Notice::about(NoticeKind::Unreadable, "gone.pdf"),
            ]
        );
        // The page sees names and sizes, never paths.
        let json = serde_json::to_string(&attachment.view()).unwrap();
        assert!(!json.contains(dir.path().to_str().unwrap()));
    }

    #[test]
    fn caps_the_number_of_files() {
        let dir = tempfile::tempdir().unwrap();
        let paths: Vec<PathBuf> = (0..MAX_ATTACHMENTS + 3)
            .map(|index| {
                let path = dir.path().join(format!("{index}.txt"));
                fs::write(&path, b"x").unwrap();
                path
            })
            .collect();
        let update = check_files(&paths);
        assert_eq!(update.attachments.len(), MAX_ATTACHMENTS);
        assert_eq!(update.notices, vec![Notice::new(NoticeKind::TooMany)]);
    }

    #[test]
    fn merges_drafts_up_to_the_cap() {
        let mut draft = Draft::EMPTY;
        let file = |name: &str| Attachment {
            id: name.to_string(),
            name: name.to_string(),
            path: PathBuf::from(name),
            size: 1,
            content_type: "text/plain".into(),
            temp: false,
            preview: None,
        };
        merge(
            &mut draft,
            DraftUpdate {
                title: Some("First".into()),
                attachments: (0..MAX_ATTACHMENTS - 1)
                    .map(|i| file(&i.to_string()))
                    .collect(),
                ..DraftUpdate::default()
            },
        );
        let first = draft.revision;
        merge(
            &mut draft,
            DraftUpdate {
                attachments: vec![file("a"), file("b")],
                ..DraftUpdate::default()
            },
        );
        assert!(draft.revision > first);
        assert_eq!(
            draft.title.as_deref(),
            Some("First"),
            "kept without a new title"
        );
        assert_eq!(draft.attachments.len(), MAX_ATTACHMENTS);
        assert_eq!(draft.notices, vec![Notice::new(NoticeKind::TooMany)]);
    }

    #[test]
    fn turns_clipboard_text_into_a_draft() {
        let update = text_update("  Fix the login bug\r\n\r\nSteps:\n1. open\n2. fail  ");
        assert_eq!(update.title.as_deref(), Some("Fix the login bug"));
        assert_eq!(
            update.description.as_deref(),
            Some("Steps:\n1. open\n2. fail")
        );
        assert!(update.notices.is_empty());

        let link = text_update("https://example.com/issues/42");
        assert_eq!(link.title.as_deref(), Some("https://example.com/issues/42"));
        assert_eq!(link.description, None);

        let long_link = format!("https://example.com/{}", "a".repeat(300));
        let update = text_update(&long_link);
        assert_eq!(update.title, None);
        assert_eq!(update.description.as_deref(), Some(long_link.as_str()));

        // Not a link: text with a scheme-like start, or a link plus words.
        assert_eq!(
            text_update("https://x.example see this").title.as_deref(),
            Some("https://x.example see this")
        );
        assert_eq!(
            text_update("   ").notices,
            vec![Notice::new(NoticeKind::ClipboardEmpty)]
        );
    }

    #[test]
    fn caps_clipboard_text() {
        let long_title = "é".repeat(MAX_TITLE_CHARS + 10);
        let update = text_update(&long_title);
        assert_eq!(update.title.unwrap().chars().count(), MAX_TITLE_CHARS);
        assert_eq!(update.notices, vec![Notice::new(NoticeKind::TitleTrimmed)]);

        let body = format!("Title\n{}", "ü".repeat(MAX_DESCRIPTION_BYTES));
        let update = text_update(&body);
        let description = update.description.unwrap();
        assert!(description.len() <= MAX_DESCRIPTION_BYTES);
        assert!(description.len() > MAX_DESCRIPTION_BYTES - 4);
        assert_eq!(
            update.notices,
            vec![Notice::new(NoticeKind::DescriptionTrimmed)]
        );
        assert_eq!(cut_bytes("aé", 2), "a");
        assert_eq!(cut_chars("abc", 3), ("abc".to_string(), false));
    }

    #[test]
    fn names_temporary_files_by_a_fresh_id() {
        let id = uuid::Uuid::new_v4();
        let name = temp_file_name(&id, "png");
        assert!(name.starts_with("capture-") && name.ends_with(".png"));
        assert_eq!(name.len(), "capture-".len() + 32 + ".png".len());
        assert!(is_temp_file_name(&name));
        assert!(!is_temp_file_name("capture-../../x.png"));
        assert!(!is_temp_file_name("notes.png"));
        assert!(!is_temp_file_name(&format!("capture-{}.exe", id.simple())));
    }

    #[test]
    fn writes_private_temporary_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_temp(dir.path(), "png", b"data").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"data");
        assert!(is_temp_file_name(
            &path.file_name().unwrap().to_string_lossy()
        ));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let attachment = temp_image(path.clone(), "Screenshot.png".into(), 4, None);
        assert_eq!(attachment.content_type, "image/png");
        attachment.drop_file();
        assert!(!path.exists());
    }

    #[test]
    fn sweeps_only_its_own_leftover_captures() {
        let dir = tempfile::tempdir().unwrap();
        let kept = write_temp(dir.path(), "png", b"in the draft").unwrap();
        let stale = write_temp(dir.path(), "jpg", b"left over").unwrap();
        let other = dir.path().join("notes.png");
        fs::write(&other, b"not ours").unwrap();
        sweep_temp_files(dir.path(), std::slice::from_ref(&kept));
        assert!(kept.exists());
        assert!(!stale.exists());
        assert!(other.exists());
        // At start and exit nothing is kept.
        sweep_temp_files(dir.path(), &[]);
        assert!(!kept.exists());
        assert!(other.exists());
        // A folder that isn't there yet is fine.
        sweep_temp_files(&dir.path().join("missing"), &[]);
    }

    #[test]
    fn guesses_content_types() {
        assert_eq!(content_type_for("a.PNG"), "image/png");
        assert_eq!(content_type_for("report.pdf"), "application/pdf");
        assert_eq!(content_type_for("noext"), "application/octet-stream");
        assert_eq!(
            content_type_for("archive.tar.gz"),
            "application/octet-stream"
        );
    }
}
