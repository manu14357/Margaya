import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { HomeWidget } from "@/components/home/home-widgets";
import updateHomePreferences from "@/fetchers/home/update-home-preferences";
import {
  type HomePreferences,
  homePreferencesQueryKey,
} from "@/hooks/queries/home/use-get-home-preferences";

type Variables = { workspaceId: string; widgets: HomeWidget[] };

/**
 * Saves the full ordered widget list. The cache changes first so Home
 * re-renders at once; a failure restores the previous list.
 */
function useUpdateHomePreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { refreshTaskQueries: false },
    mutationFn: ({ workspaceId, widgets }: Variables) =>
      updateHomePreferences({ workspaceId, widgets }),
    onMutate: async ({ workspaceId, widgets }) => {
      const queryKey = homePreferencesQueryKey(workspaceId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<HomePreferences>(queryKey);
      queryClient.setQueryData<HomePreferences>(queryKey, {
        workspaceId,
        updatedAt: previous?.updatedAt ?? null,
        widgets,
      });
      return { previous };
    },
    onError: (_error, { workspaceId }, context) => {
      queryClient.setQueryData(
        homePreferencesQueryKey(workspaceId),
        context?.previous,
      );
    },
    onSuccess: (saved, { workspaceId }) => {
      queryClient.setQueryData(homePreferencesQueryKey(workspaceId), saved);
    },
    onSettled: (_data, _error, { workspaceId }) => {
      queryClient.invalidateQueries({
        queryKey: homePreferencesQueryKey(workspaceId),
      });
    },
  });
}

export default useUpdateHomePreferences;
