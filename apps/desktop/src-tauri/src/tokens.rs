//! Bearer tokens in the OS keychain (Windows Credential Manager, macOS
//! Keychain, and on Linux the freedesktop Secret Service: GNOME Keyring or
//! KWallet, which must be running), one entry per server UUID. Never logged,
//! never written elsewhere: without a keychain, sign-in fails instead of
//! falling back to a file.

use std::sync::OnceLock;

use keyring::Entry;

const DEFAULT_SERVICE: &str = "com.margaya.desktop";
static SERVICE: OnceLock<String> = OnceLock::new();

/// Names the keychain entries after the app identifier, so a test build with
/// its own identifier (com.margaya.desktop.e2e) never touches the installed
/// app's tokens. Production keeps "com.margaya.desktop".
pub fn init(identifier: &str) {
    let _ = SERVICE.set(identifier.to_string());
}

fn service() -> &'static str {
    SERVICE.get().map_or(DEFAULT_SERVICE, String::as_str)
}

fn entry(server_id: &str) -> Option<Entry> {
    Entry::new(service(), server_id)
        .map_err(|error| log::warn!("keychain unavailable: {error}"))
        .ok()
}

pub fn get(server_id: &str) -> Option<String> {
    match entry(server_id)?.get_password() {
        Ok(token) if !token.is_empty() => Some(token),
        Ok(_) | Err(keyring::Error::NoEntry) => None,
        Err(error) => {
            log::warn!("keychain read failed: {error}");
            None
        }
    }
}

pub fn set(server_id: &str, token: &str) -> bool {
    match entry(server_id).map(|entry| entry.set_password(token)) {
        Some(Ok(())) => true,
        Some(Err(error)) => {
            log::error!("keychain write failed: {error}");
            false
        }
        None => false,
    }
}

pub fn delete(server_id: &str) {
    if let Some(entry) = entry(server_id) {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => log::warn!("keychain delete failed: {error}"),
        }
    }
}
