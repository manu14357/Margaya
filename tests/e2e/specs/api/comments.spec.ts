import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  type Task,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";

// Comments (the /comment routes and their /activity/comment twins) and the
// activity feed: only the author edits or deletes a comment, viewers cannot
// comment, and external attribution needs workspace:manage_settings.

type Activity = {
  id: string;
  taskId: string;
  type: string;
  userId: string | null;
  content: string | null;
  externalUserName: string | null;
  externalSource: string | null;
  eventData?: unknown;
};
type Comment = {
  id: string;
  taskId: string;
  userId: string;
  content: string;
  user: { id?: string; name: string };
};

let world: World;
let project: Project;
let task: Task;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Comments");
  project = await createProject(world.as("owner"), world.workspace.id);
  task = await createTask(world.as("owner"), project.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "comment on a task, list, edit and delete it",
  covers(
    "createTaskComment",
    "getTaskComments",
    "updateTaskComment",
    "deleteTaskComment",
  ),
  async () => {
    const member = world.as("member");
    const created = await expectJson<Activity>(
      await member.post(`/api/comment/${task.id}`, {
        data: { content: "First comment" },
      }),
    );
    expect(created).toMatchObject({
      taskId: task.id,
      type: "comment",
      userId: world.users.member.id,
      content: "First comment",
    });

    const comments = await expectJson<Comment[]>(
      await world.as("viewer").get(`/api/comment/${task.id}`),
    );
    const listed = comments.find((comment) => comment.id === created.id);
    expect(listed).toMatchObject({
      content: "First comment",
      userId: world.users.member.id,
    });
    expect(listed?.user.name).toBe(world.users.member.name);

    const edited = await expectJson<Activity>(
      await member.put(`/api/comment/${created.id}`, {
        data: { content: "Edited comment" },
      }),
    );
    expect(edited.content).toBe("Edited comment");

    // Only the author may edit or delete, even an admin may not.
    await expectStatus(
      await world
        .as("admin")
        .put(`/api/comment/${created.id}`, { data: { content: "Hijack" } }),
      403,
    );
    await expectStatus(
      await world.as("admin").delete(`/api/comment/${created.id}`),
      403,
    );
    const untouched = await expectJson<Comment[]>(
      await member.get(`/api/comment/${task.id}`),
    );
    expect(
      untouched.find((comment) => comment.id === created.id)?.content,
    ).toBe("Edited comment");
    await expectStatus(
      await member.put(`/api/comment/${created.id}`, { data: { content: "" } }),
      400,
    );

    const deleted = await expectJson<Activity>(
      await member.delete(`/api/comment/${created.id}`),
    );
    expect(deleted.id).toBe(created.id);
    const after = await expectJson<Comment[]>(
      await member.get(`/api/comment/${task.id}`),
    );
    expect(after.map((comment) => comment.id)).not.toContain(created.id);
    await expectStatus(
      await member.delete(`/api/comment/${created.id}`),
      [400, 404],
    );
  },
);

test("editing someone else's comment answers the documented 403", async () => {
  // A comment the caller can see but did not write is forbidden, not hidden,
  // on the /comment routes and their /activity/comment twins.
  const created = await expectJson<Activity>(
    await world
      .as("member")
      .post(`/api/comment/${task.id}`, { data: { content: "Mine" } }),
  );
  const admin = world.as("admin");
  expect(
    await expectStatus(
      await admin.put(`/api/comment/${created.id}`, {
        data: { content: "Theirs" },
      }),
      403,
    ),
  ).toContain("Only the comment's author can edit it");
  expect(
    await expectStatus(
      await admin.put("/api/activity/comment", {
        data: { activityId: created.id, comment: "Theirs" },
      }),
      403,
    ),
  ).toContain("Only the comment's author can edit it");
  expect(
    await expectStatus(await admin.delete(`/api/comment/${created.id}`), 403),
  ).toContain("Only the comment's author can delete it");
  expect(
    await expectStatus(
      await admin.delete("/api/activity/comment", {
        data: { activityId: created.id },
      }),
      403,
    ),
  ).toContain("Only the comment's author can delete it");

  const comments = await expectJson<Comment[]>(
    await world.as("member").get(`/api/comment/${task.id}`),
  );
  expect(comments.find((comment) => comment.id === created.id)?.content).toBe(
    "Mine",
  );
});

test("viewers cannot comment; empty comments are rejected", async () => {
  await expectStatus(
    await world
      .as("viewer")
      .post(`/api/comment/${task.id}`, { data: { content: "Hello" } }),
    403,
  );
  await expectStatus(
    await world
      .as("member")
      .post(`/api/comment/${task.id}`, { data: { content: "" } }),
    400,
  );
  await expectStatus(
    await world
      .as("member")
      .post("/api/comment/e2e-unknown-task", { data: { content: "x" } }),
    400,
  );
});

test("external attribution needs workspace:manage_settings", async () => {
  await expectStatus(
    await world.as("member").post(`/api/comment/${task.id}`, {
      data: {
        content: "Imported",
        externalUserName: "Jira Person",
        externalSource: "jira",
      },
    }),
    403,
  );
  const imported = await expectJson<Activity>(
    await world.as("admin").post(`/api/comment/${task.id}`, {
      data: {
        content: "Imported",
        externalUserName: "Jira Person",
        externalSource: "jira",
      },
    }),
  );
  expect(imported).toMatchObject({
    externalUserName: "Jira Person",
    externalSource: "jira",
  });
});

test(
  "activity-feed comment routes",
  covers("createComment", "updateComment", "deleteComment"),
  async () => {
    const member = world.as("member");
    const created = await expectJson<Activity>(
      await member.post("/api/activity/comment", {
        data: { taskId: task.id, comment: "Via the activity feed" },
      }),
    );
    expect(created).toMatchObject({
      type: "comment",
      content: "Via the activity feed",
    });

    const updated = await expectJson<Activity>(
      await member.put("/api/activity/comment", {
        data: { activityId: created.id, comment: "Edited via the feed" },
      }),
    );
    expect(updated.content).toBe("Edited via the feed");
    await expectStatus(
      await world.as("owner").put("/api/activity/comment", {
        data: { activityId: created.id, comment: "Not mine" },
      }),
      403,
    );
    await expectStatus(
      await member.post("/api/activity/comment", {
        data: { taskId: task.id, comment: "x".repeat(10_001) },
      }),
      400,
    );

    const deleted = await expectJson<Activity>(
      await member.delete("/api/activity/comment", {
        data: { activityId: created.id },
      }),
    );
    expect(deleted.id).toBe(created.id);
    // Once gone, the comment's workspace cannot be resolved any more.
    await expectStatus(
      await member.delete("/api/activity/comment", {
        data: { activityId: created.id },
      }),
      [400, 404],
    );
  },
);

test(
  "the activity feed records system events and integration activity",
  covers("getActivities", "createActivity"),
  async () => {
    const owner = world.as("owner");
    await expectJson(
      await owner.put(`/api/task/priority/${task.id}`, {
        data: { priority: "urgent" },
      }),
    );
    const recorded = await expectJson<Activity>(
      await world.as("member").post("/api/activity/create", {
        data: {
          taskId: task.id,
          type: "integration_event",
          message: "Linked from a script",
          eventData: { source: "e2e" },
        },
      }),
    );
    expect(recorded).toMatchObject({
      taskId: task.id,
      type: "integration_event",
    });

    const feed = await expectJson<Activity[]>(
      await world.as("viewer").get(`/api/activity/${task.id}`),
    );
    const types = feed.map((entry) => entry.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "created",
        "priority_changed",
        "integration_event",
        "comment",
      ]),
    );
    // Newest first.
    expect(feed[0]?.id).toBe(recorded.id);

    await expectStatus(
      await world.as("member").post("/api/activity/create", {
        data: { taskId: task.id, type: "comment", message: "Sneaky comment" },
      }),
      400,
    );
    await expectStatus(
      await world.as("viewer").post("/api/activity/create", {
        data: { taskId: task.id, type: "integration_event", message: "x" },
      }),
      403,
    );
  },
);
