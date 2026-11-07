import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { runTrashPurge } from "../../apps/api/src/trash/purge-job";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  clearPageEvents,
  json,
  pageEvents,
  pageRow,
  pageScene,
  recordPageEvents,
} from "./helpers/pages";

type TrashList = {
  items: Array<{
    id: string;
    title: string;
    canManage: boolean;
    deletedBy: { id: string; name: string } | null;
    purgeAt: string | null;
  }>;
  total: number;
};

/** Sends a /api/trash request as the given user. */
function trashCall(
  s: Awaited<ReturnType<typeof pageScene>>,
  user: Parameters<typeof s.call>[0],
  path: string,
  init?: RequestInit,
) {
  mockAuthenticatedSession(user);
  return s.app.request(`/api/trash${path}`, init);
}

async function archivedPage(
  s: Awaited<ReturnType<typeof pageScene>>,
  user: Parameters<typeof s.call>[0],
  body: Record<string, unknown> = {},
) {
  const page = await s.create(user, body);
  await s.ok(user, `/${page.id}/archive`, { method: "POST" });
  return page;
}

async function trashedPage(
  s: Awaited<ReturnType<typeof pageScene>>,
  user: Parameters<typeof s.call>[0],
  body: Record<string, unknown> = {},
) {
  const page = await archivedPage(s, user, body);
  await s.ok(user, `/${page.id}`, { method: "DELETE" });
  return page;
}

describe("API integration: page trash", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    recordPageEvents("page.deleted", "page.restored", "page.purged");
    clearPageEvents();
  });

  it("moves a deleted page to the trash and hides it everywhere", async () => {
    const s = await pageScene();
    const parent = await s.create(s.ben, { title: "Parent" });
    const page = await s.create(s.ben, {
      title: "Doc",
      parentId: parent.id,
      content: "keep me",
    });
    const child = await s.create(s.ben, { title: "Kid", parentId: page.id });
    await s.ok(s.ben, `/${page.id}/archive`, { method: "POST" });

    const deleted = await s.ok<{ id: string; projectId: string }>(
      s.ben,
      `/${page.id}`,
      { method: "DELETE" },
    );
    expect(deleted).toEqual({ id: page.id, projectId: s.project.id });

    const row = await pageRow(page.id);
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.deletedById).toBe(s.ben.id);
    expect(row?.parentId).toBeNull();
    expect(row?.contentMarkdown).toContain("keep me");
    // Its sub-pages may be someone else's, so they stay, at the top level.
    const childRow = await pageRow(child.id);
    expect(childRow?.deletedAt).toBeNull();
    expect(childRow?.parentId).toBeNull();
    expect(childRow?.archivedAt).not.toBeNull();

    expect((await s.call(s.ben, `/${page.id}`)).status).toBe(404);
    expect(
      (await s.call(s.ben, `/${page.id}`, { method: "DELETE" })).status,
    ).toBe(404);
    const listed = (await s.list(s.ben)).map((item) => item.id);
    expect(listed).not.toContain(page.id);
    expect(listed).toContain(child.id);
    expect(pageEvents("page.deleted")).toHaveLength(1);
  });

  it("lists trashed pages by visibility, with who deleted them", async () => {
    const s = await pageScene();
    const shared = await trashedPage(s, s.ben, { title: "Shared" });
    const secret = await s.create(s.cara, { title: "Secret" });
    await s.ok(
      s.cara,
      `/${secret.id}/access`,
      json("PUT", { access: "private" }),
    );
    await s.ok(s.cara, `/${secret.id}/archive`, { method: "POST" });
    await s.ok(s.cara, `/${secret.id}`, { method: "DELETE" });

    const asCara = await trashCall(s, s.cara, `/project/${s.project.id}/pages`);
    expect(asCara.status).toBe(200);
    const caraList = (await asCara.json()) as TrashList;
    expect(caraList.items.map((item) => item.id).sort()).toEqual(
      [shared.id, secret.id].sort(),
    );

    // Admins never see someone else's private page, also in the trash.
    const asAdmin = await trashCall(
      s,
      s.admin,
      `/project/${s.project.id}/pages`,
    );
    const adminList = (await asAdmin.json()) as TrashList;
    expect(adminList.items.map((item) => item.id)).toEqual([shared.id]);
    expect(adminList.items[0]).toMatchObject({
      canManage: true,
      deletedBy: { id: s.ben.id, name: "Ben" },
    });
    expect(adminList.items[0]?.purgeAt).toBeTruthy();

    const viewer = await trashCall(
      s,
      s.viewer,
      `/project/${s.project.id}/pages`,
    );
    const viewerList = (await viewer.json()) as TrashList;
    expect(viewerList.items[0]?.canManage).toBe(false);

    const search = await trashCall(
      s,
      s.admin,
      `/project/${s.project.id}/pages?search=nothing`,
    );
    expect(((await search.json()) as TrashList).total).toBe(0);
  });

  it("restores a page into the archive with its comments and versions", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben, { title: "Doc", content: "body" });
    await s.ok(s.ben, `/${page.id}/comments`, json("POST", { content: "Hi" }));
    await s.ok(s.ben, `/${page.id}/archive`, { method: "POST" });
    await s.ok(s.ben, `/${page.id}`, { method: "DELETE" });

    const response = await trashCall(s, s.ben, `/page/${page.id}/restore`, {
      method: "POST",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const restored = (await response.json()) as {
      id: string;
      archivedAt: string;
    };
    expect(restored.id).toBe(page.id);
    expect(restored.archivedAt).toBeTruthy();

    const row = await pageRow(page.id);
    expect(row?.deletedAt).toBeNull();
    expect(row?.deletedById).toBeNull();
    expect((await s.get(s.ben, page.id)).contentMarkdown).toContain("body");
    const comments = await s.ok<unknown[]>(s.ben, `/${page.id}/comments`);
    expect(comments).toHaveLength(1);
    expect(pageEvents("page.restored")).toHaveLength(1);

    // A second restore has nothing to do.
    const again = await trashCall(s, s.ben, `/page/${page.id}/restore`, {
      method: "POST",
    });
    expect(again.status).toBe(404);
  });

  it("keeps favorites through a restore and removes them on a purge", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben, { title: "Doc" });
    await db.insert(schema.favoriteTable).values({
      userId: s.ben.id,
      workspaceId: s.workspaceId,
      projectId: s.project.id,
      entityType: "page",
      entityId: page.id,
    });
    await s.ok(s.ben, `/${page.id}/archive`, { method: "POST" });
    await s.ok(s.ben, `/${page.id}`, { method: "DELETE" });
    const favorites = () =>
      db
        .select()
        .from(schema.favoriteTable)
        .where(eq(schema.favoriteTable.entityId, page.id));
    expect(await favorites()).toHaveLength(1);

    const purged = await trashCall(s, s.ben, `/page/${page.id}`, {
      method: "DELETE",
    });
    expect(purged.status, await purged.clone().text()).toBe(200);
    expect(await pageRow(page.id)).toBeUndefined();
    expect(await favorites()).toHaveLength(0);
    expect(pageEvents("page.purged")).toHaveLength(1);
  });

  it("guards restore and purge like delete", async () => {
    const s = await pageScene();
    const page = await trashedPage(s, s.ben, { title: "Doc" });
    const live = await s.create(s.ben, { title: "Live" });
    const secret = await s.create(s.cara, { title: "Secret" });
    await s.ok(
      s.cara,
      `/${secret.id}/access`,
      json("PUT", { access: "private" }),
    );
    await s.ok(s.cara, `/${secret.id}/archive`, { method: "POST" });
    await s.ok(s.cara, `/${secret.id}`, { method: "DELETE" });

    const post = { method: "POST" };
    const del = { method: "DELETE" };
    // A member who doesn't own it, and a viewer who does nothing.
    expect(
      (await trashCall(s, s.cara, `/page/${page.id}/restore`, post)).status,
    ).toBe(403);
    expect((await trashCall(s, s.cara, `/page/${page.id}`, del)).status).toBe(
      403,
    );
    expect(
      (await trashCall(s, s.viewer, `/page/${page.id}/restore`, post)).status,
    ).toBe(403);
    // Someone else's private page reads as missing, for an admin too.
    expect(
      (await trashCall(s, s.admin, `/page/${secret.id}/restore`, post)).status,
    ).toBe(404);
    expect(
      (await trashCall(s, s.admin, `/page/${secret.id}`, del)).status,
    ).toBe(404);
    // Live pages can't be purged through the trash.
    expect((await trashCall(s, s.ben, `/page/${live.id}`, del)).status).toBe(
      404,
    );
    expect(await pageRow(live.id)).toBeDefined();
    // A manager may act on someone else's public page.
    expect(
      (await trashCall(s, s.admin, `/page/${page.id}/restore`, post)).status,
    ).toBe(200);
  });

  it("does not count trashed pages as siblings or as parents", async () => {
    const s = await pageScene();
    const page = await trashedPage(s, s.ben, { title: "Gone" });
    const live = await s.create(s.ben, { title: "Live" });
    const moved = await s.call(
      s.ben,
      `/${live.id}/position`,
      json("PUT", { parentId: page.id }),
    );
    expect(moved.status).toBe(404);
    const after = await s.call(
      s.ben,
      `/${live.id}/position`,
      json("PUT", { parentId: null, afterId: page.id }),
    );
    expect(after.status).toBe(400);
  });

  it("hides notifications of a trashed page until it is restored", async () => {
    const s = await pageScene();
    const page = await archivedPage(s, s.ben, { title: "Doc" });
    await db.insert(schema.notificationTable).values({
      userId: s.ben.id,
      type: "page_mention",
      resourceType: "page",
      resourceId: page.id,
      workspaceId: s.workspaceId,
    });
    const { canReceiveResourceNotification } = await import(
      "../../apps/api/src/notification/resource-access"
    );
    expect(
      await canReceiveResourceNotification(s.ben.id, page.id, "page"),
    ).toBe(true);
    await s.ok(s.ben, `/${page.id}`, { method: "DELETE" });
    expect(
      await canReceiveResourceNotification(s.ben.id, page.id, "page"),
    ).toBe(false);
  });

  it("purges pages older than the retention, unless it is off", async () => {
    const s = await pageScene();
    const old = await trashedPage(s, s.ben, { title: "Old" });
    const recent = await trashedPage(s, s.ben, { title: "Recent" });
    await db
      .update(schema.pageTable)
      .set({ deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.pageTable.id, old.id));

    expect(await runTrashPurge(new Date(), undefined, 0)).toEqual({
      degraded: false,
      projects: 0,
      tasks: 0,
      pages: 0,
    });
    expect(await pageRow(old.id)).toBeDefined();

    const outcome = await runTrashPurge(new Date(), undefined, 30);
    expect(outcome.pages).toBe(1);
    expect(await pageRow(old.id)).toBeUndefined();
    expect(await pageRow(recent.id)).toBeDefined();
  });
});
