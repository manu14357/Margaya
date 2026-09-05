import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  applyLegacyPublicState,
  publishPendingEvent,
} from "../../publication/service";
import {
  assertProjectPeople,
  PROJECT_PEOPLE_FIELDS,
  type ProjectPeople,
} from "../people";
import { assertProjectSlugAvailable, lockWorkspaceProjects } from "../slug";

async function updateProject(
  id: string,
  name: string,
  icon: string,
  slug: string,
  description: string,
  isPublic: boolean,
  workspaceId: string,
  canShare: boolean,
  userId?: string,
  people: ProjectPeople = {},
) {
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

  if (isPublic !== existingProject.isPublic && !canShare) {
    throw new HTTPException(403, {
      message:
        "Changing project visibility requires the project:share permission",
    });
  }

  // Omitted fields keep their value; null clears; an id must be a member.
  const peopleUpdate: ProjectPeople = {};
  for (const field of PROJECT_PEOPLE_FIELDS) {
    if (people[field] !== undefined) peopleUpdate[field] = people[field];
  }
  await assertProjectPeople(workspaceId, peopleUpdate);

  let publicationEvent: Awaited<ReturnType<typeof applyLegacyPublicState>> =
    null;
  const updated = await db.transaction(async (tx) => {
    await lockWorkspaceProjects(tx, workspaceId);
    await assertProjectSlugAvailable(tx, workspaceId, slug, id);
    // B12: isPublic mirrors the publication; publish or unpublish through it.
    if (isPublic !== existingProject.isPublic) {
      publicationEvent = await applyLegacyPublicState(
        tx,
        { projectId: id, workspaceId, userId: userId ?? "" },
        isPublic,
      );
    }

    // Feature flags have their own route and are never touched here.
    const [updatedProject] = await tx
      .update(projectTable)
      .set({
        name,
        icon,
        slug,
        description,
        isPublic,
        ...peopleUpdate,
      })
      .where(eq(projectTable.id, id))
      .returning();

    return updatedProject;
  });

  // Only what changed; a save that changes nothing publishes nothing.
  const changed = (
    [
      "name",
      "icon",
      "slug",
      "description",
      "isPublic",
      ...PROJECT_PEOPLE_FIELDS,
    ] as const
  ).filter(
    (field) =>
      updated &&
      // A new project's description is null; saving "" changes nothing.
      (updated[field] ?? "") !== (existingProject[field] ?? ""),
  );
  await publishPendingEvent(publicationEvent);
  if (updated && changed.length > 0) {
    await publishEvent("project.updated", {
      projectId: id,
      workspaceId,
      userId: userId ?? null,
      changed,
    });
  }
  return updated;
}

export default updateProject;
