import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { json, pageScene } from "./helpers/pages";

type CommentJson = {
  id: string;
  pageId: string;
  userId: string | null;
  content: string;
  user: { name: string; image: string | null } | null;
  canEdit: boolean;
  canDelete: boolean;
};

type SubscriptionJson = { pageId: string; subscribed: boolean };

const mention = (userId: string, name: string) =>
  `<margaya-mention id="${userId}" label="${name}"></margaya-mention> look`;

/** Subscribers run after the response; give them a moment. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function notifications(userId: string, type: string) {
  await settle();
  return db
    .select()
    .from(schema.notificationTable)
    .where(
      and(
        eq(schema.notificationTable.userId, userId),
        eq(schema.notificationTable.type, type),
      ),
    );
}

describe("API integration: page comments", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("adds, lists, edits and deletes comments with the right permissions", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben, { title: "Doc" });

    const created = await s.ok<CommentJson>(
      s.cara,
      `/${page.id}/comments`,
      json("POST", { content: "First" }),
    );
    expect(created).toMatchObject({
      pageId: page.id,
      userId: s.cara.id,
      content: "First",
      user: { name: "Cara" },
      canEdit: true,
      canDelete: true,
    });

    // A viewer reads but can't write, edit or delete.
    const asViewer = await s.ok<CommentJson[]>(
      s.viewer,
      `/${page.id}/comments`,
    );
    expect(asViewer.map((comment) => comment.content)).toEqual(["First"]);
    expect(asViewer[0]).toMatchObject({ canEdit: false, canDelete: false });
    expect(
      (
        await s.call(
          s.viewer,
          `/${page.id}/comments`,
          json("POST", { content: "No" }),
        )
      ).status,
    ).toBe(403);

    // Only the author edits; another member gets 403.
    const path = `/${page.id}/comments/${created.id}`;
    expect(
      (await s.call(s.ben, path, json("PUT", { content: "Hacked" }))).status,
    ).toBe(403);
    const edited = await s.ok<CommentJson>(
      s.cara,
      path,
      json("PUT", { content: "Edited" }),
    );
    expect(edited.content).toBe("Edited");

    // Another member can't delete it; a manager can.
    expect((await s.call(s.ben, path, { method: "DELETE" })).status).toBe(403);
    await s.ok(s.admin, path, { method: "DELETE" });
    expect(await s.ok<unknown[]>(s.cara, `/${page.id}/comments`)).toEqual([]);
    expect((await s.call(s.cara, path, { method: "DELETE" })).status).toBe(404);
  });

  it("rejects empty and oversized comments", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    for (const content of ["   ", "x".repeat(20_001)]) {
      const response = await s.call(
        s.ben,
        `/${page.id}/comments`,
        json("POST", { content }),
      );
      expect(response.status).toBe(400);
    }
  });

  it("takes comments on a locked page but not an archived one", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    await s.ok(s.ben, `/${page.id}/lock`, { method: "POST" });
    const onLocked = await s.ok<CommentJson>(
      s.ben,
      `/${page.id}/comments`,
      json("POST", { content: "Locked is fine" }),
    );
    await s.ok(s.ben, `/${page.id}/lock`, { method: "DELETE" });

    await s.ok(s.ben, `/${page.id}/archive`, { method: "POST" });
    expect((await s.get(s.ben, page.id)).capabilities.canComment).toBe(false);
    expect(
      (
        await s.call(
          s.ben,
          `/${page.id}/comments`,
          json("POST", { content: "No" }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await s.call(
          s.ben,
          `/${page.id}/comments/${onLocked.id}`,
          json("PUT", { content: "No" }),
        )
      ).status,
    ).toBe(409);
    expect(await s.ok<unknown[]>(s.ben, `/${page.id}/comments`)).toHaveLength(
      1,
    );
  });

  it("hides comments of someone else's private page, and of a trashed page", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    await s.ok(s.ben, `/${page.id}/access`, json("PUT", { access: "private" }));
    expect((await s.call(s.admin, `/${page.id}/comments`)).status).toBe(404);
    expect(
      (
        await s.call(
          s.cara,
          `/${page.id}/comments`,
          json("POST", { content: "No" }),
        )
      ).status,
    ).toBe(404);

    await s.ok(s.ben, `/${page.id}/archive`, { method: "POST" });
    await s.ok(s.ben, `/${page.id}`, { method: "DELETE" });
    expect((await s.call(s.ben, `/${page.id}/comments`)).status).toBe(404);
  });

  it("never shows a comment on another page's path", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    const other = await s.create(s.ben);
    const comment = await s.ok<CommentJson>(
      s.ben,
      `/${page.id}/comments`,
      json("POST", { content: "Here" }),
    );
    expect(
      (
        await s.call(s.ben, `/${other.id}/comments/${comment.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
  });

  it("notifies the owner and watchers of a comment, and mentions once", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben, { title: "Doc" });
    await s.ok(s.admin, `/${page.id}/subscription`, { method: "PUT" });

    await s.ok(
      s.cara,
      `/${page.id}/comments`,
      json("POST", { content: mention(s.viewer.id, "Vic") }),
    );

    const owner = await notifications(s.ben.id, "page_comment");
    expect(owner).toHaveLength(1);
    expect(owner[0]).toMatchObject({
      resourceType: "page",
      resourceId: page.id,
      actorId: s.cara.id,
      workspaceId: s.workspaceId,
    });
    expect(owner[0]?.eventData).toMatchObject({
      pageTitle: "Doc",
      commenterName: "Cara",
      projectId: s.project.id,
    });
    expect(await notifications(s.admin.id, "page_comment")).toHaveLength(1);
    // The author hears nothing, and a mention is not told twice.
    expect(await notifications(s.cara.id, "page_comment")).toHaveLength(0);
    expect(await notifications(s.viewer.id, "page_comment")).toHaveLength(0);
    expect(await notifications(s.viewer.id, "page_mention")).toHaveLength(1);

    // The author and those mentioned now watch it.
    for (const user of [s.cara, s.viewer]) {
      const state = await s.ok<SubscriptionJson>(
        user,
        `/${page.id}/subscription`,
      );
      expect(state.subscribed).toBe(true);
    }
  });

  it("ignores a mention of someone outside the workspace", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    const response = await s.call(
      s.ben,
      `/${page.id}/comments`,
      json("POST", { content: mention("no-such-user", "Ghost") }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
  });

  it("does not tell someone who lost sight of a private page", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    await s.ok(s.cara, `/${page.id}/subscription`, { method: "PUT" });
    await s.ok(s.ben, `/${page.id}/access`, json("PUT", { access: "private" }));
    await s.ok(
      s.ben,
      `/${page.id}/comments`,
      json("POST", { content: "Secret" }),
    );
    expect(await notifications(s.cara.id, "page_comment")).toHaveLength(0);
  });
});

describe("API integration: page watching", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("watches and unwatches, viewers included, and is idempotent", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    const path = `/${page.id}/subscription`;

    expect(await s.ok<SubscriptionJson>(s.viewer, path)).toEqual({
      pageId: page.id,
      subscribed: false,
    });
    for (let round = 0; round < 2; round++) {
      const on = await s.ok<SubscriptionJson>(s.viewer, path, {
        method: "PUT",
      });
      expect(on.subscribed).toBe(true);
    }
    for (let round = 0; round < 2; round++) {
      const off = await s.ok<SubscriptionJson>(s.viewer, path, {
        method: "DELETE",
      });
      expect(off.subscribed).toBe(false);
    }
  });

  it("lets the owner stop watching their own page", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    const path = `/${page.id}/subscription`;
    expect((await s.ok<SubscriptionJson>(s.ben, path)).subscribed).toBe(true);

    await s.ok(s.ben, path, { method: "DELETE" });
    expect((await s.ok<SubscriptionJson>(s.ben, path)).subscribed).toBe(false);
    await s.ok(
      s.cara,
      `/${page.id}/comments`,
      json("POST", { content: "Hello" }),
    );
    expect(await notifications(s.ben.id, "page_comment")).toHaveLength(0);

    // Being mentioned still tells them, and they watch again.
    await s.ok(
      s.cara,
      `/${page.id}/comments`,
      json("POST", { content: mention(s.ben.id, "Ben") }),
    );
    expect(await notifications(s.ben.id, "page_mention")).toHaveLength(1);
    expect((await s.ok<SubscriptionJson>(s.ben, path)).subscribed).toBe(true);
  });

  it("answers 404 for a page the caller can't see", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    await s.ok(s.ben, `/${page.id}/access`, json("PUT", { access: "private" }));
    const path = `/${page.id}/subscription`;
    expect((await s.call(s.cara, path, { method: "PUT" })).status).toBe(404);
  });

  it("tells watchers about content changes once until they read it", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben, { title: "Doc" });
    await s.ok(s.cara, `/${page.id}/subscription`, { method: "PUT" });

    const save = (markdown: string) =>
      s.ok(s.ben, `/${page.id}/content`, json("PUT", { markdown }));
    await save("one");
    await settle();
    await save("two");
    const rows = await notifications(s.cara.id, "page_updated");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventData).toMatchObject({
      pageTitle: "Doc",
      editorName: "Ben",
    });
    // The editor isn't told about their own save.
    expect(await notifications(s.ben.id, "page_updated")).toHaveLength(0);
  });
});
