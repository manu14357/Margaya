import { eq } from "drizzle-orm";
import { taskLinkTable } from "../../database/schema";
import { selectTaskLinks } from "../serialize";

/** Newest first, each with its creator. */
async function listTaskLinks(taskId: string) {
  return selectTaskLinks(eq(taskLinkTable.taskId, taskId));
}

export default listTaskLinks;
