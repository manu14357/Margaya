//! The custom title bar. On Windows and Linux server windows have no native
//! frame and the web app draws the window controls in its own top bar; on
//! macOS the title bar is an overlay with the traffic lights centred in that
//! bar. A web
//! UI that never says it draws a title bar (an older server, the offline
//! page, a file shown in its own window) gets the native frame back.

use serde::Serialize;

/// The web app's top bar is 48 px high (`h-12`).
pub const WEB_TOP_BAR_HEIGHT: f64 = 48.0;
/// macOS traffic lights: 14 px high, about 54 px wide from the left edge.
pub const TRAFFIC_LIGHTS_X: f64 = 16.0;
pub const TRAFFIC_LIGHTS_HEIGHT: f64 = 14.0;
/// Space the web app keeps free for the traffic lights.
pub const MACOS_LEFT_INSET: u32 = 80;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleBar {
    pub style: &'static str,
    pub platform: &'static str,
    pub left_inset: u32,
    pub right_inset: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Windows,
    MacOs,
    Linux,
    Other,
}

pub fn current_os() -> Os {
    if cfg!(windows) {
        Os::Windows
    } else if cfg!(target_os = "macos") {
        Os::MacOs
    } else if cfg!(target_os = "linux") {
        Os::Linux
    } else {
        Os::Other
    }
}

/// The title bar the server windows use on `os`; None keeps the native frame
/// (the BSDs, where the app is only built for tests).
pub fn title_bar_for(os: Os) -> Option<TitleBar> {
    match os {
        // The web app draws minimize, maximize and close at the far right.
        Os::Windows => Some(TitleBar {
            style: "custom",
            platform: "windows",
            left_inset: 0,
            right_inset: 0,
        }),
        // Like Windows, without a frame: the web app draws the buttons at the
        // right, in a GNOME-like style. The window manager's own button
        // layout isn't followed; Tauri adds resize borders.
        Os::Linux => Some(TitleBar {
            style: "custom",
            platform: "linux",
            left_inset: 0,
            right_inset: 0,
        }),
        // macOS draws its own traffic lights; the web app leaves room for them.
        Os::MacOs => Some(TitleBar {
            style: "custom",
            platform: "macos",
            left_inset: MACOS_LEFT_INSET,
            right_inset: 0,
        }),
        Os::Other => None,
    }
}

/// Where the macOS traffic lights go so they sit centred in the web top bar.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn traffic_lights_position() -> (f64, f64) {
    (
        TRAFFIC_LIGHTS_X,
        ((WEB_TOP_BAR_HEIGHT - TRAFFIC_LIGHTS_HEIGHT) / 2.0).round(),
    )
}

/// The `titleBar` member of the bridge, as a JavaScript literal.
pub fn bridge_literal(os: Os) -> String {
    match title_bar_for(os) {
        Some(bar) => serde_json::to_string(&bar).unwrap_or_else(|_| "undefined".into()),
        None => "undefined".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_title_bar_per_platform() {
        let windows = title_bar_for(Os::Windows).unwrap();
        assert_eq!((windows.style, windows.platform), ("custom", "windows"));
        assert_eq!((windows.left_inset, windows.right_inset), (0, 0));
        let mac = title_bar_for(Os::MacOs).unwrap();
        assert_eq!((mac.style, mac.platform), ("custom", "macos"));
        assert_eq!(mac.left_inset, MACOS_LEFT_INSET);
        assert_eq!(mac.right_inset, 0);
        let linux = title_bar_for(Os::Linux).unwrap();
        assert_eq!((linux.style, linux.platform), ("custom", "linux"));
        assert_eq!((linux.left_inset, linux.right_inset), (0, 0));
        assert_eq!(title_bar_for(Os::Other), None);
    }

    #[test]
    fn writes_the_bridge_member() {
        assert_eq!(
            bridge_literal(Os::Windows),
            r#"{"style":"custom","platform":"windows","leftInset":0,"rightInset":0}"#
        );
        assert_eq!(
            bridge_literal(Os::MacOs),
            r#"{"style":"custom","platform":"macos","leftInset":80,"rightInset":0}"#
        );
        assert_eq!(
            bridge_literal(Os::Linux),
            r#"{"style":"custom","platform":"linux","leftInset":0,"rightInset":0}"#
        );
        assert_eq!(bridge_literal(Os::Other), "undefined");
    }

    #[test]
    fn centres_the_traffic_lights_in_the_top_bar() {
        let (x, y) = traffic_lights_position();
        assert_eq!((x, y), (16.0, 17.0));
        // The lights end before the inset the web app leaves free.
        assert!(x + 54.0 < f64::from(MACOS_LEFT_INSET));
    }
}
