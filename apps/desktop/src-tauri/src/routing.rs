//! Decisions about where links, new windows and in-app navigation go, kept
//! free of Tauri so they can be tested on every platform.

use std::time::{Duration, Instant};

use serde::Serialize;
use url::Url;

use crate::error::ErrorKind;
use crate::servers::Server;
use crate::urls;

/// What a server window does with a request for a new window (Ctrl-click,
/// middle click, `target=_blank`, `window.open`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NewWindow {
    /// The server's own web or API origin: another app window on the same
    /// profile. A page shows there; a file download starts and the window
    /// closes again. The original window never moves.
    ServerWindow,
    /// The sign-in (account linking) request the page announced through
    /// the bridge's `openSignInPopup`: an in-app popup on this server's
    /// profile, because the provider's callback needs this window's cookies.
    Popup,
    /// Any other web, mail or phone link: the system's own app.
    Outside,
    Deny,
}

/// `announced`: this exact URL was announced (and checked) through
/// `openSignInPopup` moments ago. Nothing about the URL itself, or the size
/// of the requested window, can make an outside page open in the app.
pub fn new_window(server: &Server, url: &Url, announced: bool) -> NewWindow {
    match url.scheme() {
        "http" | "https" if url.host_str().is_some() => {
            if server.owns(url) {
                NewWindow::ServerWindow
            } else if announced {
                NewWindow::Popup
            } else {
                NewWindow::Outside
            }
        }
        "mailto" | "tel" => NewWindow::Outside,
        _ => NewWindow::Deny,
    }
}

/// What a server window does with a navigation of its main frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Navigation {
    Allow,
    /// The announced sign-in request (account linking does
    /// `location.href = <provider>`): refuse it here and run it in an in-app
    /// popup on this server's profile, so the provider's callback finds this
    /// window's session.
    Popup,
    /// Refuse it here and open it in the system's own app instead.
    Outside,
    Deny,
}

/// `offline_page` is the bundled offline page's address while this window is
/// showing it (the app put it there); otherwise the app's own pages are refused.
/// `announced` as for [`new_window`].
pub fn server_navigation(
    server: &Server,
    url: &Url,
    offline_page: Option<&Url>,
    announced: bool,
) -> Navigation {
    match url.scheme() {
        "http" | "https" if server.owns(url) => Navigation::Allow,
        _ if offline_page.is_some_and(|page| same_document(page, url)) => Navigation::Allow,
        "http" | "https" if announced => Navigation::Popup,
        "http" | "https" => Navigation::Outside,
        "about" | "blob" => Navigation::Allow,
        "mailto" | "tel" => Navigation::Outside,
        _ => Navigation::Deny,
    }
}

/// An OAuth 2 / OpenID Connect authorization request on another site: a
/// `client_id` and exactly one `redirect_uri`, which must be this server's
/// own sign-in callback ([`is_auth_callback`]). Only such a request, and only
/// once the page announced it, may run in an in-app window.
pub fn is_oauth_request(server: &Server, url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() || server.owns(url) {
        return false;
    }
    let mut client_id = false;
    let mut redirects = url
        .query_pairs()
        .filter_map(|(name, value)| {
            if name == "client_id" {
                client_id |= !value.is_empty();
            }
            (name == "redirect_uri").then(|| value.into_owned())
        })
        .collect::<Vec<_>>();
    let Some(redirect) = redirects.pop().filter(|_| redirects.is_empty()) else {
        return false;
    };
    client_id && Url::parse(&redirect).is_ok_and(|back| is_auth_callback(server, &back))
}

/// The server's own sign-in callback routes on its API origin (which is the
/// web origin too when both are served together):
/// `/api/auth/callback/<provider>` and `/api/auth/oauth2/callback/<provider>`.
pub fn is_auth_callback(server: &Server, url: &Url) -> bool {
    let Some(api) = server.api() else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https") || !urls::same_origin(&api, url) {
        return false;
    }
    let base = api.path().trim_end_matches('/');
    ["/api/auth/callback/", "/api/auth/oauth2/callback/"]
        .iter()
        .any(|route| {
            url.path()
                .strip_prefix(&format!("{base}{route}"))
                .is_some_and(|provider| !provider.is_empty() && !provider.contains('/'))
        })
}

/// How long an announced sign-in URL waits for the page to open it.
pub const ANNOUNCE_TTL: Duration = Duration::from_secs(10);

/// Sign-in URLs a server page announced through `openSignInPopup`, each good
/// for one popup within [`ANNOUNCE_TTL`].
#[derive(Debug, Default)]
pub struct AnnouncedPopups {
    entries: Vec<(String, String, Instant)>,
}

impl AnnouncedPopups {
    pub fn announce(&mut self, server_id: &str, url: &Url, now: Instant) {
        self.prune(now);
        self.entries
            .retain(|(id, known, _)| !(id == server_id && known == url.as_str()));
        self.entries
            .push((server_id.to_string(), url.to_string(), now));
    }

    /// True once for an announced URL of this server, then never again.
    pub fn take(&mut self, server_id: &str, url: &Url, now: Instant) -> bool {
        self.prune(now);
        let found = self
            .entries
            .iter()
            .position(|(id, known, _)| id == server_id && known == url.as_str());
        found.map(|index| self.entries.remove(index)).is_some()
    }

    fn prune(&mut self, now: Instant) {
        self.entries
            .retain(|(_, _, at)| now.saturating_duration_since(*at) < ANNOUNCE_TTL);
    }
}

/// A sign-in popup's title: the site it is on now, then the server it signs
/// into. The page's own title is never shown, so a provider page can't
/// pretend to be something else.
pub fn popup_title(url: &Url, server_label: &str) -> String {
    let host = url.host_str().unwrap_or_else(|| url.scheme());
    format!("{host} \u{2014} {server_label}")
}

/// The same page: origin, path and fragment (the app's offline page is
/// `index.html#offline`).
pub fn same_document(a: &Url, b: &Url) -> bool {
    urls::same_origin(a, b) && a.path() == b.path() && a.fragment() == b.fragment()
}

/// What a sign-in popup does with a navigation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PopupNavigation {
    /// Identity provider pages, and the server's API callback.
    Allow,
    /// Back on the server's web UI: the flow is over. Close the popup and
    /// show this page in the window that opened it.
    Finish,
    Outside,
    Deny,
}

pub fn popup_navigation(server: &Server, url: &Url) -> PopupNavigation {
    match url.scheme() {
        "http" | "https" if url.host_str().is_some() => {
            if is_web_page(server, url) {
                PopupNavigation::Finish
            } else {
                PopupNavigation::Allow
            }
        }
        "about" => PopupNavigation::Allow,
        "mailto" | "tel" => PopupNavigation::Outside,
        _ => PopupNavigation::Deny,
    }
}

/// A page of the server's web UI: its web origin, but not an API route,
/// which shares that origin when the API and web are served together.
pub fn is_web_page(server: &Server, url: &Url) -> bool {
    let Some(web) = server.web() else {
        return false;
    };
    if !urls::same_origin(&web, url) {
        return false;
    }
    let api_routes = server
        .api()
        .filter(|api| urls::same_origin(api, url))
        .map(|api| format!("{}/api/", api.path().trim_end_matches('/')));
    !api_routes.is_some_and(|prefix| url.path().starts_with(&prefix))
}

/// Path, query and fragment of a URL: what the web router navigates to.
pub fn router_path(url: &Url) -> String {
    let mut path = url.path().to_string();
    if let Some(query) = url.query() {
        path.push('?');
        path.push_str(query);
    }
    if let Some(fragment) = url.fragment() {
        path.push('#');
        path.push_str(fragment);
    }
    path
}

/// The script that moves a server page to `url` inside the web app: the
/// `margaya:navigate` event when the page listens for it (it said so through
/// the bridge, or set `data-margaya-navigate="1"` on <html>), else an ordinary
/// navigation. Every value is JSON-escaped.
pub fn navigate_script(url: &Url, id: u64, listening: bool) -> String {
    let detail = serde_json::json!({ "path": router_path(url), "id": id.to_string() });
    let href = serde_json::to_string(url.as_str()).unwrap_or_else(|_| "\"/\"".into());
    format!(
        r#"(function () {{
  var root = document.documentElement;
  if ({listening} || (root && root.dataset && root.dataset.margayaNavigate === "1")) {{
    window.dispatchEvent(new CustomEvent("margaya:navigate", {{ detail: {detail} }}));
  }} else {{
    window.location.assign({href});
  }}
}})();"#
    )
}

/// Window chrome state sent to the page as `margaya:window-state`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub struct ChromeState {
    pub maximized: bool,
    pub focused: bool,
    pub fullscreen: bool,
}

pub fn window_state_script(state: ChromeState) -> String {
    let detail = serde_json::to_string(&state).unwrap_or_else(|_| "{}".into());
    format!(
        "window.dispatchEvent(new CustomEvent(\"margaya:window-state\", {{ detail: {detail} }}));"
    )
}

/// Automatic retries from the offline page: 2, 5, 10, 20, 30 seconds, then
/// every minute.
pub fn offline_backoff(attempt: u32) -> Duration {
    const STEPS: [u64; 5] = [2, 5, 10, 20, 30];
    Duration::from_secs(STEPS.get(attempt as usize).copied().unwrap_or(60))
}

/// WebView2's `COREWEBVIEW2_WEB_ERROR_STATUS` for a failed main-frame load:
/// the ones that mean the server can't be reached, as the launcher's error
/// kinds. Cancelled loads (refused navigations, downloads) and HTTP errors
/// are not "offline".
#[cfg_attr(not(windows), allow(dead_code))]
pub fn offline_error_for_web_status(status: i32) -> Option<ErrorKind> {
    match status {
        1..=5 => Some(ErrorKind::TlsUntrusted),
        6..=13 => Some(ErrorKind::Unreachable),
        _ => None,
    }
}

/// The window background before the page paints, matching the web app's
/// light and dark backgrounds.
pub fn background_rgb(dark: bool) -> (u8, u8, u8) {
    if dark {
        (0x0c, 0x0d, 0x0d)
    } else {
        (0xfa, 0xfa, 0xf7)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(web: &str, api: &str) -> Server {
        Server {
            id: "11111111-1111-4111-8111-111111111111".into(),
            label: "x".into(),
            web_url: web.into(),
            api_url: api.into(),
            server_version: None,
            added_at: 0,
            last_used_at: None,
            reopen: false,
            sound_muted: false,
        }
    }

    fn url(raw: &str) -> Url {
        Url::parse(raw).unwrap()
    }

    #[test]
    fn routes_new_window_requests() {
        let s = server("https://app.example", "https://api.example");
        // A Ctrl-click on a task, or an attachment on the API: another app window.
        assert_eq!(
            new_window(&s, &url("https://app.example/dashboard/task/1"), false),
            NewWindow::ServerWindow
        );
        assert_eq!(
            new_window(&s, &url("https://api.example/api/asset/a1"), false),
            NewWindow::ServerWindow
        );
        assert_eq!(
            new_window(&s, &url("https://docs.example/"), false),
            NewWindow::Outside
        );
        assert_eq!(
            new_window(&s, &url("mailto:a@example.com"), false),
            NewWindow::Outside
        );
        // Lookalike origins are outside, never the server.
        assert_eq!(
            new_window(&s, &url("https://app.example.evil.com/"), false),
            NewWindow::Outside
        );
        assert_eq!(new_window(&s, &url("http://app.example/"), false), NewWindow::Outside);
        for raw in ["file:///C:/x", "javascript:alert(1)", "data:text/html,x", "ms-settings:"] {
            assert_eq!(new_window(&s, &url(raw), true), NewWindow::Deny, "{raw}");
        }
    }

    fn github(redirect: &str) -> Url {
        let mut url = url("https://github.com/login/oauth/authorize");
        url.query_pairs_mut()
            .append_pair("client_id", "abc")
            .append_pair("redirect_uri", redirect)
            .append_pair("state", "s")
            .append_pair("scope", "read:user");
        url
    }

    #[test]
    fn checks_sign_in_requests_return_to_this_servers_callback() {
        let s = server("https://app.example", "https://api.example");
        assert!(is_oauth_request(&s, &github("https://api.example/api/auth/callback/github")));
        assert!(is_oauth_request(&s, &github("https://api.example/api/auth/oauth2/callback/oidc")));
        // Not the callback route, not this server, not a web URL.
        for redirect in [
            "https://app.example/callback",
            "https://api.example/api/auth/sign-in",
            "https://api.example/api/auth/callback/",
            "https://api.example/api/auth/callback/a/b",
            "https://evil.example/api/auth/callback/github",
            "https://api.example.evil.com/api/auth/callback/github",
            "http://api.example/api/auth/callback/github",
            "com.margaya.desktop://auth/callback",
        ] {
            assert!(!is_oauth_request(&s, &github(redirect)), "{redirect}");
        }
        // No client id, two redirect_uri values, ordinary links.
        assert!(!is_oauth_request(
            &s,
            &url("https://github.com/x?redirect_uri=https%3A%2F%2Fapi.example%2Fapi%2Fauth%2Fcallback%2Fgithub")
        ));
        let mut doubled = github("https://evil.example/cb");
        doubled
            .query_pairs_mut()
            .append_pair("redirect_uri", "https://api.example/api/auth/callback/github");
        assert!(!is_oauth_request(&s, &doubled));
        assert!(!is_oauth_request(&s, &url("https://docs.example/?client_id=x")));
        // The server's own pages are never "outside".
        assert!(!is_oauth_request(
            &s,
            &url("https://api.example/authorize?client_id=x&redirect_uri=https%3A%2F%2Fapi.example%2Fapi%2Fauth%2Fcallback%2Fgithub")
        ));
        // API and web served together, under a base path.
        let same = server("https://pm.example/margaya", "https://pm.example/margaya");
        assert!(is_oauth_request(&same, &github("https://pm.example/margaya/api/auth/callback/github")));
        assert!(!is_oauth_request(&same, &github("https://pm.example/api/auth/callback/github")));
    }

    #[test]
    fn opens_in_app_only_announced_sign_in_requests() {
        let s = server("https://app.example", "https://api.example");
        let start = Instant::now();
        let mut announced = AnnouncedPopups::default();
        let linking = github("https://api.example/api/auth/callback/github");

        // A crafted page on any host, even with this server's callback as
        // redirect_uri, goes to the browser unless the page announced it.
        let crafted = {
            let mut url = url("https://login-margaya.evil.example/oauth/authorize");
            url.query_pairs_mut()
                .append_pair("client_id", "x")
                .append_pair("redirect_uri", "https://api.example/api/auth/callback/github");
            url
        };
        assert!(!announced.take(&s.id, &crafted, start));
        assert_eq!(server_navigation(&s, &crafted, None, false), Navigation::Outside);
        // A sized window.open of an unannounced URL: the browser too.
        assert!(!announced.take(&s.id, &linking, start));
        assert_eq!(new_window(&s, &linking, false), NewWindow::Outside);

        // Announced: a popup, once.
        announced.announce(&s.id, &linking, start);
        let soon = start + Duration::from_millis(300);
        assert!(!announced.take("another-server", &linking, soon));
        assert!(!announced.take(&s.id, &crafted, soon));
        assert!(announced.take(&s.id, &linking, soon));
        assert_eq!(server_navigation(&s, &linking, None, true), Navigation::Popup);
        assert_eq!(new_window(&s, &linking, true), NewWindow::Popup);
        assert!(!announced.take(&s.id, &linking, soon));
        // An announcement expires.
        announced.announce(&s.id, &linking, start);
        assert!(!announced.take(&s.id, &linking, start + ANNOUNCE_TTL));
    }

    #[test]
    fn titles_popups_with_the_current_site_and_server() {
        assert_eq!(
            popup_title(&url("https://github.com/login?x=1"), "Work"),
            "github.com \u{2014} Work"
        );
    }

    #[test]
    fn keeps_server_windows_on_their_server() {
        let s = server("https://app.example", "https://api.example");
        let offline = url("http://tauri.localhost/index.html#offline");
        assert_eq!(
            server_navigation(&s, &url("https://app.example/x"), None, false),
            Navigation::Allow
        );
        assert_eq!(
            server_navigation(&s, &url("https://api.example/api/auth/callback"), None, false),
            Navigation::Allow
        );
        assert_eq!(
            server_navigation(&s, &url("https://example.com/"), None, false),
            Navigation::Outside
        );
        assert_eq!(
            server_navigation(&s, &url("mailto:a@example.com"), None, false),
            Navigation::Outside
        );
        assert_eq!(server_navigation(&s, &url("about:blank"), None, false), Navigation::Allow);
        assert_eq!(
            server_navigation(&s, &url("file:///C:/Windows/"), None, false),
            Navigation::Deny
        );
        // The app's own pages only while the app shows the offline page there.
        assert_eq!(
            server_navigation(&s, &url("http://tauri.localhost/index.html#offline"), None, false),
            Navigation::Outside
        );
        assert_eq!(
            server_navigation(&s, &url("http://tauri.localhost/index.html#offline"), Some(&offline), false),
            Navigation::Allow
        );
        assert_eq!(
            server_navigation(&s, &url("http://tauri.localhost/index.html#launcher"), Some(&offline), false),
            Navigation::Outside
        );
        assert_eq!(
            server_navigation(&s, &url("http://tauri.localhost/other.html"), Some(&offline), false),
            Navigation::Outside
        );
        assert_eq!(
            server_navigation(&s, &url("tauri://localhost/index.html"), Some(&offline), false),
            Navigation::Deny
        );
    }

    #[test]
    fn finishes_popups_back_on_the_web_ui() {
        // API and web on separate origins.
        let s = server("https://app.example", "https://api.example");
        assert_eq!(
            popup_navigation(&s, &url("https://github.com/login/oauth/authorize")),
            PopupNavigation::Allow
        );
        assert_eq!(
            popup_navigation(&s, &url("https://api.example/api/auth/callback/github?code=1")),
            PopupNavigation::Allow
        );
        assert_eq!(
            popup_navigation(&s, &url("https://app.example/dashboard/settings")),
            PopupNavigation::Finish
        );
        assert_eq!(popup_navigation(&s, &url("about:blank")), PopupNavigation::Allow);
        assert_eq!(
            popup_navigation(&s, &url("file:///etc/passwd")),
            PopupNavigation::Deny
        );
        // API and web on one origin: API routes are not the web UI.
        let same = server("https://pm.example", "https://pm.example");
        assert_eq!(
            popup_navigation(&same, &url("https://pm.example/api/auth/callback/github")),
            PopupNavigation::Allow
        );
        assert_eq!(
            popup_navigation(&same, &url("https://pm.example/settings")),
            PopupNavigation::Finish
        );
        // Under a base path.
        let prefixed = server("https://pm.example/margaya", "https://pm.example/margaya");
        assert!(!is_web_page(&prefixed, &url("https://pm.example/margaya/api/auth/x")));
        assert!(is_web_page(&prefixed, &url("https://pm.example/margaya/dashboard")));
    }

    #[test]
    fn escapes_navigation_scripts() {
        let target = url("https://app.example/dashboard/task/1?q=a%22b#c");
        assert_eq!(router_path(&target), "/dashboard/task/1?q=a%22b#c");
        let script = navigate_script(&target, 7, true);
        assert!(script.contains(r#"{"id":"7","path":"/dashboard/task/1?q=a%22b#c"}"#));
        assert!(script.contains("if (true ||"));
        assert!(script.contains(r#"window.location.assign("https://app.example/dashboard/task/1?q=a%22b#c")"#));
        assert!(navigate_script(&target, 7, false).contains("if (false ||"));

        // Nothing in a URL can end the string or the script: the URL parser
        // percent-encodes quotes, and JSON escapes what is left.
        let hostile = url("https://app.example/a\"b'c</script><x>?\u{2028}=\\#\"); alert(1); (\"");
        let script = navigate_script(&hostile, 1, false);
        let detail_start = script.find("detail: ").unwrap() + "detail: ".len();
        let detail_end = script[detail_start..].find(" }));").unwrap() + detail_start;
        let detail: serde_json::Value =
            serde_json::from_str(&script[detail_start..detail_end]).unwrap();
        assert_eq!(detail["path"], router_path(&hostile));
        assert!(!script.contains("\"); alert(1)"));
        assert!(!script.contains("</script>"));
    }

    #[test]
    fn describes_the_window_state() {
        let script = window_state_script(ChromeState {
            maximized: true,
            focused: false,
            fullscreen: false,
        });
        assert_eq!(
            script,
            r#"window.dispatchEvent(new CustomEvent("margaya:window-state", { detail: {"maximized":true,"focused":false,"fullscreen":false} }));"#
        );
    }

    #[test]
    fn backs_off_offline_retries() {
        let secs: Vec<u64> = (0..8).map(|n| offline_backoff(n).as_secs()).collect();
        assert_eq!(secs, vec![2, 5, 10, 20, 30, 60, 60, 60]);
        assert_eq!(offline_backoff(u32::MAX).as_secs(), 60);
    }

    #[test]
    fn reads_webview_load_failures() {
        assert_eq!(offline_error_for_web_status(12), Some(ErrorKind::Unreachable)); // cannot connect
        assert_eq!(offline_error_for_web_status(13), Some(ErrorKind::Unreachable)); // DNS
        assert_eq!(offline_error_for_web_status(7), Some(ErrorKind::Unreachable)); // timeout
        assert_eq!(offline_error_for_web_status(2), Some(ErrorKind::TlsUntrusted)); // expired cert
        assert_eq!(offline_error_for_web_status(14), None); // cancelled: refused link, download
        assert_eq!(offline_error_for_web_status(0), None);
        assert_eq!(offline_error_for_web_status(17), None);
    }

    #[test]
    fn matches_the_web_backgrounds() {
        assert_eq!(background_rgb(false), (0xfa, 0xfa, 0xf7));
        assert_eq!(background_rgb(true), (0x0c, 0x0d, 0x0d));
    }
}
