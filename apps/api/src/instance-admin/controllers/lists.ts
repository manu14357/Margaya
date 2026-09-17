import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import db from "../../database";
import {
  projectPublicationTable,
  projectTable,
  userTable,
  workspaceTable,
  workspaceUserTable,
} from "../../database/schema";
import {
  afterKeyset,
  decodeKeyset,
  encodeKeyset,
  timeKey,
} from "../../publication/keyset";

type PageQuery = { search?: string; cursor?: string; limit: number };

function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** A4: every workspace, newest first, with owner and counts. */
export async function listInstanceWorkspaces({
  search,
  cursor,
  limit,
}: PageQuery) {
  const conditions = [];
  if (search) {
    const pattern = likePattern(search);
    conditions.push(
      or(
        ilike(workspaceTable.name, pattern),
        ilike(workspaceTable.slug, pattern),
      ),
    );
  }
  if (cursor) {
    conditions.push(
      afterKeyset(
        workspaceTable.createdAt,
        workspaceTable.id,
        decodeKeyset(cursor),
        "desc",
      ),
    );
  }

  const rows = await db
    .select({
      id: workspaceTable.id,
      name: workspaceTable.name,
      slug: workspaceTable.slug,
      logo: workspaceTable.logo,
      createdAt: workspaceTable.createdAt,
      at: timeKey(workspaceTable.createdAt),
      // Qualified by hand: drizzle renders bare column names in a
      // single-table select, which a correlated subquery would capture.
      memberCount: sql<number>`(select count(*) from "workspace_member" wm where wm."workspace_id" = "workspace"."id")`,
      projectCount: sql<number>`(select count(*) from "project" p where p."workspace_id" = "workspace"."id")`,
    })
    .from(workspaceTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(workspaceTable.createdAt), desc(workspaceTable.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const owners = new Map<string, { id: string; name: string; email: string }>();
  if (page.length > 0) {
    const ownerRows = await db
      .select({
        workspaceId: workspaceUserTable.workspaceId,
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
      })
      .from(workspaceUserTable)
      .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
      .where(
        and(
          inArray(
            workspaceUserTable.workspaceId,
            page.map((row) => row.id),
          ),
          eq(workspaceUserTable.role, "owner"),
        ),
      )
      .orderBy(asc(workspaceUserTable.joinedAt), asc(workspaceUserTable.id));
    for (const owner of ownerRows) {
      if (!owners.has(owner.workspaceId)) {
        owners.set(owner.workspaceId, {
          id: owner.id,
          name: owner.name,
          email: owner.email,
        });
      }
    }
  }

  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      logo: row.logo,
      createdAt: row.createdAt,
      owner: owners.get(row.id) ?? null,
      memberCount: Number(row.memberCount),
      projectCount: Number(row.projectCount),
    })),
    nextCursor:
      rows.length > limit && last ? encodeKeyset(last.at, last.id) : null,
  };
}

/** A9: published boards, newest first. */
export async function listInstancePublicBoards({
  search,
  cursor,
  limit,
}: PageQuery) {
  // A trashed project's board is gone (C7).
  const conditions = [
    isNotNull(projectPublicationTable.publishedAt),
    isNull(projectTable.deletedAt),
  ];
  if (search) {
    const pattern = likePattern(search);
    const match = or(
      ilike(projectTable.name, pattern),
      ilike(workspaceTable.name, pattern),
    );
    if (match) conditions.push(match);
  }
  if (cursor) {
    conditions.push(
      afterKeyset(
        projectPublicationTable.publishedAt,
        projectPublicationTable.projectId,
        decodeKeyset(cursor),
        "desc",
      ),
    );
  }

  const rows = await db
    .select({
      projectId: projectPublicationTable.projectId,
      projectName: projectTable.name,
      workspaceId: workspaceTable.id,
      workspaceName: workspaceTable.name,
      publishedAt: projectPublicationTable.publishedAt,
      at: timeKey(projectPublicationTable.publishedAt),
      linkToken: projectPublicationTable.linkToken,
      comments: projectPublicationTable.commentsEnabled,
      reactions: projectPublicationTable.reactionsEnabled,
      votes: projectPublicationTable.votesEnabled,
      requests: projectPublicationTable.requestsEnabled,
      guests: projectPublicationTable.allowGuests,
    })
    .from(projectPublicationTable)
    .innerJoin(
      projectTable,
      eq(projectTable.id, projectPublicationTable.projectId),
    )
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .where(and(...conditions))
    .orderBy(
      desc(projectPublicationTable.publishedAt),
      desc(projectPublicationTable.projectId),
    )
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      projectId: row.projectId,
      projectName: row.projectName,
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceName,
      publishedAt: row.publishedAt ?? new Date(0),
      path: `/public-project/${row.linkToken}`,
      features: {
        comments: row.comments,
        reactions: row.reactions,
        votes: row.votes,
        requests: row.requests,
        guests: row.guests,
      },
    })),
    nextCursor:
      rows.length > limit && last
        ? encodeKeyset(last.at, last.projectId)
        : null,
  };
}
