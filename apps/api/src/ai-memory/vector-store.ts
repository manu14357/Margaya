import { sql } from "drizzle-orm";
import db from "../database";

// Optional semantic memory (D1): the `ai_embedding` table lives only where
// the pgvector extension exists, so it is created by this guarded runtime
// bootstrap, never by a Drizzle migration. Installs without pgvector keep
// full-text search and never run a vector statement.
//
// The table is not in the Drizzle schema on purpose (its `vector` type
// would not exist everywhere); every read and write is raw SQL in
// ai-memory/. Cleanup:
//   - workspace and project hard deletes cascade through foreign keys;
//   - task, page and comment hard deletes (trash purge, cascades) fire the
//     statement-level `ai_embedding_forget_*` triggers;
//   - the indexer's sweep drops rows whose source is trashed, archived, in
//     a project with AI off, or restricted when the policy excludes it.
//
// Models differ in dimensions, so `embedding` is an unsized vector and each
// dimension seen gets its own partial HNSW index on a sized cast
// (`WHERE dims = N`), which queries match by filtering on `dims`.

export type VectorStoreStatus =
  /** Not checked yet. */
  | "unknown"
  /** pgvector can be installed; the table is created on first use. */
  | "available"
  /** pgvector isn't installed on the database server, or can't be created. */
  | "unavailable"
  /** The extension and table exist. */
  | "ready";

let status: VectorStoreStatus = "unknown";
let checkedAt = 0;
let bootstrap: Promise<boolean> | null = null;
const indexedDimensions = new Set<number>();

const RECHECK_MS = 60_000;
/** HNSW indexes `vector` up to 2,000 dimensions and `halfvec` up to 4,000. */
const MAX_VECTOR_INDEX_DIMS = 2000;
const MAX_HALFVEC_INDEX_DIMS = 4000;
const BOOTSTRAP_LOCK = 7_314_002_211;

export function vectorStoreStatus(): VectorStoreStatus {
  return status;
}

async function tableExists(): Promise<boolean> {
  const result = await db.execute<{ exists: boolean }>(
    sql`SELECT to_regclass('public.ai_embedding') IS NOT NULL AS "exists"`,
  );
  return Boolean(result.rows[0]?.exists);
}

async function extensionAvailable(): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT 1 FROM pg_available_extensions WHERE name = 'vector'`,
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Checks (again) what the database offers: "ready" once the table exists,
 * "available" when pgvector could be created, else "unavailable". Never
 * creates anything. Cached for a minute unless `force`.
 */
export async function checkVectorStore(
  options: { force?: boolean } = {},
): Promise<VectorStoreStatus> {
  if (status === "ready") return status;
  if (!options.force && status !== "unknown") {
    if (Date.now() - checkedAt < RECHECK_MS) return status;
  }
  try {
    if (await tableExists()) {
      status = "ready";
    } else {
      status = (await extensionAvailable()) ? "available" : "unavailable";
    }
  } catch (error) {
    console.error("Couldn't check for pgvector", {
      error: error instanceof Error ? error.message : String(error),
    });
    status = "unavailable";
  }
  checkedAt = Date.now();
  return status;
}

/** True once the store exists; re-checks occasionally (another instance may have created it). */
export async function isVectorStoreReady(): Promise<boolean> {
  return (await checkVectorStore()) === "ready";
}

const FORGET_TRIGGERS = [
  { table: "task", type: "task" },
  { table: "page", type: "page" },
  { table: "activity", type: "comment" },
] as const;

async function createStore(): Promise<void> {
  await db.transaction(async (tx) => {
    // One instance at a time: CREATE EXTENSION and CREATE TABLE IF NOT EXISTS
    // race on catalog rows otherwise.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK})`);
    await tx.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    const existed = (
      await tx.execute<{ exists: boolean }>(
        sql`SELECT to_regclass('public.ai_embedding') IS NOT NULL AS "exists"`,
      )
    ).rows[0]?.exists;
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_embedding (
        id bigserial PRIMARY KEY,
        workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        project_id text REFERENCES project(id) ON DELETE CASCADE,
        entity_type text NOT NULL CHECK (entity_type IN ('task', 'page', 'comment')),
        entity_id text NOT NULL,
        chunk integer NOT NULL DEFAULT 0,
        content_hash text NOT NULL,
        model text NOT NULL,
        dims integer NOT NULL,
        embedding vector NOT NULL,
        source_updated_at timestamp,
        updated_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT ai_embedding_entity_chunk_unique UNIQUE (entity_type, entity_id, chunk)
      )`);
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS ai_embedding_workspace_model_idx
        ON ai_embedding (workspace_id, model, dims)`);
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS ai_embedding_project_idx
        ON ai_embedding (project_id)`);
    if (existed) return;
    await tx.execute(sql`
      CREATE OR REPLACE FUNCTION margaya_ai_embedding_forget() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        DELETE FROM ai_embedding e
        USING old_rows o
        WHERE e.entity_type = TG_ARGV[0] AND e.entity_id = o.id;
        RETURN NULL;
      END
      $$`);
    for (const { table, type } of FORGET_TRIGGERS) {
      const name = `ai_embedding_forget_${type}`;
      await tx.execute(sql.raw(`DROP TRIGGER IF EXISTS ${name} ON "${table}"`));
      await tx.execute(
        sql.raw(
          `CREATE TRIGGER ${name} AFTER DELETE ON "${table}" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION margaya_ai_embedding_forget('${type}')`,
        ),
      );
    }
  });
}

/**
 * Creates the extension, table, indexes and cleanup triggers when pgvector
 * is available (idempotent). Returns whether the store is ready; failures
 * (no pgvector, no permission to create it) leave full-text search alone.
 */
export async function ensureVectorStore(): Promise<boolean> {
  if (status === "ready") return true;
  if (!bootstrap) {
    bootstrap = (async () => {
      const current = await checkVectorStore({ force: true });
      if (current === "ready") return true;
      if (current !== "available") return false;
      try {
        await createStore();
        status = "ready";
        console.log("Semantic search: pgvector store ready");
        return true;
      } catch (error) {
        status = "unavailable";
        console.error("Semantic search: couldn't create the pgvector store", {
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      } finally {
        checkedAt = Date.now();
      }
    })().finally(() => {
      bootstrap = null;
    });
  }
  return bootstrap;
}

/** The sized cast a query and its HNSW index share, or null (no index). */
export function vectorCast(dims: number): string | null {
  if (!Number.isInteger(dims) || dims <= 0) return null;
  if (dims <= MAX_VECTOR_INDEX_DIMS) return `vector(${dims})`;
  if (dims <= MAX_HALFVEC_INDEX_DIMS) return `halfvec(${dims})`;
  return null;
}

/** Creates the partial HNSW index for a dimension once (idempotent). */
export async function ensureVectorIndex(dims: number): Promise<void> {
  if (indexedDimensions.has(dims)) return;
  const cast = vectorCast(dims);
  if (cast) {
    const ops = cast.startsWith("halfvec")
      ? "halfvec_cosine_ops"
      : "vector_cosine_ops";
    try {
      await db.execute(
        sql.raw(
          `CREATE INDEX IF NOT EXISTS ai_embedding_hnsw_${dims} ON ai_embedding USING hnsw ((embedding::${cast}) ${ops}) WHERE dims = ${dims}`,
        ),
      );
    } catch (error) {
      // An older pgvector without halfvec: exact search still works.
      console.error("Semantic search: couldn't create the vector index", {
        dims,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  indexedDimensions.add(dims);
}

/** Deletes a workspace's embeddings (semantic search turned off). */
export async function forgetWorkspaceEmbeddings(
  workspaceId: string,
): Promise<void> {
  if (!(await isVectorStoreReady())) return;
  await db.execute(
    sql`DELETE FROM ai_embedding WHERE workspace_id = ${workspaceId}`,
  );
}

/** Test hook: forget the cached status. */
export function resetVectorStoreState(): void {
  status = "unknown";
  checkedAt = 0;
  bootstrap = null;
  indexedDimensions.clear();
}
