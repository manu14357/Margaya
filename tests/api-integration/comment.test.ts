import { and, eq } from "drizzle-orm";
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

describe("API integration: task comments", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("shares comments between the activity UI and comment API", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Shared comments",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: 1,
        position: 1,
      })
      .returning();

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const formattedComment =
      "First paragraph\n\n\n\n- List item\n\n\n\nAfter list";
    const uiResponse = await app.request("/api/activity/comment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: task.id, comment: formattedComment }),
    });
    expect(uiResponse.status).toBe(200);

    const commentApiResponse = await app.request(`/api/comment/${task.id}`);
    expect(commentApiResponse.status).toBe(200);
    await expect(commentApiResponse.json()).resolves.toEqual([
      expect.objectContaining({
        content: formattedComment,
        taskId: task.id,
      }),
    ]);

    const mcpResponse = await app.request(`/api/comment/${task.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Created through MCP" }),
    });
    expect(mcpResponse.status).toBe(200);

    const activityResponse = await app.request(`/api/activity/${task.id}`);
    expect(activityResponse.status).toBe(200);
    const activities = (await activityResponse.json()) as Array<{
      content: string;
      type: string;
    }>;
    expect(activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: formattedComment,
          type: "comment",
        }),
        expect.objectContaining({
          content: "Created through MCP",
          type: "comment",
        }),
      ]),
    );

    const storedComments = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.taskId, task.id),
          eq(schema.activityTable.type, "comment"),
        ),
      );
    expect(storedComments).toHaveLength(2);

    const legacyComments = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.taskId, task.id));
    expect(legacyComments).toHaveLength(0);
  });

  it.each([
    { length: 10_000, status: 200 },
    { length: 10_001, status: 400 },
  ])(
    "returns $status when creating a $length-character comment",
    async ({ length, status }) => {
      const member = await createWorkspaceMember();
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const [task] = await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Comment length limit",
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning();

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const comment = "x".repeat(length);
      const response = await app.request("/api/activity/comment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: task.id, comment }),
      });

      expect(response.status).toBe(status);
    },
  );

  it.each([
    { length: 10_000, status: 200 },
    { length: 10_001, status: 400 },
  ])(
    "returns $status when updating a $length-character comment",
    async ({ length, status }) => {
      const member = await createWorkspaceMember();
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const [task] = await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Comment length limit",
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning();
      mockAuthenticatedSession(member.user);
      const { app } = createApp();
      const createResponse = await app.request("/api/activity/comment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: task.id, comment: "Short comment" }),
      });
      expect(createResponse.status).toBe(200);
      const createdComment = (await createResponse.json()) as { id: string };
      const comment = "x".repeat(length);

      const response = await app.request("/api/activity/comment", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activityId: createdComment.id,
          comment,
        }),
      });

      expect(response.status).toBe(status);
    },
  );

  it("rejects comments through the generic activity endpoint", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Generic comment activity",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: 1,
        position: 1,
      })
      .returning();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/activity/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: task.id,
        userId: member.user.id,
        message: "Comment through generic endpoint",
        type: "comment",
      }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      message: "Use the comment endpoint to create comments",
    });
  });

  it("records an external author for an authorized workspace administrator", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Imported",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: 1,
        position: 1,
      })
      .returning();

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const attributed = await app.request(`/api/comment/${task.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "From Trello",
        externalUserName: "Sam",
        externalSource: "trello",
      }),
    });
    expect(attributed.status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.taskId, task.id));
    expect(row?.externalUserName).toBe("Sam");
    expect(row?.externalSource).toBe("trello");
  });

  it("ignores an external name with no source, so it cannot look like a real user", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Unattributed",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: 1,
        position: 1,
      })
      .returning();

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    await app.request(`/api/comment/${task.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Nice try", externalUserName: "Jordan" }),
    });

    const [row] = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.taskId, task.id));
    expect(row?.externalUserName).toBeNull();
  });

  it("rejects an unknown external source", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Bad source",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: 1,
        position: 1,
      })
      .returning();

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(`/api/comment/${task.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "Spoof",
        externalUserName: "Jordan",
        externalSource: "definitely-real",
      }),
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("answers 403 for someone else's visible comment and 404 for a missing one", async () => {
    const author = await createWorkspaceMember();
    const admin = await addWorkspaceMember(author.workspace.id, "admin");
    const { project, columns } = await createProjectFixture({
      workspaceId: author.workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Someone else's comment",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: 1,
        position: 1,
      })
      .returning();
    const [comment] = await db
      .insert(schema.activityTable)
      .values({
        taskId: task.id,
        type: "comment",
        userId: author.user.id,
        content: "Mine",
      })
      .returning();
    const [statusChange] = await db
      .insert(schema.activityTable)
      .values({ taskId: task.id, type: "status_changed", userId: admin.id })
      .returning();

    mockAuthenticatedSession(admin);
    const { app } = createApp();
    const send = (method: string, path: string, body?: object) =>
      app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });

    const attempts = [
      await send("PUT", `/api/comment/${comment.id}`, { content: "Theirs" }),
      await send("DELETE", `/api/comment/${comment.id}`),
      await send("PUT", "/api/activity/comment", {
        activityId: comment.id,
        comment: "Theirs",
      }),
      await send("DELETE", "/api/activity/comment", {
        activityId: comment.id,
      }),
    ];
    for (const response of attempts) {
      expect(response.status).toBe(403);
      expect(await response.text()).toMatch(/^Only the comment's author can/);
    }
    const [unchanged] = await db
      .select({ content: schema.activityTable.content })
      .from(schema.activityTable)
      .where(eq(schema.activityTable.id, comment.id));
    expect(unchanged?.content).toBe("Mine");

    // Visible, but not a comment.
    const notComment = await send("PUT", "/api/activity/comment", {
      activityId: statusChange.id,
      comment: "Edited",
    });
    expect(notComment.status).toBe(404);
    expect(await notComment.text()).toBe("Comment not found");
  });
});
