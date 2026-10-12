import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  clearPageEvents,
  json,
  type PageSummaryJson,
  pageEvents,
  pageRow,
  pageScene,
  recordPageEvents,
} from "./helpers/pages";

describe("API integration: pages CRUD", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    recordPageEvents("page.created", "page.updated");
    clearPageEvents();
  });

  it("creates a public page at the end with an empty document", async () => {
    const s = await pageScene();
    const first = await s.create(s.ben);
    const second = await s.create(s.ben, { title: "  Second  " });

    expect(first).toMatchObject({
      title: "",
      access: "public",
      ownerId: s.ben.id,
      createdById: s.ben.id,
      parentId: null,
      position: 0,
      contentVersion: 1,
      contentMarkdown: "",
      isLocked: false,
      archivedAt: null,
      ancestors: [],
    });
    expect(second.title).toBe("Second");
    expect(second.position).toBe(1);
    expect(first.capabilities).toMatchObject({
      canEdit: true,
      canLock: true,
      canChangeAccess: true,
      canArchive: true,
      canDelete: false,
      canDuplicate: true,
      canMove: true,
      canCreateSubpage: true,
    });

    const row = await pageRow(first.id);
    expect(row?.contentYjs).not.toBeNull();
    expect(row?.contentYjs?.byteLength).toBeGreaterThan(0);

    const created = pageEvents("page.created");
    expect(created).toHaveLength(2);
    expect(created[0]?.data).toMatchObject({
      pageId: first.id,
      projectId: s.project.id,
      workspaceId: s.workspaceId,
      userId: s.ben.id,
      parentId: null,
    });
  });

  it("stores markdown content normalized, with plain text", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben, {
      title: "Spec",
      content: "Title\n=====\n\n* one\n* **two**\n",
    });
    expect(page.contentMarkdown).toBe("# Title\n\n- one\n- **two**");
    const row = await pageRow(page.id);
    expect(row?.contentText).toBe("Title\none\ntwo");
  });

  it("validates the title, the body and the logo", async () => {
    const s = await pageScene();
    const path = `/project/${s.project.id}`;
    const tooLong = await s.call(
      s.ben,
      path,
      json("POST", { title: "x".repeat(256) }),
    );
    expect(tooLong.status).toBe(400);
    const unknown = await s.call(s.ben, path, json("POST", { nope: true }));
    expect(unknown.status).toBe(400);
    const halfLogo = await s.call(
      s.ben,
      path,
      json("POST", { logoKind: "emoji" }),
    );
    expect(halfLogo.status).toBe(400);
    expect(await halfLogo.text()).toBe("Choose a valid icon or emoji");
    const badIcon = await s.call(
      s.ben,
      path,
      json("POST", { logoKind: "icon", logoValue: "NotAnIcon" }),
    );
    expect(badIcon.status).toBe(400);
    const twoEmoji = await s.call(
      s.ben,
      path,
      json("POST", { logoKind: "emoji", logoValue: "🚀🚀" }),
    );
    expect(twoEmoji.status).toBe(400);

    const withLogo = await s.create(s.ben, {
      logoKind: "emoji",
      logoValue: "👩‍💻",
      isFullWidth: true,
    });
    expect(withLogo).toMatchObject({
      logoKind: "emoji",
      logoValue: "👩‍💻",
      isFullWidth: true,
    });
  });

  it("gets a page with capabilities and visible ancestors", async () => {
    const s = await pageScene();
    const root = await s.create(s.ben, { title: "Root" });
    const child = await s.create(s.ben, { title: "Child", parentId: root.id });
    const grandchild = await s.create(s.cara, {
      title: "Grandchild",
      parentId: child.id,
    });

    const page = await s.get(s.cara, grandchild.id);
    expect(page.ancestors.map((a) => a.title)).toEqual(["Root", "Child"]);
    expect(page.capabilities.canEdit).toBe(true);
    expect(page.capabilities.canLock).toBe(true);

    const asBen = await s.get(s.ben, grandchild.id);
    expect(asBen.capabilities).toMatchObject({
      canEdit: true,
      canLock: false,
      canArchive: false,
      canChangeAccess: false,
      canMove: false,
    });
    const asAdmin = await s.get(s.admin, grandchild.id);
    expect(asAdmin.capabilities).toMatchObject({
      canLock: true,
      canMove: true,
    });
  });

  it("patches title, logo and width, bumping updatedAt", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    const before = await pageRow(page.id);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const updated = await s.ok(
      s.cara,
      `/${page.id}`,
      json("PATCH", {
        title: "Renamed",
        logoKind: "icon",
        logoValue: "FileText",
        isFullWidth: true,
      }),
    );
    expect(updated).toMatchObject({
      title: "Renamed",
      logoKind: "icon",
      logoValue: "FileText",
      isFullWidth: true,
      updatedById: s.cara.id,
    });
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
      before?.updatedAt.getTime() ?? 0,
    );
    expect(pageEvents("page.updated")[0]?.data.changed).toEqual([
      "title",
      "logo",
      "isFullWidth",
    ]);

    const cleared = await s.ok(
      s.cara,
      `/${page.id}`,
      json("PATCH", {
        logoKind: null,
        logoValue: null,
      }),
    );
    expect(cleared.logoKind).toBeNull();

    clearPageEvents();
    await s.ok(s.cara, `/${page.id}`, json("PATCH", { title: "Renamed" }));
    expect(pageEvents("page.updated")).toHaveLength(0);
  });

  it("refuses an empty or unknown patch", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    const empty = await s.call(s.ben, `/${page.id}`, json("PATCH", {}));
    expect(empty.status).toBe(400);
    expect(await empty.text()).toContain(
      "Provide at least one field to change",
    );
    const unknown = await s.call(
      s.ben,
      `/${page.id}`,
      json("PATCH", { access: "private" }),
    );
    expect(unknown.status).toBe(400);
    const halfLogo = await s.call(
      s.ben,
      `/${page.id}`,
      json("PATCH", { logoValue: "🚀" }),
    );
    expect(halfLogo.status).toBe(400);
  });

  it("lists summaries without content, ordered by parent and position", async () => {
    const s = await pageScene();
    const a = await s.create(s.ben, { title: "A", content: "secret body" });
    const b = await s.create(s.ben, { title: "B" });
    const child = await s.create(s.ben, { title: "A1", parentId: a.id });

    const list = await s.list(s.viewer);
    expect(list.map((p) => p.id)).toEqual([a.id, b.id, child.id]);
    const first = list[0] as PageSummaryJson & Record<string, unknown>;
    expect(first).not.toHaveProperty("contentMarkdown");
    expect(first).not.toHaveProperty("contentYjs");
    expect(first).not.toHaveProperty("contentText");
    expect(JSON.stringify(list)).not.toContain("secret body");
  });

  it("refuses the 5,001st page of a project", async () => {
    const s = await pageScene();
    await db.insert(schema.pageTable).values(
      Array.from({ length: 5000 }, (_, index) => ({
        workspaceId: s.workspaceId,
        projectId: s.project.id,
        position: index,
        ownerId: s.ben.id,
      })),
    );
    const response = await s.call(
      s.ben,
      `/project/${s.project.id}`,
      json("POST", {}),
    );
    expect(response.status).toBe(409);
    expect(await response.text()).toBe(
      "This project has reached the limit of 5,000 pages",
    );
  });
});
