// ["pages", projectId] is a project's list; ["page", pageId] prefixes one
// page's detail, versions and backlinks, so invalidating it refreshes all.
export const pageQueryKeys = {
  lists: () => ["pages"] as const,
  list: (projectId: string) => ["pages", projectId] as const,
  all: () => ["page"] as const,
  detail: (pageId: string) => ["page", pageId] as const,
  versions: (pageId: string) => ["page", pageId, "versions"] as const,
  version: (pageId: string, versionId: string) =>
    ["page", pageId, "versions", versionId] as const,
  backlinks: (pageId: string) => ["page", pageId, "backlinks"] as const,
  comments: (pageId: string) => ["page", pageId, "comments"] as const,
  subscription: (pageId: string) => ["page", pageId, "subscription"] as const,
  // Pages that link a task; any page change can add or drop one.
  taskReferences: () => ["page-task-references"] as const,
  taskReference: (taskId: string) => ["page-task-references", taskId] as const,
};
