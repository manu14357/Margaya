import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { getDatabase, schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { runTaskQuery } from "../../apps/api/src/task-query";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { json, queryScene } from "./helpers/task-query";

describe("API integration: task query access and boundaries", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("refuses scope projects of another workspace", async () => {
    const s = await queryScene();
    const other = await createWorkspaceMember();
    const { project: foreign } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    await s.refuse(
      { scope: { projectIds: [s.project.id, foreign.id] } },
      404,
      "Project not found",
    );
    await s.refuse(
      { scope: { projectIds: ["project-missing"] } },
      404,
      "Project not found",
    );
  });

  it("never returns another workspace's tasks, even through a parent id", async () => {
    const s = await queryScene();
    const other = await createWorkspaceMember();
    const { project: foreign, columns } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    const [foreignParent, foreignChild] = await db
      .insert(schema.taskTable)
      .values([
        {
          projectId: foreign.id,
          title: "P",
          number: 1,
          status: "to-do",
          columnId: columns.todo.id,
        },
        {
          projectId: foreign.id,
          title: "C",
          number: 2,
          status: "to-do",
          columnId: columns.todo.id,
        },
      ])
      .returning();
    const mine = await s.createTask();
    // A legacy cross-workspace relation must not leak either side.
    await db.insert(schema.taskRelationTable).values([
      {
        sourceTaskId: foreignParent?.id ?? "",
        targetTaskId: foreignChild?.id ?? "",
        relationType: "subtask",
      },
      {
        sourceTaskId: foreignParent?.id ?? "",
        targetTaskId: mine.id,
        relationType: "subtask",
      },
    ]);

    const result = await s.query({
      filters: {
        key: "parent",
        operator: "in",
        values: [foreignParent?.id ?? ""],
      },
      include: ["subTasks"],
    });
    expect(Object.keys(result.tasks)).toEqual([mine.id]);
    expect((await s.query({ mode: "ids" })).ids).toEqual([mine.id]);
  });

  it("searches only non-archived projects unless they are listed", async () => {
    const s = await queryScene();
    const archivedProject = await s.createProject("old");
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, archivedProject.id));
    const live = await s.createTask();
    const buried = await s.createTask({ projectId: archivedProject.id });

    expect(await s.ids(null)).toEqual([live.id]);
    expect(
      await s.ids(null, { scope: { projectIds: [archivedProject.id] } }),
    ).toEqual([buried.id]);
  });

  it("lets every workspace role read, and nobody else", async () => {
    const s = await queryScene();
    await s.createTask();
    expect((await s.query({ mode: "ids" }, s.viewer)).ids).toHaveLength(1);

    const outsider = await createWorkspaceMember();
    const denied = await s.request({ mode: "ids" }, outsider.user);
    expect(denied.status).toBe(403);

    mockAnonymousSession();
    const anonymous = await s.app.request(
      "/api/task-query",
      json("POST", { workspaceId: s.workspaceId }),
    );
    expect(anonymous.status).toBe(401);
  });

  it("needs task:read on custom roles and API keys", async () => {
    const s = await queryScene();
    await s.createTask();
    const [limited] = await db
      .insert(schema.userTable)
      .values({
        id: `user-${randomUUID()}`,
        email: `${randomUUID()}@example.com`,
        name: "Lim",
      })
      .returning();
    if (!limited) throw new Error("user");
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: s.workspaceId,
      userId: limited.id,
      role: "outsider-role",
      joinedAt: new Date(),
    });
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: s.workspaceId,
      role: "outsider-role",
      permission: JSON.stringify({ project: ["read"] }),
    });
    const noRead = await s.request({ mode: "ids" }, limited);
    expect(noRead.status).toBe(403);
    expect(await noRead.text()).toBe("Insufficient permissions");

    mockAnonymousSession();
    const keyFor = async (permissions: Record<string, string[]>) => {
      const key = `margaya_test_${randomUUID()}`;
      await db.insert(schema.apikeyTable).values({
        referenceId: s.owner.id,
        userId: s.owner.id,
        key: createHash("sha256").update(key).digest("base64url"),
        name: "reader",
        createdAt: new Date(),
        updatedAt: new Date(),
        permissions: JSON.stringify(permissions),
        enabled: true,
      });
      return key;
    };
    const { app } = createApp();
    const call = (key: string) =>
      app.request("/api/task-query", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          workspaceId: s.workspaceId,
          mode: "ids",
          filters: { key: "assignee", operator: "in", values: ["none"] },
        }),
      });
    const reader = await call(await keyFor({ task: ["read"] }));
    expect(reader.status).toBe(200);
    expect(((await reader.json()) as { ids: string[] }).ids).toHaveLength(1);
    const writerOnly = await call(await keyFor({ project: ["read"] }));
    expect(writerOnly.status).toBe(403);
    expect(await writerOnly.text()).toBe("Insufficient API key scope");
  });

  it("maps the statement timeout to 503", async () => {
    const s = await queryScene();
    const timeout = Object.assign(
      new Error("canceling statement due to statement timeout"),
      { code: "57014" },
    );
    // db is a lazy proxy; stub the instance behind it.
    vi.spyOn(getDatabase(), "transaction").mockRejectedValueOnce(timeout);
    await s.refuse(
      { mode: "ids" },
      503,
      "Task query took too long; narrow the filters and retry",
    );
  });

  it("refuses bodies above 32 KB", async () => {
    const s = await queryScene();
    mockAuthenticatedSession(s.owner);
    const response = await s.app.request(
      "/api/task-query",
      json("POST", { workspaceId: s.workspaceId, search: "x".repeat(40_000) }),
    );
    expect(response.status).toBe(413);
  });

  it("refuses personal keys and user groups in a public context", async () => {
    const s = await queryScene();
    await s.createTask({ assignees: [s.ben.id], createdBy: s.owner.id });
    const caller = {
      workspaceId: s.workspaceId,
      userId: "",
      publicContext: true,
    };
    const expectRefusal = async (request: object, message: string) => {
      const error = await runTaskQuery(
        { workspaceId: s.workspaceId, ...request },
        caller,
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).message).toBe(message);
    };
    await expectRefusal(
      { filters: { key: "createdBy", operator: "in", values: [s.owner.id] } },
      "Unsupported filter: createdBy",
    );
    await expectRefusal(
      { filters: { key: "assignee", operator: "in", values: ["me"] } },
      "Unsupported value for assignee: me",
    );
    await expectRefusal(
      { display: { groupBy: "assignee" } },
      "Unsupported group: assignee",
    );
    const result = await runTaskQuery(
      { workspaceId: s.workspaceId, include: ["assignees"] },
      caller,
    );
    expect(Object.keys(result.tasks)).toHaveLength(1);
    expect(result.meta.users).toEqual([]);
  });
});
