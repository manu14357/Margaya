import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { setPublicBoardInstanceState } from "../../apps/api/src/public-board/instance-state";
import { resetTestDatabase } from "./helpers/database";
import {
  ALL_ON,
  boardScene,
  json,
  resetPublicBoardState,
} from "./helpers/public-board";

const { readObject } = vi.hoisted(() => ({
  readObject: vi.fn(async () => ({
    body: new Uint8Array([1, 2, 3]),
    contentType: "image/png",
    contentLength: 3,
  })),
}));
vi.mock("../../apps/api/src/storage/s3", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getPrivateObject: readObject,
}));

beforeEach(async () => {
  await resetTestDatabase();
  resetPublicBoardState();
});
afterAll(() => setPublicBoardInstanceState(null));

async function scene() {
  const base = await boardScene();
  const token = await base.publish(ALL_ON);
  const task = await base.createTask("Moderated");
  const post = async (user: Parameters<typeof base.as>[0], content: string) => {
    const response = await base.as(user)(
      `/public-board/${token}/tasks/${task.number}/comments`,
      json("POST", { content }),
    );
    expect(response.status, await response.clone().text()).toBe(201);
    return ((await response.json()) as { id: string }).id;
  };
  const appComment = async (
    user: Parameters<typeof base.as>[0],
    content: string,
    visibility?: string,
  ) =>
    base.as(user)(
      `/comment/${task.id}`,
      json("POST", { content, ...(visibility ? { visibility } : {}) }),
    );
  const visibility = (
    user: Parameters<typeof base.as>[0],
    id: string,
    value: "internal" | "public",
  ) =>
    base.as(user)(
      `/publication/comment/${id}/visibility`,
      json("PATCH", { visibility: value }),
    );
  return { ...base, token, task, post, appComment, visibility };
}

describe("public board moderation", () => {
  it("lists public comments newest first with author kinds", async () => {
    const s = await scene();
    await s.post(s.outsider, "from outside");
    await s.post(s.member, "from a member");
    await s.post(s.guest, "from a guest");
    await s.appComment(s.owner, "internal only");
    const response = await s.as(s.owner)(
      `/publication/project/${s.project.id}/comments`,
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      items: Array<{ excerpt: string; author: { kind: string } | null }>;
    };
    expect(page.items.map((item) => [item.excerpt, item.author?.kind])).toEqual(
      [
        ["from a guest", "guest"],
        ["from a member", "member"],
        ["from outside", "external"],
      ],
    );
  });

  it("lets authors publish their own comments only while the board takes comments", async () => {
    const s = await scene();
    const created = await s.appComment(s.member, "member note", "public");
    expect(created.status, await created.clone().text()).toBe(200);
    const { id } = (await created.json()) as { id: string };
    const [row] = await db
      .select({
        visibility: schema.activityTable.visibility,
        updatedAt: schema.activityTable.updatedAt,
      })
      .from(schema.activityTable)
      .where(eq(schema.activityTable.id, id));
    expect(row?.visibility).toBe("public");

    expect((await s.visibility(s.member, id, "internal")).status).toBe(200);
    expect((await s.visibility(s.member, id, "public")).status).toBe(200);
    // A visibility change is not an edit: the "(edited)" marker reads updatedAt.
    const [after] = await db
      .select({ updatedAt: schema.activityTable.updatedAt })
      .from(schema.activityTable)
      .where(eq(schema.activityTable.id, id));
    expect(after?.updatedAt.getTime()).toBe(row?.updatedAt.getTime());
    // Another member can't touch it; a moderator can hide it.
    const other = await s.appComment(s.owner, "owner note");
    const otherId = ((await other.json()) as { id: string }).id;
    const refused = await s.visibility(s.member, otherId, "public");
    expect(refused.status).toBe(403);
    expect(await refused.text()).toBe(
      "Only the author can change this comment's visibility",
    );
    expect((await s.visibility(s.owner, id, "internal")).status).toBe(200);

    await s.as(s.owner)(`/publication/project/${s.project.id}`, {
      ...json("PATCH", { commentsEnabled: false }),
    });
    const closed = await s.visibility(s.member, id, "public");
    expect(closed.status).toBe(409);
    expect(await closed.text()).toBe(
      "Public comments need a published board with comments turned on",
    );
    const appClosed = await s.appComment(s.member, "again", "public");
    expect(appClosed.status).toBe(409);
  });

  it("removes public comments but not internal ones", async () => {
    const s = await scene();
    const id = await s.post(s.outsider, "spam");
    const internal = await s.appComment(s.member, "keep");
    const internalId = ((await internal.json()) as { id: string }).id;
    expect(
      (await s.as(s.owner)(`/publication/comment/${id}`, { method: "DELETE" }))
        .status,
    ).toBe(200);
    const refused = await s.as(s.owner)(`/publication/comment/${internalId}`, {
      method: "DELETE",
    });
    expect(refused.status).toBe(403);
    expect(await refused.text()).toBe(
      "Moderators can only remove public comments",
    );
  });

  it("blocks and unblocks participants, optionally hiding their comments", async () => {
    const s = await scene();
    await s.post(s.outsider, "one");
    await s.post(s.outsider, "two");
    const blocks = `/publication/project/${s.project.id}/blocks`;
    const self = await s.as(s.owner)(
      `${blocks}/${s.owner.id}`,
      json("PUT", {}),
    );
    expect(self.status).toBe(400);
    expect(
      (await s.as(s.owner)(`${blocks}/nobody-${randomUUID()}`, json("PUT", {})))
        .status,
    ).toBe(404);
    expect(
      (await s.as(s.member)(`${blocks}/${s.outsider.id}`, json("PUT", {})))
        .status,
    ).toBe(403);

    const blocked = await s.as(s.owner)(
      `${blocks}/${s.outsider.id}`,
      json("PUT", { hideComments: true }),
    );
    expect(blocked.status, await blocked.clone().text()).toBe(200);
    expect(await blocked.json()).toMatchObject({ hiddenComments: 2 });
    const again = await s.as(s.owner)(
      `${blocks}/${s.outsider.id}`,
      json("PUT", {}),
    );
    expect(again.status).toBe(200);

    const list = await s.as(s.owner)(blocks);
    expect(((await list.json()) as unknown[]).length).toBe(1);
    const write = await s.as(s.outsider)(
      `/public-board/${s.token}/tasks/${s.task.number}/vote`,
      json("PUT", { value: 1 }),
    );
    expect(write.status).toBe(403);
    expect((await s.as(s.outsider)(`/public-board/${s.token}`)).status).toBe(
      200,
    );
    const comments = (await (
      await s.as(null)(
        `/public-board/${s.token}/tasks/${s.task.number}/comments`,
      )
    ).json()) as { items: unknown[] };
    expect(comments.items).toHaveLength(0);

    expect(
      (await s.as(s.owner)(`${blocks}/${s.outsider.id}`, { method: "DELETE" }))
        .status,
    ).toBe(200);
    const after = await s.as(s.outsider)(
      `/public-board/${s.token}/tasks/${s.task.number}/vote`,
      json("PUT", { value: 1 }),
    );
    expect(after.status).toBe(200);
  });

  it("serves a public comment's image without a session until it is hidden", async () => {
    const s = await scene();
    const [asset] = await db
      .insert(schema.assetTable)
      .values({
        workspaceId: s.workspaceId,
        projectId: s.project.id,
        taskId: s.task.id,
        objectKey: randomUUID(),
        filename: "shot.png",
        mimeType: "image/png",
        size: 3,
        surface: "comment",
        createdBy: s.member.id,
      })
      .returning();
    const created = await s.appComment(
      s.member,
      `see ![shot](/api/asset/${asset?.id})`,
      "public",
    );
    const { id } = (await created.json()) as { id: string };
    expect((await s.as(null)(`/asset/${asset?.id}`)).status).toBe(200);
    await s.visibility(s.owner, id, "internal");
    expect((await s.as(null)(`/asset/${asset?.id}`)).status).toBe(401);
  });
});
