import { AUTH_READ, authClient } from "@/lib/auth-client";

/**
 * Members per first request. The auth server answers 100 members when no
 * limit is given, which left later members (often a workspace's agents)
 * out of actor names, pickers and filters in larger workspaces.
 */
export const MEMBER_PAGE_SIZE = 500;

async function listMembers(workspaceId: string, limit: number) {
  const { data, error } = await authClient.organization.listMembers({
    query: { organizationId: workspaceId, limit },
    fetchOptions: AUTH_READ,
  });
  if (error) {
    throw new Error(error.message || "Failed to fetch workspace users");
  }
  return data;
}

/**
 * Every member of a workspace: one request for a usual workspace, and a
 * second one for exactly `total` members when the first page falls short.
 * A single request for the rest avoids paging an unsorted list.
 */
export async function listAllWorkspaceMembers(workspaceId: string) {
  const first = await listMembers(workspaceId, MEMBER_PAGE_SIZE);
  if (!first || first.members.length >= first.total) return first;
  return listMembers(workspaceId, first.total);
}
