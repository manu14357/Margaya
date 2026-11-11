use std::fs;
use std::path::PathBuf;

// Commands the app defines. Listing them makes tauri-build generate an
// `allow-<command>` permission for each, so the capability files decide which
// window may call which command: the launcher gets its own commands, remote
// server pages only `bridge_message`, and the bundled offline page shown in a
// server window only the three offline commands.
const COMMANDS: &[&str] = &[
    "list_servers",
    "discover_server",
    "add_server",
    "rename_server",
    "remove_server",
    "open_server",
    "start_sign_in",
    "submit_sign_in_code",
    "cancel_sign_in",
    "sign_out",
    "open_external",
    "take_launcher_prompt",
    "get_settings",
    "set_autostart",
    "copy_diagnostics",
    "check_for_update",
    "install_update",
    "quick_add_targets",
    "quick_add_create",
    "quick_add_open",
    "close_quick_add",
    "bridge_message",
    "offline_state",
    "offline_retry",
    "show_servers",
];

/// Copies `desktop.launcher` from every locale file in the repo's i18n folder
/// into OUT_DIR, for native menus, tray and notifications.
fn extract_launcher_copy() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let i18n = manifest.join("../../../i18n");
    println!("cargo:rerun-if-changed={}", i18n.display());
    let mut copy = serde_json::Map::new();
    if let Ok(entries) = fs::read_dir(&i18n) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let Some(locale) = name.strip_suffix(".json") else {
                continue;
            };
            if locale.len() != 5 || locale.as_bytes()[2] != b'-' {
                continue;
            }
            println!("cargo:rerun-if-changed={}", entry.path().display());
            let Ok(text) = fs::read_to_string(entry.path()) else {
                continue;
            };
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
                continue;
            };
            if let Some(launcher) = value.pointer("/desktop/launcher") {
                copy.insert(locale.to_string(), launcher.clone());
            }
        }
    }
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("desktop_i18n.json");
    fs::write(out, serde_json::Value::Object(copy).to_string()).unwrap();
}

fn main() {
    extract_launcher_copy();
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
    link_manifest_into_tests();
}

/// tauri-build links its Windows resource (with the app manifest that asks
/// for Common Controls v6) into the app binary only. Without it the unit-test
/// binary, which links Tauri too, dies at load with STATUS_ENTRYPOINT_NOT_FOUND;
/// lib.rs links the same resource into its unit-test build.
fn link_manifest_into_tests() {
    println!("cargo::rustc-check-cfg=cfg(margaya_test_resource)");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    if out.join("libresource.a").exists() || out.join("resource.lib").exists() {
        println!("cargo:rustc-link-search=native={}", out.display());
        println!("cargo:rustc-cfg=margaya_test_resource");
    }
}
