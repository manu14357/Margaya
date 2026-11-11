import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Typed wrappers over the Rust commands in src-tauri/src/commands.rs. Shapes
// mirror the serde structs there (camelCase).

export type ServerView = {
  id: string;
  label: string;
  webUrl: string;
  apiUrl: string;
  serverVersion: string | null;
  signedIn: boolean;
  unread: number;
  insecure: boolean;
  lastUsedAt: number | null;
};

export type Discovery = {
  webUrl: string;
  apiUrl: string;
  serverVersion: string;
  insecure: boolean;
  suggestedLabel: string;
};

export type Settings = {
  version: string;
  platform: "windows" | "macos" | "linux" | "other";
  autostart: boolean;
  /**
   * False for a Linux .deb or .rpm, which the package manager updates: the
   * app then only points to the download page. Missing in older builds.
   */
  selfUpdate?: boolean;
};

export type QuickAddTarget = {
  workspaceId: string;
  workspaceName: string;
  projects: { id: string; name: string }[];
};

export type QuickAddResult = { taskId: string; url: string };

/** The offline page's view of its server window (offline.rs). */
export type OfflineState = {
  serverName: string;
  webUrl: string;
  errorKind: ErrorKind;
  attempt: number;
  retryInMs: number;
};

export type ErrorKind =
  | "invalidUrl"
  | "unreachable"
  | "notMargaya"
  | "serverTooOld"
  | "disabled"
  | "desktopTooOld"
  | "tlsUntrusted"
  | "duplicate"
  | "notSignedIn"
  | "signInFailed"
  | "codeInvalid"
  | "quickAddFailed"
  | "keychainUnavailable"
  | "internal";

export type CommandError = {
  kind: ErrorKind;
  message: string;
  detail?: string | null;
};

export function isCommandError(value: unknown): value is CommandError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CommandError).kind === "string" &&
    typeof (value as CommandError).message === "string"
  );
}

export const api = {
  listServers: () => invoke<ServerView[]>("list_servers"),
  discoverServer: (input: string) =>
    invoke<Discovery>("discover_server", { input }),
  addServer: (discovery: Discovery, label: string) =>
    invoke<ServerView>("add_server", { discovery, label }),
  renameServer: (id: string, label: string) =>
    invoke<void>("rename_server", { id, label }),
  removeServer: (id: string) => invoke<void>("remove_server", { id }),
  openServer: (id: string) => invoke<void>("open_server", { id }),
  startSignIn: (id: string, showCode: boolean) =>
    invoke<void>("start_sign_in", { id, showCode }),
  submitSignInCode: (id: string, code: string) =>
    invoke<void>("submit_sign_in_code", { id, code }),
  cancelSignIn: (id: string) => invoke<void>("cancel_sign_in", { id }),
  signOut: (id: string) => invoke<void>("sign_out", { id }),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
  takeLauncherPrompt: () => invoke<string | null>("take_launcher_prompt"),
  getSettings: () => invoke<Settings>("get_settings"),
  setAutostart: (enabled: boolean) =>
    invoke<void>("set_autostart", { enabled }),
  copyDiagnostics: () => invoke<void>("copy_diagnostics"),
  checkForUpdate: () => invoke<string | null>("check_for_update"),
  installUpdate: () => invoke<void>("install_update"),
  quickAddTargets: (serverId: string) =>
    invoke<QuickAddTarget[]>("quick_add_targets", { serverId }),
  quickAddCreate: (
    serverId: string,
    workspaceId: string,
    projectId: string,
    title: string,
  ) =>
    invoke<QuickAddResult>("quick_add_create", {
      serverId,
      workspaceId,
      projectId,
      title,
    }),
  quickAddOpen: (serverId: string, url: string) =>
    invoke<void>("quick_add_open", { serverId, url }),
  closeQuickAdd: () => invoke<void>("close_quick_add"),
  // Only from the offline page inside a server window (capabilities/offline.json).
  offlineState: () => invoke<OfflineState>("offline_state"),
  offlineRetry: (manual: boolean) =>
    invoke<OfflineState | null>("offline_retry", { manual }),
  showServers: () => invoke<void>("show_servers"),
};

export type SignInFinished = {
  serverId: string;
  ok: boolean;
  errorKind: ErrorKind | null;
};

export const events = {
  serversChanged: (handler: () => void): Promise<UnlistenFn> =>
    listen("servers-changed", () => handler()),
  signInFinished: (
    handler: (payload: SignInFinished) => void,
  ): Promise<UnlistenFn> =>
    listen<SignInFinished>("sign-in-finished", (event) =>
      handler(event.payload),
    ),
  deepLinkAddServer: (handler: (url: string) => void): Promise<UnlistenFn> =>
    listen<string>("deep-link-add-server", (event) => handler(event.payload)),
  updateAvailable: (handler: (version: string) => void): Promise<UnlistenFn> =>
    listen<string>("update-available", (event) => handler(event.payload)),
};
