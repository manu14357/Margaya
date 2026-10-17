import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { purgeProject, restoreProject } from "@/fetchers/trash/project-trash";
import {
  emptyTaskTrash,
  purgeTask,
  restoreTask,
} from "@/fetchers/trash/task-trash";
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
}

function refreshAfterProjectChange(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: trashQueryKeys.all() });
  void queryClient.invalidateQueries({ queryKey: ["projects"] });
  void queryClient.invalidateQueries({ queryKey: ["favorites"] });
  void queryClient.invalidateQueries({ queryKey: archiveQueryKeys.all() });
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
