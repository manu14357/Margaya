import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable } from "../../database/schema";
import { publishEvent } from "../../events";

/**
 * Archives (or, with `archived: false`, restores) a project. A project
 * already in that state is returned unchanged, its archive time included,
 * and nothing is published.
 */
export async function setProjectArchived({
  id,
  workspaceId,
  userId,
  archived,
}: {
  id: string;
  workspaceId: string;
  userId: string;
  archived: boolean;
}) {
  const [existingProject] = await db
    .select()
    .from(projectTable)
    .where(
      and(eq(projectTable.id, id), eq(projectTable.workspaceId, workspaceId)),
    );

  if (!existingProject) {
    throw new HTTPException(404, {
      message:
        "Project doesn't exist or doesn't belong to the specified workspace",
    });
  }

  const [changed] = await db
    .update(projectTable)
    .set({ archivedAt: archived ? new Date() : null })
    .where(
      and(
        eq(projectTable.id, id),
        archived
          ? isNull(projectTable.archivedAt)
          : isNotNull(projectTable.archivedAt),
      ),
    )
    .returning();

  if (!changed) {
    // Already in that state (possibly just now, by someone else).
    const [current] = await db
      .select()
      .from(projectTable)
      .where(eq(projectTable.id, id));
    return current ?? existingProject;
  }

  await publishEvent(archived ? "project.archived" : "project.unarchived", {
    projectId: changed.id,
    workspaceId: changed.workspaceId,
    userId,
  });
  return changed;
}

async function archiveProject(id: string, workspaceId: string, userId: string) {
  return setProjectArchived({ id, workspaceId, userId, archived: true });
}

export default archiveProject;
