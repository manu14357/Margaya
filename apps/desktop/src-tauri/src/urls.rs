//! URL helpers shared by discovery, windows, deep links and the bridge.

use url::Url;

/// Hosts that count as this computer: plain http is normal there.
pub fn is_loopback_host(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(domain)) => {
            domain.eq_ignore_ascii_case("localhost")
                || domain.to_ascii_lowercase().ends_with(".localhost")
        }
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

/// Turns what the user typed into a base URL: scheme, host, port and path,
/// without query, fragment or credentials. A missing scheme means https, or
/// http for this computer.
pub fn normalize_server_input(input: &str) -> Option<Url> {
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_whitespace) {
        return None;
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        let host = trimmed
            .split(['/', ':'])
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        let local = host == "localhost" || host == "127.0.0.1" || host.ends_with(".localhost");
        format!("{}://{trimmed}", if local { "http" } else { "https" })
    };
    let mut url = Url::parse(&with_scheme).ok()?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none_or(str::is_empty) {
        return None;
    }
    url.set_query(None);
    url.set_fragment(None);
    let _ = url.set_username("");
    let _ = url.set_password(None);
    let path = url.path().trim_end_matches('/').to_string();
    url.set_path(&path);
    Some(url)
}

/// Joins an absolute path ("/api/config") onto a base URL that may itself
/// carry a path prefix (a server hosted under /margaya).
pub fn join_path(base: &Url, path: &str) -> Url {
    let mut url = base.clone();
    let prefix = base.path().trim_end_matches('/');
    url.set_path(&format!("{prefix}{path}"));
    url.set_query(None);
    url.set_fragment(None);
    url
}

/// The ASCII serialization of a URL's origin ("https://host:port").
pub fn origin(url: &Url) -> String {
    url.origin().ascii_serialization()
}

pub fn same_origin(a: &Url, b: &Url) -> bool {
    let origin_a = a.origin();
    origin_a.is_tuple() && origin_a == b.origin()
}

/// Plain http to another computer: cookies and credentials travel in clear.
pub fn is_insecure(url: &Url) -> bool {
    url.scheme() == "http" && !is_loopback_host(url)
}

/// An app-relative path from a deep link or notification: must start with a
/// single slash, so it can never name another host.
pub fn safe_relative_path(path: &str) -> Option<&str> {
    let valid = path.starts_with('/')
        && !path.starts_with("//")
        && !path.contains('\\')
        && !path.chars().any(char::is_control);
    valid.then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn norm(input: &str) -> Option<String> {
        normalize_server_input(input).map(|url| url.to_string())
    }

    #[test]
    fn normalizes_typed_addresses() {
        assert_eq!(
            norm("margaya.example.com").as_deref(),
            Some("https://margaya.example.com/")
        );
        assert_eq!(
            norm("  https://Margaya.Example.com/  ").as_deref(),
            Some("https://margaya.example.com/")
        );
        assert_eq!(
            norm("https://example.com/margaya/?x=1#y").as_deref(),
            Some("https://example.com/margaya")
        );
        assert_eq!(
            norm("https://user:pw@example.com").as_deref(),
            Some("https://example.com/")
        );
        assert_eq!(
            norm("http://10.0.0.5:8080").as_deref(),
            Some("http://10.0.0.5:8080/")
        );
    }

    #[test]
    fn defaults_to_http_only_for_this_computer() {
        assert_eq!(
            norm("localhost:1337").as_deref(),
            Some("http://localhost:1337/")
        );
        assert_eq!(
            norm("127.0.0.1:5173").as_deref(),
            Some("http://127.0.0.1:5173/")
        );
        assert_eq!(
            norm("app.localhost").as_deref(),
            Some("http://app.localhost/")
        );
        assert_eq!(
            norm("localhost.example.com").as_deref(),
            Some("https://localhost.example.com/")
        );
    }

    #[test]
    fn rejects_non_web_input() {
        assert_eq!(norm(""), None);
        assert_eq!(norm("   "), None);
        assert_eq!(norm("not a url"), None);
        assert_eq!(norm("ftp://example.com"), None);
        assert_eq!(norm("javascript://alert(1)"), None);
        assert_eq!(norm("file:///etc/passwd"), None);
    }

    #[test]
    fn joins_paths_under_a_prefix() {
        let base = Url::parse("https://example.com/margaya").unwrap();
        assert_eq!(
            join_path(&base, "/api/config").as_str(),
            "https://example.com/margaya/api/config"
        );
        let root = Url::parse("https://example.com/").unwrap();
        assert_eq!(
            join_path(&root, "/api/config").as_str(),
            "https://example.com/api/config"
        );
    }

    #[test]
    fn compares_origins() {
        let a = Url::parse("https://example.com/a").unwrap();
        let b = Url::parse("https://example.com:443/b?x").unwrap();
        let c = Url::parse("https://example.com:8443/").unwrap();
        let d = Url::parse("http://example.com/").unwrap();
        let e = Url::parse("https://evil-example.com/").unwrap();
        assert!(same_origin(&a, &b));
        assert!(!same_origin(&a, &c));
        assert!(!same_origin(&a, &d));
        assert!(!same_origin(&a, &e));
        assert_eq!(origin(&c), "https://example.com:8443");
        let opaque = Url::parse("data:text/html,hi").unwrap();
        assert!(!same_origin(&opaque, &opaque.clone()));
    }

    #[test]
    fn flags_plain_http_to_other_computers() {
        assert!(is_insecure(&Url::parse("http://10.0.0.5").unwrap()));
        assert!(!is_insecure(&Url::parse("http://localhost:5173").unwrap()));
        assert!(!is_insecure(&Url::parse("http://[::1]:5173").unwrap()));
        assert!(!is_insecure(&Url::parse("https://example.com").unwrap()));
    }

    #[test]
    fn accepts_only_single_slash_paths() {
        assert_eq!(safe_relative_path("/dashboard"), Some("/dashboard"));
        assert_eq!(safe_relative_path("//evil.example"), None);
        assert_eq!(safe_relative_path("/\\evil.example"), None);
        assert_eq!(safe_relative_path("https://evil.example"), None);
        assert_eq!(safe_relative_path("dashboard"), None);
        assert_eq!(safe_relative_path("/a\nb"), None);
    }
}
