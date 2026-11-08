import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAiGatewayState } from "../../apps/api/src/ai/gateway";
import { setFakeResponder } from "../../apps/api/src/ai/provider/fake";
import type { ChatRequest } from "../../apps/api/src/ai/types";
import db, { schema } from "../../apps/api/src/database";
import {
  aiUsageTable,
  projectMemberTable,
} from "../../apps/api/src/database/schema";
import { buildDigestWorkspaces } from "../../apps/api/src/notification-email/digest-content";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { resetTestDatabase } from "./helpers/database";
import { day, draftScene } from "./helpers/drafts";

// Planning insights (report 03, #9, #10, #15, #18): calibrated estimates,
// the cycle capacity check, facts-first retrospectives and My brief, with
// the computed parts working without AI and the narration on the fake
// provider. Permissions and restricted projects are checked throughout.

type Scene = Awaited<ReturnType<typeof draftScene>>;
type User = Scene["mia"];

const AI_ENV = ["MARGAYA_AI_ENABLED", "MARGAYA_AI_PROVIDER"] as const;
const DAY_MS = 86_400_000;

let prompts: string[] = [];

beforeEach(async () => {
  await resetTestDatabase();
  resetRateLimitMemory();
  resetAiGatewayState();
  prompts = [];
});

afterEach(() => {
  for (const name of AI_ENV) delete process.env[name];
  setFakeResponder(null);
});

function userText(request: ChatRequest): string {
  const last = request.messages.at(-1);
  if (!last) return "";
  return typeof last.content === "string"
    ? last.content
    : last.content.map((block) => ("text" in block ? block.text : "")).join("");
}

function recordPrompts(answer: string) {
  setFakeResponder((request) => {
    prompts.push(userText(request));
    return { text: answer };
  });
}

async function scene(ai = false) {
  if (ai) {
    process.env.MARGAYA_AI_ENABLED = "true";
    process.env.MARGAYA_AI_PROVIDER = "fake";
  }
  const s = await draftScene();
  if (ai) {
    await s.ok(s.owner, "PATCH", "/ai/settings", {
      workspaceId: s.workspaceId,
      enabled: true,
    });
  }
  return s;
}

let nextNumber = 500;

async function insertTask(
  projectId: string,
  title: string,
  extra: Partial<typeof schema.taskTable.$inferInsert> = {},
) {
  nextNumber += 1;
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId, title, status: "to-do", number: nextNumber, ...extra })
    .returning();
  if (!task) throw new Error("Failed to insert task");
  return task;
}

/** A task started `startedDaysAgo` and finished `days` later. */
async function doneTask(
  projectId: string,
  title: string,
  options: {
    startedDaysAgo: number;
    days: number;
    pointId?: string | null;
    assignee?: User;
  },
) {
  const now = Date.now();
  const started = new Date(now - options.startedDaysAgo * DAY_MS);
  const completed = new Date(started.getTime() + options.days * DAY_MS);
  const task = await insertTask(projectId, title, {
    status: "done",
    completedAt: completed,
    createdAt: new Date(started.getTime() - DAY_MS),
    estimatePointId: options.pointId ?? null,
  });
  await db.insert(schema.activityTable).values([
    {
      taskId: task.id,
      type: "status_changed",
      createdAt: started,
      eventData: { oldStatus: "to-do", newStatus: "in-progress" },
    },
    {
      taskId: task.id,
      type: "status_changed",
      createdAt: completed,
      eventData: { oldStatus: "in-progress", newStatus: "done" },
    },
  ]);
  if (options.assignee) await assign(task.id, options.assignee);
  return task;
}

async function assign(taskId: string, user: User) {
  await db.insert(schema.taskAssigneeTable).values({ taskId, userId: user.id });
  await db
    .update(schema.taskTable)
    .set({ userId: user.id })
    .where(eq(schema.taskTable.id, taskId));
}

async function addToCycle(cycleId: string, taskId: string, addedAt?: Date) {
  await db
    .insert(schema.cycleTaskTable)
    .values({ cycleId, taskId, ...(addedAt ? { addedAt } : {}) });
}

async function restrict(projectId: string, members: User[]) {
  await db
    .update(schema.projectTable)
    .set({ visibility: "restricted" })
    .where(eq(schema.projectTable.id, projectId));
  for (const user of members) {
    await db
      .insert(projectMemberTable)
      .values({ projectId, userId: user.id, role: "member" });
  }
}

async function usage(workspaceId: string, feature: string) {
  return db
    .select()
    .from(aiUsageTable)
    .where(
      and(
        eq(aiUsageTable.workspaceId, workspaceId),
        eq(aiUsageTable.feature, feature),
      ),
    );
}

const key = (number: number | null) => `WEB-${number}`;

describe("Calibrated estimates", () => {
  async function history(s: Scene) {
    const { points } = await s.insertEstimate();
    const [one, , three] = points;
    if (!one || !three) throw new Error("points");
    const web = s.web.project.id;
    const tasks = [
      await doneTask(web, "Login page timeout", {
        startedDaysAgo: 20,
        days: 4,
        pointId: three.id,
      }),
      await doneTask(web, "Login form validation", {
        startedDaysAgo: 18,
        days: 5,
        pointId: three.id,
      }),
      await doneTask(web, "Login redirect loop", {
        startedDaysAgo: 15,
        days: 3,
        pointId: three.id,
      }),
      await doneTask(web, "Dashboard chart colours", {
        startedDaysAgo: 10,
        days: 1,
        pointId: one.id,
      }),
    ];
    return { one, three, tasks };
  }

  it("suggests what similar finished tasks were usually estimated", async () => {
    const s = await scene();
    const { three, tasks } = await history(s);
    const open = await insertTask(s.web.project.id, "Login session expiry");

    const result = await s.ok<{
      status: string;
      suggestion: { pointId: string; value: string; matches: number } | null;
      cycleTime: { min: number; median: number; max: number } | null;
      similar: { key: string; value: string; cycleTimeDays: number | null }[];
    }>(
      s.mia,
      "GET",
      `/insight/estimate/project/${s.web.project.id}/suggestion?taskId=${open.id}`,
    );
    expect(result.status).toBe("ok");
    expect(result.suggestion).toMatchObject({ pointId: three.id, value: "3" });
    expect(result.cycleTime).toEqual({
      samples: 3,
      min: 3,
      median: 4,
      max: 5,
    });
    expect(result.similar.map((task) => task.key).sort()).toEqual(
      tasks
        .slice(0, 3)
        .map((task) => key(task.number))
        .sort(),
    );

    const none = await s.ok<{ status: string; suggestion: unknown }>(
      s.mia,
      "GET",
      `/insight/estimate/project/${s.web.project.id}/suggestion?title=${encodeURIComponent("Billing export")}`,
    );
    expect(none).toMatchObject({
      status: "insufficient_history",
      suggestion: null,
    });
  });

  it("shows the team's calibration, gated like analytics", async () => {
    const s = await scene();
    await history(s);
    const calibration = await s.ok<{
      status: string;
      samples: number;
      buckets: { value: string; samples: number; median: number | null }[];
    }>(
      s.mia,
      "GET",
      `/insight/estimate/project/${s.web.project.id}/calibration`,
    );
    expect(calibration.status).toBe("ok");
    expect(calibration.samples).toBe(4);
    expect(calibration.buckets).toEqual([
      expect.objectContaining({ value: "1", samples: 1, median: 1 }),
      expect.objectContaining({ value: "2", samples: 0, median: null }),
      expect.objectContaining({ value: "3", samples: 3, median: 4 }),
    ]);

    const viewer = await s.as(s.vic)(
      "GET",
      `/insight/estimate/project/${s.web.project.id}/calibration`,
    );
    expect(viewer.status).toBe(403);
  });

  it("never reaches into a restricted project the caller can't see", async () => {
    const s = await scene();
    await history(s);
    await restrict(s.web.project.id, [s.ada]);
    const response = await s.as(s.mia)(
      "GET",
      `/insight/estimate/project/${s.web.project.id}/suggestion?title=Login`,
    );
    expect(response.status).toBe(404);
  });

  it("explains a suggestion with AI only from its facts", async () => {
    const s = await scene(true);
    await history(s);
    recordPrompts("Similar tasks were usually 3 points [WEB-1].");
    const response = await s.as(s.mia)(
      "POST",
      "/ai/insight/estimate?stream=false",
      {
        workspaceId: s.workspaceId,
        projectId: s.web.project.id,
        title: "Login session expiry",
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      text: string;
      suggestion: { status: string };
      citations: { key: string }[];
    };
    expect(body.suggestion.status).toBe("ok");
    expect(body.citations.length).toBe(3);
    expect(prompts[0]).toContain("Suggested value: 3");
    expect(prompts[0]).toContain("<untrusted");
    expect(await usage(s.workspaceId, "estimate")).toHaveLength(1);

    const nothing = await s.as(s.mia)(
      "POST",
      "/ai/insight/estimate?stream=false",
      {
        workspaceId: s.workspaceId,
        projectId: s.web.project.id,
        title: "Billing export",
      },
    );
    expect(nothing.status).toBe(409);
  });
});

describe("Capacity check", () => {
  it("compares the cycle's load with past cycles and suggests deferrals", async () => {
    const s = await scene();
    const web = s.web.project.id;
    const past = [
      await s.insertCycle({
        name: "P1",
        startDate: day(-30),
        endDate: day(-21),
      }),
      await s.insertCycle({
        name: "P2",
        startDate: day(-20),
        endDate: day(-11),
      }),
    ];
    for (const [index, cycle] of past.entries()) {
      for (let n = 0; n < 2; n++) {
        const task = await doneTask(web, `Past ${index}-${n}`, {
          startedDaysAgo: index === 0 ? 28 : 18,
          days: 2,
          assignee: s.mia,
        });
        await addToCycle(cycle.id, task.id);
      }
    }
    const current = await s.insertCycle({
      name: "Now",
      startDate: day(-3),
      endDate: day(6),
    });
    const priorities = [
      "urgent",
      "high",
      "medium",
      "low",
      "no-priority",
      "low",
    ];
    const planned = [];
    for (const [index, priority] of priorities.entries()) {
      const task = await insertTask(web, `Planned ${index}`, { priority });
      await assign(task.id, s.mia);
      await addToCycle(current.id, task.id);
      planned.push(task);
    }

    const check = await s.ok<{
      basis: string;
      historyCycles: number;
      unit: string;
      capacity: { typical: number } | null;
      load: number;
      percent: number;
      status: string;
      deferrals: { id: string; priority: string }[];
      members:
        | {
            userId: string | null;
            tasks: number;
            typical: number | null;
            status: string;
          }[]
        | null;
    }>(s.mia, "GET", `/insight/capacity/cycle/${current.id}`);
    expect(check).toMatchObject({
      basis: "cycles",
      historyCycles: 2,
      unit: "tasks",
      capacity: { typical: 2 },
      load: 6,
      percent: 300,
      status: "over",
    });
    expect(check.deferrals.map((task) => task.priority)).toEqual([
      "no-priority",
      "low",
      "low",
      "medium",
    ]);
    expect(check.members).toEqual([
      expect.objectContaining({
        userId: s.mia.id,
        tasks: 6,
        typical: 2,
        status: "over",
      }),
    ]);

    const viewer = await s.as(s.vic)(
      "GET",
      `/insight/capacity/cycle/${current.id}`,
    );
    expect(viewer.status).toBe(403);
  });

  it("gives per-assignee load to whoever may read analytics, as the workload does", async () => {
    const s = await scene();
    const current = await s.insertCycle({
      name: "Now",
      startDate: day(-3),
      endDate: day(6),
    });
    const task = await insertTask(s.web.project.id, "Planned");
    await assign(task.id, s.mia);
    await addToCycle(current.id, task.id);
    // Reads analytics and cycles, updates nothing.
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: s.workspaceId,
      role: "reporter",
      permission: JSON.stringify({
        workspace: ["read"],
        project: ["read"],
        task: ["read"],
        cycle: ["read"],
        analytics: ["read"],
      }),
    });
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "reporter" })
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, s.workspaceId),
          eq(schema.workspaceUserTable.userId, s.vic.id),
        ),
      );
    const check = await s.ok<{ members: { userId: string | null }[] | null }>(
      s.vic,
      "GET",
      `/insight/capacity/cycle/${current.id}`,
    );
    expect(check.members?.map((member) => member.userId)).toEqual([s.mia.id]);
  });

  it("says unknown without history", async () => {
    const s = await scene();
    const cycle = await s.insertCycle();
    const check = await s.ok<{ status: string; basis: string }>(
      s.mia,
      "GET",
      `/insight/capacity/cycle/${cycle.id}`,
    );
    expect(check).toMatchObject({ status: "unknown", basis: "none" });
  });
});

describe("Facts-first retrospectives", () => {
  async function endedCycle(s: Scene) {
    const web = s.web.project.id;
    const cycle = await s.insertCycle({
      name: "Sprint 7",
      startDate: day(-14),
      endDate: day(-1),
    });
    const next = await s.insertCycle({
      name: "Sprint 8",
      startDate: day(0),
      endDate: day(13),
    });
    const before = new Date(Date.now() - 15 * DAY_MS);
    const during = new Date(Date.now() - 7 * DAY_MS);
    const committed = await doneTask(web, "Ship onboarding", {
      startedDaysAgo: 10,
      days: 2,
    });
    await addToCycle(cycle.id, committed.id, before);
    const added = await doneTask(web, "Hotfix signup crash", {
      startedDaysAgo: 6,
      days: 1,
    });
    await addToCycle(cycle.id, added.id, during);
    const open = await insertTask(web, "Polish settings page");
    await addToCycle(cycle.id, open.id, before);
    const carried = await insertTask(web, "Migrate billing");
    await addToCycle(next.id, carried.id);
    const removed = await insertTask(web, "Old analytics idea");
    await db.insert(schema.activityTable).values([
      {
        taskId: carried.id,
        type: "cycle_changed",
        createdAt: new Date(),
        eventData: {
          oldCycleId: cycle.id,
          oldCycleName: cycle.name,
          newCycleId: next.id,
          newCycleName: next.name,
        },
      },
      {
        taskId: removed.id,
        type: "cycle_changed",
        createdAt: during,
        eventData: {
          oldCycleId: cycle.id,
          oldCycleName: cycle.name,
          newCycleId: null,
          newCycleName: null,
        },
      },
    ]);
    return { cycle, committed, added, open, carried, removed };
  }

  type Facts = {
    counts: Record<string, number>;
    sayDoPercent: number | null;
    added: { tasks: { key: string }[] };
    carriedOver: { tasks: { key: string }[] };
    leftOpen: { tasks: { key: string }[] };
    removed: { tasks: { key: string }[] };
  };

  it("computes the cycle's facts without AI", async () => {
    const s = await scene();
    const { cycle, added, open, carried, removed } = await endedCycle(s);
    const facts = await s.ok<Facts>(
      s.mia,
      "GET",
      `/insight/retro/cycle/${cycle.id}`,
    );
    expect(facts.counts).toMatchObject({
      committed: 4,
      completed: 2,
      committedCompleted: 1,
      added: 1,
      removed: 1,
      carriedOver: 1,
      leftOpen: 1,
      reopened: 0,
    });
    expect(facts.sayDoPercent).toBe(25);
    expect(facts.added.tasks.map((task) => task.key)).toEqual([
      key(added.number),
    ]);
    expect(facts.carriedOver.tasks.map((task) => task.key)).toEqual([
      key(carried.number),
    ]);
    expect(facts.leftOpen.tasks.map((task) => task.key)).toEqual([
      key(open.number),
    ]);
    expect(facts.removed.tasks.map((task) => task.key)).toEqual([
      key(removed.number),
    ]);

    const viewer = await s.as(s.vic)("GET", `/insight/retro/cycle/${cycle.id}`);
    expect(viewer.status).toBe(403);
    const draft = await s.insertCycle({ startDate: null, endDate: null });
    const noDates = await s.as(s.mia)(
      "GET",
      `/insight/retro/cycle/${draft.id}`,
    );
    expect(noDates.status).toBe(409);
  });

  it("narrates the facts with AI, team-level, when AI is on", async () => {
    const s = await scene(true);
    const { cycle, added } = await endedCycle(s);
    recordPrompts(`## Summary\nScope grew mid-cycle [${key(added.number)}].`);
    const response = await s.as(s.mia)(
      "POST",
      "/ai/insight/retro?stream=false",
      {
        workspaceId: s.workspaceId,
        cycleId: cycle.id,
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      text: string;
      facts: Facts;
      citations: { key: string }[];
    };
    expect(body.text).toContain(key(added.number));
    expect(body.facts.sayDoPercent).toBe(25);
    expect(body.citations.map((c) => c.key)).toContain(key(added.number));
    expect(prompts[0]).toContain("say/do 25%");
    expect(prompts[0]).not.toContain("Mia");
    expect(await usage(s.workspaceId, "retro")).toHaveLength(1);
  });

  it("is refused while AI is off, but the facts still work", async () => {
    process.env.MARGAYA_AI_ENABLED = "true";
    process.env.MARGAYA_AI_PROVIDER = "fake";
    const s = await draftScene();
    const { cycle } = await endedCycle(s);
    const response = await s.as(s.mia)(
      "POST",
      "/ai/insight/retro?stream=false",
      {
        workspaceId: s.workspaceId,
        cycleId: cycle.id,
      },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "AI_DISABLED" });
    await s.ok(s.mia, "GET", `/insight/retro/cycle/${cycle.id}`);
  });
});

describe("My brief", () => {
  async function mine(s: Scene) {
    const web = s.web.project.id;
    const overdue = await insertTask(web, "Renew certificate", {
      dueDate: new Date(Date.now() - 2 * DAY_MS),
    });
    await assign(overdue.id, s.mia);
    const blocker = await insertTask(web, "Approve design");
    const blocked = await insertTask(web, "Build checkout");
    await assign(blocked.id, s.mia);
    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: blocker.id,
      targetTaskId: blocked.id,
      relationType: "blocks",
    });
    const followed = await insertTask(web, "Pricing page copy");
    await db
      .insert(schema.taskSubscriberTable)
      .values({ taskId: followed.id, userId: s.mia.id, subscribed: true });
    await db.insert(schema.activityTable).values({
      taskId: followed.id,
      type: "comment",
      userId: s.ada.id,
      content: "Updated the hero text",
    });
    // Mia's own change is not news to her.
    await db.insert(schema.activityTable).values({
      taskId: followed.id,
      type: "priority_changed",
      userId: s.mia.id,
    });
    await db.insert(schema.notificationTable).values({
      userId: s.mia.id,
      workspaceId: s.workspaceId,
      type: "task_mention",
      resourceId: followed.id,
      resourceType: "task",
      actorId: s.ada.id,
      eventData: { projectId: web },
    });
    return { overdue, blocked, blocker, followed };
  }

  type Brief = {
    overdue: { total: number; items: { key: string }[] };
    dueToday: { total: number; items: { key: string; title: string }[] };
    mentions: {
      total: number;
      items: { actorName: string | null; key: string | null }[];
    };
    blocked: {
      total: number;
      items: { task: { key: string }; blockers: { key: string }[] }[];
    };
    following: { total: number; items: { changes: number; kinds: string[] }[] };
  };

  it("lists my due, mentions, blocked and followed changes without AI", async () => {
    const s = await scene();
    const { overdue, blocked, blocker, followed } = await mine(s);
    const brief = await s.ok<Brief>(
      s.mia,
      "GET",
      `/insight/my-brief?workspaceId=${s.workspaceId}`,
    );
    expect(brief.overdue.items.map((task) => task.key)).toEqual([
      key(overdue.number),
    ]);
    expect(brief.blocked.items).toEqual([
      expect.objectContaining({
        task: expect.objectContaining({ key: key(blocked.number) }),
        blockers: [expect.objectContaining({ key: key(blocker.number) })],
      }),
    ]);
    expect(brief.following.items).toEqual([
      expect.objectContaining({ changes: 1, kinds: ["comment"] }),
    ]);
    expect(brief.mentions.items).toEqual([
      expect.objectContaining({ actorName: "Ada", key: key(followed.number) }),
    ]);

    // Someone else's brief holds none of Mia's work.
    const ada = await s.ok<Brief>(
      s.ada,
      "GET",
      `/insight/my-brief?workspaceId=${s.workspaceId}`,
    );
    expect(ada.overdue.total + ada.blocked.total + ada.mentions.total).toBe(0);
  });

  it("summarizes with AI but leaves restricted projects out of the prompt", async () => {
    const s = await scene(true);
    await mine(s);
    await restrict(s.api.project.id, [s.mia]);
    const secret = await insertTask(s.api.project.id, "Secret merger prep", {
      dueDate: new Date(Date.now() - DAY_MS),
    });
    await assign(secret.id, s.mia);

    const computed = await s.ok<Brief>(
      s.mia,
      "GET",
      `/insight/my-brief?workspaceId=${s.workspaceId}`,
    );
    expect(computed.overdue.total).toBe(2);

    recordPrompts("Two things need you first.");
    const response = await s.as(s.mia)(
      "POST",
      "/ai/insight/my-brief?stream=false",
      {
        workspaceId: s.workspaceId,
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { brief: Brief };
    expect(body.brief.overdue.total).toBe(1);
    expect(prompts[0]).toContain("Renew certificate");
    expect(prompts[0]).not.toContain("Secret merger");
    expect(await usage(s.workspaceId, "my_brief")).toHaveLength(1);

    const viewer = await s.as(s.vic)(
      "POST",
      "/ai/insight/my-brief?stream=false",
      {
        workspaceId: s.workspaceId,
      },
    );
    expect(viewer.status).toBe(403);
  });

  it("joins the email digest only for people who opted in", async () => {
    const s = await scene();
    await mine(s);
    const input = {
      userId: s.mia.id,
      since: new Date(Date.now() - DAY_MS),
      now: new Date(),
      timeZone: "UTC",
      locale: null,
    };
    const without = await buildDigestWorkspaces(input);
    expect(without[0]?.brief).toBeUndefined();
    const withBrief = await buildDigestWorkspaces({
      ...input,
      includeBrief: true,
    });
    expect(withBrief[0]?.brief?.blocked).toHaveLength(1);
    expect(withBrief[0]?.brief?.following).toEqual([
      expect.objectContaining({ changes: 1 }),
    ]);
  });
});
