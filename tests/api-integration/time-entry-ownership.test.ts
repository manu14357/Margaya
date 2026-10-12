import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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

type User = typeof schema.userTable.$inferSelect;

async function scene() {
  const { user: owner, workspace } = await createWorkspaceMember({
    role: "owner",
  });
  const author = await addWorkspaceMember(workspace.id, "member");
  const colleague = await addWorkspaceMember(workspace.id, "member");
  const admin = await addWorkspaceMember(workspace.id, "admin");
  const { user: outsider } = await createWorkspaceMember({ role: "owner" });
  const { project, columns } = await createProjectFixture({
    workspaceId: workspace.id,
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Tracked task",
      status: "to-do",
      columnId: columns.todo.id,
      priority: "low",
      number: 1,
      position: 1,
    })
    .returning();

  const logTime = async (userId: string) => {
    const [entry] = await db
      .insert(schema.timeEntryTable)
      .values({
        id: randomUUID(),
        taskId: task.id,
        userId,
        description: "",
        startTime: new Date("2026-01-01T09:00:00Z"),
        endTime: new Date("2026-01-01T10:00:00Z"),
        duration: 3600,
      })
      .returning();
    return entry;
  };

  const { app } = createApp();
  const remove = (as: User, id: string) => {
    mockAuthenticatedSession(as);
    return app.request(`/api/time-entry/${id}`, { method: "DELETE" });
  };
  const update = (as: User, id: string, description: string) => {
    mockAuthenticatedSession(as);
    return app.request(`/api/time-entry/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        startTime: "2026-01-01T09:00:00Z",
        endTime: "2026-01-01T11:00:00Z",
        description,
      }),
    });
  };
  const descriptionOf = async (id: string) =>
    (
      await db
        .select({ description: schema.timeEntryTable.description })
        .from(schema.timeEntryTable)
        .where(eq(schema.timeEntryTable.id, id))
    )[0]?.description;
  const exists = async (id: string) =>
    (
      await db
        .select({ id: schema.timeEntryTable.id })
        .from(schema.timeEntryTable)
        .where(eq(schema.timeEntryTable.id, id))
    ).length === 1;

  return {
    owner,
    author,
    colleague,
    admin,
    outsider,
    project,
    logTime,
    remove,
    update,
    descriptionOf,
    exists,
  };
}

describe("API integration: deleting a time entry", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lets the author delete their own entry, once", async () => {
    const { author, logTime, remove, exists } = await scene();
    const entry = await logTime(author.id);

    const response = await remove(author, entry.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: entry.id,
      userId: author.id,
    });
    expect(await exists(entry.id)).toBe(false);

    const again = await remove(author, entry.id);
    expect(again.status).toBe(404);
    expect(await again.text()).toBe("Time entry not found");
  });

  it("answers 403 to a member deleting someone else's entry", async () => {
    const { author, colleague, logTime, remove, exists } = await scene();
    const entry = await logTime(author.id);

    const response = await remove(colleague, entry.id);

    expect(response.status).toBe(403);
    expect(await exists(entry.id)).toBe(true);
  });

  it("lets admins and owners delete anyone's entry", async () => {
    const { author, admin, owner, logTime, remove, exists } = await scene();
    const first = await logTime(author.id);
    const second = await logTime(author.id);

    expect((await remove(admin, first.id)).status).toBe(200);
    expect((await remove(owner, second.id)).status).toBe(200);
    expect(await exists(first.id)).toBe(false);
    expect(await exists(second.id)).toBe(false);
  });

  it("answers 404 for an unknown entry or one in another workspace", async () => {
    const { author, outsider, logTime, remove, exists } = await scene();
    const entry = await logTime(author.id);

    const foreign = await remove(outsider, entry.id);
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).toBe("Time entry not found");
    expect(await exists(entry.id)).toBe(true);

    expect((await remove(author, "no-such-entry")).status).toBe(404);
  });

  it("answers 403 while time tracking is off for the project", async () => {
    const { author, project, logTime, remove, exists } = await scene();
    const entry = await logTime(author.id);
    await db
      .update(schema.projectTable)
      .set({ timeTrackingEnabled: false })
      .where(eq(schema.projectTable.id, project.id));

    expect((await remove(author, entry.id)).status).toBe(403);
    expect(await exists(entry.id)).toBe(true);
  });
});

describe("API integration: updating a time entry", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lets the author change their own entry", async () => {
    const { author, logTime, update, descriptionOf } = await scene();
    const entry = await logTime(author.id);

    const response = await update(author, entry.id, "Pairing");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ duration: 7200 });
    expect(await descriptionOf(entry.id)).toBe("Pairing");
  });

  it("answers 403 to a member changing someone else's entry", async () => {
    const { author, colleague, logTime, update, descriptionOf } = await scene();
    const entry = await logTime(author.id);

    const response = await update(colleague, entry.id, "Not mine");

    expect(response.status).toBe(403);
    expect(await descriptionOf(entry.id)).toBe("");
  });

  it("lets admins change anyone's entry", async () => {
    const { author, admin, logTime, update, descriptionOf } = await scene();
    const entry = await logTime(author.id);

    expect((await update(admin, entry.id, "Corrected")).status).toBe(200);
    expect(await descriptionOf(entry.id)).toBe("Corrected");
  });

  it("answers 404 for an unknown entry or one in another workspace", async () => {
    const { author, outsider, logTime, update, descriptionOf } = await scene();
    const entry = await logTime(author.id);

    expect((await update(outsider, entry.id, "Foreign")).status).toBe(404);
    expect((await update(author, "no-such-entry", "Missing")).status).toBe(404);
    expect(await descriptionOf(entry.id)).toBe("");
  });
});
