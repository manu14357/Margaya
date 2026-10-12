import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { previewProjectAutomation } from "../../apps/api/src/project-automation/controllers/preview-automation";
import { checkDueDateReminders } from "../../apps/api/src/scheduler/due-date-reminders";
import { localDateString } from "../../apps/api/src/utils/timezone";
import { mockAuthenticatedSession } from "./helpers/auth";
import { json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import {
  assignTask,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type CycleJson = { id: string; status: string; today: string };

async function scene(role = "admin") {
  const member = await createWorkspaceMember({ role });
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
    slug: "tz",
  });
  mockAuthenticatedSession(member.user);
  const { app } = createApp();
  const request = (path: string, init?: RequestInit) =>
    app.request(`/api${path}`, init);
  return { ...member, project, columns, request };
}

async function setZone(workspaceId: string, timezone: string) {
  await db
    .update(schema.workspaceTable)
    .set({ timezone })
    .where(eq(schema.workspaceTable.id, workspaceId));
}

async function insertCycle(
  projectId: string,
  startDate: string,
  endDate: string,
) {
  const [cycle] = await db
    .insert(schema.cycleTable)
    .values({ projectId, name: `${startDate}..${endDate}`, startDate, endDate })
    .returning();
  if (!cycle) throw new Error("cycle insert failed");
  return cycle;
}

beforeEach(async () => {
  await resetTestDatabase();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("API integration: workspace time zone setting", () => {
  it("defaults to UTC and saves a valid zone", async () => {
    const s = await scene();
    const read = await s.request(`/workspace/${s.workspace.id}/settings`);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ timezone: "UTC" });

    const saved = await s.request(
      `/workspace/${s.workspace.id}/settings`,
      json("PATCH", { timezone: "europe/berlin" }),
    );
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(await saved.json()).toEqual({ timezone: "Europe/Berlin" });
  });

  it.each(["Mars/Olympus", "+05:30", ""])("rejects %j with 400", async (tz) => {
    const s = await scene();
    const response = await s.request(
      `/workspace/${s.workspace.id}/settings`,
      json("PATCH", { timezone: tz }),
    );
    expect(response.status).toBe(400);
    const [row] = await db
      .select({ timezone: schema.workspaceTable.timezone })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, s.workspace.id));
    expect(row?.timezone).toBe("UTC");
  });

  it("needs the workspace settings permission", async () => {
    const s = await scene("member");
    const response = await s.request(
      `/workspace/${s.workspace.id}/settings`,
      json("PATCH", { timezone: "Asia/Tokyo" }),
    );
    expect(response.status).toBe(403);
  });

  it("stores, validates and clears the user time zone", async () => {
    const s = await scene("member");
    expect(await (await s.request("/user/timezone")).json()).toEqual({
      timezone: null,
    });
    const bad = await s.request(
      "/user/timezone",
      json("PUT", { timezone: "Nowhere/Land" }),
    );
    expect(bad.status).toBe(400);
    const good = await s.request(
      "/user/timezone",
      json("PUT", { timezone: "America/New_York" }),
    );
    expect(await good.json()).toEqual({ timezone: "America/New_York" });
    const cleared = await s.request(
      "/user/timezone",
      json("PUT", { timezone: null }),
    );
    expect(await cleared.json()).toEqual({ timezone: null });
  });
});

describe("API integration: cycle status follows the workspace day", () => {
  async function statuses(s: Awaited<ReturnType<typeof scene>>) {
    const response = await s.request(`/cycle/project/${s.project.id}`);
    expect(response.status, await response.clone().text()).toBe(200);
    const cycles = (await response.json()) as CycleJson[];
    return cycles;
  }

  it("keeps UTC behaviour unchanged by default", async () => {
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-03-10T23:30:00Z"),
    });
    const s = await scene();
    const ending = await insertCycle(s.project.id, "2026-03-01", "2026-03-10");
    const next = await insertCycle(s.project.id, "2026-03-11", "2026-03-20");

    const cycles = await statuses(s);
    const byId = new Map(cycles.map((cycle) => [cycle.id, cycle]));
    expect(byId.get(ending.id)).toMatchObject({
      status: "current",
      today: "2026-03-10",
    });
    expect(byId.get(next.id)?.status).toBe("upcoming");
  });

  it("flips at local midnight for a non-UTC workspace", async () => {
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-03-10T14:59:00Z"),
    });
    const s = await scene();
    await setZone(s.workspace.id, "Asia/Tokyo");
    const ending = await insertCycle(s.project.id, "2026-03-01", "2026-03-10");
    const next = await insertCycle(s.project.id, "2026-03-11", "2026-03-20");

    // 23:59 in Tokyo: the cycle's last day is still running.
    let byId = new Map((await statuses(s)).map((cycle) => [cycle.id, cycle]));
    expect(byId.get(ending.id)?.status).toBe("current");
    expect(byId.get(next.id)?.status).toBe("upcoming");

    // Midnight in Tokyo (15:00 UTC, still March 10 in UTC).
    vi.setSystemTime(new Date("2026-03-10T15:00:00Z"));
    byId = new Map((await statuses(s)).map((cycle) => [cycle.id, cycle]));
    expect(byId.get(ending.id)).toMatchObject({
      status: "completed",
      today: "2026-03-11",
    });
    expect(byId.get(next.id)?.status).toBe("current");
  });
});

describe("API integration: automations respect the workspace time zone", () => {
  async function staleTaskInCycle(cycleEnd: string, updatedAt: Date) {
    const s = await scene();
    await db
      .insert(schema.projectAutomationTable)
      .values({ projectId: s.project.id })
      .onConflictDoNothing();
    const cycle = await insertCycle(s.project.id, "2026-01-01", cycleEnd);
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: s.project.id,
        title: "Stale",
        number: 1,
        status: "done",
        columnId: s.columns.done.id,
        description: "",
      })
      .returning();
    if (!task) throw new Error("task insert failed");
    await db.insert(schema.cycleTaskTable).values({
      taskId: task.id,
      cycleId: cycle.id,
    });
    await db
      .update(schema.taskTable)
      .set({ updatedAt })
      .where(eq(schema.taskTable.id, task.id));
    return s;
  }

  it("treats a cycle as finished from local midnight", async () => {
    const now = new Date("2026-03-10T23:30:00Z");
    const s = await staleTaskInCycle("2026-03-10", new Date("2025-06-01"));
    const preview = () =>
      previewProjectAutomation({
        projectId: s.project.id,
        rule: "archive",
        months: 1,
        now,
      });

    // UTC: March 10, the cycle still runs and protects its task.
    expect((await preview()).count).toBe(0);
    // Tokyo: already March 11, the cycle is over.
    await setZone(s.workspace.id, "Asia/Tokyo");
    expect((await preview()).count).toBe(1);
  });

  it("counts calendar months on the workspace's wall clock", async () => {
    // May 30 20:00 UTC is May 31 05:00 in Tokyo; one month back is April 30
    // 20:00 UTC in UTC but April 30 05:00 Tokyo (April 29 20:00 UTC).
    const now = new Date("2026-05-30T20:00:00Z");
    const s = await staleTaskInCycle(
      "2026-01-31",
      new Date("2026-04-30T10:00:00Z"),
    );
    const preview = () =>
      previewProjectAutomation({
        projectId: s.project.id,
        rule: "archive",
        months: 1,
        now,
      });
    expect((await preview()).count).toBe(1);
    await setZone(s.workspace.id, "Asia/Tokyo");
    expect((await preview()).count).toBe(0);
  });
});

describe("API integration: reminders carry the recipient's due day", () => {
  it("adds dueDay in the assignee's own zone", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.userTable)
      .set({ timezone: "Asia/Kolkata" })
      .where(eq(schema.userTable.id, user.id));
    const { project, columns } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const dueDate = new Date(Date.now() + 1435 * 60_000);
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        columnId: columns.todo.id,
        title: "Due soon",
        number: 1,
        status: "to-do",
        dueDate,
      })
      .returning();
    if (!task) throw new Error("task insert failed");
    await assignTask(task.id, [user.id]);

    await checkDueDateReminders();

    const [notification] = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.resourceId, task.id));
    expect(notification?.eventData).toMatchObject({
      dueDay: localDateString(dueDate, "Asia/Kolkata"),
    });
  });
});
