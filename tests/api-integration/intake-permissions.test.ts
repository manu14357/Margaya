import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { addPerson } from "./helpers/assignees";
import { resetTestDatabase } from "./helpers/database";
import {
  apiKeyFor,
  clearPublishedEvents,
  intakeRow,
  intakeScene,
  json,
  publishedEvents,
  recordEvents,
  setIntakeEnabled,
  settle,
  taskRow,
} from "./helpers/intake";

recordEvents("task.deleted", "intake.item_deleted");

const FEATURE_OFF = "The Intake feature is turned off for this project.";

describe("API integration: intake permissions", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    clearPublishedEvents();
  });

  it("lets viewers file and follow requests but not triage", async () => {
    const scene = await intakeScene();
    const others = await scene.submit(scene.member, { title: "Member's" });
    const own = await scene.submit(scene.viewer, { title: "Viewer's" });

    const list = await scene.list(scene.viewer);
    expect(list.items.map((i) => i.id).sort()).toEqual(
      [others.id, own.id].sort(),
    );

    for (const [name, payload] of [
      ["accept", { status: "to-do" }],
      ["decline", {}],
      ["snooze", { until: new Date(Date.now() + 86_400_000).toISOString() }],
      ["unsnooze", undefined],
      ["duplicate", { duplicateOfTaskId: "x" }],
      ["reopen", undefined],
    ] as const) {
      const response = await scene.action(scene.viewer, own.id, name, payload);
      expect(response.status, name).toBe(403);
      expect(await response.text()).toBe("Insufficient permissions");
    }

    const edit = await scene.as(scene.viewer)(
      `/intake/item/${own.id}`,
      json("PATCH", { title: "Viewer's, clarified" }),
    );
    expect(edit.status).toBe(200);

    const foreign = await scene.as(scene.viewer)(`/intake/item/${others.id}`, {
      method: "DELETE",
    });
    expect(foreign.status).toBe(403);
    expect(await foreign.text()).toBe(
      "Only admins or the requester can delete this request",
    );

    const withdraw = await scene.as(scene.viewer)(`/intake/item/${own.id}`, {
      method: "DELETE",
    });
    expect(withdraw.status).toBe(200);
    expect(await withdraw.json()).toEqual({
      id: own.id,
      taskId: own.taskId,
      projectId: scene.project.id,
    });
    expect(await intakeRow(own.id)).toBeNull();
    expect(await taskRow(own.taskId)).toBeNull();
  });

  it("stops withdrawing once the request is decided", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer);
    await scene.action(scene.member, item.id, "decline");
    const response = await scene.as(scene.viewer)(`/intake/item/${item.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(403);
  });

  it("limits requester-only roles to their own requests", async () => {
    const scene = await intakeScene();
    const requester = await addPerson(scene.workspace.id, "Rae", "requester");
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: scene.workspace.id,
      role: "requester",
      permission: JSON.stringify({
        project: ["read"],
        task: ["read"],
        intake: ["create"],
      }),
    });
    const others = await scene.submit(scene.member);
    const own = await scene.submit(requester);

    const list = await scene.list(requester);
    expect(list.items.map((i) => i.id)).toEqual([own.id]);
    expect(list.counts).toMatchObject({ pending: 1 });
    const filtered = await scene.list(
      requester,
      `submittedBy=${scene.member.id}`,
    );
    expect(filtered.items).toEqual([]);
    expect(filtered.total).toBe(0);

    expect(
      (await scene.as(requester)(`/intake/item/${others.id}`)).status,
    ).toBe(404);
    expect((await scene.as(requester)(`/intake/item/${own.id}`)).status).toBe(
      200,
    );
    expect(
      (await scene.as(requester)(`/intake/task/${others.taskId}`)).status,
    ).toBe(404);
    expect(
      (await scene.as(requester)(`/intake/project/${scene.project.id}/summary`))
        .status,
    ).toBe(403);
  });

  it("refuses roles without intake permissions", async () => {
    const scene = await intakeScene();
    const reader = await addPerson(scene.workspace.id, "Rex", "reader");
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: scene.workspace.id,
      role: "reader",
      permission: JSON.stringify({ project: ["read"], task: ["read"] }),
    });
    const list = await scene.as(reader)(`/intake/project/${scene.project.id}`);
    expect(list.status).toBe(403);
    expect(await list.text()).toBe("You don't have access to intake");
    const create = await scene.as(reader)(
      `/intake/project/${scene.project.id}`,
      json("POST", { title: "Nope" }),
    );
    expect(create.status).toBe(403);
  });

  it("lets members triage but only task:delete deletes others' requests", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer);
    const memberDelete = await scene.as(scene.member)(
      `/intake/item/${item.id}`,
      { method: "DELETE" },
    );
    expect(memberDelete.status).toBe(403);

    await scene.action(scene.member, item.id, "decline");
    const adminDelete = await scene.as(scene.admin)(`/intake/item/${item.id}`, {
      method: "DELETE",
    });
    expect(adminDelete.status).toBe(200);
    expect(await taskRow(item.taskId)).toBeNull();
    await settle();
    expect(publishedEvents("task.deleted")[0]?.data).toMatchObject({
      taskId: item.taskId,
      userId: scene.admin.id,
    });
    expect(publishedEvents("intake.item_deleted")[0]?.data).toMatchObject({
      intakeItemId: item.id,
      taskId: item.taskId,
      projectId: scene.project.id,
      workspaceId: scene.workspace.id,
      userId: scene.admin.id,
    });

    const accepted = await scene.submit(scene.viewer);
    await scene.action(scene.member, accepted.id, "accept", {
      status: "to-do",
    });
    const refused = await scene.as(scene.admin)(`/intake/item/${accepted.id}`, {
      method: "DELETE",
    });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toBe(
      "Accepted requests are tasks now. Delete the task instead.",
    );
  });

  it("keeps requests inside their workspace", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer);
    const outsider = scene.as(scene.outsider);
    expect((await outsider(`/intake/project/${scene.project.id}`)).status).toBe(
      403,
    );
    expect(
      (
        await outsider(
          `/intake/project/${scene.project.id}`,
          json("POST", { title: "x" }),
        )
      ).status,
    ).toBe(403);
    expect((await outsider(`/intake/item/${item.id}`)).status).toBe(403);
    expect((await outsider(`/intake/task/${item.taskId}`)).status).toBe(403);
    expect(
      (await scene.action(scene.outsider, item.id, "decline", {})).status,
    ).toBe(403);
  });

  it("answers 403 on every route while the feature is off, keeping data", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer);
    await setIntakeEnabled(scene.project.id, false);

    const admin = scene.as(scene.admin);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const requests: Array<[string, () => Promise<Response>]> = [
      ["list", () => admin(`/intake/project/${scene.project.id}`)],
      ["summary", () => admin(`/intake/project/${scene.project.id}/summary`)],
      [
        "create",
        () =>
          admin(
            `/intake/project/${scene.project.id}`,
            json("POST", { title: "x" }),
          ),
      ],
      ["get", () => admin(`/intake/item/${item.id}`)],
      ["byTask", () => admin(`/intake/task/${item.taskId}`)],
      [
        "update",
        () => admin(`/intake/item/${item.id}`, json("PATCH", { title: "y" })),
      ],
      [
        "accept",
        () => scene.action(scene.admin, item.id, "accept", { status: "to-do" }),
      ],
      ["decline", () => scene.action(scene.admin, item.id, "decline", {})],
      [
        "snooze",
        () => scene.action(scene.admin, item.id, "snooze", { until: future }),
      ],
      ["unsnooze", () => scene.action(scene.admin, item.id, "unsnooze")],
      [
        "duplicate",
        () =>
          scene.action(scene.admin, item.id, "duplicate", {
            duplicateOfTaskId: "x",
          }),
      ],
      ["reopen", () => scene.action(scene.admin, item.id, "reopen")],
      ["delete", () => admin(`/intake/item/${item.id}`, { method: "DELETE" })],
    ];
    for (const [name, request] of requests) {
      const response = await request();
      expect(response.status, name).toBe(403);
      expect(await response.text(), name).toBe(FEATURE_OFF);
    }

    await setIntakeEnabled(scene.project.id, true);
    const list = await scene.list(scene.admin);
    expect(list.items.map((i) => i.id)).toEqual([item.id]);
    expect(list.items[0]?.task.title).toBe(item.task.title);
  });

  it("honors API key scopes", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer);
    const headers = await apiKeyFor(scene.admin, {
      project: ["read"],
      task: ["read", "update", "delete"],
      intake: ["create", "read"],
    });
    const list = await scene.app.request(
      `/api/intake/project/${scene.project.id}`,
      { headers },
    );
    expect(list.status).toBe(200);
    const accept = await scene.app.request(
      `/api/intake/item/${item.id}/accept`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ status: "to-do" }),
      },
    );
    expect(accept.status).toBe(403);
    expect(await accept.text()).toBe("Insufficient API key scope");

    // A read-only key of the requester can't edit through the requester path.
    const readOnly = await apiKeyFor(scene.viewer, {
      project: ["read"],
      intake: ["read"],
    });
    const edit = await scene.app.request(`/api/intake/item/${item.id}`, {
      method: "PATCH",
      headers: { ...readOnly, "content-type": "application/json" },
      body: JSON.stringify({ title: "Sneaky" }),
    });
    expect(edit.status).toBe(403);
    expect((await taskRow(item.taskId))?.title).toBe(item.task.title);
  });
});

describe("API integration: intake data lifecycle", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("removes requests with their task and keeps them when the user leaves", async () => {
    const scene = await intakeScene();
    const item = await scene.submit(scene.viewer);
    await db
      .delete(schema.userTable)
      .where(eq(schema.userTable.id, scene.viewer.id));
    const get = await scene.as(scene.admin)(`/intake/item/${item.id}`);
    expect(get.status).toBe(200);
    expect(
      ((await get.json()) as { submittedBy: unknown }).submittedBy,
    ).toBeNull();

    const response = await scene.as(scene.admin)(`/task/${item.taskId}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    expect(await intakeRow(item.id)).toBeNull();
  });
});
