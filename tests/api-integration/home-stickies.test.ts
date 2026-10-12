import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  collectEvents,
  expectStatus,
  homeContext,
  json,
  type StickyJson,
  type StickyPageJson,
} from "./helpers/home";

const stickyEvents = await collectEvents("sticky.changed");

async function stickies(role = "member") {
  const ctx = await homeContext(role);
  const { app, workspaceId } = ctx;

  const create = (body: Record<string, unknown> = {}) =>
    app.request("/api/sticky", json("POST", { workspaceId, ...body }));
  const createOk = async (body: Record<string, unknown> = {}) =>
    (await (await expectStatus(create(body), 200)).json()) as StickyJson;
  const list = async (params: Record<string, string> = {}) => {
    const query = new URLSearchParams({ workspaceId, ...params });
    const response = await expectStatus(
      app.request(`/api/sticky?${query}`),
      200,
    );
    return (await response.json()) as StickyPageJson;
  };
  const patch = (id: string, body: unknown, workspace = workspaceId) =>
    app.request(
      `/api/sticky/${id}?workspaceId=${workspace}`,
      json("PATCH", body),
    );
  const reorder = (stickyIds: string[]) =>
    app.request(
      `/api/sticky/reorder?workspaceId=${workspaceId}`,
      json("PUT", { stickyIds }),
    );
  const insertMany = (total: number) =>
    db.insert(schema.stickyTable).values(
      Array.from({ length: total }, (_, index) => ({
        userId: ctx.user.id,
        workspaceId,
        content: `note ${index}`,
        contentText: `note ${index}`,
        position: index,
      })),
    );

  return { ...ctx, create, createOk, list, patch, reorder, insertMany };
}

describe("API integration: stickies", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    stickyEvents.length = 0;
  });

  it("creates stickies on top with defaults, without private fields", async () => {
    const { createOk, list } = await stickies();
    const first = await createOk();
    expect(first).toMatchObject({ content: "", color: "yellow", position: 0 });
    expect(first).not.toHaveProperty("userId");
    expect(first).not.toHaveProperty("contentText");

    const second = await createOk({ content: "Call Ada", color: "teal" });
    expect(second).toMatchObject({
      content: "Call Ada",
      color: "teal",
      position: -1,
    });
    expect((await list()).items.map((sticky) => sticky.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it("validates create bodies", async () => {
    const { create } = await stickies();
    await expectStatus(create({ color: "blue" }), 400);
    await expectStatus(create({ content: "x".repeat(20_001) }), 400);
    await expectStatus(create({ content: "x".repeat(140 * 1024) }), 413);
  });

  it("pages with a keyset cursor", async () => {
    const { list, insertMany } = await stickies();
    await insertMany(35);

    const first = await list({ limit: "30" });
    expect(first.items).toHaveLength(30);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await list({ limit: "30", cursor: first.nextCursor ?? "" });
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((sticky) => sticky.id);
    expect(new Set(ids).size).toBe(35);
    expect(second.items.map((sticky) => sticky.content)).toEqual([
      "note 30",
      "note 31",
      "note 32",
      "note 33",
      "note 34",
    ]);

    // The default page size is 30.
    expect((await list()).items).toHaveLength(30);
  });

  it("refuses a garbage cursor", async () => {
    const { app, workspaceId } = await stickies();
    await expectStatus(
      app.request(`/api/sticky?workspaceId=${workspaceId}&cursor=nope!`),
      400,
      "Invalid cursor",
    );
    const wrongShape = Buffer.from('["a","b"]').toString("base64url");
    await expectStatus(
      app.request(
        `/api/sticky?workspaceId=${workspaceId}&cursor=${wrongShape}`,
      ),
      400,
      "Invalid cursor",
    );
  });

  it("searches the plain text of the content", async () => {
    const { createOk, list } = await stickies();
    const bold = await createOk({ content: "**ship**\nit" });
    const mention = await createOk({
      content: 'Ask <margaya-mention id="u1" label="Ada"></margaya-mention>',
    });
    const percent = await createOk({ content: "100% done" });
    await createOk({ content: "1000 done" });

    const found = async (q: string) =>
      (await list({ q })).items.map((sticky) => sticky.id);
    expect(await found("ship it")).toEqual([bold.id]);
    expect(await found("SHIP")).toEqual([bold.id]);
    expect(await found("@Ada")).toEqual([mention.id]);
    expect(await found("100%")).toEqual([percent.id]);
    expect(await found("  ")).toHaveLength(4);
  });

  it("updates content and color, and recomputes the search text", async () => {
    const { createOk, list, patch } = await stickies();
    const sticky = await createOk({ content: "alpha" });

    const updated = (await (
      await expectStatus(patch(sticky.id, { content: "beta" }), 200)
    ).json()) as StickyJson;
    expect(updated).toMatchObject({ content: "beta", color: "yellow" });
    expect((await list({ q: "alpha" })).items).toEqual([]);
    expect((await list({ q: "beta" })).items).toHaveLength(1);

    const recolored = (await (
      await expectStatus(patch(sticky.id, { color: "red" }), 200)
    ).json()) as StickyJson;
    expect(recolored).toMatchObject({ content: "beta", color: "red" });
  });

  it("writes and publishes nothing for an unchanged update", async () => {
    const { createOk, patch } = await stickies();
    const sticky = await createOk({ content: "same", color: "green" });
    stickyEvents.length = 0;

    const response = await expectStatus(
      patch(sticky.id, { content: "same", color: "green" }),
      200,
    );
    expect(((await response.json()) as StickyJson).updatedAt).toBe(
      sticky.updatedAt,
    );
    expect(stickyEvents).toEqual([]);
  });

  it("rejects empty and unknown update bodies", async () => {
    const { createOk, patch } = await stickies();
    const sticky = await createOk();
    await expectStatus(
      patch(sticky.id, {}),
      400,
      "Provide content or color to update",
    );
    await expectStatus(patch(sticky.id, { position: 3 }), 400);
    await expectStatus(patch(sticky.id, { color: "blue" }), 400);
  });

  it("reorders, keeping omitted stickies in their rank", async () => {
    const { createOk, list, reorder } = await stickies();
    const a = await createOk({ content: "a" });
    const b = await createOk({ content: "b" });
    const c = await createOk({ content: "c" });
    // Newest first: c (-2), b (-1), a (0).
    stickyEvents.length = 0;

    const response = await expectStatus(reorder([a.id, c.id]), 200);
    // a keeps position 0; b and c move.
    expect(await response.json()).toEqual({ reordered: 2 });
    const items = (await list()).items;
    expect(items.map((sticky) => sticky.id)).toEqual([a.id, b.id, c.id]);
    expect(items.map((sticky) => sticky.position)).toEqual([0, 1, 2]);
    expect(stickyEvents).toEqual([
      expect.objectContaining({ stickyId: null, action: "reordered" }),
    ]);

    // Already in that order: nothing moves and nothing is published.
    stickyEvents.length = 0;
    const again = await expectStatus(reorder([a.id, b.id]), 200);
    expect(await again.json()).toEqual({ reordered: 0 });
    expect(stickyEvents).toEqual([]);
  });

  it("refuses duplicate ids in a reorder", async () => {
    const { createOk, reorder } = await stickies();
    const sticky = await createOk();
    await expectStatus(reorder([sticky.id, sticky.id]), 400);
    await expectStatus(reorder([]), 400);
  });

  it("caps stickies at 500 per user and workspace", async () => {
    const { create, insertMany } = await stickies();
    await insertMany(500);
    await expectStatus(
      create(),
      409,
      "You can have up to 500 stickies in this workspace",
    );
  });

  it("publishes id-only events for every write", async () => {
    const { app, createOk, patch, user, workspaceId } = await stickies();
    const sticky = await createOk({ content: "secret plan" });
    await expectStatus(patch(sticky.id, { content: "secret plan 2" }), 200);
    await expectStatus(
      app.request(`/api/sticky/${sticky.id}?workspaceId=${workspaceId}`, {
        method: "DELETE",
      }),
      200,
    );

    expect(stickyEvents.map((event) => event.action)).toEqual([
      "created",
      "updated",
      "deleted",
    ]);
    for (const event of stickyEvents) {
      expect(event).toMatchObject({
        userId: user.id,
        workspaceId,
        stickyId: sticky.id,
      });
      expect(Object.keys(event).sort()).toEqual([
        "action",
        "initiatorId",
        "stickyId",
        "userId",
        "workspaceId",
      ]);
    }
  });

  it("tags events with the calling tab's window id", async () => {
    const { app, user, workspaceId } = await stickies();
    await expectStatus(
      app.request("/api/sticky", {
        ...json("POST", { workspaceId }),
        headers: {
          "content-type": "application/json",
          "X-Margaya-Window-Id": "tab42",
        },
      }),
      200,
    );
    expect(stickyEvents).toEqual([
      expect.objectContaining({ initiatorId: `${user.id}:tab42` }),
    ]);
  });

  it("deletes stickies for good, and with their workspace", async () => {
    const { app, createOk, list, workspaceId } = await stickies();
    const sticky = await createOk();
    const response = await expectStatus(
      app.request(`/api/sticky/${sticky.id}?workspaceId=${workspaceId}`, {
        method: "DELETE",
      }),
      200,
    );
    expect(await response.json()).toEqual({ removed: true });
    expect((await list()).items).toEqual([]);

    await createOk();
    await db
      .delete(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceId));
    const [remaining] = await db
      .select({ total: count() })
      .from(schema.stickyTable);
    expect(remaining?.total).toBe(0);
  });
});
