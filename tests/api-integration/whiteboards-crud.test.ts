import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { projectMemberTable } from "../../apps/api/src/database/schema";
import { subscribeToEvent } from "../../apps/api/src/events";
import { runTrashPurge } from "../../apps/api/src/trash/purge-job";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  allowPublicPages,
  boardRow,
  type ContentJson,
  insertTask,
  json,
  setWhiteboardsEnabled,
  sticky,
  taskCard,
  type WhiteboardJson,
  type WhiteboardScene,
  whiteboardScene,
} from "./helpers/whiteboards";

const events: Array<{ name: string; data: Record<string, unknown> }> = [];
for (const name of [
  "whiteboard.created",
  "whiteboard.updated",
  "whiteboard.content_saved",
  "whiteboard.deleted",
  "whiteboard.restored",
]) {
  subscribeToEvent<Record<string, unknown>>(name, async (data) => {
    events.push({ name, data });
  });
}

let s: WhiteboardScene;

beforeEach(async () => {
  await resetTestDatabase();
  events.length = 0;
  s = await whiteboardScene();
});

describe("whiteboard CRUD", () => {
  it("creates, lists, reads, renames and searches boards", async () => {
    const board = await s.create(s.ben, {
      title: "Sprint 12",
      icon: "🎯",
      elements: [sticky("Ship onboarding"), { id: "bad", type: "iframe" }],
    });
    expect(board).toMatchObject({
      title: "Sprint 12",
      icon: "🎯",
      projectId: s.project.id,
      elementCount: 1,
      createdBy: { id: s.ben.id, name: "Ben" },
      capabilities: { canEdit: true, canManage: true, canPublish: false },
    });
    await s.create(s.cara, { title: "Retro" });

    const list = await s.ok<{ whiteboards: WhiteboardJson[] }>(
      s.viewer,
      `/whiteboard?projectId=${s.project.id}`,
    );
    expect(list.whiteboards.map((item) => item.title)).toEqual([
      "Retro",
      "Sprint 12",
    ]);
    // Board text is searchable, and LIKE wildcards are taken literally.
    const found = await s.ok<{ whiteboards: WhiteboardJson[] }>(
      s.viewer,
      `/whiteboard?projectId=${s.project.id}&q=onboard`,
    );
    expect(found.whiteboards.map((item) => item.id)).toEqual([board.id]);
    const wildcard = await s.ok<{ whiteboards: WhiteboardJson[] }>(
      s.viewer,
      `/whiteboard?projectId=${s.project.id}&q=%25`,
    );
    expect(wildcard.whiteboards).toEqual([]);

    const renamed = await s.ok(
      s.cara,
      `/whiteboard/${board.id}`,
      json("PATCH", { title: "Sprint 13", icon: null }),
    );
    expect(renamed).toMatchObject({ title: "Sprint 13", icon: null });
    const bad = await s.call(
      s.cara,
      `/whiteboard/${board.id}`,
      json("PATCH", { icon: "not an emoji" }),
    );
    expect(bad.status).toBe(400);

    const content = await s.content(s.viewer, board.id);
    expect(content.elements).toHaveLength(1);
    expect(content.elements[0]).toMatchObject({ type: "sticky" });
    expect(content.settings).toMatchObject({ background: expect.any(String) });

    expect(events.map((event) => event.name)).toEqual([
      "whiteboard.created",
      "whiteboard.created",
      "whiteboard.updated",
    ]);
    for (const event of events) {
      expect(Object.keys(event.data)).not.toContain("contentText");
      expect(Object.keys(event.data)).not.toContain("elements");
    }
  });

  it("adds elements, skipping invalid ones, and bumps their versions", async () => {
    const board = await s.create(s.ben, { elements: [sticky("first")] });
    const before = await s.content(s.ben, board.id);
    const existing = before.elements[0] as { id: string; version: number };
    const result = await s.ok<{
      elements: Array<{ id: string; version: number; updatedBy: string }>;
      skipped: number;
      contentVersion: number;
    }>(
      s.cara,
      `/whiteboard/${board.id}/elements`,
      json("POST", {
        elements: [
          { ...existing, text: "edited", version: 1 },
          sticky("second"),
          { id: "x", type: "rectangle", x: "nope" },
        ],
      }),
    );
    expect(result.skipped).toBe(1);
    expect(result.elements).toHaveLength(2);
    expect(result.elements[0]?.version).toBeGreaterThan(existing.version);
    expect(result.elements[0]?.updatedBy).toBe(s.cara.id);

    const after = await s.content(s.viewer, board.id);
    expect(after.elements.map((element) => element.text).sort()).toEqual([
      "edited",
      "second",
    ]);
    const row = await boardRow(board.id);
    expect(row?.elementCount).toBe(2);
    expect(row?.contentText).toContain("second");
    expect(row?.updatedById).toBe(s.cara.id);
    expect(
      events.some((event) => event.name === "whiteboard.content_saved"),
    ).toBe(true);
  });

  it("duplicates a board with the client's title", async () => {
    const board = await s.create(s.ben, {
      title: "Map",
      elements: [sticky("a"), sticky("b")],
    });
    const copy = await s.ok(
      s.cara,
      `/whiteboard/${board.id}/duplicate`,
      json("POST", { title: "Map 2" }),
      201,
    );
    expect(copy).toMatchObject({ title: "Map 2", elementCount: 2 });
    expect(copy.id).not.toBe(board.id);
    expect((await s.content(s.cara, copy.id)).elements).toHaveLength(2);
    const noCreate = await s.call(
      s.viewer,
      `/whiteboard/${board.id}/duplicate`,
      json("POST", {}),
    );
    expect(noCreate.status).toBe(403);
  });

  it("serves a safe SVG preview", async () => {
    const board = await s.create(s.ben, {
      elements: [sticky("<script>alert(1)</script>")],
    });
    const response = await s.call(
      s.viewer,
      `/whiteboard/${board.id}/preview.svg`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(response.headers.get("cache-control")).toBe("private, max-age=60");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    const svg = await response.text();
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("<script");
  });
});

describe("whiteboard permissions", () => {
  it("lets viewers read, members edit, and refuses viewers' writes", async () => {
    const board = await s.create(s.ben);
    const viewerCreate = await s.call(
      s.viewer,
      "/whiteboard",
      json("POST", { projectId: s.project.id }),
    );
    expect(viewerCreate.status).toBe(403);
    const viewerBoard = await s.ok(s.viewer, `/whiteboard/${board.id}`);
    expect(viewerBoard.capabilities).toEqual({
      canEdit: false,
      canManage: false,
      canPublish: false,
      canDuplicate: false,
    });
    for (const [path, init] of [
      [`/whiteboard/${board.id}`, json("PATCH", { title: "x" })],
      [
        `/whiteboard/${board.id}/elements`,
        json("POST", { elements: [sticky("x")] }),
      ],
      [`/whiteboard/${board.id}/lock`, { method: "POST" }],
      [`/whiteboard/${board.id}/archive`, { method: "POST" }],
      [`/whiteboard/${board.id}/publication`, { method: "POST" }],
    ] as const) {
      const response = await s.call(s.viewer, path, init);
      expect(response.status, path).toBe(403);
    }
  });

  it("lets a member manage only their own boards, and admins any board", async () => {
    const bens = await s.create(s.ben);
    const cara = await s.call(s.cara, `/whiteboard/${bens.id}/lock`, {
      method: "POST",
    });
    expect(cara.status).toBe(403);
    const own = await s.ok(s.ben, `/whiteboard/${bens.id}/lock`, {
      method: "POST",
    });
    expect(own).toMatchObject({
      isLocked: true,
      lockedBy: { id: s.ben.id, name: "Ben" },
    });
    const unlocked = await s.ok(s.admin, `/whiteboard/${bens.id}/lock`, {
      method: "DELETE",
    });
    expect(unlocked.isLocked).toBe(false);
    // Publishing is for managers: Ben may not, Ada may.
    await allowPublicPages(s.workspaceId, true);
    const benPublish = await s.call(
      s.ben,
      `/whiteboard/${bens.id}/publication`,
      {
        method: "POST",
      },
    );
    expect(benPublish.status).toBe(403);
    await s.ok(s.admin, `/whiteboard/${bens.id}/publication`, {
      method: "POST",
    });
  });

  it("hides the public token from people who can't manage the board", async () => {
    await allowPublicPages(s.workspaceId, true);
    const board = await s.create(s.ben);
    await s.ok(s.admin, `/whiteboard/${board.id}/publication`, {
      method: "POST",
    });
    expect(
      (await s.ok(s.admin, `/whiteboard/${board.id}`)).publicToken,
    ).toEqual(expect.any(String));
    expect(
      (await s.ok(s.cara, `/whiteboard/${board.id}`)).publicToken,
    ).toBeNull();
    expect((await s.ok(s.ben, `/whiteboard/${board.id}`)).publicToken).toEqual(
      expect.any(String),
    );
  });

  it("answers 403 everywhere while the feature is off", async () => {
    const board = await s.create(s.ben);
    await setWhiteboardsEnabled(s.project.id, false);
    for (const path of [
      `/whiteboard?projectId=${s.project.id}`,
      `/whiteboard/${board.id}`,
      `/whiteboard/${board.id}/content`,
      `/whiteboard/${board.id}/preview.svg`,
      `/trash/project/${s.project.id}/whiteboards`,
    ]) {
      const response = await s.call(s.owner, path);
      expect(response.status, path).toBe(403);
    }
    const create = await s.call(
      s.owner,
      "/whiteboard",
      json("POST", { projectId: s.project.id }),
    );
    expect(create.status).toBe(403);
    await setWhiteboardsEnabled(s.project.id, true);
    expect((await s.call(s.owner, `/whiteboard/${board.id}`)).status).toBe(200);
  });

  it("keeps boards inside their workspace", async () => {
    const board = await s.create(s.ben);
    const other = await createWorkspaceMember({ role: "owner" });
    for (const path of [
      `/whiteboard/${board.id}`,
      `/whiteboard/${board.id}/content`,
      `/whiteboard?projectId=${s.project.id}`,
    ]) {
      const response = await s.call(other.user, path);
      expect([403, 404], path).toContain(response.status);
    }
    expect((await s.call(other.user, `/whiteboard/${board.id}`)).status).toBe(
      404,
    );
    // A project of another workspace can't hold a new board of this caller.
    const { project: foreign } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    const create = await s.call(
      s.ben,
      "/whiteboard",
      json("POST", { projectId: foreign.id }),
    );
    expect([403, 404]).toContain(create.status);
  });

  it("hides boards of a restricted project from people outside it", async () => {
    const board = await s.create(s.ben);
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, s.project.id));
    expect((await s.call(s.cara, `/whiteboard/${board.id}`)).status).toBe(404);
    expect(
      (await s.call(s.cara, `/whiteboard?projectId=${s.project.id}`)).status,
    ).toBe(404);
    // Admins still reach restricted projects; project members do too.
    expect((await s.call(s.admin, `/whiteboard/${board.id}`)).status).toBe(200);
    await db.insert(projectMemberTable).values({
      projectId: s.project.id,
      userId: s.cara.id,
      role: "member",
    });
    expect((await s.call(s.cara, `/whiteboard/${board.id}`)).status).toBe(200);
  });
});

describe("whiteboard lock, archive and trash", () => {
  it("makes a locked board read-only and archived boards deletable only", async () => {
    const board = await s.create(s.ben);
    await s.ok(s.ben, `/whiteboard/${board.id}/lock`, { method: "POST" });
    const edit = await s.call(
      s.ben,
      `/whiteboard/${board.id}/elements`,
      json("POST", { elements: [sticky("x")] }),
    );
    expect(edit.status).toBe(409);
    const rename = await s.call(
      s.ben,
      `/whiteboard/${board.id}`,
      json("PATCH", { title: "x" }),
    );
    expect(rename.status).toBe(409);
    await s.ok(s.ben, `/whiteboard/${board.id}/lock`, { method: "DELETE" });

    const early = await s.call(s.ben, `/whiteboard/${board.id}`, {
      method: "DELETE",
    });
    expect(early.status).toBe(409);
    const archived = await s.ok(s.ben, `/whiteboard/${board.id}/archive`, {
      method: "POST",
    });
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.capabilities.canEdit).toBe(false);
    const live = await s.ok<{ whiteboards: WhiteboardJson[] }>(
      s.ben,
      `/whiteboard?projectId=${s.project.id}`,
    );
    expect(live.whiteboards).toEqual([]);
    const archivedList = await s.ok<{ whiteboards: WhiteboardJson[] }>(
      s.ben,
      `/whiteboard?projectId=${s.project.id}&archived=true`,
    );
    expect(archivedList.whiteboards.map((item) => item.id)).toEqual([board.id]);
    await s.ok(s.ben, `/whiteboard/${board.id}/unarchive`, { method: "POST" });
  });

  it("moves boards to the trash, restores them and deletes them for good", async () => {
    const board = await s.create(s.ben, { title: "Old plan" });
    const deleted = await s.trash(s.ben, board.id);
    expect(deleted).toEqual({ id: board.id, projectId: s.project.id });
    expect((await s.call(s.ben, `/whiteboard/${board.id}`)).status).toBe(404);

    const trash = await s.ok<{
      items: Array<{ id: string; title: string; canManage: boolean }>;
    }>(s.cara, `/trash/project/${s.project.id}/whiteboards`);
    expect(trash.items).toEqual([
      expect.objectContaining({
        id: board.id,
        title: "Old plan",
        canManage: false,
      }),
    ]);
    const caraRestore = await s.call(
      s.cara,
      `/trash/whiteboard/${board.id}/restore`,
      { method: "POST" },
    );
    expect(caraRestore.status).toBe(403);
    const restored = await s.ok(
      s.ben,
      `/trash/whiteboard/${board.id}/restore`,
      {
        method: "POST",
      },
    );
    expect(restored.archivedAt).not.toBeNull();
    expect(events.map((event) => event.name)).toContain("whiteboard.restored");

    await s.ok(s.ben, `/whiteboard/${board.id}`, { method: "DELETE" });
    await s.ok(s.admin, `/trash/whiteboard/${board.id}`, { method: "DELETE" });
    expect(await boardRow(board.id)).toBeUndefined();
    expect(
      (
        await s.call(s.admin, `/trash/whiteboard/${board.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
  });

  it("purges boards past the retention period", async () => {
    const old = await s.create(s.ben);
    const recent = await s.create(s.ben);
    await s.trash(s.ben, old.id);
    await s.trash(s.ben, recent.id);
    await db
      .update(schema.whiteboardTable)
      .set({ deletedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.whiteboardTable.id, old.id));
    const outcome = await runTrashPurge(new Date(), undefined, 30);
    expect(outcome.whiteboards).toBe(1);
    expect(await boardRow(old.id)).toBeUndefined();
    expect(await boardRow(recent.id)).toBeDefined();
  });
});

describe("public whiteboards", () => {
  it("publishes a read-only link that shows no editor ids, and revokes it", async () => {
    const task = await insertTask(s.project.id, "Write the spec", 7);
    const board = await s.create(s.ben, {
      title: "Launch",
      elements: [
        sticky("Public note"),
        taskCard(task.id),
        taskCard("elsewhere"),
      ],
    });
    const off = await s.call(s.admin, `/whiteboard/${board.id}/publication`, {
      method: "POST",
    });
    expect(off.status).toBe(409);

    await allowPublicPages(s.workspaceId, true);
    const first = await s.ok<{ publicToken: string }>(
      s.admin,
      `/whiteboard/${board.id}/publication`,
      { method: "POST" },
    );
    const second = await s.ok<{ publicToken: string }>(
      s.admin,
      `/whiteboard/${board.id}/publication`,
      { method: "POST" },
    );
    expect(second.publicToken).not.toBe(first.publicToken);
    expect(
      (await s.app.request(`/api/public-whiteboard/${first.publicToken}`))
        .status,
    ).toBe(404);

    const response = await s.app.request(
      `/api/public-whiteboard/${second.publicToken}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as ContentJson & {
      title: string;
      tasks: Record<string, { key: string; title: string }>;
    };
    expect(body.title).toBe("Launch");
    expect(body.elements).toHaveLength(3);
    for (const element of body.elements) expect(element.updatedBy).toBeNull();
    expect(Object.keys(body.tasks)).toEqual([task.id]);
    expect(body.tasks[task.id]).toMatchObject({ title: "Write the spec" });
    expect(body.tasks[task.id]?.key).toMatch(/-7$/);
    // Public links never show who is assigned, the priority or the due date.
    expect(body.tasks[task.id]).toMatchObject({
      assigneeName: null,
      priority: null,
      dueDate: null,
    });

    // Archiving revokes the link.
    await s.ok(s.ben, `/whiteboard/${board.id}/archive`, { method: "POST" });
    expect(
      (await s.app.request(`/api/public-whiteboard/${second.publicToken}`))
        .status,
    ).toBe(404);
    expect((await boardRow(board.id))?.publicToken).toBeNull();
  });

  it("stops serving once unpublished or the workspace setting is off", async () => {
    await allowPublicPages(s.workspaceId, true);
    const board = await s.create(s.ben);
    const { publicToken } = await s.ok<{ publicToken: string }>(
      s.admin,
      `/whiteboard/${board.id}/publication`,
      { method: "POST" },
    );
    await allowPublicPages(s.workspaceId, false);
    expect(
      (await s.app.request(`/api/public-whiteboard/${publicToken}`)).status,
    ).toBe(404);
    await allowPublicPages(s.workspaceId, true);
    expect(
      (await s.app.request(`/api/public-whiteboard/${publicToken}`)).status,
    ).toBe(200);
    await s.ok(s.admin, `/whiteboard/${board.id}/publication`, {
      method: "DELETE",
    });
    expect(
      (await s.app.request(`/api/public-whiteboard/${publicToken}`)).status,
    ).toBe(404);
    expect(
      (await s.app.request("/api/public-whiteboard/not-a-token")).status,
    ).toBe(404);
  });
});

describe("whiteboard task links", () => {
  it("links the board's own project tasks and lists boards by task", async () => {
    const task = await insertTask(s.project.id, "Design");
    const { project: other } = await createProjectFixture({
      workspaceId: s.workspaceId,
    });
    const foreignTask = await insertTask(other.id, "Elsewhere");
    const board = await s.create(s.ben, {
      title: "Flow",
      elements: [taskCard(task.id), taskCard(foreignTask.id)],
    });
    const links = await db
      .select()
      .from(schema.whiteboardTaskLinkTable)
      .where(eq(schema.whiteboardTaskLinkTable.whiteboardId, board.id));
    expect(links.map((link) => link.taskId)).toEqual([task.id]);

    const byTask = await s.ok<{ whiteboards: WhiteboardJson[] }>(
      s.viewer,
      `/whiteboard/by-task/${task.id}`,
    );
    expect(byTask.whiteboards.map((item) => item.id)).toEqual([board.id]);
    const none = await s.ok<{ whiteboards: WhiteboardJson[] }>(
      s.viewer,
      `/whiteboard/by-task/${foreignTask.id}`,
    );
    expect(none.whiteboards).toEqual([]);

    // Removing the card (a tombstone) drops the link on the next save.
    const content = await s.content(s.ben, board.id);
    const card = content.elements.find((element) => element.taskId === task.id);
    await s.ok(
      s.ben,
      `/whiteboard/${board.id}/elements`,
      json("POST", { elements: [{ ...card, deleted: true }] }),
    );
    const after = await s.ok<{ whiteboards: WhiteboardJson[] }>(
      s.viewer,
      `/whiteboard/by-task/${task.id}`,
    );
    expect(after.whiteboards).toEqual([]);
  });
});
