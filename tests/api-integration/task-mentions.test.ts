import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import createComment from "../../apps/api/src/activity/controllers/create-comment";
import deleteComment from "../../apps/api/src/activity/controllers/delete-comment";
import updateComment from "../../apps/api/src/activity/controllers/update-comment";
import db, { schema } from "../../apps/api/src/database";
import {
  muteUser,
  subscribeUsers,
} from "../../apps/api/src/subscription/service";
import "../../apps/api/src/subscription";
import createTask from "../../apps/api/src/task/controllers/create-task";
import importTasks from "../../apps/api/src/task/controllers/import-tasks";
import updateTask from "../../apps/api/src/task/controllers/update-task";
import updateTaskDescription from "../../apps/api/src/task/controllers/update-task-description";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import {
  inboxScene,
  mentionOf,
  notificationsOf,
  recipientsOf,
  settledNotifications,
} from "./helpers/inbox";
import { queryScene } from "./helpers/task-query";

vi.mock("../../apps/api/src/notification-preferences/delivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

beforeEach(async () => {
  await resetTestDatabase();
});

async function indexOf(taskId: string) {
  const rows = await db
    .select({
      userId: schema.taskMentionTable.userId,
      commentId: schema.taskMentionTable.commentId,
    })
    .from(schema.taskMentionTable)
    .where(eq(schema.taskMentionTable.taskId, taskId));
  return rows
    .map((row) => `${row.commentId ?? "description"}:${row.userId}`)
    .sort();
}

describe("mention index", () => {
  it("mirrors the description and each comment, members only", async () => {
    const { ada, ben, cid, task } = await inboxScene();
    const outsider = (await createWorkspaceMember({ userName: "Out" })).user;
    const target = await task([]);

    await updateTaskDescription({
      id: target.id,
      description: `${mentionOf(ben)} ${mentionOf(outsider)}`,
      currentUserId: ada.id,
    });
    expect(await indexOf(target.id)).toEqual([`description:${ben.id}`]);

    await updateTaskDescription({
      id: target.id,
      description: `${mentionOf(cid)}`,
      currentUserId: ada.id,
    });
    expect(await indexOf(target.id)).toEqual([`description:${cid.id}`]);

    const comment = await createComment(
      target.id,
      ada.id,
      `${mentionOf(ben)} and ${mentionOf(ada)}`,
    );
    expect(await indexOf(target.id)).toEqual(
      [
        `description:${cid.id}`,
        `${comment.id}:${ben.id}`,
        `${comment.id}:${ada.id}`,
      ].sort(),
    );

    await updateComment(ada.id, comment.id, `just ${mentionOf(cid)}`);
    expect(await indexOf(target.id)).toEqual(
      [`description:${cid.id}`, `${comment.id}:${cid.id}`].sort(),
    );

    await deleteComment(ada.id, comment.id);
    expect(await indexOf(target.id)).toEqual([`description:${cid.id}`]);
  });
});

describe("newly mentioned only", () => {
  it("notifies a person added by a comment edit once, and nobody on re-save or removal", async () => {
    const { ada, ben, cid, task } = await inboxScene();
    const target = await task([]);
    const comment = await createComment(
      target.id,
      ada.id,
      `hi ${mentionOf(ben)}`,
    );
    expect(await recipientsOf(target.id)).toEqual([[ben.id, "task_mention"]]);

    const edited = `hi ${mentionOf(ben)} and ${mentionOf(cid)}`;
    await updateComment(ada.id, comment.id, edited);
    await updateComment(ada.id, comment.id, edited);
    await updateComment(ada.id, comment.id, `hi ${mentionOf(ben)}`);

    const mentions = (await notificationsOf(target.id)).filter(
      (row) => row.type === "task_mention",
    );
    expect(mentions.map((row) => row.userId).sort()).toEqual(
      [ben.id, cid.id].sort(),
    );
    const toCid = mentions.find((row) => row.userId === cid.id);
    expect(toCid?.eventData).toMatchObject({
      source: "comment",
      commentId: comment.id,
      commentPreview: "hi @Ben and @Cid",
    });
    // A comment edit sends no comment notification.
    expect(
      (await notificationsOf(target.id)).filter(
        (row) => row.type === "task_comment",
      ),
    ).toEqual([]);
  });

  it("treats the full update's description like the description route", async () => {
    const { ada, ben, project, task } = await inboxScene();
    const target = await task([]);
    const put = (description: string) =>
      updateTask(
        target.id,
        target.title,
        "to-do",
        undefined,
        undefined,
        project.id,
        description,
        "low",
        0,
        undefined,
        ada.id,
      );
    await put(`see ${mentionOf(ben)}`);
    await put(`see ${mentionOf(ben)}`);
    expect(await recipientsOf(target.id)).toEqual([[ben.id, "task_mention"]]);
    expect((await notificationsOf(target.id))[0]?.eventData).toMatchObject({
      source: "description",
      mentionerName: "Ada",
    });
    expect(await indexOf(target.id)).toEqual([`description:${ben.id}`]);
  });

  it("notifies mentions in an interactive create but only indexes an import", async () => {
    const { ada, ben, cid, project } = await inboxScene();
    const created = await createTask({
      projectId: project.id,
      currentUserId: ada.id,
      title: "With mention",
      status: "to-do",
      description: `for ${mentionOf(ben)}`,
    });
    expect(await settledNotifications(created.id, 1)).toEqual([
      [ben.id, "task_mention"],
    ]);

    const result = await importTasks(
      project.id,
      [
        {
          title: "Imported",
          status: "to-do",
          description: `for ${mentionOf(cid)}`,
        },
      ],
      ada.id,
    );
    const importedId = (result.results.tasks[0] as { task: { id: string } })
      .task.id;
    await vi.waitFor(async () =>
      expect(await indexOf(importedId)).toEqual([`description:${cid.id}`]),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await notificationsOf(importedId)).toEqual([]);
  });
});

describe("task-query keys", () => {
  it("filters by mention and by my own subscriptions", async () => {
    const s = await queryScene();
    const inDescription = await s.createTask({
      description: `hey ${mentionOf(s.owner)}`,
    });
    const inComment = await s.createTask();
    const elsewhere = await s.createTask({ description: mentionOf(s.ben) });
    await createComment(inComment.id, s.ben.id, `cc ${mentionOf(s.owner)}`);
    await db.insert(schema.taskMentionTable).values({
      taskId: inDescription.id,
      userId: s.owner.id,
    });
    await db.insert(schema.taskMentionTable).values({
      taskId: elsewhere.id,
      userId: s.ben.id,
    });

    const mentionMe = { key: "mention", operator: "in", values: ["me"] };
    expect(await s.ids(mentionMe)).toEqual(
      [inDescription.id, inComment.id].sort(),
    );
    expect(
      await s.ids({ key: "mention", operator: "notIn", values: ["me"] }),
    ).toEqual([elsewhere.id]);
    expect(
      await s.ids({ key: "mention", operator: "in", values: [s.ben.id] }),
    ).toEqual([elsewhere.id]);

    const watched = await s.createTask();
    const muted = await s.createTask();
    await subscribeUsers(watched.id, [s.owner.id], "manual");
    await subscribeUsers(muted.id, [s.owner.id], "manual");
    await muteUser(muted.id, s.owner.id);
    // Being mentioned in inComment subscribed me; Ben watches it too.
    const mine = [watched.id, inComment.id].sort();
    const subscribedMe = { key: "subscriber", operator: "in", values: ["me"] };
    expect(await s.ids(subscribedMe)).toEqual(mine);
    expect(
      await s.ids({ key: "subscriber", operator: "in", values: [s.owner.id] }),
    ).toEqual(mine);
    expect(
      await s.ids({ key: "subscriber", operator: "notIn", values: ["me"] }),
    ).not.toContain(watched.id);

    await s.refuse(
      { filters: { key: "subscriber", operator: "in", values: [s.ben.id] } },
      400,
      "You can only filter by your own subscriptions",
    );
    await s.refuse(
      { filters: { key: "subscriber", operator: "in", values: ["none"] } },
      400,
      "Unsupported value for subscriber: none",
    );
  });
});

describe("subscription rows from mentions", () => {
  it("indexes but never subscribes or notifies a self-mention", async () => {
    const { ada, task } = await inboxScene();
    const target = await task([]);
    await updateTaskDescription({
      id: target.id,
      description: mentionOf(ada),
      currentUserId: ada.id,
    });
    expect(await indexOf(target.id)).toEqual([`description:${ada.id}`]);
    expect(await notificationsOf(target.id)).toEqual([]);
    const rows = await db
      .select()
      .from(schema.taskSubscriberTable)
      .where(
        and(
          eq(schema.taskSubscriberTable.taskId, target.id),
          eq(schema.taskSubscriberTable.userId, ada.id),
        ),
      );
    expect(rows).toEqual([]);
  });
});
