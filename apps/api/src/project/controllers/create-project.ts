import { eq, max } from "drizzle-orm";
import db from "../../database";
import { columnTable, projectTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { assertProjectSlugAvailable, lockWorkspaceProjects } from "../slug";

export const DEFAULT_PROJECT_COLUMNS = [
  {
    name: "To Do",
    slug: "to-do",
    position: 0,
    group: "unstarted",
    isFinal: false,
  },
  {
    name: "In Progress",
    slug: "in-progress",
    position: 1,
    group: "started",
    isFinal: false,
  },
  {
    name: "In Review",
    slug: "in-review",
    position: 2,
    group: "started",
    isFinal: false,
  },
  {
    name: "Done",
    slug: "done",
    position: 3,
    group: "completed",
    isFinal: true,
  },
] as const;

async function createProject(
  workspaceId: string,
  name: string,
  icon: string,
  slug: string,
  userId?: string,
) {
  const created = await db.transaction(async (tx) => {
    // Serialize ordering writes per workspace: without this, two concurrent
    // creates can read the same max(position) and land on the same slot, and a
    // create can interleave with a reorder's renumber. The lock also makes the
    // key uniqueness check race-free.
    await lockWorkspaceProjects(tx, workspaceId);
    await assertProjectSlugAvailable(tx, workspaceId, slug);

    // New projects go to the bottom of the workspace's ordering.
    const [{ maxPosition } = { maxPosition: null }] = await tx
      .select({ maxPosition: max(projectTable.position) })
      .from(projectTable)
      .where(eq(projectTable.workspaceId, workspaceId));

    const [createdProject] = await tx
      .insert(projectTable)
      .values({
        workspaceId,
        name,
        icon,
        slug,
        position: maxPosition === null ? 0 : maxPosition + 1,
      })
      .returning();

    if (createdProject) {
      for (const col of DEFAULT_PROJECT_COLUMNS) {
        await tx.insert(columnTable).values({
          projectId: createdProject.id,
          name: col.name,
          slug: col.slug,
          position: col.position,
          group: col.group,
          isFinal: col.isFinal,
        });
      }
    }

    return createdProject;
  });

  if (created) {
    await publishEvent("project.created", {
      projectId: created.id,
      workspaceId,
      userId: userId ?? null,
      name: created.name,
      slug: created.slug,
    });
  }
  return created;
}

export default createProject;
