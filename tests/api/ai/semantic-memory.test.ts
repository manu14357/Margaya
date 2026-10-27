import { describe, expect, it } from "vitest";
import {
  embeddingRoute,
  embeddingsConfigured,
  FAKE_EMBEDDING_MODEL,
  resolveEmbeddingDestination,
} from "../../../apps/api/src/ai/embedding-endpoint";
import {
  type AiInstanceConfig,
  aiInstanceConfigOf,
} from "../../../apps/api/src/ai/instance-config";
import { DEFAULT_WORKSPACE_AI_POLICY } from "../../../apps/api/src/ai/workspace-settings";
import {
  CHUNK_CHARS,
  chunkText,
  commentEmbeddingText,
  contentHash,
  MAX_PAGE_CHUNKS,
  MAX_SINGLE_CHARS,
  pageEmbeddingChunks,
  plainText,
  taskEmbeddingText,
} from "../../../apps/api/src/ai-memory/chunk";
import { fuseHits } from "../../../apps/api/src/ai-memory/semantic-search";
import { vectorCast } from "../../../apps/api/src/ai-memory/vector-store";
import { resolveInstanceSettings } from "../../../apps/api/src/instance-settings/resolve";
import type { WorkspaceSearchHit } from "../../../apps/api/src/search/search-workspace";

function instance(overrides: Partial<AiInstanceConfig> = {}): AiInstanceConfig {
  const base = aiInstanceConfigOf(
    resolveInstanceSettings({ env: { NODE_ENV: "test" }, rows: [] }),
    { NODE_ENV: "test" },
  );
  return { ...base, enabled: true, ...overrides };
}

function hit(
  type: WorkspaceSearchHit["type"],
  id: string,
  score: number,
): WorkspaceSearchHit {
  return {
    type,
    id,
    title: id,
    score,
    projectId: "p1",
    projectName: "Web",
    projectSlug: "web",
    userId: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
  };
}

describe("embedding text and chunks", () => {
  it("builds compact text for tasks and comments, cut at the limit", () => {
    expect(plainText("<p>Hello&nbsp;<b>world</b></p>\n\n\n\nBye")).toBe(
      "Hello world\n\nBye",
    );
    expect(taskEmbeddingText("Fix login", null)).toBe("Fix login");
    expect(taskEmbeddingText(" Fix login ", "<p>Safari only</p>")).toBe(
      "Fix login\n\nSafari only",
    );
    expect(taskEmbeddingText("T", "x".repeat(10_000))).toHaveLength(
      MAX_SINGLE_CHARS,
    );
    expect(commentEmbeddingText("Fix login", "Same on Firefox")).toBe(
      "Fix login\n\nSame on Firefox",
    );
  });

  it("chunks long pages at breaks, with overlap, and caps the count", () => {
    const paragraph = `${"word ".repeat(150).trim()}.`;
    const text = Array.from({ length: 12 }, () => paragraph).join("\n\n");
    const chunks = chunkText(text, { size: 1000, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(1000);
    // Together they cover the whole text.
    expect(chunks.join(" ").length).toBeGreaterThanOrEqual(text.length * 0.9);

    expect(chunkText("short")).toEqual(["short"]);
    expect(chunkText("   ")).toEqual([]);
    expect(chunkText("a ".repeat(CHUNK_CHARS * MAX_PAGE_CHUNKS)).length).toBe(
      MAX_PAGE_CHUNKS,
    );
  });

  it("prefixes page chunks with the title, and embeds a title-only page", () => {
    const chunks = pageEmbeddingChunks(
      "Roadmap",
      `${"Plan the launch. ".repeat(400)}`,
    );
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks)
      expect(chunk.startsWith("Roadmap\n\n")).toBe(true);
    expect(pageEmbeddingChunks("Only a title", "")).toEqual(["Only a title"]);
    expect(pageEmbeddingChunks("", "")).toEqual([]);
  });

  it("hashes text per model", () => {
    const a = contentHash("m1", ["one", "two"]);
    expect(contentHash("m1", ["one", "two"])).toBe(a);
    expect(contentHash("m2", ["one", "two"])).not.toBe(a);
    expect(contentHash("m1", ["onetwo"])).not.toBe(a);
  });
});

describe("Reciprocal Rank Fusion", () => {
  it("rewards hits found both ways and keeps exact keys first", () => {
    const lexical = [
      hit("task", "key", 10),
      hit("task", "a", 3),
      hit("page", "b", 2),
    ];
    const semantic = [
      hit("page", "b", 1.8),
      hit("task", "c", 1.6),
      hit("task", "a", 1.5),
    ];
    const fused = fuseHits(lexical, semantic, 10);
    expect(fused.map((h) => h.id)).toEqual(["key", "b", "a", "c"]);
    // The full-text version of a hit in both lists is kept.
    expect(fused.find((h) => h.id === "b")?.score).toBe(2);
    expect(fuseHits(lexical, semantic, 2).map((h) => h.id)).toEqual([
      "key",
      "b",
    ]);
  });

  it("tells types apart", () => {
    const fused = fuseHits(
      [hit("task", "x", 3)],
      [hit("comment", "x", 1.5)],
      5,
    );
    expect(fused.map((h) => `${h.type}:${h.id}`)).toEqual([
      "task:x",
      "comment:x",
    ]);
  });
});

describe("embedding routing", () => {
  it("uses the fake provider only when it is the instance provider", async () => {
    expect(embeddingsConfigured(instance())).toBe(false);
    expect(await resolveEmbeddingDestination(instance())).toBeNull();
    const fake = await resolveEmbeddingDestination(
      instance({ provider: "fake" }),
    );
    expect(fake).toMatchObject({
      provider: "fake",
      kind: "cloud",
      model: FAKE_EMBEDDING_MODEL,
    });
  });

  it("treats an endpoint on a private address as local", async () => {
    const local = await resolveEmbeddingDestination(
      instance({
        embeddings: {
          baseUrl: "http://127.0.0.1:11434/v1",
          model: "nomic-embed-text",
          apiKey: "",
        },
      }),
    );
    expect(local).toMatchObject({
      kind: "local",
      provider: "openai_compatible",
      allowPrivate: true,
      model: "nomic-embed-text",
    });
    const cloud = await resolveEmbeddingDestination(
      instance({
        embeddings: {
          baseUrl: "https://8.8.8.8/v1",
          model: "text-embedding-3-small",
          apiKey: "sk",
        },
      }),
    );
    expect(cloud).toMatchObject({ kind: "cloud", allowPrivate: false });
  });

  it("applies the Model Router's tiers", async () => {
    const config = instance({ provider: "fake" });
    const cloud = await resolveEmbeddingDestination(config);
    if (!cloud) throw new Error("expected a destination");
    const local = { ...cloud, kind: "local" as const };
    const policy = DEFAULT_WORKSPACE_AI_POLICY;
    const route = (
      destination: typeof cloud,
      dataTier: "private" | "restricted",
      overrides: Partial<AiInstanceConfig> = {},
      workspace = policy,
    ) =>
      embeddingRoute({
        destination,
        dataTier,
        instance: { ...config, ...overrides },
        workspace,
      });

    expect(route(cloud, "private")).toEqual({ ok: true, redact: false });
    // Restricted data defaults to local models only.
    expect(route(cloud, "restricted")).toMatchObject({
      ok: false,
      code: "AI_ROUTE_BLOCKED",
    });
    expect(route(local, "restricted")).toEqual({ ok: true, redact: false });
    expect(
      route(cloud, "restricted", {
        route: { restricted: "cloud", private: "cloud" },
      }),
    ).toEqual({ ok: true, redact: false });
    expect(
      route(local, "restricted", {
        route: { restricted: "blocked", private: "cloud" },
      }),
    ).toMatchObject({ ok: false });
    // Local-only (instance or workspace) keeps everything off the cloud.
    expect(route(cloud, "private", { localOnly: true })).toMatchObject({
      ok: false,
    });
    expect(
      route(cloud, "private", {}, { ...policy, localOnly: true }),
    ).toMatchObject({ ok: false });
    // Redaction applies to cloud endpoints only.
    expect(route(cloud, "private", { redaction: true })).toEqual({
      ok: true,
      redact: true,
    });
    expect(route(local, "private", { redaction: true })).toEqual({
      ok: true,
      redact: false,
    });
  });

  it("sizes vector casts for the HNSW limits", () => {
    expect(vectorCast(1536)).toBe("vector(1536)");
    expect(vectorCast(3072)).toBe("halfvec(3072)");
    expect(vectorCast(5000)).toBeNull();
    expect(vectorCast(0)).toBeNull();
  });
});
