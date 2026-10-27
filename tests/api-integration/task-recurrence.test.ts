import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { taskRecurrenceTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { withJobLease } from "../../apps/api/src/scheduler/leader-lock";
import { claimTaskNumber } from "../../apps/api/src/task/controllers/claim-task-numbers";
import {
  runTaskRecurrence,
  TASK_RECURRENCE_LEASE,
} from "../../apps/api/src/task-recurrence/job";
import { spawnNextInstance } from "../../apps/api/src/task-recurrence/spawn";
import {
  handleAutoClosedTasks,
  handleRecurringCompletion,
} from "../../apps/api/src/task-recurrence/subscribers";
import { mockAuthenticatedSession } from "./helpers/auth";
import { json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  assignTask,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type RecurrenceJson = {
  recurrence: {
    taskId: string;
    frequency: string;
    interval: number;
    weekdays: number[];
    monthDay: number | null;
    trigger: string;
    anchorDate: string;
    endDate: string | null;
    maxOccurrences: number | null;
    occurrenceCount: number;
    nextDate: string | null;
  } | null;
};

async function scene({ timezone = "UTC" } = {}) {
  const owner = await createWorkspaceMember({ role: "member" });
  const workspaceId = owner.workspace.id;
  await db
    .update(schema.workspaceTable)
    .set({ timezone })
    .where(eq(schema.workspaceTable.id, workspaceId));
  const viewer = await addWorkspaceMember(workspaceId, "viewer");
  const teammate = await addWorkspaceMember(workspaceId, "member");
  const outsider = await createWorkspaceMember({ role: "owner" });
  const { project, columns } = await createProjectFixture({
    workspaceId,
    slug: "rep",
  });
  const { app } = createApp();

  const as = (
    user: { id: string },
    method: string,
    path: string,
    body?: unknown,
  ) => {
    mockAuthenticatedSession(user as never);
    return app.request(
      `/api${path}`,
      body === undefined ? { method } : json(method, body),
    );
  };

  const createTask = async (
    overrides: Partial<typeof schema.taskTable.$inferInsert> = {},
  ) => {
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Water the plants",
        description: "Every pot on the balcony",
        priority: "high",
        number: await claimTaskNumber(project.id),
        status: "to-do",
        columnId: columns.todo.id,
        createdBy: owner.user.id,
        ...overrides,
      })
      .returning();
    if (!task) throw new Error("Failed to create task");
    return task;
  };

  const setRule = async (taskId: string, body: Record<string, unknown>) => {
    const response = await as(
      owner.user,
      "PUT",
      `/task-recurrence/${taskId}`,
      body,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as RecurrenceJson;
  };

  const projectTasks = () =>
    db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, project.id))
      .orderBy(asc(schema.taskTable.number));

  const ruleOf = async (taskId: string) => {
    const [rule] = await db
      .select()
      .from(taskRecurrenceTable)
      .where(eq(taskRecurrenceTable.taskId, taskId));
    return rule ?? null;
  };

  const complete = (taskId: string) =>
    db
      .update(schema.taskTable)
      .set({
        status: "done",
        columnId: columns.done.id,
        completedAt: new Date(),
      })
      .where(eq(schema.taskTable.id, taskId));

  return {
    owner: owner.user,
    viewer,
    teammate,
    outsider: outsider.user,
    workspaceId,
    project,
    columns,
    as,
    createTask,
    setRule,
    projectTasks,
    ruleOf,
    complete,
  };
}

describe("task recurrence", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  describe("authorization", () => {
    it("lets members read and change a rule, viewers only read, outsiders nothing", async () => {
      const s = await scene();
      const task = await s.createTask();
      const rule = { frequency: "daily" };

      expect(
        (await s.as(s.viewer, "PUT", `/task-recurrence/${task.id}`, rule))
          .status,
      ).toBe(403);
      expect(
        (await s.as(s.outsider, "PUT", `/task-recurrence/${task.id}`, rule))
          .status,
      ).toBe(403);
      expect(
        (await s.as(s.outsider, "GET", `/task-recurrence/${task.id}`)).status,
      ).toBe(403);
      expect(await s.ruleOf(task.id)).toBeNull();

      await s.setRule(task.id, rule);
      const read = await s.as(s.viewer, "GET", `/task-recurrence/${task.id}`);
      expect(read.status).toBe(200);
      expect(
        ((await read.json()) as RecurrenceJson).recurrence?.frequency,
      ).toBe("daily");

      expect(
        (await s.as(s.viewer, "DELETE", `/task-recurrence/${task.id}`)).status,
      ).toBe(403);
      expect(
        (await s.as(s.outsider, "DELETE", `/task-recurrence/${task.id}`))
          .status,
      ).toBe(403);
      expect(await s.ruleOf(task.id)).not.toBeNull();
    });

    it("rejects options that do not fit the frequency", async () => {
      const s = await scene();
      const task = await s.createTask();
      for (const body of [
        { frequency: "daily", weekdays: [1] },
        { frequency: "weekly", monthDay: 3 },
        { frequency: "daily", endDate: "2030-01-01", maxOccurrences: 3 },
        { frequency: "hourly" },
        { frequency: "daily", interval: 0 },
      ]) {
        const response = await s.as(
          s.owner,
          "PUT",
          `/task-recurrence/${task.id}`,
          body,
        );
        expect(response.status, JSON.stringify(body)).toBe(400);
      }
    });
  });

  describe("set and remove", () => {
    it("anchors on the due date in the workspace zone and records history", async () => {
      const s = await scene({ timezone: "Asia/Tokyo" });
      // 2026-10-20 23:30 UTC is 2026-10-21 08:30 in Tokyo.
      const task = await s.createTask({
        dueDate: new Date("2026-10-20T23:30:00.000Z"),
      });
      const saved = await s.setRule(task.id, {
        frequency: "weekly",
        weekdays: [3, 1, 3],
      });
      expect(saved.recurrence).toMatchObject({
        anchorDate: "2026-10-21",
        weekdays: [1, 3],
        trigger: "completion",
        occurrenceCount: 1,
      });

      const removed = await s.as(
        s.owner,
        "DELETE",
        `/task-recurrence/${task.id}`,
      );
      expect(removed.status).toBe(200);
      expect(await s.ruleOf(task.id)).toBeNull();

      const history = await db
        .select({ type: schema.activityTable.type })
        .from(schema.activityTable)
        .where(eq(schema.activityTable.taskId, task.id));
      expect(history.map((row) => row.type).sort()).toEqual([
        "recurrence_removed",
        "recurrence_set",
      ]);

      // Removing again is a no-op.
      expect(
        (await s.as(s.owner, "DELETE", `/task-recurrence/${task.id}`)).status,
      ).toBe(200);
    });

    it("marks the current instance on the board", async () => {
      const s = await scene();
      const repeating = await s.createTask();
      const plain = await s.createTask({ title: "Once" });
      await s.setRule(repeating.id, { frequency: "daily" });
      const response = await s.as(
        s.owner,
        "GET",
        `/task/tasks/${s.project.id}`,
      );
      expect(response.status).toBe(200);
      const board = (await response.json()) as {
        data: { columns: { tasks: { id: string; isRecurring?: boolean }[] }[] };
      };
      const flags = new Map(
        board.data.columns
          .flatMap((column) => column.tasks)
          .map((task) => [task.id, task.isRecurring]),
      );
      expect(flags.get(repeating.id)).toBe(true);
      expect(flags.get(plain.id)).toBe(false);
    });
  });

  describe("on completion", () => {
    it("creates one next instance with copied fields and shifted dates", async () => {
      const s = await scene();
      const today = new Date().toISOString().slice(0, 10);
      const due = new Date(`${today}T09:00:00.000Z`);
      const task = await s.createTask({ dueDate: due, startDate: due });
      await assignTask(task.id, [s.teammate.id]);
      await db.insert(schema.labelTable).values({
        name: "chores",
        color: "#22aa55",
        taskId: task.id,
        workspaceId: s.workspaceId,
      });
      await s.setRule(task.id, { frequency: "daily", interval: 2 });

      const response = await s.as(s.owner, "PUT", `/task/status/${task.id}`, {
        status: "done",
      });
      expect(response.status, await response.clone().text()).toBe(200);

      await vi.waitFor(
        async () => expect(await s.projectTasks()).toHaveLength(2),
        { timeout: 5000 },
      );
      const [, next] = await s.projectTasks();
      expect(next).toMatchObject({
        title: "Water the plants",
        description: "Every pot on the balcony",
        priority: "high",
        status: "to-do",
        completedAt: null,
        createdBy: s.owner.id,
      });
      const twoDays = 2 * 86_400_000;
      expect(next?.dueDate?.getTime()).toBe(due.getTime() + twoDays);
      expect(next?.startDate?.getTime()).toBe(due.getTime() + twoDays);

      const assignees = await db
        .select({ userId: schema.taskAssigneeTable.userId })
        .from(schema.taskAssigneeTable)
        .where(eq(schema.taskAssigneeTable.taskId, next?.id ?? ""));
      expect(assignees.map((row) => row.userId)).toEqual([s.teammate.id]);
      const labels = await db
        .select({ name: schema.labelTable.name })
        .from(schema.labelTable)
        .where(eq(schema.labelTable.taskId, next?.id ?? ""));
      expect(labels.map((row) => row.name)).toEqual(["chores"]);

      // The rule moved to the new instance.
      expect(await s.ruleOf(task.id)).toBeNull();
      expect(await s.ruleOf(next?.id ?? "")).toMatchObject({
        occurrenceCount: 2,
      });

      const history = await db
        .select({
          taskId: schema.activityTable.taskId,
          type: schema.activityTable.type,
        })
        .from(schema.activityTable)
        .where(eq(schema.activityTable.type, "recurred_from"));
      expect(history).toEqual([{ taskId: next?.id, type: "recurred_from" }]);
      // Let the new task's own subscribers (notifications, realtime) finish
      // before the next test truncates the tables.
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    it("is idempotent: repeated and concurrent completions create one instance", async () => {
      const s = await scene();
      const task = await s.createTask();
      await s.setRule(task.id, { frequency: "daily" });
      await s.complete(task.id);
      const rule = await s.ruleOf(task.id);

      const attempts = await Promise.all(
        Array.from({ length: 4 }, () =>
          spawnNextInstance({
            ruleId: rule?.id ?? "",
            sourceTaskId: task.id,
            reason: "completion",
            actorId: s.owner.id,
          }),
        ),
      );
      expect(attempts.filter(Boolean)).toHaveLength(1);
      // A replayed event finds the rule gone from the task.
      expect(
        await handleRecurringCompletion({ taskId: task.id, userId: null }),
      ).toBeNull();
      expect(await s.projectTasks()).toHaveLength(2);
    });

    it("does nothing for an open task, a schedule rule or after the count", async () => {
      const s = await scene();
      const open = await s.createTask();
      await s.setRule(open.id, { frequency: "daily" });
      expect(await handleRecurringCompletion({ taskId: open.id })).toBeNull();

      const scheduled = await s.createTask();
      await s.setRule(scheduled.id, {
        frequency: "daily",
        trigger: "schedule",
      });
      await s.complete(scheduled.id);
      expect(
        await handleRecurringCompletion({ taskId: scheduled.id }),
      ).toBeNull();

      const twice = await s.createTask();
      await s.setRule(twice.id, { frequency: "daily", maxOccurrences: 2 });
      await s.complete(twice.id);
      const second = await handleRecurringCompletion({ taskId: twice.id });
      expect(second).not.toBeNull();
      await s.complete(second?.task.id ?? "");
      expect(
        await handleRecurringCompletion({ taskId: second?.task.id ?? "" }),
      ).toBeNull();

      expect(await s.projectTasks()).toHaveLength(4);
    });

    it("continues after the auto-close automation, not after a manual cancel", async () => {
      const s = await scene();
      const [wontDo] = await db
        .insert(schema.columnTable)
        .values({
          projectId: s.project.id,
          name: "Won't do",
          slug: "wont-do",
          group: "cancelled",
          position: 9,
        })
        .returning();
      const cancel = (taskId: string) =>
        db
          .update(schema.taskTable)
          .set({ status: "wont-do", columnId: wontDo?.id, completedAt: null })
          .where(eq(schema.taskTable.id, taskId));

      const byHand = await s.createTask();
      await s.setRule(byHand.id, { frequency: "daily" });
      await cancel(byHand.id);
      expect(await handleRecurringCompletion({ taskId: byHand.id })).toBeNull();

      const stale = await s.createTask();
      await s.setRule(stale.id, { frequency: "daily" });
      const scheduled = await s.createTask();
      await s.setRule(scheduled.id, {
        frequency: "daily",
        trigger: "schedule",
      });
      const open = await s.createTask();
      await s.setRule(open.id, { frequency: "daily" });
      await cancel(stale.id);
      await cancel(scheduled.id);

      // Another rule or an open task never spawns.
      expect(
        await handleAutoClosedTasks({
          rule: "auto_archive",
          taskIds: [stale.id],
        }),
      ).toEqual([]);
      const spawned = await handleAutoClosedTasks({
        rule: "auto_close",
        taskIds: [stale.id, scheduled.id, open.id],
      });
      expect(spawned).toHaveLength(1);
      expect(await s.ruleOf(stale.id)).toBeNull();
      expect(await s.ruleOf(spawned[0]?.task.id ?? "")).toMatchObject({
        occurrenceCount: 2,
      });
      // A replay finds the rule gone from the closed task.
      expect(
        await handleAutoClosedTasks({
          rule: "auto_close",
          taskIds: [stale.id],
        }),
      ).toEqual([]);
      expect(await s.projectTasks()).toHaveLength(5);
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    it("stops once the repeat is removed", async () => {
      const s = await scene();
      const task = await s.createTask();
      await s.setRule(task.id, { frequency: "daily" });
      await s.as(s.owner, "DELETE", `/task-recurrence/${task.id}`);
      await s.complete(task.id);
      expect(await handleRecurringCompletion({ taskId: task.id })).toBeNull();
      expect(await s.projectTasks()).toHaveLength(1);
    });
  });

  describe("on schedule", () => {
    async function scheduledScene(timezone: string, anchorUtc: string) {
      const s = await scene({ timezone });
      const task = await s.createTask({ dueDate: new Date(anchorUtc) });
      await s.setRule(task.id, { frequency: "daily", trigger: "schedule" });
      return { s, task };
    }

    it("waits for the next day to begin in the workspace zone", async () => {
      // Auckland is UTC+13 in October: its 2026-10-21 begins at
      // 2026-10-20 11:00 UTC. The task is due 2026-10-20 local.
      const { s, task } = await scheduledScene(
        "Pacific/Auckland",
        "2026-10-19T23:00:00.000Z",
      );
      const rule = await s.ruleOf(task.id);
      expect(rule).toMatchObject({
        anchorDate: "2026-10-20",
        nextRunDate: "2026-10-21",
      });

      const before = await runTaskRecurrence(
        new Date("2026-10-20T10:59:00.000Z"),
      );
      expect(before.created).toBe(0);
      expect(await s.projectTasks()).toHaveLength(1);

      const after = await runTaskRecurrence(
        new Date("2026-10-20T11:01:00.000Z"),
      );
      expect(after.created).toBe(1);
      const tasks = await s.projectTasks();
      expect(tasks).toHaveLength(2);
      // Noon on 2026-10-21 in Auckland, like the source on the 20th.
      expect(tasks[1]?.dueDate?.toISOString()).toBe("2026-10-20T23:00:00.000Z");
      expect(await s.ruleOf(tasks[1]?.id ?? "")).toMatchObject({
        anchorDate: "2026-10-21",
        nextRunDate: "2026-10-22",
      });

      // The same tick again creates nothing.
      expect(
        (await runTaskRecurrence(new Date("2026-10-20T11:02:00.000Z"))).created,
      ).toBe(0);
    });

    it("runs a western zone's day later than UTC", async () => {
      // Los Angeles is UTC-7 in October: its 2026-10-21 begins at
      // 2026-10-21 07:00 UTC.
      const { s } = await scheduledScene(
        "America/Los_Angeles",
        "2026-10-20T07:00:00.000Z",
      );
      expect(
        (await runTaskRecurrence(new Date("2026-10-21T06:30:00.000Z"))).created,
      ).toBe(0);
      expect(
        (await runTaskRecurrence(new Date("2026-10-21T07:05:00.000Z"))).created,
      ).toBe(1);
      const tasks = await s.projectTasks();
      expect(tasks[1]?.dueDate?.toISOString()).toBe("2026-10-21T07:00:00.000Z");
    });

    it("collapses missed days into one instance", async () => {
      const { s } = await scheduledScene("UTC", "2026-10-10T00:00:00.000Z");
      expect(
        (await runTaskRecurrence(new Date("2026-10-20T12:00:00.000Z"))).created,
      ).toBe(1);
      const tasks = await s.projectTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks[1]?.dueDate?.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    });

    it("leaves the work to the instance holding the lease", async () => {
      const { s } = await scheduledScene("UTC", "2026-10-10T00:00:00.000Z");
      const outcome = await withJobLease(
        TASK_RECURRENCE_LEASE,
        () => runTaskRecurrence(new Date("2026-10-20T12:00:00.000Z")),
        () => ({ degraded: false, created: -1 }),
      );
      // The inner run finds the lease held by the outer one.
      expect(outcome.created).toBe(0);
      expect(await s.projectTasks()).toHaveLength(1);
    });

    it("pauses while the current instance is in the trash", async () => {
      const { s, task } = await scheduledScene(
        "UTC",
        "2026-10-10T00:00:00.000Z",
      );
      await db
        .update(schema.taskTable)
        .set({ deletedAt: new Date() })
        .where(eq(schema.taskTable.id, task.id));
      expect(
        (await runTaskRecurrence(new Date("2026-10-20T12:00:00.000Z"))).created,
      ).toBe(0);
      expect(await s.projectTasks()).toHaveLength(1);
    });
  });
});
