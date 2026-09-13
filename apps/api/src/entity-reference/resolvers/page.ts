import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import db from "../../database";
import { pageTable, projectTable } from "../../database/schema";
import { type EntityResolver, type EntitySummary, trashedFlag } from "../types";

// Pages, for the calling user only: someone else's private page never
// resolves, so its title can't leak through favorites or recent visits, and
// it reads as deleted. The pages feature gate applies through `feature`.
export const resolvePages: EntityResolver = async (
  { workspaceId, userId },
  ids,
) => {
  const rows = await db
    .select({
      id: pageTable.id,
      title: pageTable.title,
      logoKind: pageTable.logoKind,
      logoValue: pageTable.logoValue,
      access: pageTable.access,
      ownerId: pageTable.ownerId,
      archivedAt: pageTable.archivedAt,
      projectId: pageTable.projectId,
      projectName: projectTable.name,
      projectArchivedAt: projectTable.archivedAt,
      projectDeletedAt: projectTable.deletedAt,
    })
    .from(pageTable)
    .leftJoin(
      projectTable,
      and(
        eq(projectTable.id, pageTable.projectId),
        eq(projectTable.workspaceId, pageTable.workspaceId),
      ),
    )
    .where(
      and(
        eq(pageTable.workspaceId, workspaceId),
        inArray(pageTable.id, ids),
        or(eq(pageTable.access, "public"), eq(pageTable.ownerId, userId)),
      ) as SQL,
    );

  return new Map(
    rows.map((page): [string, EntitySummary] => [
      page.id,
      {
        type: "page",
        id: page.id,
        name: page.title || "Untitled",
        key: null,
        icon: page.logoValue,
        projectId: page.projectId,
        projectName: page.projectName,
        isArchived: page.archivedAt !== null || page.projectArchivedAt !== null,
        ...trashedFlag(page.projectDeletedAt),
        feature: page.projectId ? "pages" : null,
        details: {
          logoKind: page.logoKind,
          access: page.access,
          ownerId: page.ownerId,
        },
      },
    ]),
  );
};
