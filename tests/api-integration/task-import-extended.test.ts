import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { day } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  clearPublishedEvents,
  json,
  publishedEvents,
  recordEvents,
  settle,
} from "./helpers/intake";

recordEvents(
  "cycle.tasks_changed",
  "module.tasks_changed",
  "task.label_created",
);

type ImportResult = {
  results: {
    successful: number;
    failed: number;
    tasks: Array<{
      success: boolean;
      task: { id: string; status: string; estimatePointId: string | null };
      warnings?: string[];
    }>;
  };
};

async function scene() {
  const { user, workspace } = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: workspace.id,
    slug: "imp",
  });
  const { project: otherProject } = await createProjectFixture({
    workspaceId: workspace.id,
    slug: "oth",
  });
  mockAuthenticatedSession(user);
  const { app } = createApp();
  const importTasks = async (tasks: unknown[]) => {
    const response = await app.request(
      `/api/task/import/${project.id}`,
      json("POST", { tasks }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as ImportResult;
  };
  return { user, workspace, project, otherProject, app, importTasks };
}

async function labelsOf(taskId: string) {
  return db
    .select({ name: schema.labelTable.name, color: schema.labelTable.color })
    .from(schema.labelTable)
    .where(eq(schema.labelTable.taskId, taskId));
}

describe("API integration: importing tasks with labels, cycles, modules and estimates", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    clearPublishedEvents();
  });

  it("attaches labels, preferring a same-named workspace label's color", async () => {
    const { workspace, importTasks } = await scene();
    await db
      .insert(schema.labelTable)
      .values({ name: "Bug", color: "red", workspaceId: workspace.id });

    const result = await importTasks([
      {
        title: "Labelled",
        status: "to-do",
        labels: ["bug", { name: "UX", color: "#112233" }, "Plain", "  "],
      },
    ]);
    const [entry] = result.results.tasks;

    expect(entry?.success).toBe(true);
    const labels = await labelsOf(entry?.task.id ?? "");
    expect(labels.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "bug", color: "red" },
      { name: "Plain", color: "gray" },
      { name: "UX", color: "#112233" },
    ]);
    expect(entry?.warnings).toEqual([
      "Label (empty) skipped: names are 1-50 characters",
    ]);
  });

  it("matches a status by column name and puts accepted cycle and module values in place", async () => {
    const { user, project, otherProject, importTasks } = await scene();
    const [current] = await db
      .insert(schema.cycleTable)
      .values({
        projectId: project.id,
        name: "Now",
        startDate: day(-1),
        endDate: day(5),
        ownerId: user.id,
        createdBy: user.id,
      })
      .returning();
    const [completed] = await db
      .insert(schema.cycleTable)
      .values({
        projectId: project.id,
        name: "Done",
        startDate: day(-20),
        endDate: day(-10),
        ownerId: user.id,
        createdBy: user.id,
      })
      .returning();
    const [module] = await db
      .insert(schema.moduleTable)
      .values({ projectId: project.id, name: "Auth", createdBy: user.id })
      .returning();
    const [foreignModule] = await db
      .insert(schema.moduleTable)
      .values({
        projectId: otherProject.id,
        name: "Elsewhere",
        createdBy: user.id,
      })
      .returning();

    const result = await importTasks([
      {
        title: "Placed",
        status: "IN PROGRESS",
        cycleId: current?.id,
        moduleIds: [module?.id, foreignModule?.id],
      },
      { title: "Late", status: "to-do", cycleId: completed?.id },
    ]);
    await settle();
    const [placed, late] = result.results.tasks;

    expect(placed?.task.status).toBe("in-progress");
    expect(placed?.warnings).toEqual([
      `Module ${foreignModule?.id} skipped: not an active module of this project`,
    ]);
    expect(late?.success).toBe(true);
    expect(late?.warnings).toEqual([
      "Cycle skipped: the cycle is completed or archived and takes no tasks",
    ]);

    const cycleRows = await db
      .select()
      .from(schema.cycleTaskTable)
      .where(eq(schema.cycleTaskTable.taskId, placed?.task.id ?? ""));
    expect(cycleRows.map((row) => row.cycleId)).toEqual([current?.id]);
    const moduleRows = await db
      .select()
      .from(schema.moduleTaskTable)
      .where(eq(schema.moduleTaskTable.taskId, placed?.task.id ?? ""));
    expect(moduleRows.map((row) => row.moduleId)).toEqual([module?.id]);

    expect(publishedEvents("cycle.tasks_changed")).toHaveLength(1);
    expect(publishedEvents("module.tasks_changed")).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ moduleId: module?.id }),
      }),
    ]);
  });

  it("skips what a project can't take, and still creates the task", async () => {
    const { otherProject, user, importTasks } = await scene();
    const [foreignCycle] = await db
      .insert(schema.cycleTable)
      .values({
        projectId: otherProject.id,
        name: "Theirs",
        ownerId: user.id,
        createdBy: user.id,
      })
      .returning();

    const result = await importTasks([
      {
        title: "Odd",
        status: "nowhere",
        cycleId: foreignCycle?.id,
        estimatePointId: "no-such-point",
      },
    ]);
    const [entry] = result.results.tasks;

    expect(entry?.success).toBe(true);
    expect(entry?.task.status).toBe("planned");
    expect(entry?.task.estimatePointId).toBeNull();
    expect(entry?.warnings).toEqual(
      expect.arrayContaining([
        "Cycle skipped: not a cycle of this project",
        "Estimate skipped: estimates are turned off for this project",
      ]),
    );
  });

  it("refuses more than 5,000 tasks, and bodies over 16 MiB", async () => {
    const { app, project } = await scene();
    const many = Array.from({ length: 5001 }, (_, index) => ({
      title: `T${index}`,
      status: "to-do",
    }));

    const tooMany = await app.request(
      `/api/task/import/${project.id}`,
      json("POST", { tasks: many }),
    );
    expect(tooMany.status).toBe(400);
    expect(await tooMany.text()).toBe("Import at most 5,000 tasks per request");

    const huge = await app.request(`/api/task/import/${project.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tasks: [{ title: "x".repeat(17 * 1024 * 1024), status: "to-do" }],
      }),
    });
    expect(huge.status).toBe(413);
  });
});
