//! The Files window's boundary, without Tauri: which paths it may read, and
//! how folders are listed and searched. Everything here is read-only.
//!
//! The window may read only inside the folders the person picked (a
//! "place", recursively) and the exact files they dropped on it or opened
//! from Recent. A path from the page is checked before anything else
//! touches the file system: it must be absolute, local (no network share,
//! device or NT path) and free of `..`; then it is resolved with every link
//! and junction followed, and the resolved path must still be inside a
//! place's resolved folder or be one of the granted files. So a link inside
//! a place that points elsewhere is refused, and nothing escapes a place.

use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// Entries one listing returns at most; the rest are counted, not sent.
pub const MAX_LIST_ENTRIES: usize = 50_000;
/// Matches a recursive search returns at most.
pub const MAX_SEARCH_RESULTS: usize = 500;
/// Entries a recursive search looks at before it stops.
pub const MAX_SEARCH_VISITS: usize = 200_000;
/// Longest path text accepted from the page.
const MAX_PATH_TEXT: usize = 4096;

/// Why a path can't be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Denied {
    /// Malformed, relative, a network share or device path, or outside every
    /// place and granted file.
    Outside,
    /// The path doesn't exist (any more).
    Missing,
    /// The system refused to read it.
    NoAccess,
}

/// A place: a folder the person picked, as they picked it (`display`) and
/// resolved at that moment (`canonical`). A place whose folder now resolves
/// elsewhere (moved, or swapped for a link) grants nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Root {
    pub id: String,
    pub display: PathBuf,
    pub canonical: PathBuf,
    /// The folder still resolves to `canonical`.
    pub available: bool,
}

/// What the Files window may read now.
#[derive(Debug, Default, Clone)]
pub struct Scope {
    pub roots: Vec<Root>,
    /// Resolved paths of single files the person granted.
    pub files: HashSet<PathBuf>,
}

/// A path that passed the scope check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    /// With every link followed.
    pub canonical: PathBuf,
    /// The same place in the person's own spelling: the place's folder as
    /// picked plus the resolved rest, or the plain resolved path.
    pub display: PathBuf,
    /// The place it is in (the innermost, when places nest).
    pub root: Option<String>,
}

/// A network share (`\\host\share`, `//host/share`) or a device or NT path
/// (`\\?\…`, `\\.\…`, `\??\…`). Even reading the metadata of a share can send
/// the person's credentials to that host, so these are refused before the
/// file system is touched.
pub fn is_remote_or_device_path(path: &Path) -> bool {
    crate::quick_add::is_remote_or_device_path(path)
}

/// The lexical checks, before the file system is asked anything.
pub fn check_text(raw: &str) -> Result<PathBuf, Denied> {
    if raw.is_empty() || raw.len() > MAX_PATH_TEXT || raw.contains('\0') {
        return Err(Denied::Outside);
    }
    let path = PathBuf::from(raw);
    if !path.is_absolute() || is_remote_or_device_path(&path) {
        return Err(Denied::Outside);
    }
    if path.components().any(|part| matches!(part, Component::ParentDir)) {
        return Err(Denied::Outside);
    }
    Ok(path)
}

/// Resolves a path with every link, junction and `.` followed.
pub fn canonical(path: &Path) -> Result<PathBuf, Denied> {
    fs::canonicalize(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => Denied::Missing,
        std::io::ErrorKind::PermissionDenied => Denied::NoAccess,
        _ => Denied::Missing,
    })
}

/// Drops Windows' `\\?\` from a resolved local path when that is safe.
pub fn simplified(path: &Path) -> PathBuf {
    dunce::simplified(path).to_path_buf()
}

impl Scope {
    /// The innermost available place containing a resolved path.
    fn root_of(&self, canonical: &Path) -> Option<&Root> {
        self.roots
            .iter()
            .filter(|root| root.available && canonical.starts_with(&root.canonical))
            .max_by_key(|root| root.canonical.components().count())
    }

    /// True when a resolved path may be read.
    pub fn allows(&self, canonical: &Path) -> bool {
        self.root_of(canonical).is_some() || self.files.contains(canonical)
    }

    /// Checks a path the page sent.
    pub fn resolve(&self, raw: &str) -> Result<Resolved, Denied> {
        let path = check_text(raw)?;
        let canonical = canonical(&path)?;
        if let Some(root) = self.root_of(&canonical) {
            let rest = canonical
                .strip_prefix(&root.canonical)
                .map_err(|_| Denied::Outside)?;
            return Ok(Resolved {
                display: join_display(&root.display, rest),
                canonical,
                root: Some(root.id.clone()),
            });
        }
        if self.files.contains(&canonical) {
            return Ok(Resolved {
                display: simplified(&canonical),
                canonical,
                root: None,
            });
        }
        Err(Denied::Outside)
    }

    /// The place a resolved path is in, by id.
    pub fn root(&self, id: &str) -> Option<&Root> {
        self.roots.iter().find(|root| root.id == id)
    }
}

fn join_display(base: &Path, rest: &Path) -> PathBuf {
    if rest.as_os_str().is_empty() {
        base.to_path_buf()
    } else {
        base.join(rest)
    }
}

/// One step of the breadcrumb: a folder from the place down to here.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Crumb {
    pub name: String,
    pub path: String,
}

/// The breadcrumb from a place's folder to `display`, which is inside it.
pub fn crumbs(root: &Root, display: &Path) -> Vec<Crumb> {
    let root_name = name_of(&root.display);
    let mut out = vec![Crumb {
        name: root_name,
        path: root.display.to_string_lossy().into_owned(),
    }];
    let Ok(rest) = display.strip_prefix(&root.display) else {
        return out;
    };
    let mut current = root.display.clone();
    for part in rest.components() {
        if let Component::Normal(name) = part {
            current.push(name);
            out.push(Crumb {
                name: name.to_string_lossy().into_owned(),
                path: current.to_string_lossy().into_owned(),
            });
        }
    }
    out
}

/// A path's last part, or the whole path for a drive or `/`.
pub fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    Folder,
    File,
    /// A device, socket or a link that leads nowhere.
    Other,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    /// Bytes, for files.
    pub size: Option<u64>,
    /// Unix milliseconds.
    pub modified: Option<u64>,
    /// A dot name, or hidden or system on Windows.
    pub hidden: bool,
    /// A link or junction (followed only while it stays inside the place).
    pub link: bool,
    /// For search results: the folder it is in, relative to where the
    /// search started ("" for that folder itself).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
}

fn millis(meta: &fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

#[cfg(windows)]
fn hidden_attribute(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;
    meta.file_attributes() & (HIDDEN | SYSTEM) != 0
}

#[cfg(not(windows))]
fn hidden_attribute(_meta: &fs::Metadata) -> bool {
    false
}

/// An entry from what `read_dir` knows (on Windows that is the directory's
/// own record, so no extra call per file); a link is followed for its kind,
/// size and date, without checking where it leads (opening it is checked).
fn entry_from(dir_entry: &fs::DirEntry, display_dir: &Path) -> Option<Entry> {
    let name = dir_entry.file_name().to_str()?.to_string();
    let file_type = dir_entry.file_type().ok()?;
    let link = file_type.is_symlink();
    let own = dir_entry.metadata().ok();
    let target = if link {
        fs::metadata(dir_entry.path()).ok()
    } else {
        own.clone()
    };
    let hidden = name.starts_with('.') || own.as_ref().is_some_and(hidden_attribute);
    let (kind, size, modified) = match &target {
        Some(meta) if meta.is_dir() => (EntryKind::Folder, None, millis(meta)),
        Some(meta) if meta.is_file() => (EntryKind::File, Some(meta.len()), millis(meta)),
        Some(meta) => (EntryKind::Other, None, millis(meta)),
        None => (EntryKind::Other, None, own.as_ref().and_then(millis)),
    };
    Some(Entry {
        path: display_dir.join(&name).to_string_lossy().into_owned(),
        name,
        kind,
        size,
        modified,
        hidden,
        link,
        folder: None,
    })
}

/// The details of one path, as an entry (for dropped and recent files).
pub fn entry_for(canonical: &Path, display: &Path) -> Option<Entry> {
    let meta = fs::metadata(canonical).ok()?;
    let kind = if meta.is_dir() {
        EntryKind::Folder
    } else if meta.is_file() {
        EntryKind::File
    } else {
        EntryKind::Other
    };
    let name = name_of(display);
    Some(Entry {
        hidden: name.starts_with('.') || hidden_attribute(&meta),
        name,
        path: display.to_string_lossy().into_owned(),
        kind,
        size: meta.is_file().then_some(meta.len()),
        modified: millis(&meta),
        link: false,
        folder: None,
    })
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub entries: Vec<Entry>,
    /// Entries left out past [`MAX_LIST_ENTRIES`].
    pub omitted: usize,
}

/// Lists a folder (resolved `canonical`, shown as `display`). Names that
/// aren't valid Unicode are left out: they couldn't be sent back.
pub fn list_dir(canonical: &Path, display: &Path, cap: usize) -> Result<Listing, Denied> {
    let reader = fs::read_dir(canonical).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => Denied::Missing,
        _ => Denied::NoAccess,
    })?;
    let mut entries = Vec::new();
    let mut omitted = 0;
    for dir_entry in reader.flatten() {
        if entries.len() >= cap {
            omitted += 1;
            continue;
        }
        if let Some(entry) = entry_from(&dir_entry, display) {
            entries.push(entry);
        }
    }
    Ok(Listing { entries, omitted })
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchOutcome {
    pub entries: Vec<Entry>,
    /// Stopped at [`MAX_SEARCH_RESULTS`] matches or [`MAX_SEARCH_VISITS`]
    /// entries.
    pub truncated: bool,
    pub cancelled: bool,
}

/// Finds entries whose name contains `query` (any case) under a folder,
/// breadth first. Links and junctions are listed but never entered, so the
/// search can't loop or leave the place. `stop` cancels it.
pub fn search(
    canonical: &Path,
    display: &Path,
    query: &str,
    include_hidden: bool,
    stop: &AtomicBool,
) -> SearchOutcome {
    let needle = query.trim().to_lowercase();
    let mut outcome = SearchOutcome::default();
    if needle.is_empty() {
        return outcome;
    }
    let mut queue: std::collections::VecDeque<(PathBuf, PathBuf, String)> =
        std::collections::VecDeque::from([(canonical.to_path_buf(), display.to_path_buf(), String::new())]);
    let mut visits = 0usize;
    while let Some((dir, shown, relative)) = queue.pop_front() {
        let Ok(reader) = fs::read_dir(&dir) else {
            continue;
        };
        for dir_entry in reader.flatten() {
            if stop.load(Ordering::Relaxed) {
                outcome.cancelled = true;
                return outcome;
            }
            visits += 1;
            if visits > MAX_SEARCH_VISITS {
                outcome.truncated = true;
                return outcome;
            }
            let Some(mut entry) = entry_from(&dir_entry, &shown) else {
                continue;
            };
            if entry.hidden && !include_hidden {
                continue;
            }
            if entry.kind == EntryKind::Folder && !entry.link {
                let child_relative = if relative.is_empty() {
                    entry.name.clone()
                } else {
                    format!("{relative}{}{}", std::path::MAIN_SEPARATOR, entry.name)
                };
                queue.push_back((dir_entry.path(), shown.join(&entry.name), child_relative));
            }
            if entry.name.to_lowercase().contains(&needle) {
                entry.folder = Some(relative.clone());
                outcome.entries.push(entry);
                if outcome.entries.len() >= MAX_SEARCH_RESULTS {
                    outcome.truncated = true;
                    return outcome;
                }
            }
        }
    }
    outcome
}

/// Files that run code when "opened": the Files window shows them in their
/// folder instead of opening them.
pub fn runs_code(name: &str) -> bool {
    const EXTENSIONS: &[&str] = &[
        "app", "appimage", "appref-ms", "application", "bat", "bin", "cmd", "com", "command",
        "cpl", "desktop", "diagcab", "exe", "gadget", "hta", "inf", "ins", "isp", "jar", "js",
        "jse", "lnk", "msc", "msi", "msix", "msixbundle", "msp", "mst", "pif", "pkg", "ps1",
        "ps1xml", "ps2", "psc1", "psd1", "psm1", "reg", "run", "scf", "scr", "sct", "settingcontent-ms",
        "sh", "shb", "url", "vb", "vbe", "vbs", "website", "ws", "wsc", "wsf", "wsh", "xbap",
        "workflow", "action", "csh", "ksh", "py", "pyw", "pl", "rb", "dll", "sys", "drv", "ocx",
    ];
    let lower = name.to_lowercase();
    let lower = lower.trim_end_matches(['.', ' ']);
    match lower.rsplit_once('.') {
        Some((_, extension)) => EXTENSIONS.contains(&extension),
        // No extension: on Linux and macOS that is how programs look.
        None => !cfg!(windows),
    }
}

/// The media type a streamed file is served with.
pub fn media_type(name: &str) -> &'static str {
    let extension = name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "ogv" => "video/ogg",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

/// A `Range: bytes=…` header as an inclusive (start, end), capped to
/// `chunk` bytes and to the file; none when it can't be served.
pub fn byte_range(header: Option<&str>, size: u64, chunk: u64) -> Option<(u64, u64)> {
    if size == 0 {
        return None;
    }
    let (start, end) = match header {
        None => (0, size - 1),
        Some(value) => {
            let spec = value.trim().strip_prefix("bytes=")?;
            if spec.contains(',') {
                return None;
            }
            let (from, to) = spec.split_once('-')?;
            match (from.trim(), to.trim()) {
                ("", "") => return None,
                // The last N bytes.
                ("", last) => {
                    let last: u64 = last.parse().ok()?;
                    if last == 0 {
                        return None;
                    }
                    (size.saturating_sub(last), size - 1)
                }
                (from, "") => (from.parse().ok()?, size - 1),
                (from, to) => (from.parse().ok()?, to.parse::<u64>().ok()?.min(size - 1)),
            }
        }
    };
    if start > end || start >= size {
        return None;
    }
    Some((start, end.min(start.saturating_add(chunk) - 1)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(dir: &Path) -> Root {
        Root {
            id: "r1".into(),
            display: dir.to_path_buf(),
            canonical: fs::canonicalize(dir).unwrap(),
            available: true,
        }
    }

    fn text(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn reads_inside_a_place_and_nowhere_else() {
        let base = tempfile::tempdir().unwrap();
        let place = base.path().join("place");
        let outside = base.path().join("outside");
        fs::create_dir_all(place.join("sub")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(place.join("sub").join("a.txt"), "a").unwrap();
        fs::write(outside.join("secret.txt"), "s").unwrap();
        let scope = Scope {
            roots: vec![root(&place)],
            files: HashSet::new(),
        };

        let inside = scope.resolve(&text(&place.join("sub").join("a.txt"))).unwrap();
        assert_eq!(inside.root.as_deref(), Some("r1"));
        assert_eq!(inside.display, place.join("sub").join("a.txt"));
        assert_eq!(scope.resolve(&text(&place)).unwrap().display, place);

        assert_eq!(scope.resolve(&text(&outside.join("secret.txt"))), Err(Denied::Outside));
        // `..` never gets as far as the file system.
        let climbing = format!("{}{}..{}outside{}secret.txt", text(&place), std::path::MAIN_SEPARATOR, std::path::MAIN_SEPARATOR, std::path::MAIN_SEPARATOR);
        assert_eq!(scope.resolve(&climbing), Err(Denied::Outside));
        // A sibling whose name starts like the place isn't in it.
        let sibling = base.path().join("place-2");
        fs::create_dir_all(&sibling).unwrap();
        assert_eq!(scope.resolve(&text(&sibling)), Err(Denied::Outside));
        assert_eq!(scope.resolve(&text(&place.join("gone.txt"))), Err(Denied::Missing));
        assert_eq!(scope.resolve("relative/a.txt"), Err(Denied::Outside));
        assert_eq!(scope.resolve(""), Err(Denied::Outside));
        assert_eq!(scope.resolve("C:\\a\0b"), Err(Denied::Outside));
    }

    #[cfg(windows)]
    #[test]
    fn refuses_system_files_shares_and_device_paths() {
        let base = tempfile::tempdir().unwrap();
        let scope = Scope {
            roots: vec![root(base.path())],
            files: HashSet::new(),
        };
        for path in [
            r"C:\Windows\win.ini",
            r"\\?\C:\Windows\win.ini",
            r"\\.\C:\Windows\win.ini",
            r"\??\C:\Windows\win.ini",
            r"\\host\share\a.txt",
            r"//host/share/a.txt",
            r"\\?\UNC\host\share\a.txt",
            r"\\.\PhysicalDrive0",
            r"C:Windows\win.ini",
        ] {
            assert_eq!(scope.resolve(path), Err(Denied::Outside), "{path}");
        }
    }

    #[test]
    fn a_link_out_of_a_place_is_refused() {
        let base = tempfile::tempdir().unwrap();
        let place = base.path().join("place");
        let outside = base.path().join("outside");
        fs::create_dir_all(&place).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.txt"), "s").unwrap();
        let link = place.join("escape");
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&outside, &link).is_ok();
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_dir(&outside, &link).is_ok()
            || std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(&link)
                .arg(&outside)
                .output()
                .is_ok_and(|output| output.status.success());
        if !made {
            eprintln!("skipped: this machine can't make links");
            return;
        }
        let scope = Scope {
            roots: vec![root(&place)],
            files: HashSet::new(),
        };
        assert_eq!(scope.resolve(&text(&link.join("secret.txt"))), Err(Denied::Outside));
        assert_eq!(scope.resolve(&text(&link)), Err(Denied::Outside));
        // Listed, marked as a link; a search never enters it.
        let listing = list_dir(&scope.roots[0].canonical, &place, 10).unwrap();
        assert!(listing.entries.iter().any(|entry| entry.name == "escape" && entry.link));
        let found = search(&scope.roots[0].canonical, &place, "secret", true, &AtomicBool::new(false));
        assert!(found.entries.is_empty());
    }

    #[test]
    fn granted_files_are_readable_alone() {
        let base = tempfile::tempdir().unwrap();
        let file = base.path().join("dropped.pdf");
        let other = base.path().join("other.pdf");
        fs::write(&file, "x").unwrap();
        fs::write(&other, "y").unwrap();
        let mut scope = Scope::default();
        scope.files.insert(fs::canonicalize(&file).unwrap());
        let resolved = scope.resolve(&text(&file)).unwrap();
        assert_eq!(resolved.root, None);
        assert_eq!(scope.resolve(&text(&other)), Err(Denied::Outside));
        assert_eq!(scope.resolve(&text(base.path())), Err(Denied::Outside));
    }

    #[test]
    fn a_moved_or_removed_place_grants_nothing() {
        let base = tempfile::tempdir().unwrap();
        fs::write(base.path().join("a.txt"), "a").unwrap();
        let mut place = root(base.path());
        place.available = false;
        let scope = Scope {
            roots: vec![place],
            files: HashSet::new(),
        };
        assert_eq!(scope.resolve(&text(&base.path().join("a.txt"))), Err(Denied::Outside));
        assert_eq!(Scope::default().resolve(&text(&base.path().join("a.txt"))), Err(Denied::Outside));
    }

    #[test]
    fn nested_places_pick_the_innermost_and_build_crumbs() {
        let base = tempfile::tempdir().unwrap();
        let inner = base.path().join("a").join("b");
        fs::create_dir_all(inner.join("c")).unwrap();
        let mut outer = root(base.path());
        outer.id = "outer".into();
        let mut nested = root(&inner);
        nested.id = "inner".into();
        let scope = Scope {
            roots: vec![outer.clone(), nested.clone()],
            files: HashSet::new(),
        };
        let resolved = scope.resolve(&text(&inner.join("c"))).unwrap();
        assert_eq!(resolved.root.as_deref(), Some("inner"));
        let trail = crumbs(&nested, &resolved.display);
        assert_eq!(trail.len(), 2);
        assert_eq!(trail[0].name, "b");
        assert_eq!(trail[1].name, "c");
        assert_eq!(trail[1].path, text(&inner.join("c")));
        assert_eq!(crumbs(&outer, &inner).len(), 3);
    }

    #[test]
    fn lists_folders_files_and_details() {
        let base = tempfile::tempdir().unwrap();
        fs::create_dir(base.path().join("docs")).unwrap();
        fs::write(base.path().join("notes.md"), "hello").unwrap();
        fs::write(base.path().join(".env"), "x").unwrap();
        let listing = list_dir(base.path(), base.path(), 100).unwrap();
        let by_name = |name: &str| listing.entries.iter().find(|entry| entry.name == name).unwrap();
        assert_eq!(by_name("docs").kind, EntryKind::Folder);
        assert_eq!(by_name("notes.md").kind, EntryKind::File);
        assert_eq!(by_name("notes.md").size, Some(5));
        assert!(by_name("notes.md").modified.is_some());
        assert_eq!(by_name("notes.md").path, text(&base.path().join("notes.md")));
        assert!(by_name(".env").hidden);
        assert!(!by_name("notes.md").hidden);

        let capped = list_dir(base.path(), base.path(), 1).unwrap();
        assert_eq!((capped.entries.len(), capped.omitted), (1, 2));
        assert_eq!(list_dir(&base.path().join("nope"), base.path(), 10), Err(Denied::Missing));
    }

    #[test]
    fn searches_below_a_folder_and_stops_when_asked() {
        let base = tempfile::tempdir().unwrap();
        let deep = base.path().join("a").join("b");
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("Report-2026.pdf"), "x").unwrap();
        fs::write(base.path().join("report.txt"), "x").unwrap();
        fs::write(base.path().join("other.txt"), "x").unwrap();
        fs::write(deep.join(".report-hidden"), "x").unwrap();
        let found = search(base.path(), base.path(), "REPORT", false, &AtomicBool::new(false));
        let mut names: Vec<(&str, &str)> = found
            .entries
            .iter()
            .map(|entry| (entry.name.as_str(), entry.folder.as_deref().unwrap()))
            .collect();
        names.sort();
        let nested = format!("a{}b", std::path::MAIN_SEPARATOR);
        assert_eq!(names, [("Report-2026.pdf", nested.as_str()), ("report.txt", "")]);
        assert!(!found.truncated && !found.cancelled);

        let with_hidden = search(base.path(), base.path(), "report", true, &AtomicBool::new(false));
        assert_eq!(with_hidden.entries.len(), 3);
        let stopped = search(base.path(), base.path(), "report", false, &AtomicBool::new(true));
        assert!(stopped.cancelled);
        assert!(search(base.path(), base.path(), "  ", false, &AtomicBool::new(false)).entries.is_empty());
    }

    #[test]
    fn knows_files_that_run_code() {
        for name in ["setup.exe", "RUN.BAT", "a.ps1", "x.lnk", "m.msi", "s.vbs", "evil.exe.", "page.url", "tool.js"] {
            assert!(runs_code(name), "{name}");
        }
        for name in ["report.pdf", "notes.md", "data.csv", "clip.mp4", "model.stl", "archive.zip", "site.html"] {
            assert!(!runs_code(name), "{name}");
        }
    }

    #[test]
    fn serves_byte_ranges() {
        assert_eq!(byte_range(None, 100, 1000), Some((0, 99)));
        assert_eq!(byte_range(None, 100, 10), Some((0, 9)));
        assert_eq!(byte_range(Some("bytes=10-19"), 100, 1000), Some((10, 19)));
        assert_eq!(byte_range(Some("bytes=10-"), 100, 1000), Some((10, 99)));
        assert_eq!(byte_range(Some("bytes=10-"), 100, 5), Some((10, 14)));
        assert_eq!(byte_range(Some("bytes=-10"), 100, 1000), Some((90, 99)));
        assert_eq!(byte_range(Some("bytes=90-500"), 100, 1000), Some((90, 99)));
        assert_eq!(byte_range(Some("bytes=100-"), 100, 1000), None);
        assert_eq!(byte_range(Some("bytes=5-1"), 100, 1000), None);
        assert_eq!(byte_range(Some("bytes=0-1,4-5"), 100, 1000), None);
        assert_eq!(byte_range(Some("items=0-1"), 100, 1000), None);
        assert_eq!(byte_range(None, 0, 1000), None);
        assert_eq!(media_type("Clip.MP4"), "video/mp4");
        assert_eq!(media_type("song.wav"), "audio/wav");
        assert_eq!(media_type("x"), "application/octet-stream");
    }
}
