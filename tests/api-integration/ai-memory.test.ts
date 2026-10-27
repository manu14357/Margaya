import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAiGatewayState,
  setAiProviderFactory,
} from "../../apps/api/src/ai/gateway";
import {
  createFakeProvider,
  setFakeResponder,
} from "../../apps/api/src/ai/provider/fake";
import { saveWorkspaceAiSettings } from "../../apps/api/src/ai/workspace-settings";
import { indexEmbeddings } from "../../apps/api/src/ai-memory/indexer";
import {
  hybridSearchWorkspace,
  semanticSearchWorkspace,
} from "../../apps/api/src/ai-memory/semantic-search";
import {
  checkVectorStore,
  ensureVectorStore,
  resetVectorStoreState,
} from "../../apps/api/src/ai-memory/vector-store";
import db, { schema } from "../../apps/api/src/database";
import {
  aiUsageTable,
  instanceSettingTable,
} from "../../apps/api/src/database/schema";
import { refreshInstanceSettings } from "../../apps/api/src/instance-settings/snapshot";
import { searchWorkspace } from "../../apps/api/src/search/search-workspace";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import {
  ensureTestDatabaseMigrated,
  resetTestDatabase,
} from "./helpers/database";
import { draftScene } from "./helpers/drafts";

// Optional semantic memory (D1). The shared test Postgres has no pgvector,
// so the fallback runs there; the vector path runs when DATABASE_URL points
// at a pgvector database (pgvector/pgvector:pg16).

await ensureTestDatabaseMigrated();
const HAS_PGVECTOR =
  ((
    await db.execute(
      sql`SELECT 1 FROM pg_available_extensions WHERE name = 'vector'`,
    )
  ).rowCount ?? 0) > 0;

type Scene = Awaited<ReturnType<typeof draftScene>>;

const AI_ENV = ["MARGAYA_AI_ENABLED", "MARGAYA_AI_PROVIDER"] as const;

// Deterministic "meaning": words map to concepts, concepts to dimensions.
const CONCEPTS: Record<string, string> = {
  login: "auth",
  signin: "auth",
  authenticate: "auth",
  authentication: "auth",
  sso: "auth",
  password: "auth",
  cannot: "fail",
  fails: "fail",
  broken: "fail",
  break: "fail",
  invoice: "billing",
  payment: "billing",
  billing: "billing",
  charged: "billing",
};
const DIMS = 64;

function conceptVector(text: string): number[] {
  const vector = new Array<number>(DIMS).fill(0);
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 3) continue;
    const concept = CONCEPTS[word] ?? word;
    const slot = createHash("sha256").update(concept).digest()[0] ?? 0;
    vector[slot % DIMS] = (vector[slot % DIMS] ?? 0) + 1;
  }
  const norm = Math.hypot(...vector);
  if (norm === 0) {
    vector[0] = 1;
    return vector;
  }
  return vector.map((value) => value / norm);
}

let embedCalls: string[][] = [];

function useConceptEmbeddings() {
  setAiProviderFactory(() => ({
    ...createFakeProvider(),
    async embed(texts: string[]) {
      embedCalls.push(texts);
      return texts.map(conceptVector);
    },
  }));
}

beforeEach(async () => {
  await resetTestDatabase();
  await refreshInstanceSettings();
  resetRateLimitMemory();
  resetAiGatewayState();
  resetVectorStoreState();
  embedCalls = [];
});

afterEach(async () => {
  for (const name of AI_ENV) delete process.env[name];
  setFakeResponder(null);
  setAiProviderFactory(null);
});

async function aiScene() {
  process.env.MARGAYA_AI_ENABLED = "true";
  process.env.MARGAYA_AI_PROVIDER = "fake";
  const s = await draftScene();
  await saveWorkspaceAiSettings(s.workspaceId, { enabled: true }, s.owner.id);
  useConceptEmbeddings();
  return s;
}

let nextNumber = 0;

async function insertTask(projectId: string, title: string, description = "") {
  nextNumber += 1;
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title,
      description,
      status: "to-do",
      number: nextNumber,
    })
    .returning();
  if (!task) throw new Error("Failed to insert task");
  return task;
}

async function insertComment(taskId: string, userId: string, content: string) {
  const [comment] = await db
    .insert(schema.activityTable)
    .values({ taskId, userId, type: "comment", content })
    .returning();
  if (!comment) throw new Error("Failed to insert comment");
  return comment;
}

async function insertPage(
  s: Scene,
  projectId: string,
  title: string,
  contentText: string,
) {
  const [page] = await db
    .insert(schema.pageTable)
    .values({
      workspaceId: s.workspaceId,
      projectId,
      title,
      contentText,
      contentMarkdown: contentText,
      ownerId: s.owner.id,
    })
    .returning();
  if (!page) throw new Error("Failed to insert page");
  return page;
}

async function embeddingRows(where = sql`true`) {
  return (
    await db.execute<{
      entity_type: string;
      entity_id: string;
      chunk: number;
      project_id: string;
      dims: number;
    }>(
      sql`SELECT entity_type, entity_id, chunk, project_id, dims FROM ai_embedding WHERE ${where} ORDER BY entity_type, entity_id, chunk`,
    )
  ).rows;
}

const ids = (hits: { id: string }[]) => hits.map((hit) => hit.id);

describe.skipIf(HAS_PGVECTOR)("semantic search without pgvector", () => {
  it("reports pgvector as unavailable and refuses to turn semantic search on", async () => {
    const s = await aiScene();
    expect(await checkVectorStore({ force: true })).toBe("unavailable");
    expect(await ensureVectorStore()).toBe(false);

    const settings = await s.ok<{
      workspace: { embeddingsEnabled: boolean };
      semantic: { vectorStore: string; endpointConfigured: boolean };
    }>(s.owner, "GET", `/ai/settings?workspaceId=${s.workspaceId}`);
    expect(settings.workspace.embeddingsEnabled).toBe(false);
    expect(settings.semantic).toMatchObject({
      vectorStore: "unavailable",
      endpointConfigured: true,
      indexedItems: 0,
    });

    const response = await s.as(s.owner)("PATCH", "/ai/settings", {
      workspaceId: s.workspaceId,
      embeddingsEnabled: true,
    });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("pgvector is not available");
    // Nothing was created, migrations stay untouched.
    const table = await db.execute<{ exists: boolean }>(
      sql`SELECT to_regclass('public.ai_embedding') IS NOT NULL AS "exists"`,
    );
    expect(table.rows[0]?.exists).toBe(false);
  });

  it("keeps full-text search, Ask and the duplicate check working", async () => {
    const s = await aiScene();
    // Even with the flag forced on, nothing breaks and nothing is embedded.
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { embeddingsEnabled: true },
      s.owner.id,
    );
    await insertTask(s.web.project.id, "Login page breaks on Safari");
    expect(await indexEmbeddings()).toMatchObject({ embedded: 0 });

    const input = {
      userId: s.mia.id,
      workspaceId: s.workspaceId,
      query: "safari login",
    };
    const hybrid = await hybridSearchWorkspace(input);
    expect(hybrid).toEqual(await searchWorkspace(input));
    expect(hybrid).toHaveLength(1);
    expect(await semanticSearchWorkspace(input)).toBeNull();

    const ask = await s.as(s.mia)("POST", "/ai/ask?stream=false", {
      workspaceId: s.workspaceId,
      question: "What breaks on Safari?",
    });
    expect(ask.status).toBe(200);
    const dup = await s.as(s.mia)("POST", "/ai/build/duplicates", {
      projectId: s.web.project.id,
      title: "Safari login page breaks",
    });
    expect(dup.status).toBe(200);
    const embeddingUsage = await db
      .select()
      .from(aiUsageTable)
      .where(eq(aiUsageTable.feature, "embedding"));
    expect(embeddingUsage).toHaveLength(0);
    expect(embedCalls).toHaveLength(0);
  });
});

describe.runIf(HAS_PGVECTOR)("semantic search with pgvector", () => {
  async function semanticScene() {
    const s = await aiScene();
    expect(await ensureVectorStore()).toBe(true);
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { embeddingsEnabled: true },
      s.owner.id,
    );
    return s;
  }

  it("bootstraps on enable, backfills in the background and reports progress", async () => {
    const s = await aiScene();
    await insertTask(s.web.project.id, "Users cannot authenticate via SSO");
    await insertTask(s.api.project.id, "Rotate the API tokens");

    const enabled = await s.ok<{
      workspace: { embeddingsEnabled: boolean };
      semantic: { vectorStore: string };
    }>(s.owner, "PATCH", "/ai/settings", {
      workspaceId: s.workspaceId,
      embeddingsEnabled: true,
    });
    expect(enabled.workspace.embeddingsEnabled).toBe(true);
    expect(enabled.semantic.vectorStore).toBe("ready");

    await vi.waitFor(
      async () => {
        expect(await embeddingRows()).toHaveLength(2);
        const lease = await db.execute(
          sql`SELECT 1 FROM job_lease WHERE name = 'ai-embedding-index'`,
        );
        expect(lease.rowCount).toBe(0);
      },
      { timeout: 15_000, interval: 200 },
    );
    const settings = await s.ok<{ semantic: { indexedItems: number } }>(
      s.owner,
      "GET",
      `/ai/settings?workspaceId=${s.workspaceId}`,
    );
    expect(settings.semantic.indexedItems).toBe(2);

    // Members (no ai:manage) can't change it.
    const member = await s.as(s.mia)("PATCH", "/ai/settings", {
      workspaceId: s.workspaceId,
      embeddingsEnabled: false,
    });
    expect(member.status).toBe(403);

    // Turning it off deletes the workspace's embeddings.
    await s.ok(s.owner, "PATCH", "/ai/settings", {
      workspaceId: s.workspaceId,
      embeddingsEnabled: false,
    });
    expect(await embeddingRows()).toHaveLength(0);
    // Indexer usage is recorded as a system call.
    const usage = await db
      .select()
      .from(aiUsageTable)
      .where(eq(aiUsageTable.feature, "embedding"));
    expect(usage.length).toBeGreaterThan(0);
    expect(usage.every((row) => row.userId === null)).toBe(true);
  });

  it("embeds tasks, comments and chunked pages, and re-embeds only changed text", async () => {
    const s = await semanticScene();
    const task = await insertTask(
      s.web.project.id,
      "Users cannot authenticate via SSO",
    );
    await insertComment(task.id, s.mia.id, "Same with password login");
    const longText = Array.from(
      { length: 60 },
      (_, i) =>
        `Section ${i}. The billing export runs nightly and sends invoices.`,
    ).join("\n\n");
    const page = await insertPage(
      s,
      s.web.project.id,
      "Billing handbook",
      longText,
    );

    const first = await indexEmbeddings();
    expect(first).toMatchObject({ embedded: 3, unchanged: 0 });
    const rows = await embeddingRows();
    expect(rows.filter((row) => row.entity_type === "task")).toHaveLength(1);
    expect(rows.filter((row) => row.entity_type === "comment")).toHaveLength(1);
    const pageChunks = rows.filter((row) => row.entity_id === page.id);
    expect(pageChunks.length).toBeGreaterThan(1);
    expect(rows.every((row) => row.dims === DIMS)).toBe(true);
    const index = await db.execute(
      sql`SELECT 1 FROM pg_indexes WHERE indexname = ${`ai_embedding_hnsw_${DIMS}`}`,
    );
    expect(index.rowCount).toBe(1);

    // Nothing changed: no candidates at all.
    const calls = embedCalls.length;
    expect(await indexEmbeddings()).toMatchObject({
      embedded: 0,
      unchanged: 0,
    });

    // A status move bumps updated_at but not the text: re-stamped only.
    await db
      .update(schema.taskTable)
      .set({ status: "in-progress" })
      .where(eq(schema.taskTable.id, task.id));
    expect(await indexEmbeddings()).toMatchObject({
      embedded: 0,
      unchanged: 1,
    });
    expect(embedCalls.length).toBe(calls);

    // A new title is embedded again.
    await db
      .update(schema.taskTable)
      .set({ title: "SSO login broken for contractors" })
      .where(eq(schema.taskTable.id, task.id));
    expect(await indexEmbeddings()).toMatchObject({ embedded: 1 });
    expect(embedCalls.length).toBe(calls + 1);

    // A shorter page drops its extra chunks.
    await db
      .update(schema.pageTable)
      .set({ contentText: "Short now.", updatedAt: new Date() })
      .where(eq(schema.pageTable.id, page.id));
    await indexEmbeddings();
    expect(await embeddingRows(sql`entity_id = ${page.id}`)).toHaveLength(1);
  });

  it("finds work by meaning, fused with full-text hits, for Ask and the duplicate check", async () => {
    const s = await semanticScene();
    const sso = await insertTask(
      s.web.project.id,
      "Users cannot authenticate via SSO",
    );
    const exact = await insertTask(s.web.project.id, "Login copy review");
    await insertTask(s.web.project.id, "Update the pricing page");
    await indexEmbeddings();

    const input = {
      userId: s.mia.id,
      workspaceId: s.workspaceId,
      query: "login broken",
    };
    expect(ids(await searchWorkspace(input))).toEqual([]);
    const semantic = await semanticSearchWorkspace(input);
    expect(ids(semantic ?? [])).toContain(sso.id);
    const hybrid = await hybridSearchWorkspace({ ...input, query: "login" });
    // Full-text match and semantic neighbour, the exact one first.
    expect(ids(hybrid).slice(0, 2)).toEqual([exact.id, sso.id]);
    const semanticOnly = hybrid.find((hit) => hit.id === sso.id);
    expect(semanticOnly?.score).toBeGreaterThanOrEqual(1);
    expect(semanticOnly?.score).toBeLessThan(2);
    // The searcher's query embedding is on their ledger.
    const usage = await db
      .select()
      .from(aiUsageTable)
      .where(
        and(
          eq(aiUsageTable.feature, "embedding"),
          eq(aiUsageTable.userId, s.mia.id),
        ),
      );
    expect(usage.length).toBeGreaterThan(0);

    // Ask cites the semantic neighbour.
    const ask = await s.ok<{ sources: { id: string }[] }>(
      s.mia,
      "POST",
      "/ai/ask?stream=false",
      { workspaceId: s.workspaceId, question: "Why is login broken?" },
    );
    expect(ids(ask.sources)).toContain(sso.id);

    // The duplicate check sees it although no title word matches.
    setFakeResponder((request) =>
      request.jsonSchema
        ? {
            text: JSON.stringify({
              matches: [
                {
                  key: `WEB-${sso.number}`,
                  verdict: "duplicate",
                  reason: "Same SSO bug",
                },
              ],
            }),
          }
        : null,
    );
    const duplicates = await s.ok<{ tasks: { id: string; verdict: string }[] }>(
      s.mia,
      "POST",
      "/ai/build/duplicates",
      { projectId: s.web.project.id, title: "SSO login fails" },
    );
    expect(duplicates.tasks).toEqual([
      expect.objectContaining({ id: sso.id, verdict: "duplicate" }),
    ]);
  });

  it("never returns or embeds what the caller or the policy excludes", async () => {
    const s = await semanticScene();
    const secret = await insertTask(
      s.web.project.id,
      "Users cannot authenticate via SSO",
    );
    const open = await insertTask(
      s.api.project.id,
      "Password login broken on mobile",
    );
    // Web becomes restricted; only Ada (admin) and the owner see it.
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, s.web.project.id));

    // Not included for AI: never embedded.
    await indexEmbeddings();
    expect((await embeddingRows()).map((row) => row.entity_id)).toEqual([
      open.id,
    ]);

    // Included, but restricted data may only go to a local model: still not.
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { includeRestricted: true },
      s.owner.id,
    );
    await indexEmbeddings();
    expect((await embeddingRows()).map((row) => row.entity_id)).toEqual([
      open.id,
    ]);

    // The instance lets restricted data reach the cloud: now embedded.
    await db
      .insert(instanceSettingTable)
      .values({ key: "ai.route.restricted", value: "cloud" });
    await refreshInstanceSettings();
    await indexEmbeddings();
    expect((await embeddingRows()).map((row) => row.entity_id).sort()).toEqual(
      [open.id, secret.id].sort(),
    );

    const query = { workspaceId: s.workspaceId, query: "login broken" };
    expect(
      ids(
        (await semanticSearchWorkspace({ ...query, userId: s.ada.id })) ?? [],
      ),
    ).toContain(secret.id);
    // Mia isn't a member of the restricted project.
    const mia = await hybridSearchWorkspace({ ...query, userId: s.mia.id });
    expect(ids(mia)).toContain(open.id);
    expect(ids(mia)).not.toContain(secret.id);
    // Outsiders get nothing.
    expect(
      await semanticSearchWorkspace({ ...query, userId: s.outsider.id }),
    ).toEqual([]);
    // A project filter keeps to that project.
    expect(
      ids(
        (await semanticSearchWorkspace({
          ...query,
          userId: s.ada.id,
          projectId: s.api.project.id,
        })) ?? [],
      ),
    ).toEqual([open.id]);

    // Excluded again: swept on the next pass.
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { includeRestricted: false },
      s.owner.id,
    );
    expect(
      ids(
        (await semanticSearchWorkspace({ ...query, userId: s.ada.id })) ?? [],
      ),
    ).not.toContain(secret.id);
    await indexEmbeddings();
    expect((await embeddingRows()).map((row) => row.entity_id)).toEqual([
      open.id,
    ]);

    // AI turned off for a project: not searched, then swept.
    await db
      .update(schema.projectTable)
      .set({ aiEnabled: false })
      .where(eq(schema.projectTable.id, s.api.project.id));
    expect(
      (await semanticSearchWorkspace({ ...query, userId: s.ada.id })) ?? [],
    ).toEqual([]);
    await indexEmbeddings();
    expect(await embeddingRows()).toEqual([]);
  });

  it("forgets embeddings on trash, purge, archive and project or workspace deletion", async () => {
    const s = await semanticScene();
    const trashed = await insertTask(s.web.project.id, "SSO login broken");
    const purged = await insertTask(s.web.project.id, "Password login fails");
    const comment = await insertComment(
      purged.id,
      s.mia.id,
      "Login fails for me",
    );
    const page = await insertPage(
      s,
      s.web.project.id,
      "Login guide",
      "How to sign in.",
    );
    const other = await insertTask(s.api.project.id, "Invoice payment broken");
    await indexEmbeddings();
    expect(await embeddingRows()).toHaveLength(5);
    const query = {
      userId: s.owner.id,
      workspaceId: s.workspaceId,
      query: "login broken",
    };

    // Trash: hidden at once, swept on the next pass.
    await db
      .update(schema.taskTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.taskTable.id, trashed.id));
    expect(ids((await semanticSearchWorkspace(query)) ?? [])).not.toContain(
      trashed.id,
    );
    await indexEmbeddings();
    expect(await embeddingRows(sql`entity_id = ${trashed.id}`)).toEqual([]);

    // Hard deletes (trash purge, cascades) fire the cleanup triggers.
    await db.delete(schema.taskTable).where(eq(schema.taskTable.id, purged.id));
    expect(await embeddingRows(sql`entity_id = ${purged.id}`)).toEqual([]);
    expect(await embeddingRows(sql`entity_id = ${comment.id}`)).toEqual([]);

    // Archived pages are left out, deleted ones forgotten.
    await db
      .update(schema.pageTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.pageTable.id, page.id));
    expect(ids((await semanticSearchWorkspace(query)) ?? [])).not.toContain(
      page.id,
    );
    await db.delete(schema.pageTable).where(eq(schema.pageTable.id, page.id));
    expect(await embeddingRows(sql`entity_id = ${page.id}`)).toEqual([]);

    // Project and workspace deletion cascade.
    await db
      .delete(schema.projectTable)
      .where(eq(schema.projectTable.id, s.api.project.id));
    expect(await embeddingRows(sql`entity_id = ${other.id}`)).toEqual([]);
    await insertTask(s.web.project.id, "Login broken again");
    await indexEmbeddings();
    expect(await embeddingRows()).toHaveLength(1);
    await db
      .delete(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, s.workspaceId));
    expect(await embeddingRows()).toEqual([]);
  });

  it("stops indexing at the workspace budget and resumes later", async () => {
    const s = await semanticScene();
    await insertTask(s.web.project.id, "Users cannot authenticate via SSO");
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { monthlyCapMicros: 0 },
      s.owner.id,
    );
    const result = await indexEmbeddings();
    expect(result.embedded).toBe(0);
    expect(await embeddingRows()).toEqual([]);
    const settings = await s.ok<{ semantic: { paused: string | null } }>(
      s.owner,
      "GET",
      `/ai/settings?workspaceId=${s.workspaceId}`,
    );
    expect(settings.semantic.paused).toBe("AI_BUDGET_EXCEEDED");
    // Search still answers from full text.
    const hits = await hybridSearchWorkspace({
      userId: s.mia.id,
      workspaceId: s.workspaceId,
      query: "authenticate",
    });
    expect(hits).toHaveLength(1);

    await saveWorkspaceAiSettings(
      s.workspaceId,
      { monthlyCapMicros: null },
      s.owner.id,
    );
    expect(await indexEmbeddings()).toMatchObject({ embedded: 1 });
  });
});
