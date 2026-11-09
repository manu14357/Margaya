import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  eventually,
  expectJson,
  expectStatus,
  type Project,
  type World,
} from "../../helpers/api-kit";
import { covers, skipUnlessDeployed } from "../../helpers/openapi";

// Task subscriptions (watching) and reactions on tasks and comments.

type Subscription = {
  taskId: string;
  subscribed: boolean;
  reason: string | null;
  isAssignee: boolean;
  isMuted: boolean;
  subscriberCount: number;
};
type ReactionGroup = {
  emoji: string;
  count: number;
  reacted: boolean;
  users: { id: string; name: string }[];
};

let world: World;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Watchers");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "watch a task, hear about its status changes, then stop",
  covers("getTaskSubscription", "subscribeToTask", "unsubscribeFromTask"),
  async () => {
    await skipUnlessDeployed(
      "getTaskSubscription",
      "subscribeToTask",
      "unsubscribeFromTask",
    );
    const viewer = world.as("viewer");
    const owner = world.as("owner");
    const task = await createTask(owner, project.id);

    // The creator is subscribed by a task.created event subscriber, so the
    // row appears shortly after the create call returns.
    await expect
      .poll(async () =>
        expectJson<Subscription>(
          await owner.get(`/api/subscription/task/${task.id}`),
        ),
      )
      .toMatchObject({ subscribed: true, reason: "creator" });

    const before = await expectJson<Subscription>(
      await viewer.get(`/api/subscription/task/${task.id}`),
    );
    expect(before).toMatchObject({
      taskId: task.id,
      subscribed: false,
      isAssignee: false,
    });

    const watching = await expectJson<Subscription>(
      await viewer.put(`/api/subscription/task/${task.id}`),
    );
    expect(watching).toMatchObject({ subscribed: true, reason: "manual" });
    expect(watching.subscriberCount).toBe(before.subscriberCount + 1);
    // Idempotent.
    expect(
      (
        await expectJson<Subscription>(
          await viewer.put(`/api/subscription/task/${task.id}`),
        )
      ).subscriberCount,
    ).toBe(watching.subscriberCount);

    await expectJson(
      await owner.put(`/api/task/status/${task.id}`, {
        data: { status: "in-progress" },
      }),
    );
    await eventually(
      async () => {
        const list = await expectJson<{ resourceId: string; type: string }[]>(
          await viewer.get("/api/notification"),
        );
        return list.find(
          (entry) =>
            entry.resourceId === task.id &&
            entry.type === "task_status_changed",
        );
      },
      { what: "the watcher's status notification" },
    );

    const stopped = await expectJson<Subscription>(
      await viewer.delete(`/api/subscription/task/${task.id}`),
    );
    expect(stopped).toMatchObject({ subscribed: false, isMuted: true });
    await expectJson(
      await owner.put(`/api/task/status/${task.id}`, {
        data: { status: "in-review" },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const after = await expectJson<
      { resourceId: string; type: string; eventData?: { newStatus?: string } }[]
    >(await viewer.get("/api/notification"));
    expect(
      after.filter(
        (entry) =>
          entry.resourceId === task.id &&
          entry.eventData?.newStatus === "in-review",
      ),
    ).toEqual([]);

    await expectStatus(
      await viewer.get("/api/subscription/task/e2e-unknown-task"),
      404,
    );
    await expectStatus(
      await world.as("anonymous").put(`/api/subscription/task/${task.id}`),
      401,
    );
  },
);

test(
  "react to a task and to a comment",
  covers(
    "getTaskReactions",
    "addTaskReaction",
    "removeTaskReaction",
    "addCommentReaction",
    "removeCommentReaction",
  ),
  async () => {
    await skipUnlessDeployed(
      "getTaskReactions",
      "addTaskReaction",
      "removeTaskReaction",
      "addCommentReaction",
      "removeCommentReaction",
    );
    const member = world.as("member");
    const viewer = world.as("viewer");
    const task = await createTask(world.as("owner"), project.id);

    const afterMember = await expectJson<ReactionGroup[]>(
      await member.put(`/api/reaction/task/${task.id}/thumbs_up`),
    );
    expect(afterMember).toEqual([
      expect.objectContaining({ emoji: "thumbs_up", count: 1, reacted: true }),
    ]);
    // Viewers hold task:read, which is all reacting needs.
    const afterViewer = await expectJson<ReactionGroup[]>(
      await viewer.put(`/api/reaction/task/${task.id}/thumbs_up`),
    );
    expect(afterViewer[0]).toMatchObject({ count: 2, reacted: true });
    expect(afterViewer[0]?.users.map((user) => user.id)).toEqual([
      world.users.member.id,
      world.users.viewer.id,
    ]);
    // Idempotent.
    expect(
      (
        await expectJson<ReactionGroup[]>(
          await viewer.put(`/api/reaction/task/${task.id}/thumbs_up`),
        )
      )[0]?.count,
    ).toBe(2);
    await expectStatus(
      await viewer.put(`/api/reaction/task/${task.id}/party_parrot`),
      400,
    );

    const comment = await expectJson<{ id: string }>(
      await member.post(`/api/comment/${task.id}`, {
        data: { content: "React to me" },
      }),
    );
    const onComment = await expectJson<ReactionGroup[]>(
      await viewer.put(`/api/reaction/comment/${comment.id}/heart`),
    );
    expect(onComment).toEqual([
      expect.objectContaining({ emoji: "heart", count: 1, reacted: true }),
    ]);

    const all = await expectJson<{
      task: ReactionGroup[];
      comments: {
        commentId?: string;
        id?: string;
        reactions: ReactionGroup[];
      }[];
    }>(await member.get(`/api/reaction/task/${task.id}`));
    expect(all.task[0]).toMatchObject({
      emoji: "thumbs_up",
      count: 2,
      reacted: true,
    });
    expect(JSON.stringify(all.comments)).toContain(comment.id);

    const removed = await expectJson<ReactionGroup[]>(
      await viewer.delete(`/api/reaction/task/${task.id}/thumbs_up`),
    );
    expect(removed[0]).toMatchObject({ count: 1, reacted: false });
    const commentRemoved = await expectJson<ReactionGroup[]>(
      await viewer.delete(`/api/reaction/comment/${comment.id}/heart`),
    );
    expect(commentRemoved).toEqual([]);
    await expectStatus(
      await viewer.put("/api/reaction/comment/e2e-unknown-comment/heart"),
      404,
    );
  },
);
