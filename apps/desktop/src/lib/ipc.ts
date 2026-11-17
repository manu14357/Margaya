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
  /** The login item starts in the tray. Missing in older builds. */
  startMinimized?: boolean;
  updateChannel?: UpdateChannel;
};

export type UpdateChannel = "stable" | "beta";

/** A global shortcut's action (shortcuts.rs). */
export type ShortcutAction = "quickAdd" | "search" | "screenshot" | "today";

export type ShortcutView = {
  action: ShortcutAction;
  /** "CommandOrControl+Shift+Space", "Control+Alt+KeyK"; null when unset. */
  accelerator: string | null;
  defaultAccelerator: string | null;
  /** False when the system refused the combination. */
  active: boolean;
};

export type WhatsNewState = { version: string; pending: boolean };

/** Release notes as plain text blocks (updates.rs); never HTML. */
export type NoteBlock =
  | { kind: "heading"; text: string }
  | { kind: "item"; text: string; depth: number }
  | { kind: "paragraph"; text: string };

export type ReleaseNotes = {
  version: string;
  url: string;
  blocks: NoteBlock[];
};

export type QuickAddTarget = {
  workspaceId: string;
  workspaceName: string;
  projects: { id: string; name: string }[];
};

export type QuickAddResult = {
  taskId: string;
  url: string;
  /** Names of attachments that couldn't be uploaded; the task exists. */
  failedAttachments?: string[];
};

/** Optional task fields quick add sends with the title (api.rs TaskDetails). */
export type QuickAddDetails = {
  description?: string;
  /** ISO 8601: the due day's local midnight. */
  dueDate?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  /** Omitted: the project's default assignee. */
  assigneeIds?: string[];
};

export type QuickAddMember = { id: string; name: string; handle: string };

export type QuickAddNoticeKind =
  | "titleTrimmed"
  | "descriptionTrimmed"
  | "tooLarge"
  | "tooMany"
  | "notAFile"
  | "unreadable"
  | "clipboardEmpty"
  | "screenPermission"
  | "screenshotFailed";

export type QuickAddNotice = { kind: QuickAddNoticeKind; name?: string };

export type QuickAddAttachment = {
  id: string;
  name: string;
  size: number;
  image: boolean;
  /** A small PNG data URL, for images the app captured. */
  preview?: string;
};

/** What a screenshot, the clipboard or "Send to" put in quick add. */
export type QuickAddDraft = {
  revision: number;
  title: string | null;
  description: string | null;
  attachments: QuickAddAttachment[];
  notices: QuickAddNotice[];
};

export type QuickAddPrefs = {
  serverId: string | null;
  workspaceId: string | null;
  projectId: string | null;
};

/** The offline page's view of its server window (offline.rs). */
export type OfflineState = {
  serverName: string;
  webUrl: string;
  errorKind: ErrorKind;
  attempt: number;
  retryInMs: number;
};

/** Saved read-only copies for offline reading (offline_cache.rs). */
export type OfflineItemKind = "task" | "page";

export type OfflineItemSummary = {
  kind: OfflineItemKind;
  id: string;
  title: string;
  workspaceName: string | null;
  projectName: string | null;
  /** Unix milliseconds. */
  savedAt: number;
};

export type OfflineItem = OfflineItemSummary & {
  path: string;
  status: string | null;
  priority: string | null;
  dueDate: string | null;
  assignees: string[];
  /** Plain text with a few markdown-like line markers; never HTML. */
  bodyText: string;
  updatedAt: string | null;
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
  | "shortcutInvalid"
  | "shortcutNoModifier"
  | "shortcutReserved"
  | "shortcutInUse"
  | "shortcutTaken"
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
  setStartMinimized: (enabled: boolean) =>
    invoke<void>("set_start_minimized", { enabled }),
  setUpdateChannel: (channel: UpdateChannel) =>
    invoke<void>("set_update_channel", { channel }),
  getShortcuts: () => invoke<ShortcutView[]>("get_shortcuts"),
  /** `null` clears the shortcut. */
  setShortcut: (action: ShortcutAction, accelerator: string | null) =>
    invoke<ShortcutView[]>("set_shortcut", { action, accelerator }),
  resetShortcut: (action: ShortcutAction) =>
    invoke<ShortcutView[]>("reset_shortcut", { action }),
  pauseShortcuts: (paused: boolean) =>
    invoke<ShortcutView[]>("pause_shortcuts", { paused }),
  whatsNewState: () => invoke<WhatsNewState>("whats_new_state"),
  dismissWhatsNew: () => invoke<void>("dismiss_whats_new"),
  releaseNotes: (version?: string) =>
    invoke<ReleaseNotes>("release_notes", { version: version ?? null }),
  quickAddTargets: (serverId: string) =>
    invoke<QuickAddTarget[]>("quick_add_targets", { serverId }),
  quickAddCreate: (
    serverId: string,
    workspaceId: string,
    projectId: string,
    title: string,
    details?: QuickAddDetails,
    attachmentIds?: string[],
  ) =>
    invoke<QuickAddResult>("quick_add_create", {
      serverId,
      workspaceId,
      projectId,
      title,
      details,
      attachmentIds,
    }),
  quickAddDraft: () => invoke<QuickAddDraft>("quick_add_draft"),
  quickAddRemoveAttachment: (id: string) =>
    invoke<void>("quick_add_remove_attachment", { id }),
  quickAddMembers: (serverId: string, workspaceId: string) =>
    invoke<QuickAddMember[]>("quick_add_members", { serverId, workspaceId }),
  quickAddPrefs: () => invoke<QuickAddPrefs>("quick_add_prefs"),
  quickAddOpen: (serverId: string, url: string) =>
    invoke<void>("quick_add_open", { serverId, url }),
  closeQuickAdd: () => invoke<void>("close_quick_add"),
  // Only from the offline page inside a server window (capabilities/offline.json).
  offlineState: () => invoke<OfflineState>("offline_state"),
  offlineRetry: (manual: boolean) =>
    invoke<OfflineState | null>("offline_retry", { manual }),
  showServers: () => invoke<void>("show_servers"),
  // Offline reading: the offline page reads only its own server's copies.
  offlineItems: () => invoke<OfflineItemSummary[]>("offline_items"),
  offlineItem: (kind: OfflineItemKind, id: string) =>
    invoke<OfflineItem | null>("offline_item", { kind, id }),
  // Launcher settings: "Keep recent items for offline reading".
  getOfflineReading: () => invoke<{ enabled: boolean }>("get_offline_reading"),
  setOfflineReading: (enabled: boolean) =>
    invoke<void>("set_offline_reading", { enabled }),
  clearOfflineCopies: () => invoke<void>("clear_offline_copies"),
  // Launcher settings: the spell checker's language (spellcheck.rs).
  getSpellcheck: () => invoke<SpellcheckSettings>("get_spellcheck"),
  setSpellcheck: (language: string) =>
    invoke<SpellcheckSettings>("set_spellcheck", { language }),
  // Launcher settings: "Pause notifications" (pause.rs).
  getNotificationPause: () =>
    invoke<NotificationPause>("get_notification_pause"),
  setNotificationPause: (mode: NotificationPauseMode) =>
    invoke<NotificationPause>("set_notification_pause", { mode }),
};

export type NotificationPauseMode = "off" | "hour" | "tomorrow" | "forever";

/** "Pause notifications": the choice and when it ends (Unix ms; null for off or forever). */
export type NotificationPause = {
  mode: NotificationPauseMode;
  until: number | null;
};

export type SpellcheckSettings = {
  /** "system" or one of `languages`. */
  language: string;
  languages: string[];
  systemLanguage: string | null;
  /** False on macOS, where the system's spelling settings apply. */
  supported: boolean;
  /** Windows open before the last change keep the old language until a restart. */
  restartNeeded: boolean;
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
  /** The quick-add draft changed (a screenshot, the clipboard, Send to). */
  quickAddDraft: (handler: () => void): Promise<UnlistenFn> =>
    listen("quick-add-draft", () => handler()),
  updateAvailable: (handler: (version: string) => void): Promise<UnlistenFn> =>
    listen<string>("update-available", (event) => handler(event.payload)),
  /** Notifications were paused or resumed (the tray, or a pause ended). */
  notificationPauseChanged: (
    handler: (pause: NotificationPause) => void,
  ): Promise<UnlistenFn> =>
    listen<NotificationPause>("notification-pause-changed", (event) =>
      handler(event.payload),
    ),
  /** The tray's "Settings…" item. */
  showSettings: (handler: () => void): Promise<UnlistenFn> =>
    listen("show-settings", () => handler()),
};
