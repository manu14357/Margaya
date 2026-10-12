import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  clearPageEvents,
  json,
  pageEvents,
  pageRow,
  pageScene,
  recordPageEvents,
} from "./helpers/pages";

describe("API integration: duplicate and move pages", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    recordPageEvents("page.created", "page.moved");
    clearPageEvents();
  });

  it("duplicates right after the source, owned by the caller", async () => {
    const s = await pageScene();
    const parent = await s.create(s.ben, { title: "Parent" });
    const source = await s.create(s.ben, {
      title: "Spec",
      parentId: parent.id,
      logoKind: "emoji",
      logoValue: "📄",
      isFullWidth: true,
      content: `Hello <margaya-mention id="${s.cara.id}" label="Cara"></margaya-mention>`,
    });
    const after = await s.create(s.ben, {
      title: "After",
      parentId: parent.id,
    });
    await s.ok(
      s.ben,
      `/${source.id}/content`,
      json("PUT", { markdown: "Edited" }),
    );
    await s.ok(
      s.ben,
      `/${source.id}/content`,
      json("PUT", {
        markdown: `Edited <margaya-mention id="${s.cara.id}" label="Cara"></margaya-mention>`,
      }),
    );
    await s.ok(s.ben, `/${source.id}/lock`, { method: "POST" });
    clearPageEvents();

    const copy = await s.ok(s.cara, `/${source.id}/duplicate`, {
      method: "POST",
    });
    expect(copy).toMatchObject({
      title: "Spec (copy)",
      ownerId: s.cara.id,
      parentId: parent.id,
      position: 1,
      logoKind: "emoji",
      logoValue: "📄",
      isFullWidth: true,
      isLocked: false,
      access: "public",
      contentVersion: 1,
    });
    expect(copy.contentMarkdown).toBe(
      `Edited <margaya-mention id="${s.cara.id}" label="Cara"></margaya-mention>`,
    );
    expect((await pageRow(after.id))?.position).toBe(2);

    const sourceRow = await pageRow(source.id);
    const copyRow = await pageRow(copy.id);
    expect(copyRow?.contentYjs).not.toBeNull();
    expect(copyRow?.contentYjs?.equals(sourceRow?.contentYjs as Buffer)).toBe(
      false,
    );

    const refs = await db
      .select()
      .from(schema.pageReferenceTable)
      .where(eq(schema.pageReferenceTable.pageId, copy.id));
    expect(refs.map((ref) => ref.entityId)).toEqual([s.cara.id]);
    const versions = await db
      .select()
      .from(schema.pageVersionTable)
      .where(eq(schema.pageVersionTable.pageId, copy.id));
    expect(versions).toHaveLength(0);
    expect(pageEvents("page.created")[0]?.data).toMatchObject({
      duplicatedFromId: source.id,
      newlyMentionedUserIds: [],
    });

    const untitled = await s.create(s.ben);
    const untitledCopy = await s.ok(s.ben, `/${untitled.id}/duplicate`, {
      method: "POST",
    });
    expect(untitledCopy.title).toBe("Untitled (copy)");
  });

  it("answers 404 when duplicating an invisible page", async () => {
    const s = await pageScene();
    const secret = await s.create(s.ben, { access: "private" });
    const response = await s.call(s.cara, `/${secret.id}/duplicate`, {
      method: "POST",
    });
    expect(response.status).toBe(404);
  });

  it("moves a subtree to another project with its files, favorites and visits", async () => {
    const s = await pageScene();
    const target = await s.project2();
    const existing = await s.create(s.ben, { title: "Existing" }, target.id);
    const root = await s.create(s.ben, { title: "Root" });
    const child = await s.create(s.cara, { title: "Child", parentId: root.id });
    const [asset] = await db
      .insert(schema.assetTable)
      .values({
        workspaceId: s.workspaceId,
        projectId: s.project.id,
        pageId: child.id,
        objectKey: randomUUID(),
        filename: "f.png",
        mimeType: "image/png",
        size: 3,
        surface: "page",
      })
      .returning();
    await db.insert(schema.favoriteTable).values({
      userId: s.cara.id,
      workspaceId: s.workspaceId,
      projectId: s.project.id,
      entityType: "page",
      entityId: child.id,
    });
    await db.insert(schema.recentVisitTable).values({
      userId: s.cara.id,
      workspaceId: s.workspaceId,
      projectId: s.project.id,
      entityType: "page",
      entityId: root.id,
    });

    const moved = await s.ok(
      s.ben,
      `/${root.id}/move`,
      json("POST", { projectId: target.id }),
    );
    expect(moved).toMatchObject({
      projectId: target.id,
      parentId: null,
      position: existing.position + 1,
    });
    const childRow = await pageRow(child.id);
    expect(childRow).toMatchObject({ projectId: target.id, parentId: root.id });

    const [assetRow] = await db
      .select()
      .from(schema.assetTable)
      .where(eq(schema.assetTable.id, asset?.id as string));
    expect(assetRow?.projectId).toBe(target.id);
    const [favorite] = await db
      .select()
      .from(schema.favoriteTable)
      .where(eq(schema.favoriteTable.entityId, child.id));
    expect(favorite?.projectId).toBe(target.id);
    const [visit] = await db
      .select()
      .from(schema.recentVisitTable)
      .where(eq(schema.recentVisitTable.entityId, root.id));
    expect(visit?.projectId).toBe(target.id);

    expect(pageEvents("page.moved")[0]?.data).toMatchObject({
      fromProjectId: s.project.id,
      toProjectId: target.id,
    });
    const movedIds = (pageEvents("page.moved")[0]?.data.pageIds ??
      []) as string[];
    expect([...movedIds].sort()).toEqual([root.id, child.id].sort());
  });

  it("refuses bad move targets", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);

    const same = await s.call(
      s.ben,
      `/${page.id}/move`,
      json("POST", { projectId: s.project.id }),
    );
    expect(same.status).toBe(400);
    expect(await same.text()).toBe("The page is already in that project");

    const off = await s.project2("off");
    await db
      .update(schema.projectTable)
      .set({ pagesEnabled: false })
      .where(eq(schema.projectTable.id, off.id));
    const disabled = await s.call(
      s.ben,
      `/${page.id}/move`,
      json("POST", { projectId: off.id }),
    );
    expect(disabled.status).toBe(403);
    expect(await disabled.text()).toBe(
      "The Pages feature is turned off for this project.",
    );

    const other = await createWorkspaceMember({ role: "owner" });
    const { project: foreign } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    const crossWorkspace = await s.call(
      s.ben,
      `/${page.id}/move`,
      json("POST", { projectId: foreign.id }),
    );
    expect(crossWorkspace.status).toBe(404);
    expect(await crossWorkspace.text()).toBe("Project not found");

    const target = await s.project2();
    await s.ok(s.ben, `/${page.id}/lock`, { method: "POST" });
    const locked = await s.call(
      s.ben,
      `/${page.id}/move`,
      json("POST", { projectId: target.id }),
    );
    expect(locked.status).toBe(409);
  });
});
