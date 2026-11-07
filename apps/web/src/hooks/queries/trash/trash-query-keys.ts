// Every trash query starts with "trash", so mutations and realtime hints
// refresh the lists with one prefix invalidation.
export const trashQueryKeys = {
  all: () => ["trash"] as const,
  tasks: (projectId: string, q: string) =>
    ["trash", "tasks", projectId, { q }] as const,
  projects: (workspaceId: string, q: string) =>
    ["trash", "projects", workspaceId, { q }] as const,
  pages: (projectId: string, q: string) =>
    ["trash", "pages", projectId, { q }] as const,
};
