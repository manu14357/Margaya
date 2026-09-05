import { trashProject } from "../../trash/project-trash";
import getProject from "./get-project";

/**
 * Moves a project and its tasks to the trash (C7); project.deleted keeps its
 * meaning of "gone from every list". Permanent deletes go through the trash
 * routes or the auto purge.
 */
async function deleteProject(id: string, workspaceId: string, userId: string) {
  const existingProject = await getProject(id, workspaceId);
  await trashProject(id, workspaceId, userId);
  return existingProject;
}

export default deleteProject;
