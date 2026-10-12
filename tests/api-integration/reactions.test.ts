import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import createComment from "../../apps/api/src/activity/controllers/create-comment";
import deleteComment from "../../apps/api/src/activity/controllers/delete-comment";
import db, { getDatabasePool, schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import { inboxScene, recordEvents } from "./helpers/inbox";

vi.mock("../../apps/api/src/notification-preferences/delivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

const added = recordEvents("reaction.added");
const removed = recordEvents("reaction.removed");

beforeEach(async () => {
  await resetTestDatabase();
  added.length = 0;
  removed.length = 0;
});

type Group = {
  emoji: string;
  count: number;
  reacted: boolean;
  users: { id: string; name: string; image: string | null }[];
};

type TaskReactions = {
  task: Group[];
  comments: { commentId: string; groups: Group[] }[];
};

describe("task reactions", () => {
  it("adds and removes idempotently, publishing only real changes", async () => {
    const { ada, ben, task, call } = await inboxScene();
    const target = await task([]);
    const path = `/reaction/task/${target.id}/heart`;

    const first = await call(ada, "PUT", path);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual([
      {
        emoji: "heart",
        count: 1,
        reacted: true,
        users: [{ id: ada.id, name: "Ada", image: null }],
      },
    ]);
    await call(ada, "PUT", path);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      taskId: target.id,
      commentId: null,
      userId: ada.id,
      emoji: "heart",
    });

    const asBen = (await (await call(ben, "PUT", path)).json()) as Group[];
    expect(asBen).toEqual([
      expect.objectContaining({ emoji: "heart", count: 2, reacted: true }),
    ]);
    expect(asBen[0]?.users.map((user) => user.id)).toEqual([ada.id, ben.id]);

    const afterRemove = (await (
      await call(ada, "DELETE", path)
    ).json()) as Group[];
    expect(afterRemove).toEqual([
      expect.objectContaining({ emoji: "heart", count: 1, reacted: false }),
    ]);
    await call(ada, "DELETE", path);
    expect(removed).toHaveLength(1);
  });

  it("rejects keys outside the allowed set", async () => {
    const { ada, task, call } = await inboxScene();
    const target = await task([]);
    const response = await call(ada, "PUT", `/reaction/task/${target.id}/fire`);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Unsupported reaction");
  });

  it("lets viewers react and refuses outsiders", async () => {
    const { task, call, person } = await inboxScene();
    const viewer = await person("Vera", "viewer");
    const target = await task([]);
    expect(
      (await call(viewer, "PUT", `/reaction/task/${target.id}/eyes`)).status,
    ).toBe(200);
    const stranger = (await createWorkspaceMember({ userName: "Stranger" }))
      .user;
    expect(
      (await call(stranger, "PUT", `/reaction/task/${target.id}/eyes`)).status,
    ).toBe(403);
    expect(
      (await call(stranger, "GET", `/reaction/task/${target.id}`)).status,
    ).toBe(403);
  });
});

describe("comment reactions", () => {
  it("reacts to comments and returns every group of the task in one call", async () => {
    const { ada, ben, cid, task, call } = await inboxScene();
    const target = await task([]);
    const first = await createComment(target.id, ada.id, "first");
    const second = await createComment(target.id, ben.id, "second");

    await call(ben, "PUT", `/reaction/task/${target.id}/smile`);
    await call(ada, "PUT", `/reaction/comment/${first.id}/thumbs_up`);
    await call(cid, "PUT", `/reaction/comment/${first.id}/boom`);
    await call(ben, "PUT", `/reaction/comment/${first.id}/thumbs_up`);
    const onComment = (await (
      await call(ada, "PUT", `/reaction/comment/${second.id}/eyes`)
    ).json()) as Group[];
    expect(onComment).toEqual([
      expect.objectContaining({ emoji: "eyes", count: 1, reacted: true }),
    ]);
    expect(added.at(-1)).toMatchObject({ commentId: second.id });

    const all = (await (
      await call(ada, "GET", `/reaction/task/${target.id}`)
    ).json()) as TaskReactions;
    expect(all.task).toEqual([
      expect.objectContaining({ emoji: "smile", count: 1, reacted: false }),
    ]);
    const byComment = new Map(
      all.comments.map((entry) => [entry.commentId, entry.groups]),
    );
    expect(
      byComment.get(first.id)?.map((group) => [group.emoji, group.count]),
    ).toEqual([
      ["thumbs_up", 2],
      ["boom", 1],
    ]);
    expect(byComment.get(first.id)?.[0]?.reacted).toBe(true);
    expect(byComment.get(second.id)?.map((group) => group.emoji)).toEqual([
      "eyes",
    ]);
  });

  it("answers 404 for an activity that is not a comment, 403 across workspaces", async () => {
    const { ada, task, call } = await inboxScene();
    const target = await task([]);
    const [activity] = await db
      .insert(schema.activityTable)
      .values({ taskId: target.id, type: "created", userId: ada.id })
      .returning();
    const notComment = await call(
      ada,
      "PUT",
      `/reaction/comment/${activity?.id}/heart`,
    );
    expect(notComment.status).toBe(404);
    expect(await notComment.text()).toBe("Comment not found");

    const other = await inboxScene();
    const foreignTask = await other.task([]);
    const foreign = await createComment(foreignTask.id, other.ada.id, "theirs");
    expect(
      (await call(ada, "PUT", `/reaction/comment/${foreign.id}/heart`)).status,
    ).toBe(403);
  });

  it("cascades with the comment and the task", async () => {
    const { ada, task, call } = await inboxScene();
    const target = await task([]);
    const comment = await createComment(target.id, ada.id, "bye");
    await call(ada, "PUT", `/reaction/comment/${comment.id}/heart`);
    await call(ada, "PUT", `/reaction/task/${target.id}/heart`);

    await deleteComment(ada.id, comment.id);
    const remaining = await db
      .select({ commentId: schema.reactionTable.commentId })
      .from(schema.reactionTable)
      .where(eq(schema.reactionTable.taskId, target.id));
    expect(remaining).toEqual([{ commentId: null }]);

    await db.delete(schema.taskTable).where(eq(schema.taskTable.id, target.id));
    expect(await db.select().from(schema.reactionTable)).toEqual([]);
  });
});

describe("statement budget", () => {
  it("loads a task's reactions with the same statements for 1 and 20 comments", async () => {
    const { ada, ben, task, call } = await inboxScene();

    async function statementsFor(comments: number) {
      const target = await task([]);
      for (let i = 0; i < comments; i += 1) {
        const comment = await createComment(target.id, ben.id, `c${i}`);
        await db.insert(schema.reactionTable).values({
          taskId: target.id,
          commentId: comment.id,
          userId: ada.id,
          emoji: "heart",
        });
      }
      // Let background comment subscribers finish before counting.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const spy = vi.spyOn(getDatabasePool(), "query");
      const before = spy.mock.calls.length;
      const response = await call(ada, "GET", `/reaction/task/${target.id}`);
      const body = (await response.json()) as TaskReactions;
      const count = spy.mock.calls.length - before;
      spy.mockRestore();
      expect(body.comments).toHaveLength(comments);
      return count;
    }

    expect(await statementsFor(20)).toBe(await statementsFor(1));
  });
});
