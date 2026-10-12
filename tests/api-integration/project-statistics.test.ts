import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type Statistics = {
  completionPercentage: number;
  totalTasks: number;
  dueDate: string | null;
};

async function addColumn(
  projectId: string,
  slug: string,
  group: "completed" | "cancelled" | "triage",
  position: number,
) {
  await db.insert(schema.columnTable).values({
    projectId,
    name: slug,
    slug,
    position,
    group,
    isFinal: group !== "triage",
  });
}

async function seedTasks(
  projectId: string,
  tasks: Array<{ status: string; dueDate?: Date; archivedAt?: Date }>,
) {
  for (const [index, task] of tasks.entries()) {
    await db.insert(schema.taskTable).values({
      projectId,
      title: `Task ${index + 1}`,
      status: task.status,
      dueDate: task.dueDate ?? null,
      archivedAt: task.archivedAt ?? null,
      number: index + 1,
    });
  }
}

async function statistics(workspaceId: string, user: { id: string }) {
  mockAuthenticatedSession(user as never);
  const { app } = createApp();
  const response = await app.request(`/api/project?workspaceId=${workspaceId}`);
  expect(response.status).toBe(200);
  const [project] = (await response.json()) as Array<{
    statistics: Statistics;
  }>;
  return project?.statistics;
}

describe("API integration: group-based project statistics", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("counts custom completed columns and archived tasks as done, without cancelled work", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await addColumn(project.id, "shipped", "completed", 4);
    await addColumn(project.id, "wont-do", "cancelled", 5);
    await seedTasks(project.id, [
      { status: "shipped" },
      // D7: archived open work keeps its column and counts as done.
      { status: "to-do", archivedAt: new Date() },
      { status: "to-do" },
      { status: "in-progress" },
      { status: "wont-do" },
    ]);

    // (1 shipped + 1 archived) / (5 - 1 cancelled) = 50%
    expect(await statistics(workspace.id, user)).toMatchObject({
      totalTasks: 5,
      completionPercentage: 50,
    });
  });

  it("reports 100 when every task is cancelled and 0 without tasks", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });

    expect(await statistics(workspace.id, user)).toMatchObject({
      totalTasks: 0,
      completionPercentage: 0,
    });

    await addColumn(project.id, "wont-do", "cancelled", 4);
    await seedTasks(project.id, [{ status: "wont-do" }, { status: "wont-do" }]);

    expect(await statistics(workspace.id, user)).toMatchObject({
      totalTasks: 2,
      completionPercentage: 100,
    });
  });

  it("takes the soonest due date from open, non-archived tasks only", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await addColumn(project.id, "wont-do", "cancelled", 4);
    const open = new Date("2026-05-01T00:00:00.000Z");
    await seedTasks(project.id, [
      { status: "done", dueDate: new Date("2026-01-01T00:00:00.000Z") },
      { status: "wont-do", dueDate: new Date("2026-01-02T00:00:00.000Z") },
      {
        status: "to-do",
        archivedAt: new Date(),
        dueDate: new Date("2026-01-03T00:00:00.000Z"),
      },
      { status: "in-review", dueDate: open },
      { status: "planned", dueDate: new Date("2026-06-01T00:00:00.000Z") },
    ]);

    const stats = await statistics(workspace.id, user);
    expect(new Date(stats?.dueDate as string)).toEqual(open);
  });

  it("leaves triage tasks out of every count", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await addColumn(project.id, "triage", "triage", 9);
    await seedTasks(project.id, [
      { status: "triage", dueDate: new Date("2026-01-01T00:00:00.000Z") },
      { status: "done" },
      { status: "to-do" },
    ]);

    const stats = await statistics(workspace.id, user);
    expect(stats).toMatchObject({ totalTasks: 2, completionPercentage: 50 });
    expect(stats?.dueDate).toBeNull();
  });
});
