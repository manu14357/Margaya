//! The tray (menu bar) icon and, on macOS, the application menu, both in the
//! system's language from the `desktop.launcher` copy.
//!
//! The tray also lists the person's recent projects and items across signed-in
//! servers (`GET /api/recent-visit` with the bearer token), cached here and
//! refreshed on a timer and when the tray changes.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;
#[cfg(target_os = "macos")]
use tauri::menu::Submenu;
use tauri::menu::{IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

use crate::i18n::{t, tv};
use crate::launch::{self, LaunchAction};
use crate::servers::Server;
use crate::shortcuts::{self, Action};
use crate::state::{lock, AppState};
use crate::{diagnostics, tokens, updates, urls, windows};

pub const TRAY_ID: &str = "margaya";

const OPEN: &str = "open";
const SERVERS: &str = "servers";
const QUICK_ADD: &str = "quick-add";
const SEARCH: &str = "search";
const TODAY: &str = "today";
const CLIPBOARD_TASK: &str = "clipboard-task";
const SCREENSHOT: &str = "screenshot";
const SETTINGS: &str = "settings";
const QUIT: &str = "quit";
const UPDATE: &str = "install-update";
const CHECK_UPDATES: &str = "check-updates";
const RELOAD: &str = "reload";
const COPY_DIAGNOSTICS: &str = "copy-diagnostics";
const OPEN_LOGS: &str = "open-logs";
const SERVER_PREFIX: &str = "open-server:";
const RECENT_PREFIX: &str = "recent:";
const RECENT_EMPTY: &str = "recent-empty";

/// How many recent items the tray lists, and how many it asks each
/// workspace for.
pub const RECENT_LIMIT: usize = 8;
/// How often the recent items refresh in the background.
const RECENT_EVERY: Duration = Duration::from_secs(5 * 60);
/// A tray change refreshes them too, at most this often.
const RECENT_AT_MOST_EVERY: Duration = Duration::from_secs(60);

/// A recently visited project or item on one server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecentItem {
    pub server_id: String,
    pub workspace_id: String,
    pub label: String,
    /// The web app path that opens it.
    pub path: String,
    /// When it was visited (ISO 8601, as the API sends it).
    pub visited_at: String,
}

#[derive(Default)]
struct RecentCache {
    items: Vec<RecentItem>,
    fetched_at: Option<Instant>,
    fetching: bool,
}

static RECENT: LazyLock<Mutex<RecentCache>> = LazyLock::new(Mutex::default);
/// The unread counts the tray was last built with, by server id.
static BUILT_UNREAD: LazyLock<Mutex<HashMap<String, u32>>> = LazyLock::new(Mutex::default);

fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The web app path of a recent visit's entity, as the web app builds it
/// (`apps/web/src/lib/entity-links.ts` and the feature registrations).
pub fn entity_path(
    workspace_id: &str,
    kind: &str,
    id: &str,
    project_id: Option<&str>,
) -> Option<String> {
    if !safe_id(workspace_id) || !safe_id(id) || project_id.is_some_and(|p| !safe_id(p)) {
        return None;
    }
    let base = format!("/dashboard/workspace/{workspace_id}");
    Some(match (kind, project_id) {
        ("project", _) => format!("{base}/project/{id}/board"),
        ("task", Some(project)) => format!("{base}/project/{project}/task/{id}"),
        ("cycle", Some(project)) => format!("{base}/project/{project}/cycles/{id}"),
        ("module", Some(project)) => format!("{base}/project/{project}/modules/{id}"),
        ("page", Some(project)) => format!("{base}/project/{project}/pages/{id}"),
        ("view", Some(project)) => format!("{base}/project/{project}/views/{id}"),
        ("view", None) => format!("{base}/views/{id}"),
        _ => return None,
    })
}

/// A menu label from server text: one line, no control or format
/// characters, at most 60 characters.
pub fn clean_label(text: &str) -> String {
    let one_line: String = text
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .filter(|c| !c.is_control() && !is_format_char(*c))
        .collect();
    let trimmed = one_line.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.chars().count() > 60 {
        let cut: String = trimmed.chars().take(59).collect();
        format!("{}…", cut.trim_end())
    } else {
        trimmed
    }
}

fn is_format_char(c: char) -> bool {
    // Bidi controls and zero-width characters.
    matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}')
}

/// The items in one `GET /api/recent-visit` answer.
pub fn read_recent(list: &Value, server_id: &str) -> Vec<RecentItem> {
    let str_of =
        |value: &Value, key: &str| value.get(key).and_then(Value::as_str).map(str::to_string);
    list.as_array()
        .into_iter()
        .flatten()
        .filter_map(|visit| {
            let entity = visit.get("entity")?;
            if entity.get("isArchived").and_then(Value::as_bool) == Some(true) {
                return None;
            }
            let workspace_id = str_of(visit, "workspaceId")?;
            let kind = str_of(entity, "type")?;
            let id = str_of(entity, "id")?;
            let project_id = str_of(entity, "projectId");
            let path = entity_path(&workspace_id, &kind, &id, project_id.as_deref())?;
            let name = str_of(entity, "name").unwrap_or_default();
            let label = match (kind.as_str(), str_of(entity, "key")) {
                ("task", Some(key)) if !key.is_empty() => {
                    clean_label(&format!("{} {name}", key.to_uppercase()))
                }
                _ => clean_label(&name),
            };
            if label.is_empty() {
                return None;
            }
            Some(RecentItem {
                server_id: server_id.to_string(),
                workspace_id,
                label,
                path,
                visited_at: str_of(visit, "visitedAt").unwrap_or_default(),
            })
        })
        .collect()
}

/// The newest `limit` items across servers and workspaces, each once.
pub fn merge_recent(lists: Vec<Vec<RecentItem>>, limit: usize) -> Vec<RecentItem> {
    let mut all: Vec<RecentItem> = lists.into_iter().flatten().collect();
    // ISO 8601 UTC timestamps sort as text.
    all.sort_by(|a, b| b.visited_at.cmp(&a.visited_at));
    let mut seen = std::collections::HashSet::new();
    all.retain(|item| seen.insert((item.server_id.clone(), item.path.clone())));
    all.truncate(limit);
    all
}

/// The workspace of the newest recent visit on a server, if known.
pub fn recent_workspace(_app: &AppHandle, server_id: &str) -> Option<String> {
    lock(&RECENT)
        .items
        .iter()
        .find(|item| item.server_id == server_id)
        .map(|item| item.workspace_id.clone())
}

async fn fetch_recent_for(http: &reqwest::Client, server: &Server, token: &str) -> Vec<RecentItem> {
    let Some(api) = server.api() else {
        return Vec::new();
    };
    let organizations =
        match crate::api::get(http, server, token, "/api/auth/organization/list").await {
            Ok(list) => list,
            Err(error) => {
                log::warn!("recent items unavailable: {}", error.message);
                return Vec::new();
            }
        };
    let mut lists = Vec::new();
    for workspace in organizations
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|organization| organization.get("id").and_then(Value::as_str))
    {
        let mut url = urls::join_path(&api, "/api/recent-visit");
        url.query_pairs_mut()
            .append_pair("workspaceId", workspace)
            .append_pair("limit", &RECENT_LIMIT.to_string());
        let response = http.get(url).bearer_auth(token).send().await;
        let Ok(response) = response else { continue };
        if !response.status().is_success() {
            continue;
        }
        if let Ok(list) = response.json::<Value>().await {
            lists.push(read_recent(&list, &server.id));
        }
    }
    merge_recent(lists, RECENT_LIMIT)
}

/// Refreshes the recent items in the background, then the tray. `force`
/// skips the once-a-minute limit.
pub fn refresh_recent(app: &AppHandle, force: bool) {
    {
        let mut cache = lock(&RECENT);
        let fresh = cache
            .fetched_at
            .is_some_and(|at| at.elapsed() < RECENT_AT_MOST_EVERY);
        if cache.fetching || (fresh && !force) {
            return;
        }
        cache.fetching = true;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let http = state.http.clone();
        let servers = state.servers();
        let mut lists = Vec::new();
        for server in servers {
            // Keychain reads block; keep them off the async workers.
            let id = server.id.clone();
            let token = tauri::async_runtime::spawn_blocking(move || tokens::get(&id))
                .await
                .ok()
                .flatten();
            if let Some(token) = token {
                lists.push(fetch_recent_for(&http, &server, &token).await);
            }
        }
        // A server signed out while its items were on their way keeps none.
        let mut items = merge_recent(lists, RECENT_LIMIT);
        items.retain(|item| state.session(&item.server_id).is_some());
        let changed = {
            let mut cache = lock(&RECENT);
            cache.fetching = false;
            cache.fetched_at = Some(Instant::now());
            let changed = cache.items != items;
            cache.items = items;
            changed
        };
        if changed {
            rebuild_tray(&app);
        }
    });
}

/// Drops a server's recent items (it signed out or was removed).
fn drop_recent_of(items: &mut Vec<RecentItem>, server_id: &str) -> bool {
    let before = items.len();
    items.retain(|item| item.server_id != server_id);
    items.len() != before
}

/// Forgets a server's recent items and rebuilds the tray without them.
pub fn forget_server(app: &AppHandle, server_id: &str) {
    if drop_recent_of(&mut lock(&RECENT).items, server_id) {
        rebuild_tray(app);
    }
}

/// A menu item, with its shortcut shown when the menu accepts it.
fn item(
    app: &AppHandle,
    id: &str,
    text: String,
    accelerator: Option<String>,
) -> tauri::Result<MenuItem<Wry>> {
    if let Some(accelerator) = accelerator {
        if let Ok(item) = MenuItem::with_id(app, id, &text, true, Some(accelerator.as_str())) {
            return Ok(item);
        }
    }
    MenuItem::with_id(app, id, text, true, None::<&str>)
}

fn recent_menu(app: &AppHandle, servers: &[Server]) -> tauri::Result<tauri::menu::Submenu<Wry>> {
    let items = lock(&RECENT).items.clone();
    let several = servers.len() > 1;
    let mut entries: Vec<Box<dyn IsMenuItem<Wry>>> = Vec::new();
    for recent in &items {
        let Some(server) = servers.iter().find(|server| server.id == recent.server_id) else {
            continue;
        };
        let label = if several {
            format!("{} · {}", recent.label, clean_label(&server.label))
        } else {
            recent.label.clone()
        };
        entries.push(Box::new(MenuItem::with_id(
            app,
            format!("{RECENT_PREFIX}{}|{}", recent.server_id, recent.path),
            label,
            true,
            None::<&str>,
        )?));
    }
    if entries.is_empty() {
        entries.push(Box::new(MenuItem::with_id(
            app,
            RECENT_EMPTY,
            t("tray.recentEmpty"),
            false,
            None::<&str>,
        )?));
    }
    let refs: Vec<&dyn IsMenuItem<Wry>> = entries.iter().map(|entry| entry.as_ref()).collect();
    tauri::menu::Submenu::with_items(app, t("tray.recent"), true, &refs)
}

fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let state = app.state::<AppState>();
    let servers = state.servers();
    let unread = lock(&state.unread).clone();
    *lock(&BUILT_UNREAD) = unread.clone();
    // Linux's AppIndicator has no click events: the first item is the way in.
    let mut items: Vec<Box<dyn IsMenuItem<Wry>>> = vec![
        Box::new(MenuItem::with_id(
            app,
            OPEN,
            t("tray.open"),
            true,
            None::<&str>,
        )?),
        Box::new(MenuItem::with_id(
            app,
            SERVERS,
            t("tray.servers"),
            true,
            None::<&str>,
        )?),
        Box::new(PredefinedMenuItem::separator(app)?),
    ];
    for server in &servers {
        let mut label = tv("tray.openServer", &[("name", &server.label)]);
        if let Some(count) = unread.get(&server.id).copied().filter(|count| *count > 0) {
            label = format!(
                "{label} ({})",
                crate::badge::badge_text(count).unwrap_or_default()
            );
        }
        items.push(Box::new(MenuItem::with_id(
            app,
            format!("{SERVER_PREFIX}{}", server.id),
            label,
            true,
            None::<&str>,
        )?));
    }
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(item(
        app,
        QUICK_ADD,
        t("tray.quickAdd"),
        shortcuts::menu_accelerator(app, Action::QuickAdd),
    )?));
    items.push(Box::new(item(
        app,
        SEARCH,
        t("tray.search"),
        shortcuts::menu_accelerator(app, Action::Search),
    )?));
    items.push(Box::new(item(
        app,
        TODAY,
        t("tray.today"),
        shortcuts::menu_accelerator(app, Action::Today),
    )?));
    items.push(Box::new(item(
        app,
        CLIPBOARD_TASK,
        t("tray.clipboardTask"),
        None,
    )?));
    items.push(Box::new(item(
        app,
        SCREENSHOT,
        t("tray.screenshot"),
        shortcuts::menu_accelerator(app, Action::Screenshot),
    )?));
    items.push(Box::new(recent_menu(app, &servers)?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    if let Some(version) = lock(&state.available_update).clone() {
        // A Linux .deb or .rpm can't replace itself: the item opens the
        // download page instead.
        let label = if updates::self_update_supported() {
            "tray.updateReady"
        } else {
            "tray.updateDownload"
        };
        items.push(Box::new(MenuItem::with_id(
            app,
            UPDATE,
            tv(label, &[("version", &version)]),
            true,
            None::<&str>,
        )?));
    }
    items.push(Box::new(crate::pause::pause_submenu(app)?));
    items.push(Box::new(MenuItem::with_id(
        app,
        SETTINGS,
        t("tray.settings"),
        true,
        None::<&str>,
    )?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(
        app,
        QUIT,
        t("tray.quit"),
        true,
        None::<&str>,
    )?));
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|item| item.as_ref()).collect();
    Menu::with_items(app, &refs)
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Margaya")
        .menu(&tray_menu(app)?)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| handle_menu_event(app, &event))
        .on_tray_icon_event(|tray, event| {
            // A left click on Windows brings Margaya back (the last server
            // window, else the server list); the menu is on the right button.
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                if !cfg!(target_os = "macos") {
                    windows::spawn_ui(tray.app_handle(), windows::show_main);
                }
            }
        });
    // macOS: a black template image the menu bar tints. Elsewhere the
    // transparent green mark, from its 32 px render (the tray shows 16 to 24
    // px, which scale down from it cleanly).
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .icon(tauri::include_image!("icons/tray-template.png"))
            .icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.icon(tauri::include_image!("icons/32x32.png"));
    }
    builder.build(app)?;

    // Recent items: now, then every few minutes.
    let timer_app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            refresh_recent(&timer_app, true);
            tokio::time::sleep(RECENT_EVERY).await;
        }
    });
    Ok(())
}

fn rebuild_tray(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), tray_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

/// Rebuilds the tray menu after the server list, update state or shortcuts
/// change, and refreshes the recent items when they are older than a minute.
pub fn refresh_tray(app: &AppHandle) {
    rebuild_tray(app);
    refresh_recent(app, false);
}

/// Rebuilds the tray when a server's unread count changed since it was
/// built. Called whenever the badge is redrawn.
pub fn unread_changed(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let current: HashMap<String, u32> = lock(&state.unread)
        .iter()
        .filter(|(_, count)| **count > 0)
        .map(|(id, count)| (id.clone(), *count))
        .collect();
    let built: HashMap<String, u32> = lock(&BUILT_UNREAD)
        .iter()
        .filter(|(_, count)| **count > 0)
        .map(|(id, count)| (id.clone(), *count))
        .collect();
    if current != built {
        rebuild_tray(app);
    }
}

/// The macOS menu bar. Windows apps keep their menus in the tray instead.
#[cfg(target_os = "macos")]
pub fn create_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let app_menu = Submenu::with_items(
        app,
        "Margaya",
        true,
        &[
            &PredefinedMenuItem::about(app, Some(&t("menu.about")), None)?,
            &MenuItem::with_id(
                app,
                CHECK_UPDATES,
                t("menu.checkUpdates"),
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(&t("menu.hide")))?,
            &PredefinedMenuItem::hide_others(app, Some(&t("menu.hideOthers")))?,
            &PredefinedMenuItem::show_all(app, Some(&t("menu.showAll")))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, QUIT, t("menu.quit"), true, Some("CommandOrControl+Q"))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        t("menu.edit"),
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(&t("menu.undo")))?,
            &PredefinedMenuItem::redo(app, Some(&t("menu.redo")))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(&t("menu.cut")))?,
            &PredefinedMenuItem::copy(app, Some(&t("menu.copy")))?,
            &PredefinedMenuItem::paste(app, Some(&t("menu.paste")))?,
            &PredefinedMenuItem::select_all(app, Some(&t("menu.selectAll")))?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        t("menu.view"),
        true,
        &[
            &MenuItem::with_id(
                app,
                RELOAD,
                t("menu.reload"),
                true,
                Some("CommandOrControl+R"),
            )?,
            &MenuItem::with_id(app, SERVERS, t("menu.servers"), true, None::<&str>)?,
            &item(
                app,
                QUICK_ADD,
                t("menu.quickAdd"),
                shortcuts::menu_accelerator(app, Action::QuickAdd),
            )?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        t("menu.window"),
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(&t("menu.minimize")))?,
            &PredefinedMenuItem::close_window(app, Some(&t("menu.closeWindow")))?,
        ],
    )?;
    let help = Submenu::with_items(
        app,
        t("menu.help"),
        true,
        &[
            &MenuItem::with_id(
                app,
                COPY_DIAGNOSTICS,
                t("menu.copyDiagnostics"),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, OPEN_LOGS, t("menu.openLogs"), true, None::<&str>)?,
        ],
    )?;
    let menu = Menu::with_items(app, &[&app_menu, &edit, &view, &window, &help])?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| handle_menu_event(app, &event));
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn create_app_menu(_app: &AppHandle) -> tauri::Result<()> {
    Ok(())
}

/// Shows the launcher scrolled to its settings.
pub fn show_settings(app: &AppHandle) {
    windows::show_launcher(app);
    let _ = app.emit_to(windows::LAUNCHER, "show-settings", ());
}

fn open_recent(app: &AppHandle, rest: &str) {
    let Some((server_id, path)) = rest.split_once('|') else {
        return;
    };
    let Ok(server) = app.state::<AppState>().server(server_id) else {
        return;
    };
    // Only a page of that server's web app (web_url_for_path checks it).
    let Some(url) = windows::web_url_for_path(&server, path) else {
        return;
    };
    windows::spawn_ui(app, move |app| {
        if let Err(error) = windows::open_server_window(app, &server, windows::Target::InApp(url)) {
            log::warn!("could not open a recent item: {}", error.message);
        }
    });
}

pub fn handle_menu_event(app: &AppHandle, event: &MenuEvent) {
    let id = event.id().as_ref();
    match id {
        // Handlers run on the main thread; anything that may create a
        // window is handed off (see windows::spawn_ui).
        OPEN => windows::spawn_ui(app, windows::show_main),
        SERVERS => windows::show_launcher(app),
        QUICK_ADD => shortcuts::run(app, Action::QuickAdd),
        SEARCH => shortcuts::run(app, Action::Search),
        TODAY => shortcuts::run(app, Action::Today),
        SCREENSHOT => shortcuts::run(app, Action::Screenshot),
        CLIPBOARD_TASK => launch::run(app, LaunchAction::ClipboardTask),
        SETTINGS => show_settings(app),
        QUIT => app.exit(0),
        UPDATE => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = updates::install(&app).await {
                    log::warn!("update failed: {}", error.message);
                }
            });
        }
        CHECK_UPDATES => {
            windows::show_launcher(app);
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = updates::check(&app).await;
            });
        }
        RELOAD => {
            if let Some(window) = app
                .webview_windows()
                .values()
                .find(|window| window.is_focused().unwrap_or(false))
            {
                let _ = window.eval("window.location.reload()");
            }
        }
        COPY_DIAGNOSTICS => {
            let _ = app.clipboard().write_text(diagnostics::collect(app));
            let _ = app.emit("diagnostics-copied", ());
        }
        OPEN_LOGS => {
            if let Ok(dir) = app.path().app_log_dir() {
                let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
            }
        }
        _ => {
            if let Some(rest) = id.strip_prefix(RECENT_PREFIX) {
                open_recent(app, rest);
            } else if let Some(server_id) = id.strip_prefix(SERVER_PREFIX) {
                if let Ok(server) = app.state::<AppState>().server(server_id) {
                    windows::spawn_ui(app, move |app| {
                        if let Err(error) =
                            windows::open_server_window(app, &server, windows::Target::None)
                        {
                            log::warn!("could not open a server window: {}", error.message);
                        }
                    });
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn visit(kind: &str, id: &str, project: Option<&str>, at: &str) -> Value {
        json!({
            "id": format!("v-{id}"),
            "workspaceId": "w1",
            "projectId": project,
            "entityType": kind,
            "entityId": id,
            "visitedAt": at,
            "entity": {
                "type": kind, "id": id, "name": format!("Name {id}"),
                "key": if kind == "task" { json!("web-12") } else { Value::Null },
                "icon": null, "projectId": project, "projectName": null,
                "isArchived": false, "feature": null, "details": null
            }
        })
    }

    #[test]
    fn builds_the_web_apps_paths() {
        assert_eq!(
            entity_path("w1", "project", "p1", None).as_deref(),
            Some("/dashboard/workspace/w1/project/p1/board")
        );
        assert_eq!(
            entity_path("w1", "task", "t1", Some("p1")).as_deref(),
            Some("/dashboard/workspace/w1/project/p1/task/t1")
        );
        assert_eq!(
            entity_path("w1", "view", "v1", None).as_deref(),
            Some("/dashboard/workspace/w1/views/v1")
        );
        assert_eq!(entity_path("w1", "task", "t1", None), None);
        assert_eq!(entity_path("w1", "whiteboard", "x", Some("p1")), None);
        assert_eq!(entity_path("w1", "task", "../api", Some("p1")), None);
    }

    #[test]
    fn reads_visits_and_skips_archived_or_unknown_ones() {
        let mut archived = visit("project", "p9", None, "2026-11-17T09:00:00.000Z");
        archived["entity"]["isArchived"] = json!(true);
        let list = json!([
            visit("task", "t1", Some("p1"), "2026-11-17T10:00:00.000Z"),
            visit("project", "p1", None, "2026-11-17T08:00:00.000Z"),
            archived,
            visit("whiteboard", "b1", Some("p1"), "2026-11-17T11:00:00.000Z"),
            { "broken": true },
        ]);
        let items = read_recent(&list, "s1");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].label, "WEB-12 Name t1");
        assert_eq!(items[0].server_id, "s1");
        assert_eq!(items[1].label, "Name p1");
        assert_eq!(items[1].workspace_id, "w1");
    }

    #[test]
    fn merges_servers_newest_first_without_repeats() {
        let a = read_recent(
            &json!([
                visit("task", "t1", Some("p1"), "2026-11-17T10:00:00.000Z"),
                visit("project", "p1", None, "2026-11-17T08:00:00.000Z"),
            ]),
            "a",
        );
        let b = read_recent(
            &json!([visit("project", "p1", None, "2026-11-17T09:00:00.000Z")]),
            "b",
        );
        let mut repeat = a.clone();
        repeat.truncate(1);
        let merged = merge_recent(vec![a, b, repeat], 2);
        assert_eq!(merged.len(), 2);
        assert_eq!(
            (merged[0].server_id.as_str(), merged[0].path.as_str()),
            ("a", "/dashboard/workspace/w1/project/p1/task/t1")
        );
        assert_eq!(merged[1].server_id, "b");
    }

    #[test]
    fn drops_a_signed_out_servers_recent_items() {
        let mut items = merge_recent(
            vec![
                read_recent(
                    &json!([visit("task", "t1", Some("p1"), "2026-11-17T10:00:00.000Z")]),
                    "a",
                ),
                read_recent(
                    &json!([visit("project", "p1", None, "2026-11-17T09:00:00.000Z")]),
                    "b",
                ),
            ],
            RECENT_LIMIT,
        );
        assert!(drop_recent_of(&mut items, "a"));
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].server_id, "b");
        assert!(!drop_recent_of(&mut items, "a"), "nothing left to drop");
    }

    #[test]
    fn has_english_copy_for_every_tray_item() {
        for key in [
            "tray.search",
            "tray.today",
            "tray.clipboardTask",
            "tray.screenshot",
            "tray.recent",
            "tray.recentEmpty",
            "tray.settings",
        ] {
            assert_ne!(t(key), key);
        }
    }

    #[test]
    fn cleans_labels_from_the_server() {
        assert_eq!(
            clean_label("  Fix\nthe\u{202E}  bug\u{0007} "),
            "Fix the bug"
        );
        let long = "x".repeat(80);
        let cleaned = clean_label(&long);
        assert_eq!(cleaned.chars().count(), 60);
        assert!(cleaned.ends_with('…'));
    }
}
