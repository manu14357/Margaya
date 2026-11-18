//! The global search window (`#search` in the launcher bundle): a small
//! frameless, always-on-top window that searches every signed-in server with
//! its bearer token, through each server's own `GET /api/search` (one
//! workspace per request) and, before anything is typed, lists the most
//! recently opened items from `GET /api/recent-visit`. The API decides what
//! the caller may see; this module only fans out, groups and caps.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::error::{AppError, AppResult, ErrorKind};
use crate::servers::Server;
use crate::state::{lock, AppState};
use crate::{api, i18n, tokens, windows};

pub const LABEL: &str = "search";

/// Workspaces searched on each server, so one person in many workspaces
/// can't turn a keystroke into dozens of requests.
pub const MAX_WORKSPACES: usize = 8;
/// Results asked of each workspace (the API allows 1–50).
pub const PER_WORKSPACE: u32 = 8;
/// Results shown in all.
pub const MAX_RESULTS: usize = 60;
/// Recent visits asked of each workspace, and shown in all.
pub const RECENT_PER_WORKSPACE: u32 = 10;
pub const MAX_RECENT: usize = 12;
/// The API takes at most 512 characters; nobody types more than this.
pub const MAX_QUERY_CHARS: usize = 200;
/// How long a server's workspace list is reused between keystrokes.
const WORKSPACES_TTL: Duration = Duration::from_secs(60);

/// The order kinds are listed in, inside one server and workspace.
const KIND_ORDER: &[&str] = &[
    "task", "project", "page", "cycle", "module", "view", "intake", "comment", "activity",
    "workspace",
];

/// One thing to open.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchItem {
    /// task, project, page, cycle, module, view, intake, comment, activity
    /// or workspace.
    pub kind: String,
    pub id: String,
    pub title: String,
    /// A task key (WEB-12) or similar, when there is one.
    pub key: Option<String>,
    /// The project it lives in, when there is one.
    pub context: Option<String>,
    /// The web UI path it opens at.
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchSection {
    pub kind: String,
    pub items: Vec<SearchItem>,
}

/// One server and workspace, with its results by kind.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchGroup {
    pub server_id: String,
    pub server_label: String,
    pub workspace_id: String,
    pub workspace_name: String,
    pub sections: Vec<SearchSection>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchOutcome {
    pub groups: Vec<SearchGroup>,
    /// Labels of signed-in servers that couldn't be searched.
    pub unavailable: Vec<String>,
}

/// A result before grouping.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hit {
    pub server_id: String,
    pub server_label: String,
    pub workspace_id: String,
    pub workspace_name: String,
    /// When it was visited (recent visits only; RFC 3339), else empty.
    pub at: String,
    pub item: SearchItem,
}

fn segment(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
}

/// Where a result opens in the web UI, matching the web app's own links
/// (search menu, favorites and recents). None for a kind it can't open.
pub fn item_path(
    kind: &str,
    id: &str,
    workspace_id: &str,
    project_id: Option<&str>,
    task_id: Option<&str>,
    status: Option<&str>,
) -> Option<String> {
    let workspace = format!("/dashboard/workspace/{}", segment(workspace_id));
    let project = project_id.map(|project| format!("{workspace}/project/{}", segment(project)));
    let task = |task: &str| Some(format!("{}/task/{}", project.as_ref()?, segment(task)));
    match kind {
        "workspace" => Some(format!("/dashboard/workspace/{}", segment(id))),
        "project" => Some(format!("{workspace}/project/{}/board", segment(id))),
        "task" => task(id),
        "comment" | "activity" => task(task_id?),
        "page" => Some(format!("{}/pages/{}", project?, segment(id))),
        "cycle" => Some(format!("{}/cycles/{}", project?, segment(id))),
        "module" => Some(format!("{}/modules/{}", project?, segment(id))),
        "view" => Some(match project {
            Some(project) => format!("{project}/views/{}", segment(id)),
            None => format!("{workspace}/views/{}", segment(id)),
        }),
        "intake" => {
            let closed = matches!(status, Some("accepted" | "declined" | "duplicate"));
            let tab = if closed { "&tab=closed" } else { "" };
            Some(format!("{}/intake?item={}{tab}", project?, segment(id)))
        }
        _ => None,
    }
}

/// `GET /api/search` results, in the server's relevance order.
pub fn read_search_results(value: &Value, workspace_id: &str) -> Vec<SearchItem> {
    value
        .get("results")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|result| {
            let kind = text(result, "type")?;
            let id = text(result, "id")?;
            let path = item_path(
                kind,
                id,
                text(result, "workspaceId").unwrap_or(workspace_id),
                text(result, "projectId"),
                text(result, "taskId"),
                text(result, "status"),
            )?;
            let key = match (text(result, "projectSlug"), result.get("taskNumber").and_then(Value::as_u64)) {
                (Some(slug), Some(number)) if kind == "task" => {
                    Some(format!("{}-{number}", slug.to_uppercase()))
                }
                _ => None,
            };
            let title = text(result, "title").unwrap_or(id).to_string();
            Some(SearchItem {
                kind: kind.to_string(),
                id: id.to_string(),
                title,
                key,
                context: text(result, "projectName").map(str::to_string),
                path,
            })
        })
        .collect()
}

/// `GET /api/recent-visit` rows as (visitedAt, item), newest first as sent.
/// Archived entities stay out.
pub fn read_recent_visits(value: &Value, workspace_id: &str) -> Vec<(String, SearchItem)> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|visit| {
            let entity = visit.get("entity")?;
            if entity.get("isArchived").and_then(Value::as_bool) == Some(true) {
                return None;
            }
            let kind = text(entity, "type")?;
            let id = text(entity, "id")?;
            let path = item_path(kind, id, workspace_id, text(entity, "projectId"), None, None)?;
            let key = (kind == "task")
                .then(|| text(entity, "key").map(str::to_uppercase))
                .flatten();
            Some((
                text(visit, "visitedAt").unwrap_or_default().to_string(),
                SearchItem {
                    kind: kind.to_string(),
                    id: id.to_string(),
                    title: text(entity, "name").unwrap_or(id).to_string(),
                    key,
                    context: if kind == "project" {
                        None
                    } else {
                        text(entity, "projectName").map(str::to_string)
                    },
                    path,
                },
            ))
        })
        .collect()
}

fn kind_rank(kind: &str) -> usize {
    KIND_ORDER
        .iter()
        .position(|known| *known == kind)
        .unwrap_or(KIND_ORDER.len())
}

/// Groups hits by server and workspace (in the order they first appear),
/// then by kind (tasks first), keeping each kind's own order, and keeps at
/// most `cap` items in all. Repeats of one item are dropped.
pub fn group_hits(hits: Vec<Hit>, cap: usize) -> Vec<SearchGroup> {
    let mut groups: Vec<SearchGroup> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut kept = 0;
    for hit in hits {
        if kept >= cap {
            break;
        }
        let identity = (
            hit.server_id.clone(),
            hit.workspace_id.clone(),
            hit.item.kind.clone(),
            hit.item.id.clone(),
        );
        if !seen.insert(identity) {
            continue;
        }
        kept += 1;
        let index = match groups
            .iter()
            .position(|group| group.server_id == hit.server_id && group.workspace_id == hit.workspace_id)
        {
            Some(index) => index,
            None => {
                groups.push(SearchGroup {
                    server_id: hit.server_id.clone(),
                    server_label: hit.server_label.clone(),
                    workspace_id: hit.workspace_id.clone(),
                    workspace_name: hit.workspace_name.clone(),
                    sections: Vec::new(),
                });
                groups.len() - 1
            }
        };
        let sections = &mut groups[index].sections;
        match sections.iter_mut().find(|section| section.kind == hit.item.kind) {
            Some(section) => section.items.push(hit.item),
            None => sections.push(SearchSection {
                kind: hit.item.kind.clone(),
                items: vec![hit.item],
            }),
        }
    }
    for group in &mut groups {
        group.sections.sort_by_key(|section| kind_rank(&section.kind));
    }
    groups
}

/// Interleaves per-workspace result lists round-robin, so the cap keeps the
/// best few of every workspace rather than all of the first one.
pub fn interleave(lists: Vec<Vec<Hit>>) -> Vec<Hit> {
    let mut iters: Vec<_> = lists.into_iter().map(Vec::into_iter).collect();
    let mut out = Vec::new();
    loop {
        let mut any = false;
        for iter in &mut iters {
            if let Some(hit) = iter.next() {
                out.push(hit);
                any = true;
            }
        }
        if !any {
            return out;
        }
    }
}

/// The query as sent: trimmed and capped. None when nothing is left.
pub fn clean_query(query: &str) -> Option<String> {
    let trimmed = query.trim();
    (!trimmed.is_empty()).then(|| trimmed.chars().take(MAX_QUERY_CHARS).collect())
}

/// By server id: when it was fetched, a fingerprint of the token it was
/// fetched with (never the token), and the workspaces as (id, name).
type WorkspaceCache = HashMap<String, (Instant, u64, Vec<(String, String)>)>;

fn workspace_cache() -> &'static Mutex<WorkspaceCache> {
    static CACHE: OnceLock<Mutex<WorkspaceCache>> = OnceLock::new();
    CACHE.get_or_init(Mutex::default)
}

/// Ties a cached list to the session that fetched it, so a list fetched
/// just before a sign-out never serves the next account.
fn token_fingerprint(token: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    token.hash(&mut hasher);
    hasher.finish()
}

fn cached_for(
    cache: &WorkspaceCache,
    server_id: &str,
    token: &str,
) -> Option<Vec<(String, String)>> {
    cache
        .get(server_id)
        .filter(|(at, fingerprint, _)| {
            at.elapsed() < WORKSPACES_TTL && *fingerprint == token_fingerprint(token)
        })
        .map(|(_, _, list)| list.clone())
}

/// A server's workspaces, reused for a minute so typing doesn't refetch
/// them on every keystroke. Shared with the Today window.
pub async fn cached_workspaces(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
) -> AppResult<Vec<(String, String)>> {
    if let Some(list) = cached_for(&lock(workspace_cache()), &server.id, token) {
        return Ok(list);
    }
    let list = api::workspaces(client, server, token).await?;
    lock(workspace_cache()).insert(
        server.id.clone(),
        (Instant::now(), token_fingerprint(token), list.clone()),
    );
    Ok(list)
}

/// Forgets a server's workspaces (it signed out or was removed).
pub fn forget_server(server_id: &str) {
    lock(workspace_cache()).remove(server_id);
}

/// Signed-in servers with their tokens. Keychain reads block, so this runs
/// inside async commands only.
pub fn signed_in_servers(state: &AppState) -> Vec<(Server, String)> {
    state
        .servers()
        .into_iter()
        .filter_map(|server| {
            let token = tokens::get(&server.id)?;
            Some((server, token))
        })
        .collect()
}

/// Runs `per_workspace` for each workspace of each signed-in server, all at
/// once, and returns each workspace's hits plus the servers that failed.
async fn fan_out<F, Fut>(state: &AppState, per_workspace: F) -> (Vec<Vec<Hit>>, Vec<String>)
where
    F: Fn(reqwest::Client, Server, String, String) -> Fut,
    Fut: std::future::Future<Output = AppResult<Vec<(String, SearchItem)>>>,
{
    let client = state.http.clone();
    let servers = signed_in_servers(state);
    let per_server = servers.into_iter().map(|(server, token)| {
        let client = client.clone();
        let per_workspace = &per_workspace;
        async move {
            let workspaces = match cached_workspaces(&client, &server, &token).await {
                Ok(list) => list,
                Err(error) => {
                    log::warn!("search: workspaces of a server unavailable: {}", error.message);
                    return (Vec::new(), Some(server.label.clone()));
                }
            };
            let requests = workspaces.into_iter().take(MAX_WORKSPACES).map(|(id, name)| {
                let request = per_workspace(client.clone(), server.clone(), token.clone(), id.clone());
                async move { (id, name, request.await) }
            });
            let mut lists = Vec::new();
            let mut failed = false;
            for (workspace_id, workspace_name, result) in futures_util::future::join_all(requests).await {
                match result {
                    Ok(items) => lists.push(
                        items
                            .into_iter()
                            .map(|(at, item)| Hit {
                                server_id: server.id.clone(),
                                server_label: server.label.clone(),
                                workspace_id: workspace_id.clone(),
                                workspace_name: workspace_name.clone(),
                                at,
                                item,
                            })
                            .collect(),
                    ),
                    Err(error) => {
                        log::warn!("search: a workspace couldn't be searched: {}", error.message);
                        failed = true;
                    }
                }
            }
            (lists, failed.then(|| server.label.clone()))
        }
    });
    let mut lists = Vec::new();
    let mut unavailable = Vec::new();
    for (server_lists, failed) in futures_util::future::join_all(per_server).await {
        lists.extend(server_lists);
        unavailable.extend(failed);
    }
    (lists, unavailable)
}

/// The global search running now, by the page's id for it. A newer search
/// stops it, and so does `search_cancel` with its id; stopping drops its
/// requests to the servers.
#[derive(Default)]
pub struct Running {
    current: Option<(u32, Arc<tokio::sync::Notify>)>,
}

impl Running {
    /// Starts search `id`, stopping the one before it.
    pub fn start(&mut self, id: u32) -> Arc<tokio::sync::Notify> {
        let stop = Arc::new(tokio::sync::Notify::new());
        if let Some((_, older)) = self.current.replace((id, stop.clone())) {
            older.notify_one();
        }
        stop
    }

    /// Stops search `id` if it is still the one running.
    pub fn cancel(&mut self, id: u32) {
        if self.current.as_ref().is_some_and(|(current, _)| *current == id) {
            if let Some((_, stop)) = self.current.take() {
                stop.notify_one();
            }
        }
    }

    /// A search ended on its own.
    pub fn finish(&mut self, stop: &Arc<tokio::sync::Notify>) {
        if self.current.as_ref().is_some_and(|(_, current)| Arc::ptr_eq(current, stop)) {
            self.current = None;
        }
    }
}

static RUNNING: Mutex<Running> = Mutex::new(Running { current: None });

/// A superseded or cancelled search answers with nothing; the page shows
/// only its newest search anyway.
#[tauri::command]
pub async fn search_query(
    state: State<'_, AppState>,
    query: String,
    search_id: Option<u32>,
) -> AppResult<SearchOutcome> {
    let stop = lock(&RUNNING).start(search_id.unwrap_or_default());
    let Some(query) = clean_query(&query) else {
        lock(&RUNNING).finish(&stop);
        return Ok(SearchOutcome::default());
    };
    let query = query.as_str();
    let work = fan_out(&state, |client, server, token, workspace_id| async move {
        let value =
            api::search_workspace(&client, &server, &token, &workspace_id, query, PER_WORKSPACE).await?;
        Ok(read_search_results(&value, &workspace_id)
            .into_iter()
            .map(|item| (String::new(), item))
            .collect())
    });
    let outcome = tokio::select! {
        (lists, unavailable) = work => SearchOutcome {
            groups: group_hits(interleave(lists), MAX_RESULTS),
            unavailable,
        },
        () = stop.notified() => SearchOutcome::default(),
    };
    lock(&RUNNING).finish(&stop);
    Ok(outcome)
}

#[tauri::command]
pub fn search_cancel(search_id: u32) {
    lock(&RUNNING).cancel(search_id);
}

#[tauri::command]
pub async fn search_recent(state: State<'_, AppState>) -> AppResult<SearchOutcome> {
    let (lists, unavailable) = fan_out(&state, |client, server, token, workspace_id| async move {
        let value =
            api::recent_visits(&client, &server, &token, &workspace_id, RECENT_PER_WORKSPACE).await?;
        Ok(read_recent_visits(&value, &workspace_id))
    })
    .await;
    Ok(SearchOutcome {
        groups: group_hits(newest_first(lists), MAX_RECENT),
        unavailable,
    })
}

/// Recent visits of every workspace, newest first (RFC 3339 times from the
/// API compare as text).
pub fn newest_first(lists: Vec<Vec<Hit>>) -> Vec<Hit> {
    let mut hits: Vec<Hit> = lists.into_iter().flatten().collect();
    hits.sort_by(|a, b| b.at.cmp(&a.at));
    hits
}

/// Opens a result in its server's window (an in-app route change when the
/// window is open) and puts the search window away.
#[tauri::command]
pub async fn search_open(
    app: AppHandle,
    state: State<'_, AppState>,
    server_id: String,
    path: String,
) -> AppResult<()> {
    let server = state.server(&server_id)?;
    let url = windows::web_url_for_path(&server, &path)
        .ok_or_else(|| AppError::new(ErrorKind::InvalidUrl, "not a page of this server"))?;
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
    windows::open_server_window(&app, &server, windows::Target::InApp(url))
}

#[tauri::command]
pub fn close_search(app: AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
}

/// The window has been focused since it was last shown: a blur before that
/// (while it is still appearing) must not hide it.
static FOCUSED_SINCE_SHOWN: AtomicBool = AtomicBool::new(false);

/// Shows the search window, creating it on first use. Safe to call from any
/// thread: the work itself runs through `windows::spawn_ui`.
pub fn show(app: &AppHandle) {
    windows::spawn_ui(app, |app| {
        if let Err(error) = open(app) {
            log::warn!("search failed to open: {}", error.message);
        }
    });
}

fn open(app: &AppHandle) -> AppResult<()> {
    FOCUSED_SINCE_SHOWN.store(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        // The page selects its query so typing replaces it.
        let _ = app.emit_to(LABEL, "search-shown", ());
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#search".into()))
        .title(i18n::t("search.title"))
        .inner_size(640.0, 440.0)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .background_color(windows::background(app))
        .center()
        .focused(true)
        .build()?;
    let hide = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Focused(focused) = event {
            if *focused {
                FOCUSED_SINCE_SHOWN.store(true, Ordering::SeqCst);
            } else if FOCUSED_SINCE_SHOWN.swap(false, Ordering::SeqCst) {
                let _ = hide.hide();
            }
        }
    });
    let _ = window.set_focus();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::FutureExt;
    use serde_json::json;

    #[test]
    fn a_newer_search_stops_the_older_one() {
        let stopped = |stop: &Arc<tokio::sync::Notify>| stop.notified().now_or_never().is_some();
        let mut running = Running::default();
        let first = running.start(1);
        let second = running.start(2);
        assert!(stopped(&first));
        assert!(!stopped(&second));
        // Cancelling a search that was already replaced leaves the new one.
        running.cancel(1);
        assert!(!stopped(&second));
        running.cancel(2);
        assert!(stopped(&second));
        assert!(running.current.is_none());

        // One that ended on its own is no longer stopped by a later start.
        let third = running.start(3);
        running.finish(&third);
        let _fourth = running.start(4);
        assert!(!stopped(&third));
        // An older search finishing late doesn't clear the newer one.
        let fifth = running.start(5);
        running.finish(&third);
        running.cancel(5);
        assert!(stopped(&fifth));
    }

    fn hit(server: &str, workspace: &str, kind: &str, id: &str) -> Hit {
        Hit {
            server_id: server.into(),
            server_label: format!("S {server}"),
            workspace_id: workspace.into(),
            workspace_name: format!("W {workspace}"),
            at: String::new(),
            item: SearchItem {
                kind: kind.into(),
                id: id.into(),
                title: id.into(),
                key: None,
                context: None,
                path: format!("/{id}"),
            },
        }
    }

    #[test]
    fn builds_the_web_app_paths() {
        let w = "w1";
        assert_eq!(
            item_path("task", "t1", w, Some("p1"), None, None).as_deref(),
            Some("/dashboard/workspace/w1/project/p1/task/t1")
        );
        assert_eq!(item_path("task", "t1", w, None, None, None), None);
        assert_eq!(
            item_path("project", "p1", w, None, None, None).as_deref(),
            Some("/dashboard/workspace/w1/project/p1/board")
        );
        assert_eq!(
            item_path("comment", "c1", w, Some("p1"), Some("t9"), None).as_deref(),
            Some("/dashboard/workspace/w1/project/p1/task/t9")
        );
        assert_eq!(
            item_path("page", "g1", w, Some("p1"), None, None).as_deref(),
            Some("/dashboard/workspace/w1/project/p1/pages/g1")
        );
        assert_eq!(
            item_path("view", "v1", w, None, None, None).as_deref(),
            Some("/dashboard/workspace/w1/views/v1")
        );
        assert_eq!(
            item_path("intake", "i1", w, Some("p1"), None, Some("declined")).as_deref(),
            Some("/dashboard/workspace/w1/project/p1/intake?item=i1&tab=closed")
        );
        assert_eq!(
            item_path("workspace", "w 2", w, None, None, None).as_deref(),
            Some("/dashboard/workspace/w%202")
        );
        assert_eq!(item_path("whiteboard", "b1", w, Some("p1"), None, None), None);
        // Ids can't climb out of their segment.
        assert_eq!(
            item_path("cycle", "../x", w, Some("p/1"), None, None).as_deref(),
            Some("/dashboard/workspace/w1/project/p%2F1/cycles/..%2Fx")
        );
    }

    #[test]
    fn reads_search_results_in_relevance_order() {
        let value = json!({ "results": [
            { "id": "t1", "type": "task", "title": "Ship", "projectId": "p1", "projectName": "Web",
              "projectSlug": "web", "taskNumber": 12, "relevanceScore": 10 },
            { "id": "x", "type": "unknown", "title": "?" },
            { "id": "t2", "type": "task", "title": "No project" },
            { "id": "p1", "type": "project", "title": "Web" }
        ], "totalCount": 4, "searchQuery": "s" });
        let items = read_search_results(&value, "w1");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].key.as_deref(), Some("WEB-12"));
        assert_eq!(items[0].context.as_deref(), Some("Web"));
        assert_eq!(items[1].kind, "project");
        assert!(read_search_results(&json!({ "error": "x" }), "w1").is_empty());
    }

    #[test]
    fn reads_recent_visits_without_archived_ones() {
        let value = json!([
            { "visitedAt": "2026-11-17T10:00:00.000Z", "entity": { "type": "task", "id": "t1",
              "name": "Fix", "key": "web-3", "projectId": "p1", "projectName": "Web", "isArchived": false } },
            { "visitedAt": "2026-11-17T09:00:00.000Z", "entity": { "type": "page", "id": "g1",
              "name": "Old", "projectId": "p1", "isArchived": true } }
        ]);
        let rows = read_recent_visits(&value, "w1");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].1.key.as_deref(), Some("WEB-3"));
        assert_eq!(rows[0].1.path, "/dashboard/workspace/w1/project/p1/task/t1");
    }

    #[test]
    fn groups_by_server_workspace_and_kind_and_caps() {
        let hits = vec![
            hit("a", "w1", "project", "p1"),
            hit("b", "w2", "task", "t2"),
            hit("a", "w1", "task", "t1"),
            hit("a", "w1", "task", "t1"),
            hit("a", "w1", "page", "g1"),
            hit("a", "w1", "task", "t3"),
        ];
        let groups = group_hits(hits.clone(), 10);
        assert_eq!(groups.len(), 2);
        assert_eq!((groups[0].server_id.as_str(), groups[0].workspace_id.as_str()), ("a", "w1"));
        let kinds: Vec<&str> = groups[0].sections.iter().map(|s| s.kind.as_str()).collect();
        assert_eq!(kinds, ["task", "project", "page"]);
        let tasks: Vec<&str> = groups[0].sections[0].items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(tasks, ["t1", "t3"]);

        let capped = group_hits(hits, 3);
        let total: usize = capped
            .iter()
            .flat_map(|group| &group.sections)
            .map(|section| section.items.len())
            .sum();
        assert_eq!(total, 3);
    }

    #[test]
    fn sorts_recent_visits_newest_first() {
        let mut old = hit("a", "w1", "task", "old");
        old.at = "2026-11-16T08:00:00.000Z".into();
        let mut new = hit("b", "w2", "page", "new");
        new.at = "2026-11-17T08:00:00.000Z".into();
        let ids: Vec<String> = newest_first(vec![vec![old], vec![new]])
            .into_iter()
            .map(|hit| hit.item.id)
            .collect();
        assert_eq!(ids, ["new", "old"]);
    }

    #[test]
    fn interleaves_workspaces() {
        let lists = vec![
            vec![hit("a", "w1", "task", "1"), hit("a", "w1", "task", "2")],
            vec![hit("a", "w2", "task", "3")],
        ];
        let ids: Vec<String> = interleave(lists).into_iter().map(|hit| hit.item.id).collect();
        assert_eq!(ids, ["1", "3", "2"]);
    }

    #[test]
    fn keeps_workspaces_only_for_the_session_that_fetched_them() {
        let list = vec![("w1".to_string(), "Acme".to_string())];
        let mut cache = WorkspaceCache::new();
        cache.insert(
            "s1".into(),
            (Instant::now(), token_fingerprint("token-a"), list.clone()),
        );
        assert_eq!(cached_for(&cache, "s1", "token-a"), Some(list.clone()));
        // Another account's token on the same server never gets them.
        assert_eq!(cached_for(&cache, "s1", "token-b"), None);
        assert_eq!(cached_for(&cache, "s2", "token-a"), None);
        // Sign-out drops the entry.
        lock(workspace_cache()).insert(
            "s1-forget".into(),
            (Instant::now(), token_fingerprint("token-a"), list),
        );
        forget_server("s1-forget");
        assert!(!lock(workspace_cache()).contains_key("s1-forget"));
    }

    #[test]
    fn cleans_the_query() {
        assert_eq!(clean_query("   "), None);
        assert_eq!(clean_query("  web-12 ").as_deref(), Some("web-12"));
        assert_eq!(clean_query(&"x".repeat(500)).unwrap().len(), MAX_QUERY_CHARS);
    }
}
