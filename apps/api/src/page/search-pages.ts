import { and, desc, eq, isNull, or, type SQL, sql } from "drizzle-orm";
import db from "../database";
import {
  pageTable,
  projectTable,
  userTable,
  workspaceTable,
} from "../database/schema";
import { projectFeatureEnabledCondition } from "../project/features";
import { notHiddenProject } from "../project/visibility";
import {
  headlineOf,
  indexedMatch,
  parseHeadline,
  parseTextQuery,
  type SearchSnippet,
  type TextQuery,
  tieredScore,
} from "../search/text-query";
import { buildSearchSnippet } from "./snippet";

export type PageSearchResult = {
  id: string;
  type: "page";
  title: string;
  content?: string;
  snippet?: SearchSnippet;
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

const pageSearchTsv = sql`${pageTable}.search_tsv`;
const pagePendingTsv = sql`margaya_page_search_tsv(${pageTable.title}, ${pageTable.contentText})`;

/**
 * Pages matching `query` by full text, ranked: a title match scores 3 and a
 * content match 2, plus the `ts_rank` (below 1). Only pages in the
 * workspace's projects with Pages on, not archived, and visible to the
 * caller (public, or their own). `content` is a ~160 character plain
 * snippet around the first literal match; `snippet` is the highlighted
 * `ts_headline` excerpt.
 */
export async function searchPages({
  userId,
  workspaceId,
  projectId,
  query,
  limit,
  hidden = [],
}: {
  userId: string;
  workspaceId: string;
  projectId?: string;
  query: string | TextQuery;
  limit: number;
  /** Restricted projects the caller may not see (project/visibility.ts). */
  hidden?: readonly string[];
}): Promise<PageSearchResult[]> {
  const text = typeof query === "string" ? parseTextQuery(query) : query;
  const tsv = sql`coalesce(${pageSearchTsv}, ${pagePendingTsv})`;
  const relevance = tieredScore(tsv, sql`${pageTable.title}`, text, {
    titleWeighted: true,
  });

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
      headline: headlineOf(sql`${pageTable.contentText}`, text).as("headline"),
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
        notHiddenProject(projectTable.id, hidden),
        isNull(pageTable.archivedAt),
        or(eq(pageTable.access, "public"), eq(pageTable.ownerId, userId)),
        indexedMatch(pageSearchTsv, pagePendingTsv, text, [
          sql`${pageTable.title}`,
          sql`${pageTable.contentText}`,
        ]),
      ) as SQL,
    )
    .orderBy(desc(relevance), desc(pageTable.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    type: "page" as const,
    title: row.title || "Untitled",
    content: row.contentText
      ? buildSearchSnippet(row.contentText, text.raw)
      : undefined,
    snippet: row.contentText ? parseHeadline(row.headline) : undefined,
    projectId: row.projectId ?? undefined,
    projectName: row.projectName,
    projectSlug: row.projectSlug,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    userId: row.userId ?? undefined,
    userName: row.userName ?? undefined,
    createdAt: row.createdAt,
    relevanceScore: Number(row.relevanceScore),
  }));
}
