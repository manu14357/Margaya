//! The buttons on native notifications: "Mark done", "Snooze 1 hour" and
//! "Reply", for task alerts whose server says they apply
//! (`actions` in `GET /api/notification/{id}/desktop`).
//!
//! Each alert with buttons is remembered in memory only, under a fresh
//! random id (the last [`KEPT`]), with its server, notification and task. On
//! Windows each button is a protocol-activated toast action whose link names
//! only that id and the button,
//! `margaya://notification-action?id=<uuid>&action=<done|snooze|reply>`; on
//! macOS and Linux the notification plugin reports the button with the
//! plugin's own notification id, which maps back to the same entry. Any
//! website can open a `margaya://` link, so a link carries nothing else, and
//! an id this process didn't hand out (a forged link, or a toast from before
//! a restart) only brings the app forward.
//!
//! The core then acts with the server's bearer token through the ordinary
//! routes, which check permissions as for any other request: snooze is
//! `PATCH /api/notification/{id}/snooze`, done is `PUT /api/task/status/{id}`
//! with the project's first completed column, and both mark the notification
//! read. A short silent notification confirms it, or says it failed. Reply
//! opens the task with `#reply`, which focuses the web app's comment box.
//! A snoozed alert shows again an hour later while the app keeps running.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use url::Url;
use uuid::Uuid;

use crate::auth::ALIAS_SCHEME;
use crate::servers::Server;
use crate::state::{lock, AppState};
use crate::{api, i18n, notify, tokens, windows};

/// Alerts whose buttons still work (older ones only bring the app forward).
pub const KEPT: usize = 50;
/// The host of `margaya://notification-action` links.
pub const LINK_HOST: &str = "notification-action";
/// How long "Snooze 1 hour" snoozes.
pub const SNOOZE: Duration = Duration::from_secs(60 * 60);
/// The hash that asks the web app's task page to focus its comment box.
pub const REPLY_HASH: &str = "reply";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Done,
    Snooze,
    Reply,
}

impl Action {
    pub const ALL: [Action; 3] = [Action::Done, Action::Snooze, Action::Reply];

    pub fn name(self) -> &'static str {
        match self {
            Action::Done => "done",
            Action::Snooze => "snooze",
            Action::Reply => "reply",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|action| action.name() == name)
    }

    /// The button's text, in the system's language.
    pub fn label(self) -> String {
        i18n::t(match self {
            Action::Done => "notifications.actionDone",
            Action::Snooze => "notifications.actionSnooze",
            Action::Reply => "notifications.actionReply",
        })
    }
}

/// The server's action names as buttons: known ones, once each, in a fixed
/// order. Reply needs a page to open.
pub fn offered(names: &[String], has_page: bool) -> Vec<Action> {
    Action::ALL
        .into_iter()
        .filter(|action| names.iter().any(|name| name == action.name()))
        .filter(|action| has_page || *action != Action::Reply)
        .collect()
}

/// What an alert's buttons act on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub server_id: String,
    pub notification_id: String,
    pub task_id: String,
    /// The alert's page (the task), already checked to be this server's.
    pub url: Option<Url>,
    /// The alert's tag: the confirmation replaces it.
    pub tag: String,
    pub actions: Vec<Action>,
}

#[derive(Debug)]
struct Entry {
    id: String,
    /// The notification plugin's id (macOS and Linux).
    local_id: Option<i32>,
    target: Target,
    /// Done and snooze run once per alert.
    used: Vec<Action>,
}

/// What a button press finds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Found {
    /// Not an alert of this run: just bring the app forward.
    Unknown,
    /// The button already ran for this alert (a second press).
    AlreadyDone,
    /// An alert of this run, but not one with that button: open its page.
    NotOffered(Target),
    Run(Target),
}

#[derive(Debug, Default)]
pub struct ActionTargets {
    entries: VecDeque<Entry>,
}

impl ActionTargets {
    pub const fn new() -> Self {
        Self {
            entries: VecDeque::new(),
        }
    }

    /// Remembers an alert's buttons and returns the id its links name.
    pub fn remember(&mut self, target: Target, local_id: Option<i32>) -> String {
        let id = Uuid::new_v4().hyphenated().to_string();
        self.entries.push_back(Entry {
            id: id.clone(),
            local_id,
            target,
            used: Vec::new(),
        });
        while self.entries.len() > KEPT {
            self.entries.pop_front();
        }
        id
    }

    /// The id of the alert the plugin knows by `local_id`.
    pub fn by_local(&self, local_id: i32) -> Option<String> {
        self.entries
            .iter()
            .find(|entry| entry.local_id == Some(local_id))
            .map(|entry| entry.id.clone())
    }

    /// Looks up a press; done and snooze are used up by it.
    pub fn press(&mut self, id: &str, action: Action) -> Found {
        let Some(entry) = self.entries.iter_mut().find(|entry| entry.id == id) else {
            return Found::Unknown;
        };
        if !entry.target.actions.contains(&action) {
            return Found::NotOffered(entry.target.clone());
        }
        if entry.used.contains(&action) {
            return Found::AlreadyDone;
        }
        if action != Action::Reply {
            entry.used.push(action);
        }
        Found::Run(entry.target.clone())
    }
}

/// In memory only, like download ids: a restart forgets every alert.
static TARGETS: Mutex<ActionTargets> = Mutex::new(ActionTargets::new());

/// Remembers an alert's buttons; see [`ActionTargets::remember`].
pub fn remember(target: Target, local_id: Option<i32>) -> String {
    lock(&TARGETS).remember(target, local_id)
}

/// The link a button opens (Windows).
pub fn action_link(id: &str, action: Action) -> String {
    let mut link = Url::parse(&format!("{ALIAS_SCHEME}://{LINK_HOST}")).expect("static URL");
    link.query_pairs_mut()
        .append_pair("id", id)
        .append_pair("action", action.name());
    link.to_string()
}

/// An id as the app hands them out: a lowercase hyphenated UUID only.
fn parse_id(raw: &str) -> Option<String> {
    let id = Uuid::try_parse(raw).ok()?.hyphenated().to_string();
    (id == raw).then_some(id)
}

/// Reads `margaya://notification-action?id=<uuid>&action=<name>`: exactly
/// those two parameters, once each, nothing else in the link. A link
/// without an id is still a press (of no known alert).
pub fn parse_link(url: &Url) -> Option<(Option<String>, Action)> {
    if url.scheme() != ALIAS_SCHEME
        || url.host_str() != Some(LINK_HOST)
        || !url.path().trim_end_matches('/').is_empty()
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let (mut id, mut action) = (None, None);
    for (name, value) in url.query_pairs() {
        let slot = match name.as_ref() {
            "id" => &mut id,
            "action" => &mut action,
            _ => return None,
        };
        if slot.replace(value.into_owned()).is_some() {
            return None;
        }
    }
    let action = Action::parse(action.as_deref()?)?;
    let id = match id.filter(|id| !id.is_empty()) {
        Some(raw) => Some(parse_id(&raw)?),
        None => None,
    };
    Some((id, action))
}

/// The task page with `#reply`, which focuses the comment box.
pub fn reply_url(page: &Url) -> Url {
    let mut url = page.clone();
    url.set_fragment(Some(REPLY_HASH));
    url
}

/// A button on a macOS or Linux notification (the plugin's action id).
#[cfg_attr(windows, allow(dead_code))]
pub fn on_plugin_action(app: &AppHandle, local_id: i32, action: Action) {
    let id = lock(&TARGETS).by_local(local_id);
    handle(app, id.as_deref(), action);
}

/// A button press: from a `margaya://notification-action` link (Windows) or
/// the plugin (macOS, Linux).
pub fn handle(app: &AppHandle, id: Option<&str>, action: Action) {
    let state = app.state::<AppState>();
    // A page can open the link as often as it likes: repeats are dropped
    // like outside opens.
    let key = format!("{}:{}", id.unwrap_or(""), action.name());
    let admission = lock(&state.opens).admit("notification-actions", &key, Instant::now());
    if admission != crate::opener::Admission::Open {
        log::info!("ignored a repeated notification button ({admission:?})");
        return;
    }
    let found = id.map_or(Found::Unknown, |id| lock(&TARGETS).press(id, action));
    match found {
        Found::Unknown => {
            log::info!("a notification button names no alert of this run; showing the app");
            windows::spawn_ui(app, windows::show_main);
        }
        Found::AlreadyDone => log::info!("a notification button was pressed again"),
        Found::NotOffered(target) => {
            log::info!("a notification button the alert doesn't offer; opening its page");
            open_page(app, &target, target.url.clone());
        }
        Found::Run(target) => {
            log::info!("notification button: {}", action.name());
            if action == Action::Reply {
                open_page(app, &target, target.url.as_ref().map(reply_url));
            }
            let app = app.clone();
            tauri::async_runtime::spawn(async move { perform(&app, target, action).await });
        }
    }
}

fn open_page(app: &AppHandle, target: &Target, url: Option<Url>) {
    let Ok(server) = app.state::<AppState>().server(&target.server_id) else {
        windows::spawn_ui(app, windows::show_main);
        return;
    };
    let target = url
        .filter(|url| server.owns(url))
        .map_or(windows::Target::None, windows::Target::InApp);
    windows::spawn_ui(app, move |app| {
        if let Err(error) = windows::open_server_window(app, &server, target) {
            log::warn!("could not open a notification's page: {}", error.message);
        }
    });
}

/// The RFC 3339 time a snooze starting now ends.
pub fn snooze_until(now: chrono::DateTime<chrono::Utc>) -> String {
    let until = now + chrono::Duration::from_std(SNOOZE).expect("an hour fits");
    until.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

async fn perform(app: &AppHandle, target: Target, action: Action) {
    let state = app.state::<AppState>();
    let Ok(server) = state.server(&target.server_id) else {
        return;
    };
    let Some(token) = tokens::get(&server.id) else {
        log::info!("a notification button for a server that is signed out");
        confirm(app, &server, &target, Err(action));
        return;
    };
    let client = &state.http;
    let result = match action {
        Action::Snooze => {
            let until = snooze_until(chrono::Utc::now());
            api::snooze_notification(client, &server, &token, &target.notification_id, &until).await
        }
        Action::Done => api::mark_task_done(client, &server, &token, &target.task_id).await,
        Action::Reply => Ok(()),
    };
    if let Err(error) = &result {
        log::warn!(
            "notification button {} failed: {}",
            action.name(),
            error.message
        );
        confirm(app, &server, &target, Err(action));
        return;
    }
    // Snoozed alerts come back unread when the snooze ends.
    if let Err(error) =
        api::mark_notification_read(client, &server, &token, &target.notification_id).await
    {
        log::warn!("could not mark a notification read: {}", error.message);
    }
    crate::socket::refresh_unread(app, &server, &token).await;
    match action {
        Action::Reply => {}
        Action::Done | Action::Snooze => confirm(app, &server, &target, Ok(action)),
    }
    if action == Action::Snooze {
        remind_again(app, server.id.clone(), target.notification_id.clone());
    }
}

/// Shows the snoozed alert again once the snooze ends, while the app runs.
fn remind_again(app: &AppHandle, server_id: String, notification_id: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // The server resurfaces it at the minute; a little after that.
        tokio::time::sleep(SNOOZE + Duration::from_secs(5)).await;
        let Ok(server) = app.state::<AppState>().server(&server_id) else {
            return;
        };
        let Some(token) = tokens::get(&server_id) else {
            return;
        };
        crate::socket::show_notification(&app, &server, &token, &notification_id).await;
    });
}

/// The confirmation's title and body keys.
pub fn confirmation_keys(result: Result<Action, Action>) -> Option<(&'static str, &'static str)> {
    match result {
        Ok(Action::Done) => Some(("notifications.doneTitle", "notifications.doneBody")),
        Ok(Action::Snooze) => Some(("notifications.snoozedTitle", "notifications.snoozedBody")),
        Err(Action::Done) => Some((
            "notifications.doneFailedTitle",
            "notifications.actionFailedBody",
        )),
        Err(Action::Snooze) => Some((
            "notifications.snoozeFailedTitle",
            "notifications.actionFailedBody",
        )),
        Ok(Action::Reply) | Err(Action::Reply) => None,
    }
}

fn confirm(app: &AppHandle, server: &Server, target: &Target, result: Result<Action, Action>) {
    let Some((title, body)) = confirmation_keys(result) else {
        return;
    };
    notify::show_confirmation(
        app,
        server,
        i18n::t(title),
        i18n::t(body),
        target.url.clone(),
        &target.tag,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{parse_deep_link, DeepLink};

    fn target(actions: Vec<Action>) -> Target {
        Target {
            server_id: "s1".into(),
            notification_id: "n1".into(),
            task_id: "t1".into(),
            url: Some(
                Url::parse("https://app.example/dashboard/workspace/w/project/p/task/t1").unwrap(),
            ),
            tag: "n1".into(),
            actions,
        }
    }

    #[test]
    fn keeps_the_last_fifty_alerts_under_random_ids() {
        let mut targets = ActionTargets::new();
        let first = targets.remember(target(Action::ALL.to_vec()), Some(7));
        assert!(parse_id(&first).is_some());
        assert_eq!(targets.by_local(7).as_deref(), Some(first.as_str()));
        for n in 0..KEPT {
            targets.remember(target(vec![Action::Snooze]), Some(100 + n as i32));
        }
        assert_eq!(targets.press(&first, Action::Snooze), Found::Unknown);
        assert_eq!(targets.by_local(7), None);
    }

    #[test]
    fn runs_done_and_snooze_once_and_reply_each_time() {
        let mut targets = ActionTargets::new();
        let id = targets.remember(
            target(vec![Action::Done, Action::Snooze, Action::Reply]),
            None,
        );
        assert!(matches!(targets.press(&id, Action::Done), Found::Run(_)));
        assert_eq!(targets.press(&id, Action::Done), Found::AlreadyDone);
        assert!(matches!(targets.press(&id, Action::Snooze), Found::Run(_)));
        assert!(matches!(targets.press(&id, Action::Reply), Found::Run(_)));
        assert!(matches!(targets.press(&id, Action::Reply), Found::Run(_)));
        assert_eq!(
            targets.press("5b0c8a52-3f7e-4c1d-9a7e-2d4f1c6b8e91", Action::Done),
            Found::Unknown
        );
    }

    #[test]
    fn a_button_the_server_did_not_offer_only_opens_the_page() {
        let mut targets = ActionTargets::new();
        let id = targets.remember(target(vec![Action::Snooze]), None);
        assert!(matches!(
            targets.press(&id, Action::Done),
            Found::NotOffered(_)
        ));
        assert!(matches!(
            targets.press(&id, Action::Done),
            Found::NotOffered(_)
        ));
    }

    #[test]
    fn reads_the_servers_actions_in_a_fixed_order() {
        let names = |list: &[&str]| list.iter().map(|name| name.to_string()).collect::<Vec<_>>();
        assert_eq!(
            offered(
                &names(&["reply", "snooze", "done", "done", "archive"]),
                true
            ),
            vec![Action::Done, Action::Snooze, Action::Reply]
        );
        assert_eq!(
            offered(&names(&["reply", "snooze"]), false),
            vec![Action::Snooze]
        );
        assert!(offered(&[], true).is_empty());
    }

    #[test]
    fn links_carry_only_the_id_and_the_button() {
        let id = "5b0c8a52-3f7e-4c1d-9a7e-2d4f1c6b8e91";
        let link = action_link(id, Action::Snooze);
        assert_eq!(
            link,
            format!("margaya://notification-action?id={id}&action=snooze")
        );
        let url = Url::parse(&link).unwrap();
        assert_eq!(
            parse_link(&url),
            Some((Some(id.to_string()), Action::Snooze))
        );
        assert_eq!(
            parse_deep_link(&url),
            Some(DeepLink::NotificationAction {
                id: Some(id.to_string()),
                action: Action::Snooze
            })
        );
        let parse = |raw: &str| parse_link(&Url::parse(raw).unwrap());
        assert_eq!(
            parse("margaya://notification-action?action=done"),
            Some((None, Action::Done))
        );
        for bad in [
            "margaya://notification-action?id=x&action=done",
            &format!(
                "margaya://notification-action?id={}&action=done",
                id.to_uppercase()
            ),
            &format!("margaya://notification-action?id={id}&action=delete"),
            &format!("margaya://notification-action?id={id}"),
            &format!("margaya://notification-action?id={id}&action=done&path=/api/x"),
            &format!("margaya://notification-action?id={id}&id={id}&action=done"),
            &format!("margaya://notification-action?id={id}&action=done&action=reply"),
            &format!("margaya://notification-action/x?id={id}&action=done"),
            &format!("margaya://notification-action:9?id={id}&action=done"),
            &format!("margaya://notification-action?id={id}&action=done#x"),
            &format!("margaya://user@notification-action?id={id}&action=done"),
            &format!("com.margaya.desktop://notification-action?id={id}&action=done"),
        ] {
            assert_eq!(parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn reply_opens_the_task_with_its_comment_box_focused() {
        let page = Url::parse(
            "https://app.example/dashboard/workspace/w/project/p/task/t1?tab=x#comment-1",
        )
        .unwrap();
        assert_eq!(
            reply_url(&page).as_str(),
            "https://app.example/dashboard/workspace/w/project/p/task/t1?tab=x#reply"
        );
    }

    #[test]
    fn snoozes_for_an_hour_in_utc() {
        use chrono::TimeZone;
        let now = chrono::Utc
            .with_ymd_and_hms(2026, 11, 17, 23, 30, 0)
            .unwrap();
        assert_eq!(snooze_until(now), "2026-11-18T00:30:00Z");
    }

    #[test]
    fn confirms_done_and_snooze_and_says_when_they_failed() {
        assert_eq!(
            confirmation_keys(Ok(Action::Done)),
            Some(("notifications.doneTitle", "notifications.doneBody"))
        );
        assert_eq!(
            confirmation_keys(Err(Action::Snooze)).map(|keys| keys.0),
            Some("notifications.snoozeFailedTitle")
        );
        assert_eq!(confirmation_keys(Ok(Action::Reply)), None);
        // Every key has English copy.
        for result in [
            Ok(Action::Done),
            Ok(Action::Snooze),
            Err(Action::Done),
            Err(Action::Snooze),
        ] {
            let (title, body) = confirmation_keys(result).unwrap();
            for key in [title, body] {
                assert_ne!(i18n::t(key), key, "{key}");
            }
        }
        for action in Action::ALL {
            assert!(!action.label().starts_with("notifications."));
        }
    }
}
