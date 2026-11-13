import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { purgePage, restoreDeletedPage } from "@/fetchers/trash/page-trash";
import { purgeProject, restoreProject } from "@/fetchers/trash/project-trash";
import {
  emptyTaskTrash,
  purgeTask,
  restoreTask,
} from "@/fetchers/trash/task-trash";
import { invalidatePageQueries } from "@/hooks/mutations/page/invalidate-page-queries";
import { invalidateProjectListQueries } from "@/hooks/mutations/project/invalidate-project-list-queries";
import { invalidatePlanningProgress } from "@/hooks/mutations/task/invalidate-planning-progress";
import { archiveQueryKeys } from "@/hooks/queries/archive/archive-query-keys";
import { trashQueryKeys } from "@/hooks/queries/trash/trash-query-keys";
import { invalidateTaskQueries } from "@/lib/task-query/cache";

/** The trash lists, plus the boards and lists a restored task returns to. */
export function refreshAfterTaskChange(
  queryClient: QueryClient,
  projectId: string,
) {
  void queryClient.invalidateQueries({ queryKey: trashQueryKeys.all() });
  void queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
  void queryClient.invalidateQueries({ queryKey: archiveQueryKeys.all() });
  void invalidateTaskQueries(queryClient, projectId);
  // A restored task is back in its cycles, modules, forecasts and risks.
  invalidatePlanningProgress(queryClient, projectId);
}

function refreshAfterProjectChange(queryClient: QueryClient) {
  invalidateProjectListQueries(queryClient);
}

export function useRestoreTask(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: restoreTask,
    onSettled: () => refreshAfterTaskChange(queryClient, projectId),
  });
}

export function usePurgeTask(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: purgeTask,
    onSettled: () => refreshAfterTaskChange(queryClient, projectId),
  });
}

export function useEmptyTaskTrash(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => emptyTaskTrash(projectId),
    onSettled: () => refreshAfterTaskChange(queryClient, projectId),
  });
}

/** The trash lists, plus the project's Pages list a restored page returns to. */
function refreshAfterPageChange(queryClient: QueryClient, projectId: string) {
  void queryClient.invalidateQueries({ queryKey: trashQueryKeys.all() });
  invalidatePageQueries(queryClient, {
    projectIds: [projectId],
    entities: true,
  });
}

export function useRestoreDeletedPage(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { refreshTaskQueries: false },
    mutationFn: restoreDeletedPage,
    onSettled: () => refreshAfterPageChange(queryClient, projectId),
  });
}

export function usePurgePage(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { refreshTaskQueries: false },
    mutationFn: purgePage,
    onSettled: () => refreshAfterPageChange(queryClient, projectId),
  });
}

export function useRestoreProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: restoreProject,
    onSettled: () => refreshAfterProjectChange(queryClient),
  });
}

export function usePurgeProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: purgeProject,
    onSettled: () => refreshAfterProjectChange(queryClient),
  });
}
