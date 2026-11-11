//! Bearer calls from the Rust core to a server's API (contract §3).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

use crate::discovery::classify_request_error;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::servers::Server;
use crate::urls;

fn api_base(server: &Server) -> AppResult<Url> {
    server
        .api()
        .ok_or_else(|| AppError::internal("invalid API URL"))
}

async fn send(request: reqwest::RequestBuilder) -> AppResult<Value> {
    let response = request
        .send()
        .await
        .map_err(|error| classify_request_error(&error))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::new(
            ErrorKind::NotSignedIn,
            "the server refused the token",
        ));
    }
    if !status.is_success() {
        return Err(AppError::new(
            ErrorKind::QuickAddFailed,
            format!("the server answered {status}"),
        ));
    }
    response.json::<Value>().await.map_err(AppError::internal)
}

pub async fn get(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    path: &str,
) -> AppResult<Value> {
    send(
        client
            .get(urls::join_path(&api_base(server)?, path))
            .bearer_auth(token),
    )
    .await
}

pub async fn post(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    path: &str,
    body: &Value,
) -> AppResult<Value> {
    send(
        client
            .post(urls::join_path(&api_base(server)?, path))
            .bearer_auth(token)
            .json(body),
    )
    .await
}

/// Percent-encodes one path segment (ids come from the server, but stay safe).
fn segment(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
}

/// `GET /api/notification/{id}/desktop`.
#[derive(Debug, Clone, Deserialize)]
pub struct DesktopNotification {
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub url: Option<String>,
    /// Replaces an earlier alert with the same tag.
    #[serde(default)]
    pub tag: Option<String>,
    /// The user's sound settings call for a sound now; absent from servers
    /// older than this field.
    #[serde(default)]
    pub sound: Option<bool>,
    /// The Margaya sound to play ("chime", "pop", ...); null when silent,
    /// absent from servers older than this field.
    #[serde(default, rename = "soundName")]
    pub sound_name: Option<String>,
    /// The user's notification volume, 0 to 100.
    #[serde(default)]
    pub volume: Option<u32>,
}

/// The device's IANA time zone, for quiet hours when the account has none.
fn device_time_zone() -> Option<String> {
    iana_time_zone::get_timezone().ok()
}

pub async fn desktop_notification(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    id: &str,
) -> AppResult<DesktopNotification> {
    let mut url = urls::join_path(
        &api_base(server)?,
        &format!("/api/notification/{}/desktop", segment(id)),
    );
    if let Some(zone) = device_time_zone() {
        url.query_pairs_mut().append_pair("timeZone", &zone);
    }
    let value = send(client.get(url).bearer_auth(token)).await?;
    serde_json::from_value(value).map_err(AppError::internal)
}

/// The badge count for one server. There is no instance-wide unread count:
/// `GET /api/notification/counts?workspaceId=…` counts one workspace (plus the
/// notifications that belong to none), and `GET /api/notification` lists the
/// newest 50 across all of them. Both are lower bounds that never double-count,
/// so the badge shows the larger of the list's unread count and the biggest
/// workspace count.
pub async fn unread_count(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
) -> AppResult<u32> {
    let list = get(client, server, token, "/api/notification").await?;
    let mut best = crate::badge::count_unread(&list, &crate::badge::now_rfc3339());
    let organizations = get(client, server, token, "/api/auth/organization/list").await?;
    for id in organizations
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|organization| str_field(organization, "id"))
    {
        let mut url = urls::join_path(&api_base(server)?, "/api/notification/counts");
        url.query_pairs_mut().append_pair("workspaceId", id);
        if let Ok(counts) = send(client.get(url).bearer_auth(token)).await {
            let unread = counts
                .get("unread")
                .and_then(Value::as_u64)
                .unwrap_or_default();
            best = best.max(u32::try_from(unread).unwrap_or(u32::MAX));
        }
    }
    Ok(best)
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickAddProject {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickAddTarget {
    pub workspace_id: String,
    pub workspace_name: String,
    pub projects: Vec<QuickAddProject>,
}

fn str_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// Open (not archived) projects from `GET /api/project?workspaceId=…`.
pub fn read_projects(list: &Value) -> Vec<QuickAddProject> {
    list.as_array()
        .into_iter()
        .flatten()
        .filter(|project| project.get("archivedAt").is_none_or(Value::is_null))
        .filter_map(|project| {
            Some(QuickAddProject {
                id: str_field(project, "id")?.to_string(),
                name: str_field(project, "name")?.to_string(),
            })
        })
        .collect()
}

/// Workspaces (Better Auth organizations) then each one's projects.
pub async fn quick_add_targets(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
) -> AppResult<Vec<QuickAddTarget>> {
    let organizations = get(client, server, token, "/api/auth/organization/list").await?;
    let mut targets = Vec::new();
    for organization in organizations.as_array().into_iter().flatten() {
        let (Some(id), Some(name)) = (
            str_field(organization, "id"),
            str_field(organization, "name"),
        ) else {
            continue;
        };
        // join_path drops queries, so build this request by hand.
        let mut url = urls::join_path(&api_base(server)?, "/api/project");
        url.query_pairs_mut().append_pair("workspaceId", id);
        let projects = match send(client.get(url).bearer_auth(token)).await {
            Ok(list) => read_projects(&list),
            Err(error) if error.kind == ErrorKind::NotSignedIn => return Err(error),
            Err(error) => {
                log::warn!(
                    "quick add: projects of a workspace unavailable: {}",
                    error.message
                );
                Vec::new()
            }
        };
        targets.push(QuickAddTarget {
            workspace_id: id.to_string(),
            workspace_name: name.to_string(),
            projects,
        });
    }
    Ok(targets)
}

/// The column a quick-added task starts in: the project's first column by
/// position. The API leaves triage columns out of this list; skip any anyway.
pub fn pick_status(columns: &Value) -> Option<String> {
    let mut list: Vec<&Value> = columns
        .as_array()?
        .iter()
        .filter(|column| str_field(column, "group") != Some("triage"))
        .collect();
    list.sort_by(|a, b| {
        let position = |column: &Value| {
            column
                .get("position")
                .and_then(Value::as_f64)
                .unwrap_or(f64::MAX)
        };
        position(a).total_cmp(&position(b))
    });
    list.first()
        .and_then(|column| str_field(column, "slug"))
        .map(str::to_string)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAddResult {
    pub task_id: String,
    pub url: String,
}

/// The web UI's task page.
pub fn task_url(
    server: &Server,
    workspace_id: &str,
    project_id: &str,
    task_id: &str,
) -> Option<Url> {
    let mut url = server.web()?;
    url.path_segments_mut().ok()?.pop_if_empty().extend([
        "dashboard",
        "workspace",
        workspace_id,
        "project",
        project_id,
        "task",
        task_id,
    ]);
    Some(url)
}

/// `POST /api/task/{projectId}` with the project's starting column.
pub async fn create_task(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    workspace_id: &str,
    project_id: &str,
    title: &str,
) -> AppResult<QuickAddResult> {
    let columns = get(
        client,
        server,
        token,
        &format!("/api/column/{}", segment(project_id)),
    )
    .await?;
    let status = pick_status(&columns)
        .ok_or_else(|| AppError::new(ErrorKind::QuickAddFailed, "project has no columns"))?;
    let body = serde_json::json!({
        "title": title,
        "description": "",
        "priority": "no-priority",
        "status": status,
    });
    let task = post(
        client,
        server,
        token,
        &format!("/api/task/{}", segment(project_id)),
        &body,
    )
    .await?;
    let task_id = str_field(&task, "id")
        .ok_or_else(|| AppError::new(ErrorKind::QuickAddFailed, "no task id"))?;
    let url = task_url(server, workspace_id, project_id, task_id)
        .ok_or_else(|| AppError::new(ErrorKind::QuickAddFailed, "invalid server URL"))?;
    Ok(QuickAddResult {
        task_id: task_id.to_string(),
        url: url.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_the_sound_of_new_and_older_servers() {
        let new: DesktopNotification = serde_json::from_value(json!({
            "id": "n1", "title": "T", "body": "B", "url": "https://x", "tag": "n1",
            "sound": true, "soundName": "marimba", "volume": 40
        }))
        .unwrap();
        assert_eq!(
            (new.sound, new.sound_name.as_deref(), new.volume),
            (Some(true), Some("marimba"), Some(40))
        );
        let silent: DesktopNotification = serde_json::from_value(json!({
            "id": "n1", "title": "T", "sound": false, "soundName": null, "volume": 70
        }))
        .unwrap();
        assert_eq!((silent.sound, silent.sound_name), (Some(false), None));
        let older: DesktopNotification =
            serde_json::from_value(json!({ "id": "n1", "title": "T", "sound": true })).unwrap();
        assert_eq!(
            (older.sound, older.sound_name, older.volume),
            (Some(true), None, None)
        );
    }

    #[test]
    fn picks_the_first_column() {
        let columns = json!([
            { "slug": "done", "group": "completed", "position": 3 },
            { "slug": "todo", "group": "unstarted", "position": 2 },
            { "slug": "backlog", "group": "backlog", "position": 1 },
            { "slug": "triage", "group": "triage", "position": 0 }
        ]);
        assert_eq!(pick_status(&columns).as_deref(), Some("backlog"));
        assert_eq!(pick_status(&json!([])), None);
        assert_eq!(pick_status(&json!({ "error": "x" })), None);
    }

    #[test]
    fn lists_open_projects() {
        let list = json!([
            { "id": "p1", "name": "Web", "archivedAt": null },
            { "id": "p2", "name": "Old", "archivedAt": "2026-01-01T00:00:00.000Z" },
            { "id": "p3" }
        ]);
        assert_eq!(
            read_projects(&list),
            vec![QuickAddProject {
                id: "p1".into(),
                name: "Web".into()
            }]
        );
    }

    #[test]
    fn links_to_the_task_page() {
        let server = Server {
            id: "id".into(),
            label: "x".into(),
            web_url: "https://app.example/margaya".into(),
            api_url: "https://api.example".into(),
            server_version: None,
            added_at: 0,
            last_used_at: None,
            reopen: false,
            sound_muted: false,
        };
        assert_eq!(
            task_url(&server, "w 1", "p1", "t1").unwrap().as_str(),
            "https://app.example/margaya/dashboard/workspace/w%201/project/p1/task/t1"
        );
        assert_eq!(segment("a/b c"), "a%2Fb%20c");
    }
}
