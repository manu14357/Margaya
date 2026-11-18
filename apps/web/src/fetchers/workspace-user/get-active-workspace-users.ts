import { AUTH_READ, authClient } from "@/lib/auth-client";

export type GetActiveWorkspaceUsersRequest = {
  workspaceId: string;
};

async function getActiveWorkspaceUsers({
  workspaceId,
}: GetActiveWorkspaceUsersRequest) {
  const { data, error } = await authClient.organization.listMembers({
    query: {
      organizationId: workspaceId,
    },
    fetchOptions: AUTH_READ,
  });

  if (error) {
    throw new Error(error.message || "Failed to fetch workspace users");
  }

  return data || [];
}

export default getActiveWorkspaceUsers;
