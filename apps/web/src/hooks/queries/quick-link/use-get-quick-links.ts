import { useQuery } from "@tanstack/react-query";
import getQuickLinks, {
  type QuickLink,
} from "@/fetchers/quick-link/get-quick-links";

export type { QuickLink };

export function quickLinksQueryKey(workspaceId: string) {
  return ["quick-links", workspaceId] as const;
}

/** The caller's quick links in the workspace, newest first. */
function useGetQuickLinks({ workspaceId }: { workspaceId: string }) {
  return useQuery({
    queryKey: quickLinksQueryKey(workspaceId),
    queryFn: () => getQuickLinks(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });
}

export default useGetQuickLinks;
