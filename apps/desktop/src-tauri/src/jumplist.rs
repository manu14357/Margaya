//! The Windows taskbar's right-click menu (jump list): Quick add, Search,
//! Files, Inbox and My tasks. Each task starts Margaya with a launch argument
//! (`launch.rs`); a running app gets it through single-instance.
//!
//! Linux .deb and .rpm installs get the same entries as `Actions=` in
//! `linux/margaya.desktop`. macOS has no dock-menu API in Tauri.

/// The jump list's tasks: (launch argument, copy key).
#[cfg_attr(not(windows), allow(dead_code))]
pub const TASKS: [(&str, &str); 5] = [
    ("--action=quick-add", "jumpList.quickAdd"),
    ("--action=search", "jumpList.search"),
    ("--action=files", "jumpList.files"),
    ("--open=inbox", "jumpList.inbox"),
    ("--open=my-tasks", "jumpList.myTasks"),
];

/// Names this process with the app's AppUserModelID (the identifier, which
/// the installers also put on the Start menu shortcut), so the taskbar button
/// gets the jump list however the app was started (Start menu, login item,
/// a link), then builds the list off the UI thread.
#[cfg(windows)]
pub fn init(app: &tauri::AppHandle) {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

    let identifier = app.config().identifier.clone();
    unsafe {
        if let Err(error) = SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(&identifier)) {
            log::warn!("could not set the app's taskbar identity: {error}");
        }
    }
    let tasks: Vec<(String, String)> = TASKS
        .iter()
        .map(|(argument, key)| (argument.to_string(), crate::i18n::t(key)))
        .collect();
    std::thread::spawn(move || {
        if let Err(error) = build(&identifier, &tasks) {
            log::warn!("could not build the taskbar jump list: {error}");
        }
    });
}

#[cfg(not(windows))]
pub fn init(_app: &tauri::AppHandle) {}

#[cfg(windows)]
fn build(identifier: &str, tasks: &[(String, String)]) -> windows::core::Result<()> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
    use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PROPVARIANT};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{
        DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW,
        SHStrDupW, ShellLink,
    };

    let exe = std::env::current_exe()
        .map_err(|_| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))?;
    let exe = HSTRING::from(exe.as_os_str());
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        let result = (|| {
            let list: ICustomDestinationList =
                CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
            list.SetAppID(&HSTRING::from(identifier))?;
            let mut slots = 0u32;
            let _removed: IObjectArray = list.BeginList(&mut slots)?;
            let collection: IObjectCollection =
                CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
            for (argument, title) in tasks {
                let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                link.SetPath(&exe)?;
                link.SetArguments(&HSTRING::from(argument.as_str()))?;
                link.SetIconLocation(&exe, 0)?;
                link.SetDescription(&HSTRING::from(title.as_str()))?;
                // A task shows its System.Title.
                let store: IPropertyStore = link.cast()?;
                let mut value = PROPVARIANT::default();
                let text = SHStrDupW(&HSTRING::from(title.as_str()))?;
                (*value.Anonymous.Anonymous).vt = VT_LPWSTR;
                (*value.Anonymous.Anonymous).Anonymous.pwszVal = text;
                let set = store
                    .SetValue(&PKEY_Title, &value)
                    .and_then(|()| store.Commit());
                let _ = PropVariantClear(&mut value);
                set?;
                collection.AddObject(&link)?;
            }
            let tasks: IObjectArray = collection.cast()?;
            list.AddUserTasks(&tasks)?;
            list.CommitList()
        })();
        CoUninitialize();
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_task_is_a_launch_argument_with_copy() {
        for (argument, key) in TASKS {
            assert!(crate::launch::parse(&[argument]).is_some(), "{argument}");
            // English copy exists (t falls back to the key otherwise).
            assert_ne!(crate::i18n::t(key), key);
        }
    }
}
