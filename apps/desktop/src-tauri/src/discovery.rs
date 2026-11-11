//! Finds a Margaya server from what the user typed (contract §1):
//! `<typed>/api/config`, else `<typed>/.well-known/margaya-desktop.json`
//! naming the API, then `<apiUrl>/api/config`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

use crate::error::{AppError, ErrorKind};
use crate::urls;

/// The `desktop` block of `GET /api/config`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopConfig {
    pub enabled: bool,
    pub server_version: String,
    pub min_desktop_version: String,
    pub web_url: String,
    pub api_url: String,
}

/// What the launcher shows before the user confirms adding a server.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub web_url: String,
    pub api_url: String,
    pub server_version: String,
    pub insecure: bool,
    pub suggested_label: String,
}

/// How one `/api/config` response reads.
#[derive(Debug, PartialEq, Eq)]
pub enum ConfigReading {
    Desktop(DesktopConfig),
    /// Margaya's config without a desktop block: a server from before desktop support.
    MargayaWithoutDesktop,
    /// JSON, but not Margaya's.
    Foreign,
    /// Not JSON at all (an HTML page from a web-only host).
    NotJson,
}

pub fn read_config(body: &str) -> ConfigReading {
    let Ok(value) = serde_json::from_str::<Value>(body) else {
        return ConfigReading::NotJson;
    };
    let Some(object) = value.as_object() else {
        return ConfigReading::Foreign;
    };
    if let Some(desktop) = object.get("desktop") {
        return match serde_json::from_value::<DesktopConfig>(desktop.clone()) {
            Ok(config) => ConfigReading::Desktop(config),
            Err(_) => ConfigReading::Foreign,
        };
    }
    // Fields every Margaya /api/config has carried since before desktop support.
    if object.contains_key("hasSamlSignIn") || object.contains_key("disableRegistration") {
        ConfigReading::MargayaWithoutDesktop
    } else {
        ConfigReading::Foreign
    }
}

/// The API URL from `/.well-known/margaya-desktop.json`.
pub fn read_well_known(body: &str) -> Option<Url> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct WellKnown {
        api_url: String,
    }
    let parsed: WellKnown = serde_json::from_str(body).ok()?;
    urls::normalize_server_input(&parsed.api_url)
}

/// Checks a desktop block against this app and builds the launcher's view.
pub fn evaluate(config: &DesktopConfig, app_version: &str) -> Result<Discovery, AppError> {
    if !config.enabled {
        return Err(AppError::new(
            ErrorKind::Disabled,
            "desktop sign-in is disabled",
        ));
    }
    let app = semver::Version::parse(app_version)
        .map_err(|error| AppError::new(ErrorKind::Internal, error.to_string()))?;
    let minimum = semver::Version::parse(config.min_desktop_version.trim())
        .map_err(|_| AppError::new(ErrorKind::NotMargaya, "invalid minDesktopVersion"))?;
    if app < minimum {
        return Err(
            AppError::new(ErrorKind::DesktopTooOld, "desktop app too old")
                .with_detail(config.min_desktop_version.clone()),
        );
    }
    let web = urls::normalize_server_input(&config.web_url)
        .filter(|url| url.as_str().contains("://"))
        .ok_or_else(|| AppError::new(ErrorKind::NotMargaya, "invalid webUrl"))?;
    let api = urls::normalize_server_input(&config.api_url)
        .ok_or_else(|| AppError::new(ErrorKind::NotMargaya, "invalid apiUrl"))?;
    Ok(Discovery {
        web_url: web.to_string().trim_end_matches('/').to_string(),
        api_url: api.to_string().trim_end_matches('/').to_string(),
        server_version: config.server_version.clone(),
        insecure: urls::is_insecure(&web) || urls::is_insecure(&api),
        suggested_label: web.host_str().unwrap_or("Margaya").to_string(),
    })
}

/// True when an error chain reads like a certificate problem: the OS trust
/// store rejected the server, which only the user's IT can fix.
pub fn looks_like_tls_error(chain: &str) -> bool {
    let lower = chain.to_ascii_lowercase();
    [
        "certificate",
        "cert_",
        "untrusted root",
        "sec_e_untrusted_root",
        "sec_e_cert",
        "self signed",
        "self-signed",
        "unknown issuer",
        "unknownissuer",
        "not trusted",
        "trust evaluation",
        "-9807",
        "-9813",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn error_chain(error: &(dyn std::error::Error + 'static)) -> String {
    let mut text = error.to_string();
    let mut source = error.source();
    while let Some(inner) = source {
        text.push_str(": ");
        text.push_str(&inner.to_string());
        source = inner.source();
    }
    text
}

pub fn classify_request_error(error: &reqwest::Error) -> AppError {
    let chain = error_chain(error);
    let kind = if looks_like_tls_error(&chain) {
        ErrorKind::TlsUntrusted
    } else {
        ErrorKind::Unreachable
    };
    AppError::new(kind, chain)
}

async fn get_text(
    client: &reqwest::Client,
    url: Url,
) -> Result<(reqwest::StatusCode, String), AppError> {
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| classify_request_error(&error))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| classify_request_error(&error))?;
    Ok((status, body))
}

async fn read_config_at(client: &reqwest::Client, base: &Url) -> Result<ConfigReading, AppError> {
    let (status, body) = get_text(client, urls::join_path(base, "/api/config")).await?;
    if !status.is_success() {
        return Ok(ConfigReading::NotJson);
    }
    Ok(read_config(&body))
}

fn finish(reading: ConfigReading, app_version: &str) -> Result<Discovery, AppError> {
    match reading {
        ConfigReading::Desktop(config) => evaluate(&config, app_version),
        ConfigReading::MargayaWithoutDesktop => Err(AppError::new(
            ErrorKind::ServerTooOld,
            "no desktop block in /api/config",
        )),
        ConfigReading::Foreign | ConfigReading::NotJson => Err(AppError::new(
            ErrorKind::NotMargaya,
            "no Margaya config found",
        )),
    }
}

pub async fn discover(
    client: &reqwest::Client,
    input: &str,
    app_version: &str,
) -> Result<Discovery, AppError> {
    let base = urls::normalize_server_input(input)
        .ok_or_else(|| AppError::new(ErrorKind::InvalidUrl, "invalid server address"))?;
    let reading = read_config_at(client, &base).await?;
    if reading != ConfigReading::NotJson {
        return finish(reading, app_version);
    }
    // A web origin hosted apart from its API: the web build names the API.
    let (status, body) = get_text(
        client,
        urls::join_path(&base, "/.well-known/margaya-desktop.json"),
    )
    .await?;
    let api = status
        .is_success()
        .then(|| read_well_known(&body))
        .flatten()
        .ok_or_else(|| AppError::new(ErrorKind::NotMargaya, "no Margaya config found"))?;
    finish(read_config_at(client, &api).await?, app_version)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: &str = r#"{
        "disableRegistration": false,
        "hasSamlSignIn": false,
        "desktop": {
            "enabled": true,
            "serverVersion": "1.4.0",
            "minDesktopVersion": "0.1.0",
            "webUrl": "https://margaya.example.com",
            "apiUrl": "https://api.margaya.example.com/"
        }
    }"#;

    fn desktop(body: &str) -> DesktopConfig {
        match read_config(body) {
            ConfigReading::Desktop(config) => config,
            other => panic!("expected a desktop block, got {other:?}"),
        }
    }

    #[test]
    fn reads_the_desktop_block() {
        let config = desktop(CONFIG);
        assert_eq!(config.server_version, "1.4.0");
        let found = evaluate(&config, "0.1.0").unwrap();
        assert_eq!(found.web_url, "https://margaya.example.com");
        assert_eq!(found.api_url, "https://api.margaya.example.com");
        assert_eq!(found.suggested_label, "margaya.example.com");
        assert!(!found.insecure);
    }

    #[test]
    fn tells_old_servers_from_other_sites() {
        assert_eq!(
            read_config(r#"{"hasSamlSignIn":true}"#),
            ConfigReading::MargayaWithoutDesktop
        );
        assert_eq!(
            read_config(r#"{"name":"something else"}"#),
            ConfigReading::Foreign
        );
        assert_eq!(read_config(r#"[1,2]"#), ConfigReading::Foreign);
        assert_eq!(
            read_config("<!doctype html><html></html>"),
            ConfigReading::NotJson
        );
        assert_eq!(
            read_config(r#"{"desktop":{"enabled":"yes"}}"#),
            ConfigReading::Foreign
        );
    }

    #[test]
    fn refuses_disabled_servers_and_old_apps() {
        let mut config = desktop(CONFIG);
        config.enabled = false;
        assert_eq!(
            evaluate(&config, "0.1.0").unwrap_err().kind,
            ErrorKind::Disabled
        );

        let mut config = desktop(CONFIG);
        config.min_desktop_version = "0.3.0".into();
        let error = evaluate(&config, "0.2.9").unwrap_err();
        assert_eq!(error.kind, ErrorKind::DesktopTooOld);
        assert_eq!(error.detail.as_deref(), Some("0.3.0"));
        assert!(evaluate(&config, "0.3.0").is_ok());
        assert!(evaluate(&config, "1.0.0").is_ok());
    }

    #[test]
    fn flags_plain_http_servers() {
        let mut config = desktop(CONFIG);
        config.web_url = "http://10.0.0.5:5173".into();
        assert!(evaluate(&config, "0.1.0").unwrap().insecure);
        config.web_url = "http://localhost:5173".into();
        config.api_url = "http://localhost:1337".into();
        assert!(!evaluate(&config, "0.1.0").unwrap().insecure);
    }

    #[test]
    fn reads_the_well_known_file() {
        let api = read_well_known(r#"{"apiUrl":"https://api.example.com"}"#).unwrap();
        assert_eq!(api.as_str(), "https://api.example.com/");
        assert!(read_well_known(r#"{"apiUrl":"javascript:alert(1)"}"#).is_none());
        assert!(read_well_known("not json").is_none());
    }

    #[test]
    fn recognises_certificate_failures() {
        assert!(looks_like_tls_error(
            "error sending request: client error (Connect): The certificate chain was issued by an authority that is not trusted. (os error -2146893019)"
        ));
        assert!(looks_like_tls_error("SEC_E_UNTRUSTED_ROOT"));
        assert!(looks_like_tls_error("OSStatus -9813"));
        assert!(!looks_like_tls_error(
            "error sending request: tcp connect error: connection refused"
        ));
        assert!(!looks_like_tls_error("dns error: no such host"));
    }
}
