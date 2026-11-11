//! `window.__MARGAYA_DESKTOP__` (contract §4): an initialization script in
//! each server window that forwards a fixed set of messages to Rust. Any
//! server page, a compromised one included, gets exactly this and nothing
//! more: no filesystem, no shell. Rust checks every message's sender, and
//! window controls only ever act on the window that sent them.

use serde::Deserialize;
use url::Url;

use crate::servers::{self, Server};
use crate::titlebar;
use crate::urls;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BridgeMessage {
    StartBrowserSignIn,
    OpenExternal {
        url: String,
    },
    SetBadge {
        count: u32,
    },
    ShowQuickAdd,
    /// The one-time secret from this server's token exchange, which the
    /// web /auth/complete page sends back when redeeming the webview token.
    TakeHandoffSecret,
    /// The launcher (server switcher).
    ShowServers,
    /// Run this identity provider sign-in (account linking) in an in-app
    /// popup on this server's profile. Accepted only for an OAuth request
    /// whose redirect_uri is this server's own sign-in callback.
    OpenSignInPopup {
        url: String,
    },
    /// The web UI signed out: sign this server out natively too (revoke the
    /// bearer token, stop the socket).
    SignedOut,
    /// The page is up. `navigate`: it listens for `margaya:navigate`;
    /// `titleBar`: it draws the window title bar.
    #[serde(rename_all = "camelCase")]
    Ready {
        #[serde(default)]
        navigate: bool,
        #[serde(default)]
        title_bar: bool,
    },
    /// "Mute sounds on this device" in the web UI changed (sent once at
    /// start too): native notifications from this server stay silent.
    SoundMuted {
        muted: bool,
    },
    Minimize,
    ToggleMaximize,
    /// Hides the server's main window (the app stays in the tray); closes an
    /// additional window.
    Close,
    StartDragging,
    IsMaximized,
}

/// `platform` on the bridge. The BSDs (test builds only) say "linux": the
/// web app treats them alike.
pub fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    }
}

/// The script injected into a server window's main frame. It defines the
/// bridge only on the server's web origin.
pub fn init_script(web: &Url, version: &str) -> String {
    let origin = serde_json::to_string(&urls::origin(web)).unwrap_or_default();
    let version = serde_json::to_string(version).unwrap_or_default();
    let platform = serde_json::to_string(platform()).unwrap_or_default();
    let title_bar = titlebar::bridge_literal(titlebar::current_os());
    format!(
        r#"(function () {{
  if (window.location.origin !== {origin} || window.__MARGAYA_DESKTOP__) return;
  var call = function (message) {{
    try {{
      var internals = window.__TAURI_INTERNALS__;
      if (internals) return Promise.resolve(internals.invoke("bridge_message", {{ message: message }}));
    }} catch (_) {{}}
    return Promise.reject(new Error("bridge unavailable"));
  }};
  var send = function (message) {{ call(message).catch(function () {{}}); }};
  var titleBar = {title_bar};
  var controls = Object.freeze({{
    minimize: function () {{ send({{ kind: "minimize" }}); }},
    toggleMaximize: function () {{ send({{ kind: "toggleMaximize" }}); }},
    close: function () {{ send({{ kind: "close" }}); }},
    startDragging: function () {{ send({{ kind: "startDragging" }}); }},
    isMaximized: function () {{
      return call({{ kind: "isMaximized" }}).then(
        function (value) {{ return value === true; }},
        function () {{ return false; }}
      );
    }},
    onStateChange: function (callback) {{
      if (typeof callback !== "function") return function () {{}};
      var listener = function (event) {{
        var d = event && event.detail;
        if (!d || typeof d !== "object") return;
        try {{ callback({{ maximized: d.maximized === true, focused: d.focused === true, fullscreen: d.fullscreen === true }}); }} catch (_) {{}}
      }};
      window.addEventListener("margaya:window-state", listener);
      return function () {{ window.removeEventListener("margaya:window-state", listener); }};
    }}
  }});
  var members = {{
    version: {version},
    platform: {platform},
    navigateAck: true,
    notificationSound: "system",
    startBrowserSignIn: function () {{ send({{ kind: "startBrowserSignIn" }}); }},
    openExternal: function (url) {{ send({{ kind: "openExternal", url: String(url) }}); }},
    setBadge: function (count) {{
      var value = Math.max(0, Math.min(1000000, Math.floor(Number(count) || 0)));
      send({{ kind: "setBadge", count: value }});
    }},
    showQuickAdd: function () {{ send({{ kind: "showQuickAdd" }}); }},
    takeHandoffSecret: function () {{
      return call({{ kind: "takeHandoffSecret" }}).then(
        function (value) {{ return typeof value === "string" ? value : null; }},
        function () {{ return null; }}
      );
    }},
    showServers: function () {{ send({{ kind: "showServers" }}); }},
    openSignInPopup: function (url) {{ send({{ kind: "openSignInPopup", url: String(url) }}); }},
    signedOut: function () {{ send({{ kind: "signedOut" }}); }},
    setSoundMuted: function (muted) {{ send({{ kind: "soundMuted", muted: muted === true }}); }},
    ready: function (info) {{
      var options = info && typeof info === "object" ? info : {{}};
      send({{ kind: "ready", navigate: options.navigate !== false, titleBar: options.titleBar !== false }});
    }},
    window: controls
  }};
  if (titleBar) members.titleBar = Object.freeze(titleBar);
  var bridge = Object.freeze(members);
  Object.defineProperty(window, "__MARGAYA_DESKTOP__", {{ value: bridge, enumerable: false, configurable: false, writable: false }});
}})();"#
    )
}

/// The server a bridge message may act for: the window must be one of that
/// server's own windows (`server-<id>` or `server-<id>-<n>`, never a sign-in
/// popup), and the page must be on that server's web origin.
pub fn sender_server<'a>(
    servers: &'a [Server],
    window_label: &str,
    page: &Url,
) -> Option<&'a Server> {
    let id = servers::id_from_window_label(window_label)?;
    let server = servers.iter().find(|server| server.id == id)?;
    let web = server.web()?;
    urls::same_origin(page, &web).then_some(server)
}

/// Links the bridge may open in the system browser: http(s) only.
pub fn external_url(raw: &str) -> Option<Url> {
    Url::parse(raw)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(id: &str, web: &str) -> Server {
        Server {
            id: id.into(),
            label: "x".into(),
            web_url: web.into(),
            api_url: "https://api.example".into(),
            server_version: None,
            added_at: 0,
            last_used_at: None,
            reopen: false,
            sound_muted: false,
        }
    }

    const A: &str = "11111111-1111-4111-8111-111111111111";
    const B: &str = "22222222-2222-4222-8222-222222222222";

    #[test]
    fn accepts_only_the_server_page_in_its_own_window() {
        let servers = [
            server(A, "https://a.example"),
            server(B, "https://b.example"),
        ];
        let page = |raw: &str| Url::parse(raw).unwrap();
        let label_a = format!("server-{A}");
        assert_eq!(
            sender_server(&servers, &label_a, &page("https://a.example/dashboard"))
                .map(|s| s.id.as_str()),
            Some(A)
        );
        // An additional window of the same server speaks for it too.
        assert_eq!(
            sender_server(&servers, &format!("server-{A}-3"), &page("https://a.example/x"))
                .map(|s| s.id.as_str()),
            Some(A)
        );
        // A sign-in popup never does, even on the server's own origin.
        assert!(sender_server(&servers, &format!("popup-{A}-1"), &page("https://a.example/")).is_none());
        // Server B's page cannot speak for A's window, nor A's page from B's window.
        assert!(sender_server(&servers, &label_a, &page("https://b.example/")).is_none());
        assert!(sender_server(
            &servers,
            &format!("server-{B}"),
            &page("https://a.example/")
        )
        .is_none());
        assert!(sender_server(&servers, &format!("server-{B}-1"), &page("https://a.example/")).is_none());
        // Other origins, other windows and unknown servers get nothing.
        assert!(sender_server(&servers, &label_a, &page("https://a.example.evil.com/")).is_none());
        assert!(sender_server(&servers, &label_a, &page("http://a.example/")).is_none());
        assert!(sender_server(&servers, &label_a, &page("http://tauri.localhost/index.html")).is_none());
        assert!(sender_server(&servers, "main", &page("https://a.example/")).is_none());
        assert!(sender_server(
            &servers,
            "server-33333333-3333-4333-8333-333333333333",
            &page("https://a.example/")
        )
        .is_none());
        // The API origin is not the page origin the bridge runs on.
        assert!(sender_server(&servers, &label_a, &page("https://api.example/")).is_none());
    }

    #[test]
    fn opens_only_web_links_outside() {
        assert!(external_url("https://example.com/docs").is_some());
        assert!(external_url("http://example.com").is_some());
        assert!(external_url("file:///C:/Windows/System32/calc.exe").is_none());
        assert!(external_url("javascript:alert(1)").is_none());
        assert!(external_url("ms-settings:").is_none());
        assert!(external_url("not a url").is_none());
    }

    #[test]
    fn reads_bridge_messages() {
        let read = |json: &str| serde_json::from_str::<BridgeMessage>(json).ok();
        assert_eq!(
            read(r#"{"kind":"startBrowserSignIn"}"#),
            Some(BridgeMessage::StartBrowserSignIn)
        );
        assert_eq!(
            read(r#"{"kind":"setBadge","count":3}"#),
            Some(BridgeMessage::SetBadge { count: 3 })
        );
        assert_eq!(read(r#"{"kind":"setBadge","count":-1}"#), None);
        assert_eq!(
            read(r#"{"kind":"takeHandoffSecret"}"#),
            Some(BridgeMessage::TakeHandoffSecret)
        );
        assert_eq!(
            read(r#"{"kind":"ready","navigate":true,"titleBar":true}"#),
            Some(BridgeMessage::Ready {
                navigate: true,
                title_bar: true
            })
        );
        assert_eq!(
            read(r#"{"kind":"ready"}"#),
            Some(BridgeMessage::Ready {
                navigate: false,
                title_bar: false
            })
        );
        for (json, message) in [
            (r#"{"kind":"showServers"}"#, BridgeMessage::ShowServers),
            (
                r#"{"kind":"openSignInPopup","url":"https://github.com/x"}"#,
                BridgeMessage::OpenSignInPopup {
                    url: "https://github.com/x".into(),
                },
            ),
            (r#"{"kind":"signedOut"}"#, BridgeMessage::SignedOut),
            (
                r#"{"kind":"soundMuted","muted":true}"#,
                BridgeMessage::SoundMuted { muted: true },
            ),
            (r#"{"kind":"minimize"}"#, BridgeMessage::Minimize),
            (r#"{"kind":"toggleMaximize"}"#, BridgeMessage::ToggleMaximize),
            (r#"{"kind":"close"}"#, BridgeMessage::Close),
            (r#"{"kind":"startDragging"}"#, BridgeMessage::StartDragging),
            (r#"{"kind":"isMaximized"}"#, BridgeMessage::IsMaximized),
        ] {
            assert_eq!(read(json), Some(message), "{json}");
        }
        assert_eq!(read(r#"{"kind":"soundMuted","muted":"yes"}"#), None);
        assert_eq!(read(r#"{"kind":"readFile","path":"/etc/passwd"}"#), None);
        assert_eq!(read(r#"{"kind":"setPosition","x":0,"y":0}"#), None);
    }

    #[test]
    fn scopes_the_script_to_the_server_origin() {
        let script = init_script(&Url::parse("https://a.example/margaya").unwrap(), "0.1.0");
        assert!(script.contains(r#"window.location.origin !== "https://a.example""#));
        assert!(script.contains(r#"version: "0.1.0""#));
        assert!(script.contains("bridge_message"));
        for member in [
            "showServers:",
            "openSignInPopup:",
            "signedOut:",
            "ready:",
            "navigateAck: true",
            r#"notificationSound: "system""#,
            "setSoundMuted:",
            "toggleMaximize:",
            "startDragging:",
            "isMaximized:",
            "onStateChange:",
            "margaya:window-state",
        ] {
            assert!(script.contains(member), "{member}");
        }
        if cfg!(any(windows, target_os = "macos", target_os = "linux")) {
            assert!(script.contains(r#"var titleBar = {"style":"custom""#));
        } else {
            assert!(script.contains("var titleBar = undefined;"));
        }
        let platform = format!("platform: {:?}", platform());
        assert!(script.contains(&platform), "{platform}");
        #[cfg(target_os = "linux")]
        assert!(script.contains(r#"platform: "linux""#));
        #[cfg(windows)]
        assert!(script.contains(r#"platform: "windows""#));
    }
}
