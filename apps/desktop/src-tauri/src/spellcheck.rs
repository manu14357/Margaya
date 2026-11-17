//! The spell checker's language in server windows: the system's, or one of
//! the app's languages chosen in the launcher's settings
//! (`spellcheck.json` in the app config dir).
//!
//! - Windows (WebView2): wry already sets the environment's language to the
//!   Windows display language, which the spell checker follows. A chosen
//!   language goes in as `--lang` and `--accept-lang` browser arguments. All
//!   windows of one server share a browser process, which keeps the
//!   arguments it started with, and a window asking for other ones fails to
//!   open; so each server keeps the arguments of its first window for the
//!   whole run, and a change applies after Margaya restarts.
//! - Linux (WebKitGTK): spell checking is off by default; each server's web
//!   context gets it on, with the language, at once.
//! - macOS: WebKit uses the system's spelling settings; nothing to do.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::state::lock;

/// The app's languages: the locale files in the repository's i18n folder.
pub const LANGUAGES: &[&str] = &[
    "az-AZ", "de-DE", "el-GR", "en-US", "es-ES", "fr-FR", "hi-IN", "id-ID", "it-IT", "ja-JP",
    "ko-KR", "mk-MK", "nl-NL", "pl-PL", "pt-BR", "ru-RU", "tr-TR", "uk-UA", "vi-VN", "zh-CN",
];

/// The stored and reported value for "follow the system".
pub const SYSTEM: &str = "system";
const FILE: &str = "spellcheck.json";
const DEFAULT_LANGUAGE: &str = "en-US";

/// wry's own WebView2 arguments, which passing any arguments replaces.
#[cfg_attr(not(windows), allow(dead_code))]
const WEBVIEW2_DEFAULT_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

#[derive(Debug, Default, Serialize, Deserialize)]
struct StoredSetting {
    #[serde(default)]
    language: Option<String>,
}

/// The chosen language (one of [`LANGUAGES`]), or None to follow the system;
/// loaded once from disk.
static CHOICE: Mutex<Option<Option<&'static str>>> = Mutex::new(None);
/// The WebView2 arguments each server's profile started with in this run.
static STARTED: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

/// One of the app's languages, by its exact tag.
pub fn parse_language(raw: &str) -> Option<&'static str> {
    LANGUAGES.iter().copied().find(|language| *language == raw)
}

/// The language spell checking uses: the chosen one, else the system
/// locale, else English.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn effective(choice: Option<&str>, system: Option<&str>) -> String {
    choice
        .or(system.filter(|tag| !tag.trim().is_empty()))
        .unwrap_or(DEFAULT_LANGUAGE)
        .to_string()
}

/// WebKitGTK's dictionary names for a language tag: "de-DE" becomes
/// `["de_DE", "de"]`, so a system with only the general dictionary still
/// checks. A POSIX locale's encoding or modifier ("de_DE.UTF-8@euro") goes.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn webkit_languages(tag: &str) -> Vec<String> {
    let base = tag
        .split(['.', '@'])
        .next()
        .unwrap_or_default()
        .replace('-', "_");
    let mut parts = base.split('_').filter(|part| !part.is_empty());
    let Some(language) = parts.next() else {
        return vec![DEFAULT_LANGUAGE.replace('-', "_"), "en".to_string()];
    };
    let language = language.to_ascii_lowercase();
    match parts.next() {
        Some(region) => vec![
            format!("{language}_{}", region.to_ascii_uppercase()),
            language,
        ],
        None => vec![language],
    }
}

/// WebView2 arguments for a chosen language; None (wry's defaults, following
/// the Windows display language) when following the system.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn webview2_args(choice: Option<&str>) -> Option<String> {
    let language = choice?;
    let general = language.split('-').next().unwrap_or(language);
    Some(format!(
        "{WEBVIEW2_DEFAULT_ARGS} --lang={language} --accept-lang={language},{general}"
    ))
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(FILE))
}

fn load(path: &Path) -> Option<&'static str> {
    let text = std::fs::read_to_string(path).ok()?;
    let stored: StoredSetting = serde_json::from_str(&text).ok()?;
    stored.language.as_deref().and_then(parse_language)
}

fn save(path: &Path, choice: Option<&str>) -> AppResult<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(AppError::internal)?;
    }
    let stored = StoredSetting {
        language: choice.map(str::to_string),
    };
    let text = serde_json::to_string_pretty(&stored).map_err(AppError::internal)?;
    std::fs::write(path, text).map_err(AppError::internal)
}

/// The chosen language, or None for the system's.
pub fn choice(app: &AppHandle) -> Option<&'static str> {
    *lock(&CHOICE).get_or_insert_with(|| path(app).as_deref().and_then(load))
}

fn system_locale() -> Option<String> {
    sys_locale::get_locale()
}

fn started() -> &'static Mutex<HashMap<String, Option<String>>> {
    STARTED.get_or_init(Mutex::default)
}

/// The WebView2 arguments for a window on this server's profile: the ones
/// its first window of this run used. Windows only; None elsewhere.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn browser_args(app: &AppHandle, server_id: &str) -> Option<String> {
    if !cfg!(windows) {
        return None;
    }
    let wanted = webview2_args(choice(app));
    lock(started())
        .entry(server_id.to_string())
        .or_insert(wanted)
        .clone()
}

/// A window open since before the last change still uses the old language.
fn restart_needed(current: Option<&str>) -> bool {
    if !cfg!(windows) {
        return false;
    }
    let wanted = webview2_args(current);
    lock(started()).values().any(|args| *args != wanted)
}

/// Turns spell checking on in a server window's web context, in the
/// current language. Linux only; windows of one server share the context.
#[cfg(target_os = "linux")]
pub fn apply(app: &AppHandle, window: &tauri::WebviewWindow) {
    let languages = webkit_languages(&effective(choice(app), system_locale().as_deref()));
    let result = window.with_webview(move |webview| {
        use webkit2gtk::{WebContextExt, WebViewExt};
        let Some(context) = webview.inner().context() else {
            return;
        };
        let languages: Vec<&str> = languages.iter().map(String::as_str).collect();
        context.set_spell_checking_enabled(true);
        context.set_spell_checking_languages(&languages);
    });
    if let Err(error) = result {
        log::warn!("could not set the spell-check language: {error}");
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellcheckSettings {
    /// "system" or one of `languages`.
    language: String,
    languages: Vec<&'static str>,
    /// The system locale's tag, for "follow the system" in the launcher.
    system_language: Option<String>,
    /// False on macOS, where the system's spelling settings apply.
    supported: bool,
    /// A window opened before the last change keeps the old language until
    /// Margaya restarts (Windows).
    restart_needed: bool,
}

fn view(choice: Option<&str>) -> SpellcheckSettings {
    SpellcheckSettings {
        language: choice.unwrap_or(SYSTEM).to_string(),
        languages: LANGUAGES.to_vec(),
        system_language: system_locale(),
        supported: cfg!(any(windows, target_os = "linux")),
        restart_needed: restart_needed(choice),
    }
}

#[tauri::command]
pub fn get_spellcheck(app: AppHandle) -> SpellcheckSettings {
    view(choice(&app))
}

#[tauri::command]
pub fn set_spellcheck(app: AppHandle, language: String) -> AppResult<SpellcheckSettings> {
    let next = if language == SYSTEM {
        None
    } else {
        Some(parse_language(&language).ok_or_else(|| AppError::internal("unknown language"))?)
    };
    let path = path(&app).ok_or_else(|| AppError::internal("no config folder"))?;
    save(&path, next)?;
    *lock(&CHOICE) = Some(next);
    log::info!("spell-check language set to {}", next.unwrap_or(SYSTEM));
    #[cfg(target_os = "linux")]
    for (label, window) in app.webview_windows() {
        if crate::servers::parse_window_label(&label).is_some_and(|kind| {
            matches!(
                kind,
                crate::servers::WindowKind::Primary(_) | crate::servers::WindowKind::Secondary(..)
            )
        }) {
            apply(&app, &window);
        }
    }
    Ok(view(next))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_every_app_language() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../i18n");
        let mut files: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                let locale = name.strip_suffix(".json")?.to_string();
                (locale.len() == 5 && locale.as_bytes()[2] == b'-').then_some(locale)
            })
            .collect();
        files.sort();
        assert_eq!(files, LANGUAGES);
    }

    #[test]
    fn accepts_only_app_languages() {
        assert_eq!(parse_language("de-DE"), Some("de-DE"));
        for bad in ["", "system", "de", "de-de", "xx-XX", "de-DE --lang=x"] {
            assert_eq!(parse_language(bad), None, "{bad}");
        }
    }

    #[test]
    fn follows_the_choice_then_the_system() {
        assert_eq!(effective(Some("fr-FR"), Some("de-DE")), "fr-FR");
        assert_eq!(effective(None, Some("pt-PT")), "pt-PT");
        assert_eq!(effective(None, Some(" ")), "en-US");
        assert_eq!(effective(None, None), "en-US");
    }

    #[test]
    fn names_webkit_dictionaries() {
        assert_eq!(webkit_languages("de-DE"), ["de_DE", "de"]);
        assert_eq!(webkit_languages("pt_br.UTF-8@x"), ["pt_BR", "pt"]);
        assert_eq!(webkit_languages("ja"), ["ja"]);
        assert_eq!(webkit_languages(""), ["en_US", "en"]);
    }

    #[test]
    fn passes_webview2_arguments_only_for_a_choice() {
        assert_eq!(webview2_args(None), None);
        let args = webview2_args(Some("de-DE")).unwrap();
        // wry's defaults stay, since any arguments replace them.
        assert!(args.starts_with(WEBVIEW2_DEFAULT_ARGS));
        assert!(args.ends_with(" --lang=de-DE --accept-lang=de-DE,de"));
    }

    #[test]
    fn stores_the_choice() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("nested").join(FILE);
        assert_eq!(load(&file), None);
        save(&file, Some("ja-JP")).unwrap();
        assert_eq!(load(&file), Some("ja-JP"));
        save(&file, None).unwrap();
        assert_eq!(load(&file), None);
        // A hand-edited file can't smuggle in another argument.
        std::fs::write(&file, r#"{ "language": "de-DE --x" }"#).unwrap();
        assert_eq!(load(&file), None);
    }
}
