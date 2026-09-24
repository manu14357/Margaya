import { useQuery } from "@tanstack/react-query";
import getWorkspaceMember from "@/fetchers/workspace-user/get-workspace-member";
import { HttpError } from "@/lib/http-error";

/** One member's profile header; a 404 (not a member) is not retried. */
export function useWorkspaceMember(workspaceId: string, userId: string) {
  return useQuery({
    queryKey: ["workspace-member", workspaceId, userId],
    queryFn: () => getWorkspaceMember(workspaceId, userId),
    enabled: Boolean(workspaceId && userId),
    retry: (count, error) =>
      !(error instanceof HttpError && error.status < 500) && count < 2,
  });
}
