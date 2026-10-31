import { and, eq, ne } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { muteUser } from "../../apps/api/src/subscription/service";
import { withParentDeletedOnReply } from "./helpers/comment-race";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";
import { recordEvents } from "./helpers/inbox";
import { callMcpTool } from "./helpers/trash";

type Scene = Awaited<ReturnType<typeof draftScene>>;
type CommentJson = { id: string; parentId: string | null; content: string };

const created = recordEvents("notification.created");

beforeEach(async () => {
  await resetTestDatabase();
  created.length = 0;
});

async function threadScene() {
  const s = await draftScene();
  const task = await s.ok<{ id: string }>(
    s.mia,
    "POST",
    `/task/${s.web.project.id}`,
    {
      title: "Threads",
      description: "",
      status: "to-do",
      priority: "low",
      assigneeIds: [],
    },
  );
  const other = await s.ok<{ id: string }>(
    s.mia,
    "POST",
    `/task/${s.web.project.id}`,
    {
      title: "Elsewhere",
      description: "",
      status: "to-do",
      priority: "low",
      assigneeIds: [],
    },
  );
  return { s, task, other };
}

const comment = (
  s: Scene,
  user: Scene["mia"],
  taskId: string,
  content: string,
  parentId?: string,
) =>
  s.ok<CommentJson>(user, "POST", `/comment/${taskId}`, {
    content,
    ...(parentId ? { parentId } : {}),
  });

async function commentNotifications(userId: string) {
  return db
    .select()
    .from(schema.notificationTable)
    .where(
      and(
        eq(schema.notificationTable.userId, userId),
        eq(schema.notificationTable.type, "task_comment"),
      ),
    );
}

describe("API integration: comment threads", () => {
  it("stores replies under their comment and lists them with parentId", async () => {
    const { s, task } = await threadScene();
    const parent = await comment(s, s.mia, task.id, "Top-level");
    expect(parent.parentId).toBeNull();

    const reply = await comment(s, s.ada, task.id, "First reply", parent.id);
    expect(reply.parentId).toBe(parent.id);

    // The activity-feed route takes a parent too.
    const viaFeed = await s.ok<CommentJson>(
      s.owner,
      "POST",
      "/activity/comment",
      {
        taskId: task.id,
        comment: "Second reply",
        parentId: parent.id,
      },
    );
    expect(viaFeed.parentId).toBe(parent.id);

    const listed = await s.ok<CommentJson[]>(
      s.vic,
      "GET",
      `/comment/${task.id}`,
    );
    expect(listed.map((c) => [c.content, c.parentId])).toEqual([
      ["Top-level", null],
      ["First reply", parent.id],
      ["Second reply", parent.id],
    ]);

    const feed = await s.ok<(CommentJson & { type: string })[]>(
      s.vic,
      "GET",
      `/activity/${task.id}`,
    );
    expect(
      feed.filter((row) => row.type === "comment").map((row) => row.parentId),
    ).toEqual(expect.arrayContaining([null, parent.id, parent.id]));
  });

  it("attaches a reply to a reply to the top-level comment", async () => {
    const { s, task } = await threadScene();
    const parent = await comment(s, s.mia, task.id, "Top-level");
    const reply = await comment(s, s.ada, task.id, "Reply", parent.id);
    const nested = await comment(
      s,
      s.owner,
      task.id,
      "Reply to reply",
      reply.id,
    );
    expect(nested.parentId).toBe(parent.id);
  });

  it("refuses a parent that is not a comment of the same task", async () => {
    const { s, task, other } = await threadScene();
    const elsewhere = await comment(s, s.mia, other.id, "On another task");
    const [history] = await db
      .select({ id: schema.activityTable.id })
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.taskId, task.id),
          ne(schema.activityTable.type, "comment"),
        ),
      );

    for (const parentId of [elsewhere.id, "missing", history?.id ?? "x"]) {
      const response = await s.as(s.mia)("POST", `/comment/${task.id}`, {
        content: "Reply",
        parentId,
      });
      expect(response.status, parentId).toBe(404);
      const feed = await s.as(s.mia)("POST", "/activity/comment", {
        taskId: task.id,
        comment: "Reply",
        parentId,
      });
      expect(feed.status, parentId).toBe(404);
    }
    const stored = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.content, "Reply"));
    expect(stored).toHaveLength(0);
  });

  it("lets only people who may comment reply", async () => {
    const { s, task } = await threadScene();
    const parent = await comment(s, s.mia, task.id, "Top-level");
    const viewer = await s.as(s.vic)("POST", `/comment/${task.id}`, {
      content: "Viewer reply",
      parentId: parent.id,
    });
    expect(viewer.status).toBe(403);
    const outsider = await s.as(s.outsider)("POST", `/comment/${task.id}`, {
      content: "Outsider reply",
      parentId: parent.id,
    });
    expect(outsider.status).toBe(403);
  });

  it("notifies the people in the thread, never the replier", async () => {
    const { s, task } = await threadScene();
    const parent = await comment(s, s.ada, task.id, "Top-level by Ada");
    // Ada stopped watching without muting (her row is gone): the thread
    // still reaches her.
    await db
      .delete(schema.taskSubscriberTable)
      .where(
        and(
          eq(schema.taskSubscriberTable.taskId, task.id),
          eq(schema.taskSubscriberTable.userId, s.ada.id),
        ),
      );

    const reply = await comment(
      s,
      s.owner,
      task.id,
      "Owner replies",
      parent.id,
    );
    const toAda = await commentNotifications(s.ada.id);
    expect(toAda).toHaveLength(1);
    expect(toAda[0]?.eventData).toMatchObject({
      commentId: reply.id,
      parentCommentId: parent.id,
      commentPreview: "Owner replies",
    });
    expect(await commentNotifications(s.owner.id)).toHaveLength(0);
    // The realtime hint flags it as a reply (the web app's reply sound).
    expect(created).toContainEqual(
      expect.objectContaining({
        notificationId: toAda[0]?.id,
        userId: s.ada.id,
        notificationType: "task_comment",
        reply: true,
        needsInput: false,
      }),
    );

    // Owner is in the thread now; Ada answers and only Owner hears of it
    // from the thread (Ada never notifies herself).
    await comment(s, s.ada, task.id, "Ada answers", parent.id);
    expect(await commentNotifications(s.ada.id)).toHaveLength(1);
    const toOwner = await commentNotifications(s.owner.id);
    expect(toOwner).toHaveLength(1);
    expect(toOwner[0]?.eventData).toMatchObject({ parentCommentId: parent.id });

    // Muting the task silences the thread too.
    await muteUser(task.id, s.ada.id);
    await comment(s, s.owner, task.id, "Muted?", parent.id);
    expect(await commentNotifications(s.ada.id)).toHaveLength(1);
  });

  it("keeps the replies when their comment is deleted", async () => {
    const { s, task } = await threadScene();
    const parent = await comment(s, s.mia, task.id, "Top-level");
    const reply = await comment(s, s.ada, task.id, "Still here", parent.id);

    // Only the author deletes; the replies are someone else's words.
    expect((await s.as(s.ada)("DELETE", `/comment/${parent.id}`)).status).toBe(
      403,
    );
    await s.ok(s.mia, "DELETE", `/comment/${parent.id}`);

    const listed = await s.ok<CommentJson[]>(
      s.mia,
      "GET",
      `/comment/${task.id}`,
    );
    expect(listed).toEqual([
      expect.objectContaining({ id: reply.id, parentId: null }),
    ]);
  });

  it("edits and deletes a reply like any comment", async () => {
    const { s, task } = await threadScene();
    const parent = await comment(s, s.mia, task.id, "Top-level");
    const reply = await comment(s, s.ada, task.id, "Typo", parent.id);
    const edited = await s.ok<CommentJson>(
      s.ada,
      "PUT",
      `/comment/${reply.id}`,
      {
        content: "Fixed",
      },
    );
    expect(edited).toMatchObject({ content: "Fixed", parentId: parent.id });
    expect(
      (await s.as(s.mia)("PUT", `/comment/${reply.id}`, { content: "Mine" }))
        .status,
    ).toBe(403);
    await s.ok(s.ada, "DELETE", `/comment/${reply.id}`);
    const listed = await s.ok<CommentJson[]>(
      s.mia,
      "GET",
      `/comment/${task.id}`,
    );
    expect(listed.map((c) => c.id)).toEqual([parent.id]);
  });

  it("answers 404 when the parent is deleted just before the reply is stored", async () => {
    const { s, task } = await threadScene();
    const first = await comment(s, s.mia, task.id, "Gone soon");
    const second = await comment(s, s.mia, task.id, "Also gone soon");
    const third = await comment(s, s.mia, task.id, "Gone for MCP too");

    const viaComment = await withParentDeletedOnReply(first.id, () =>
      s.as(s.ada)("POST", `/comment/${task.id}`, {
        content: "Racing reply",
        parentId: first.id,
      }),
    );
    expect(viaComment.status).toBe(404);
    expect(await viaComment.text()).toBe("Parent comment not found");

    const viaFeed = await withParentDeletedOnReply(second.id, () =>
      s.as(s.ada)("POST", "/activity/comment", {
        taskId: task.id,
        comment: "Racing reply",
        parentId: second.id,
      }),
    );
    expect(viaFeed.status).toBe(404);
    expect(await viaFeed.text()).toBe("Parent comment not found");

    const viaMcp = await withParentDeletedOnReply(third.id, () =>
      callMcpTool(s.app, s.ada.id, "create_task_comment", {
        taskId: task.id,
        content: "Racing reply",
        parentId: third.id,
      }),
    );
    expect(viaMcp.isError).toBe(true);
    expect(viaMcp.text).toContain("Parent comment not found");

    const stored = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.content, "Racing reply"));
    expect(stored).toHaveLength(0);
    // Only the parent was lost; comments on the task still work.
    const fine = await comment(s, s.ada, task.id, "After the race");
    expect(fine.parentId).toBeNull();
  });
});

describe("API integration: public replies", () => {
  async function publicScene() {
    const scene = await threadScene();
    await db.insert(schema.projectPublicationTable).values({
      projectId: scene.s.web.project.id,
      linkToken: `token-${scene.s.web.project.id}`,
      publishedAt: new Date(),
      commentsEnabled: true,
    });
    return scene;
  }

  const publicComment = (
    s: Scene,
    user: Scene["mia"],
    taskId: string,
    content: string,
    parentId?: string,
  ) =>
    s.as(user)("POST", `/comment/${taskId}`, {
      content,
      visibility: "public",
      ...(parentId ? { parentId } : {}),
    });

  it("stores a public reply under a public comment", async () => {
    const { s, task } = await publicScene();
    const parent = (await (
      await publicComment(s, s.mia, task.id, "Public question")
    ).json()) as CommentJson & { visibility: string };
    expect(parent.visibility).toBe("public");

    const reply = await publicComment(
      s,
      s.ada,
      task.id,
      "Public answer",
      parent.id,
    );
    expect(reply.status, await reply.clone().text()).toBe(200);
    expect(await reply.json()).toMatchObject({
      parentId: parent.id,
      visibility: "public",
    });
    // An internal reply under a public comment stays allowed.
    const internal = await comment(s, s.owner, task.id, "Team note", parent.id);
    expect(internal.parentId).toBe(parent.id);
  });

  it("refuses a public reply to an internal comment, also via a reply", async () => {
    const { s, task } = await publicScene();
    const parent = await comment(s, s.mia, task.id, "Internal question");
    const reply = await comment(
      s,
      s.ada,
      task.id,
      "Internal answer",
      parent.id,
    );

    for (const parentId of [parent.id, reply.id]) {
      const response = await publicComment(
        s,
        s.owner,
        task.id,
        "Public answer",
        parentId,
      );
      expect(response.status, parentId).toBe(400);
      expect(await response.text()).toBe(
        "A reply can only be public when the comment it answers is public",
      );
    }
    const stored = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.content, "Public answer"));
    expect(stored).toHaveLength(0);
  });

  it("makes a reply public only while its comment is public", async () => {
    const { s, task } = await publicScene();
    const parent = await comment(s, s.mia, task.id, "Internal question");
    const reply = await comment(s, s.ada, task.id, "Answer", parent.id);
    const visibilityPath = (id: string) =>
      `/publication/comment/${id}/visibility`;

    const refused = await s.as(s.ada)("PATCH", visibilityPath(reply.id), {
      visibility: "public",
    });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toBe(
      "A reply can only be public when the comment it answers is public",
    );

    await s.ok(s.mia, "PATCH", visibilityPath(parent.id), {
      visibility: "public",
    });
    expect(
      await s.ok<{ visibility: string }>(
        s.ada,
        "PATCH",
        visibilityPath(reply.id),
        { visibility: "public" },
      ),
    ).toMatchObject({ visibility: "public" });
    // Back to internal is always allowed.
    expect(
      await s.ok<{ visibility: string }>(
        s.ada,
        "PATCH",
        visibilityPath(reply.id),
        { visibility: "internal" },
      ),
    ).toMatchObject({ visibility: "internal" });
  });
});
