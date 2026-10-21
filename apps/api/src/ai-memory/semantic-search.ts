import {
  and,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { resolveAiScopeFor } from "../ai/context";
import { resolveEmbeddingDestination } from "../ai/embedding-endpoint";
import { AiError } from "../ai/errors";
import { aiEmbed } from "../ai/gateway";
import { getAiInstanceConfig } from "../ai/instance-config";
import { loadWorkspaceAiPolicy } from "../ai/workspace-settings";
import db from "../database";
import {
  activityTable,
  columnTable,
  pageTable,
  projectTable,
  taskTable,
} from "../database/schema";
import { projectFeatureEnabledCondition } from "../project/features";
import {
  memberPermissionCheck,
  searchWorkspace,
  WORKSPACE_SEARCH_TYPES,
  type WorkspaceSearchHit,
  type WorkspaceSearchType,
} from "../search/search-workspace";
import { EXACT_KEY_SCORE } from "../search/sources";
import {
  inTriageColumnSql,
  liveTaskCondition,
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";
import { formatTaskKey } from "../task-activity/task-snapshot";
import { isVectorStoreReady, vectorCast } from "./vector-store";

// Semantic and hybrid retrieval (D1).
//
// `hybridSearchWorkspace` is `searchWorkspace` plus nearest neighbours by
// embedding, merged with Reciprocal Rank Fusion. Without pgvector, without
// an embeddings endpoint, with semantic search off for the workspace, or
// when the query can't be embedded (budget, routing, endpoint down), it
// returns exactly what `searchWorkspace` returns.
//
// Permission filtering is the same as full-text search and happens in SQL:
// neighbours are looked up only in projects the caller may see and AI may
// read (the AI scope: hidden, trashed, AI-off and, unless the workspace
// includes them, restricted projects are left out), and every hit is then
// loaded through the same conditions as `searchWorkspace` (live tasks, no
// triage, pages public or own, not archived, Pages on, page:read).

/** Reciprocal Rank Fusion constant (the usual 60). */
export const RRF_K = 60;
/** Semantic-only hits score in [1, 2): below every full-text match. */
export const SEMANTIC_BASE_SCORE = 1;
const DEFAULT_MIN_SIMILARITY = 0.3;
const DUPLICATE_MIN_SIMILARITY = 0.5;
const MAX_QUERY_CHARS = 2000;

export function minSimilarity(): number {
  const value = Number(process.env.MARGAYA_AI_SEMANTIC_MIN_SIMILARITY);
  return Number.isFinite(value) && value >= -1 && value <= 1
    ? value
    : DEFAULT_MIN_SIMILARITY;
}

export type SemanticHit = WorkspaceSearchHit & {
  /** Cosine similarity of the best chunk, -1 to 1. */
  similarity: number;
};

type PermissionCheck = (permissions: Record<string, string[]>) => boolean;

export type SemanticSearchInput = {
  userId: string;
  workspaceId: string;
  query: string;
  types?: readonly WorkspaceSearchType[];
  limit?: number;
  projectId?: string;
  can?: PermissionCheck;
  /** Leave out neighbours less similar than this (default from env, 0.3). */
  minSimilarity?: number;
};

const clampLimit = (limit: number | undefined) =>
  Math.min(Math.max(Math.trunc(limit ?? 20) || 1, 1), 50);

/** What semantic search needs, or null when it is off or not ready. */
export async function semanticReadiness(workspaceId: string) {
  const instance = getAiInstanceConfig();
  if (!instance.enabled) return null;
  const policy = await loadWorkspaceAiPolicy(workspaceId);
  if (!policy.enabled || !policy.embeddingsEnabled) return null;
  if (!(await isVectorStoreReady())) return null;
  const destination = await resolveEmbeddingDestination(instance);
  if (!destination) return null;
  const any = await db.execute(sql`
    SELECT 1 FROM ai_embedding
    WHERE workspace_id = ${workspaceId} AND model = ${destination.model}
    LIMIT 1`);
  if ((any.rowCount ?? 0) === 0) return null;
  return { policy, model: destination.model };
}

type Nearest = { type: WorkspaceSearchType; id: string; distance: number };

async function nearest(input: {
  workspaceId: string;
  model: string;
  vector: number[];
  projectIds: string[];
  types: WorkspaceSearchType[];
  k: number;
}): Promise<Nearest[]> {
  const dims = input.vector.length;
  const cast = vectorCast(dims);
  const literal = JSON.stringify(input.vector);
  const column = cast
    ? sql.raw(`e.embedding::${cast}`)
    : sql.raw("e.embedding");
  const probe = cast
    ? sql`${literal}::${sql.raw(cast)}`
    : sql`${literal}::vector`;
  return db.transaction(async (tx) => {
    // Filtered HNSW scans: look further than the default 40 candidates, and
    // keep scanning past filtered-out rows where pgvector supports it.
    for (const setting of [
      sql`SET LOCAL hnsw.ef_search = 100`,
      sql`SET LOCAL hnsw.iterative_scan = relaxed_order`,
    ]) {
      await tx
        .transaction(async (savepoint) => {
          await savepoint.execute(setting);
        })
        .catch(() => undefined);
    }
    const result = await tx.execute<{
      type: WorkspaceSearchType;
      id: string;
      distance: number;
    }>(sql`
      SELECT n.entity_type AS type, n.entity_id AS id, min(n.distance) AS distance
      FROM (
        SELECT e.entity_type, e.entity_id, ${column} <=> ${probe} AS distance
        FROM ai_embedding e
        WHERE e.workspace_id = ${input.workspaceId}
          AND e.model = ${input.model}
          AND e.dims = ${dims}
          AND ${inArray(sql`e.project_id`, input.projectIds)}
          AND ${inArray(sql`e.entity_type`, input.types)}
        ORDER BY ${column} <=> ${probe}
        LIMIT ${input.k}
      ) n
      GROUP BY n.entity_type, n.entity_id
      ORDER BY min(n.distance)`);
    return result.rows.map((row) => ({
      type: row.type,
      id: row.id,
      distance: Number(row.distance),
    }));
  });
}

async function loadTaskHits(ids: string[], projectIds: string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      projectId: taskTable.projectId,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      taskNumber: taskTable.number,
      status: taskTable.status,
      userId: taskTable.userId,
      createdAt: taskTable.createdAt,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        inArray(taskTable.id, ids),
        inArray(projectTable.id, projectIds),
        isNull(projectTable.deletedAt),
        sql`not ${inTriageColumnSql}`,
        liveTaskCondition,
      ),
    );
  return rows.map(
    (row): WorkspaceSearchHit => ({
      type: "task",
      id: row.id,
      title: row.title,
      score: SEMANTIC_BASE_SCORE,
      projectId: row.projectId,
      projectName: row.projectName,
      projectSlug: row.projectSlug,
      taskId: row.id,
      taskNumber: row.taskNumber ?? undefined,
      status: row.status,
      userId: row.userId,
      createdAt: row.createdAt,
    }),
  );
}

async function loadCommentHits(ids: string[], projectIds: string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: activityTable.id,
      taskId: activityTable.taskId,
      taskTitle: taskTable.title,
      taskNumber: taskTable.number,
      projectId: projectTable.id,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      userId: activityTable.userId,
      createdAt: activityTable.createdAt,
    })
    .from(activityTable)
    .innerJoin(taskTable, eq(activityTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        inArray(activityTable.id, ids),
        eq(activityTable.type, "comment"),
        inArray(projectTable.id, projectIds),
        isNull(projectTable.deletedAt),
        sql`not ${inTriageColumnSql}`,
        liveTaskCondition,
      ),
    );
  return rows.map(
    (row): WorkspaceSearchHit => ({
      type: "comment",
      id: row.id,
      title: row.taskTitle ?? "",
      score: SEMANTIC_BASE_SCORE,
      projectId: row.projectId,
      projectName: row.projectName,
      projectSlug: row.projectSlug,
      taskId: row.taskId,
      taskNumber: row.taskNumber ?? undefined,
      userId: row.userId,
      createdAt: row.createdAt,
    }),
  );
}

async function loadPageHits(
  ids: string[],
  projectIds: string[],
  workspaceId: string,
  userId: string,
) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: pageTable.id,
      title: pageTable.title,
      projectId: pageTable.projectId,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      userId: pageTable.ownerId,
      createdAt: pageTable.createdAt,
    })
    .from(pageTable)
    .innerJoin(projectTable, eq(projectTable.id, pageTable.projectId))
    .where(
      and(
        inArray(pageTable.id, ids),
        eq(pageTable.workspaceId, workspaceId),
        inArray(projectTable.id, projectIds),
        projectFeatureEnabledCondition("pages"),
        isNull(pageTable.archivedAt),
        or(eq(pageTable.access, "public"), eq(pageTable.ownerId, userId)),
      ) as SQL,
    );
  return rows.map(
    (row): WorkspaceSearchHit => ({
      type: "page",
      id: row.id,
      title: row.title || "Untitled",
      score: SEMANTIC_BASE_SCORE,
      projectId: row.projectId ?? null,
      projectName: row.projectName ?? null,
      projectSlug: row.projectSlug ?? null,
      userId: row.userId ?? null,
      createdAt: row.createdAt,
    }),
  );
}

/**
 * Nearest tasks, pages and comments by meaning, permission-filtered like
 * `searchWorkspace`. Returns null when semantic search is unavailable for
 * the workspace (the caller then uses full-text results alone).
 */
export async function semanticSearchWorkspace(
  input: SemanticSearchInput,
): Promise<SemanticHit[] | null> {
  const text = input.query.trim().slice(0, MAX_QUERY_CHARS);
  if (!text) return [];
  const capped = clampLimit(input.limit);
  // Readiness first: workspaces without semantic search pay one read.
  const ready = await semanticReadiness(input.workspaceId);
  if (!ready) return null;
  const member = await memberPermissionCheck(input.userId, input.workspaceId);
  if (!member) return [];

  const scope = await resolveAiScopeFor({
    workspaceId: input.workspaceId,
    userId: input.userId,
    can: input.can ?? member,
    includeRestricted: ready.policy.includeRestricted,
  });
  const projectIds = [...scope.projectIds].filter(
    (id) => !input.projectId || id === input.projectId,
  );
  const types = (input.types ?? WORKSPACE_SEARCH_TYPES).filter((type) =>
    type === "page" ? scope.can.readPages : scope.can.readTasks,
  );
  if (projectIds.length === 0 || types.length === 0) return [];

  let embedded: Awaited<ReturnType<typeof aiEmbed>>;
  try {
    embedded = await aiEmbed({
      workspaceId: input.workspaceId,
      userId: input.userId,
      texts: [text],
      dataTier: "private",
    });
  } catch (error) {
    if (error instanceof AiError) return null;
    throw error;
  }
  const vector = embedded.vectors[0];
  if (!vector || embedded.model !== ready.model) return null;

  const neighbours = await nearest({
    workspaceId: input.workspaceId,
    model: ready.model,
    vector,
    projectIds,
    types,
    k: Math.min(capped * 4, 200),
  });
  const threshold = input.minSimilarity ?? minSimilarity();
  const similar = neighbours
    .map((row) => ({ ...row, similarity: 1 - row.distance }))
    .filter((row) => row.similarity >= threshold);
  const idsOf = (type: WorkspaceSearchType) =>
    similar.filter((row) => row.type === type).map((row) => row.id);

  const [tasks, comments, pages] = await Promise.all([
    loadTaskHits(idsOf("task"), projectIds),
    loadCommentHits(idsOf("comment"), projectIds),
    loadPageHits(idsOf("page"), projectIds, input.workspaceId, input.userId),
  ]);
  const loaded = new Map(
    [...tasks, ...comments, ...pages].map((hit) => [
      `${hit.type}:${hit.id}`,
      hit,
    ]),
  );
  const hits: SemanticHit[] = [];
  for (const row of similar) {
    const hit = loaded.get(`${row.type}:${row.id}`);
    if (!hit) continue;
    hits.push({
      ...hit,
      // Below every full-text match (2+), ordered by similarity.
      score: SEMANTIC_BASE_SCORE + Math.max(0, row.similarity) * 0.99,
      similarity: row.similarity,
    });
    if (hits.length >= capped) break;
  }
  return hits;
}

const hitKey = (hit: { type: string; id: string }) => `${hit.type}:${hit.id}`;

/**
 * Reciprocal Rank Fusion of full-text and semantic hits. An exact task key
 * stays first; a hit in both lists keeps its full-text fields (snippet).
 */
export function fuseHits(
  lexical: readonly WorkspaceSearchHit[],
  semantic: readonly WorkspaceSearchHit[],
  limit: number,
  k = RRF_K,
): WorkspaceSearchHit[] {
  const merged = new Map<
    string,
    { hit: WorkspaceSearchHit; fused: number; pinned: boolean }
  >();
  lexical.forEach((hit, index) => {
    merged.set(hitKey(hit), {
      hit,
      fused: 1 / (k + index + 1),
      pinned: hit.score >= EXACT_KEY_SCORE,
    });
  });
  semantic.forEach((hit, index) => {
    const entry = merged.get(hitKey(hit));
    if (entry) entry.fused += 1 / (k + index + 1);
    else
      merged.set(hitKey(hit), {
        hit,
        fused: 1 / (k + index + 1),
        pinned: false,
      });
  });
  return [...merged.values()]
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.fused - a.fused ||
        b.hit.score - a.hit.score ||
        b.hit.createdAt.getTime() - a.hit.createdAt.getTime(),
    )
    .slice(0, limit)
    .map((entry) => entry.hit);
}

export type HybridSearchInput = Parameters<typeof searchWorkspace>[0] & {
  /** Text to embed (e.g. the whole question); default `query`. */
  semanticQuery?: string;
};

/**
 * `searchWorkspace` with semantic neighbours fused in when the workspace has
 * semantic search; otherwise exactly `searchWorkspace`.
 */
export async function hybridSearchWorkspace(
  input: HybridSearchInput,
): Promise<WorkspaceSearchHit[]> {
  const { semanticQuery, ...search } = input;
  const capped = clampLimit(search.limit);
  const [lexical, semantic] = await Promise.all([
    searchWorkspace(search),
    semanticSearchWorkspace({
      ...search,
      query: semanticQuery?.trim() || search.query,
      limit: capped,
    }).catch((error) => {
      console.error("Semantic search failed; using full-text results", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }),
  ]);
  if (!semantic || semantic.length === 0) return lexical;
  return fuseHits(lexical, semantic, capped);
}

/**
 * Open tasks of a project close in meaning to a draft (duplicate check):
 * the same shape as `findSimilarTasks`, empty when semantic search is off.
 */
export async function semanticSimilarTasks(input: {
  workspaceId: string;
  userId: string;
  projectId: string;
  text: string;
  can?: PermissionCheck;
  limit: number;
}): Promise<
  {
    id: string;
    number: number | null;
    key: string;
    title: string;
    status: string;
  }[]
> {
  const hits = await semanticSearchWorkspace({
    userId: input.userId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    types: ["task"],
    query: input.text,
    limit: Math.min(input.limit * 3, 50),
    can: input.can,
    minSimilarity: Math.max(minSimilarity(), DUPLICATE_MIN_SIMILARITY),
  }).catch(() => null);
  if (!hits || hits.length === 0) return [];
  const rows = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        eq(taskTable.projectId, input.projectId),
        inArray(
          taskTable.id,
          hits.map((hit) => hit.id),
        ),
        visibleTaskCondition,
        notInArray(taskGroupSql, ["completed", "cancelled"]),
      ),
    );
  const open = new Set(rows.map((row) => row.id));
  return hits
    .filter((hit) => open.has(hit.id))
    .slice(0, input.limit)
    .map((hit) => ({
      id: hit.id,
      number: hit.taskNumber ?? null,
      key: formatTaskKey(hit.projectSlug ?? "", hit.taskNumber ?? null),
      title: hit.title,
      status: hit.status ?? "",
    }));
}
