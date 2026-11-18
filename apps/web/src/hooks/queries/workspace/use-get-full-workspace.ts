import { useQuery } from "@tanstack/react-query";
import { AUTH_READ, authClient } from "@/lib/auth-client";

type GetFullWorkspaceRequest = {
  workspaceId?: string;
  workspaceSlug?: string;
  membersLimit?: number;
};

function useGetFullWorkspace({
  workspaceId,
  workspaceSlug,
  membersLimit = 100,
}: GetFullWorkspaceRequest) {
  return useQuery({
    queryKey: ["workspace", "full", workspaceId || workspaceSlug],
    enabled: !!(workspaceId || workspaceSlug),
    queryFn: async () => {
      const { data, error } = await authClient.organization.getFullOrganization(
        {
          query: {
            organizationId: workspaceId,
            membersLimit,
          },
          fetchOptions: AUTH_READ,
        },
      );

      if (error) {
        throw new Error(error.message || "Failed to get full workspace");
      }

      return data;
    },
  });
}

export default useGetFullWorkspace;
