import { listAllWorkspaceMembers } from "./list-all-workspace-members";

export type GetActiveWorkspaceUsersRequest = {
  workspaceId: string;
};

async function getActiveWorkspaceUsers({
  workspaceId,
}: GetActiveWorkspaceUsersRequest) {
  // All of them: the server's default page stops at 100.
  return (await listAllWorkspaceMembers(workspaceId)) || [];
}

export default getActiveWorkspaceUsers;
