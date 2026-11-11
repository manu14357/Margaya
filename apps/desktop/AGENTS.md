# Margaya Desktop guide

Folder guide for `apps/desktop` (`@margaya/desktop`), the Tauri 2 shell for Windows, macOS 14+ and Linux (WebKitGTK 4.1: Ubuntu 22.04+, Debian 12+, Fedora 38+; x86_64 and ARM64). The root [AGENTS.md](../../AGENTS.md) is canonical. Skill: `desktop-app`.

## Shape

- The app bundles only a small launcher (`src/`, React + Vite). Each server opens in its own window that loads **the server's own web UI**; the app never bundles `apps/web`.
- `src-tauri/src/`: the Rust core. `servers.rs` (server list, `servers.json` in the app config dir, ids are UUIDs), `discovery.rs` (`/api/config`, `.well-known/margaya-desktop.json`), `auth.rs` + `signin.rs` (PKCE sign-in in the system browser, deep links), `tokens.rs` (OS keychain; Secret Service on Linux), `windows.rs` (server windows: main `server-<id>`, additional `server-<id>-<n>`, sign-in popups `popup-<id>-<n>`; per-server data store, navigation, downloads, title bar, hide-on-close), `routing.rs` (pure decisions: new windows, navigation, in-app navigate script, offline backoff), `opener.rs` (every outside open on its own thread, deduped), `offline.rs` (offline page), `titlebar.rs`, `bridge.rs` (`window.__MARGAYA_DESKTOP__`), `socket.rs` + `api.rs` (user socket, bearer calls, quick add), `notify.rs` (native notifications: Windows toasts with `margaya://open` click links, the notification plugin over D-Bus on Linux, one sound per notification), `sound.rs` (Margaya's notification sounds rendered to WAV and played on Windows and Linux), `badge.rs` + `badge_view.rs` (unread badge; on Linux the Unity launcher-entry signal and the tray label), `menus.rs`, `updates.rs`, `diagnostics.rs`.
- One bundle serves the launcher (`index.html`), the quick-add window (`index.html#quick-add`) and the offline page shown inside a server window (`index.html#offline`).

## Rules

- The API is the authority. The core calls only documented API routes with `Authorization: Bearer`; it never decides permissions.
- Tokens live only in the OS keychain, one entry per server id. Never put a token, code, verifier or `webviewSecret` in `servers.json`, logs, events, URLs other than the one-time callback, or diagnostics.
- The bridge stays narrow: `startBrowserSignIn`, `openExternal` (http(s) only), `setBadge`, `showQuickAdd`, `takeHandoffSecret`, `showServers`, `signedOut`, `ready({ navigate, titleBar })`, `openSignInPopup(url)`, `setSoundMuted(muted)`, `titleBar` and `notificationSound: "system"` (static), and `window.{minimize, toggleMaximize, close, startDragging, isMaximized, onStateChange}`, which act only on the window that sent them. Server pages may call only the `bridge_message` command, granted per server at runtime (`acl.rs`: that server's windows, its exact web origin, remote pages only; never a wildcard capability), and Rust also drops any message whose page is not the server's web origin in one of that server's own windows (`server-<id>` or `server-<id>-<n>`; never a popup).
- Outside pages never open in the app because of how their URL or window looks. The only in-app outside page is a sign-in popup the page announced with `openSignInPopup`, for an OAuth request whose `redirect_uri` is this server's `/api/auth/callback/…` or `/api/auth/oauth2/callback/…`; its title is always "<site> — <server>". Outside opens are deduped (1 s) and capped at 5 per page per 10 s. No filesystem, shell or arbitrary IPC for remote pages, ever. The offline page (the app's own origin in a server window) gets only `offline_state`, `offline_retry` and `show_servers` (`capabilities/offline.json`, local pages only).
- Never open anything outside the app on the UI thread or inside a webview callback: use `opener::open_outside`. Never create a window from a main-thread handler (tray, shortcut, deep link, webview callback): hand it to `windows::spawn_ui`. The one exception is the sign-in popup, which `on_new_window` must return synchronously.
- A new command needs its name in `src-tauri/build.rs` (`COMMANDS`) and an `allow-…` entry in the right capability file.
- Each server window stays on its server's web or API origin; other links go to the system browser. Keep `disable_drag_drop_handler` (board drag and drop on Windows and Linux) and the per-server `data_directory` (Windows, Linux) / `data_store_identifier` (macOS).
- Never add a server from a deep link without the launcher's confirmation.
- Contract names (config fields, routes, schemes, bridge methods) are shared with `apps/api` and `apps/web`; change them on every side together.
- Linux is a shipping platform: code must compile and work there (CI runs `cargo test --locked` on Ubuntu). Gate platform APIs with `cfg(windows)`, `cfg(target_os = "macos")` and `cfg(target_os = "linux")`. Linux server windows are undecorated like Windows (bridge `platform`/`titleBar.platform` `"linux"`); the tray needs `libayatana-appindicator3`; tokens need a running Secret Service; only the AppImage updates itself (`updates::self_update_supported`, from the bundle type the bundler stamps), so a .deb or .rpm only points to the download page.
- Notifications have one sound owner: the native alert, by the server's `sound`, `soundName` and `volume` fields and this device's mute; the web app stays silent when the bridge says `notificationSound: "system"`. Windows toasts are always `<audio silent="true"/>` and the app plays the named Margaya sound itself (`sound.rs`, a port of `apps/web/src/lib/notification-sound/sounds.ts`; keep the recipes in step). Windows toast clicks are `margaya://open` links (protocol activation), never in-process `Activated` handlers. Details in the `desktop-app` skill.

## Copy

Launcher, menu, tray and notification text uses static keys under `desktop.launcher.*` in `i18n/<locale>.json`. The launcher reads them at build time through `scripts/desktop-i18n.ts`; `src-tauri/build.rs` embeds the same subtree for native menus. Every new key needs real translations in all locales (`i18n` skill). `src/lib/i18n.test.ts` fails when the launcher uses a key that has no English text.

## Commands

From `apps/desktop`:

- `pnpm test`, `pnpm typecheck`, `pnpm lint` (read-only Biome check).
- `pnpm build` builds the launcher into `dist/`; the Rust build embeds it, so build it before `cargo test`.
- `cargo test --manifest-path src-tauri/Cargo.toml`.
- Test builds: `--features e2e` writes would-be outside opens to the file named by `MARGAYA_E2E_OPEN_LOG` (optional `MARGAYA_E2E_OPEN_DELAY_MS` simulates a slow shell) instead of opening a browser, and each native notification's click link and sound to `MARGAYA_E2E_NOTIFY_LOG`; starting the build again with that link simulates a click. Build them with another identifier (`--config '{"identifier":"com.margaya.desktop.e2e"}'`) so they get their own data directories, single-instance lock and keychain entries, and never touch an installed copy. Never ship the `e2e` feature.
- `pnpm tauri dev` (launcher dev server on port 1420), `pnpm tauri build` (NSIS + MSI on Windows, DMG + app on macOS, AppImage + .deb + .rpm on Linux). Linux builds need `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev libdbus-1-dev libxdo-dev pkg-config patchelf file` (Ubuntu names). Without a Linux machine, build in Docker from `ubuntu:22.04` with those packages, `rustup` and the npm `@tauri-apps/cli`, with `APPIMAGE_EXTRACT_AND_RUN=1` (no FUSE in containers); see the `desktop-app` skill.
- Icons come from `src-tauri/icons/source.svg` (and `tray-template.svg` for the macOS menu bar); the skill says how to regenerate them. Linux installs the PNGs (32, 128, 256, 512 px) into the hicolor theme; `src-tauri/linux/margaya.desktop` is the .desktop template for the .deb and .rpm. `MARGAYA_BADGE_SAMPLES=<dir> cargo test badge` writes taskbar badge samples.
- `MARGAYA_SOUND_SAMPLES=<dir> cargo test sound` writes every notification sound as a WAV (at 70 and 100) with `levels.tsv` (peak and RMS); `MARGAYA_SOUND_PLAY=<name>[:<volume>] cargo test plays_a_sample -- --nocapture` plays one through the default output on Windows and Linux (`paplay`, `pw-play` or `aplay`).

## Updater key

`plugins.updater.pubkey` in `src-tauri/tauri.conf.json` stays a `TODO-…` placeholder in the repository; while it is, the app skips update checks. Release builds get the real public key stamped in by `desktop-release.yml` (see Releasing). Keep the private key only in CI secrets with an offline backup. Losing it strands every installed copy. Local builds with `createUpdaterArtifacts` need `TAURI_SIGNING_PRIVATE_KEY` set (a throwaway key is fine for testing; never publish such a build).

## Releasing

`.github/workflows/desktop-release.yml` builds and attaches the installers when a `v*` release is published (or by hand with a tag). Maintainer checklist, done once:

1. Generate the updater key pair with `pnpm --filter @margaya/desktop tauri signer generate`, with a password. Back up the private key and password offline.
2. In the repository settings, create a `desktop-release` environment with required reviewers, limited to tags.
3. Add the private key and its password as environment secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Add the public key as the environment variable `TAURI_UPDATER_PUBKEY`. The workflow stamps it into `tauri.conf.json` in the runner; the repository keeps the placeholder.
5. Optional, for a signed and notarized Mac build: `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_API_ISSUER`, `APPLE_API_KEY` (key ID) and `APPLE_API_PRIVATE_KEY` (the `.p8` contents). Without all six the Mac build is ad-hoc signed and not notarized. Windows builds are unsigned until an OV certificate is added.

The workflow fails early when the private or public updater key is missing.
