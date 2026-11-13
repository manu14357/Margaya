import type { QueryClient } from "@tanstack/react-query";
import { archiveQueryKeys } from "@/hooks/queries/archive/archive-query-keys";
import { trashQueryKeys } from "@/hooks/queries/trash/trash-query-keys";

/**
 * Everything that lists projects by name, icon or state: project lists and
 * details, favorites, recent visits, the archive and the trash. Used after a
 * project is created, renamed, reordered, archived, trashed or restored, here
 * or (through PROJECTS_UPDATED) anywhere else in the workspace.
 */
export function invalidateProjectListQueries(
  queryClient: QueryClient,
  workspaceId?: string,
) {
  const scoped = (root: string) => (workspaceId ? [root, workspaceId] : [root]);
  for (const queryKey of [
    scoped("projects"),
    scoped("favorites"),
    scoped("recent-visits"),
    archiveQueryKeys.all(),
    trashQueryKeys.all(),
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
