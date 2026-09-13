import { and, desc, eq, ilike, isNull, or, type SQL, sql } from "drizzle-orm";
import db from "../database";
import {
  pageTable,
  projectTable,
  userTable,
  workspaceTable,
} from "../database/schema";
import { projectFeatureEnabledCondition } from "../project/features";
import { escapeLikePattern } from "../search/like-pattern";
import { buildSearchSnippet } from "./snippet";

export type PageSearchResult = {
  id: string;
  type: "page";
  title: string;
  content?: string;
  projectId?: string;
  projectName?: string;
  projectSlug?: string;
  workspaceId?: string;
  workspaceName?: string;
  userId?: string;
  userName?: string;
  createdAt: Date;
  relevanceScore: number;
};

/**
 * Pages matching `query` by title (score 3) or content (score 2), in the
 * workspace's projects with Pages on, not archived, and visible to the
 * caller (public, or their own). The content field is a ~160 character
 * snippet around the first match.
 */
export async function searchPages({
  userId,
  workspaceId,
  projectId,
  query,
  limit,
}: {
  userId: string;
  workspaceId: string;
  projectId?: string;
  query: string;
  limit: number;
}): Promise<PageSearchResult[]> {
  const lowered = query.toLowerCase();
  const pattern = `%${escapeLikePattern(lowered)}%`;
  const relevance = sql<number>`case when ${pageTable.title} ilike ${pattern} then 3 else 2 end`;

  const rows = await db
    .select({
      id: pageTable.id,
      title: pageTable.title,
      contentText: pageTable.contentText,
      projectId: pageTable.projectId,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      workspaceId: pageTable.workspaceId,
      workspaceName: workspaceTable.name,
      userId: pageTable.ownerId,
      userName: userTable.name,
      createdAt: pageTable.createdAt,
      relevanceScore: relevance.as("relevanceScore"),
    })
    .from(pageTable)
    .innerJoin(projectTable, eq(projectTable.id, pageTable.projectId))
    .innerJoin(workspaceTable, eq(workspaceTable.id, pageTable.workspaceId))
    .leftJoin(userTable, eq(userTable.id, pageTable.ownerId))
    .where(
      and(
        eq(pageTable.workspaceId, workspaceId),
        projectId ? eq(pageTable.projectId, projectId) : undefined,
        projectFeatureEnabledCondition("pages"),
        isNull(pageTable.archivedAt),
        or(eq(pageTable.access, "public"), eq(pageTable.ownerId, userId)),
        or(
          ilike(pageTable.title, pattern),
          ilike(pageTable.contentText, pattern),
        ),
      ) as SQL,
    )
    .orderBy(desc(relevance), desc(pageTable.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    type: "page" as const,
    title: row.title || "Untitled",
    content: row.contentText
      ? buildSearchSnippet(row.contentText, query)
      : undefined,
    projectId: row.projectId ?? undefined,
    projectName: row.projectName,
    projectSlug: row.projectSlug,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    userId: row.userId ?? undefined,
    userName: row.userName ?? undefined,
    createdAt: row.createdAt,
    relevanceScore: row.relevanceScore,
  }));
}
