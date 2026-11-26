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

// Global search and the Today window (search_window.rs, today_window.rs).

/// A GET with query parameters (join_path drops queries).
pub async fn get_query(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    path: &str,
    query: &[(&str, &str)],
) -> AppResult<Value> {
    let mut url = urls::join_path(&api_base(server)?, path);
    {
        let mut pairs = url.query_pairs_mut();
        for (key, value) in query {
            pairs.append_pair(key, value);
        }
    }
    send(client.get(url).bearer_auth(token)).await
}

pub async fn put(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    path: &str,
    body: &Value,
) -> AppResult<Value> {
    send(
        client
            .put(urls::join_path(&api_base(server)?, path))
            .bearer_auth(token)
            .json(body),
    )
    .await
}

/// The user id behind a bearer token, from `GET /api/auth/get-session`;
/// None when the server doesn't answer with one.
pub async fn session_user_id(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
) -> Option<String> {
    let session = get(client, server, token, "/api/auth/get-session")
        .await
        .ok()?;
    read_session_user_id(&session)
}

pub fn read_session_user_id(session: &Value) -> Option<String> {
    session
        .get("user")
        .and_then(|user| user.get("id"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

/// The caller's workspaces (Better Auth organizations) as (id, name).
pub async fn workspaces(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
) -> AppResult<Vec<(String, String)>> {
    let list = get(client, server, token, "/api/auth/organization/list").await?;
    Ok(list
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|organization| {
            Some((
                str_field(organization, "id")?.to_string(),
                str_field(organization, "name")?.to_string(),
            ))
        })
        .collect())
}

/// `GET /api/search?q=…&workspaceId=…&limit=…`.
pub async fn search_workspace(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    workspace_id: &str,
    query: &str,
    limit: u32,
) -> AppResult<Value> {
    let limit = limit.to_string();
    get_query(
        client,
        server,
        token,
        "/api/search",
        &[("q", query), ("workspaceId", workspace_id), ("limit", &limit)],
    )
    .await
}

/// `GET /api/recent-visit?workspaceId=…&limit=…`.
pub async fn recent_visits(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    workspace_id: &str,
    limit: u32,
) -> AppResult<Value> {
    let limit = limit.to_string();
    get_query(
        client,
        server,
        token,
        "/api/recent-visit",
        &[("workspaceId", workspace_id), ("limit", &limit)],
    )
    .await
}

/// `POST /api/task-query` with a body built by the caller.
pub async fn query_tasks(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    body: &Value,
) -> AppResult<Value> {
    post(client, server, token, "/api/task-query", body).await
}

/// `GET /api/column/{projectId}`.
pub async fn project_columns(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    project_id: &str,
) -> AppResult<Value> {
    get(
        client,
        server,
        token,
        &format!("/api/column/{}", segment(project_id)),
    )
    .await
}

/// `PUT /api/task/status/{id}`: moves a task to another column of its
/// project. The API checks task:update.
pub async fn set_task_status(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    task_id: &str,
    status: &str,
) -> AppResult<Value> {
    put(
        client,
        server,
        token,
        &format!("/api/task/status/{}", segment(task_id)),
        &serde_json::json!({ "status": status }),
    )
    .await
}

/// The device's IANA time zone, for the Today window's "today".
pub fn time_zone() -> Option<String> {
    device_time_zone()
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
    /// Quiet hours or focus mode hold desktop alerts: show nothing now.
    /// Absent (false) on servers older than this field.
    #[serde(default)]
    pub held: bool,
    /// The task a task alert is about; absent from older servers.
    #[serde(default, rename = "taskId")]
    pub task_id: Option<String>,
    /// The buttons the alert may offer ("done", "snooze", "reply"); absent
    /// (none) from older servers. Unknown names are ignored.
    #[serde(default)]
    pub actions: Vec<String>,
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

pub async fn patch(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    path: &str,
    body: Option<&Value>,
) -> AppResult<Value> {
    let mut request = client
        .patch(urls::join_path(&api_base(server)?, path))
        .bearer_auth(token);
    if let Some(body) = body {
        request = request.json(body);
    }
    send(request).await
}

/// `PATCH /api/notification/{id}/snooze`: out of the inbox until `until`
/// (RFC 3339), when it comes back unread.
pub async fn snooze_notification(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    id: &str,
    until: &str,
) -> AppResult<()> {
    let path = format!("/api/notification/{}/snooze", segment(id));
    let body = serde_json::json!({ "until": until });
    patch(client, server, token, &path, Some(&body))
        .await
        .map(drop)
}

/// `PATCH /api/notification/{id}/read`.
pub async fn mark_notification_read(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    id: &str,
) -> AppResult<()> {
    let path = format!("/api/notification/{}/read", segment(id));
    patch(client, server, token, &path, None).await.map(drop)
}

/// The project of a task and the column it sits in, from `GET /api/task/{id}`.
pub fn read_task_place(task: &Value) -> Option<(String, String)> {
    Some((
        str_field(task, "projectId")?.to_string(),
        str_field(task, "status")?.to_string(),
    ))
}

/// Moves a task to its project's first completed column, through the task
/// status route (which checks task:update). Nothing is sent when it is
/// already there.
pub async fn mark_task_done(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    task_id: &str,
) -> AppResult<()> {
    let task = get(
        client,
        server,
        token,
        &format!("/api/task/{}", segment(task_id)),
    )
    .await?;
    let (project_id, status) = read_task_place(&task)
        .ok_or_else(|| AppError::internal("the task has no project or status"))?;
    let columns = project_columns(client, server, token, &project_id).await?;
    let done = crate::today_window::pick_done_status(&columns)
        .ok_or_else(|| AppError::internal("the project has no completed column"))?;
    if done != status {
        set_task_status(client, server, token, task_id, &done).await?;
    }
    Ok(())
}

/// The badge count for one server. There is no instance-wide unread count:
/// `GET /api/notification/counts?workspaceId=…` counts one workspace (plus the
/// notifications that belong to none), and `GET /api/notification` lists the
/// newest 50 across all of them. Both are lower bounds that never double-count,
/// so the badge shows the larger of the list's unread count and the biggest
/// workspace count. The workspace list is the one search caches for a minute,
/// and the requests run side by side.
pub async fn unread_count(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
) -> AppResult<u32> {
    /// Workspace counts asked at once.
    const PARALLEL_COUNTS: usize = 6;
    use futures_util::StreamExt as _;
    let base = api_base(server)?;
    let (list, workspaces) = futures_util::future::join(
        get(client, server, token, "/api/notification"),
        crate::search_window::cached_workspaces(client, server, token),
    )
    .await;
    let mut best = crate::badge::count_unread(&list?, &crate::badge::now_rfc3339());
    let requests = workspaces?.into_iter().map(|(id, _)| {
        let mut url = urls::join_path(&base, "/api/notification/counts");
        url.query_pairs_mut().append_pair("workspaceId", &id);
        async move { send(client.get(url).bearer_auth(token)).await.ok() }
    });
    let counts: Vec<Option<Value>> = futures_util::stream::iter(requests)
        .buffer_unordered(PARALLEL_COUNTS)
        .collect()
        .await;
    for counts in counts.into_iter().flatten() {
        let unread = counts
            .get("unread")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        best = best.max(u32::try_from(unread).unwrap_or(u32::MAX));
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
    /// Names of attachments that couldn't be uploaded; the task exists.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub failed_attachments: Vec<String>,
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

/// The task priorities the API accepts (`VALID_PRIORITIES` in
/// apps/api/src/task/validate-task-fields.ts).
pub const PRIORITIES: &[&str] = &["no-priority", "low", "medium", "high", "urgent"];
/// The API's own limit on assignees per task is lower; this only bounds input.
const MAX_ASSIGNEES: usize = 20;

/// What quick add found in the title or the clipboard, besides the title.
/// Everything is optional; the API validates every value again.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskDetails {
    pub description: Option<String>,
    /// An ISO 8601 instant: the due day's local midnight.
    pub due_date: Option<String>,
    pub priority: Option<String>,
    /// Omitted: the project's default assignee.
    pub assignee_ids: Option<Vec<String>>,
}

/// The body of `POST /api/task/{projectId}`. Unknown priorities fall back to
/// none; an over-long due date or description is dropped or cut.
pub fn task_body(title: &str, status: &str, details: &TaskDetails) -> Value {
    let priority = details
        .priority
        .as_deref()
        .filter(|priority| PRIORITIES.contains(priority))
        .unwrap_or("no-priority");
    let description = details
        .description
        .as_deref()
        .map(|text| {
            crate::quick_add::cut_bytes(text.trim(), crate::quick_add::MAX_DESCRIPTION_BYTES)
        })
        .unwrap_or_default();
    let mut body = serde_json::json!({
        "title": title,
        "description": description,
        "priority": priority,
        "status": status,
    });
    if let Some(due) = details
        .due_date
        .as_deref()
        .map(str::trim)
        .filter(|due| !due.is_empty() && due.len() <= 64)
    {
        body["dueDate"] = Value::from(due);
    }
    if let Some(ids) = &details.assignee_ids {
        let mut unique: Vec<&str> = Vec::new();
        for id in ids.iter().map(|id| id.trim()).filter(|id| !id.is_empty()) {
            if !unique.contains(&id) && unique.len() < MAX_ASSIGNEES {
                unique.push(id);
            }
        }
        if !unique.is_empty() {
            body["assigneeIds"] = Value::from(unique);
        }
    }
    body
}

/// A workspace member quick add can assign with `@name`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickAddMember {
    /// The user id (what `assigneeIds` takes), not the membership id.
    pub id: String,
    pub name: String,
    /// The local part of the member's email, so `@jo` matches jo@….
    pub handle: String,
}

/// Members from Better Auth's `list-members`: `{ members: [...] }`, or a bare
/// list from older servers.
pub fn read_members(value: &Value) -> Vec<QuickAddMember> {
    let list = value.get("members").unwrap_or(value);
    list.as_array()
        .into_iter()
        .flatten()
        .filter_map(|member| {
            let user = member.get("user")?;
            let id = str_field(member, "userId").or_else(|| str_field(user, "id"))?;
            let email = str_field(user, "email").unwrap_or_default();
            let name = str_field(user, "name")
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .unwrap_or(email);
            Some(QuickAddMember {
                id: id.to_string(),
                name: name.to_string(),
                handle: email.split('@').next().unwrap_or_default().to_string(),
            })
        })
        .collect()
}

/// `GET /api/auth/organization/list-members?organizationId=…`.
pub async fn quick_add_members(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    workspace_id: &str,
) -> AppResult<Vec<QuickAddMember>> {
    let mut url = urls::join_path(&api_base(server)?, "/api/auth/organization/list-members");
    url.query_pairs_mut()
        .append_pair("organizationId", workspace_id)
        .append_pair("limit", "500");
    let value = send(client.get(url).bearer_auth(token)).await?;
    Ok(read_members(&value))
}

/// Where `POST /api/task-attachment/{taskId}/upload` says to send the bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadTarget {
    pub key: String,
    pub url: Url,
    pub headers: Vec<(String, String)>,
}

/// The only headers an upload may carry: what presigned storage PUTs and the
/// API's own local store use. Never a cookie or credentials of ours.
pub fn upload_header_allowed(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    matches!(
        name.as_str(),
        "content-type" | "content-length" | "content-md5" | "cache-control"
    ) || name.starts_with("x-amz-")
        || name.starts_with("x-goog-")
}

/// Loopback, private, link-local and other addresses that aren't on the
/// public internet.
fn is_internal_ip(ip: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || a == 0
                // Shared address space (carrier-grade NAT), 100.64.0.0/10.
                || (a == 100 && (64..128).contains(&b))
        }
        IpAddr::V6(v6) => {
            let first = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                // Unique local fc00::/7, link-local fe80::/10, site-local fec0::/10.
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80
                || (first & 0xffc0) == 0xfec0
                || v6.to_ipv4_mapped().is_some_and(|v4| is_internal_ip(IpAddr::V4(v4)))
        }
    }
}

/// Whether the bytes may go to `url`: https (plain http only when the API
/// itself is plain http), no credentials in the URL, and never a loopback,
/// private or link-local address unless it is the API's own host (the
/// local store answers on the API, e.g. http://localhost:1337/api/storage/…).
/// A host name is not resolved here; the API names the storage it uses.
pub fn upload_url_allowed(api: &Url, url: &Url) -> bool {
    let scheme_ok = match url.scheme() {
        "https" => true,
        "http" => api.scheme() == "http",
        _ => false,
    };
    if !scheme_ok || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let Some(host) = url.host() else {
        return false;
    };
    if api.host() == Some(host.clone()) {
        return true;
    }
    match host {
        url::Host::Ipv4(ip) => !is_internal_ip(ip.into()),
        url::Host::Ipv6(ip) => !is_internal_ip(ip.into()),
        url::Host::Domain(name) => {
            let name = name.trim_end_matches('.').to_ascii_lowercase();
            name != "localhost" && !name.ends_with(".localhost")
        }
    }
}

/// Reads an upload answer. The URL may be relative to the API (the local
/// store without a configured public URL); it must pass
/// [`upload_url_allowed`], and only [`upload_header_allowed`] headers are kept.
pub fn read_upload_target(value: &Value, api: &Url) -> Option<UploadTarget> {
    let key = str_field(value, "key")?.to_string();
    let url = api
        .join(str_field(value, "uploadUrl")?)
        .ok()
        .filter(|url| upload_url_allowed(api, url))?;
    let headers = value
        .get("headers")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(name, value)| Some((name.clone(), value.as_str()?.to_string())))
        .filter(|(name, _)| upload_header_allowed(name))
        .collect();
    Some(UploadTarget { key, url, headers })
}

/// Attaches a file to a task: ask for an upload URL, PUT the bytes there
/// (a presigned storage URL or the server's own store, never with the
/// bearer token), then finalize (apps/api/src/task-attachment).
pub async fn upload_attachment(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    task_id: &str,
    name: &str,
    content_type: &str,
    bytes: Vec<u8>,
) -> AppResult<()> {
    let size = bytes.len();
    let meta = serde_json::json!({
        "filename": name,
        "contentType": content_type,
        "size": size,
    });
    let answer = post(
        client,
        server,
        token,
        &format!("/api/task-attachment/{}/upload", segment(task_id)),
        &meta,
    )
    .await?;
    let target = read_upload_target(&answer, &api_base(server)?)
        .ok_or_else(|| AppError::new(ErrorKind::QuickAddFailed, "no usable upload URL"))?;
    // A redirect could take the bytes somewhere the checks above never saw.
    let uploader = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(AppError::internal)?;
    let mut request = uploader
        .put(target.url)
        .timeout(std::time::Duration::from_secs(180))
        .body(bytes);
    for (name, value) in &target.headers {
        // The body sets the length itself.
        if !name.eq_ignore_ascii_case("content-length") {
            request = request.header(name.as_str(), value.as_str());
        }
    }
    let response = request
        .send()
        .await
        .map_err(|error| classify_request_error(&error))?;
    if !response.status().is_success() {
        return Err(AppError::new(
            ErrorKind::QuickAddFailed,
            format!("the upload answered {}", response.status()),
        ));
    }
    let mut finalize = meta;
    finalize["key"] = Value::from(target.key);
    post(
        client,
        server,
        token,
        &format!("/api/task-attachment/{}/finalize", segment(task_id)),
        &finalize,
    )
    .await?;
    Ok(())
}

/// `POST /api/task/{projectId}` with the project's starting column.
pub async fn create_task(
    client: &reqwest::Client,
    server: &Server,
    token: &str,
    workspace_id: &str,
    project_id: &str,
    title: &str,
    details: &TaskDetails,
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
    let body = task_body(title, &status, details);
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
        failed_attachments: Vec::new(),
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
    fn reads_the_buttons_of_new_servers_and_none_from_older_ones() {
        let new: DesktopNotification = serde_json::from_value(json!({
            "id": "n1", "title": "T", "taskId": "t1", "actions": ["done", "snooze", "reply"]
        }))
        .unwrap();
        assert_eq!(new.task_id.as_deref(), Some("t1"));
        assert_eq!(new.actions, vec!["done", "snooze", "reply"]);
        let older: DesktopNotification =
            serde_json::from_value(json!({ "id": "n1", "title": "T" })).unwrap();
        assert_eq!((older.task_id, older.actions.len()), (None, 0));
        let none: DesktopNotification = serde_json::from_value(json!({
            "id": "n1", "title": "T", "taskId": null, "actions": []
        }))
        .unwrap();
        assert_eq!(none.task_id, None);
    }

    #[test]
    fn reads_where_a_task_sits() {
        assert_eq!(
            read_task_place(&json!({ "id": "t1", "projectId": "p1", "status": "to-do" })),
            Some(("p1".to_string(), "to-do".to_string()))
        );
        assert_eq!(read_task_place(&json!({ "id": "t1" })), None);
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
    fn builds_the_task_body_from_quick_add_details() {
        let plain = task_body("T", "todo", &TaskDetails::default());
        assert_eq!(
            plain,
            json!({ "title": "T", "description": "", "priority": "no-priority", "status": "todo" })
        );
        let details = TaskDetails {
            description: Some("  notes  ".into()),
            due_date: Some("2026-11-18T23:00:00.000Z".into()),
            priority: Some("urgent".into()),
            assignee_ids: Some(vec!["u1".into(), " u1 ".into(), "".into(), "u2".into()]),
        };
        let body = task_body("T", "todo", &details);
        assert_eq!(body["description"], "notes");
        assert_eq!(body["dueDate"], "2026-11-18T23:00:00.000Z");
        assert_eq!(body["priority"], "urgent");
        assert_eq!(body["assigneeIds"], json!(["u1", "u2"]));
        let odd = TaskDetails {
            priority: Some("critical".into()),
            due_date: Some(" ".into()),
            assignee_ids: Some(vec![]),
            ..TaskDetails::default()
        };
        let body = task_body("T", "todo", &odd);
        assert_eq!(body["priority"], "no-priority");
        assert!(body.get("dueDate").is_none());
        // No list means the project's default assignee, so none is sent.
        assert!(body.get("assigneeIds").is_none());
    }

    #[test]
    fn reads_workspace_members() {
        let answer = json!({ "members": [
            { "id": "m1", "userId": "u1", "user": { "id": "u1", "name": "Ada Lovelace", "email": "ada@example.com" } },
            { "id": "m2", "userId": "u2", "user": { "id": "u2", "name": " ", "email": "bob@example.com" } },
            { "id": "m3", "userId": "u3" }
        ], "total": 3 });
        assert_eq!(
            read_members(&answer),
            vec![
                QuickAddMember {
                    id: "u1".into(),
                    name: "Ada Lovelace".into(),
                    handle: "ada".into()
                },
                QuickAddMember {
                    id: "u2".into(),
                    name: "bob@example.com".into(),
                    handle: "bob".into()
                },
            ]
        );
        let bare = json!([{ "user": { "id": "u9", "name": "Zed", "email": "z@x" } }]);
        assert_eq!(read_members(&bare)[0].id, "u9");
    }

    #[test]
    fn reads_upload_targets() {
        let api = Url::parse("https://pm.example").unwrap();
        let target = read_upload_target(
            &json!({
                "key": "w/p/t/a.png",
                "uploadUrl": "https://bucket.example/a.png?sig=1",
                "headers": {
                    "Content-Type": "image/png",
                    "x-amz-acl": "private",
                    "X-Goog-Meta-A": "1",
                    "Cache-Control": "no-cache",
                    "Content-MD5": "abc",
                    "Authorization": "x",
                    "Cookie": "session=1",
                    "Host": "elsewhere.example",
                    "Origin": "https://evil.example",
                    "n": 1
                }
            }),
            &api,
        )
        .unwrap();
        assert_eq!(target.key, "w/p/t/a.png");
        assert_eq!(target.url.host_str(), Some("bucket.example"));
        let mut names: Vec<_> = target
            .headers
            .iter()
            .map(|(name, _)| name.as_str())
            .collect();
        names.sort_unstable();
        assert_eq!(
            names,
            [
                "Cache-Control",
                "Content-MD5",
                "Content-Type",
                "X-Goog-Meta-A",
                "x-amz-acl"
            ]
        );
        let read = |url: &str| read_upload_target(&json!({ "key": "k", "uploadUrl": url }), &api);
        assert!(read("file:///etc/passwd").is_none());
        assert!(read_upload_target(&json!({ "uploadUrl": "https://x" }), &api).is_none());
        // The API's own store, absolute or relative to the API.
        assert_eq!(
            read("/api/storage/upload/tok").unwrap().url.as_str(),
            "https://pm.example/api/storage/upload/tok"
        );
        assert!(read("https://pm.example/api/storage/upload/tok").is_some());
    }

    #[test]
    fn sends_uploads_only_to_public_https_or_the_apis_own_host() {
        let https_api = Url::parse("https://pm.example").unwrap();
        let allowed = |api: &Url, url: &str| upload_url_allowed(api, &Url::parse(url).unwrap());
        assert!(allowed(&https_api, "https://bucket.s3.example/a?sig=1"));
        assert!(allowed(&https_api, "https://203.0.113.9/a"));
        // Plain http only when the API itself is plain http.
        assert!(!allowed(&https_api, "http://bucket.s3.example/a"));
        assert!(!allowed(
            &https_api,
            "http://pm.example/api/storage/upload/t"
        ));
        assert!(!allowed(&https_api, "ftp://bucket.example/a"));
        assert!(!allowed(&https_api, "https://user:pw@bucket.example/a"));
        // Internal addresses, unless they are the API's own host.
        for internal in [
            "https://127.0.0.1/a",
            "https://localhost/a",
            "https://foo.localhost/a",
            "https://10.0.0.5/a",
            "https://172.16.3.4/a",
            "https://192.168.1.10/a",
            "https://169.254.169.254/latest/meta-data",
            "https://100.64.0.1/a",
            "https://0.0.0.0/a",
            "https://[::1]/a",
            "https://[fd00::1]/a",
            "https://[fe80::1]/a",
            "https://[::ffff:10.0.0.1]/a",
            "https://[::ffff:127.0.0.1]/a",
        ] {
            assert!(!allowed(&https_api, internal), "{internal}");
        }
        let local_api = Url::parse("http://localhost:1337").unwrap();
        assert!(allowed(
            &local_api,
            "http://localhost:1337/api/storage/upload/t"
        ));
        assert!(!allowed(&local_api, "http://127.0.0.1:9000/bucket/a"));
        assert!(!allowed(&local_api, "http://169.254.169.254/latest"));
        assert!(allowed(&local_api, "http://bucket.example/a"));
        let lan_api = Url::parse("http://192.168.1.20:1337").unwrap();
        assert!(allowed(
            &lan_api,
            "http://192.168.1.20:1337/api/storage/upload/t"
        ));
        assert!(!allowed(&lan_api, "http://192.168.1.21/a"));
    }

    #[test]
    fn keeps_only_storage_headers() {
        for name in [
            "Content-Type",
            "content-length",
            "Content-MD5",
            "Cache-Control",
            "x-amz-meta-a",
            "X-Goog-Hash",
        ] {
            assert!(upload_header_allowed(name), "{name}");
        }
        for name in [
            "Authorization",
            "Cookie",
            "Host",
            "Origin",
            "Referer",
            "X-Forwarded-For",
            "Proxy-Authorization",
            "x-amzz",
        ] {
            assert!(!upload_header_allowed(name), "{name}");
        }
    }

    #[test]
    fn reads_the_session_user() {
        assert_eq!(
            read_session_user_id(&json!({ "session": {}, "user": { "id": "u1" } })).as_deref(),
            Some("u1")
        );
        assert_eq!(read_session_user_id(&Value::Null), None);
        assert_eq!(read_session_user_id(&json!({ "user": { "id": "" } })), None);
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
            link_paused: false,
        };
        assert_eq!(
            task_url(&server, "w 1", "p1", "t1").unwrap().as_str(),
            "https://app.example/margaya/dashboard/workspace/w%201/project/p1/task/t1"
        );
        assert_eq!(segment("a/b c"), "a%2Fb%20c");
    }
}
