//! Desktop sign-in (contract §2): PKCE S256 with a state value, the system
//! browser, the com.margaya.desktop:// callback, and the token exchange.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use url::Url;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::urls;

/// How long a started sign-in waits for its callback.
const PENDING_TTL: Duration = Duration::from_secs(10 * 60);

fn random_token(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).expect("the OS random source is unavailable");
    URL_SAFE_NO_PAD.encode(buffer)
}

/// A PKCE verifier: 32 random bytes, base64url (43 characters, RFC 7636 §4.1).
pub fn new_verifier() -> String {
    random_token(32)
}

pub fn new_state() -> String {
    random_token(16)
}

/// The S256 challenge for a verifier.
pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

#[derive(Debug, Clone)]
pub struct PendingSignIn {
    pub server_id: String,
    pub state: String,
    pub verifier: String,
    started: Instant,
}

/// Sign-ins waiting for their callback, by state. Each is used at most once.
#[derive(Debug, Default)]
pub struct PendingSignIns {
    by_state: HashMap<String, PendingSignIn>,
}

impl PendingSignIns {
    /// Starts a sign-in for a server, replacing any earlier one for it.
    /// Returns (state, verifier).
    pub fn start(&mut self, server_id: &str) -> (String, String) {
        self.by_state
            .retain(|_, pending| pending.server_id != server_id);
        self.prune();
        let state = new_state();
        let verifier = new_verifier();
        self.by_state.insert(
            state.clone(),
            PendingSignIn {
                server_id: server_id.to_string(),
                state: state.clone(),
                verifier: verifier.clone(),
                started: Instant::now(),
            },
        );
        (state, verifier)
    }

    fn prune(&mut self) {
        self.by_state
            .retain(|_, pending| pending.started.elapsed() < PENDING_TTL);
    }

    /// Takes the sign-in a callback's state names; unknown, used or expired
    /// states get nothing.
    pub fn take_by_state(&mut self, state: &str) -> Option<PendingSignIn> {
        self.prune();
        self.by_state.remove(state)
    }

    /// Takes a server's sign-in, for a code the user pasted.
    pub fn take_for_server(&mut self, server_id: &str) -> Option<PendingSignIn> {
        self.prune();
        let state = self
            .by_state
            .iter()
            .find(|(_, pending)| pending.server_id == server_id)
            .map(|(state, _)| state.clone())?;
        self.by_state.remove(&state)
    }

    pub fn cancel(&mut self, server_id: &str) {
        self.by_state
            .retain(|_, pending| pending.server_id != server_id);
    }
}

/// The browser page that signs in and sends the code back.
pub fn sign_in_url(api: &Url, state: &str, challenge: &str, show_code: bool) -> Url {
    let mut url = urls::join_path(api, "/api/auth/desktop/sign-in");
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("state", state)
            .append_pair("code_challenge", challenge)
            .append_pair("code_challenge_method", "S256");
        if show_code {
            query.append_pair("display", "code");
        }
    }
    url
}

/// A link the operating system handed the app.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeepLink {
    /// com.margaya.desktop://auth/callback?code=…&state=…&server=…
    AuthCallback {
        code: String,
        state: String,
        server: Option<String>,
    },
    /// margaya://open?server=<apiUrl>&path=/…
    Open { server: String, path: String },
}

pub const AUTH_SCHEME: &str = "com.margaya.desktop";
pub const ALIAS_SCHEME: &str = "margaya";

pub fn parse_deep_link(url: &Url) -> Option<DeepLink> {
    let query: HashMap<String, String> = url.query_pairs().into_owned().collect();
    let non_empty = |key: &str| query.get(key).filter(|value| !value.is_empty()).cloned();
    let host = url.host_str().unwrap_or_default();
    let path = url.path().trim_end_matches('/');
    match url.scheme() {
        AUTH_SCHEME if host == "auth" && path == "/callback" => Some(DeepLink::AuthCallback {
            code: non_empty("code")?,
            state: non_empty("state")?,
            server: non_empty("server"),
        }),
        AUTH_SCHEME | ALIAS_SCHEME if host == "open" && path.is_empty() => {
            let server = non_empty("server")?;
            let path = non_empty("path").unwrap_or_else(|| "/".to_string());
            let path = urls::safe_relative_path(&path)?.to_string();
            Some(DeepLink::Open { server, path })
        }
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenResponse {
    pub token: String,
    pub webview_url: String,
    /// Handed once to the server window, which sends it back when redeeming
    /// the webview token.
    #[serde(default)]
    pub webview_secret: Option<String>,
}

/// Exchanges a code and its verifier for a bearer token and the one-time
/// webview URL. 401 means a bad, expired or used code, or a wrong verifier.
pub async fn exchange_code(
    client: &reqwest::Client,
    api: &Url,
    code: &str,
    verifier: &str,
    state: &str,
) -> AppResult<TokenResponse> {
    let response = client
        .post(urls::join_path(api, "/api/auth/desktop/token"))
        .json(&serde_json::json!({ "code": code, "code_verifier": verifier, "state": state }))
        .send()
        .await
        .map_err(|error| crate::discovery::classify_request_error(&error))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::BAD_REQUEST {
        return Err(AppError::new(
            ErrorKind::CodeInvalid,
            format!("token exchange answered {status}"),
        ));
    }
    if !status.is_success() {
        return Err(AppError::new(
            ErrorKind::SignInFailed,
            format!("token exchange answered {status}"),
        ));
    }
    response.json::<TokenResponse>().await.map_err(|error| {
        AppError::new(
            ErrorKind::SignInFailed,
            format!("unreadable token response: {error}"),
        )
    })
}

/// The webview URL must land on the server's own web origin.
pub fn checked_webview_url(raw: &str, web: &Url) -> Option<Url> {
    Url::parse(raw)
        .ok()
        .filter(|url| urls::same_origin(url, web))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_the_rfc_7636_challenge() {
        // RFC 7636, appendix B.
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn makes_unreserved_random_verifiers() {
        let verifier = new_verifier();
        assert_eq!(verifier.len(), 43);
        assert!(verifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(verifier, new_verifier());
        assert_ne!(new_state(), new_state());
    }

    #[test]
    fn uses_each_state_once() {
        let mut pending = PendingSignIns::default();
        let (state, verifier) = pending.start("server-a");
        assert!(pending.take_by_state("forged").is_none());
        let taken = pending.take_by_state(&state).unwrap();
        assert_eq!(taken.server_id, "server-a");
        assert_eq!(taken.verifier, verifier);
        assert_eq!(taken.state, state);
        assert!(pending.take_by_state(&state).is_none());
    }

    #[test]
    fn a_new_sign_in_replaces_the_previous_one() {
        let mut pending = PendingSignIns::default();
        let (first, _) = pending.start("server-a");
        let (second, _) = pending.start("server-a");
        let (other, _) = pending.start("server-b");
        assert!(pending.take_by_state(&first).is_none());
        assert_eq!(
            pending.take_for_server("server-a").unwrap().server_id,
            "server-a"
        );
        assert!(pending.take_by_state(&second).is_none());
        pending.cancel("server-b");
        assert!(pending.take_by_state(&other).is_none());
    }

    #[test]
    fn builds_the_browser_sign_in_url() {
        let api = Url::parse("https://api.example/base").unwrap();
        let url = sign_in_url(&api, "st", "ch", false);
        assert_eq!(
            url.as_str(),
            "https://api.example/base/api/auth/desktop/sign-in?state=st&code_challenge=ch&code_challenge_method=S256"
        );
        assert!(sign_in_url(&api, "st", "ch", true)
            .as_str()
            .ends_with("&display=code"));
    }

    fn link(raw: &str) -> Option<DeepLink> {
        parse_deep_link(&Url::parse(raw).unwrap())
    }

    #[test]
    fn parses_the_auth_callback() {
        assert_eq!(
            link("com.margaya.desktop://auth/callback?code=abc&state=xyz&server=https%3A%2F%2Fapi.example"),
            Some(DeepLink::AuthCallback {
                code: "abc".into(),
                state: "xyz".into(),
                server: Some("https://api.example".into())
            })
        );
        assert_eq!(link("com.margaya.desktop://auth/callback?code=abc"), None);
        assert_eq!(
            link("com.margaya.desktop://auth/callback?code=&state=x"),
            None
        );
        assert_eq!(
            link("com.margaya.desktop://auth/other?code=a&state=b"),
            None
        );
        assert_eq!(link("margaya://auth/callback?code=a&state=b"), None);
    }

    #[test]
    fn parses_open_links_with_safe_paths() {
        assert_eq!(
            link("margaya://open?server=https%3A%2F%2Fapi.example&path=%2Fdashboard%2Fworkspace%2Fw1"),
            Some(DeepLink::Open { server: "https://api.example".into(), path: "/dashboard/workspace/w1".into() })
        );
        assert_eq!(
            link("margaya://open?server=https%3A%2F%2Fapi.example"),
            Some(DeepLink::Open {
                server: "https://api.example".into(),
                path: "/".into()
            })
        );
        assert_eq!(
            link("margaya://open?server=https%3A%2F%2Fapi.example&path=%2F%2Fevil.example"),
            None
        );
        assert_eq!(
            link("margaya://open?server=https%3A%2F%2Fapi.example&path=https%3A%2F%2Fevil.example"),
            None
        );
        assert_eq!(link("margaya://open?path=%2F"), None);
        assert_eq!(link("https://open?server=x"), None);
    }

    #[test]
    fn keeps_the_webview_on_its_server() {
        let web = Url::parse("https://app.example").unwrap();
        assert!(checked_webview_url("https://app.example/auth/complete#token=t", &web).is_some());
        assert!(checked_webview_url("https://evil.example/auth/complete#token=t", &web).is_none());
        assert!(checked_webview_url("javascript:alert(1)", &web).is_none());
    }
}
