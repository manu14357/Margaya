import { useQuery } from "@tanstack/react-query";
import getFavorites from "@/fetchers/favorite/get-favorites";

export type Favorite = Awaited<ReturnType<typeof getFavorites>>[number];

export function favoritesQueryKey(workspaceId: string) {
  return ["favorites", workspaceId] as const;
}

function useGetFavorites({ workspaceId }: { workspaceId: string }) {
  return useQuery({
    queryKey: favoritesQueryKey(workspaceId),
    queryFn: () => getFavorites(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
}

export default useGetFavorites;
