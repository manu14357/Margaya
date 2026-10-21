import { and, eq, type SQL, sql } from "drizzle-orm";
import {
  embeddingRoute,
  resolveEmbeddingDestination,
} from "../ai/embedding-endpoint";
import { AiError, type AiErrorCode } from "../ai/errors";
import { aiEmbed } from "../ai/gateway";
import {
  type AiInstanceConfig,
  getAiInstanceConfig,
} from "../ai/instance-config";
import type { AiDestination } from "../ai/router";
import type { DataTier } from "../ai/types";
import { loadWorkspaceAiPolicy } from "../ai/workspace-settings";
import db from "../database";
import { workspaceAiSettingTable } from "../database/schema";
import { withJobLease } from "../scheduler/leader-lock";
import {
  commentEmbeddingText,
  contentHash,
  pageEmbeddingChunks,
  taskEmbeddingText,
} from "./chunk";
import { ensureVectorIndex, ensureVectorStore } from "./vector-store";

// The background indexer (D1): embeds new and changed tasks, pages and
// comments of workspaces with semantic search on, in small batches under a
// job lease. A row is a candidate when it has no embedding yet, was embedded
// with another model, or changed since (`source_updated_at`); a candidate
// whose text hashes the same (a status move, say) is only re-stamped, never
// re-embedded.
//
// Privacy: restricted projects are embedded only when the workspace includes
// them for AI and the Model Router lets restricted data reach the embeddings
// endpoint; otherwise their embeddings are swept. Projects with AI off,
// trashed tasks, archived pages and intake requests not yet accepted are
// never embedded. Every embedding call goes through the gateway (ledger,
// budget, routing, redaction).

const LEASE = "ai-embedding-index";
const LEASE_MS = 15 * 60 * 1000;
const BATCH_ENTITIES = 32;
const MAX_TEXTS_PER_CALL = 64;
const MAX_ENTITIES_PER_RUN = 2000;
const RUN_BUDGET_MS = 4 * 60 * 1000;

type Kind = "task" | "page" | "comment";
const KINDS: readonly Kind[] = ["task", "comment", "page"];

type CandidateRow = {
  id: string;
  projectId: string;
  visibility: string;
  /** The source's updated_at as Postgres text (exact round trip). */
  updatedAt: string;
  storedHash: string | null;
  storedModel: string | null;
  title: string | null;
  body: string | null;
};

type Document = CandidateRow & {
  type: Kind;
  chunks: string[];
  hash: string;
  tier: DataTier;
};

export type EmbeddingIndexResult = {
  workspaces: number;
  embedded: number;
  unchanged: number;
  removed: number;
};

/** Why a workspace's indexing last stopped early (shown in AI settings). */
const pauses = new Map<string, AiErrorCode>();

export function embeddingIndexPause(workspaceId: string): AiErrorCode | null {
  return pauses.get(workspaceId) ?? null;
}

function tierFilter(allowed: { private: boolean; restricted: boolean }): SQL {
  if (allowed.private && allowed.restricted) return sql`true`;
  if (allowed.restricted) return sql`p.visibility = 'restricted'`;
  if (allowed.private) return sql`p.visibility <> 'restricted'`;
  return sql`false`;
}

const notTriage = sql`NOT EXISTS (
  SELECT 1 FROM "column" c
  WHERE c.project_id = t.project_id AND c.slug = t.status AND c.status_group = 'triage'
)`;

const liveProject = (workspaceId: string) =>
  sql`p.workspace_id = ${workspaceId} AND p.deleted_at IS NULL AND p.ai_enabled`;

function stale(type: Kind, idColumn: SQL, updatedColumn: SQL, model: string) {
  return sql`NOT EXISTS (
    SELECT 1 FROM ai_embedding e
    WHERE e.entity_type = ${type} AND e.entity_id = ${idColumn} AND e.chunk = 0
      AND e.model = ${model}
      AND e.source_updated_at IS NOT DISTINCT FROM ${updatedColumn}
  )`;
}

const storedColumns = (type: Kind, idColumn: SQL) => sql`
  (SELECT e.content_hash FROM ai_embedding e
    WHERE e.entity_type = ${type} AND e.entity_id = ${idColumn} AND e.chunk = 0) AS "storedHash",
  (SELECT e.model FROM ai_embedding e
    WHERE e.entity_type = ${type} AND e.entity_id = ${idColumn} AND e.chunk = 0) AS "storedModel"`;

async function candidates(
  type: Kind,
  workspaceId: string,
  model: string,
  allowed: { private: boolean; restricted: boolean },
): Promise<CandidateRow[]> {
  const scope = sql`${liveProject(workspaceId)} AND ${tierFilter(allowed)}`;
  let query: SQL;
  if (type === "task") {
    query = sql`
      SELECT t.id, t.project_id AS "projectId", p.visibility,
        t.updated_at::text AS "updatedAt", ${storedColumns("task", sql`t.id`)},
        t.title, t.description AS body
      FROM task t JOIN project p ON p.id = t.project_id
      WHERE ${scope} AND t.deleted_at IS NULL AND ${notTriage}
        AND ${stale("task", sql`t.id`, sql`t.updated_at`, model)}
      LIMIT ${BATCH_ENTITIES}`;
  } else if (type === "comment") {
    query = sql`
      SELECT a.id, t.project_id AS "projectId", p.visibility,
        a.updated_at::text AS "updatedAt", ${storedColumns("comment", sql`a.id`)},
        t.title, a.content AS body
      FROM activity a
      JOIN task t ON t.id = a.task_id
      JOIN project p ON p.id = t.project_id
      WHERE ${scope} AND a.type = 'comment'
        AND length(btrim(coalesce(a.content, ''))) > 0
        AND t.deleted_at IS NULL AND ${notTriage}
        AND ${stale("comment", sql`a.id`, sql`a.updated_at`, model)}
      LIMIT ${BATCH_ENTITIES}`;
  } else {
    query = sql`
      SELECT pg.id, pg.project_id AS "projectId", p.visibility,
        pg.updated_at::text AS "updatedAt", ${storedColumns("page", sql`pg.id`)},
        pg.title, pg.content_text AS body
      FROM page pg JOIN project p ON p.id = pg.project_id
      WHERE ${scope} AND p.pages_enabled AND pg.archived_at IS NULL
        AND length(btrim(coalesce(pg.title, '') || coalesce(pg.content_text, ''))) > 0
        AND ${stale("page", sql`pg.id`, sql`pg.updated_at`, model)}
      LIMIT ${BATCH_ENTITIES}`;
  }
  return (await db.execute<CandidateRow>(query)).rows;
}

function toDocument(type: Kind, row: CandidateRow, model: string): Document {
  const chunks =
    type === "task"
      ? [taskEmbeddingText(row.title ?? "", row.body)]
      : type === "comment"
        ? [commentEmbeddingText(row.title, row.body)]
        : pageEmbeddingChunks(row.title, row.body);
  const nonEmpty = chunks.filter((chunk) => chunk.trim());
  const final = nonEmpty.length > 0 ? nonEmpty : [row.title?.trim() || "-"];
  return {
    ...row,
    type,
    chunks: final,
    hash: contentHash(model, final),
    tier: row.visibility === "restricted" ? "restricted" : "private",
  };
}

/** Same text, newer timestamp: re-stamp without calling the model. */
async function restamp(workspaceId: string, doc: Document): Promise<void> {
  await db.execute(sql`
    UPDATE ai_embedding
    SET source_updated_at = ${doc.updatedAt}::timestamp,
        project_id = ${doc.projectId}, workspace_id = ${workspaceId}
    WHERE entity_type = ${doc.type} AND entity_id = ${doc.id}`);
}

async function store(
  workspaceId: string,
  doc: Document,
  vectors: number[][],
  model: string,
): Promise<void> {
  const dims = vectors[0]?.length ?? 0;
  await ensureVectorIndex(dims);
  const values = vectors.map(
    (vector, chunk) => sql`(
      ${workspaceId}, ${doc.projectId}, ${doc.type}, ${doc.id}, ${chunk},
      ${doc.hash}, ${model}, ${dims}, ${JSON.stringify(vector)}::vector,
      ${doc.updatedAt}::timestamp, now()
    )`,
  );
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO ai_embedding (workspace_id, project_id, entity_type, entity_id,
        chunk, content_hash, model, dims, embedding, source_updated_at, updated_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (entity_type, entity_id, chunk) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        project_id = excluded.project_id,
        content_hash = excluded.content_hash,
        model = excluded.model,
        dims = excluded.dims,
        embedding = excluded.embedding,
        source_updated_at = excluded.source_updated_at,
        updated_at = now()`);
    await tx.execute(sql`
      DELETE FROM ai_embedding
      WHERE entity_type = ${doc.type} AND entity_id = ${doc.id}
        AND chunk >= ${vectors.length}`);
  });
}

/** Embeds changed documents of one data tier, at most 64 texts a call. */
async function embedDocuments(
  workspaceId: string,
  docs: Document[],
  tier: DataTier,
  model: string,
): Promise<void> {
  // Whole documents per call, so each is stored complete or not at all.
  let group: Document[] = [];
  let size = 0;
  const flush = async () => {
    if (group.length === 0) return;
    const texts = group.flatMap((doc) => doc.chunks);
    const result = await aiEmbed({
      workspaceId,
      userId: null,
      texts,
      dataTier: tier,
      projectIds: [...new Set(group.map((doc) => doc.projectId))],
    });
    if (result.model !== model) {
      throw new AiError("AI_PROVIDER_ERROR", "The embedding model changed");
    }
    let offset = 0;
    for (const doc of group) {
      const vectors = result.vectors.slice(offset, offset + doc.chunks.length);
      offset += doc.chunks.length;
      await store(workspaceId, doc, vectors, model);
    }
    group = [];
    size = 0;
  };
  for (const doc of docs) {
    if (size + doc.chunks.length > MAX_TEXTS_PER_CALL) await flush();
    group.push(doc);
    size += doc.chunks.length;
  }
  await flush();
}

/**
 * Drops embeddings whose source no longer qualifies: trashed or purged
 * entities, archived pages, comments of trashed tasks, projects trashed or
 * with AI off, and restricted projects the policy no longer includes.
 */
export async function sweepWorkspaceEmbeddings(
  workspaceId: string,
  includeRestricted: boolean,
): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM ai_embedding e
    WHERE e.workspace_id = ${workspaceId} AND (
      e.project_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM project p
        WHERE p.id = e.project_id AND ${liveProject(workspaceId)}
          AND (p.visibility <> 'restricted' OR ${includeRestricted})
      )
      OR (e.entity_type = 'task' AND NOT EXISTS (
        SELECT 1 FROM task t WHERE t.id = e.entity_id AND t.deleted_at IS NULL))
      OR (e.entity_type = 'page' AND NOT EXISTS (
        SELECT 1 FROM page pg WHERE pg.id = e.entity_id AND pg.archived_at IS NULL))
      OR (e.entity_type = 'comment' AND NOT EXISTS (
        SELECT 1 FROM activity a JOIN task t ON t.id = a.task_id
        WHERE a.id = e.entity_id AND a.type = 'comment' AND t.deleted_at IS NULL))
    )`);
  return result.rowCount ?? 0;
}

async function indexWorkspace(
  workspaceId: string,
  instance: AiInstanceConfig,
  destination: AiDestination,
  deadline: number,
): Promise<Omit<EmbeddingIndexResult, "workspaces">> {
  const totals = { embedded: 0, unchanged: 0, removed: 0 };
  const policy = await loadWorkspaceAiPolicy(workspaceId);
  if (!policy.enabled || !policy.embeddingsEnabled) return totals;
  const routeOk = (dataTier: DataTier) =>
    embeddingRoute({ destination, dataTier, instance, workspace: policy }).ok;
  const allowed = {
    private: routeOk("private"),
    restricted: policy.includeRestricted && routeOk("restricted"),
  };
  totals.removed = await sweepWorkspaceEmbeddings(
    workspaceId,
    allowed.restricted,
  );
  if (!allowed.private && !allowed.restricted) return totals;

  const model = destination.model;
  let processed = 0;
  for (;;) {
    let found = 0;
    for (const type of KINDS) {
      const rows = await candidates(type, workspaceId, model, allowed);
      found += rows.length;
      const docs = rows.map((row) => toDocument(type, row, model));
      const changed: Document[] = [];
      for (const doc of docs) {
        if (doc.storedHash === doc.hash && doc.storedModel === model) {
          await restamp(workspaceId, doc);
          totals.unchanged += 1;
        } else {
          changed.push(doc);
        }
      }
      for (const tier of ["private", "restricted"] as const) {
        const batch = changed.filter((doc) => doc.tier === tier);
        if (batch.length === 0) continue;
        await embedDocuments(workspaceId, batch, tier, model);
        totals.embedded += batch.length;
      }
      processed += rows.length;
    }
    if (found === 0) break;
    if (processed >= MAX_ENTITIES_PER_RUN || Date.now() > deadline) break;
  }
  return totals;
}

/** Indexes every workspace with semantic search on (or just one). */
export async function indexEmbeddings(
  options: { workspaceId?: string } = {},
): Promise<EmbeddingIndexResult & { degraded: boolean }> {
  const result = {
    workspaces: 0,
    embedded: 0,
    unchanged: 0,
    removed: 0,
    degraded: false,
  };
  const instance = getAiInstanceConfig();
  if (!instance.enabled) return result;
  const destination = await resolveEmbeddingDestination(instance);
  if (!destination) return result;
  const rows = await db
    .select({ workspaceId: workspaceAiSettingTable.workspaceId })
    .from(workspaceAiSettingTable)
    .where(
      and(
        eq(workspaceAiSettingTable.enabled, true),
        eq(workspaceAiSettingTable.embeddingsEnabled, true),
        options.workspaceId
          ? eq(workspaceAiSettingTable.workspaceId, options.workspaceId)
          : undefined,
      ),
    );
  if (rows.length === 0) return result;
  if (!(await ensureVectorStore())) return result;

  const deadline = Date.now() + RUN_BUDGET_MS;
  for (const { workspaceId } of rows) {
    try {
      const totals = await indexWorkspace(
        workspaceId,
        instance,
        destination,
        deadline,
      );
      pauses.delete(workspaceId);
      result.workspaces += 1;
      result.embedded += totals.embedded;
      result.unchanged += totals.unchanged;
      result.removed += totals.removed;
    } catch (error) {
      if (error instanceof AiError) {
        // Budget reached, AI turned off, endpoint down: try again next run.
        pauses.set(workspaceId, error.code);
      } else {
        result.degraded = true;
        console.error("Semantic search indexing failed", {
          workspaceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (Date.now() > deadline) break;
  }
  if (result.embedded > 0 || result.removed > 0) {
    console.log(
      `Semantic search index: ${result.embedded} embedded, ${result.unchanged} unchanged, ${result.removed} removed`,
    );
  }
  return result;
}

/** The scheduled job, the boot pass and the backfill on enable. */
export async function runEmbeddingIndexer(
  options: { workspaceId?: string } = {},
): Promise<{ degraded?: boolean }> {
  // AI off (the default): no lease, no queries.
  if (!getAiInstanceConfig().enabled) return {};
  return withJobLease(
    LEASE,
    () => indexEmbeddings(options),
    () => ({}),
    LEASE_MS,
  );
}
