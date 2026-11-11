//! Opening links outside the app (system browser, mail app). Every open runs
//! on its own short-lived thread: the shell call can block or pump messages
//! (for example while Windows asks which app to use), and doing that on the
//! UI thread, or inside a WebView2 callback, froze the app.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use url::Url;

use crate::state::{lock, AppState};

/// The same link from the same place within this window is a double click
/// or a click handled twice (window.open plus the anchor), not a second ask.
pub const REPEAT_WINDOW: Duration = Duration::from_secs(1);
/// No page gets to open more than this many outside links in [`BUDGET_WINDOW`]:
/// a hostile or broken page can't flood the browser.
pub const BUDGET: usize = 5;
pub const BUDGET_WINDOW: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admission {
    Open,
    /// The same link from the same scope within [`REPEAT_WINDOW`].
    Repeat,
    /// More than [`BUDGET`] opens from this scope within [`BUDGET_WINDOW`].
    OverBudget,
}

/// Recently opened links, by scope (a server id, or "app").
#[derive(Debug, Default)]
pub struct RecentOpens {
    recent: VecDeque<(String, String, Instant)>,
}

impl RecentOpens {
    pub fn admit(&mut self, scope: &str, url: &str, now: Instant) -> Admission {
        self.recent
            .retain(|(_, _, at)| now.saturating_duration_since(*at) < BUDGET_WINDOW);
        let mine = || self.recent.iter().filter(|(known, _, _)| known == scope);
        if mine().any(|(_, known_url, at)| {
            known_url == url && now.saturating_duration_since(*at) < REPEAT_WINDOW
        }) {
            return Admission::Repeat;
        }
        if mine().count() >= BUDGET {
            return Admission::OverBudget;
        }
        self.recent
            .push_back((scope.to_string(), url.to_string(), now));
        Admission::Open
    }
}

/// Schemes that may leave the app: web pages, mail and phone links.
pub fn may_open_outside(url: &Url) -> bool {
    match url.scheme() {
        "http" | "https" => url.host_str().is_some(),
        "mailto" | "tel" => true,
        _ => false,
    }
}

/// What the log says about a link: scheme and host only, never the path or
/// query (sign-in links carry a state value).
pub fn describe(url: &Url) -> String {
    match url.host_str() {
        Some(host) => format!("{}://{host}", url.scheme()),
        None => url.scheme().to_string(),
    }
}

/// Opens `url` outside the app on a separate thread. Repeats of the same link
/// from the same scope within a second are dropped.
pub fn open_outside(app: &AppHandle, scope: &str, url: &Url) {
    if !may_open_outside(url) {
        log::warn!("refused to open a {} link outside the app", url.scheme());
        return;
    }
    let what = describe(url);
    if let Some(state) = app.try_state::<AppState>() {
        match lock(&state.opens).admit(scope, url.as_str(), Instant::now()) {
            Admission::Open => {}
            Admission::Repeat => {
                log::info!("ignored a repeated open of {what}");
                return;
            }
            Admission::OverBudget => {
                log::warn!("dropped an open of {what}: too many outside opens from one page");
                return;
            }
        }
    }
    let url = url.to_string();
    let spawned = std::thread::Builder::new()
        .name("open-outside".into())
        .spawn(move || {
            let started = Instant::now();
            log::info!("opening {what} outside the app");
            match platform_open(&url) {
                Ok(()) => log::info!(
                    "opened {what} outside the app in {} ms",
                    started.elapsed().as_millis()
                ),
                Err(error) => log::warn!(
                    "could not open {what} outside the app after {} ms: {error}",
                    started.elapsed().as_millis()
                ),
            }
        });
    if let Err(error) = spawned {
        log::warn!("could not start a thread to open a link: {error}");
    }
}

/// Test builds (`--features e2e`) never start a browser: they append the link
/// to the file named by `MARGAYA_E2E_OPEN_LOG`, after an optional
/// `MARGAYA_E2E_OPEN_DELAY_MS` pause that stands in for a slow shell.
#[cfg(feature = "e2e")]
fn platform_open(url: &str) -> Result<(), String> {
    use std::io::Write;
    if let Some(delay) = std::env::var("MARGAYA_E2E_OPEN_DELAY_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
    {
        std::thread::sleep(Duration::from_millis(delay.min(30_000)));
    }
    let path = std::env::var_os("MARGAYA_E2E_OPEN_LOG")
        .ok_or_else(|| "MARGAYA_E2E_OPEN_LOG is not set".to_string())?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{url}").map_err(|error| error.to_string())
}

#[cfg(all(not(feature = "e2e"), windows))]
fn platform_open(url: &str) -> Result<(), String> {
    use ::windows::core::{w, PCWSTR};
    use ::windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use ::windows::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW,
    };
    use ::windows::Win32::UI::WindowsAndMessaging::{AllowSetForegroundWindow, ASFW_ANY};

    let wide: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: plain Win32 calls on this thread; `wide` outlives ShellExecuteExW,
    // and COM is uninitialised only when this thread initialised it.
    unsafe {
        // The shell needs COM on the calling thread; OLE1 DDE off is what
        // Microsoft recommends for ShellExecute.
        let com = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        // The click was received by the webview's process, so let whichever
        // app handles the link come to the front.
        let _ = AllowSetForegroundWindow(ASFW_ANY);
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
            lpVerb: w!("open"),
            lpFile: PCWSTR(wide.as_ptr()),
            nShow: 1, // SW_SHOWNORMAL
            ..Default::default()
        };
        let result = ShellExecuteExW(&mut info).map_err(|error| error.to_string());
        if com.is_ok() {
            CoUninitialize();
        }
        result
    }
}

#[cfg(all(not(feature = "e2e"), not(windows)))]
fn platform_open(url: &str) -> Result<(), String> {
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    use Admission::{Open, OverBudget, Repeat};

    #[test]
    fn drops_repeats_within_a_second_per_scope() {
        let start = Instant::now();
        let ms = |n: u64| start + Duration::from_millis(n);
        let mut opens = RecentOpens::default();
        assert_eq!(opens.admit("a", "https://example.com/docs", start), Open);
        // window.open plus the anchor's own click, a moment apart.
        assert_eq!(opens.admit("a", "https://example.com/docs", ms(40)), Repeat);
        // Another link, or the same link from another server, still opens.
        assert_eq!(opens.admit("a", "https://example.com/other", start), Open);
        assert_eq!(opens.admit("b", "https://example.com/docs", start), Open);
        // A second later it is a new request.
        assert_eq!(opens.admit("a", "https://example.com/docs", ms(1000)), Open);
        assert_eq!(opens.admit("a", "https://example.com/docs", ms(1500)), Repeat);
    }

    #[test]
    fn caps_opens_per_scope_in_ten_seconds() {
        let start = Instant::now();
        let at = |n: u64| start + Duration::from_millis(n);
        let mut opens = RecentOpens::default();
        for n in 0..BUDGET as u64 {
            assert_eq!(opens.admit("a", &format!("https://example.com/{n}"), at(n * 100)), Open);
        }
        assert_eq!(opens.admit("a", "https://example.com/6", at(600)), OverBudget);
        // Other pages have their own budget.
        assert_eq!(opens.admit("b", "https://example.com/6", at(600)), Open);
        // Ten seconds after the first, room opens up again, one at a time.
        assert_eq!(opens.admit("a", "https://example.com/7", at(9_999)), OverBudget);
        assert_eq!(opens.admit("a", "https://example.com/7", at(10_000)), Open);
        assert_eq!(opens.admit("a", "https://example.com/8", at(10_050)), OverBudget);
    }

    #[test]
    fn forgets_old_entries() {
        let start = Instant::now();
        let mut opens = RecentOpens::default();
        for n in 0..3 {
            opens.admit("a", &format!("https://example.com/{n}"), start);
        }
        assert_eq!(opens.admit("a", "https://example.com/new", start + BUDGET_WINDOW), Open);
        assert_eq!(opens.recent.len(), 1);
    }

    #[test]
    fn opens_only_web_mail_and_phone_links() {
        let url = |raw: &str| Url::parse(raw).unwrap();
        assert!(may_open_outside(&url("https://example.com/docs")));
        assert!(may_open_outside(&url("http://localhost:3001/docs")));
        assert!(may_open_outside(&url("mailto:someone@example.com")));
        assert!(may_open_outside(&url("tel:+15550100")));
        assert!(!may_open_outside(&url("file:///C:/Windows/System32/calc.exe")));
        assert!(!may_open_outside(&url("ms-settings:privacy")));
        assert!(!may_open_outside(&url("javascript:alert(1)")));
        assert!(!may_open_outside(&url("data:text/html,hi")));
    }

    #[test]
    fn logs_only_scheme_and_host() {
        let url = Url::parse("https://api.example/api/auth/desktop/sign-in?state=secret").unwrap();
        assert_eq!(describe(&url), "https://api.example");
        assert_eq!(describe(&Url::parse("mailto:a@example.com").unwrap()), "mailto");
    }
}
