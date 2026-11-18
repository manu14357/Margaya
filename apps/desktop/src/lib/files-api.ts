import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Typed wrappers over the Files window's commands in
// src-tauri/src/files_window.rs (camelCase serde). Every path goes back to
// Rust, which checks it against the places the person picked.

export type EntryKind = "folder" | "file" | "other";

export type FileEntry = {
  name: string;
  path: string;
  kind: EntryKind;
  /** Bytes, for files. */
  size: number | null;
  /** Unix milliseconds. */
  modified: number | null;
  hidden: boolean;
  /** A link or junction. */
  link: boolean;
  /** Search results: the folder it is in, relative to the search's start. */
  folder?: string;
};

export type Place = {
  id: string;
  name: string;
  path: string;
  /** False when the folder is gone or now resolves somewhere else. */
  available: boolean;
};

export type RecentFile = FileEntry & { available: boolean; openedAt: number };

export type FilesOverview = { places: Place[]; recent: RecentFile[] };

export type Crumb = { name: string; path: string };

export type FolderView = {
  path: string;
  placeId: string | null;
  crumbs: Crumb[];
  entries: FileEntry[];
  /** Entries left out past the listing cap. */
  omitted: number;
};

export type SearchOutcome = {
  entries: FileEntry[];
  truncated: boolean;
  cancelled: boolean;
};

export type Dropped = { files: FileEntry[]; places: number; refused: number };

export const filesApi = {
  overview: () => invoke<FilesOverview>("files_overview"),
  /** The system folder picker; the new place's id, or null if cancelled. */
  addFolder: () => invoke<string | null>("files_add_folder"),
  removeFolder: (id: string) => invoke<void>("files_remove_folder", { id }),
  list: (path: string) => invoke<FolderView>("files_list", { path }),
  /** The file's bytes (the core refuses very large files). */
  read: (path: string) => invoke<ArrayBuffer>("files_read", { path }),
  /** A streaming address for audio and video, for this window only. */
  streamUrl: (path: string) => invoke<string>("files_stream_url", { path }),
  search: (
    path: string,
    query: string,
    includeHidden: boolean,
    searchId: number,
  ) =>
    invoke<SearchOutcome>("files_search", {
      path,
      query,
      includeHidden,
      searchId,
    }),
  cancelSearch: (searchId: number) =>
    invoke<void>("files_cancel_search", { searchId }),
  open: (path: string) => invoke<void>("files_open", { path }),
  reveal: (path: string) => invoke<void>("files_reveal", { path }),
  copyPath: (path: string) => invoke<void>("files_copy_path", { path }),
  /** The system save dialog, then a copy there; null if cancelled. */
  saveCopy: (path: string) =>
    invoke<string | null>("files_save_copy", { path }),
  addRecent: (path: string) => invoke<void>("files_recent_add", { path }),
  removeRecent: (path: string) => invoke<void>("files_recent_remove", { path }),
  /** A native file drag out of the window (while the pointer is down). */
  startDrag: (path: string) => invoke<void>("files_start_drag", { path }),
};

export const filesEvents = {
  /** Files or folders were dropped on the window (the core checked them). */
  dropped: (handler: (dropped: Dropped) => void): Promise<UnlistenFn> =>
    listen<Dropped>("files-dropped", (event) => handler(event.payload)),
  /** The window was brought forward again. */
  shown: (handler: () => void): Promise<UnlistenFn> =>
    listen("files-shown", () => handler()),
};
