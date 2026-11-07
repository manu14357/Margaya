import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

async function seedTask(projectId: string, number: number, archived = false) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title: `Task ${number}`,
      number,
      archivedAt: archived ? new Date() : null,
    })
    .returning();
  return task;
}

async function relate(
  sourceTaskId: string,
  targetTaskId: string,
  relationType: string,
  createdAt = new Date(),
) {
  const [relation] = await db
    .insert(schema.taskRelationTable)
    .values({ sourceTaskId, targetTaskId, relationType, createdAt })
    .returning();
  return relation;
}

function list(projectId: string) {
  return createApp().app.request(`/api/task-relation/project/${projectId}`, {
    method: "GET",
  });
}

describe("GET /task-relation/project/{projectId}", () => {
  it("lists only date-ordering relations between the project's live tasks", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const { project: other } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const a = await seedTask(project.id, 1);
    const b = await seedTask(project.id, 2);
    const c = await seedTask(project.id, 3);
    const archived = await seedTask(project.id, 4, true);
    const elsewhere = await seedTask(other.id, 1);

    const blocks = await relate(a.id, b.id, "blocks", new Date(2026, 0, 1));
    const startBefore = await relate(
      b.id,
      c.id,
      "start_before",
      new Date(2026, 0, 2),
    );
    const finishBefore = await relate(
      a.id,
      c.id,
      "finish_before",
      new Date(2026, 0, 3),
    );
    await relate(c.id, a.id, "related");
    await relate(a.id, b.id, "subtask");
    await relate(a.id, archived.id, "blocks");
    await relate(a.id, elsewhere.id, "blocks");

    mockAuthenticatedSession(member.user);
    const response = await list(project.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      relations: [
        {
          id: blocks.id,
          sourceTaskId: a.id,
          targetTaskId: b.id,
          relationType: "blocks",
        },
        {
          id: startBefore.id,
          sourceTaskId: b.id,
          targetTaskId: c.id,
          relationType: "start_before",
        },
        {
          id: finishBefore.id,
          sourceTaskId: a.id,
          targetTaskId: c.id,
          relationType: "finish_before",
        },
      ],
      truncated: false,
      blockedTaskIds: [b.id],
    });
  });

  it("names blocked tasks whose blocker is in another project", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const { project: other } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const blocked = await seedTask(project.id, 1);
    const free = await seedTask(project.id, 2);
    const blocker = await seedTask(other.id, 1);
    await relate(blocker.id, blocked.id, "blocks");
    await relate(free.id, blocker.id, "blocks");

    mockAuthenticatedSession(member.user);
    const response = await list(project.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      relations: [],
      truncated: false,
      blockedTaskIds: [blocked.id],
    });
  });

  it("refuses a member of another workspace", async () => {
    const owner = await createWorkspaceMember();
    const outsider = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const a = await seedTask(project.id, 1);
    const b = await seedTask(project.id, 2);
    await relate(a.id, b.id, "blocks");

    mockAuthenticatedSession(outsider.user);
    const response = await list(project.id);
    expect(response.status).toBe(403);
  });
});
