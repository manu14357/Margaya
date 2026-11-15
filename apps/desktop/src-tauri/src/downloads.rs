//! Downloads from server windows: where they are saved, and where a click on
//! their notification goes.
//!
//! A finished download is remembered in memory only, under a fresh random id
//! (the last [`KEPT`]). Its notification names only that id: on Windows the
//! toast launches `margaya://download?id=<uuid>` (protocol activation, like
//! `margaya://open`), on macOS and Linux the plugin's `tap` maps back to it.
//! A click shows the file selected in the system file manager; the file is
//! never opened or run. Any website can open a `margaya://` link, so a link
//! never carries a path, and an id this process didn't hand out (a forged
//! link, or a toast from before a restart) opens the Downloads folder.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use url::Url;
use uuid::Uuid;

use crate::auth::ALIAS_SCHEME;
use crate::state::{lock, AppState};

/// Finished downloads a notification click can still show.
pub const KEPT: usize = 50;
/// Running downloads whose destination is remembered (a download that never
/// reports its end falls out after this many newer ones).
const RUNNING: usize = 50;

/// The host of `margaya://download` links.
pub const LINK_HOST: &str = "download";

#[derive(Debug)]
struct Running {
    label: String,
    /// SHA-256 of the download URL: a `data:` URL can be megabytes.
    url: [u8; 32],
    path: PathBuf,
}

#[derive(Debug, Default)]
pub struct Downloads {
    saved: VecDeque<(String, PathBuf)>,
    running: VecDeque<Running>,
}

fn url_key(url: &str) -> [u8; 32] {
    Sha256::digest(url.as_bytes()).into()
}

impl Downloads {
    /// A download from window `label` started, saving to `path`.
    pub fn started(&mut self, label: &str, url: &str, path: PathBuf) {
        self.running.push_back(Running {
            label: label.to_string(),
            url: url_key(url),
            path,
        });
        while self.running.len() > RUNNING {
            self.running.pop_front();
        }
    }

    /// A download ended: where it was going (macOS reports no path at the
    /// end, so this is the only place it is known there).
    pub fn finished(&mut self, label: &str, url: &str) -> Option<PathBuf> {
        let key = url_key(url);
        let at = self
            .running
            .iter()
            .position(|running| running.label == label && running.url == key)?;
        self.running.remove(at).map(|running| running.path)
    }

    /// Another running download already writes to `path`: two downloads of
    /// the same name at once must not get the same file.
    pub fn is_running(&self, path: &Path) -> bool {
        self.running.iter().any(|running| running.path == path)
    }

    /// Remembers a saved file and returns the id its notification names.
    pub fn remember(&mut self, path: PathBuf) -> String {
        let id = Uuid::new_v4().hyphenated().to_string();
        self.saved.push_back((id.clone(), path));
        while self.saved.len() > KEPT {
            self.saved.pop_front();
        }
        id
    }

    pub fn saved(&self, id: &str) -> Option<&Path> {
        self.saved
            .iter()
            .find(|(known, _)| known == id)
            .map(|(_, path)| path.as_path())
    }
}

/// An id as the app hands them out: a UUID in lowercase hyphenated form,
/// nothing else (no paths, no other UUID spellings).
pub fn parse_id(raw: &str) -> Option<String> {
    let id = Uuid::try_parse(raw).ok()?.hyphenated().to_string();
    (id == raw).then_some(id)
}

/// The link a click on a download notification opens: the saved file's id,
/// or none (a failed download) for the Downloads folder.
pub fn click_link(id: Option<&str>) -> String {
    let mut link = Url::parse(&format!("{ALIAS_SCHEME}://{LINK_HOST}")).expect("static URL");
    if let Some(id) = id {
        link.query_pairs_mut().append_pair("id", id);
    }
    link.to_string()
}

/// What the file manager shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reveal {
    /// The file, selected in its folder.
    Select(PathBuf),
    /// A folder (the file's own, once the file is gone, or Downloads).
    Folder(PathBuf),
}

/// The file when it is still there, else its folder, else the Downloads
/// folder; nothing when not even that exists.
pub fn reveal_target(
    saved: Option<&Path>,
    downloads: Option<&Path>,
    exists: impl Fn(&Path) -> bool,
    is_dir: impl Fn(&Path) -> bool,
) -> Option<Reveal> {
    if let Some(file) = saved {
        if exists(file) {
            return Some(Reveal::Select(file.to_path_buf()));
        }
        if let Some(parent) = file
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty() && is_dir(parent))
        {
            return Some(Reveal::Folder(parent.to_path_buf()));
        }
    }
    downloads
        .filter(|dir| is_dir(dir))
        .map(|dir| Reveal::Folder(dir.to_path_buf()))
}

/// A click on a download notification (a `margaya://download` link or the
/// plugin's `tap`): shows the file this id names, or the Downloads folder.
pub fn show(app: &AppHandle, id: Option<&str>) {
    let state = app.state::<AppState>();
    // A page can open `margaya://download` as often as it likes: a double
    // click, or a flood of file-manager windows, is dropped like outside opens.
    let admission = lock(&state.opens).admit(
        "download-links",
        id.unwrap_or(""),
        std::time::Instant::now(),
    );
    if admission != crate::opener::Admission::Open {
        log::info!("ignored a repeated download click ({admission:?})");
        return;
    }
    let saved = id.and_then(|id| lock(&state.downloads).saved(id).map(Path::to_path_buf));
    if id.is_some() && saved.is_none() {
        log::info!("a download link names no download of this run; showing the Downloads folder");
    }
    let downloads = app.path().download_dir().ok();
    // The file checks and the shell call can block: never on this thread
    // (often the UI thread, from a deep link or a notification click).
    let spawned = std::thread::Builder::new()
        .name("show-in-folder".into())
        .spawn(move || {
            let Some(target) = reveal_target(
                saved.as_deref(),
                downloads.as_deref(),
                Path::exists,
                Path::is_dir,
            ) else {
                log::warn!("no folder to show for a download");
                return;
            };
            match crate::opener::show_in_folder(&target) {
                Ok(()) => log::info!("showed a download in its folder"),
                Err(error) => log::warn!("could not show a download in its folder: {error}"),
            }
        });
    if let Err(error) = spawned {
        log::warn!("could not start a thread to show a download: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{parse_deep_link, DeepLink};

    #[test]
    fn keeps_the_last_fifty_downloads_under_random_ids() {
        let mut downloads = Downloads::default();
        let first = downloads.remember(PathBuf::from("/d/first.png"));
        assert_eq!(parse_id(&first).as_deref(), Some(first.as_str()));
        assert_eq!(downloads.saved(&first), Some(Path::new("/d/first.png")));
        let ids: Vec<String> = (0..KEPT)
            .map(|n| downloads.remember(PathBuf::from(format!("/d/{n}.png"))))
            .collect();
        // The oldest fell out; the newest fifty are still there.
        assert_eq!(downloads.saved(&first), None);
        assert_eq!(downloads.saved(&ids[0]), Some(Path::new("/d/0.png")));
        assert_eq!(
            downloads.saved(&ids[KEPT - 1]),
            Some(Path::new("/d/49.png"))
        );
        assert_eq!(downloads.saved.len(), KEPT);
        // Every id is new.
        let mut unique = ids.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), KEPT);
        // An id this run never handed out names nothing.
        assert_eq!(
            downloads.saved("5b0c8a52-3f7e-4c1d-9a7e-2d4f1c6b8e91"),
            None
        );
        assert_eq!(downloads.saved(""), None);
    }

    #[test]
    fn remembers_where_running_downloads_go() {
        let mut downloads = Downloads::default();
        downloads.started(
            "server-a-1",
            "blob:https://app.example/1",
            PathBuf::from("/d/a.png"),
        );
        downloads.started(
            "server-a-1",
            "blob:https://app.example/2",
            PathBuf::from("/d/a (2).png"),
        );
        assert!(downloads.is_running(Path::new("/d/a.png")));
        assert!(!downloads.is_running(Path::new("/d/b.png")));
        // A third export of the same board at once gets a name of its own,
        // although neither earlier file is on disk yet.
        let next = crate::windows::unique_path(Path::new("/d"), "a.png", |path| {
            downloads.is_running(path)
        });
        assert_eq!(next, Path::new("/d").join("a (3).png"));
        // Another window's download of the same URL is its own.
        assert_eq!(
            downloads.finished("server-b", "blob:https://app.example/1"),
            None
        );
        assert_eq!(
            downloads.finished("server-a-1", "blob:https://app.example/1"),
            Some(PathBuf::from("/d/a.png"))
        );
        assert_eq!(
            downloads.finished("server-a-1", "blob:https://app.example/1"),
            None
        );
        assert!(!downloads.is_running(Path::new("/d/a.png")));
        for n in 0..=RUNNING {
            downloads.started(
                "w",
                &format!("https://x/{n}"),
                PathBuf::from(format!("/d/{n}")),
            );
        }
        assert_eq!(downloads.running.len(), RUNNING);
    }

    #[test]
    fn accepts_only_ids_in_their_own_form() {
        let id = "5b0c8a52-3f7e-4c1d-9a7e-2d4f1c6b8e91";
        assert_eq!(parse_id(id).as_deref(), Some(id));
        for bad in [
            "",
            "5B0C8A52-3F7E-4C1D-9A7E-2D4F1C6B8E91",
            "5b0c8a523f7e4c1d9a7e2d4f1c6b8e91",
            "{5b0c8a52-3f7e-4c1d-9a7e-2d4f1c6b8e91}",
            "urn:uuid:5b0c8a52-3f7e-4c1d-9a7e-2d4f1c6b8e91",
            "C:\\Users\\me\\Downloads\\report.csv",
            "/home/me/Downloads/report.csv",
            "../../etc/passwd",
            "5b0c8a52-3f7e-4c1d-9a7e-2d4f1c6b8e91/../x",
        ] {
            assert_eq!(parse_id(bad), None, "{bad}");
        }
    }

    #[test]
    fn links_carry_only_the_id() {
        let id = "5b0c8a52-3f7e-4c1d-9a7e-2d4f1c6b8e91";
        let link = click_link(Some(id));
        assert_eq!(link, format!("margaya://download?id={id}"));
        assert_eq!(
            parse_deep_link(&Url::parse(&link).unwrap()),
            Some(DeepLink::Download {
                id: Some(id.into())
            })
        );
        let folder = click_link(None);
        assert_eq!(folder, "margaya://download");
        assert_eq!(
            parse_deep_link(&Url::parse(&folder).unwrap()),
            Some(DeepLink::Download { id: None })
        );
    }

    #[test]
    fn shows_the_file_its_folder_or_downloads() {
        let file = Path::new("/home/me/Downloads/board.png");
        let downloads = Path::new("/home/me/Downloads");
        let all = |_: &Path| true;
        let none = |_: &Path| false;
        // Still there: selected in its folder.
        assert_eq!(
            reveal_target(Some(file), Some(downloads), all, all),
            Some(Reveal::Select(file.to_path_buf()))
        );
        // Deleted or moved: its folder.
        assert_eq!(
            reveal_target(Some(file), Some(downloads), none, all),
            Some(Reveal::Folder(downloads.to_path_buf()))
        );
        let elsewhere = Path::new("/mnt/usb/board.png");
        let only_downloads = |path: &Path| path == downloads;
        assert_eq!(
            reveal_target(Some(elsewhere), Some(downloads), none, only_downloads),
            Some(Reveal::Folder(downloads.to_path_buf()))
        );
        // Unknown id (a forged link, or a toast from before a restart).
        assert_eq!(
            reveal_target(None, Some(downloads), all, all),
            Some(Reveal::Folder(downloads.to_path_buf()))
        );
        // No folder at all.
        assert_eq!(reveal_target(None, None, all, all), None);
        assert_eq!(reveal_target(Some(file), Some(downloads), none, none), None);
        // A bare name has no folder of its own.
        assert_eq!(
            reveal_target(Some(Path::new("board.png")), Some(downloads), none, all),
            Some(Reveal::Folder(downloads.to_path_buf()))
        );
    }
}
