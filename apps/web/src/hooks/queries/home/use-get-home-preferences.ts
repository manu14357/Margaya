import { useQuery } from "@tanstack/react-query";
import getHomePreferences, {
  type HomePreferences,
} from "@/fetchers/home/get-home-preferences";

export type { HomePreferences };

export function homePreferencesQueryKey(workspaceId: string) {
  return ["home-preferences", workspaceId] as const;
}

/** The caller's Home widget order and visibility in the workspace. */
function useGetHomePreferences({ workspaceId }: { workspaceId: string }) {
  return useQuery({
    queryKey: homePreferencesQueryKey(workspaceId),
    queryFn: () => getHomePreferences(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
}

export default useGetHomePreferences;
