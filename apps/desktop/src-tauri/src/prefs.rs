//! The app's own preferences: an ordinary JSON file (`preferences.json`) in
//! the app's config directory, next to `servers.json`. Secrets never go here.
//!
//! Fields this version doesn't know are kept as they are, so an older and a
//! newer copy of the app can share the file without losing each other's
//! settings.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::state::lock;

pub const FILE_NAME: &str = "preferences.json";

/// Where update checks look for new versions.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateChannel {
    #[default]
    Stable,
    Beta,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    /// Keyboard shortcut overrides by action id. A missing action uses its
    /// default; an empty string means the person cleared it.
    #[serde(default)]
    pub shortcuts: BTreeMap<String, String>,
    /// A launch by the login item stays in the tray without opening windows.
    #[serde(default = "default_true")]
    pub start_minimized: bool,
    #[serde(default)]
    pub update_channel: UpdateChannel,
    /// The version whose "What's new" the person has seen (or the version
    /// first installed). None until the first start with this field.
    #[serde(default)]
    pub last_seen_version: Option<String>,
    /// "Pause notifications" (pause.rs); none when they aren't paused.
    #[serde(default)]
    pub notification_pause: Option<crate::pause::NotificationPause>,
    #[serde(flatten)]
    pub other: serde_json::Map<String, serde_json::Value>,
}

fn default_true() -> bool {
    true
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            shortcuts: BTreeMap::new(),
            // Like before this setting existed: the login item starts in the
            // tray.
            start_minimized: true,
            update_channel: UpdateChannel::Stable,
            last_seen_version: None,
            notification_pause: None,
            other: serde_json::Map::new(),
        }
    }
}

#[derive(Debug)]
pub struct PrefsStore {
    path: PathBuf,
    prefs: Prefs,
}

impl PrefsStore {
    /// Loads the file; a missing one starts with defaults, an unreadable one
    /// is kept aside rather than overwritten.
    pub fn load(path: PathBuf) -> Self {
        let prefs = match fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str::<Prefs>(&text).unwrap_or_else(|error| {
                log::warn!("preferences unreadable ({error}); using defaults");
                let _ = fs::rename(&path, path.with_extension("json.broken"));
                Prefs::default()
            }),
            Err(_) => Prefs::default(),
        };
        Self { path, prefs }
    }

    pub fn get(&self) -> &Prefs {
        &self.prefs
    }

    /// Changes the preferences and writes them; nothing is written when the
    /// change leaves them as they were.
    pub fn update<T>(&mut self, change: impl FnOnce(&mut Prefs) -> T) -> AppResult<T> {
        let before = self.prefs.clone();
        let result = change(&mut self.prefs);
        if self.prefs != before {
            if let Err(error) = self.save() {
                self.prefs = before;
                return Err(error);
            }
        }
        Ok(result)
    }

    fn save(&self) -> AppResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(AppError::internal)?;
        }
        let text = serde_json::to_string_pretty(&self.prefs).map_err(AppError::internal)?;
        // Write then rename, so a crash never leaves half a file.
        let temp = self.path.with_extension("json.tmp");
        fs::write(&temp, text).map_err(AppError::internal)?;
        fs::rename(&temp, &self.path).map_err(AppError::internal)
    }
}

/// Managed state: the store behind a mutex.
pub struct PrefsState(pub Mutex<PrefsStore>);

/// Loads the preferences and hands them to Tauri's state. Call once in setup.
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let dir = app.path().app_config_dir()?;
    app.manage(PrefsState(Mutex::new(PrefsStore::load(
        dir.join(FILE_NAME),
    ))));
    Ok(())
}

/// A copy of the current preferences (defaults before [`init`]).
pub fn get(app: &AppHandle) -> Prefs {
    app.try_state::<PrefsState>()
        .map(|state| lock(&state.0).get().clone())
        .unwrap_or_default()
}

pub fn update<T>(app: &AppHandle, change: impl FnOnce(&mut Prefs) -> T) -> AppResult<T> {
    let state = app
        .try_state::<PrefsState>()
        .ok_or_else(|| AppError::internal("preferences not loaded"))?;
    let mut store = lock(&state.0);
    store.update(change)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_fields_it_does_not_know_and_defaults_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        fs::write(&path, r#"{"spellCheck":false,"updateChannel":"beta"}"#).unwrap();
        let mut store = PrefsStore::load(path.clone());
        assert_eq!(store.get().update_channel, UpdateChannel::Beta);
        assert!(store.get().start_minimized);
        store
            .update(|prefs| {
                prefs
                    .shortcuts
                    .insert("search".into(), "Control+Alt+KeyF".into())
            })
            .unwrap();
        let saved: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved["spellCheck"], false);
        assert_eq!(saved["shortcuts"]["search"], "Control+Alt+KeyF");
        assert_eq!(saved["updateChannel"], "beta");
    }

    #[test]
    fn an_unreadable_file_is_kept_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        fs::write(&path, "{not json").unwrap();
        let store = PrefsStore::load(path.clone());
        assert_eq!(store.get(), &Prefs::default());
        assert!(path.with_extension("json.broken").exists());
    }
}
