import {
  type QueryClient,
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import createSticky, {
  type CreateStickyRequest,
} from "@/fetchers/sticky/create-sticky";
import deleteSticky from "@/fetchers/sticky/delete-sticky";
import type { Sticky } from "@/fetchers/sticky/get-stickies";
import reorderStickies from "@/fetchers/sticky/reorder-stickies";
import updateSticky, {
  type StickyChanges,
} from "@/fetchers/sticky/update-sticky";
import {
  insertStickyFirst,
  isSearchedStickiesKey,
  patchStickyInData,
  removeStickyFromData,
  reorderStickiesInData,
  type StickyListData,
  stickiesKeyPrefix,
} from "@/lib/sticky-cache";

type ListData = StickyListData<Sticky>;
type Snapshot = Array<[QueryKey, ListData | undefined]>;

// Sticky writes never touch tasks, so the global task refresh is skipped.
const meta = { refreshTaskQueries: false };

function snapshotLists(queryClient: QueryClient, workspaceId: string) {
  return queryClient.getQueriesData<ListData>({
    queryKey: stickiesKeyPrefix(workspaceId),
  });
}

function restoreLists(queryClient: QueryClient, snapshot?: Snapshot) {
  for (const [queryKey, value] of snapshot ?? []) {
    queryClient.setQueryData(queryKey, value);
  }
}

function editLists(
  queryClient: QueryClient,
  workspaceId: string,
  edit: (data: ListData | undefined) => ListData | undefined,
) {
  queryClient.setQueriesData<ListData>(
    { queryKey: stickiesKeyPrefix(workspaceId) },
    edit,
  );
}

/** Creates a sticky and puts it on top of every unfiltered cached list. */
export function useCreateSticky() {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: (request: CreateStickyRequest) => createSticky(request),
    onSuccess: (sticky, { workspaceId }) => {
      for (const [queryKey] of snapshotLists(queryClient, workspaceId)) {
        if (isSearchedStickiesKey(queryKey)) {
          queryClient.invalidateQueries({ queryKey, exact: true });
        } else {
          queryClient.setQueryData<ListData>(queryKey, (data) =>
            insertStickyFirst(data, sticky),
          );
        }
      }
    },
  });
}

type UpdateVariables = {
  workspaceId: string;
  stickyId: string;
  changes: StickyChanges;
};

/**
 * Patches the sticky in every cached list at once. The returned row replaces
 * the cached one; nothing refetches, so typing never triggers reloads.
 */
export function useUpdateSticky() {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: (variables: UpdateVariables) => updateSticky(variables),
    onMutate: ({ workspaceId, stickyId, changes }) => {
      const previous = snapshotLists(queryClient, workspaceId);
      editLists(queryClient, workspaceId, (data) =>
        patchStickyInData(data, stickyId, changes as Partial<Sticky>),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      restoreLists(queryClient, context?.previous);
    },
    onSuccess: (sticky, { workspaceId, stickyId }) => {
      editLists(queryClient, workspaceId, (data) =>
        patchStickyInData(data, stickyId, sticky),
      );
    },
  });
}

type DeleteVariables = { workspaceId: string; stickyId: string };

export function useDeleteSticky() {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: (variables: DeleteVariables) => deleteSticky(variables),
    onMutate: async ({ workspaceId, stickyId }) => {
      await queryClient.cancelQueries({
        queryKey: stickiesKeyPrefix(workspaceId),
      });
      const previous = snapshotLists(queryClient, workspaceId);
      editLists(queryClient, workspaceId, (data) =>
        removeStickyFromData(data, stickyId),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      restoreLists(queryClient, context?.previous);
    },
    onSettled: (_data, _error, { workspaceId }) => {
      queryClient.invalidateQueries({
        queryKey: stickiesKeyPrefix(workspaceId),
      });
    },
  });
}

type ReorderVariables = {
  workspaceId: string;
  queryKey: QueryKey;
  stickyIds: string[];
};

/**
 * Reorders the loaded stickies of one list at once, then saves. Stickies not
 * loaded yet keep their rank on the server.
 */
export function useReorderStickies() {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: ({ workspaceId, stickyIds }: ReorderVariables) =>
      reorderStickies({ workspaceId, stickyIds }),
    onMutate: ({ workspaceId, queryKey, stickyIds }) => {
      const previous = snapshotLists(queryClient, workspaceId);
      void queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData<ListData>(queryKey, (data) =>
        reorderStickiesInData(data, stickyIds),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      restoreLists(queryClient, context?.previous);
    },
    onSettled: (_data, _error, { workspaceId }) => {
      queryClient.invalidateQueries({
        queryKey: stickiesKeyPrefix(workspaceId),
      });
    },
  });
}
