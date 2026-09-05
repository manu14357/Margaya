import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable } from "../../database/schema";
import getTasks, {
  type GetTasksOptions,
} from "../../task/controllers/get-tasks";

// A project that is not public answers the same 404 as an unknown one, so an
// anonymous caller cannot tell an unpublished project from a missing one.
function notFound(): never {
  throw new HTTPException(404, { message: "Project not found" });
}

export async function getPublicProject(
  id: string,
  options: GetTasksOptions = {},
) {
  const [project] = await db
    .select({
      isPublic: projectTable.isPublic,
      deletedAt: projectTable.deletedAt,
    })
    .from(projectTable)
    .where(eq(projectTable.id, id))
    .limit(1);

  // A trashed project's board is gone (C7).
  if (!project?.isPublic || project.deletedAt) notFound();

  const result = await getTasks(id, options);

  if (!result.data?.isPublic) notFound();

  return { ...result.data, pagination: result.pagination };
}
