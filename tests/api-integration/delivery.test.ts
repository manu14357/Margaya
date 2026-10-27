import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { encodeScope } from "../../apps/api/src/api-key/scope";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { shiftDate, todayUtc } from "../../apps/api/src/utils/calendar-date";
import { createApiKey } from "./helpers/api-keys";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  assignTask,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Delivery forecast (A2) and risk radar (A3): numbers, authorization and
// restricted projects.

type User = typeof schema.userTable.$inferSelect;
type Task = typeof schema.taskTable.$inferSelect;

const SECRET = "Zebracorn hidden blocker";
const day = (offset: number) => shiftDate(todayUtc(), offset);
const noon = (offset: number) => new Date(`${day(offset)}T12:00:00.000Z`);

async function scene() {
  const { user: admin, workspace } = await createWorkspaceMember({
    role: "admin",
  });
  const member = await addWorkspaceMember(workspace.id, "member");
  const viewer = await addWorkspaceMember(workspace.id, "viewer");
  const { project, columns } = await createProjectFixture({
    workspaceId: workspace.id,
    name: "Delivery",
    slug: "dlv",
  });
  await db
    .update(schema.projectTable)
    .set({ createdAt: noon(-90) })
    .where(eq(schema.projectTable.id, project.id));
  const { app } = createApp();

  let number = 1;
  const createTask = async (
    values: Partial<typeof schema.taskTable.$inferInsert> = {},
    projectId = project.id,
  ): Promise<Task> => {
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title: `Task ${number}`,
        number: number++,
        status: "to-do",
        ...values,
      })
      .returning();
    if (!task) throw new Error("no task");
    return task;
  };
  const statusChange = (
    taskId: string,
    at: Date,
    oldStatus: string,
    newStatus: string,
  ) =>
    db.insert(schema.activityTable).values({
      taskId,
      type: "status_changed",
      userId: admin.id,
      createdAt: at,
      eventData: { oldStatus, newStatus },
    });

  // History: one completion a day for the last 28 days, each in progress
  // for two days first (a cycle time of 2 days).
  for (let offset = 1; offset <= 28; offset++) {
    const done = await createTask({
      status: "done",
      completedAt: noon(-offset),
      createdAt: noon(-offset - 5),
    });
    await statusChange(done.id, noon(-offset - 2), "to-do", "in-progress");
    await statusChange(done.id, noon(-offset), "in-progress", "done");
  }

  const [cycle] = await db
    .insert(schema.cycleTable)
    .values({
      projectId: project.id,
      name: "Sprint",
      startDate: day(-3),
      endDate: day(4),
    })
    .returning();
  const [module] = await db
    .insert(schema.moduleTable)
    .values({ projectId: project.id, name: "Launch", targetDate: day(30) })
    .returning();
  if (!cycle || !module) throw new Error("no cycle or module");

  const as = (user: User) => {
    mockAuthenticatedSession(user);
    return app;
  };
  const get = async (user: User, path: string) =>
    as(user).request(`/api/delivery${path}`);

  return {
    admin,
    member,
    viewer,
    workspace,
    project,
    columns,
    cycle,
    module,
    app,
    createTask,
    statusChange,
    get,
  };
}

type Scene = Awaited<ReturnType<typeof scene>>;

async function addToCycle(s: Scene, tasks: Task[]) {
  await db
    .insert(schema.cycleTaskTable)
    .values(tasks.map((task) => ({ taskId: task.id, cycleId: s.cycle.id })));
}

async function ok(response: Response) {
  expect(response.status, await response.clone().text()).toBe(200);
  // biome-ignore lint/suspicious/noExplicitAny: JSON in tests
  return (await response.json()) as any;
}

describe("API integration: delivery forecast", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("forecasts a cycle, a module and a project deterministically", async () => {
    const s = await scene();
    const open = await Promise.all(
      Array.from({ length: 10 }, () => s.createTask()),
    );
    await addToCycle(s, open);
    await db
      .insert(schema.moduleTaskTable)
      .values(
        open
          .slice(0, 3)
          .map((task) => ({ moduleId: s.module.id, taskId: task.id })),
      );

    const cycle = await ok(
      await s.get(s.member, `/cycle/${s.cycle.id}/forecast`),
    );
    expect(cycle).toMatchObject({
      status: "ok",
      reason: null,
      remaining: 10,
      today: day(0),
      scope: { type: "cycle", id: s.cycle.id, endDate: day(4) },
      history: { from: day(-56), to: day(-1), days: 56, completed: 28 },
      method: { name: "monte_carlo_daily_throughput", iterations: 10000 },
    });
    // 0.5 tasks a day: ten tasks take about twenty days.
    expect(cycle.p50.days).toBeGreaterThan(12);
    expect(cycle.p50.days).toBeLessThanOrEqual(cycle.p85.days);
    expect(cycle.p85.days).toBeLessThanOrEqual(cycle.p95.days);
    expect(cycle.probabilityByEnd).toBeLessThan(0.2);
    const again = await ok(
      await s.get(s.member, `/cycle/${s.cycle.id}/forecast`),
    );
    expect(again).toEqual(cycle);

    const module = await ok(
      await s.get(s.member, `/module/${s.module.id}/forecast`),
    );
    expect(module).toMatchObject({ status: "ok", remaining: 3 });
    expect(module.probabilityByEnd).toBeGreaterThan(0.9);

    const project = await ok(
      await s.get(s.member, `/project/${s.project.id}/forecast`),
    );
    expect(project).toMatchObject({
      status: "ok",
      remaining: 10,
      probabilityByEnd: null,
      scope: { type: "project", endDate: null },
    });
  });

  it("is honest about thin history and finished scopes", async () => {
    const s = await scene();
    const { project: fresh } = await createProjectFixture({
      workspaceId: s.workspace.id,
      slug: "new",
    });
    await s.createTask({}, fresh.id);
    const thin = await ok(
      await s.get(s.member, `/project/${fresh.id}/forecast`),
    );
    expect(thin).toMatchObject({
      status: "insufficient_history",
      reason: "short_span",
      p50: null,
      remaining: 1,
    });

    const done = await ok(
      await s.get(s.member, `/cycle/${s.cycle.id}/forecast`),
    );
    expect(done).toMatchObject({ status: "complete", remaining: 0 });
  });

  it("follows analytics permissions, features and restricted projects", async () => {
    const s = await scene();
    for (const path of [
      `/cycle/${s.cycle.id}/forecast`,
      `/module/${s.module.id}/risks`,
      `/project/${s.project.id}/forecast`,
      `/project/${s.project.id}/risks`,
    ]) {
      expect((await s.get(s.viewer, path)).status).toBe(403);
    }

    await db
      .update(schema.projectTable)
      .set({ cyclesEnabled: false })
      .where(eq(schema.projectTable.id, s.project.id));
    expect((await s.get(s.member, `/cycle/${s.cycle.id}/risks`)).status).toBe(
      403,
    );

    await db
      .update(schema.projectTable)
      .set({ cyclesEnabled: true, visibility: "restricted" })
      .where(eq(schema.projectTable.id, s.project.id));
    expect(
      (await s.get(s.member, `/cycle/${s.cycle.id}/forecast`)).status,
    ).toBe(404);
    expect(
      (await s.get(s.member, `/project/${s.project.id}/risks`)).status,
    ).toBe(404);
    expect(
      (await s.get(s.admin, `/project/${s.project.id}/risks`)).status,
    ).toBe(200);

    // Someone from another workspace has no access at all.
    const outsider = await createWorkspaceMember();
    expect(
      (await s.get(outsider.user, `/project/${s.project.id}/forecast`)).status,
    ).toBe(403);
  });

  it("refuses an API key without analytics", async () => {
    const s = await scene();
    const key = await createApiKey(
      s.admin,
      encodeScope({
        access: "custom",
        areas: { task: "read", project: "read", cycle: "read" },
      }) ?? undefined,
    );
    mockAnonymousSession();
    const refused = await s.app.request(
      `/api/delivery/cycle/${s.cycle.id}/forecast`,
      { headers: key.headers },
    );
    expect(refused.status).toBe(403);

    const reader = await createApiKey(
      s.admin,
      encodeScope({ access: "read" }) ?? undefined,
    );
    const allowed = await s.app.request(
      `/api/delivery/cycle/${s.cycle.id}/forecast`,
      { headers: reader.headers },
    );
    expect(allowed.status, await allowed.clone().text()).toBe(200);
  });
});

describe("API integration: risk radar", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("computes the signals and never names a hidden blocker", async () => {
    const s = await scene();
    const head = await s.createTask({ title: "Head" });
    const blocked = await s.createTask();
    const behind = await s.createTask();
    const ageing = await s.createTask({
      status: "in-progress",
      createdAt: noon(-12),
    });
    await s.statusChange(ageing.id, noon(-10), "to-do", "in-progress");
    const overdue = await Promise.all(
      [1, 2, 3].map(() => s.createTask({ dueDate: noon(-5) })),
    );
    for (const task of overdue) await assignTask(task.id, [s.member.id]);
    const unassigned = await s.createTask({ dueDate: noon(1) });
    for (const task of [blocked, behind, ageing]) {
      await assignTask(task.id, [s.member.id]);
    }

    // A blocker in a restricted project the member can't see.
    const { project: secret } = await createProjectFixture({
      workspaceId: s.workspace.id,
      slug: "sec",
      name: "Secret",
    });
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, secret.id));
    const hidden = await s.createTask({ title: SECRET }, secret.id);
    const victim = await s.createTask();
    await assignTask(victim.id, [s.member.id]);

    await addToCycle(s, [
      blocked,
      behind,
      ageing,
      ...overdue,
      unassigned,
      victim,
    ]);
    await db.insert(schema.taskRelationTable).values([
      {
        sourceTaskId: head.id,
        targetTaskId: blocked.id,
        relationType: "blocks",
      },
      {
        sourceTaskId: blocked.id,
        targetTaskId: behind.id,
        relationType: "blocks",
      },
      {
        sourceTaskId: hidden.id,
        targetTaskId: victim.id,
        relationType: "blocks",
      },
    ]);

    const response = await s.get(s.member, `/cycle/${s.cycle.id}/risks`);
    const text = await response.clone().text();
    const risks = await ok(response);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(hidden.id);
    expect(risks.hiddenBlockers).toBe(1);
    expect(risks.history.cycleTime).toEqual({
      samples: 28,
      p50Days: 2,
      p85Days: 2,
    });

    const byKind = (kind: string) =>
      // biome-ignore lint/suspicious/noExplicitAny: JSON in tests
      risks.signals.filter((signal: any) => signal.kind === kind);
    expect(byKind("blocked_chain")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "high",
          headTaskId: head.id,
          taskIds: [blocked.id, behind.id],
          depth: 2,
        }),
        expect.objectContaining({ headTaskId: null, taskIds: [victim.id] }),
      ]),
    );
    expect(byKind("ageing")[0]).toMatchObject({
      severity: "high",
      taskIds: [ageing.id],
      thresholdDays: 2,
    });
    expect(byKind("overdue_cluster")[0]).toMatchObject({
      assigneeId: s.member.id,
      total: 3,
    });
    expect(byKind("unassigned_near_deadline")[0]).toMatchObject({
      taskIds: [unassigned.id],
      severity: "high",
    });
    // biome-ignore lint/suspicious/noExplicitAny: JSON in tests
    const head_ = risks.tasks.find((task: any) => task.id === head.id);
    expect(head_).toMatchObject({ title: "Head", projectSlug: "dlv" });

    // The admin sees the restricted project, so its blocker is named.
    const asAdmin = await ok(
      await s.get(s.admin, `/cycle/${s.cycle.id}/risks`),
    );
    expect(asAdmin.hiddenBlockers).toBe(0);
    expect(JSON.stringify(asAdmin)).toContain(SECRET);
  });

  it("lists home risks from visible current cycles only", async () => {
    const s = await scene();
    const late = await Promise.all(
      [1, 2, 3].map(() => s.createTask({ dueDate: noon(-2) })),
    );
    for (const task of late) await assignTask(task.id, [s.member.id]);
    await addToCycle(s, late);

    const { project: secret } = await createProjectFixture({
      workspaceId: s.workspace.id,
      slug: "sec",
      name: "Secret",
    });
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, secret.id));
    const [secretCycle] = await db
      .insert(schema.cycleTable)
      .values({
        projectId: secret.id,
        name: SECRET,
        startDate: day(-1),
        endDate: day(5),
      })
      .returning();
    if (!secretCycle) throw new Error("no cycle");
    const secretTask = await s.createTask({ dueDate: noon(-3) }, secret.id);
    await db
      .insert(schema.cycleTaskTable)
      .values({ taskId: secretTask.id, cycleId: secretCycle.id });

    const home = await ok(
      await s.get(s.member, `/home/risks?workspaceId=${s.workspace.id}`),
    );
    expect(home.cycles).toBe(1);
    expect(home.signals[0]).toMatchObject({
      kind: "overdue_cluster",
      cycleId: s.cycle.id,
      projectName: "Delivery",
    });
    expect(JSON.stringify(home)).not.toContain(SECRET);

    const asAdmin = await ok(
      await s.get(s.admin, `/home/risks?workspaceId=${s.workspace.id}`),
    );
    expect(asAdmin.cycles).toBe(2);
    expect(
      (await s.get(s.viewer, `/home/risks?workspaceId=${s.workspace.id}`))
        .status,
    ).toBe(403);
  });
});
