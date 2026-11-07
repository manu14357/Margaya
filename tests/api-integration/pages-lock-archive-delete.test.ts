import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
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

const LOCKED = "This page is locked. Unlock it to make changes.";
const ARCHIVED = "This page is archived. Restore it to make changes.";

describe("API integration: page lock, archive and delete", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    recordPageEvents(
      "page.locked",
      "page.unlocked",
      "page.archived",
      "page.deleted",
    );
    clearPageEvents();
  });

  it("blocks every change to a locked page, and locks idempotently", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben, { title: "Doc" });
    const other = await s.project2();
    const locked = await s.ok(s.ben, `/${page.id}/lock`, { method: "POST" });
    expect(locked).toMatchObject({ isLocked: true, lockedById: s.ben.id });
    expect(locked.lockedAt).not.toBeNull();
    expect(locked.capabilities.canEdit).toBe(false);
    await s.ok(s.ben, `/${page.id}/lock`, { method: "POST" });
    expect(pageEvents("page.locked")).toHaveLength(1);

    const version = await db
      .insert(schema.pageVersionTable)
      .values({
        pageId: page.id,
        workspaceId: s.workspaceId,
        contentJson: { type: "doc", content: [{ type: "paragraph" }] },
      })
      .returning();

    for (const [path, init] of [
      [`/${page.id}`, json("PATCH", { title: "x" })],
      [`/${page.id}/content`, json("PUT", { markdown: "x" })],
      [`/${page.id}/position`, json("PUT", { parentId: null })],
      [`/${page.id}/move`, json("POST", { projectId: other.id })],
      [`/${page.id}/versions/${version[0]?.id}/restore`, { method: "POST" }],
      [
        `/${page.id}/asset-upload`,
        json("PUT", { filename: "a.png", contentType: "image/png", size: 10 }),
      ],
    ] as const) {
      const response = await s.call(s.ben, path, init);
      expect(response.status, path).toBe(409);
      expect(await response.text()).toBe(LOCKED);
    }

    // Duplicate and access still work while locked.
    await s.ok(s.ben, `/${page.id}/duplicate`, { method: "POST" });
    await s.ok(s.ben, `/${page.id}/access`, json("PUT", { access: "private" }));
  });

  it("lets only the owner or a manager unlock", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    await s.ok(s.ben, `/${page.id}/lock`, { method: "POST" });

    const member = await s.call(s.cara, `/${page.id}/lock`, {
      method: "DELETE",
    });
    expect(member.status).toBe(403);
    expect(await member.text()).toBe(
      "Only the page owner or an admin can do this",
    );

    const unlocked = await s.ok(s.admin, `/${page.id}/lock`, {
      method: "DELETE",
    });
    expect(unlocked).toMatchObject({
      isLocked: false,
      lockedById: null,
      lockedAt: null,
    });
    expect(pageEvents("page.unlocked")).toHaveLength(1);
  });

  it("archives three levels of descendants and restores them", async () => {
    const s = await pageScene();
    const root = await s.create(s.ben, { title: "Root" });
    const a = await s.create(s.ben, { parentId: root.id });
    const b = await s.create(s.cara, { parentId: a.id });
    const c = await s.create(s.cara, { parentId: b.id });
    const before = await pageRow(root.id);

    const archived = await s.ok(s.ben, `/${root.id}/archive`, {
      method: "POST",
    });
    expect(archived.archivedAt).not.toBeNull();
    for (const id of [a.id, b.id, c.id]) {
      expect((await pageRow(id))?.archivedAt).not.toBeNull();
    }
    expect(pageEvents("page.archived")[0]?.data.affectedPageIds).toHaveLength(
      4,
    );
    expect((await pageRow(root.id))?.updatedAt).toEqual(before?.updatedAt);

    const edit = await s.call(s.ben, `/${a.id}`, json("PATCH", { title: "x" }));
    expect(edit.status).toBe(409);
    expect(await edit.text()).toBe(ARCHIVED);

    clearPageEvents();
    await s.ok(s.ben, `/${root.id}/archive`, { method: "POST" });
    expect(pageEvents("page.archived")).toHaveLength(0);

    await s.ok(s.ben, `/${root.id}/unarchive`, { method: "POST" });
    for (const id of [root.id, a.id, b.id, c.id]) {
      expect((await pageRow(id))?.archivedAt).toBeNull();
    }
  });

  it("restores a child of an archived parent to the end of the root", async () => {
    const s = await pageScene();
    const root = await s.create(s.ben, { title: "Root" });
    const child = await s.create(s.ben, { parentId: root.id });
    await s.create(s.ben, { title: "Other root" });
    await s.ok(s.ben, `/${root.id}/archive`, { method: "POST" });

    const restored = await s.ok(s.ben, `/${child.id}/unarchive`, {
      method: "POST",
    });
    expect(restored.parentId).toBeNull();
    expect(restored.position).toBe(2);
    expect(restored.archivedAt).toBeNull();
    expect((await pageRow(root.id))?.archivedAt).not.toBeNull();
  });

  it("refuses to archive for a member who is not the owner", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    const response = await s.call(s.cara, `/${page.id}/archive`, {
      method: "POST",
    });
    expect(response.status).toBe(403);
  });

  it("deletes only archived pages, for the owner or a manager", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben, { title: "Target" });
    const child = await s.create(s.ben, { title: "Child", parentId: page.id });
    const linker = await s.create(s.cara, {
      content: `<margaya-page-link id="${page.id}" title="Target"></margaya-page-link>`,
    });

    const notArchived = await s.call(s.ben, `/${page.id}`, {
      method: "DELETE",
    });
    expect(notArchived.status).toBe(409);
    expect(await notArchived.text()).toBe(
      "Archive the page before deleting it",
    );

    await s.ok(s.ben, `/${page.id}/archive`, { method: "POST" });
    const member = await s.call(s.cara, `/${page.id}`, { method: "DELETE" });
    expect(member.status).toBe(403);
    expect(await member.text()).toBe(
      "Only the page owner or an admin can delete it",
    );

    const linked = await db
      .select()
      .from(schema.pageReferenceTable)
      .where(eq(schema.pageReferenceTable.entityId, page.id));
    expect(linked).toHaveLength(1);
    await db.insert(schema.pageVersionTable).values({
      pageId: page.id,
      workspaceId: s.workspaceId,
      contentJson: { type: "doc" },
    });
    for (const user of [s.ben, s.cara]) {
      await db.insert(schema.favoriteTable).values({
        userId: user.id,
        workspaceId: s.workspaceId,
        projectId: s.project.id,
        entityType: "page",
        entityId: page.id,
      });
    }
    await db.insert(schema.recentVisitTable).values({
      userId: s.cara.id,
      workspaceId: s.workspaceId,
      projectId: s.project.id,
      entityType: "page",
      entityId: page.id,
    });

    const deleted = await s.ok<{ id: string; projectId: string }>(
      s.ben,
      `/${page.id}`,
      { method: "DELETE" },
    );
    expect(deleted).toEqual({ id: page.id, projectId: s.project.id });
    const childRow = await pageRow(child.id);
    expect(childRow?.parentId).toBeNull();
    expect(childRow?.archivedAt).not.toBeNull();

    // It waits in the trash with everything attached to it.
    const trashed = await pageRow(page.id);
    expect(trashed?.deletedAt).not.toBeNull();
    const kept = await db
      .select()
      .from(schema.pageVersionTable)
      .where(eq(schema.pageVersionTable.pageId, page.id));
    expect(kept).toHaveLength(1);
    expect(pageEvents("page.deleted")).toHaveLength(1);

    // Deleting it for good removes the rest.
    mockAuthenticatedSession(s.ben);
    const purged = await s.app.request(`/api/trash/page/${page.id}`, {
      method: "DELETE",
    });
    expect(purged.status, await purged.clone().text()).toBe(200);
    expect(await pageRow(page.id)).toBeUndefined();

    const versions = await db
      .select()
      .from(schema.pageVersionTable)
      .where(eq(schema.pageVersionTable.pageId, page.id));
    expect(versions).toHaveLength(0);
    const pointing = await db
      .select()
      .from(schema.pageReferenceTable)
      .where(eq(schema.pageReferenceTable.entityId, page.id));
    expect(pointing).toHaveLength(0);
    const favorites = await db
      .select()
      .from(schema.favoriteTable)
      .where(eq(schema.favoriteTable.entityId, page.id));
    expect(favorites).toHaveLength(0);
    const visits = await db
      .select()
      .from(schema.recentVisitTable)
      .where(eq(schema.recentVisitTable.entityId, page.id));
    expect(visits).toHaveLength(0);
    expect(await pageRow(linker.id)).toBeDefined();
  });

  it("lets a manager delete someone else's archived page", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    await s.ok(s.ben, `/${page.id}/archive`, { method: "POST" });
    await s.ok(s.admin, `/${page.id}`, { method: "DELETE" });
    expect((await pageRow(page.id))?.deletedById).toBe(s.admin.id);
  });
});
