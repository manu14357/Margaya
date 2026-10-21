import { sql } from "drizzle-orm";
import {
  embeddingsConfigured,
  resolveEmbeddingDestination,
} from "../ai/embedding-endpoint";
import type { AiErrorCode } from "../ai/errors";
import { getAiInstanceConfig } from "../ai/instance-config";
import db from "../database";
import { embeddingIndexPause, runEmbeddingIndexer } from "./indexer";
import {
  checkVectorStore,
  ensureVectorStore,
  forgetWorkspaceEmbeddings,
  type VectorStoreStatus,
} from "./vector-store";

// Semantic search (D1) at boot, in AI settings, and when a workspace admin
// turns it on or off.

/**
 * Boot: note whether pgvector exists, and when AI is on, start an indexing
 * pass in the background (it creates the store only if some workspace has
 * semantic search on). Never fails startup.
 */
export async function initializeSemanticMemory(): Promise<void> {
  const status = await checkVectorStore({ force: true });
  if (status === "unavailable") {
    console.log(
      "Semantic search: pgvector is not available; search uses full-text only",
    );
    return;
  }
  if (!getAiInstanceConfig().enabled) return;
  void runEmbeddingIndexer().catch((error) => {
    console.error("Semantic search indexing failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export type SemanticStatus = {
  vectorStore: VectorStoreStatus;
  endpointConfigured: boolean;
  indexedItems: number;
  paused: AiErrorCode | null;
};

/** What the workspace AI settings show about semantic search. */
export async function workspaceSemanticStatus(
  workspaceId: string,
): Promise<SemanticStatus> {
  const instance = getAiInstanceConfig();
  const endpointConfigured = embeddingsConfigured(instance);
  const vectorStore = await checkVectorStore();
  let indexedItems = 0;
  if (vectorStore === "ready" && endpointConfigured) {
    const destination = await resolveEmbeddingDestination(instance);
    if (destination) {
      const result = await db.execute<{ count: string }>(sql`
        SELECT count(*)::text AS count FROM ai_embedding
        WHERE workspace_id = ${workspaceId} AND model = ${destination.model}
          AND chunk = 0`);
      indexedItems = Number(result.rows[0]?.count ?? 0);
    }
  }
  return {
    vectorStore,
    endpointConfigured,
    indexedItems,
    paused: embeddingIndexPause(workspaceId),
  };
}

export type SemanticEnableCheck =
  | { ok: true }
  | { ok: false; reason: "no_endpoint" | "no_pgvector" };

/** Before turning semantic search on: endpoint set, pgvector store created. */
export async function prepareSemanticSearch(): Promise<SemanticEnableCheck> {
  if (!embeddingsConfigured(getAiInstanceConfig())) {
    return { ok: false, reason: "no_endpoint" };
  }
  if (!(await ensureVectorStore())) {
    return { ok: false, reason: "no_pgvector" };
  }
  return { ok: true };
}

/** After a settings change that affects what may be embedded. */
export async function semanticSettingsChanged(
  workspaceId: string,
  embeddingsEnabled: boolean | undefined,
): Promise<void> {
  if (embeddingsEnabled === false) {
    await forgetWorkspaceEmbeddings(workspaceId);
    return;
  }
  // Backfill on enable; sweep after privacy changes. Background: the
  // settings response never waits for indexing.
  void runEmbeddingIndexer({ workspaceId }).catch((error) => {
    console.error("Semantic search indexing failed", {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
