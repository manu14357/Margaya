import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadTaskContext,
  resolveAiScopeFor,
} from "../../apps/api/src/ai/context";
import {
  aiComplete,
  aiStream,
  resetAiGatewayState,
  setAiProviderFactory,
} from "../../apps/api/src/ai/gateway";
import { buildSystemPrompt } from "../../apps/api/src/ai/prompt";
import { createFakeProvider } from "../../apps/api/src/ai/provider/fake";
import { respondWithAi } from "../../apps/api/src/ai/sse";
import { saveWorkspaceAiSettings } from "../../apps/api/src/ai/workspace-settings";
import db, { schema } from "../../apps/api/src/database";
import {
  aiUsageTable,
  auditLogTable,
  projectMemberTable,
  workspaceAiSettingTable,
} from "../../apps/api/src/database/schema";
import { apiRouter } from "../../apps/api/src/openapi";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";

type Scene = Awaited<ReturnType<typeof draftScene>>;

const AI_ENV = [
  "MARGAYA_AI_ENABLED",
  "MARGAYA_AI_PROVIDER",
  "MARGAYA_AI_LOCAL_BASE_URL",
  "MARGAYA_AI_LOCAL_MODEL",
  "MARGAYA_AI_USER_CONCURRENCY",
] as const;

function enableInstanceAi() {
  process.env.MARGAYA_AI_ENABLED = "true";
  process.env.MARGAYA_AI_PROVIDER = "fake";
}

beforeEach(async () => {
  await resetTestDatabase();
  resetRateLimitMemory();
  resetAiGatewayState();
});

afterEach(() => {
  for (const name of AI_ENV) delete process.env[name];
  setAiProviderFactory(null);
});

const allowAll = () => true;

function call(s: Scene, userId: string, extra: Record<string, unknown> = {}) {
  return aiComplete({
    workspaceId: s.workspaceId,
    userId,
    feature: "summarize",
    tier: "fast",
    system: buildSystemPrompt({ instructions: "Summarize.", locale: "en-US" }),
    messages: [{ role: "user", content: "Hello there" }],
    ...extra,
  });
}

async function restrict(s: Scene, members: string[]) {
  await db
    .update(schema.projectTable)
    .set({ visibility: "restricted" })
    .where(eq(schema.projectTable.id, s.api.project.id));
  for (const userId of members) {
    await db
      .insert(projectMemberTable)
      .values({ projectId: s.api.project.id, userId, role: "member" });
  }
}

async function insertTask(projectId: string, title: string) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId, title, status: "to-do", number: 500 })
    .returning();
  if (!task) throw new Error("Failed to insert task");
  return task;
}

async function usageRows(workspaceId: string) {
  return db
    .select()
    .from(aiUsageTable)
    .where(eq(aiUsageTable.workspaceId, workspaceId));
}

describe("AI is off by default", () => {
  it("hides AI and refuses calls until the instance and workspace opt in", async () => {
    const s = await draftScene();
    const availability = await s.ok<{
      available: boolean;
      instanceEnabled: boolean;
      workspaceEnabled: boolean;
      canUse: boolean;
    }>(s.mia, "GET", `/ai/availability?workspaceId=${s.workspaceId}`);
    expect(availability).toMatchObject({
      available: false,
      instanceEnabled: false,
      workspaceEnabled: false,
      canUse: true,
    });
    await expect(call(s, s.mia.id)).rejects.toMatchObject({
      code: "AI_DISABLED",
    });

    enableInstanceAi();
    await expect(call(s, s.mia.id)).rejects.toMatchObject({
      code: "AI_DISABLED",
      message: "AI is turned off for this workspace",
    });

    await s.ok(s.owner, "PATCH", "/ai/settings", {
      workspaceId: s.workspaceId,
      enabled: true,
    });
    const result = await call(s, s.mia.id);
    expect(result.text).toBe("[fake:fake-fast] Hello there");
    expect(result.meta).toMatchObject({
      provider: "fake",
      destination: "cloud",
      dataTier: "private",
    });
    expect(
      (
        await s.ok<{ available: boolean }>(
          s.mia,
          "GET",
          `/ai/availability?workspaceId=${s.workspaceId}`,
        )
      ).available,
    ).toBe(true);
    expect(await usageRows(s.workspaceId)).toHaveLength(0 + 1);
  });

  it("is refused with a JSON code over HTTP", async () => {
    const s = await draftScene();
    const response = await s.as(s.owner)(
      "GET",
      `/ai/availability?workspaceId=${s.outsiderWorkspaceId}`,
    );
    expect(response.status).toBe(403);
  });
});

describe("AI permissions", () => {
  it("lets admins manage, members use and viewers neither", async () => {
    enableInstanceAi();
    const s = await draftScene();
    for (const user of [s.vic, s.mia]) {
      const get = await s.as(user)(
        "GET",
        `/ai/settings?workspaceId=${s.workspaceId}`,
      );
      expect(get.status).toBe(403);
      const patch = await s.as(user)("PATCH", "/ai/settings", {
        workspaceId: s.workspaceId,
        enabled: true,
      });
      expect(patch.status).toBe(403);
      const usage = await s.as(user)(
        "GET",
        `/ai/usage?workspaceId=${s.workspaceId}`,
      );
      expect(usage.status).toBe(403);
    }
    const settings = await s.ok<{ workspace: { enabled: boolean } }>(
      s.ada,
      "PATCH",
      "/ai/settings",
      { workspaceId: s.workspaceId, enabled: true },
    );
    expect(settings.workspace.enabled).toBe(true);

    const viewer = await s.ok<{ canUse: boolean; available: boolean }>(
      s.vic,
      "GET",
      `/ai/availability?workspaceId=${s.workspaceId}`,
    );
    expect(viewer).toMatchObject({ canUse: false, available: false });
    const member = await s.ok<{ canUse: boolean; canManage: boolean }>(
      s.mia,
      "GET",
      `/ai/availability?workspaceId=${s.workspaceId}`,
    );
    expect(member).toMatchObject({ canUse: true, canManage: false });
  });

  it("never returns a workspace key and audits field names only", async () => {
    enableInstanceAi();
    const s = await draftScene();
    const settings = await s.ok<{
      workspace: { hasKey: boolean; keyLast4: string | null };
    }>(s.owner, "PATCH", "/ai/settings", {
      workspaceId: s.workspaceId,
      key: { provider: "anthropic", apiKey: "sk-ant-secret-value-1234" },
    });
    expect(settings.workspace).toMatchObject({
      hasKey: true,
      keyLast4: "1234",
    });
    expect(JSON.stringify(settings)).not.toContain("secret-value");

    const [row] = await db
      .select()
      .from(workspaceAiSettingTable)
      .where(eq(workspaceAiSettingTable.workspaceId, s.workspaceId));
    expect(row?.secret?.startsWith("sbx:v1:")).toBe(true);

    const audit = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.workspaceId, s.workspaceId),
          eq(auditLogTable.action, "ai.settings_updated"),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.metadata)).not.toContain("secret");
  });

  it("refuses local-only mode without a local model", async () => {
    enableInstanceAi();
    const s = await draftScene();
    const response = await s.as(s.owner)("PATCH", "/ai/settings", {
      workspaceId: s.workspaceId,
      localOnly: true,
    });
    expect(response.status).toBe(409);
  });
});

describe("AI context respects visibility", () => {
  it("keeps restricted projects out, hidden ones as 404, unless the workspace opts in", async () => {
    enableInstanceAi();
    const s = await draftScene();
    await restrict(s, [s.mia.id]);
    const secret = await insertTask(s.api.project.id, "Zebracorn secret");
    const open = await insertTask(s.web.project.id, "Open task");
    await saveWorkspaceAiSettings(s.workspaceId, { enabled: true }, s.owner.id);

    const miaScope = await resolveAiScopeFor({
      workspaceId: s.workspaceId,
      userId: s.mia.id,
      can: allowAll,
    });
    expect([...miaScope.projectIds]).toEqual([s.web.project.id]);
    expect(miaScope.excludedProjectIds.has(s.api.project.id)).toBe(true);
    await expect(loadTaskContext(miaScope, secret.id)).rejects.toMatchObject({
      code: "AI_DISABLED",
    });

    // Vic can't see the project at all: it reads as missing.
    const vicScope = await resolveAiScopeFor({
      workspaceId: s.workspaceId,
      userId: s.vic.id,
      can: allowAll,
    });
    expect(vicScope.excludedProjectIds.has(s.api.project.id)).toBe(false);
    await expect(loadTaskContext(vicScope, secret.id)).rejects.toMatchObject({
      status: 404,
    });

    // Another workspace's caller never reaches it either.
    const outsiderScope = await resolveAiScopeFor({
      workspaceId: s.outsiderWorkspaceId,
      userId: s.outsider.id,
      can: allowAll,
    });
    await expect(loadTaskContext(outsiderScope, open.id)).rejects.toMatchObject(
      { status: 404 },
    );

    // Opted in: Mia's scope has it, marked restricted, and the router keeps
    // it away from the cloud (no local model here).
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { includeRestricted: true },
      s.owner.id,
    );
    const optedIn = await resolveAiScopeFor({
      workspaceId: s.workspaceId,
      userId: s.mia.id,
      can: allowAll,
    });
    const items = await loadTaskContext(optedIn, secret.id);
    expect(items[0]).toMatchObject({ kind: "task", dataTier: "restricted" });
    await expect(call(s, s.mia.id, { context: items })).rejects.toMatchObject({
      code: "AI_ROUTE_BLOCKED",
    });

    // With a local model the call goes there.
    process.env.MARGAYA_AI_LOCAL_BASE_URL = "http://ollama.internal:11434/v1";
    process.env.MARGAYA_AI_LOCAL_MODEL = "llama3.3";
    const destinations: string[] = [];
    setAiProviderFactory((destination) => {
      destinations.push(destination.kind);
      return createFakeProvider();
    });
    const result = await call(s, s.mia.id, { context: items });
    expect(result.meta).toMatchObject({
      destination: "local",
      dataTier: "restricted",
      model: "llama3.3",
    });
    expect(destinations).toEqual(["local"]);
  });

  it("refuses context from a project with AI turned off", async () => {
    enableInstanceAi();
    const s = await draftScene();
    await saveWorkspaceAiSettings(s.workspaceId, { enabled: true }, s.owner.id);
    const task = await insertTask(s.web.project.id, "Task");
    const scope = await resolveAiScopeFor({
      workspaceId: s.workspaceId,
      userId: s.mia.id,
      can: allowAll,
    });
    const items = await loadTaskContext(scope, task.id);
    await db
      .update(schema.projectTable)
      .set({ aiEnabled: false })
      .where(eq(schema.projectTable.id, s.web.project.id));
    await expect(call(s, s.mia.id, { context: items })).rejects.toMatchObject({
      code: "AI_DISABLED",
    });
    const availability = await s.ok<{
      projectEnabled: boolean;
      available: boolean;
    }>(
      s.mia,
      "GET",
      `/ai/availability?workspaceId=${s.workspaceId}&projectId=${s.web.project.id}`,
    );
    expect(availability).toMatchObject({
      projectEnabled: false,
      available: false,
    });
  });
});

describe("AI ledger and budgets", () => {
  it("records every call and blocks at the user's daily cap", async () => {
    enableInstanceAi();
    const s = await draftScene();
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { enabled: true, userDailyCapTokens: 10 },
      s.owner.id,
    );
    await call(s, s.mia.id);
    const rows = await usageRows(s.workspaceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: s.mia.id,
      feature: "summarize",
      provider: "fake",
      model: "fake-fast",
      status: "ok",
    });
    expect(
      (rows[0]?.inputTokens ?? 0) + (rows[0]?.outputTokens ?? 0),
    ).toBeGreaterThan(10);

    await expect(call(s, s.mia.id)).rejects.toMatchObject({
      code: "AI_BUDGET_EXCEEDED",
      status: 429,
    });
    // Someone else still has their own daily allowance.
    await expect(call(s, s.ada.id)).resolves.toBeTruthy();
  });

  it("blocks the workspace at its monthly cap", async () => {
    enableInstanceAi();
    const s = await draftScene();
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { enabled: true, monthlyCapMicros: 1_000_000 },
      s.owner.id,
    );
    await db.insert(aiUsageTable).values({
      workspaceId: s.workspaceId,
      userId: s.ada.id,
      feature: "ask",
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      tier: "balanced",
      dataTier: "private",
      status: "ok",
      costMicros: 1_000_000,
    });
    await expect(call(s, s.mia.id)).rejects.toMatchObject({
      code: "AI_BUDGET_EXCEEDED",
    });
  });

  it("summarizes usage for admins", async () => {
    enableInstanceAi();
    const s = await draftScene();
    await saveWorkspaceAiSettings(s.workspaceId, { enabled: true }, s.owner.id);
    await call(s, s.mia.id);
    await call(s, s.ada.id, { feature: "ask" });
    const usage = await s.ok<{
      totals: { calls: number };
      byFeature: { feature: string; calls: number }[];
      byUser: { userId: string; calls: number }[];
      byDay: { day: string; calls: number }[];
    }>(s.owner, "GET", `/ai/usage?workspaceId=${s.workspaceId}`);
    expect(usage.totals.calls).toBe(2);
    expect(usage.byFeature.map((row) => row.feature).sort()).toEqual([
      "ask",
      "summarize",
    ]);
    expect(usage.byUser).toHaveLength(2);
    expect(usage.byDay).toHaveLength(1);
  });

  it("tests the workspace connection and records it", async () => {
    enableInstanceAi();
    const s = await draftScene();
    const result = await s.ok<{ ok: boolean; provider: string }>(
      s.owner,
      "POST",
      "/ai/settings/test",
      { workspaceId: s.workspaceId },
    );
    expect(result).toMatchObject({ ok: true, provider: "fake" });
    const rows = await usageRows(s.workspaceId);
    expect(rows[0]?.feature).toBe("connection_test");
  });
});

describe("AI streaming", () => {
  function streamingApp(s: Scene) {
    return apiRouter().post("/stream", async (c) => {
      const stream = await aiStream({
        workspaceId: s.workspaceId,
        userId: s.mia.id,
        feature: "summarize",
        system: buildSystemPrompt({ instructions: "Echo." }),
        messages: [{ role: "user", content: "one two three" }],
      });
      return respondWithAi(c, stream, { extra: { citations: [] } });
    });
  }

  it("streams SSE events and falls back to JSON", async () => {
    enableInstanceAi();
    const s = await draftScene();
    await saveWorkspaceAiSettings(s.workspaceId, { enabled: true }, s.owner.id);
    const app = streamingApp(s);

    const sse = await app.request("/stream", {
      method: "POST",
      headers: { accept: "text/event-stream" },
    });
    expect(sse.headers.get("content-type")).toContain("text/event-stream");
    const body = await sse.text();
    const events = [...body.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map(
      (match) => ({ event: match[1], data: JSON.parse(match[2] ?? "null") }),
    );
    expect(events[0]).toMatchObject({
      event: "meta",
      data: { provider: "fake", citations: [] },
    });
    const text = events
      .filter((event) => event.event === "delta")
      .map((event) => event.data.text)
      .join("");
    expect(text).toBe("[fake:fake-balanced] one two three");
    expect(events.at(-1)).toMatchObject({
      event: "done",
      data: { stop: "end_turn" },
    });

    const json = await app.request("/stream", {
      method: "POST",
      headers: { accept: "application/json" },
    });
    expect(json.status).toBe(200);
    expect(await json.json()).toMatchObject({
      text: "[fake:fake-balanced] one two three",
      stop: "end_turn",
      meta: { citations: [] },
    });
    expect(await usageRows(s.workspaceId)).toHaveLength(2);
  });

  it("limits each person to two concurrent streams", async () => {
    enableInstanceAi();
    const s = await draftScene();
    await saveWorkspaceAiSettings(s.workspaceId, { enabled: true }, s.owner.id);
    const start = () =>
      aiStream({
        workspaceId: s.workspaceId,
        userId: s.mia.id,
        feature: "summarize",
        system: ["x"],
        messages: [{ role: "user", content: "hi" }],
      });
    const first = await start();
    const second = await start();
    await expect(start()).rejects.toMatchObject({ code: "AI_RATE_LIMITED" });
    first.cancel();
    second.cancel();
    const third = await start();
    third.cancel();
  });

  it("redacts PII before the provider and restores it in the answer", async () => {
    enableInstanceAi();
    const s = await draftScene();
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { enabled: true, redactPii: true },
      s.owner.id,
    );
    const seen: string[] = [];
    setAiProviderFactory(() => {
      const fake = createFakeProvider();
      return {
        id: "fake",
        stream(request, signal) {
          seen.push(JSON.stringify(request.messages));
          return fake.stream(request, signal);
        },
      };
    });
    const result = await call(s, s.mia.id, {
      messages: [{ role: "user", content: "Mail ana@example.com" }],
    });
    expect(seen[0]).not.toContain("ana@example.com");
    expect(seen[0]).toContain("[EMAIL_1]");
    expect(result.text).toContain("ana@example.com");
    expect(result.meta.redactions).toBe(1);
  });
});
