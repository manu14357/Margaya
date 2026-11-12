import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type CommentPage = {
  items: Array<{ id: string; content: string; parentId: string | null }>;
  nextCursor: string | null;
};

async function seedTask() {
  const member = await createWorkspaceMember();
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Long discussion",
      status: "to-do",
      columnId: columns.todo.id,
      priority: "medium",
      number: 1,
      position: 1,
    })
    .returning();
  return { member, task };
}

describe("API integration: task comment paging", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("pages through every comment once, oldest first, ties included", async () => {
    const { member, task } = await seedTask();
    // Two comments share a timestamp so the id tiebreak is exercised at a
    // page boundary.
    const base = new Date("2026-01-01T10:00:00.000Z").getTime();
    const times = [0, 1000, 1000, 2000, 3000];
    const inserted = await db
      .insert(schema.activityTable)
      .values(
        times.map((offset, index) => ({
          taskId: task.id,
          type: "comment",
          userId: member.user.id,
          content: `comment ${index}`,
          createdAt: new Date(base + offset),
        })),
      )
      .returning();
    // A system event is not a comment and must not appear.
    await db.insert(schema.activityTable).values({
      taskId: task.id,
      type: "status_changed",
      userId: member.user.id,
      content: "moved",
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor
        ? `?limit=2&cursor=${encodeURIComponent(cursor)}`
        : "?limit=2";
      const response = await app.request(
        `/api/comment/${task.id}/page${query}`,
      );
      expect(response.status).toBe(200);
      const page = (await response.json()) as CommentPage;
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(inserted.length);

    // Matches the unpaged list, which stays a plain array.
    const full = await app.request(`/api/comment/${task.id}`);
    expect(full.status).toBe(200);
    const all = (await full.json()) as Array<{ id: string }>;
    expect(Array.isArray(all)).toBe(true);
    expect(all.map((item) => item.id)).toEqual(seen);
  });

  it("returns a single page with no cursor when everything fits", async () => {
    const { member, task } = await seedTask();
    await db.insert(schema.activityTable).values({
      taskId: task.id,
      type: "comment",
      userId: member.user.id,
      content: "only one",
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await app.request(`/api/comment/${task.id}/page`);
    expect(response.status).toBe(200);
    const page = (await response.json()) as CommentPage;
    expect(page.items.map((item) => item.content)).toEqual(["only one"]);
    expect(page.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor and an out-of-range limit", async () => {
    const { member, task } = await seedTask();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const badCursor = await app.request(
      `/api/comment/${task.id}/page?cursor=not-a-cursor`,
    );
    expect(badCursor.status).toBe(400);

    const badLimit = await app.request(
      `/api/comment/${task.id}/page?limit=500`,
    );
    expect(badLimit.status).toBe(400);
  });

  it("keeps another workspace's member out", async () => {
    const { task } = await seedTask();
    const outsider = await createWorkspaceMember();
    mockAuthenticatedSession(outsider.user);
    const { app } = createApp();

    const response = await app.request(`/api/comment/${task.id}/page`);
    expect([403, 404]).toContain(response.status);
  });
});
