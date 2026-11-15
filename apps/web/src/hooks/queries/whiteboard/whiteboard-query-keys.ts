import type { WhiteboardListFilters } from "@/types/whiteboard";

// ["whiteboards", projectId, filters] are a project's lists, so
// ["whiteboards", projectId] refreshes every filter of one project.
// ["whiteboards", "workspace", workspaceId, filters] are the workspace-wide
// lists; ["whiteboards"] refreshes both kinds.
// ["whiteboard", id] is one board's header data and ["whiteboard-content",
// id] its stored elements (the read-only fallback and the public view).
export const whiteboardQueryKeys = {
  lists: () => ["whiteboards"] as const,
  projectLists: (projectId: string) => ["whiteboards", projectId] as const,
  list: (projectId: string, filters: WhiteboardListFilters) =>
    ["whiteboards", projectId, filters] as const,
  workspaceLists: () => ["whiteboards", "workspace"] as const,
  workspaceList: (workspaceId: string, filters: WhiteboardListFilters) =>
    ["whiteboards", "workspace", workspaceId, filters] as const,
  all: () => ["whiteboard"] as const,
  detail: (whiteboardId: string) => ["whiteboard", whiteboardId] as const,
  contents: () => ["whiteboard-content"] as const,
  content: (whiteboardId: string) =>
    ["whiteboard-content", whiteboardId] as const,
  // One board's history (lifecycle changes and edits), a page at a time.
  activities: () => ["whiteboard-activity"] as const,
  activity: (whiteboardId: string) =>
    ["whiteboard-activity", whiteboardId] as const,
  // Boards holding a task's card; any content save can add or drop one.
  taskBoards: () => ["task-whiteboards"] as const,
  taskBoard: (taskId: string) => ["task-whiteboards", taskId] as const,
  public: (token: string) => ["public-whiteboard", token] as const,
};
