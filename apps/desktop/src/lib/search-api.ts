import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Typed wrappers over the search and Today commands in
// src-tauri/src/search_window.rs and today_window.rs (camelCase serde).

export type SearchItem = {
  kind: string;
  id: string;
  title: string;
  key: string | null;
  context: string | null;
  path: string;
};

export type SearchGroup = {
  serverId: string;
  serverLabel: string;
  workspaceId: string;
  workspaceName: string;
  sections: { kind: string; items: SearchItem[] }[];
};

export type SearchOutcome = {
  groups: SearchGroup[];
  /** Labels of signed-in servers that couldn't be searched. */
  unavailable: string[];
};

export type TodayTask = {
  serverId: string;
  serverLabel: string;
  workspaceId: string;
  workspaceName: string;
  id: string;
  projectId: string;
  projectName: string | null;
  key: string | null;
  title: string;
  dueDate: string | null;
  overdue: boolean;
  priority: string | null;
  path: string;
};

export type TodayOutcome = { tasks: TodayTask[]; unavailable: string[] };

export const searchApi = {
  query: (query: string) => invoke<SearchOutcome>("search_query", { query }),
  recent: () => invoke<SearchOutcome>("search_recent"),
  open: (serverId: string, path: string) =>
    invoke<void>("search_open", { serverId, path }),
  close: () => invoke<void>("close_search"),
};

export const todayApi = {
  tasks: () => invoke<TodayOutcome>("today_tasks"),
  complete: (serverId: string, taskId: string, projectId: string) =>
    invoke<void>("today_complete", { serverId, taskId, projectId }),
  open: (serverId: string, path: string) =>
    invoke<void>("today_open", { serverId, path }),
  close: () => invoke<void>("close_today"),
};

/** The Rust core showed the window again. */
export function onShown(
  event: "search-shown" | "today-refresh",
  handler: () => void,
): Promise<UnlistenFn> {
  return listen(event, () => handler());
}
