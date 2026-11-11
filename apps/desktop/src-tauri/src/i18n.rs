//! Native copy (menus, tray, notifications) from the same `desktop.launcher`
//! keys as the launcher, embedded at build time by build.rs.

use std::sync::OnceLock;

use serde_json::Value;

const DEFAULT_LOCALE: &str = "en-US";
static COPY: OnceLock<Value> = OnceLock::new();
static LOCALE: OnceLock<String> = OnceLock::new();

fn copy() -> &'static Value {
    COPY.get_or_init(|| {
        serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/desktop_i18n.json")))
            .unwrap_or(Value::Null)
    })
}

/// Picks the best available locale: exact match first, then language only.
pub fn resolve_locale<'a>(
    available: impl IntoIterator<Item = &'a str> + Clone,
    preferred: &str,
) -> String {
    let wanted = preferred.replace('_', "-").to_ascii_lowercase();
    let language = wanted.split('-').next().unwrap_or_default().to_string();
    if let Some(exact) = available
        .clone()
        .into_iter()
        .find(|locale| locale.to_ascii_lowercase() == wanted)
    {
        return exact.to_string();
    }
    available
        .into_iter()
        .find(|locale| locale.to_ascii_lowercase().split('-').next() == Some(language.as_str()))
        .unwrap_or(DEFAULT_LOCALE)
        .to_string()
}

fn locale() -> &'static str {
    LOCALE.get_or_init(|| {
        let available: Vec<&str> = copy()
            .as_object()
            .map(|map| map.keys().map(String::as_str).collect())
            .unwrap_or_default();
        let system = sys_locale::get_locale().unwrap_or_else(|| DEFAULT_LOCALE.to_string());
        resolve_locale(available.iter().copied(), &system)
    })
}

pub fn lookup<'a>(copy: &'a Value, locale: &str, key: &str) -> Option<&'a str> {
    let pointer = format!("/{locale}/{}", key.replace('.', "/"));
    copy.pointer(&pointer).and_then(Value::as_str)
}

pub fn interpolate(text: &str, values: &[(&str, &str)]) -> String {
    values.iter().fold(text.to_string(), |text, (name, value)| {
        text.replace(&format!("{{{{{name}}}}}"), value)
    })
}

/// The text for a key relative to `desktop.launcher`, in the system's locale,
/// falling back to English and then to the key.
pub fn t(key: &str) -> String {
    tv(key, &[])
}

pub fn tv(key: &str, values: &[(&str, &str)]) -> String {
    let text = lookup(copy(), locale(), key)
        .or_else(|| lookup(copy(), DEFAULT_LOCALE, key))
        .unwrap_or(key);
    interpolate(text, values)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_system_locales() {
        let available = ["en-US", "de-DE", "pt-BR", "zh-CN"];
        assert_eq!(resolve_locale(available, "pt_BR"), "pt-BR");
        assert_eq!(resolve_locale(available, "de-AT"), "de-DE");
        assert_eq!(resolve_locale(available, "zh-Hans-CN"), "zh-CN");
        assert_eq!(resolve_locale(available, "xx"), "en-US");
    }

    #[test]
    fn looks_up_and_fills_copy() {
        let copy = serde_json::json!({ "en-US": { "tray": { "openServer": "Open {{name}}" } } });
        let text = lookup(&copy, "en-US", "tray.openServer").unwrap();
        assert_eq!(interpolate(text, &[("name", "Work")]), "Open Work");
        assert_eq!(lookup(&copy, "de-DE", "tray.openServer"), None);
    }

    #[test]
    fn embeds_the_english_launcher_copy() {
        assert!(lookup(copy(), "en-US", "menu.quit").is_some());
        assert_eq!(tv("missing.key", &[]), "missing.key");
    }
}
