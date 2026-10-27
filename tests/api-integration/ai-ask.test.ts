import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAiGatewayState } from "../../apps/api/src/ai/gateway";
import { setFakeResponder } from "../../apps/api/src/ai/provider/fake";
import type { ChatRequest } from "../../apps/api/src/ai/types";
import { saveWorkspaceAiSettings } from "../../apps/api/src/ai/workspace-settings";
import db, { schema } from "../../apps/api/src/database";
import {
  aiUsageTable,
  projectMemberTable,
} from "../../apps/api/src/database/schema";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { addPerson } from "./helpers/assignees";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";

// Ask: cited answers over what the caller may see (fake provider, no keys).

type Scene = Awaited<ReturnType<typeof draftScene>>;
type User = Scene["mia"];

type AskSource = {
  ref: string;
  kind: string;
  id: string;
  title: string;
  url: string;
  projectId: string | null;
};

type AskJson = {
  text: string;
  sources: AskSource[];
  citations: string[];
  noResults: boolean;
  asOf: string;
};

const AI_ENV = ["MARGAYA_AI_ENABLED", "MARGAYA_AI_PROVIDER"] as const;

let requests: ChatRequest[] = [];
let answer: string | null = null;
let answerStop: "max_tokens" | null = null;
let planner: Record<string, unknown> | null = null;

beforeEach(async () => {
  await resetTestDatabase();
  resetRateLimitMemory();
  resetAiGatewayState();
  requests = [];
  answer = null;
  answerStop = null;
  planner = null;
  setFakeResponder((request) => {
    requests.push(request);
    // The planner keeps the fake's default (a minimal plan) unless a test
    // sets one.
    if (request.jsonSchema) {
      return planner ? { text: JSON.stringify(planner) } : null;
    }
    if (answer === null) return null;
    return answerStop ? { text: answer, stop: answerStop } : { text: answer };
  });
});

afterEach(() => {
  for (const name of AI_ENV) delete process.env[name];
  setFakeResponder(null);
});

function enableInstanceAi() {
  process.env.MARGAYA_AI_ENABLED = "true";
  process.env.MARGAYA_AI_PROVIDER = "fake";
}

async function aiScene() {
  enableInstanceAi();
  const s = await draftScene();
  await saveWorkspaceAiSettings(s.workspaceId, { enabled: true }, s.owner.id);
  await db
    .update(schema.projectTable)
    .set({ name: "Website" })
    .where(eq(schema.projectTable.id, s.web.project.id));
  await db
    .update(schema.projectTable)
    .set({ name: "Backend" })
    .where(eq(schema.projectTable.id, s.api.project.id));
  return s;
}

let nextNumber = 100;

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

async function restrict(projectId: string, members: string[]) {
  await db
    .update(schema.projectTable)
    .set({ visibility: "restricted" })
    .where(eq(schema.projectTable.id, projectId));
  for (const userId of members) {
    await db
      .insert(projectMemberTable)
      .values({ projectId, userId, role: "member" });
  }
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 86_400_000);
}

/** Asks with the JSON fallback (one body). */
async function ask(
  s: Scene,
  user: User,
  body: Record<string, unknown>,
): Promise<AskJson> {
  const response = await s.as(user)("POST", "/ai/ask?stream=false", {
    workspaceId: s.workspaceId,
    ...body,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as AskJson;
}

function sentText(): string {
  return requests.map((request) => JSON.stringify(request)).join("\n");
}

function answerCalls() {
  return requests.filter((request) => !request.jsonSchema);
}

function parseSse(text: string) {
  return text
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const event = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim();
      const data = /^data:\s*(.+)$/m.exec(block)?.[1];
      return event && data
        ? { event, data: JSON.parse(data) as Record<string, unknown> }
        : null;
    })
    .filter((event): event is NonNullable<typeof event> => event !== null);
}

describe("Ask access", () => {
  it("answers 403 AI_DISABLED while AI is off for the instance or the workspace", async () => {
    const s = await draftScene();
    const body = { workspaceId: s.workspaceId, question: "anything?" };
    const off = await s.as(s.mia)("POST", "/ai/ask", body);
    expect(off.status).toBe(403);
    expect(await off.json()).toMatchObject({ code: "AI_DISABLED" });

    enableInstanceAi();
    const workspaceOff = await s.as(s.mia)("POST", "/ai/ask", body);
    expect(workspaceOff.status).toBe(403);
    expect(await workspaceOff.json()).toMatchObject({ code: "AI_DISABLED" });
    expect(requests).toHaveLength(0);
  });

  it("refuses viewers (no ai:use) and outsiders", async () => {
    const s = await aiScene();
    await insertTask(s.web.project.id, "Zebracorn rollout");
    const viewer = await s.as(s.vic)("POST", "/ai/ask", {
      workspaceId: s.workspaceId,
      question: "zebracorn",
    });
    expect(viewer.status).toBe(403);
    const outsider = await s.as(s.outsider)("POST", "/ai/ask", {
      workspaceId: s.workspaceId,
      question: "zebracorn",
    });
    expect(outsider.status).toBe(403);
    expect(requests).toHaveLength(0);
  });

  it("answers 403 AI_DISABLED inside a project with AI off, 404 for one it can't see", async () => {
    const s = await aiScene();
    await db
      .update(schema.projectTable)
      .set({ aiEnabled: false })
      .where(eq(schema.projectTable.id, s.api.project.id));
    const off = await s.as(s.mia)("POST", "/ai/ask", {
      workspaceId: s.workspaceId,
      question: "anything",
      projectId: s.api.project.id,
    });
    expect(off.status).toBe(403);
    expect(await off.json()).toMatchObject({ code: "AI_DISABLED" });

    const elsewhere = await s.as(s.mia)("POST", "/ai/ask", {
      workspaceId: s.workspaceId,
      question: "anything",
      projectId: "no-such-project",
    });
    expect(elsewhere.status).toBe(404);
  });
});

describe("Ask keeps restricted projects out", () => {
  it("never puts a restricted project into the context or the citations", async () => {
    const s = await aiScene();
    await restrict(s.api.project.id, [s.mia.id]);
    const secret = await insertTask(
      s.api.project.id,
      "Zebracorn secret launch",
      {
        description: "Classified zebracorn budget",
      },
    );
    await insertComment(secret.id, s.owner.id, "zebracorn hidden comment");
    await insertPage(
      s,
      s.api.project.id,
      "Zebracorn vault",
      "zebracorn vault notes",
    );
    const open = await insertTask(s.web.project.id, "Zebracorn rollout");
    const openKey = `WEB-${open.number}`;
    const secretKey = `API-${secret.number}`;
    answer = `Rollout is planned [T:${openKey}]; also [T:${secretKey}] and [P:Zebracorn vault].`;

    // Mia is a member of the restricted project (excluded: the workspace
    // did not opt in); Owen sees every project.
    for (const user of [s.mia, s.owner]) {
      requests = [];
      const result = await ask(s, user, { question: `zebracorn ${secretKey}` });
      expect(result.sources.map((source) => source.ref)).toEqual([
        `T:${openKey}`,
      ]);
      expect(result.citations).toEqual([`T:${openKey}`]);
      const sent = sentText();
      expect(sent).toContain("Zebracorn rollout");
      expect(sent).not.toContain("secret launch");
      expect(sent).not.toContain("Classified");
      expect(sent).not.toContain("hidden comment");
      expect(sent).not.toContain("vault notes");
    }
  });

  it("keeps a hidden restricted project out even when the workspace includes restricted ones", async () => {
    const s = await aiScene();
    await restrict(s.api.project.id, []);
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { includeRestricted: true },
      s.owner.id,
    );
    await insertTask(s.api.project.id, "Zebracorn secret launch");
    await insertTask(s.web.project.id, "Zebracorn rollout");
    const result = await ask(s, s.mia, { question: "zebracorn" });
    expect(
      result.sources.every((source) => source.projectId === s.web.project.id),
    ).toBe(true);
    expect(sentText()).not.toContain("secret launch");
  });
});

describe("Ask cites what the caller can see", () => {
  it("maps citations to visible tasks, pages and comments and drops invented ones", async () => {
    const s = await aiScene();
    const task = await insertTask(s.web.project.id, "Login timeout on mobile", {
      description: "Sessions expire after 5 minutes",
    });
    const comment = await insertComment(
      task.id,
      s.ada.id,
      "We dropped SSO from v2 because of the login timeout work",
    );
    const page = await insertPage(
      s,
      s.web.project.id,
      "Release plan",
      "SSO moves to v3 after the login timeout fix",
    );
    const key = `WEB-${task.number}`;
    const commentRef = `C:${key}/${comment.id.slice(0, 6)}`;
    answer = `SSO was dropped [${commentRef}] and moves to v3 [P:Release plan], see [T:${key}]. Not real: [T:NOPE-1] [P:Secret plan] [C:WEB-1/zzzzzz].`;

    const result = await ask(s, s.mia, {
      question: "Why did we drop SSO from v2?",
    });
    const refs = result.sources.map((source) => source.ref);
    expect(refs, JSON.stringify(refs)).toEqual(
      expect.arrayContaining([`T:${key}`, "P:Release plan", commentRef]),
    );
    expect(result.citations).toEqual([
      commentRef,
      "P:Release plan",
      `T:${key}`,
    ]);
    for (const ref of result.citations) {
      const source = result.sources.find((item) => item.ref === ref);
      expect(source?.projectId).toBe(s.web.project.id);
    }
    const bySource = Object.fromEntries(
      result.sources.map((source) => [source.ref, source]),
    );
    expect(bySource[`T:${key}`]?.url).toBe(
      `/dashboard/workspace/${s.workspaceId}/project/${s.web.project.id}/task/${task.id}`,
    );
    expect(bySource["P:Release plan"]?.url).toBe(
      `/dashboard/workspace/${s.workspaceId}/project/${s.web.project.id}/pages/${page.id}`,
    );
    expect(bySource[commentRef]).toMatchObject({
      kind: "comment",
      id: comment.id,
    });

    // Every cited task opens for the caller.
    const opened = await s.as(s.mia)("GET", `/task/${task.id}`);
    expect(opened.status).toBe(200);

    // Context goes in <untrusted> blocks with the citation token as source,
    // and the answer is asked for in the caller's language.
    const call = answerCalls()[0];
    expect(JSON.stringify(call?.messages)).toContain(
      `<untrusted source=\\"T:${key}\\"`,
    );
    const german = await ask(s, s.mia, {
      question: "Why did we drop SSO?",
      locale: "de-DE",
    });
    expect(german.noResults).toBe(false);
    expect(answerCalls().at(-1)?.system.join("\n")).toContain(
      "Answer in German",
    );
  });

  it("streams meta with sources, deltas and done with citations", async () => {
    const s = await aiScene();
    const task = await insertTask(s.web.project.id, "Payment retries");
    const key = `WEB-${task.number}`;
    answer = `Retries ship next week [T:${key}].`;
    const response = await s.as(s.mia)("POST", "/ai/ask", {
      workspaceId: s.workspaceId,
      question: "payment retries",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSse(await response.text());
    expect(events[0]?.event).toBe("meta");
    expect(events[0]?.data.sources).toEqual([
      expect.objectContaining({ ref: `T:${key}`, kind: "task", id: task.id }),
    ]);
    const text = events
      .filter((event) => event.event === "delta")
      .map((event) => event.data.text)
      .join("");
    expect(text).toBe(answer);
    expect(events.at(-1)).toMatchObject({
      event: "done",
      data: { citations: [`T:${key}`], noResults: false },
    });
  });

  it("says nothing was found without calling the answer model", async () => {
    const s = await aiScene();
    await insertTask(s.web.project.id, "Payment retries");
    const response = await s.as(s.mia)("POST", "/ai/ask", {
      workspaceId: s.workspaceId,
      question: "quantum flux capacitor",
    });
    const events = parseSse(await response.text());
    expect(events.map((event) => event.event)).toEqual(["meta", "done"]);
    expect(events[1]?.data).toMatchObject({ noResults: true, citations: [] });
    expect(answerCalls()).toHaveLength(0);
    const usage = await db
      .select()
      .from(aiUsageTable)
      .where(eq(aiUsageTable.workspaceId, s.workspaceId));
    expect(usage.map((row) => [row.feature, row.tier])).toEqual([
      ["ask", "fast"],
    ]);
  });

  it("answers only from the project Ask was opened in", async () => {
    const s = await aiScene();
    await insertTask(s.web.project.id, "Zebracorn rollout");
    const backend = await insertTask(s.api.project.id, "Zebracorn backend");
    const result = await ask(s, s.mia, {
      question: "zebracorn",
      projectId: s.api.project.id,
    });
    expect(result.sources.map((source) => source.id)).toEqual([backend.id]);
    expect(sentText()).not.toContain("Zebracorn rollout");
  });
});

describe("Ask uses the structured task query", () => {
  it("finds overdue work in a named project", async () => {
    const s = await aiScene();
    const late = await insertTask(s.web.project.id, "Fix header", {
      dueDate: daysFromNow(-3),
    });
    await insertTask(s.web.project.id, "Future footer", {
      dueDate: daysFromNow(5),
    });
    await insertTask(s.web.project.id, "Finished banner", {
      dueDate: daysFromNow(-3),
      status: "done",
    });
    await insertTask(s.api.project.id, "Backend late", {
      dueDate: daysFromNow(-2),
    });
    const result = await ask(s, s.mia, {
      question: "What's overdue in Website?",
    });
    expect(result.sources.map((source) => source.id)).toEqual([late.id]);
    expect(sentText()).toContain("(overdue)");
  });

  it("lists the caller's open tasks", async () => {
    const s = await aiScene();
    const mine = await insertTask(s.web.project.id, "Write docs");
    const theirs = await insertTask(s.web.project.id, "Review docs");
    const done = await insertTask(s.api.project.id, "Old docs", {
      status: "done",
    });
    await db.insert(schema.taskAssigneeTable).values([
      { taskId: mine.id, userId: s.mia.id },
      { taskId: theirs.id, userId: s.ada.id },
      { taskId: done.id, userId: s.mia.id },
    ]);
    const result = await ask(s, s.mia, { question: "my open tasks" });
    expect(result.sources.map((source) => source.id)).toEqual([mine.id]);
  });

  it("adds the cycle's computed forecast and risks, never as a citation", async () => {
    const s = await aiScene();
    const cycle = await s.insertCycle({ name: "Cycle 12" });
    const task = await insertTask(s.web.project.id, "Checkout page");
    await db
      .insert(schema.cycleTaskTable)
      .values({ taskId: task.id, cycleId: cycle.id });
    const result = await ask(s, s.mia, { question: "Is cycle 12 at risk?" });
    const sent = sentText();
    expect(sent).toContain('source=\\"facts:cycle Cycle 12\\"');
    expect(sent).toContain("Open tasks remaining: 1.");
    expect(result.sources.map((source) => source.id)).toEqual([task.id]);
  });

  it("names what blocks a cycle's work, blocked tasks first", async () => {
    const s = await aiScene();
    const cycle = await s.insertCycle({ name: "Cycle 12" });
    const blocked = await insertTask(s.web.project.id, "Checkout page");
    const free = await insertTask(s.web.project.id, "Cart icon");
    const blocker = await insertTask(s.web.project.id, "Payment API", {
      status: "in-progress",
    });
    await db.insert(schema.cycleTaskTable).values([
      { taskId: blocked.id, cycleId: cycle.id },
      { taskId: free.id, cycleId: cycle.id },
    ]);
    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: blocker.id,
      targetTaskId: blocked.id,
      relationType: "blocks",
    });
    const result = await ask(s, s.mia, {
      question: "What's blocking cycle 12?",
    });
    const ids = result.sources.map((source) => source.id);
    expect(ids.slice(0, 2)).toEqual([blocked.id, blocker.id]);
    expect(ids).toContain(free.id);
    expect(sentText()).toContain(
      `Blocked by (open): WEB-${blocker.number} Payment API`,
    );
  });
});

describe("Ask counts what the caller can see", () => {
  it("adds live counts for a counting question, leaving out archived and trashed tasks", async () => {
    const s = await aiScene();
    const web = s.web.project.id;
    const late = await insertTask(web, "Write docs", {
      priority: "high",
      dueDate: daysFromNow(-2),
    });
    await insertTask(web, "Review docs", {
      status: "in-progress",
      dueDate: daysFromNow(2),
    });
    await insertTask(web, "Old docs", { status: "done" });
    await insertTask(web, "Archived docs", { archivedAt: new Date() });
    await insertTask(web, "Trashed docs", { deletedAt: new Date() });
    await insertTask(s.api.project.id, "Backend docs");
    await db
      .insert(schema.taskAssigneeTable)
      .values({ taskId: late.id, userId: s.mia.id });
    await db.insert(schema.labelTable).values({
      name: "bug",
      color: "#ff0000",
      taskId: late.id,
      workspaceId: s.workspaceId,
    });
    answer = "There are 3 tasks.";
    const result = await ask(s, s.mia, {
      question: "How many tasks are in each status?",
      projectId: web,
    });
    expect(result.noResults).toBe(false);
    expect(result.text).toBe(answer);
    // The counts are context, never a source.
    expect(result.sources).toEqual([]);
    const sent = JSON.stringify(answerCalls()[0]?.messages);
    expect(sent).toContain('source=\\"facts:counts Website\\"');
    expect(sent).toContain(
      "Tasks: 3 total, 2 open, 1 closed (1 completed, 0 cancelled).",
    );
    expect(sent).toContain(
      "Overdue (open, due before today): 1. Due in the next 7 days (open): 1.",
    );
    expect(sent).toContain("- Mia: 1");
    expect(sent).toContain("- Unassigned: 2 (1 open)");
    expect(sent).toContain("- bug: 1");
    expect(sent).not.toContain("Archived docs");
    expect(sent).toContain("By cycle:");
    expect(answerCalls()[0]?.system.join("\n")).toContain(
      "fenced code block with the language chart",
    );
  });

  it("ends an answer cut off before any text with an error", async () => {
    const s = await aiScene();
    await insertTask(s.web.project.id, "Payment retries");
    answer = "";
    answerStop = "max_tokens";
    const response = await s.as(s.mia)("POST", "/ai/ask", {
      workspaceId: s.workspaceId,
      question: "payment retries",
    });
    const events = parseSse(await response.text());
    expect(events.at(-1)).toMatchObject({
      event: "error",
      data: { code: "AI_PROVIDER_ERROR" },
    });
    expect(events.some((event) => event.event === "done")).toBe(false);
  });
});

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function assign(taskId: string, userId: string) {
  await db.insert(schema.taskAssigneeTable).values({ taskId, userId });
}

describe("Ask reads finished work", () => {
  it("lists finished work, most recently finished first", async () => {
    const s = await aiScene();
    const web = s.web.project.id;
    const yesterday = daysFromNow(-1);
    const recent = await insertTask(web, "Ship login", {
      status: "done",
      completedAt: yesterday,
    });
    const older = await insertTask(web, "Ship signup", {
      status: "done",
      completedAt: daysFromNow(-20),
    });
    await insertTask(web, "Write docs");
    const result = await ask(s, s.mia, {
      question: "What did we finish this week?",
    });
    expect(result.noResults).toBe(false);
    expect(result.sources.map((source) => source.id)).toEqual([
      recent.id,
      older.id,
    ]);
    const sent = sentText();
    expect(sent).toContain("(completed)");
    expect(sent).toContain(`Completed: ${isoDay(yesterday)}`);
    expect(sent).not.toContain("Write docs");
  });

  it("answers whether a named task is done from its own status", async () => {
    const s = await aiScene();
    const done = await insertTask(s.web.project.id, "Ship login", {
      status: "done",
      completedAt: daysFromNow(-1),
    });
    await insertTask(s.web.project.id, "Ship signup", { status: "done" });
    const result = await ask(s, s.mia, {
      question: `Is WEB-${done.number} done?`,
    });
    expect(result.sources.map((source) => source.id)).toEqual([done.id]);
    expect(sentText()).toContain("(completed)");
  });

  it("counts finished work, including the last seven days", async () => {
    const s = await aiScene();
    const web = s.web.project.id;
    await insertTask(web, "Ship login", {
      status: "done",
      completedAt: daysFromNow(-1),
    });
    await insertTask(web, "Ship signup", {
      status: "done",
      completedAt: daysFromNow(-20),
    });
    await insertTask(web, "Write docs");
    await ask(s, s.mia, { question: "How many are done?", projectId: web });
    const sent = sentText();
    expect(sent).toContain('source=\\"facts:counts Website\\"');
    expect(sent).toContain("2 closed (2 completed, 0 cancelled)");
    expect(sent).toContain(
      "Completed in the last 7 days (today and the 6 days before): 1.",
    );
  });

  it("lists my tasks as done when none of them is open", async () => {
    const s = await aiScene();
    const done = await insertTask(s.web.project.id, "Old docs", {
      status: "done",
    });
    const theirs = await insertTask(s.web.project.id, "Review docs");
    await assign(done.id, s.mia.id);
    await assign(theirs.id, s.ada.id);
    const result = await ask(s, s.mia, {
      question: "What's assigned to me?",
    });
    expect(result.noResults).toBe(false);
    expect(result.sources.map((source) => source.id)).toEqual([done.id]);
    expect(sentText()).toContain("(completed)");
    // Asked for open work, an empty answer stays empty.
    const open = await ask(s, s.mia, { question: "my open tasks" });
    expect(open.noResults).toBe(true);
  });
});

describe("Ask finds people's work by name", () => {
  it("filters by a workspace member's first name, open work first", async () => {
    const s = await aiScene();
    const web = s.web.project.id;
    const miaOpen = await insertTask(web, "Checkout copy");
    const miaDone = await insertTask(web, "Cart copy", { status: "done" });
    const adaOpen = await insertTask(web, "Payment API");
    await assign(miaOpen.id, s.mia.id);
    await assign(miaDone.id, s.mia.id);
    await assign(adaOpen.id, s.ada.id);

    for (const question of [
      "What's on Mia's plate?",
      "what is mia working on",
    ]) {
      const result = await ask(s, s.owner, { question });
      expect(
        result.sources.map((source) => source.id),
        question,
      ).toEqual([miaOpen.id]);
    }
    const ada = await ask(s, s.owner, { question: "tasks of Ada" });
    expect(ada.sources.map((source) => source.id)).toEqual([adaOpen.id]);
  });

  it("matches agents by full name and never people outside the workspace", async () => {
    const s = await aiScene();
    const web = s.web.project.id;
    const bot = await addPerson(s.workspaceId, "Triage Bot");
    await db
      .update(schema.userTable)
      .set({ kind: "agent" })
      .where(eq(schema.userTable.id, bot.id));
    const botTask = await insertTask(web, "Sort the inbox");
    await assign(botTask.id, bot.id);
    const result = await ask(s, s.mia, {
      question: "What is Triage Bot doing?",
    });
    expect(result.sources.map((source) => source.id)).toEqual([botTask.id]);

    // Oz is in another workspace: the name filters nothing here.
    const outside = await ask(s, s.mia, { question: "tasks of Oz" });
    expect(outside.noResults).toBe(true);
  });
});

describe("Ask prefers live task data over pages", () => {
  it("puts tasks before pages and dates every page", async () => {
    const s = await aiScene();
    const late = await insertTask(s.web.project.id, "Zebracorn header", {
      dueDate: daysFromNow(-2),
    });
    await insertPage(
      s,
      s.web.project.id,
      "Zebracorn status table",
      "zebracorn zebracorn WEB-10 is open and late",
    );
    const result = await ask(s, s.mia, {
      question: "What's overdue with zebracorn?",
    });
    const refs = result.sources.map((source) => source.ref);
    expect(refs[0]).toBe(`T:WEB-${late.number}`);
    expect(refs.at(-1)).toBe("P:Zebracorn status table");
    const sent = sentText();
    expect(sent).toContain(
      `Page: Zebracorn status table\\nLast updated: ${isoDay(new Date())}`,
    );
    expect(answerCalls()[0]?.system.join("\n")).toContain(
      "Pages are notes written at some point",
    );
  });
});

describe("Ask follow-ups", () => {
  it("resolves 'its' to the task the previous answer cited", async () => {
    const s = await aiScene();
    const task = await insertTask(s.web.project.id, "Payment retries", {
      description: "Retry failed card payments three times",
    });
    await insertTask(s.web.project.id, "Payment page");
    const key = `WEB-${task.number}`;
    answer = `It retries failed card payments [T:${key}].`;
    const result = await ask(s, s.mia, {
      question: "And what is its description?",
      history: [
        {
          question: "What is the payment retries task?",
          answer: `Retries ship next week [T:${key}].`,
        },
      ],
    });
    expect(result.sources[0]?.id).toBe(task.id);
    expect(result.citations).toEqual([`T:${key}`]);
    expect(sentText()).toContain("Retry failed card payments three times");
    const plannerCall = requests.find((request) => request.jsonSchema);
    expect(JSON.stringify(plannerCall?.messages)).toContain(
      `Earlier answer: Retries ship next week [T:${key}].`,
    );
  });
});

describe("Ask counts in every language", () => {
  it("adds live counts for counting questions in other languages", async () => {
    const s = await aiScene();
    const web = s.web.project.id;
    await insertTask(web, "Write docs");
    const done = await insertTask(web, "Old docs", { status: "done" });

    await ask(s, s.mia, {
      question: "¿cuántas tareas están en revisión?",
      projectId: web,
    });
    expect(sentText()).toContain('source=\\"facts:counts Website\\"');

    requests = [];
    planner = {
      searchTerms: [],
      intents: ["completed", "stats"],
      project: "",
      cycle: "",
      followUp: false,
    };
    const hindi = await ask(s, s.mia, {
      question: "कितने काम पूरे हुए?",
      projectId: web,
    });
    expect(sentText()).toContain('source=\\"facts:counts Website\\"');
    expect(hindi.sources.map((source) => source.id)).toEqual([done.id]);
  });
});

describe("Ask never answers blank", () => {
  it("answers a JSON caller with 502 when the model wrote nothing", async () => {
    const s = await aiScene();
    await insertTask(s.web.project.id, "Payment retries");
    answer = "";
    answerStop = "max_tokens";
    const response = await s.as(s.mia)("POST", "/ai/ask?stream=false", {
      workspaceId: s.workspaceId,
      question: "payment retries",
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "AI_PROVIDER_ERROR" });
  });
});
