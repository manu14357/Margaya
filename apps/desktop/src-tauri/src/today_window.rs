//! The "Today" mini window (`#today` in the launcher bundle): the signed-in
//! person's open tasks that are due today or overdue, across every signed-in
//! server and workspace. It reads them through the same task query engine as
//! the web app's "Your work" (`POST /api/task-query`), so "today" is the
//! person's calendar day in the device's time zone, decided by the server.
//! Checking a task moves it to its project's first completed column through
//! `PUT /api/task/status/{id}`, with the API's own task:update check.

use std::collections::HashSet;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::error::{AppError, AppResult, ErrorKind};
use crate::servers::Server;
use crate::state::AppState;
use crate::{api, i18n, search_window, windows};

pub const LABEL: &str = "today";

/// Workspaces read on each server.
pub const MAX_WORKSPACES: usize = 10;
/// Tasks asked of each workspace (the API allows up to 200).
pub const PER_WORKSPACE: u32 = 50;
/// Tasks shown in all.
pub const MAX_TASKS: usize = 100;

const OPEN_GROUPS: [&str; 3] = ["backlog", "unstarted", "started"];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TodayTask {
    pub server_id: String,
    pub server_label: String,
    pub workspace_id: String,
    pub workspace_name: String,
    pub id: String,
    pub project_id: String,
    pub project_name: Option<String>,
    /// WEB-12.
    pub key: Option<String>,
    pub title: String,
    /// RFC 3339, as the API sent it.
    pub due_date: Option<String>,
    /// Due before today; otherwise due today.
    pub overdue: bool,
    pub priority: Option<String>,
    /// The task page in the web UI.
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TodayOutcome {
    pub tasks: Vec<TodayTask>,
    /// Labels of signed-in servers that couldn't be read.
    pub unavailable: Vec<String>,
}

/// The `POST /api/task-query` body: the caller's open tasks due today or
/// earlier (`overdue_only`: before today, as every matching id), with
/// "today" in `time_zone`.
pub fn today_query(workspace_id: &str, time_zone: Option<&str>, overdue_only: bool) -> Value {
    let due: &[&str] = if overdue_only { &["past"] } else { &["past", "today"] };
    let mut body = json!({
        "workspaceId": workspace_id,
        "filters": {
            "op": "and",
            "children": [
                { "key": "assignee", "operator": "in", "values": ["me"] },
                { "key": "group", "operator": "in", "values": OPEN_GROUPS },
                { "key": "dueDate", "operator": "in", "values": due }
            ]
        }
    });
    if overdue_only {
        body["mode"] = json!("ids");
    } else {
        body["display"] = json!({
            "groupBy": null,
            "orderBy": { "field": "dueDate", "direction": "asc" }
        });
        body["page"] = json!({ "limit": PER_WORKSPACE });
    }
    if let Some(zone) = time_zone {
        body["context"] = json!({ "timeZone": zone });
    }
    body
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
}

/// The ids an ids-mode query returned.
pub fn read_ids(value: &Value) -> HashSet<String> {
    value
        .get("ids")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|id| id.as_str().map(str::to_string))
        .collect()
}

/// Where the workspace's rows go, before the server's own fields are added.
pub struct Origin<'a> {
    pub server_id: &'a str,
    pub server_label: &'a str,
    pub workspace_id: &'a str,
    pub workspace_name: &'a str,
}

/// A rows-mode result as tasks, in the server's order. A task is overdue
/// when the server listed it as due in the past, in the same time zone, so
/// the split matches the web app's "Overdue" and "Due today" exactly.
pub fn read_tasks(value: &Value, overdue: &HashSet<String>, origin: &Origin<'_>) -> Vec<TodayTask> {
    let Some(rows) = value.get("tasks").and_then(Value::as_object) else {
        return Vec::new();
    };
    let ordered: Vec<&str> = value
        .get("groups")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|group| group.get("taskIds").and_then(Value::as_array).into_iter().flatten())
        .filter_map(Value::as_str)
        .collect();
    let ids: Vec<&str> = if ordered.is_empty() {
        rows.keys().map(String::as_str).collect()
    } else {
        ordered
    };
    let project_name = |id: &str| {
        value
            .pointer("/meta/projects")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .find(|project| text(project, "id") == Some(id))
            .and_then(|project| text(project, "name"))
            .map(str::to_string)
    };
    let mut seen = HashSet::new();
    ids.into_iter()
        .filter(|id| seen.insert(*id))
        .filter_map(|id| {
            let row = rows.get(id)?;
            if row.get("archivedAt").is_some_and(|value| !value.is_null()) {
                return None;
            }
            let project_id = text(row, "projectId")?;
            let path = search_window::item_path("task", id, origin.workspace_id, Some(project_id), None, None)?;
            Some(TodayTask {
                server_id: origin.server_id.to_string(),
                server_label: origin.server_label.to_string(),
                workspace_id: origin.workspace_id.to_string(),
                workspace_name: origin.workspace_name.to_string(),
                id: id.to_string(),
                project_id: project_id.to_string(),
                project_name: project_name(project_id),
                key: text(row, "key").map(str::to_string),
                title: text(row, "title").unwrap_or(id).to_string(),
                due_date: text(row, "dueDate").map(str::to_string),
                overdue: overdue.contains(id),
                priority: text(row, "priority").map(str::to_string),
                path,
            })
        })
        .collect()
}

/// Overdue first, then by due time, then title; at most `cap`.
pub fn sort_and_cap(mut tasks: Vec<TodayTask>, cap: usize) -> Vec<TodayTask> {
    tasks.sort_by(|a, b| {
        b.overdue
            .cmp(&a.overdue)
            .then_with(|| a.due_date.cmp(&b.due_date))
            .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
    tasks.truncate(cap);
    tasks
}

/// The column "done" means: the project's first completed column by board
/// position, like the web app's own "mark complete".
pub fn pick_done_status(columns: &Value) -> Option<String> {
    let mut done: Vec<&Value> = columns
        .as_array()?
        .iter()
        .filter(|column| text(column, "group") == Some("completed"))
        .collect();
    done.sort_by(|a, b| {
        let position = |column: &Value| column.get("position").and_then(Value::as_f64).unwrap_or(f64::MAX);
        position(a).total_cmp(&position(b))
    });
    done.first().and_then(|column| text(column, "slug")).map(str::to_string)
}

async fn workspace_tasks(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    workspace: (&str, &str),
    time_zone: Option<&str>,
) -> AppResult<Vec<TodayTask>> {
    let (workspace_id, workspace_name) = workspace;
    let rows_body = today_query(workspace_id, time_zone, false);
    let overdue_body = today_query(workspace_id, time_zone, true);
    let (rows, overdue) = futures_util::future::join(
        api::query_tasks(client, server, token, &rows_body),
        api::query_tasks(client, server, token, &overdue_body),
    )
    .await;
    let origin = Origin {
        server_id: &server.id,
        server_label: &server.label,
        workspace_id,
        workspace_name,
    };
    Ok(read_tasks(&rows?, &read_ids(&overdue?), &origin))
}

#[tauri::command]
pub async fn today_tasks(state: State<'_, AppState>) -> AppResult<TodayOutcome> {
    let client = state.http.clone();
    let time_zone = api::time_zone();
    let zone = time_zone.as_deref();
    let servers = search_window::signed_in_servers(&state);
    let per_server = servers.into_iter().map(|(server, token)| {
        let client = client.clone();
        async move {
            let workspaces = match search_window::cached_workspaces(&client, &server, &token).await {
                Ok(list) => list,
                Err(error) => {
                    log::warn!("today: workspaces of a server unavailable: {}", error.message);
                    return (Vec::new(), Some(server.label.clone()));
                }
            };
            let requests = workspaces.iter().take(MAX_WORKSPACES).map(|(id, name)| {
                workspace_tasks(&client, &server, &token, (id.as_str(), name.as_str()), zone)
            });
            let mut tasks = Vec::new();
            let mut failed = false;
            for result in futures_util::future::join_all(requests).await {
                match result {
                    Ok(list) => tasks.extend(list),
                    // A workspace where the person can't read tasks answers
                    // 403; that's not a broken server.
                    Err(error) if error.message.contains("403") => {}
                    Err(error) => {
                        log::warn!("today: a workspace couldn't be read: {}", error.message);
                        failed = true;
                    }
                }
            }
            (tasks, failed.then(|| server.label.clone()))
        }
    });
    let mut tasks = Vec::new();
    let mut unavailable = Vec::new();
    for (list, failed) in futures_util::future::join_all(per_server).await {
        tasks.extend(list);
        unavailable.extend(failed);
    }
    Ok(TodayOutcome {
        tasks: sort_and_cap(tasks, MAX_TASKS),
        unavailable,
    })
}

/// Marks a task done: its project's completed column, through the task
/// status route (task:update is checked by the API).
#[tauri::command]
pub async fn today_complete(
    state: State<'_, AppState>,
    server_id: String,
    task_id: String,
    project_id: String,
) -> AppResult<()> {
    let server = state.server(&server_id)?;
    let token = crate::tokens::get(&server_id)
        .ok_or_else(|| AppError::new(ErrorKind::NotSignedIn, "not signed in"))?;
    let columns = api::project_columns(&state.http, &server, &token, &project_id).await?;
    let status = pick_done_status(&columns)
        .ok_or_else(|| AppError::new(ErrorKind::Internal, "the project has no completed column"))?;
    api::set_task_status(&state.http, &server, &token, &task_id, &status).await?;
    Ok(())
}

/// Opens a task in its server's window; the Today window stays.
#[tauri::command]
pub async fn today_open(
    app: AppHandle,
    state: State<'_, AppState>,
    server_id: String,
    path: String,
) -> AppResult<()> {
    let server = state.server(&server_id)?;
    let url = windows::web_url_for_path(&server, &path)
        .ok_or_else(|| AppError::new(ErrorKind::InvalidUrl, "not a page of this server"))?;
    windows::open_server_window(&app, &server, windows::Target::InApp(url))
}

#[tauri::command]
pub fn close_today(app: AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        hide(&app, &window);
    }
}

/// Hides the window; its page stops refreshing until it shows again.
fn hide(app: &AppHandle, window: &tauri::WebviewWindow) {
    let _ = window.hide();
    let _ = app.emit_to(LABEL, "today-hidden", ());
}

/// Shows the Today window, or hides it when it is visible. Safe to call
/// from any thread: the work itself runs through `windows::spawn_ui`.
pub fn toggle(app: &AppHandle) {
    windows::spawn_ui(app, |app| {
        if let Some(window) = app.get_webview_window(LABEL) {
            if window.is_visible().unwrap_or(false) {
                hide(app, &window);
            } else {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = app.emit_to(LABEL, "today-refresh", ());
            }
            return;
        }
        if let Err(error) = create(app) {
            log::warn!("the Today window failed to open: {}", error.message);
        }
    });
}

fn create(app: &AppHandle) -> AppResult<()> {
    // Size and place come back through the window-state plugin (lib.rs).
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#today".into()))
        .title(i18n::t("today.title"))
        .inner_size(360.0, 480.0)
        .min_inner_size(300.0, 320.0)
        .resizable(true)
        .minimizable(false)
        .maximizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .background_color(windows::background(app))
        .center()
        .focused(true)
        .build()?;
    let _ = window.set_focus();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origin() -> Origin<'static> {
        Origin {
            server_id: "s1",
            server_label: "Work",
            workspace_id: "w1",
            workspace_name: "Team",
        }
    }

    #[test]
    fn asks_for_open_tasks_due_today_or_earlier_in_the_device_zone() {
        let body = today_query("w1", Some("Asia/Kolkata"), false);
        assert_eq!(body["workspaceId"], "w1");
        assert_eq!(body["context"]["timeZone"], "Asia/Kolkata");
        let children = body["filters"]["children"].as_array().unwrap();
        assert_eq!(children[0], json!({ "key": "assignee", "operator": "in", "values": ["me"] }));
        assert_eq!(children[1]["values"], json!(["backlog", "unstarted", "started"]));
        assert_eq!(children[2]["values"], json!(["past", "today"]));
        assert_eq!(body["page"]["limit"], PER_WORKSPACE);
        assert!(body.get("mode").is_none());

        let overdue = today_query("w1", None, true);
        assert_eq!(overdue["mode"], "ids");
        assert_eq!(overdue["filters"]["children"][2]["values"], json!(["past"]));
        assert!(overdue.get("context").is_none());
        assert!(overdue.get("page").is_none());
    }

    #[test]
    fn classifies_by_the_servers_overdue_ids() {
        let rows = json!({
            "today": "2026-11-17",
            "groups": [{ "key": "all", "count": 3, "taskIds": ["t2", "t1", "t3"], "nextCursor": null }],
            "tasks": {
                "t1": { "id": "t1", "projectId": "p1", "key": "WEB-1", "title": "Late",
                        "dueDate": "2026-11-15T18:30:00.000Z", "priority": "high", "archivedAt": null },
                "t2": { "id": "t2", "projectId": "p1", "key": "WEB-2", "title": "Now",
                        "dueDate": "2026-11-16T18:30:00.000Z", "priority": "low", "archivedAt": null },
                "t3": { "id": "t3", "projectId": "p1", "title": "Archived",
                        "archivedAt": "2026-11-01T00:00:00.000Z" }
            },
            "meta": { "projects": [{ "id": "p1", "name": "Web" }] }
        });
        let overdue = read_ids(&json!({ "ids": ["t1"] }));
        let tasks = read_tasks(&rows, &overdue, &origin());
        assert_eq!(tasks.len(), 2);
        assert_eq!((tasks[0].id.as_str(), tasks[0].overdue), ("t2", false));
        assert_eq!((tasks[1].id.as_str(), tasks[1].overdue), ("t1", true));
        assert_eq!(tasks[1].project_name.as_deref(), Some("Web"));
        assert_eq!(tasks[1].path, "/dashboard/workspace/w1/project/p1/task/t1");
        assert!(read_tasks(&json!({ "error": "x" }), &overdue, &origin()).is_empty());
    }

    #[test]
    fn lists_overdue_first_then_by_due_time_and_caps() {
        let task = |id: &str, overdue: bool, due: &str| TodayTask {
            server_id: "s".into(),
            server_label: "S".into(),
            workspace_id: "w".into(),
            workspace_name: "W".into(),
            id: id.into(),
            project_id: "p".into(),
            project_name: None,
            key: None,
            title: id.into(),
            due_date: Some(due.into()),
            overdue,
            priority: None,
            path: "/".into(),
        };
        let sorted = sort_and_cap(
            vec![
                task("today-late", false, "2026-11-17T15:00:00.000Z"),
                task("old", true, "2026-11-10T09:00:00.000Z"),
                task("today-early", false, "2026-11-17T08:00:00.000Z"),
                task("older", true, "2026-11-01T09:00:00.000Z"),
            ],
            3,
        );
        let ids: Vec<&str> = sorted.iter().map(|task| task.id.as_str()).collect();
        assert_eq!(ids, ["older", "old", "today-early"]);
    }

    #[test]
    fn picks_the_first_completed_column() {
        let columns = json!([
            { "slug": "todo", "group": "unstarted", "position": 0 },
            { "slug": "shipped", "group": "completed", "position": 5 },
            { "slug": "done", "group": "completed", "position": 3 },
            { "slug": "wontfix", "group": "cancelled", "position": 4 }
        ]);
        assert_eq!(pick_done_status(&columns).as_deref(), Some("done"));
        assert_eq!(pick_done_status(&json!([{ "slug": "todo", "group": "unstarted" }])), None);
        assert_eq!(pick_done_status(&json!({ "error": "x" })), None);
    }
}
