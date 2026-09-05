import { setProjectArchived } from "./archive-project";

async function unarchiveProject(
  id: string,
  workspaceId: string,
  userId: string,
) {
  return setProjectArchived({ id, workspaceId, userId, archived: false });
}

export default unarchiveProject;
