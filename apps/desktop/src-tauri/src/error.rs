//! The one error type commands return. The launcher maps `kind` to copy; the
//! message is for logs and diagnostics and never carries a token.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    InvalidUrl,
    Unreachable,
    NotMargaya,
    ServerTooOld,
    Disabled,
    DesktopTooOld,
    TlsUntrusted,
    Duplicate,
    NotSignedIn,
    SignInFailed,
    CodeInvalid,
    QuickAddFailed,
    /// The token couldn't be stored: on Linux, usually no Secret Service
    /// (GNOME Keyring, KWallet) is running.
    KeychainUnavailable,
    Internal,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("{kind:?}: {message}")]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn internal(error: impl std::fmt::Display) -> Self {
        Self::new(ErrorKind::Internal, error.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(error: tauri::Error) -> Self {
        Self::internal(error)
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_kinds_as_the_launcher_reads_them() {
        let error = AppError::new(ErrorKind::KeychainUnavailable, "no secret service");
        let json = serde_json::to_value(&error).unwrap();
        assert_eq!(json["kind"], "keychainUnavailable");
        assert_eq!(
            serde_json::to_value(ErrorKind::TlsUntrusted).unwrap(),
            "tlsUntrusted"
        );
    }
}
