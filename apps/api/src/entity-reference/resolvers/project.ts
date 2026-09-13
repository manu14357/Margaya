import { and, eq, inArray } from "drizzle-orm";
import db from "../../database";
import { projectTable } from "../../database/schema";
import { type EntityResolver, type EntitySummary, trashedFlag } from "../types";

export const resolveProjects: EntityResolver = async ({ workspaceId }, ids) => {
  const rows = await db
    .select({
      id: projectTable.id,
      name: projectTable.name,
      slug: projectTable.slug,
      icon: projectTable.icon,
      archivedAt: projectTable.archivedAt,
      deletedAt: projectTable.deletedAt,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        inArray(projectTable.id, ids),
      ),
    );

  return new Map(
    rows.map((project): [string, EntitySummary] => [
      project.id,
      {
        type: "project",
        id: project.id,
        name: project.name,
        key: project.slug,
        icon: project.icon,
        projectId: project.id,
        projectName: project.name,
        isArchived: project.archivedAt !== null,
        ...trashedFlag(project.deletedAt),
        feature: null,
        details: null,
      },
    ]),
  );
};
