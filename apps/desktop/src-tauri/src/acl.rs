//! The bridge's one IPC permission, granted per server at runtime. Each
//! server gets a capability that lets only its own windows (`server-<id>`,
//! `server-<id>-<n>`) call `bridge_message`, and only from pages on its exact
//! web origin. So a page on any other origin, in any window, can't even reach
//! the command; Rust's own sender check (`bridge::sender_server`) stays as a
//! second line.

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::servers::{Server, WINDOW_PREFIX};
use crate::state::lock;
use crate::urls;

pub const BRIDGE_PERMISSION: &str = "allow-bridge-message";

/// What a server's capability says: its identifier, the window patterns it
/// covers and the one remote origin it allows. None for anything that isn't a
/// plain http(s) origin with an ordinary host name, so nothing odd ever
/// reaches Tauri's pattern parser.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BridgeGrant {
    pub identifier: String,
    pub windows: [String; 2],
    pub origin: String,
}

pub fn bridge_grant(server: &Server) -> Option<BridgeGrant> {
    let id = Uuid::parse_str(&server.id).ok()?.hyphenated().to_string();
    if id != server.id {
        return None;
    }
    let web = server.web()?;
    if !matches!(web.scheme(), "http" | "https") {
        return None;
    }
    let origin = urls::origin(&web);
    let plain = origin
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '/' | '.' | '-' | '[' | ']'));
    if !plain || origin == "null" {
        return None;
    }
    Some(BridgeGrant {
        identifier: format!("server-bridge-{id}"),
        windows: [
            format!("{WINDOW_PREFIX}{id}"),
            format!("{WINDOW_PREFIX}{id}-*"),
        ],
        origin,
    })
}

fn granted() -> &'static Mutex<HashSet<String>> {
    static GRANTED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    GRANTED.get_or_init(Mutex::default)
}

/// Grants a server's windows the bridge, once per run. Server ids are never
/// reused, so a removed server's grant matches no window again.
pub fn grant_bridge(app: &AppHandle, server: &Server) {
    let Some(grant) = bridge_grant(server) else {
        log::warn!("not granting the bridge to a server with an unusual address");
        return;
    };
    if !lock(granted()).insert(grant.identifier.clone()) {
        return;
    }
    let capability = CapabilityBuilder::new(grant.identifier.clone())
        .windows(grant.windows)
        .remote(grant.origin)
        .local(false)
        .permission(BRIDGE_PERMISSION);
    if let Err(error) = app.add_capability(capability) {
        lock(granted()).remove(&grant.identifier);
        log::warn!("could not grant a server window the bridge: {error}");
    }
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

    #[test]
    fn grants_one_server_its_own_windows_and_origin() {
        let grant = bridge_grant(&server(A, "https://pm.example:8443/margaya/")).unwrap();
        assert_eq!(grant.identifier, format!("server-bridge-{A}"));
        assert_eq!(grant.windows, [format!("server-{A}"), format!("server-{A}-*")]);
        // The origin only: no path, query or wildcard host.
        assert_eq!(grant.origin, "https://pm.example:8443");
        assert_eq!(
            bridge_grant(&server(A, "http://localhost:5173")).unwrap().origin,
            "http://localhost:5173"
        );
        assert_eq!(
            bridge_grant(&server(A, "http://[::1]:5173")).unwrap().origin,
            "http://[::1]:5173"
        );
        // International names arrive as punycode.
        assert_eq!(
            bridge_grant(&server(A, "https://bücher.example")).unwrap().origin,
            "https://xn--bcher-kva.example"
        );
    }

    #[test]
    fn grants_nothing_for_odd_servers() {
        assert!(bridge_grant(&server("not-a-uuid", "https://pm.example")).is_none());
        // Only the canonical lowercase id, which window labels use.
        let lower = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
        assert!(bridge_grant(&server(lower, "https://pm.example")).is_some());
        assert!(bridge_grant(&server(&lower.to_uppercase(), "https://pm.example")).is_none());
        assert!(bridge_grant(&server(A, "file:///C:/x")).is_none());
        assert!(bridge_grant(&server(A, "not a url")).is_none());
    }
}
