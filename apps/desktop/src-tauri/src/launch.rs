//! Launch arguments: what the Windows jump list, the Linux .desktop actions
//! and the login item pass on the command line. They arrive at startup, or
//! through single-instance when Margaya already runs.
//!
//! - `--action=quick-add | search | today | files | screenshot | clipboard`
//! - `--open=inbox | my-tasks`: that page in the last-used server's window
//! - `--minimized` (and the older `--hidden`): started by the login item

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::servers::{self, Server};
use crate::shortcuts::{self, Action};
use crate::state::{lock, AppState};
use crate::{api, capture, menus, tokens, windows};

/// Passed by the login item. Older installs registered `--hidden`.
pub const MINIMIZED_ARG: &str = "--minimized";
const LEGACY_HIDDEN_ARG: &str = "--hidden";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Page {
    Inbox,
    MyTasks,
}

impl Page {
    /// The page's path in the web app, inside a workspace.
    pub fn path(self, workspace_id: &str) -> String {
        let page = match self {
            Page::Inbox => "inbox",
            Page::MyTasks => "my-work",
        };
        format!("/dashboard/workspace/{workspace_id}/{page}")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchAction {
    Shortcut(Action),
    ClipboardTask,
    Open(Page),
}

/// A link among the arguments (`margaya://…`, the sign-in callback): the
/// deep-link handler owns it, and no launch action or "Send to" runs
/// alongside, whatever else the link's sender put on the command line.
pub fn has_deep_link<S: AsRef<str>>(args: &[S]) -> bool {
    args.iter().any(|arg| arg.as_ref().contains("://"))
}

/// The first action in the arguments, if any. Unknown values are ignored,
/// and nothing is read next to a deep link.
pub fn parse<S: AsRef<str>>(args: &[S]) -> Option<LaunchAction> {
    if has_deep_link(args) {
        return None;
    }
    args.iter().find_map(|arg| {
        let arg = arg.as_ref();
        if let Some(value) = arg.strip_prefix("--action=") {
            return match value {
                "quick-add" => Some(LaunchAction::Shortcut(Action::QuickAdd)),
                "search" => Some(LaunchAction::Shortcut(Action::Search)),
                "today" => Some(LaunchAction::Shortcut(Action::Today)),
                "files" => Some(LaunchAction::Shortcut(Action::Files)),
                "screenshot" => Some(LaunchAction::Shortcut(Action::Screenshot)),
                "clipboard" => Some(LaunchAction::ClipboardTask),
                _ => None,
            };
        }
        match arg.strip_prefix("--open=")? {
            "inbox" => Some(LaunchAction::Open(Page::Inbox)),
            "my-tasks" => Some(LaunchAction::Open(Page::MyTasks)),
            _ => None,
        }
    })
}

/// True when the login item started the app.
pub fn started_by_login<S: AsRef<str>>(args: &[S]) -> bool {
    args.iter()
        .any(|arg| matches!(arg.as_ref(), MINIMIZED_ARG | LEGACY_HIDDEN_ARG))
}

/// Runs a launch action. Safe from any thread: window work goes through
/// `windows::spawn_ui`.
pub fn run(app: &AppHandle, action: LaunchAction) {
    match action {
        LaunchAction::Shortcut(action) => shortcuts::run(app, action),
        LaunchAction::ClipboardTask => windows::spawn_ui(app, capture::new_task_from_clipboard),
        LaunchAction::Open(page) => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { open_page(&app, page).await });
        }
    }
}

/// The server to open pages in: the one whose window was used last, else the
/// most recently used signed-in server.
pub fn last_used_server(
    all: &[Server],
    last_focused: Option<&str>,
    signed_in: impl Fn(&str) -> bool,
) -> Option<Server> {
    last_focused
        .and_then(servers::id_from_window_label)
        .and_then(|id| all.iter().find(|server| server.id == id))
        .or_else(|| {
            all.iter()
                .filter(|server| signed_in(&server.id))
                .max_by_key(|server| server.last_used_at)
        })
        .cloned()
}

/// The workspace id in a web app address ("/dashboard/workspace/<id>/…").
pub fn workspace_in_path(path: &str) -> Option<String> {
    let mut parts = path.split('/').filter(|part| !part.is_empty());
    while let Some(part) = parts.next() {
        if part == "workspace" {
            return parts
                .next()
                .filter(|id| {
                    id.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                })
                .map(str::to_string);
        }
    }
    None
}

async fn workspace_for(app: &AppHandle, server: &Server) -> Option<String> {
    // The workspace the server's window shows now.
    if let Some(window) = app.get_webview_window(&server.window_label()) {
        if let Some(id) = window
            .url()
            .ok()
            .and_then(|url| workspace_in_path(url.path()))
        {
            return Some(id);
        }
    }
    // The workspace of the newest recent visit on that server.
    if let Some(id) = menus::recent_workspace(app, &server.id) {
        return Some(id);
    }
    // Else the first workspace the account belongs to.
    let token = tokens::get(&server.id)?;
    let state = app.state::<AppState>();
    let list = api::get(&state.http, server, &token, "/api/auth/organization/list")
        .await
        .ok()?;
    list.as_array()?
        .iter()
        .find_map(|organization| organization.get("id").and_then(Value::as_str))
        .map(str::to_string)
}

async fn open_page(app: &AppHandle, page: Page) {
    let state = app.state::<AppState>();
    let last = lock(&state.last_focused).clone();
    let Some(server) = last_used_server(&state.servers(), last.as_deref(), |id| {
        tokens::get(id).is_some()
    }) else {
        windows::show_launcher(app);
        return;
    };
    // Without a workspace, the dashboard picks the active one.
    let path = match workspace_for(app, &server).await {
        Some(workspace) => page.path(&workspace),
        None => "/dashboard".to_string(),
    };
    let target = windows::web_url_for_path(&server, &path)
        .map_or(windows::Target::None, windows::Target::InApp);
    windows::spawn_ui(app, move |app| {
        if let Err(error) = windows::open_server_window(app, &server, target) {
            log::warn!(
                "could not open a page from the jump list: {}",
                error.message
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(id: &str, last_used_at: Option<u64>) -> Server {
        Server {
            id: id.to_string(),
            label: id.to_string(),
            web_url: "https://margaya.example.com".to_string(),
            api_url: "https://margaya.example.com".to_string(),
            server_version: None,
            added_at: 0,
            last_used_at,
            reopen: false,
            sound_muted: false,
        }
    }

    #[test]
    fn reads_actions_and_pages() {
        assert_eq!(
            parse(&["margaya-desktop", "--action=quick-add"]),
            Some(LaunchAction::Shortcut(Action::QuickAdd))
        );
        assert_eq!(
            parse(&["x", "--action=search"]),
            Some(LaunchAction::Shortcut(Action::Search))
        );
        assert_eq!(
            parse(&["x", "--open=inbox"]),
            Some(LaunchAction::Open(Page::Inbox))
        );
        assert_eq!(
            parse(&["x", "--open=my-tasks"]),
            Some(LaunchAction::Open(Page::MyTasks))
        );
        assert_eq!(
            parse(&["x", "--action=files"]),
            Some(LaunchAction::Shortcut(Action::Files))
        );
        assert_eq!(
            parse(&["x", "--action=clipboard"]),
            Some(LaunchAction::ClipboardTask)
        );
        assert_eq!(parse(&["x", "--action=rm"]), None);
        assert_eq!(parse(&["x", "--open=/api/secret"]), None);
        assert_eq!(parse(&["x", "margaya://open?server=a"]), None);
        assert_eq!(parse::<&str>(&[]), None);
    }

    #[test]
    fn ignores_actions_next_to_a_deep_link() {
        // A link can't smuggle an action (a screenshot, say) in with it.
        for args in [
            ["x", "margaya://open?server=a", "--action=screenshot"],
            ["x", "--action=screenshot", "margaya://open?server=a"],
            [
                "x",
                "--open=inbox",
                "com.margaya.desktop://auth/callback?code=c",
            ],
        ] {
            assert_eq!(parse(&args), None, "{args:?}");
            assert!(has_deep_link(&args));
        }
        assert!(!has_deep_link(&["x", "--action=search"]));
    }

    #[test]
    fn knows_a_login_item_start() {
        assert!(started_by_login(&["x", "--minimized"]));
        assert!(started_by_login(&["x", "--hidden"]));
        assert!(!started_by_login(&["x", "--action=search"]));
    }

    #[test]
    fn builds_web_paths() {
        assert_eq!(Page::Inbox.path("w1"), "/dashboard/workspace/w1/inbox");
        assert_eq!(Page::MyTasks.path("w1"), "/dashboard/workspace/w1/my-work");
        assert_eq!(
            workspace_in_path("/dashboard/workspace/abc-1/project/p/board").as_deref(),
            Some("abc-1")
        );
        assert_eq!(workspace_in_path("/dashboard"), None);
        assert_eq!(workspace_in_path("/dashboard/workspace/a%2Fb/x"), None);
    }

    #[test]
    fn picks_the_server_used_last() {
        let a = "11111111-1111-4111-8111-111111111111";
        let b = "22222222-2222-4222-8222-222222222222";
        let all = vec![server(a, Some(5)), server(b, Some(9))];
        let label_a = format!("server-{a}");
        assert_eq!(
            last_used_server(&all, Some(&label_a), |_| true).unwrap().id,
            a
        );
        assert_eq!(last_used_server(&all, None, |_| true).unwrap().id, b);
        assert_eq!(last_used_server(&all, None, |id| id == a).unwrap().id, a);
        assert!(last_used_server(&all, None, |_| false).is_none());
    }
}
