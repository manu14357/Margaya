//! Global keyboard shortcuts: the actions they run, their defaults, the
//! person's own combinations (kept in preferences.json), and their
//! registration with the operating system.
//!
//! Another app may already hold a combination; that never stops Margaya from
//! starting. The action just has no shortcut until the person picks another.

use std::collections::HashMap;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState,
};

use crate::error::{AppError, AppResult, ErrorKind};
use crate::state::lock;
use crate::{capture, menus, prefs, search_window, today_window, windows};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    QuickAdd,
    Search,
    Screenshot,
    Today,
}

impl Action {
    pub const ALL: [Action; 4] = [
        Action::QuickAdd,
        Action::Search,
        Action::Screenshot,
        Action::Today,
    ];

    /// The key in preferences.json and in the launcher.
    pub fn id(self) -> &'static str {
        match self {
            Action::QuickAdd => "quickAdd",
            Action::Search => "search",
            Action::Screenshot => "screenshot",
            Action::Today => "today",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|action| action.id() == id)
    }

    pub fn default_accelerator(self) -> Option<&'static str> {
        match self {
            Action::QuickAdd => Some("CommandOrControl+Shift+Space"),
            Action::Search => Some("CommandOrControl+Shift+K"),
            Action::Screenshot => Some("CommandOrControl+Shift+Alt+S"),
            Action::Today => None,
        }
    }
}

/// The combination an action uses: the person's own, none when they cleared
/// it, else the default.
pub fn effective(
    overrides: &std::collections::BTreeMap<String, String>,
    action: Action,
) -> Option<String> {
    match overrides.get(action.id()) {
        Some(value) if value.is_empty() => None,
        Some(value) => Some(value.clone()),
        None => action.default_accelerator().map(str::to_string),
    }
}

/// Why a combination can't be a global shortcut.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Invalid {
    /// Not a combination the shortcut library understands.
    Unparsable,
    /// Needs Ctrl, Alt or Cmd/Win: a plain key (or Shift + key) would fire
    /// while typing anywhere.
    NoModifier,
    /// Used by the operating system or by almost every app.
    Reserved,
}

impl From<Invalid> for AppError {
    fn from(invalid: Invalid) -> Self {
        match invalid {
            Invalid::Unparsable => AppError::new(ErrorKind::ShortcutInvalid, "unparsable shortcut"),
            Invalid::NoModifier => {
                AppError::new(ErrorKind::ShortcutNoModifier, "shortcut without a modifier")
            }
            Invalid::Reserved => AppError::new(ErrorKind::ShortcutReserved, "reserved shortcut"),
        }
    }
}

fn is_modifier_key(code: Code) -> bool {
    matches!(
        code,
        Code::ShiftLeft
            | Code::ShiftRight
            | Code::ControlLeft
            | Code::ControlRight
            | Code::AltLeft
            | Code::AltRight
            | Code::MetaLeft
            | Code::MetaRight
            | Code::Fn
            | Code::FnLock
            | Code::CapsLock
            | Code::NumLock
            | Code::ScrollLock
    )
}

/// Keys apps and the system bind to Ctrl/Cmd/Alt + key: letters, digits,
/// editing and navigation keys.
fn is_common_key(code: Code) -> bool {
    let name = code.to_string();
    name.starts_with("Key")
        || name.starts_with("Digit")
        || name.starts_with("Arrow")
        || matches!(
            code,
            Code::Tab
                | Code::Enter
                | Code::Space
                | Code::Backspace
                | Code::Delete
                | Code::Escape
                | Code::Insert
                | Code::Home
                | Code::End
                | Code::PageUp
                | Code::PageDown
                | Code::F4
                | Code::Comma
                | Code::Period
                | Code::Slash
                | Code::Minus
                | Code::Equal
                | Code::Backquote
        )
}

const C: Modifiers = Modifiers::CONTROL;
const A: Modifiers = Modifiers::ALT;
const S: Modifiers = Modifiers::SHIFT;
const W: Modifiers = Modifiers::SUPER;

/// Combinations operating systems keep for themselves (window switching,
/// screenshots, lock, log out, force quit, terminals, workspaces).
fn is_system_combination(mods: Modifiers, code: Code) -> bool {
    const LIST: &[(Modifiers, Code)] = &[
        (C.union(A), Code::Delete),
        (C.union(S), Code::Escape),
        (A.union(S), Code::Tab),
        (C.union(A), Code::KeyT),
        (C.union(A), Code::KeyL),
        (C.union(A), Code::ArrowLeft),
        (C.union(A), Code::ArrowRight),
        (C.union(A), Code::ArrowUp),
        (C.union(A), Code::ArrowDown),
        (W.union(S), Code::KeyS),
        (W.union(S), Code::Digit3),
        (W.union(S), Code::Digit4),
        (W.union(S), Code::Digit5),
        (W.union(S), Code::KeyQ),
        (W.union(A), Code::Escape),
        (W.union(A), Code::KeyD),
        (C.union(W), Code::KeyQ),
        (C.union(W), Code::KeyF),
        (C.union(W), Code::Space),
        (W.union(S), Code::ArrowLeft),
        (W.union(S), Code::ArrowRight),
    ];
    LIST.iter()
        .any(|(listed, key)| *listed == mods && *key == code)
}

/// Checks a combination the person recorded and returns it parsed.
pub fn validate(accelerator: &str) -> Result<Shortcut, Invalid> {
    let accelerator = accelerator.trim();
    if accelerator.is_empty() || accelerator.len() > 64 {
        return Err(Invalid::Unparsable);
    }
    let shortcut = Shortcut::from_str(accelerator).map_err(|_| Invalid::Unparsable)?;
    if is_modifier_key(shortcut.key) {
        return Err(Invalid::Unparsable);
    }
    let mods = shortcut.mods & (C | A | S | W);
    if !mods.intersects(C | A | W) {
        return Err(Invalid::NoModifier);
    }
    // One modifier plus a letter, digit or editing key is an app's own
    // shortcut (copy, paste, save, menus) or the system's (Win/Cmd + key).
    let single = mods == C || mods == A || mods == W;
    if single && is_common_key(shortcut.key) {
        return Err(Invalid::Reserved);
    }
    if is_system_combination(mods, shortcut.key) {
        return Err(Invalid::Reserved);
    }
    Ok(shortcut)
}

/// The stored form of a combination: modifiers in a fixed order, then the
/// key's code ("Control+Alt+KeyK").
pub fn canonical(shortcut: &Shortcut) -> String {
    let mut parts: Vec<String> = Vec::new();
    for (flag, name) in [(C, "Control"), (A, "Alt"), (S, "Shift"), (W, "Super")] {
        if shortcut.mods.contains(flag) {
            parts.push(name.to_string());
        }
    }
    parts.push(shortcut.key.to_string());
    parts.join("+")
}

/// The action an active shortcut runs.
pub fn action_for(active: &HashMap<Action, Shortcut>, id: u32) -> Option<Action> {
    active
        .iter()
        .find(|(_, shortcut)| shortcut.id() == id)
        .map(|(action, _)| *action)
}

#[derive(Default)]
struct Registry {
    /// The shortcuts this app holds now, by action.
    active: Mutex<HashMap<Action, Shortcut>>,
    /// Held while shortcuts change, so two changes never interleave. Never
    /// taken by the key handler, which runs on the main thread that
    /// registration waits for.
    changing: Mutex<()>,
    /// Counts pause and resume requests, so an old pause's time limit
    /// doesn't undo a newer one.
    pauses: AtomicU64,
}

/// Registers the shortcuts at startup. Call once in setup.
pub fn init(app: &AppHandle) {
    app.manage(Registry::default());
    let overrides = prefs::get(app).shortcuts;
    let config: HashMap<Action, Option<String>> = Action::ALL
        .into_iter()
        .map(|action| (action, effective(&overrides, action)))
        .collect();
    let failed = register(app, &config);
    for action in failed {
        log::warn!(
            "the {} shortcut is unavailable (another app may hold it); use the tray instead",
            action.id()
        );
    }
}

fn registry(app: &AppHandle) -> Option<tauri::State<'_, Registry>> {
    app.try_state::<Registry>()
}

/// Lets go of every shortcut this app holds.
fn release_all(app: &AppHandle) {
    let Some(registry) = registry(app) else {
        return;
    };
    let held: Vec<Shortcut> = lock(&registry.active).drain().map(|(_, s)| s).collect();
    for shortcut in held {
        if let Err(error) = app.global_shortcut().unregister(shortcut) {
            log::warn!("could not release a shortcut: {error}");
        }
    }
}

/// Registers `config` (after releasing what is held) and returns the
/// actions whose combination the system refused.
fn register(app: &AppHandle, config: &HashMap<Action, Option<String>>) -> Vec<Action> {
    release_all(app);
    let mut active = HashMap::new();
    let mut failed = Vec::new();
    for action in Action::ALL {
        let Some(Some(accelerator)) = config.get(&action) else {
            continue;
        };
        let Ok(shortcut) = Shortcut::from_str(accelerator) else {
            failed.push(action);
            continue;
        };
        match app.global_shortcut().register(shortcut) {
            Ok(()) => {
                active.insert(action, shortcut);
            }
            Err(_) => failed.push(action),
        }
    }
    if let Some(registry) = registry(app) {
        *lock(&registry.active) = active;
    }
    failed
}

/// The plugin's handler: runs the action behind the pressed shortcut.
pub fn handle(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let action =
        registry(app).and_then(|registry| action_for(&lock(&registry.active), shortcut.id()));
    if let Some(action) = action {
        run(app, action);
    }
}

/// Runs an action from a shortcut, the tray, the jump list or a launch
/// argument. Main-thread callers are fine: window work goes through
/// `windows::spawn_ui`.
pub fn run(app: &AppHandle, action: Action) {
    match action {
        Action::QuickAdd => windows::spawn_ui(app, |app| {
            if let Err(error) = windows::show_quick_add(app, None) {
                log::warn!("quick add failed to open: {}", error.message);
            }
        }),
        Action::Search => windows::spawn_ui(app, search_window::show),
        Action::Screenshot => windows::spawn_ui(app, capture::start_screenshot),
        Action::Today => windows::spawn_ui(app, today_window::toggle),
    }
}

/// The combination to show next to an action in menus, if it is active.
pub fn menu_accelerator(app: &AppHandle, action: Action) -> Option<String> {
    let registry = registry(app)?;
    let active = lock(&registry.active);
    active.get(&action).map(canonical)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutView {
    action: Action,
    /// The combination in use, or none (cleared, or never set).
    accelerator: Option<String>,
    default_accelerator: Option<&'static str>,
    /// False when the system refused the combination (another app holds it).
    active: bool,
}

fn views(app: &AppHandle) -> Vec<ShortcutView> {
    let overrides = prefs::get(app).shortcuts;
    let active = registry(app)
        .map(|registry| lock(&registry.active).clone())
        .unwrap_or_default();
    Action::ALL
        .into_iter()
        .map(|action| ShortcutView {
            action,
            accelerator: effective(&overrides, action),
            default_accelerator: action.default_accelerator(),
            active: active.contains_key(&action),
        })
        .collect()
}

/// What the person asks for one action.
enum Change {
    Set(Shortcut),
    Clear,
    Reset,
}

fn change(app: &AppHandle, action: Action, change: Change) -> AppResult<Vec<ShortcutView>> {
    let registry = registry(app).ok_or_else(|| AppError::internal("shortcuts not ready"))?;
    let _changing = lock(&registry.changing);
    let overrides = prefs::get(app).shortcuts;
    let wanted: Option<String> = match &change {
        Change::Set(shortcut) => Some(canonical(shortcut)),
        Change::Clear => None,
        Change::Reset => action.default_accelerator().map(str::to_string),
    };
    // Two actions can't share a combination.
    if let Some(wanted) = wanted
        .as_deref()
        .and_then(|value| Shortcut::from_str(value).ok())
    {
        let taken_here = Action::ALL
            .into_iter()
            .filter(|other| *other != action)
            .filter_map(|other| effective(&overrides, other))
            .filter_map(|value| Shortcut::from_str(&value).ok())
            .any(|other| other.id() == wanted.id());
        if taken_here {
            return Err(AppError::new(
                ErrorKind::ShortcutInUse,
                "used by another action",
            ));
        }
    }
    let mut config: HashMap<Action, Option<String>> = Action::ALL
        .into_iter()
        .map(|other| (other, effective(&overrides, other)))
        .collect();
    let previous = config.insert(action, wanted.clone()).flatten();
    let failed = register(app, &config);
    if wanted.is_some() && failed.contains(&action) {
        // The system refused it: keep the previous combination.
        config.insert(action, previous);
        register(app, &config);
        return Err(AppError::new(
            ErrorKind::ShortcutTaken,
            "the system refused the shortcut",
        ));
    }
    prefs::update(app, |prefs| match change {
        Change::Reset => {
            prefs.shortcuts.remove(action.id());
        }
        _ => {
            prefs
                .shortcuts
                .insert(action.id().to_string(), wanted.unwrap_or_default());
        }
    })?;
    menus::refresh_tray(app);
    Ok(views(app))
}

#[tauri::command]
pub fn get_shortcuts(app: AppHandle) -> Vec<ShortcutView> {
    views(&app)
}

fn parse_action(action: &str) -> AppResult<Action> {
    Action::from_id(action)
        .ok_or_else(|| AppError::new(ErrorKind::ShortcutInvalid, "unknown action"))
}

/// Sets an action's combination; `None` clears it. Async: registration
/// waits for the main thread.
#[tauri::command]
pub async fn set_shortcut(
    app: AppHandle,
    action: String,
    accelerator: Option<String>,
) -> AppResult<Vec<ShortcutView>> {
    let action = parse_action(&action)?;
    match accelerator {
        Some(accelerator) => change(&app, action, Change::Set(validate(&accelerator)?)),
        None => change(&app, action, Change::Clear),
    }
}

#[tauri::command]
pub async fn reset_shortcut(app: AppHandle, action: String) -> AppResult<Vec<ShortcutView>> {
    change(&app, parse_action(&action)?, Change::Reset)
}

/// How long the shortcuts stay released for the recorder at most, in case
/// the launcher never takes them back (its window hidden mid-recording).
const PAUSE_LIMIT: std::time::Duration = std::time::Duration::from_secs(60);

fn set_paused(app: &AppHandle, paused: bool, generation: Option<u64>) {
    let Some(registry) = registry(app) else {
        return;
    };
    let _changing = lock(&registry.changing);
    // A timer only resumes the pause it was started for.
    if generation.is_some_and(|generation| generation != registry.pauses.load(Ordering::Relaxed)) {
        return;
    }
    if paused {
        release_all(app);
    } else {
        let overrides = prefs::get(app).shortcuts;
        let config = Action::ALL
            .into_iter()
            .map(|action| (action, effective(&overrides, action)))
            .collect();
        register(app, &config);
    }
}

/// Lets go of every shortcut while the launcher records a new one, so the
/// keys reach the recorder; `false` takes them back.
#[tauri::command]
pub async fn pause_shortcuts(app: AppHandle, paused: bool) -> Vec<ShortcutView> {
    let generation =
        registry(&app).map(|registry| registry.pauses.fetch_add(1, Ordering::Relaxed) + 1);
    set_paused(&app, paused, None);
    if let (true, Some(generation)) = (paused, generation) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(PAUSE_LIMIT).await;
            set_paused(&app, false, Some(generation));
        });
    }
    views(&app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn defaults_are_valid_and_distinct() {
        let mut ids = Vec::new();
        for action in Action::ALL {
            assert_eq!(Action::from_id(action.id()), Some(action));
            if let Some(default) = action.default_accelerator() {
                let shortcut = validate(default)
                    .unwrap_or_else(|error| panic!("default {default} is invalid: {error:?}"));
                ids.push(shortcut.id());
            }
        }
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), count);
        assert_eq!(Action::from_id("nope"), None);
    }

    #[test]
    fn requires_a_modifier() {
        assert_eq!(validate("K").unwrap_err(), Invalid::NoModifier);
        assert_eq!(validate("Shift+KeyK").unwrap_err(), Invalid::NoModifier);
        assert_eq!(validate("F5").unwrap_err(), Invalid::NoModifier);
        assert!(validate("Control+Shift+KeyK").is_ok());
        assert!(validate("Alt+Shift+KeyN").is_ok());
        assert!(validate("Control+F9").is_ok());
    }

    #[test]
    fn rejects_reserved_and_broken_combinations() {
        for reserved in [
            "Control+KeyC",
            "Control+KeyV",
            "CommandOrControl+KeyS",
            "Alt+F4",
            "Alt+Tab",
            "Alt+Space",
            "Super+KeyL",
            "Super+KeyD",
            "Control+Alt+Delete",
            "Control+Shift+Escape",
            "Super+Shift+KeyS",
            "Super+Shift+Digit4",
            "Control+Alt+KeyT",
        ] {
            assert_eq!(
                validate(reserved).unwrap_err(),
                Invalid::Reserved,
                "{reserved}"
            );
        }
        for broken in [
            "",
            "Control+",
            "Control+Shift",
            "Control+Nope",
            "Control+KeyA+KeyB",
        ] {
            assert_eq!(
                validate(broken).unwrap_err(),
                Invalid::Unparsable,
                "{broken:?}"
            );
        }
    }

    #[test]
    fn stores_combinations_in_one_order() {
        let shortcut = validate("shift+alt+ctrl+k").unwrap();
        assert_eq!(canonical(&shortcut), "Control+Alt+Shift+KeyK");
        let again = validate(&canonical(&shortcut)).unwrap();
        assert_eq!(again.id(), shortcut.id());
        assert_eq!(
            canonical(&validate("Control+Shift+Space").unwrap()),
            "Control+Shift+Space"
        );
    }

    #[test]
    fn overrides_win_over_defaults_and_empty_clears() {
        let mut overrides = BTreeMap::new();
        assert_eq!(
            effective(&overrides, Action::QuickAdd).as_deref(),
            Some("CommandOrControl+Shift+Space")
        );
        assert_eq!(effective(&overrides, Action::Today), None);
        overrides.insert("quickAdd".to_string(), String::new());
        overrides.insert("today".to_string(), "Control+Alt+KeyY".to_string());
        assert_eq!(effective(&overrides, Action::QuickAdd), None);
        assert_eq!(
            effective(&overrides, Action::Today).as_deref(),
            Some("Control+Alt+KeyY")
        );
    }

    #[test]
    fn finds_the_action_behind_a_pressed_shortcut() {
        let search = validate("Control+Shift+KeyK").unwrap();
        let today = validate("Control+Alt+KeyY").unwrap();
        let active = HashMap::from([(Action::Search, search), (Action::Today, today)]);
        assert_eq!(action_for(&active, today.id()), Some(Action::Today));
        assert_eq!(action_for(&active, search.id()), Some(Action::Search));
        assert_eq!(
            action_for(&active, validate("Control+Alt+KeyZ").unwrap().id()),
            None
        );
    }
}
