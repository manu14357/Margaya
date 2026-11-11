//! Signed self-updates from GitHub Releases (contract §6). The endpoint and
//! the updater public key live in tauri.conf.json under plugins.updater.
//!
//! On Linux only the AppImage updates itself. A .deb or .rpm belongs to the
//! system's package manager, so the app only says a new version exists and
//! sends people to the download page for the new package.

use tauri::utils::config::BundleType;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use url::Url;

use crate::error::{AppError, AppResult};
use crate::menus;
use crate::state::{lock, AppState};

/// True once tauri.conf.json carries the real updater public key.
// TODO(release): replace the "TODO-…" placeholder in plugins.updater.pubkey with
// the public half of the updater key (`pnpm tauri signer generate`). The private
// key lives only in CI secrets; losing it strands every installed copy.
pub fn pubkey_configured(app: &AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(|pubkey| pubkey.as_str())
        .is_some_and(|pubkey| !pubkey.trim().is_empty() && !pubkey.starts_with("TODO"))
}

/// Where people get a new package when the app can't update itself.
pub const DOWNLOAD_PAGE: &str = "https://margaya.app/download";

/// Whether this copy may replace itself: everywhere but a Linux system
/// package (deb, rpm) or a Linux binary outside any bundle (a development
/// build).
pub fn can_self_update(os: crate::titlebar::Os, bundle: Option<BundleType>) -> bool {
    match os {
        crate::titlebar::Os::Linux | crate::titlebar::Os::Other => {
            bundle == Some(BundleType::AppImage)
        }
        _ => true,
    }
}

/// [`can_self_update`] for this copy. The bundler stamps the bundle type
/// into the binary it packages.
pub fn self_update_supported() -> bool {
    can_self_update(
        crate::titlebar::current_os(),
        tauri::utils::platform::bundle_type(),
    )
}

/// Looks for a newer release; remembers and announces it.
pub async fn check(app: &AppHandle) -> AppResult<Option<String>> {
    if !pubkey_configured(app) {
        log::warn!("updater public key not configured; skipping the update check");
        return Ok(None);
    }
    let update = app
        .updater()
        .map_err(AppError::internal)?
        .check()
        .await
        .map_err(AppError::internal)?;
    let version = update.map(|update| update.version);
    *lock(&app.state::<AppState>().available_update) = version.clone();
    if let Some(version) = &version {
        log::info!("update available: {version}");
        let _ = app.emit("update-available", version.clone());
    }
    menus::refresh_tray(app);
    Ok(version)
}

/// Downloads, verifies and installs the update, then restarts. A copy that
/// can't update itself opens the download page instead.
pub async fn install(app: &AppHandle) -> AppResult<()> {
    if !self_update_supported() {
        let page = Url::parse(DOWNLOAD_PAGE).map_err(AppError::internal)?;
        crate::opener::open_outside(app, "app", &page);
        return Ok(());
    }
    if !pubkey_configured(app) {
        return Err(AppError::internal("updater public key not configured"));
    }
    let Some(update) = app
        .updater()
        .map_err(AppError::internal)?
        .check()
        .await
        .map_err(AppError::internal)?
    else {
        return Ok(());
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(AppError::internal)?;
    app.restart();
}

/// Checks once shortly after launch, in release builds.
pub fn check_after_launch(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        if let Err(error) = check(&app).await {
            log::warn!("update check failed: {}", error.message);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::titlebar::Os;

    #[test]
    fn only_linux_appimages_update_themselves_on_linux() {
        assert!(can_self_update(Os::Linux, Some(BundleType::AppImage)));
        // The package manager owns a .deb or .rpm install.
        assert!(!can_self_update(Os::Linux, Some(BundleType::Deb)));
        assert!(!can_self_update(Os::Linux, Some(BundleType::Rpm)));
        assert!(!can_self_update(Os::Linux, None));
        assert!(!can_self_update(Os::Other, None));
        // Windows and macOS installs always do.
        assert!(can_self_update(Os::Windows, Some(BundleType::Nsis)));
        assert!(can_self_update(Os::Windows, Some(BundleType::Msi)));
        assert!(can_self_update(Os::MacOs, Some(BundleType::App)));
        assert!(Url::parse(DOWNLOAD_PAGE).is_ok_and(|url| url.scheme() == "https"));
    }
}
