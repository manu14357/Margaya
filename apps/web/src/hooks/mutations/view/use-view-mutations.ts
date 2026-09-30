import { useMutation, useQueryClient } from "@tanstack/react-query";
import createView from "@/fetchers/view/create-view";
import deleteView from "@/fetchers/view/delete-view";
import duplicateView from "@/fetchers/view/duplicate-view";
import setViewLock from "@/fetchers/view/set-view-lock";
import updateView from "@/fetchers/view/update-view";
import { viewQueryKeys } from "@/hooks/queries/view/view-query-keys";
import type {
  CreateViewRequest,
  SavedView,
  UpdateViewRequest,
} from "@/types/view";
import { invalidateViewQueries } from "./invalidate-view-queries";

// View mutations never change tasks, so they skip the task query refresh.
const meta = { refreshTaskQueries: false };

function useSettle() {
  const queryClient = useQueryClient();
  return (view: Pick<SavedView, "id" | "workspaceId"> & Partial<SavedView>) => {
    if (view.name !== undefined) {
      queryClient.setQueryData(
        viewQueryKeys.detail(view.workspaceId, view.id),
        view,
      );
    }
    invalidateViewQueries(queryClient, view.workspaceId);
  };
}

export function useCreateView() {
  const settle = useSettle();
  return useMutation({
    meta,
    mutationFn: (request: CreateViewRequest) => createView(request),
    onSuccess: settle,
  });
}

export function useUpdateView() {
  const settle = useSettle();
  return useMutation({
    meta,
    mutationFn: ({
      viewId,
      changes,
    }: {
      viewId: string;
      changes: UpdateViewRequest;
    }) => updateView(viewId, changes),
    onSuccess: settle,
  });
}

export function useSetViewLock() {
  const settle = useSettle();
  return useMutation({
    meta,
    mutationFn: ({ viewId, locked }: { viewId: string; locked: boolean }) =>
      setViewLock(viewId, locked),
    onSuccess: settle,
  });
}

export function useDuplicateView() {
  const settle = useSettle();
  return useMutation({
    meta,
    mutationFn: ({ viewId, name }: { viewId: string; name?: string }) =>
      duplicateView(viewId, name),
    onSuccess: settle,
  });
}

export function useDeleteView() {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: ({ viewId }: { viewId: string; workspaceId: string }) =>
      deleteView(viewId),
    onSuccess: (_deleted, { viewId, workspaceId }) => {
      queryClient.removeQueries({
        queryKey: viewQueryKeys.detail(workspaceId, viewId),
      });
      invalidateViewQueries(queryClient, workspaceId);
    },
  });
}
