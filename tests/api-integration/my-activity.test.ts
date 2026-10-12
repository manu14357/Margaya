import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type Page = {
  items: Array<{
    id: string;
    type: string;
    userId: string;
    task: { id: string; key: string; title: string; projectId: string };
  }>;
  nextCursor: string | null;
};

let nextNumber = 1;

async function addTask(projectId: string, status = "to-do") {
  const number = nextNumber++;
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId, title: `Task ${number}`, number, status })
    .returning();
  return task;
}

/** An activity row at an exact instant (microseconds kept). */
async function addActivity(taskId: string, userId: string, at: string) {
  const [row] = await db
    .insert(schema.activityTable)
    .values({
      taskId,
      userId,
      type: "status_changed",
      createdAt: sql`${at}::timestamp`,
    })
    .returning();
  return row;
}

async function scene() {
  const { user: me, workspace } = await createWorkspaceMember();
  const colleague = await addWorkspaceMember(workspace.id);
  const { project } = await createProjectFixture({
    workspaceId: workspace.id,
    slug: "web",
  });
  await db.insert(schema.columnTable).values({
    projectId: project.id,
    name: "Triage",
    slug: "triage",
    position: 99,
    group: "triage",
  });
  const other = await createWorkspaceMember();
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: other.workspace.id,
    userId: me.id,
    role: "member",
    joinedAt: new Date(),
  });
  const { project: otherProject } = await createProjectFixture({
    workspaceId: other.workspace.id,
  });

  const { app } = createApp();
  const get = (query: string, as = me) => {
    mockAuthenticatedSession(as);
    return app.request(`/api/activity/mine?${query}`);
  };
  return { me, colleague, workspace, project, otherProject, get };
}

describe("API integration: the caller's recent activity", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    nextNumber = 1;
  });

  it("lists only the caller's own activity in this workspace, newest first", async () => {
    const { me, colleague, workspace, project, otherProject, get } =
      await scene();
    const task = await addTask(project.id);
    const triage = await addTask(project.id, "triage");
    const elsewhere = await addTask(otherProject.id);

    const older = await addActivity(task.id, me.id, "2026-01-01 09:00:00");
    const newer = await addActivity(task.id, me.id, "2026-01-02 09:00:00");
    await addActivity(task.id, colleague.id, "2026-01-03 09:00:00");
    await addActivity(triage.id, me.id, "2026-01-04 09:00:00");
    await addActivity(elsewhere.id, me.id, "2026-01-05 09:00:00");

    const response = await get(`workspaceId=${workspace.id}`);
    expect(response.status).toBe(200);
    const page = (await response.json()) as Page;

    expect(page.items.map((item) => item.id)).toEqual([newer.id, older.id]);
    expect(page.items[0]).toMatchObject({
      userId: me.id,
      task: {
        id: task.id,
        key: `WEB-${task.number}`,
        title: task.title,
        projectId: project.id,
      },
    });
    expect(page.nextCursor).toBeNull();
  });

  it("walks every row exactly once across pages, even within a millisecond", async () => {
    const { me, workspace, project, get } = await scene();
    const task = await addTask(project.id);
    const instants = [
      "2026-01-01 10:00:00.000100",
      "2026-01-01 10:00:00.000200",
      "2026-01-01 10:00:00.000300",
      "2026-01-01 10:00:00.000300",
      "2026-01-01 10:00:01",
    ];
    for (const at of instants) await addActivity(task.id, me.id, at);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query = `workspaceId=${workspace.id}&limit=2${
        cursor ? `&cursor=${cursor}` : ""
      }`;
      const response = await get(query);
      expect(response.status).toBe(200);
      const page = (await response.json()) as Page;
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);

    const expected = (
      await db.execute<{ id: string }>(
        sql`select id from activity order by created_at desc, id desc`,
      )
    ).rows.map((row) => row.id);
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(instants.length);
  });

  it("refuses a malformed cursor and a workspace the caller is not in", async () => {
    const { workspace, get } = await scene();
    const outsider = await createWorkspaceMember();

    const badCursor = await get(`workspaceId=${workspace.id}&cursor=nope`);
    expect(badCursor.status).toBe(400);
    expect(await badCursor.text()).toBe("Invalid cursor");

    const foreign = await get(`workspaceId=${workspace.id}`, outsider.user);
    expect(foreign.status).toBe(403);
  });
});
