import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAiGatewayState } from "../../apps/api/src/ai/gateway";
import { getAiInstanceConfig } from "../../apps/api/src/ai/instance-config";
import { setFakeResponder } from "../../apps/api/src/ai/provider/fake";
import type { ChatRequest } from "../../apps/api/src/ai/types";
import { saveWorkspaceAiSettings } from "../../apps/api/src/ai/workspace-settings";
import { memoryNotesFor } from "../../apps/api/src/ai-memory-notes/load";
import {
  setSpeechFetch,
  speechDestinationAllowed,
  testSpeechEndpoint,
} from "../../apps/api/src/ai-speech";
import { setWebSearchFetch, webSearch } from "../../apps/api/src/ai-web-search";
import db, { schema } from "../../apps/api/src/database";
import { aiUsageTable } from "../../apps/api/src/database/schema";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";

// The chat side of Ask: reasoning, follow-ups, "@" context, web search,
// attachments, skills, memory notes, feedback, server history, speech and
// the settings, availability and usage they show in (fake provider).

type Scene = Awaited<ReturnType<typeof draftScene>>;
type User = Scene["mia"];

const ENV = [
  "MARGAYA_AI_ENABLED",
  "MARGAYA_AI_PROVIDER",
  "MARGAYA_AI_SHOW_REASONING",
  "MARGAYA_AI_WEB_SEARCH_PROVIDER",
  "MARGAYA_AI_WEB_SEARCH_URL",
  "MARGAYA_AI_WEB_SEARCH_API_KEY",
  "MARGAYA_AI_SPEECH_BASE_URL",
  "MARGAYA_AI_SPEECH_MODEL",
] as const;

let requests: ChatRequest[] = [];
let answer: string | null = null;
let reasoning: string | null = null;

beforeEach(async () => {
  await resetTestDatabase();
  resetRateLimitMemory();
  resetAiGatewayState();
  requests = [];
  answer = null;
  reasoning = null;
  setFakeResponder((request) => {
    requests.push(request);
    if (request.jsonSchema) return null;
    if (answer === null) return null;
    return { text: answer, ...(reasoning ? { reasoning } : {}) };
  });
});

afterEach(() => {
  for (const name of ENV) delete process.env[name];
  setFakeResponder(null);
  setWebSearchFetch(null);
  setSpeechFetch(null);
});

async function aiScene() {
  process.env.MARGAYA_AI_ENABLED = "true";
  process.env.MARGAYA_AI_PROVIDER = "fake";
  const s = await draftScene();
  await saveWorkspaceAiSettings(s.workspaceId, { enabled: true }, s.owner.id);
  return s;
}

let nextNumber = 500;

async function insertTask(
  projectId: string,
  title: string,
  values: Partial<typeof schema.taskTable.$inferInsert> = {},
) {
  nextNumber += 1;
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title,
      status: "to-do",
      number: nextNumber,
      ...values,
    })
    .returning();
  if (!task) throw new Error("Failed to insert task");
  return task;
}

function answerCalls() {
  return requests.filter((request) => !request.jsonSchema);
}

function lastPrompt(): string {
  return JSON.stringify(answerCalls().at(-1)?.messages ?? []);
}

async function askJson(s: Scene, user: User, body: Record<string, unknown>) {
  const response = await s.as(user)("POST", "/ai/ask?stream=false", {
    workspaceId: s.workspaceId,
    ...body,
  });
  return response;
}

function events(text: string) {
  return text
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const event = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim();
      const data = /^data:\s*(.+)$/m.exec(block)?.[1];
      return event && data
        ? { event, data: JSON.parse(data) as Record<string, unknown> }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

describe("Ask answers like a chat", () => {
  it("strips follow-ups from the answer, sends them with done, and times reasoning", async () => {
    const s = await aiScene();
    const task = await insertTask(s.web.project.id, "Zebracorn rollout");
    const key = `WEB-${task.number}`;
    answer = `Rollout planned [T:${key}].\n\`\`\`followups\n["Who owns it?","When is it due?"]\n\`\`\``;
    reasoning = "Looking at the rollout task.";
    const response = await s.as(s.mia)("POST", "/ai/ask", {
      workspaceId: s.workspaceId,
      question: "zebracorn",
    });
    const list = events(await response.text());
    const reasoningEvents = list.filter((entry) => entry.event === "reasoning");
    // Reasoning text stays hidden unless the instance shows it.
    expect(reasoningEvents).toEqual([
      { event: "reasoning", data: { text: "" } },
    ]);
    const text = list
      .filter((entry) => entry.event === "delta")
      .map((entry) => entry.data.text)
      .join("");
    expect(text).toBe(`Rollout planned [T:${key}].`);
    const done = list.find((entry) => entry.event === "done")?.data;
    expect(done).toMatchObject({
      followUps: ["Who owns it?", "When is it due?"],
      citations: [`T:${key}`],
      noResults: false,
    });
    expect(typeof done?.reasoningMs).toBe("number");
    expect(answerCalls().at(-1)?.system[0]).toContain("the language followups");
  });

  it("streams reasoning text when the instance shows it, and never stores it", async () => {
    process.env.MARGAYA_AI_SHOW_REASONING = "true";
    const s = await aiScene();
    await insertTask(s.web.project.id, "Zebracorn rollout");
    answer = "Done.";
    reasoning = "Secret chain of thought.";
    const response = await s.as(s.mia)("POST", "/ai/ask", {
      workspaceId: s.workspaceId,
      question: "zebracorn",
    });
    const list = events(await response.text());
    expect(
      list
        .filter((entry) => entry.event === "reasoning")
        .map((entry) => entry.data.text)
        .join(""),
    ).toBe("Secret chain of thought.");
    expect(answerCalls().at(-1)?.reasoning).toBe(true);
    const usage = await db.select().from(aiUsageTable);
    expect(JSON.stringify(usage)).not.toContain("Secret chain");
  });

  it("reports the configured model and reasoningMs in the JSON fallback", async () => {
    const s = await aiScene();
    await insertTask(s.web.project.id, "Zebracorn rollout");
    answer = "Done.";
    const response = await askJson(s, s.mia, { question: "zebracorn" });
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      meta: { model: "fake-balanced", provider: "fake" },
      reasoningMs: null,
      followUps: [],
    });
  });
});

describe("Ask @ context", () => {
  it("loads mentioned tasks, cycles and people first, skipping invisible ones", async () => {
    const s = await aiScene();
    const task = await insertTask(s.web.project.id, "Quokka invoice export", {
      description: "Export invoices as CSV",
    });
    const cycle = await s.insertCycle({ name: "Sprint 9" });
    const inCycle = await insertTask(s.web.project.id, "Wombat cycle task");
    await db
      .insert(schema.cycleTaskTable)
      .values({ cycleId: cycle.id, taskId: inCycle.id });
    const assigned = await insertTask(s.api.project.id, "Mia's open item");
    await db
      .insert(schema.taskAssigneeTable)
      .values({ taskId: assigned.id, userId: s.mia.id });
    const hidden = await insertTask(s.api.project.id, "Hidden platypus");
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, s.api.project.id));
    answer = `See [T:WEB-${task.number}].`;

    const response = await askJson(s, s.ada, {
      question: "summarize these",
      context: [
        { kind: "task", id: task.id },
        { kind: "cycle", id: cycle.id },
        { kind: "user", id: s.mia.id },
        { kind: "task", id: hidden.id },
        { kind: "task", id: "no-such-task" },
      ],
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { sources: { ref: string }[] };
    expect(body.sources[0]?.ref).toBe(`T:WEB-${task.number}`);
    const prompt = lastPrompt();
    expect(prompt).toContain("Export invoices as CSV");
    expect(prompt).toContain('Cycle \\"Sprint 9\\"');
    expect(prompt).toContain("Wombat cycle task");
    expect(prompt).toContain("Open tasks assigned to Mia");
    // Restricted project, not included by the workspace: left out.
    expect(prompt).not.toContain("Hidden platypus");
    expect(prompt).not.toContain("Mia's open item");
  });

  it("validates the context list", async () => {
    const s = await aiScene();
    const response = await askJson(s, s.mia, {
      question: "x",
      context: [{ kind: "label", id: "x" }],
    });
    expect(response.status).toBe(400);
  });
});

describe("Ask trends", () => {
  it("adds created and completed per week for a trend question", async () => {
    const s = await aiScene();
    await insertTask(s.web.project.id, "Recent one");
    await insertTask(s.web.project.id, "Finished one", {
      status: "done",
      completedAt: new Date(),
    });
    answer = "Steady.";
    const response = await askJson(s, s.mia, {
      question: "Created vs completed per week",
    });
    expect(response.status).toBe(200);
    const prompt = lastPrompt();
    expect(prompt).toContain("Tasks created and completed per week");
    expect(prompt).toMatch(/created 2, completed 1/);
    expect(answerCalls().at(-1)?.system[0]).toContain('"series"');
  });
});

describe("Ask web search", () => {
  function braveResults(urls: string[]) {
    return new Response(
      JSON.stringify({
        web: {
          results: urls.map((url, i) => ({
            title: `Result ${i + 1}`,
            url,
            description: `<b>Snippet</b> ${i + 1}`,
          })),
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
  }

  it("is refused until the instance has a provider and the workspace opts in", async () => {
    const s = await aiScene();
    const off = await askJson(s, s.mia, { question: "x", webSearch: true });
    expect(off.status).toBe(403);
    expect(await off.json()).toMatchObject({ code: "AI_DISABLED" });
    process.env.MARGAYA_AI_WEB_SEARCH_PROVIDER = "brave";
    process.env.MARGAYA_AI_WEB_SEARCH_API_KEY = "brave-key";
    const workspaceOff = await askJson(s, s.mia, {
      question: "x",
      webSearch: true,
    });
    expect(workspaceOff.status).toBe(403);
  });

  it("sends only the question, and cites results as W refs", async () => {
    process.env.MARGAYA_AI_WEB_SEARCH_PROVIDER = "brave";
    process.env.MARGAYA_AI_WEB_SEARCH_API_KEY = "brave-key";
    const s = await aiScene();
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { webSearchEnabled: true },
      s.owner.id,
    );
    await insertTask(s.web.project.id, "Zebracorn secret plan");
    const seen: { url: string; headers: Record<string, string> }[] = [];
    setWebSearchFetch(async (input, init) => {
      seen.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return braveResults(["https://a.example/", "https://b.example/"]);
    });
    answer = "Per the docs [W:2] and [W:7].";
    const response = await askJson(s, s.mia, {
      question: "zebracorn release notes",
      webSearch: true,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      sources: { ref: string; kind: string; url: string }[];
      citations: string[];
    };
    expect(seen).toHaveLength(1);
    const query = new URL(seen[0]?.url ?? "").searchParams.get("q");
    expect(query).toBe("zebracorn release notes");
    expect(seen[0]?.url).not.toContain("secret");
    expect(seen[0]?.headers["x-subscription-token"]).toBe("brave-key");
    expect(body.sources.filter((source) => source.kind === "web")).toEqual([
      expect.objectContaining({ ref: "W:1", url: "https://a.example/" }),
      expect.objectContaining({ ref: "W:2", url: "https://b.example/" }),
    ]);
    expect(body.citations).toEqual(["W:2"]);
    expect(lastPrompt()).toContain("Snippet 2");
  });

  it("guards a SearXNG URL like other outbound calls", async () => {
    process.env.MARGAYA_AI_WEB_SEARCH_PROVIDER = "searxng";
    process.env.MARGAYA_AI_WEB_SEARCH_URL = "http://127.0.0.1:8888";
    const s = await aiScene();
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { webSearchEnabled: true },
      s.owner.id,
    );
    let called = false;
    setWebSearchFetch(async () => {
      called = true;
      return new Response("{}");
    });
    await expect(
      webSearch({ query: "x", workspaceId: s.workspaceId }),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" });
    expect(called).toBe(false);
  });
});

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("Ask attachments", () => {
  it("sends images as image content and text files as context", async () => {
    const s = await aiScene();
    answer = "It shows a chart.";
    const response = await askJson(s, s.mia, {
      question: "What is in these files?",
      attachments: [
        { name: "shot.png", mediaType: "image/png", data: PNG },
        {
          name: "notes.txt",
          mediaType: "text/plain",
          data: Buffer.from("Kiwi launch on Friday").toString("base64"),
        },
      ],
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const message = answerCalls().at(-1)?.messages.at(-1);
    expect(Array.isArray(message?.content)).toBe(true);
    const blocks = message?.content as { type: string; text?: string }[];
    expect(blocks[0]?.type).toBe("image");
    expect(blocks.at(-1)?.text).toContain("Kiwi launch on Friday");
    expect(answerCalls().at(-1)?.messages.at(-1)).toBeTruthy();
  });

  it("refuses a fake image", async () => {
    const s = await aiScene();
    const response = await askJson(s, s.mia, {
      question: "x",
      attachments: [
        {
          name: "a.png",
          mediaType: "image/png",
          data: Buffer.from("nope").toString("base64"),
        },
      ],
    });
    expect(response.status).toBe(400);
  });
});

describe("AI skills", () => {
  it("lists shared and own skills, lets creators or ai:manage edit, and feeds Ask", async () => {
    const s = await aiScene();
    const created = await s.ok<{ id: string; canEdit: boolean }>(
      s.mia,
      "POST",
      "/ai/skills",
      {
        workspaceId: s.workspaceId,
        name: "Standup",
        prompt: "Answer as a standup: yesterday, today, blockers.",
      },
    );
    expect(created.canEdit).toBe(true);
    const mine = await s.ok<{ id: string }>(s.mia, "POST", "/ai/skills", {
      workspaceId: s.workspaceId,
      name: "Private",
      prompt: "Only for me.",
      shared: false,
    });
    const adaList = await s.ok<{ skills: { id: string; canEdit: boolean }[] }>(
      s.ada,
      "GET",
      `/ai/skills?workspaceId=${s.workspaceId}`,
    );
    expect(adaList.skills.map((skill) => skill.id)).toEqual([created.id]);
    expect(adaList.skills[0]?.canEdit).toBe(true);

    // Another member can't change Mia's skill; the viewer can't list.
    const other = await s.as(s.owner)(
      "GET",
      `/ai/skills?workspaceId=${s.workspaceId}`,
    );
    expect(other.status).toBe(200);
    const viewer = await s.as(s.vic)(
      "GET",
      `/ai/skills?workspaceId=${s.workspaceId}`,
    );
    expect(viewer.status).toBe(403);

    const renamed = await s.ok<{ name: string }>(
      s.ada,
      "PATCH",
      `/ai/skills/${created.id}?workspaceId=${s.workspaceId}`,
      { name: "Daily standup" },
    );
    expect(renamed.name).toBe("Daily standup");
    const hiddenForAda = await s.as(s.ada)(
      "DELETE",
      `/ai/skills/${mine.id}?workspaceId=${s.workspaceId}`,
    );
    expect(hiddenForAda.status).toBe(404);

    await insertTask(s.web.project.id, "Zebracorn rollout");
    answer = "Yesterday…";
    const asked = await askJson(s, s.ada, {
      question: "zebracorn",
      skillId: created.id,
    });
    expect(asked.status).toBe(200);
    expect(lastPrompt()).toContain("yesterday, today, blockers");
    const privateSkill = await askJson(s, s.ada, {
      question: "zebracorn",
      skillId: mine.id,
    });
    expect(privateSkill.status).toBe(404);
  });
});

describe("AI memory notes", () => {
  it("lets ai:manage keep workspace notes, people keep private ones, and feeds prompts", async () => {
    const s = await aiScene();
    const refused = await s.as(s.mia)("POST", "/ai/memory", {
      workspaceId: s.workspaceId,
      scope: "workspace",
      content: "Release day is Thursday",
    });
    expect(refused.status).toBe(403);
    const workspaceNote = await s.ok<{ id: string; canEdit: boolean }>(
      s.ada,
      "POST",
      "/ai/memory",
      {
        workspaceId: s.workspaceId,
        scope: "workspace",
        content: "Release day is Thursday",
      },
    );
    await s.ok(s.ada, "POST", "/ai/memory", {
      workspaceId: s.workspaceId,
      scope: "project",
      projectId: s.web.project.id,
      content: "Web deploys need a design review",
    });
    const own = await s.ok<{ id: string }>(s.mia, "POST", "/ai/memory", {
      workspaceId: s.workspaceId,
      scope: "user",
      content: "I prefer bullet lists",
    });
    const miaList = await s.ok<{
      notes: { id: string; scope: string; canEdit: boolean }[];
    }>(s.mia, "GET", `/ai/memory?workspaceId=${s.workspaceId}`);
    expect(miaList.notes.map((note) => note.scope)).toEqual([
      "workspace",
      "project",
      "user",
    ]);
    expect(miaList.notes.map((note) => note.canEdit)).toEqual([
      false,
      false,
      true,
    ]);
    const adaList = await s.ok<{ notes: { id: string }[] }>(
      s.ada,
      "GET",
      `/ai/memory?workspaceId=${s.workspaceId}`,
    );
    expect(adaList.notes.map((note) => note.id)).not.toContain(own.id);
    const miaEdit = await s.as(s.mia)(
      "PATCH",
      `/ai/memory/${workspaceNote.id}?workspaceId=${s.workspaceId}`,
      { content: "Friday" },
    );
    expect(miaEdit.status).toBe(403);
    const adaDeletesOwn = await s.as(s.ada)(
      "DELETE",
      `/ai/memory/${own.id}?workspaceId=${s.workspaceId}`,
    );
    expect(adaDeletesOwn.status).toBe(404);

    expect(
      await memoryNotesFor({
        workspaceId: s.workspaceId,
        projectId: s.web.project.id,
        userId: s.mia.id,
      }),
    ).toEqual([
      "Release day is Thursday",
      "Web deploys need a design review",
      "I prefer bullet lists",
    ]);
    expect(
      await memoryNotesFor({ workspaceId: s.workspaceId, userId: s.ada.id }),
    ).toEqual(["Release day is Thursday"]);

    await insertTask(s.web.project.id, "Zebracorn rollout");
    answer = "Ok.";
    await askJson(s, s.mia, { question: "zebracorn" });
    const prompt = lastPrompt();
    expect(prompt).toContain("memory:notes");
    expect(prompt).toContain("Release day is Thursday");
    expect(prompt).toContain("I prefer bullet lists");
  });
});

describe("AI feedback and usage", () => {
  it("records ratings without text and shows them with usage, exports CSV", async () => {
    const s = await aiScene();
    for (const rating of [1, 1, -1]) {
      await s.ok(s.mia, "POST", "/ai/feedback", {
        workspaceId: s.workspaceId,
        feature: "ask",
        rating,
        reason: rating < 0 ? "Missed a task" : undefined,
        provider: "fake",
        model: "fake-balanced",
      });
    }
    const bad = await s.as(s.mia)("POST", "/ai/feedback", {
      workspaceId: s.workspaceId,
      feature: "ask",
      rating: 2,
    });
    expect(bad.status).toBe(400);
    const viewer = await s.as(s.vic)("POST", "/ai/feedback", {
      workspaceId: s.workspaceId,
      feature: "ask",
      rating: 1,
    });
    expect(viewer.status).toBe(403);

    await insertTask(s.web.project.id, "Zebracorn rollout");
    answer = "Ok.";
    await askJson(s, s.mia, { question: "zebracorn" });

    const usage = await s.ok<{
      feedback: { up: number; down: number; byFeature: unknown[] };
    }>(s.ada, "GET", `/ai/usage?workspaceId=${s.workspaceId}`);
    expect(usage.feedback).toEqual({
      up: 2,
      down: 1,
      byFeature: [{ feature: "ask", up: 2, down: 1 }],
    });

    const csv = await s.as(s.ada)(
      "GET",
      `/ai/usage/export?workspaceId=${s.workspaceId}`,
    );
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const text = await csv.text();
    expect(text).toContain('"day","feature","provider","model"');
    expect(text).toContain('"ask","fake","fake-balanced"');
    expect(text).toContain('"Mia"');
    expect(text).not.toContain("zebracorn");
    const member = await s.as(s.mia)(
      "GET",
      `/ai/usage/export?workspaceId=${s.workspaceId}`,
    );
    expect(member.status).toBe(403);
  });
});

describe("AI conversations on the server", () => {
  const turns = [
    {
      question: "What is due?",
      answer: "Two tasks [T:WEB-1].",
      sources: [{ ref: "T:WEB-1" }],
      citations: ["T:WEB-1"],
      createdAt: "2026-10-26T10:00:00.000Z",
    },
  ];

  it("answers AI_HISTORY_OFF until the workspace opts in", async () => {
    const s = await aiScene();
    const response = await s.as(s.mia)(
      "GET",
      `/ai/conversations?workspaceId=${s.workspaceId}`,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "AI_HISTORY_OFF" });
  });

  it("keeps each person's own conversations, pinned first", async () => {
    const s = await aiScene();
    await s.ok(s.ada, "PATCH", "/ai/settings", {
      workspaceId: s.workspaceId,
      storeConversations: true,
    });
    const first = await s.ok<{ id: string; turns: unknown[] }>(
      s.mia,
      "PUT",
      "/ai/conversations/conv-aaaa-1",
      { workspaceId: s.workspaceId, title: "Due work", turns },
    );
    expect(first.turns).toEqual(turns);
    await s.ok(s.mia, "PUT", "/ai/conversations/conv-bbbb-2", {
      workspaceId: s.workspaceId,
      title: "Second",
      projectId: s.web.project.id,
      turns: [],
    });
    await s.ok(
      s.mia,
      "PATCH",
      `/ai/conversations/conv-aaaa-1?workspaceId=${s.workspaceId}`,
      { pinned: true, title: "Renamed" },
    );
    const list = await s.ok<{
      conversations: {
        id: string;
        title: string;
        pinned: boolean;
        turnCount: number;
      }[];
    }>(s.mia, "GET", `/ai/conversations?workspaceId=${s.workspaceId}`);
    expect(list.conversations.map((c) => [c.id, c.title, c.turnCount])).toEqual(
      [
        ["conv-aaaa-1", "Renamed", 1],
        ["conv-bbbb-2", "Second", 0],
      ],
    );

    // Someone else's id reads as missing, for reading and overwriting.
    const peek = await s.as(s.ada)(
      "GET",
      `/ai/conversations/conv-aaaa-1?workspaceId=${s.workspaceId}`,
    );
    expect(peek.status).toBe(404);
    const steal = await s.as(s.ada)("PUT", "/ai/conversations/conv-aaaa-1", {
      workspaceId: s.workspaceId,
      title: "Mine now",
      turns: [],
    });
    expect(steal.status).toBe(404);

    const tooMany = await s.as(s.mia)("PUT", "/ai/conversations/conv-cccc-3", {
      workspaceId: s.workspaceId,
      title: "Long",
      turns: Array.from({ length: 101 }, () => turns[0]),
    });
    expect(tooMany.status).toBe(400);

    const removed = await s.as(s.mia)(
      "DELETE",
      `/ai/conversations/conv-bbbb-2?workspaceId=${s.workspaceId}`,
    );
    expect(removed.status).toBe(200);

    await s.ok(s.ada, "PATCH", "/ai/settings", {
      workspaceId: s.workspaceId,
      storeConversations: false,
    });
    const hidden = await s.as(s.mia)(
      "GET",
      `/ai/conversations/conv-aaaa-1?workspaceId=${s.workspaceId}`,
    );
    expect(hidden.status).toBe(403);
  });
});

describe("AI settings and availability", () => {
  it("adds web search, history and autopilot switches, features and the model", async () => {
    const s = await aiScene();
    const before = await s.ok<{
      features: Record<string, boolean>;
      model: string | null;
    }>(s.mia, "GET", `/ai/availability?workspaceId=${s.workspaceId}`);
    expect(before.model).toBe("fake-balanced");
    expect(before.features).toEqual({
      webSearch: false,
      storeConversations: false,
      autopilot: false,
      speech: false,
      showReasoning: false,
    });

    const memberPatch = await s.as(s.mia)("PATCH", "/ai/settings", {
      workspaceId: s.workspaceId,
      allowAutopilot: true,
    });
    expect(memberPatch.status).toBe(403);
    const settings = await s.ok<{
      workspace: Record<string, unknown>;
      instance: Record<string, unknown>;
    }>(s.ada, "PATCH", "/ai/settings", {
      workspaceId: s.workspaceId,
      webSearchEnabled: true,
      storeConversations: true,
      allowAutopilot: true,
    });
    expect(settings.workspace).toMatchObject({
      webSearchEnabled: true,
      storeConversations: true,
      allowAutopilot: true,
    });
    expect(settings.instance.webSearchAvailable).toBe(false);

    process.env.MARGAYA_AI_WEB_SEARCH_PROVIDER = "tavily";
    process.env.MARGAYA_AI_WEB_SEARCH_API_KEY = "tvly-key";
    process.env.MARGAYA_AI_SPEECH_BASE_URL = "http://127.0.0.1:9000/v1";
    process.env.MARGAYA_AI_SPEECH_MODEL = "whisper-1";
    const after = await s.ok<{ features: Record<string, boolean> }>(
      s.mia,
      "GET",
      `/ai/availability?workspaceId=${s.workspaceId}`,
    );
    expect(after.features).toEqual({
      webSearch: true,
      storeConversations: true,
      autopilot: true,
      speech: true,
      showReasoning: false,
    });
  });
});

describe("Speech to text", () => {
  async function transcribe(s: Scene, user: User, form: FormData) {
    mockAuthenticatedSession(user);
    return s.app.request(
      `/api/ai/speech/transcribe?workspaceId=${s.workspaceId}`,
      { method: "POST", body: form },
    );
  }

  function recording() {
    const form = new FormData();
    form.set(
      "audio",
      new File([new Uint8Array([1, 2, 3, 4])], "clip.webm", {
        type: "audio/webm",
      }),
    );
    return form;
  }

  it("is 409 AI_NOT_CONFIGURED without an endpoint", async () => {
    const s = await aiScene();
    const response = await transcribe(s, s.mia, recording());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "AI_NOT_CONFIGURED" });
  });

  it("transcribes through the endpoint and records usage as speech", async () => {
    process.env.MARGAYA_AI_SPEECH_BASE_URL = "http://127.0.0.1:9000/v1";
    process.env.MARGAYA_AI_SPEECH_MODEL = "whisper-1";
    const s = await aiScene();
    let sent: { url: string; model: unknown } | null = null;
    setSpeechFetch(async (input, init) => {
      const body = init?.body as FormData;
      sent = { url: String(input), model: body.get("model") };
      return new Response(JSON.stringify({ text: " Hello team " }), {
        headers: { "content-type": "application/json" },
      });
    });
    const response = await transcribe(s, s.mia, recording());
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ text: "Hello team" });
    expect(sent).toEqual({
      url: "http://127.0.0.1:9000/v1/audio/transcriptions",
      model: "whisper-1",
    });
    const rows = await db
      .select()
      .from(aiUsageTable)
      .where(eq(aiUsageTable.feature, "speech"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("ok");

    const viewer = await transcribe(s, s.vic, recording());
    expect(viewer.status).toBe(403);
    const wrong = new FormData();
    wrong.set("audio", new File(["x"], "a.txt", { type: "text/plain" }));
    expect((await transcribe(s, s.mia, wrong)).status).toBe(400);
  });

  it("tests the speech endpoint with a second of silence", async () => {
    const speechAt = (baseUrl: string) => ({
      ...getAiInstanceConfig(),
      speech: {
        format: "openai" as const,
        baseUrl,
        model: "whisper-1",
        apiKey: "",
      },
    });
    let sent: { url: string; type: string } | null = null;
    setSpeechFetch(async (input, init) => {
      const file = (init?.body as FormData | undefined)?.get("file") as File;
      sent = { url: String(input), type: file.type };
      return new Response(JSON.stringify({ text: "" }), {
        headers: { "content-type": "application/json" },
      });
    });
    const ok = await testSpeechEndpoint(speechAt("http://127.0.0.1:9000/v1"));
    expect(ok).toMatchObject({
      ok: true,
      destination: "local",
      model: "whisper-1",
    });
    expect(sent).toEqual({
      url: "http://127.0.0.1:9000/v1/audio/transcriptions",
      type: "audio/wav",
    });

    // A non-OpenAI endpoint answers 404: the message names the URL called.
    setSpeechFetch(async () => new Response("no", { status: 404 }));
    const missing = await testSpeechEndpoint(
      speechAt("http://127.0.0.1:9000/v1/asr"),
    );
    expect(missing).toMatchObject({ ok: false, code: "AI_NOT_CONFIGURED" });
    expect(missing.message).toContain(
      "http://127.0.0.1:9000/v1/asr/audio/transcriptions",
    );

    const unset = await testSpeechEndpoint(speechAt(""));
    expect(unset).toMatchObject({ ok: false, code: "AI_NOT_CONFIGURED" });
  });

  it("speaks Fish Audio's format: the URL as given, the file as audio, no model", async () => {
    let sent: { url: string; fields: string[]; auth: string | null } | null =
      null;
    setSpeechFetch(async (input, init) => {
      const form = init?.body as FormData | undefined;
      sent = {
        url: String(input),
        fields: [...(form?.keys() ?? [])].sort(),
        auth: new Headers(init?.headers).get("authorization"),
      };
      return new Response(JSON.stringify({ text: "Hello", duration: 1 }), {
        headers: { "content-type": "application/json" },
      });
    });
    const fish = {
      ...getAiInstanceConfig(),
      speech: {
        format: "fish" as const,
        baseUrl: "https://api.fish.audio/v1/asr",
        model: "",
        apiKey: "fish-key",
      },
    };
    const result = await testSpeechEndpoint(fish);
    expect(result).toMatchObject({ ok: true, destination: "cloud" });
    expect(sent).toEqual({
      url: "https://api.fish.audio/v1/asr",
      fields: ["audio", "ignore_timestamps"],
      auth: "Bearer fish-key",
    });

    // The model goes in Fish Audio's "model" header.
    let model: string | null = null;
    setSpeechFetch(async (_input, init) => {
      model = new Headers(init?.headers).get("model");
      return new Response(JSON.stringify({ text: "" }), {
        headers: { "content-type": "application/json" },
      });
    });
    await testSpeechEndpoint({
      ...fish,
      speech: { ...fish.speech, model: "transcribe-1-pro" },
    });
    expect(model).toBe("transcribe-1-pro");

    // No credit: Fish Audio answers 402 with its reason, shown to the admin.
    setSpeechFetch(
      async () =>
        new Response(
          JSON.stringify({ status: 402, message: "Insufficient API credit" }),
          { status: 402, headers: { "content-type": "application/json" } },
        ),
    );
    const broke = await testSpeechEndpoint(fish);
    expect(broke).toMatchObject({ ok: false, code: "AI_NOT_CONFIGURED" });
    expect(broke.message).toContain("no credit left (402)");
    expect(broke.message).toContain("Insufficient API credit");
  });

  it("lets a cloud speech service and a local model go together; Local only stops it", async () => {
    const at = (baseUrl: string, localOnly: boolean) => ({
      ...getAiInstanceConfig(),
      localOnly,
      // Private data goes to the local model: speech is a separate choice.
      route: { ...getAiInstanceConfig().route, private: "local" as const },
      speech: { format: "openai" as const, baseUrl, model: "m", apiKey: "" },
    });
    const cloud = "https://203.0.113.5/v1";
    expect(
      await speechDestinationAllowed(at(cloud, false), { localOnly: false }),
    ).toEqual({ ok: true, local: false });
    expect(
      (await speechDestinationAllowed(at(cloud, true), { localOnly: false }))
        .ok,
    ).toBe(false);
    expect(
      (await speechDestinationAllowed(at(cloud, false), { localOnly: true }))
        .ok,
    ).toBe(false);
    // An endpoint on your own network is always fine.
    expect(
      (
        await speechDestinationAllowed(at("http://10.0.0.5:8000/v1", true), {
          localOnly: true,
        })
      ).ok,
    ).toBe(true);
  });
});
