import { AUTH_READ, authClient } from "@/lib/auth-client";

const getWorkspaces = async () => {
  const { data, error } = await authClient.organization.list({
    fetchOptions: AUTH_READ,
  });

  if (error) {
    throw new Error(error.message || "Failed to fetch workspaces");
  }

  return data || [];
};

export default getWorkspaces;
