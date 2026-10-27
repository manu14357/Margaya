import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetAiGatewayState,
  setAiProviderFactory,
} from "../../apps/api/src/ai/gateway";
import { setFakeResponder } from "../../apps/api/src/ai/provider/fake";
import type { ChatRequest } from "../../apps/api/src/ai/types";
import { saveWorkspaceAiSettings } from "../../apps/api/src/ai/workspace-settings";
import {
  maybeWarnBudget,
  resetBudgetWarnings,
} from "../../apps/api/src/ai-budget/status";
import db, { schema } from "../../apps/api/src/database";
import { aiUsageTable } from "../../apps/api/src/database/schema";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";

// Editor and everyday AI: tone presets, comment drafts, task summaries,
// page titles, AI blocks, live label suggestions, natural-language filters,
// the inbox digest and the budget warning, all on the fake provider.

type Scene = Awaited<ReturnType<typeof draftScene>>;
type AiJson = { text: string; meta: { model: string } };

const AI_ENV = ["MARGAYA_AI_ENABLED", "MARGAYA_AI_PROVIDER"] as const;

beforeEach(async () => {
  await resetTestDatabase();
  resetRateLimitMemory();
  resetAiGatewayState();
  resetBudgetWarnings();
});

afterEach(() => {
  for (const name of AI_ENV) delete process.env[name];
  setAiProviderFactory(null);
  setFakeResponder(null);
  resetAiGatewayState();
});

function lastText(request: ChatRequest): string {
  const last = request.messages.at(-1)?.content;
  return typeof last === "string" ? last : "";
}

/** The fake echoes the prompt unless `json` scripts a structured answer. */
async function aiScene(json?: (request: ChatRequest) => unknown) {
  process.env.MARGAYA_AI_ENABLED = "true";
  process.env.MARGAYA_AI_PROVIDER = "fake";
  const s = await draftScene();
  await saveWorkspaceAiSettings(s.workspaceId, { enabled: true }, s.owner.id);
  const prompts: string[] = [];
  setFakeResponder((request) => {
    prompts.push(lastText(request));
    if (request.jsonSchema && json) {
      return { text: JSON.stringify(json(request)) };
    }
    return { text: `[fake:${request.model}] ${lastText(request)}` };
  });
  return Object.assign(s, { prompts });
}

async function insertTask(
  projectId: string,
  title: string,
  extra: Partial<typeof schema.taskTable.$inferInsert> = {},
) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId, title, status: "to-do", number: 7, ...extra })
    .returning();
  if (!task) throw new Error("Failed to insert task");
  return task;
}

async function insertPage(s: Scene, title: string, content: string) {
  const [page] = await db
    .insert(schema.pageTable)
    .values({
      workspaceId: s.workspaceId,
      projectId: s.web.project.id,
      title,
      contentText: content,
      ownerId: s.mia.id,
      access: "public",
    })
    .returning();
  if (!page) throw new Error("Failed to insert page");
  return page;
}

function post(s: Scene, user: Scene["mia"], path: string, body: unknown) {
  return s.as(user)("POST", `${path}?stream=false`, body);
}

async function okJson<T = AiJson>(response: Response): Promise<T> {
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as T;
}

describe("editor assist extras", () => {
  it("adds the tone to rewrites and leaves it out of fixes", async () => {
    const s = await aiScene();
    const task = await insertTask(s.web.project.id, "Fix login");
    const base = {
      workspaceId: s.workspaceId,
      target: { kind: "task", id: task.id },
      text: "hey team the login thing is broken",
    };
    const improved = await okJson(
      await post(s, s.mia, "/ai/writing/assist", {
        ...base,
        action: "improve",
        tone: "professional",
      }),
    );
    expect(improved.text).toContain("Use a professional tone");
    expect(improved.text).not.toContain("same language and tone");

    const fixed = await okJson(
      await post(s, s.mia, "/ai/writing/assist", {
        ...base,
        action: "fix",
        tone: "casual",
      }),
    );
    expect(fixed.text).not.toContain("casual tone");

    const bad = await post(s, s.mia, "/ai/writing/assist", {
      ...base,
      action: "improve",
      tone: "angry",
    });
    expect(bad.status).toBe(400);
  });

  it("helps with a comment draft for people who may comment", async () => {
    const s = await aiScene();
    const task = await insertTask(s.web.project.id, "Fix login");
    const body = {
      workspaceId: s.workspaceId,
      target: { kind: "comment_draft", id: task.id },
      action: "shorter",
      text: "I looked into it and I think the session cookie expires early",
    };
    const result = await okJson(
      await post(s, s.mia, "/ai/writing/assist", body),
    );
    expect(result.text).toContain('<untrusted source="comment_draft-passage">');
    expect((await post(s, s.vic, "/ai/writing/assist", body)).status).toBe(403);
  });
});

describe("task summary", () => {
  it("summarizes the description, comments and history", async () => {
    const s = await aiScene();
    const task = await insertTask(s.web.project.id, "Offline mode", {
      description: "Users lose work on flaky networks.",
    });
    await db.insert(schema.activityTable).values([
      {
        taskId: task.id,
        type: "comment",
        userId: s.ada.id,
        content: "We agreed to ship sync first.",
      },
      {
        taskId: task.id,
        type: "status_changed",
        userId: s.mia.id,
        eventData: { oldStatus: "to-do", newStatus: "in-progress" },
      },
    ]);
    const result = await okJson(
      await post(s, s.mia, "/ai/writing/summarize", {
        workspaceId: s.workspaceId,
        kind: "task",
        id: task.id,
      }),
    );
    expect(result.meta.model).toBe("fake-fast");
    expect(result.text).toContain("Users lose work on flaky networks.");
    expect(result.text).toContain("We agreed to ship sync first.");
    expect(result.text).toContain('<untrusted source="task-history">');
    // jsonb keeps its own key order.
    expect(result.text).toMatch(/Mia status_changed \(.*oldStatus: to-do/);
    expect(result.text).toContain("Mia");
  });
});

describe("page title and AI block", () => {
  it("suggests one clean title from the live content", async () => {
    const s = await aiScene();
    setFakeResponder(() => ({ text: '# "Q3 launch plan."\nmore' }));
    const page = await insertPage(s, "Untitled", "saved text");
    const result = await okJson<{ title: string }>(
      await post(s, s.mia, "/ai/writing/title", {
        workspaceId: s.workspaceId,
        pageId: page.id,
        text: "We launch in Q3",
      }),
    );
    expect(result.title).toBe("Q3 launch plan");
    expect(
      (
        await post(s, s.vic, "/ai/writing/title", {
          workspaceId: s.workspaceId,
          pageId: page.id,
        })
      ).status,
    ).toBe(403);
  });

  it("refuses to title an empty page", async () => {
    const s = await aiScene();
    const page = await insertPage(s, "Untitled", "");
    const response = await post(s, s.mia, "/ai/writing/title", {
      workspaceId: s.workspaceId,
      pageId: page.id,
    });
    expect(response.status).toBe(422);
  });

  it("generates a preset block from the page and needs an instruction for custom", async () => {
    const s = await aiScene();
    const page = await insertPage(s, "Plan", "Saved: launch on Friday");
    const faq = await okJson(
      await post(s, s.mia, "/ai/writing/page-block", {
        workspaceId: s.workspaceId,
        pageId: page.id,
        preset: "faq",
        text: "Live: launch on Monday",
      }),
    );
    expect(faq.text).toContain("Write an FAQ");
    expect(faq.text).toContain("Live: launch on Monday");
    expect(faq.text).not.toContain("Saved: launch on Friday");

    const missing = await post(s, s.mia, "/ai/writing/page-block", {
      workspaceId: s.workspaceId,
      pageId: page.id,
      preset: "custom",
    });
    expect(missing.status).toBe(400);
    const viewer = await post(s, s.vic, "/ai/writing/page-block", {
      workspaceId: s.workspaceId,
      pageId: page.id,
      preset: "tldr",
    });
    expect(viewer.status).toBe(403);
  });
});

describe("live label suggestions", () => {
  it("keeps only real workspace labels the draft doesn't have", async () => {
    const s = await aiScene(() => ({
      labels: [
        { ref: "L1", reason: "It is about a bug" },
        { ref: "L2", reason: "Already there" },
        { ref: "L9", reason: "Invented" },
      ],
    }));
    const [bug, ui] = await db
      .insert(schema.labelTable)
      .values([
        { name: "Bug", color: "#f00", workspaceId: s.workspaceId },
        { name: "UI", color: "#0f0", workspaceId: s.workspaceId },
      ])
      .returning();
    const result = await okJson<{ labels: { labelId: string }[] }>(
      await post(s, s.mia, "/ai/triage/labels", {
        projectId: s.web.project.id,
        title: "Login button crashes",
        labelIds: [ui?.id],
      }),
    );
    expect(result.labels.map((label) => label.labelId)).toEqual([bug?.id]);
    expect(s.prompts.at(-1)).toContain("L1: Bug");

    const viewer = await post(s, s.vic, "/ai/triage/labels", {
      projectId: s.web.project.id,
      title: "Login button crashes",
    });
    expect(viewer.status).toBe(403);
  });
});

describe("natural-language filters", () => {
  it("maps references to ids and drops what it doesn't know", async () => {
    const s = await aiScene((request) => {
      const text = lastText(request);
      const status = /(S\d+): In Progress/.exec(text)?.[1] ?? "S0";
      const person = /(P\d+): Mia/.exec(text)?.[1] ?? "P0";
      return {
        op: "and",
        conditions: [
          { key: "status", operator: "in", values: [status, "S99"] },
          { key: "assignee", operator: "in", values: [person, "me"] },
          { key: "priority", operator: "in", values: ["HIGH", "extreme"] },
          { key: "dueDate", operator: "in", values: ["past"] },
          {
            key: "startDate",
            operator: "withinLast",
            amount: 9999,
            unit: "days",
          },
          { key: "subscriber", operator: "in", values: ["me"] },
        ],
        unmatched: ["Sprint 1"],
      };
    });
    const result = await okJson<{
      filters: { op: string; children: Record<string, unknown>[] };
      dropped: string[];
    }>(
      await post(s, s.mia, "/ai/filters/parse", {
        workspaceId: s.workspaceId,
        projectId: s.web.project.id,
        text: "my overdue high bugs in progress in Sprint 1",
      }),
    );
    expect(result.filters.op).toBe("and");
    expect(result.filters.children).toEqual([
      { key: "status", operator: "in", values: ["in-progress"] },
      { key: "assignee", operator: "in", values: [s.mia.id, "me"] },
      { key: "priority", operator: "in", values: ["high"] },
      { key: "dueDate", operator: "in", values: ["past"] },
    ]);
    expect(result.dropped).toEqual(
      expect.arrayContaining([
        "Sprint 1",
        "S99",
        "extreme",
        "startDate",
        "subscriber",
      ]),
    );

    // The tree runs as is.
    const query = await s.as(s.mia)("POST", "/task-query", {
      workspaceId: s.workspaceId,
      scope: { projectIds: [s.web.project.id] },
      filters: result.filters,
      mode: "ids",
    });
    expect(query.status, await query.clone().text()).toBe(200);
  });

  it("has no status key for the whole workspace and answers null when nothing matched", async () => {
    const s = await aiScene(() => ({
      op: "and",
      conditions: [{ key: "status", operator: "in", values: ["S1"] }],
      unmatched: [],
    }));
    const result = await okJson<{ filters: unknown; dropped: string[] }>(
      await post(s, s.mia, "/ai/filters/parse", {
        workspaceId: s.workspaceId,
        text: "things in progress",
      }),
    );
    expect(result.filters).toBeNull();
    expect(result.dropped).toContain("status");
    expect(s.prompts.at(-1)).not.toContain("Statuses (key status)");
  });

  it("needs ai:use and AI on", async () => {
    const s = await aiScene();
    const body = { workspaceId: s.workspaceId, text: "my tasks" };
    expect((await post(s, s.outsider, "/ai/filters/parse", body)).status).toBe(
      403,
    );
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { enabled: false },
      s.owner.id,
    );
    const off = await post(s, s.mia, "/ai/filters/parse", body);
    expect(off.status).toBe(403);
    expect(await off.json()).toMatchObject({ code: "AI_DISABLED" });
  });
});

describe("inbox digest", () => {
  it("summarizes unread notifications AI may read", async () => {
    const s = await aiScene();
    const visible = await insertTask(s.web.project.id, "Fix the login page");
    const hidden = await insertTask(s.api.project.id, "Zebracorn rollout", {
      number: 8,
    });
    await db
      .update(schema.projectTable)
      .set({ aiEnabled: false })
      .where(eq(schema.projectTable.id, s.api.project.id));
    const base = { userId: s.mia.id, workspaceId: s.workspaceId };
    await db.insert(schema.notificationTable).values([
      {
        ...base,
        id: "n1",
        type: "task_mention",
        title: "Ada mentioned you",
        content: "Can you check this?",
        resourceId: visible.id,
        resourceType: "task",
      },
      {
        ...base,
        id: "n2",
        type: "task_comment",
        title: "New comment",
        resourceId: hidden.id,
        resourceType: "task",
      },
      {
        ...base,
        id: "n3",
        type: "task_comment",
        title: "Already read",
        resourceId: visible.id,
        resourceType: "task",
        isRead: true,
      },
    ]);
    const result = await okJson<
      AiJson & { unread: number; included: number; citations: unknown[] }
    >(
      await post(s, s.mia, "/ai/insight/inbox-digest", {
        workspaceId: s.workspaceId,
      }),
    );
    expect(result.unread).toBe(2);
    expect(result.included).toBe(1);
    expect(result.text).toContain("Fix the login page");
    expect(result.text).toContain("Can you check this?");
    expect(result.text).not.toContain("Zebracorn");
    expect(result.text).not.toContain("Already read");
    expect(result.citations).toHaveLength(1);
  });
});

describe("budget status and warning", () => {
  async function spend(s: Scene, costMicros: number) {
    await db.insert(aiUsageTable).values({
      workspaceId: s.workspaceId,
      userId: s.mia.id,
      feature: "ask",
      provider: "fake",
      model: "fake-fast",
      tier: "fast",
      dataTier: "private",
      status: "ok",
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costMicros,
      durationMs: 1,
    });
  }

  it("reports use against the cap, with amounts for AI managers only", async () => {
    const s = await aiScene();
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { monthlyCapMicros: 1_000_000 },
      s.owner.id,
    );
    await spend(s, 850_000);
    const owner = await okJson<Record<string, unknown>>(
      await s.as(s.owner)(
        "GET",
        `/ai/budget-status?workspaceId=${s.workspaceId}`,
      ),
    );
    expect(owner).toMatchObject({
      monthlyCapMicros: 1_000_000,
      usedMicros: 850_000,
      usedPercent: 85,
      warning: true,
    });
    const member = await okJson<Record<string, unknown>>(
      await s.as(s.mia)(
        "GET",
        `/ai/budget-status?workspaceId=${s.workspaceId}`,
      ),
    );
    expect(member).toMatchObject({
      monthlyCapMicros: null,
      usedMicros: null,
      usedPercent: 85,
      warning: true,
    });
    expect(
      (
        await s.as(s.outsider)(
          "GET",
          `/ai/budget-status?workspaceId=${s.workspaceId}`,
        )
      ).status,
    ).toBe(403);
  });

  it("notifies AI managers once a month from 80%", async () => {
    const s = await aiScene();
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { monthlyCapMicros: 1_000_000 },
      s.owner.id,
    );
    await spend(s, 500_000);
    expect(await maybeWarnBudget(s.workspaceId)).toBe(0);
    await spend(s, 350_000);
    // Owner and admin manage AI; the member and the viewer don't.
    expect(await maybeWarnBudget(s.workspaceId)).toBe(2);
    resetBudgetWarnings();
    expect(await maybeWarnBudget(s.workspaceId)).toBe(0);
    const notices = await db
      .select()
      .from(schema.notificationTable)
      .where(
        and(
          eq(schema.notificationTable.workspaceId, s.workspaceId),
          eq(schema.notificationTable.type, "ai_budget_warning"),
        ),
      );
    expect(notices.map((notice) => notice.userId).sort()).toEqual(
      [s.owner.id, s.ada.id].sort(),
    );
    expect(notices[0]?.eventData).toMatchObject({ usedPercent: 85 });
  });
});

describe("rule compiler: run_agent", () => {
  it("offers the workspace's enabled agents to the compiler", async () => {
    const s = await aiScene(() => ({ rules: [], unsupported: [] }));
    const bot = await s.ok<{ id: string }>(s.owner, "POST", "/ai/agents", {
      workspaceId: s.workspaceId,
      name: "Triage Bot",
      instructions: "Keep tasks tidy.",
    });
    const response = await s.as(s.owner)("POST", "/ai/rules/compile", {
      projectId: s.web.project.id,
      prompt: "When a bug is created, ask Triage Bot to triage it",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const prompt = s.prompts.at(-1) ?? "";
    expect(prompt).toContain("AI agents for run_agent");
    expect(prompt).toContain(`${bot.id}: Triage Bot`);
  });
});
