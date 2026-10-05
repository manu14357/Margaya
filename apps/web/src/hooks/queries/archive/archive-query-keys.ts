import type { ArchivedEntityType } from "@/types/archive";

export const WORKSPACE_ARCHIVE_SCOPE = "workspace";

// Every archive query starts with "archives", so mutations and realtime
// hints refresh the counts and lists with one prefix invalidation.
export const archiveQueryKeys = {
  all: () => ["archives"] as const,
  scope: (workspaceId: string, projectId?: string) =>
    ["archives", workspaceId, projectId || WORKSPACE_ARCHIVE_SCOPE] as const,
  summary: (workspaceId: string, projectId?: string) =>
    [
      "archives",
      workspaceId,
      projectId || WORKSPACE_ARCHIVE_SCOPE,
      "summary",
    ] as const,
  list: (
    workspaceId: string,
    projectId: string | undefined,
    type: ArchivedEntityType,
    q: string,
  ) =>
    [
      "archives",
      workspaceId,
      projectId || WORKSPACE_ARCHIVE_SCOPE,
      type,
      { q },
    ] as const,
};
