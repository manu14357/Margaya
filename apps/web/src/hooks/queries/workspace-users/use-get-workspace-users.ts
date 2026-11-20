import { useQuery } from "@tanstack/react-query";
import { listAllWorkspaceMembers } from "@/fetchers/workspace-user/list-all-workspace-members";
import { AUTH_READ, authClient } from "@/lib/auth-client";

type GetWorkspaceUsersRequest = {
  workspaceId?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  filterField?: string;
  filterOperator?: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains";
  filterValue?: string;
};

function useGetWorkspaceUsers({
  workspaceId,
  limit,
  offset,
  sortBy,
  sortDirection,
  filterField,
  filterOperator,
  filterValue,
}: GetWorkspaceUsersRequest) {
  return useQuery({
    queryKey: [
      "workspace-users",
      workspaceId,
      limit,
      offset,
      sortBy,
      sortDirection,
      filterField,
      filterOperator,
      filterValue,
    ],
    enabled: !!workspaceId,
    queryFn: async () => {
      // No page asked for: the whole list (actor names, pickers), not the
      // server's default first 100.
      const wholeList =
        limit === undefined &&
        offset === undefined &&
        filterField === undefined &&
        sortBy === undefined;
      if (wholeList && workspaceId) {
        const data = await listAllWorkspaceMembers(workspaceId);
        return data?.members ?? [];
      }

      const { data, error } = await authClient.organization.listMembers({
        query: {
          organizationId: workspaceId,
        },
        fetchOptions: AUTH_READ,
      });

      if (error) {
        throw new Error(error.message || "Failed to get workspace users");
      }

      return data.members;
    },
  });
}

export default useGetWorkspaceUsers;
