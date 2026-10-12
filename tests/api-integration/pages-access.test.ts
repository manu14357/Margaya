import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { apiKeyFor } from "./helpers/intake";
import { json, pageScene } from "./helpers/pages";

describe("API integration: page access", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("hides another user's private page everywhere, from admins too", async () => {
    const s = await pageScene();
    const secret = await s.create(s.ben, {
      title: "Secret",
      access: "private",
    });

    for (const user of [s.cara, s.admin, s.owner]) {
      for (const [path, init] of [
        [`/${secret.id}`, undefined],
        [`/${secret.id}`, json("PATCH", { title: "x" })],
        [`/${secret.id}/versions`, undefined],
        [`/${secret.id}/backlinks`, undefined],
        [`/${secret.id}/duplicate`, { method: "POST" }],
        [`/${secret.id}/lock`, { method: "POST" }],
      ] as const) {
        const response = await s.call(user, path, init);
        expect(response.status, `${user.name} ${path}`).toBe(404);
        expect(await response.text()).toBe("Page not found");
      }
      expect((await s.list(user)).map((p) => p.id)).not.toContain(secret.id);
    }
    expect((await s.list(s.ben)).map((p) => p.id)).toContain(secret.id);
  });

  it("lets viewers read public pages but never write", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben, { title: "Public" });
    const read = await s.get(s.viewer, page.id);
    expect(Object.values(read.capabilities).every((value) => !value)).toBe(
      true,
    );

    for (const [path, init] of [
      [`/project/${s.project.id}`, json("POST", {})],
      [`/${page.id}`, json("PATCH", { title: "x" })],
      [`/${page.id}/content`, json("PUT", { markdown: "x" })],
      [`/${page.id}/position`, json("PUT", { parentId: null })],
      [`/${page.id}/lock`, { method: "POST" }],
      [`/${page.id}/archive`, { method: "POST" }],
      [`/${page.id}/duplicate`, { method: "POST" }],
      [`/${page.id}/access`, json("PUT", { access: "private" })],
    ] as const) {
      const response = await s.call(s.viewer, path, init);
      expect(response.status, path).toBe(403);
    }
  });

  it("answers 403 for a custom role without page permissions", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: s.workspaceId,
      role: "reporter",
      permission: JSON.stringify({ project: ["read"], task: ["read"] }),
    });
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "reporter" })
      .where(eq(schema.workspaceUserTable.userId, s.cara.id));

    expect((await s.call(s.cara, `/project/${s.project.id}`)).status).toBe(403);
    expect((await s.call(s.cara, `/${page.id}`)).status).toBe(403);
  });

  it("answers 403 for an API key without page:read scope", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    const scoped = await apiKeyFor(s.ben, {
      project: ["read"],
      task: ["read"],
    });
    const denied = await s.app.request(`/api/page/${page.id}`, {
      headers: scoped,
    });
    expect(denied.status).toBe(403);
    const reader = await apiKeyFor(s.ben, { page: ["read"] });
    const allowed = await s.app.request(`/api/page/${page.id}`, {
      headers: reader,
    });
    expect(allowed.status).toBe(200);
  });

  it("answers 404 for a page of another workspace", async () => {
    const s = await pageScene();
    const other = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    const [foreign] = await db
      .insert(schema.pageTable)
      .values({
        workspaceId: other.workspace.id,
        projectId: project.id,
        ownerId: other.user.id,
      })
      .returning();
    const response = await s.call(s.ben, `/${foreign?.id}`);
    expect(response.status).toBe(404);
  });

  it("lets only the owner change access, with T5 and T6", async () => {
    const s = await pageScene();
    const parent = await s.create(s.ben, { title: "Parent" });
    const mine = await s.create(s.ben, { title: "Mine", parentId: parent.id });
    const theirs = await s.create(s.cara, {
      title: "Theirs",
      parentId: parent.id,
    });

    const notOwner = await s.call(
      s.admin,
      `/${parent.id}/access`,
      json("PUT", { access: "private" }),
    );
    expect(notOwner.status).toBe(403);
    expect(await notOwner.text()).toBe(
      "Only the page owner can change who can see it",
    );

    const foreign = await s.call(
      s.ben,
      `/${parent.id}/access`,
      json("PUT", { access: "private" }),
    );
    expect(foreign.status).toBe(409);
    expect(await foreign.text()).toBe(
      "Some sub-pages belong to other people. Move them out first.",
    );

    await s.ok(
      s.cara,
      `/${theirs.id}/position`,
      json("PUT", { parentId: null }),
    );
    const made = await s.ok(
      s.ben,
      `/${parent.id}/access`,
      json("PUT", { access: "private" }),
    );
    expect(made.access).toBe("private");
    expect((await s.get(s.ben, mine.id)).access).toBe("private");

    const underPrivate = await s.call(
      s.ben,
      `/${mine.id}/access`,
      json("PUT", { access: "public" }),
    );
    expect(underPrivate.status).toBe(409);
    expect(await underPrivate.text()).toBe("Make the parent page public first");

    const back = await s.ok(
      s.ben,
      `/${parent.id}/access`,
      json("PUT", { access: "public" }),
    );
    expect(back.access).toBe("public");
    expect((await s.get(s.ben, mine.id)).access).toBe("private");
  });

  it("removes other users' favorites and recent visits when a page turns private", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben, { title: "Shared" });
    for (const user of [s.ben, s.cara]) {
      await db.insert(schema.favoriteTable).values({
        userId: user.id,
        workspaceId: s.workspaceId,
        projectId: s.project.id,
        entityType: "page",
        entityId: page.id,
      });
      await db.insert(schema.recentVisitTable).values({
        userId: user.id,
        workspaceId: s.workspaceId,
        projectId: s.project.id,
        entityType: "page",
        entityId: page.id,
      });
    }

    await s.ok(s.ben, `/${page.id}/access`, json("PUT", { access: "private" }));

    const favorites = await db
      .select({ userId: schema.favoriteTable.userId })
      .from(schema.favoriteTable)
      .where(eq(schema.favoriteTable.entityId, page.id));
    expect(favorites.map((row) => row.userId)).toEqual([s.ben.id]);
    const visits = await db
      .select({ userId: schema.recentVisitTable.userId })
      .from(schema.recentVisitTable)
      .where(
        and(
          eq(schema.recentVisitTable.entityType, "page"),
          eq(schema.recentVisitTable.entityId, page.id),
        ),
      );
    expect(visits.map((row) => row.userId)).toEqual([s.ben.id]);
  });

  it("shows an ownerless private page to managers only", async () => {
    const s = await pageScene();
    const [orphan] = await db
      .insert(schema.pageTable)
      .values({
        workspaceId: s.workspaceId,
        projectId: s.project.id,
        access: "private",
        ownerId: null,
        title: "Orphan",
      })
      .returning();
    const id = orphan?.id as string;
    expect((await s.call(s.ben, `/${id}`)).status).toBe(404);
    const asAdmin = await s.get(s.admin, id);
    expect(asAdmin.capabilities.canEdit).toBe(false);
    expect(asAdmin.capabilities.canArchive).toBe(true);
    expect((await s.list(s.admin)).map((p) => p.id)).toContain(id);
  });

  it("hides private pages from other users' favorites through the resolver", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben, { title: "Soon private" });
    await db.insert(schema.favoriteTable).values({
      userId: s.cara.id,
      workspaceId: s.workspaceId,
      projectId: s.project.id,
      entityType: "page",
      entityId: page.id,
    });
    await db
      .update(schema.pageTable)
      .set({ access: "private" })
      .where(eq(schema.pageTable.id, page.id));

    mockAuthenticatedSession(s.cara);
    const response = await s.app.request(
      `/api/favorite?workspaceId=${s.workspaceId}`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("Soon private");
  });
});
