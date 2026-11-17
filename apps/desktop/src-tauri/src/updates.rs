//! Signed self-updates from GitHub Releases (contract §6). The endpoint and
//! the updater public key live in tauri.conf.json under plugins.updater.
//!
//! On Linux only the AppImage updates itself. A .deb or .rpm belongs to the
//! system's package manager, so the app only says a new version exists and
//! sends people to the download page for the new package.

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::utils::config::BundleType;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::menus;
use crate::prefs::{self, UpdateChannel};
use crate::state::{lock, AppState};

/// True once tauri.conf.json carries the real updater public key.
// TODO(release): replace the "TODO-…" placeholder in plugins.updater.pubkey with
// the public half of the updater key (`pnpm tauri signer generate`). The private
// key lives only in CI secrets; losing it strands every installed copy.
pub fn pubkey_configured(app: &AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(|pubkey| pubkey.as_str())
        .is_some_and(|pubkey| !pubkey.trim().is_empty() && !pubkey.starts_with("TODO"))
}

/// Where people get a new package when the app can't update itself.
pub const DOWNLOAD_PAGE: &str = "https://margaya.app/download";

/// Whether this copy may replace itself: everywhere but a Linux system
/// package (deb, rpm) or a Linux binary outside any bundle (a development
/// build).
pub fn can_self_update(os: crate::titlebar::Os, bundle: Option<BundleType>) -> bool {
    match os {
        crate::titlebar::Os::Linux | crate::titlebar::Os::Other => {
            bundle == Some(BundleType::AppImage)
        }
        _ => true,
    }
}

/// [`can_self_update`] for this copy. The bundler stamps the bundle type
/// into the binary it packages.
pub fn self_update_supported() -> bool {
    can_self_update(
        crate::titlebar::current_os(),
        tauri::utils::platform::bundle_type(),
    )
}

/// The beta channel's manifest: a rolling release that desktop-release.yml
/// refreshes for every published prerelease.
pub const BETA_ENDPOINT: &str =
    "https://github.com/manu14357/Margaya/releases/download/desktop-beta/latest.json";

/// The newer of two offered versions; a version that isn't SemVer loses.
pub fn newer<'a>(a: Option<&'a str>, b: Option<&'a str>) -> Option<&'a str> {
    let parse = |v: &str| semver::Version::parse(v.trim_start_matches('v')).ok();
    match (a, b) {
        (Some(a), Some(b)) => match (parse(a), parse(b)) {
            (Some(va), Some(vb)) => Some(if vb > va { b } else { a }),
            (Some(_), None) => Some(a),
            (None, Some(_)) => Some(b),
            (None, None) => None,
        },
        (Some(a), None) => parse(a).map(|_| a),
        (None, Some(b)) => parse(b).map(|_| b),
        (None, None) => None,
    }
}

/// The update to offer on this copy's channel. Stable reads the configured
/// endpoint. Beta reads the beta manifest too and offers whichever release is
/// newer, so a beta tester still gets a stable release that passed the last
/// beta, and a missing beta manifest falls back to stable.
async fn find_update(app: &AppHandle) -> AppResult<Option<Update>> {
    let stable = app.updater().map_err(AppError::internal)?.check().await;
    if crate::prefs::get(app).update_channel != UpdateChannel::Beta {
        return stable.map_err(AppError::internal);
    }
    let beta = match Url::parse(BETA_ENDPOINT) {
        Ok(url) => match app.updater_builder().endpoints(vec![url]) {
            Ok(builder) => match builder.build() {
                Ok(updater) => updater.check().await,
                Err(error) => Err(error),
            },
            Err(error) => Err(error),
        },
        Err(error) => return Err(AppError::internal(error)),
    };
    let (beta, stable) = match (beta, stable) {
        (Err(_), Err(error)) => return Err(AppError::internal(error)),
        (beta, stable) => (beta.ok().flatten(), stable.ok().flatten()),
    };
    let pick = newer(
        beta.as_ref().map(|update| update.version.as_str()),
        stable.as_ref().map(|update| update.version.as_str()),
    )
    .map(str::to_string);
    Ok(match pick {
        Some(version)
            if beta
                .as_ref()
                .is_some_and(|update| update.version == version) =>
        {
            beta
        }
        Some(_) => stable,
        None => None,
    })
}

/// Looks for a newer release; remembers and announces it.
pub async fn check(app: &AppHandle) -> AppResult<Option<String>> {
    if !pubkey_configured(app) {
        log::warn!("updater public key not configured; skipping the update check");
        return Ok(None);
    }
    let update = find_update(app).await?;
    let version = update.map(|update| update.version);
    *lock(&app.state::<AppState>().available_update) = version.clone();
    if let Some(version) = &version {
        log::info!("update available: {version}");
        let _ = app.emit("update-available", version.clone());
    }
    menus::refresh_tray(app);
    Ok(version)
}

/// Downloads, verifies and installs the update, then restarts. A copy that
/// can't update itself opens the download page instead.
pub async fn install(app: &AppHandle) -> AppResult<()> {
    if !self_update_supported() {
        let page = Url::parse(DOWNLOAD_PAGE).map_err(AppError::internal)?;
        crate::opener::open_outside(app, "app", &page);
        return Ok(());
    }
    if !pubkey_configured(app) {
        return Err(AppError::internal("updater public key not configured"));
    }
    let Some(update) = find_update(app).await? else {
        return Ok(());
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(AppError::internal)?;
    app.restart();
}

/// Checks once shortly after launch, in release builds.
pub fn check_after_launch(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        if let Err(error) = check(&app).await {
            log::warn!("update check failed: {}", error.message);
        }
    });
}

#[tauri::command]
pub fn set_update_channel(app: AppHandle, channel: UpdateChannel) -> AppResult<()> {
    prefs::update(&app, |prefs| prefs.update_channel = channel)?;
    // What was offered on the other channel may not apply any more.
    *lock(&app.state::<AppState>().available_update) = None;
    menus::refresh_tray(&app);
    Ok(())
}

// What's new after an update.

/// Where release notes come from: the public releases API, without
/// credentials.
const RELEASE_API: &str = "https://api.github.com/repos/manu14357/Margaya/releases/tags/v";
/// The release page, as the fallback link.
const RELEASE_PAGE: &str = "https://github.com/manu14357/Margaya/releases/tag/v";

/// True from a start after an update until the person closes "What's new".
static WHATS_NEW_PENDING: AtomicBool = AtomicBool::new(false);

/// What a start means for "What's new", from the version seen last and this
/// one: (show it, the version to remember now).
pub fn after_start(last_seen: Option<&str>, current: &str) -> (bool, Option<String>) {
    let Some(last_seen) = last_seen else {
        // A new install (or the first start of a version with this
        // feature): nothing to announce.
        return (false, Some(current.to_string()));
    };
    let parse = |v: &str| semver::Version::parse(v).ok();
    match (parse(last_seen), parse(current)) {
        (Some(seen), Some(now)) if now > seen => (true, None),
        (_, _) if last_seen == current => (false, None),
        // A downgrade or an unreadable version: start over quietly.
        _ => (false, Some(current.to_string())),
    }
}

/// True after an update until the person closes "What's new".
pub fn whats_new_pending() -> bool {
    WHATS_NEW_PENDING.load(Ordering::Relaxed)
}

/// Compares this version with the last one seen, at startup.
pub fn note_version(app: &AppHandle) {
    let current = app.package_info().version.to_string();
    let last_seen = prefs::get(app).last_seen_version;
    let (pending, remember) = after_start(last_seen.as_deref(), &current);
    if let Some(version) = remember {
        if let Err(error) = prefs::update(app, |prefs| prefs.last_seen_version = Some(version)) {
            log::warn!("could not keep the app version: {}", error.message);
        }
    }
    WHATS_NEW_PENDING.store(pending, Ordering::Relaxed);
    if pending {
        log::info!("updated to {current}; the launcher shows what's new");
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsNewState {
    version: String,
    pending: bool,
}

#[tauri::command]
pub fn whats_new_state(app: AppHandle) -> WhatsNewState {
    WhatsNewState {
        version: app.package_info().version.to_string(),
        pending: whats_new_pending(),
    }
}

#[tauri::command]
pub fn dismiss_whats_new(app: AppHandle) -> AppResult<()> {
    WHATS_NEW_PENDING.store(false, Ordering::Relaxed);
    let current = app.package_info().version.to_string();
    prefs::update(&app, |prefs| prefs.last_seen_version = Some(current))
}

/// One block of release notes, as plain text. The launcher renders these as
/// text nodes; nothing from the release is ever treated as HTML.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NoteBlock {
    Heading { text: String },
    Item { text: String, depth: u8 },
    Paragraph { text: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotes {
    version: String,
    /// The release page, always on the project's own releases.
    url: String,
    /// Empty when the notes couldn't be fetched: the launcher shows the link.
    blocks: Vec<NoteBlock>,
}

const MAX_BLOCKS: usize = 120;
const MAX_TEXT: usize = 400;

/// Inline Markdown and HTML to plain text: tags, images and link targets go,
/// link text and code stay, commit hashes in parentheses go.
pub fn plain_text(line: &str) -> String {
    let mut out = String::new();
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            // An HTML tag or comment.
            '<' => {
                if let Some(end) = chars[i..].iter().position(|&ch| ch == '>') {
                    i += end + 1;
                    continue;
                }
                out.push(c);
            }
            // An image: dropped with its alt text.
            '!' if chars.get(i + 1) == Some(&'[') => {
                if let Some(skip) = link_end(&chars, i + 1) {
                    i = skip;
                    continue;
                }
                out.push(c);
            }
            // A link: keep its text.
            '[' => {
                if let Some(close) = chars[i..].iter().position(|&ch| ch == ']') {
                    let text: String = chars[i + 1..i + close].iter().collect();
                    if let Some(skip) = link_end(&chars, i) {
                        out.push_str(&text);
                        i = skip;
                        continue;
                    }
                }
                out.push(c);
            }
            '*' | '`' => {}
            '_' if chars.get(i + 1) == Some(&'_') => i += 1,
            c if c.is_control()
                || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}') =>
                {}
            c => out.push(c),
        }
        i += 1;
    }
    let decoded = out
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&");
    let without_hashes = strip_commit_refs(&decoded);
    let text = without_hashes
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if text.chars().count() > MAX_TEXT {
        let cut: String = text.chars().take(MAX_TEXT - 1).collect();
        format!("{}…", cut.trim_end())
    } else {
        text
    }
}

/// Where a `[text](target)` starting at `open` ends, if it is one.
fn link_end(chars: &[char], open: usize) -> Option<usize> {
    let close = open + chars[open..].iter().position(|&ch| ch == ']')?;
    if chars.get(close + 1) != Some(&'(') {
        return None;
    }
    let end = close + 1 + chars[close + 1..].iter().position(|&ch| ch == ')')?;
    Some(end + 1)
}

/// Drops "(abc1234)" commit references that release notes append.
fn strip_commit_refs(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find('(') {
        let (before, from) = rest.split_at(start);
        out.push_str(before);
        let inner_end = from.find(')');
        let is_hash = inner_end.is_some_and(|end| {
            let inner = &from[1..end];
            (7..=40).contains(&inner.len()) && inner.bytes().all(|b| b.is_ascii_hexdigit())
        });
        match (is_hash, inner_end) {
            (true, Some(end)) => rest = &from[end + 1..],
            _ => {
                out.push('(');
                rest = &from[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Release notes (Markdown) as structured plain text.
pub fn note_blocks(markdown: &str) -> Vec<NoteBlock> {
    let mut blocks = Vec::new();
    let mut paragraph: Vec<String> = Vec::new();
    let flush = |paragraph: &mut Vec<String>, blocks: &mut Vec<NoteBlock>| {
        let text = plain_text(&paragraph.join(" "));
        paragraph.clear();
        if !text.is_empty() {
            blocks.push(NoteBlock::Paragraph { text });
        }
    };
    for raw in markdown.lines() {
        if blocks.len() >= MAX_BLOCKS {
            break;
        }
        let indent = raw.chars().take_while(|c| *c == ' ' || *c == '\t').count();
        let line = raw.trim();
        if line.is_empty()
            || line.starts_with("```")
            || line
                .chars()
                .all(|c| matches!(c, '-' | '*' | '_' | '=' | ' '))
        {
            flush(&mut paragraph, &mut blocks);
            continue;
        }
        let line = line.trim_start_matches('>').trim();
        if let Some(heading) = line.strip_prefix('#') {
            flush(&mut paragraph, &mut blocks);
            let text = plain_text(heading.trim_start_matches('#'));
            if !text.is_empty() {
                blocks.push(NoteBlock::Heading { text });
            }
            continue;
        }
        let bullet = ["- ", "* ", "+ "]
            .iter()
            .find_map(|marker| line.strip_prefix(marker))
            .or_else(|| {
                let digits = line.chars().take_while(char::is_ascii_digit).count();
                (digits > 0 && line[digits..].starts_with(". ")).then(|| &line[digits + 2..])
            });
        if let Some(item) = bullet {
            flush(&mut paragraph, &mut blocks);
            let text = plain_text(item);
            if !text.is_empty() {
                let depth = u8::try_from((indent / 2).min(2)).unwrap_or(0);
                blocks.push(NoteBlock::Item { text, depth });
            }
            continue;
        }
        paragraph.push(line.replace('|', " "));
    }
    if blocks.len() < MAX_BLOCKS {
        flush(&mut paragraph, &mut blocks);
    }
    blocks
}

/// The release notes for a version (this app's when none is given). A
/// failed fetch returns no blocks, and the launcher shows the release link.
#[tauri::command]
pub async fn release_notes(app: AppHandle, version: Option<String>) -> AppResult<ReleaseNotes> {
    let version = version.unwrap_or_else(|| app.package_info().version.to_string());
    // Only a version goes into the URL, never a path.
    let version = semver::Version::parse(version.trim_start_matches('v'))
        .map_err(|_| AppError::new(ErrorKind::Internal, "not a version"))?
        .to_string();
    let url = format!("{RELEASE_PAGE}{version}");
    let http = app.state::<AppState>().http.clone();
    let response = http
        .get(format!("{RELEASE_API}{version}"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await;
    let body = match response {
        Ok(response) if response.status().is_success() => response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|json| {
                json.get("body")
                    .and_then(|body| body.as_str())
                    .map(str::to_string)
            }),
        Ok(response) => {
            log::info!("release notes unavailable ({})", response.status());
            None
        }
        Err(error) => {
            log::info!("release notes unavailable ({error})");
            None
        }
    };
    Ok(ReleaseNotes {
        version,
        url,
        blocks: body.as_deref().map(note_blocks).unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::titlebar::Os;

    #[test]
    fn beta_offers_the_newer_of_both_channels() {
        assert_eq!(
            newer(Some("1.5.0-beta.2"), Some("1.4.0")),
            Some("1.5.0-beta.2")
        );
        assert_eq!(newer(Some("1.5.0-beta.2"), Some("1.5.0")), Some("1.5.0"));
        assert_eq!(newer(None, Some("1.4.0")), Some("1.4.0"));
        assert_eq!(newer(Some("1.5.0-beta.1"), None), Some("1.5.0-beta.1"));
        assert_eq!(newer(Some("nope"), Some("1.4.0")), Some("1.4.0"));
        assert_eq!(newer(None, None), None);
        assert!(Url::parse(BETA_ENDPOINT).is_ok_and(|url| url.scheme() == "https"));
    }

    #[test]
    fn announces_only_an_upgrade() {
        assert_eq!(after_start(None, "1.4.0"), (false, Some("1.4.0".into())));
        assert_eq!(after_start(Some("1.4.0"), "1.4.0"), (false, None));
        assert_eq!(after_start(Some("1.4.0"), "1.5.0"), (true, None));
        assert_eq!(after_start(Some("1.5.0-beta.1"), "1.5.0"), (true, None));
        assert_eq!(
            after_start(Some("1.5.0"), "1.4.0"),
            (false, Some("1.4.0".into()))
        );
        assert_eq!(
            after_start(Some("junk"), "1.4.0"),
            (false, Some("1.4.0".into()))
        );
    }

    #[test]
    fn release_notes_become_plain_structured_text() {
        let markdown = "## [1.5.0](https://example.com/compare) (2026-11-17)\n\n\
            ### Features\n\n\
            * **desktop:** customizable shortcuts ([#12](https://example.com/12)) ([abc1234](https://example.com/c))\n\
            * add <script>alert(1)</script>a tray ![shot](https://example.com/x.png) menu\n  \
              - nested `code` item\n\n\
            Some text\nthat wraps &amp; continues.\n\n---\n\n\
            1. numbered <b>bold</b>\n";
        let blocks = note_blocks(markdown);
        assert_eq!(
            blocks,
            vec![
                NoteBlock::Heading {
                    text: "1.5.0 (2026-11-17)".into()
                },
                NoteBlock::Heading {
                    text: "Features".into()
                },
                NoteBlock::Item {
                    text: "desktop: customizable shortcuts (#12)".into(),
                    depth: 0
                },
                NoteBlock::Item {
                    text: "add alert(1)a tray menu".into(),
                    depth: 0
                },
                NoteBlock::Item {
                    text: "nested code item".into(),
                    depth: 1
                },
                NoteBlock::Paragraph {
                    text: "Some text that wraps & continues.".into()
                },
                NoteBlock::Item {
                    text: "numbered bold".into(),
                    depth: 0
                },
            ]
        );
    }

    #[test]
    fn release_notes_are_bounded() {
        let long = format!("- {}\n", "x".repeat(2000)).repeat(500);
        let blocks = note_blocks(&long);
        assert_eq!(blocks.len(), MAX_BLOCKS);
        let NoteBlock::Item { text, .. } = &blocks[0] else {
            panic!("expected an item");
        };
        assert_eq!(text.chars().count(), MAX_TEXT);
        assert_eq!(plain_text("a\u{202E}b\u{0000}c"), "abc");
    }

    #[test]
    fn only_linux_appimages_update_themselves_on_linux() {
        assert!(can_self_update(Os::Linux, Some(BundleType::AppImage)));
        // The package manager owns a .deb or .rpm install.
        assert!(!can_self_update(Os::Linux, Some(BundleType::Deb)));
        assert!(!can_self_update(Os::Linux, Some(BundleType::Rpm)));
        assert!(!can_self_update(Os::Linux, None));
        assert!(!can_self_update(Os::Other, None));
        // Windows and macOS installs always do.
        assert!(can_self_update(Os::Windows, Some(BundleType::Nsis)));
        assert!(can_self_update(Os::Windows, Some(BundleType::Msi)));
        assert!(can_self_update(Os::MacOs, Some(BundleType::App)));
        assert!(Url::parse(DOWNLOAD_PAGE).is_ok_and(|url| url.scheme() == "https"));
    }
}
