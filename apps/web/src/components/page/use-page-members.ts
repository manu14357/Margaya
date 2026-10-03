import { useCallback, useMemo } from "react";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";

export type PageMember = { id: string; name: string; image: string | null };

/**
 * Workspace members by user id. Pages name owners, editors and
 * collaborators from this list only (never from what a socket says).
 */
export function usePageMembers(workspaceId: string) {
  const { data } = useGetActiveWorkspaceUsers(workspaceId);
  const byId = useMemo(() => {
    const map = new Map<string, PageMember>();
    for (const member of data?.members ?? []) {
      map.set(member.userId, {
        id: member.userId,
        name: member.user?.name || member.user?.email || "",
        image: member.user?.image ?? null,
      });
    }
    return map;
  }, [data]);

  const getMember = useCallback(
    (userId: string | null | undefined) =>
      (userId ? byId.get(userId) : undefined) ?? null,
    [byId],
  );

  return { members: byId, getMember, isLoaded: Boolean(data) };
}
