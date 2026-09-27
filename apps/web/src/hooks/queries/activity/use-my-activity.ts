import { useInfiniteQuery } from "@tanstack/react-query";
import getMemberActivity from "@/fetchers/activity/get-member-activity";
import getMyActivity from "@/fetchers/activity/get-my-activity";

/**
 * Recent activity in a workspace, 10 rows per page: the current user's own,
 * or a member's (their profile) when `userId` is given.
 */
function useMyActivity(workspaceId: string | undefined, userId?: string) {
  return useInfiniteQuery({
    queryKey: userId
      ? ["member-activity", workspaceId, userId]
      : ["my-activity", workspaceId],
    queryFn: ({ pageParam }) =>
      userId
        ? getMemberActivity({
            workspaceId: workspaceId ?? "",
            userId,
            cursor: pageParam,
          })
        : getMyActivity({ workspaceId: workspaceId ?? "", cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(workspaceId),
  });
}

export default useMyActivity;
