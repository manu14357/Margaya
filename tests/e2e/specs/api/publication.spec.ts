import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  signUpUser,
  type Task,
  type TestUser,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Public boards: the publisher's /publication routes (publish, settings,
// moderation, blocks, rotation, unpublish) and the visitor-facing
// /public-board routes (read, comment, react, vote, request).

type Publication = {
  published: boolean;
  linkToken: string | null;
  path: string | null;
  commentsEnabled?: boolean;
};
type PublicComment = { id: string; content?: string };

let world: World;
let project: Project;
let task: Task;
let outsider: TestUser;
let token = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Publish");
  project = await createProject(world.as("owner"), world.workspace.id);
  // Board requests land in Intake.
  await expectJson(
    await world.as("owner").patch(`/api/project/${project.id}/features`, {
      data: { intakeEnabled: true },
    }),
  );
  task = await createTask(world.as("owner"), project.id, {
    title: uniqueName("Public task"),
    description: "Readable by anyone with the link.",
  });
  outsider = await signUpUser("Board visitor");
});

test.afterAll(async () => {
  await outsider?.ctx.dispose();
  await world?.dispose();
});

const board = (path = "") => `/api/public-board/${token}${path}`;

test(
  "the publisher publishes, reads and changes the board settings",
  covers("publishProject", "getProjectPublication", "updateProjectPublication"),
  async () => {
    const owner = world.as("owner");
    await expectStatus(
      await world
        .as("member")
        .post(`/api/publication/project/${project.id}/publish`, { data: {} }),
      403,
    );
    const published = await expectJson<Publication>(
      await owner.post(`/api/publication/project/${project.id}/publish`, {
        data: {
          commentsEnabled: true,
          reactionsEnabled: true,
          votesEnabled: true,
          requestsEnabled: true,
        },
      }),
    );
    expect(published.published).toBe(true);
    token = published.linkToken ?? "";
    expect(token).not.toBe("");

    const read = await expectJson<Publication>(
      await owner.get(`/api/publication/project/${project.id}`),
    );
    expect(read.linkToken).toBe(token);

    const updated = await expectJson<Publication & { showBacklog?: boolean }>(
      await owner.patch(`/api/publication/project/${project.id}`, {
        data: { showBacklog: true },
      }),
    );
    expect(updated.showBacklog).toBe(true);
  },
);

test(
  "anyone with the link reads the board, its tasks and descriptions",
  covers(
    "getPublicBoard",
    "listPublicBoardTasks",
    "getPublicBoardTask",
    "getPublicBoardTaskDescription",
    "listPublicBoardComments",
  ),
  async () => {
    const anonymous = world.anonymous;
    const info = await expectJson<{
      project: { name: string };
      board: { comments: boolean; votes: boolean };
    }>(await anonymous.get(board()));
    expect(info.project.name).toBe(project.name);
    expect(info.board).toMatchObject({ comments: true, votes: true });

    const tasks = await expectJson<{ totalCount: number; tasks: object }>(
      await anonymous.get(board("/tasks")),
    );
    expect(tasks.totalCount).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(tasks.tasks)).toContain(task.title);

    const one = await expectJson<{ title?: string }>(
      await anonymous.get(board(`/tasks/${task.number}`)),
    );
    expect(JSON.stringify(one)).toContain(task.title);
    const description = await expectJson<{ content: string }>(
      await anonymous.get(board(`/tasks/${task.number}/description`)),
    );
    expect(description.content).toContain("Readable by anyone");
    await expectJson(
      await anonymous.get(board(`/tasks/${task.number}/comments`)),
    );

    await expectStatus(
      await anonymous.get("/api/public-board/not-a-real-token"),
      404,
    );
  },
);

test(
  "a signed-in visitor comments, reacts, votes and files a request",
  covers(
    "createPublicBoardComment",
    "updatePublicBoardComment",
    "deletePublicBoardComment",
    "addPublicBoardTaskReaction",
    "removePublicBoardTaskReaction",
    "addPublicBoardCommentReaction",
    "removePublicBoardCommentReaction",
    "setPublicBoardVote",
    "removePublicBoardVote",
    "submitPublicBoardRequest",
    "listMyPublicBoardRequests",
    "withdrawPublicBoardRequest",
    "getTaskVotes",
  ),
  async () => {
    const visitor = outsider.ctx;
    // Taking part needs an account.
    await expectStatus(
      await world.anonymous.post(board(`/tasks/${task.number}/comments`), {
        data: { content: "Anonymous" },
      }),
      401,
    );

    const comment = await expectJson<PublicComment>(
      await visitor.post(board(`/tasks/${task.number}/comments`), {
        data: { content: "Looking forward to this" },
      }),
      201,
    );
    await expectJson(
      await visitor.patch(board(`/comments/${comment.id}`), {
        data: { content: "Really looking forward to this" },
      }),
    );
    const comments = await (
      await world.anonymous.get(board(`/tasks/${task.number}/comments`))
    ).text();
    expect(comments).toContain("Really looking forward to this");

    await expectJson(
      await visitor.put(board(`/tasks/${task.number}/reactions/thumbs_up`)),
    );
    await expectJson(
      await visitor.delete(board(`/tasks/${task.number}/reactions/thumbs_up`)),
    );
    await expectJson(
      await visitor.put(board(`/comments/${comment.id}/reactions/heart`)),
    );
    await expectJson(
      await visitor.delete(board(`/comments/${comment.id}/reactions/heart`)),
    );

    await expectJson(
      await visitor.put(board(`/tasks/${task.number}/vote`), {
        data: { value: 1 },
      }),
    );
    const votes = await expectJson<{ up: number; score: number }>(
      await world.as("member").get(`/api/publication/task/${task.id}/votes`),
    );
    expect(votes).toMatchObject({ up: 1, score: 1 });
    await expectJson(await visitor.delete(board(`/tasks/${task.number}/vote`)));
    const cleared = await expectJson<{ up: number }>(
      await world.as("member").get(`/api/publication/task/${task.id}/votes`),
    );
    expect(cleared.up).toBe(0);

    const request = await expectJson<{ id: string; status: string }>(
      await visitor.post(board("/requests"), {
        data: { title: uniqueName("Request"), description: "Please add it" },
      }),
      201,
    );
    expect(request.status).toBe("in_review");
    const mine = await expectJson<{ items: { id: string }[] }>(
      await visitor.get(board("/requests/mine")),
    );
    expect(mine.items.map((item) => item.id)).toContain(request.id);
    await expectJson(await visitor.delete(board(`/requests/${request.id}`)));

    await expectJson(await visitor.delete(board(`/comments/${comment.id}`)));
    expect(
      await (
        await world.anonymous.get(board(`/tasks/${task.number}/comments`))
      ).text(),
    ).not.toContain("Really looking forward to this");
  },
);

test(
  "the publisher moderates comments and blocks a participant",
  covers(
    "listProjectPublicComments",
    "setCommentVisibility",
    "moderatorDeleteComment",
    "listPublicBoardBlocks",
    "blockPublicBoardParticipant",
    "unblockPublicBoardParticipant",
  ),
  async () => {
    const owner = world.as("owner");
    const visitor = outsider.ctx;
    const first = await expectJson<PublicComment>(
      await visitor.post(board(`/tasks/${task.number}/comments`), {
        data: { content: "First public comment" },
      }),
      201,
    );
    const second = await expectJson<PublicComment>(
      await visitor.post(board(`/tasks/${task.number}/comments`), {
        data: { content: "Second public comment" },
      }),
      201,
    );

    const listed = await (
      await owner.get(`/api/publication/project/${project.id}/comments`)
    ).text();
    expect(listed).toContain("First public comment");

    await expectJson(
      await owner.patch(`/api/publication/comment/${first.id}/visibility`, {
        data: { visibility: "internal" },
      }),
    );
    expect(
      await (
        await world.anonymous.get(board(`/tasks/${task.number}/comments`))
      ).text(),
    ).not.toContain("First public comment");
    await expectJson(
      await owner.delete(`/api/publication/comment/${second.id}`),
    );

    await expectJson(
      await owner.put(
        `/api/publication/project/${project.id}/blocks/${outsider.id}`,
        { data: { hideComments: false } },
      ),
    );
    const blocks = await expectJson<{ userId: string }[]>(
      await owner.get(`/api/publication/project/${project.id}/blocks`),
    );
    expect(blocks.map((block) => block.userId)).toContain(outsider.id);
    await expectStatus(
      await visitor.post(board(`/tasks/${task.number}/comments`), {
        data: { content: "Blocked" },
      }),
      403,
    );
    await expectJson(
      await owner.delete(
        `/api/publication/project/${project.id}/blocks/${outsider.id}`,
      ),
    );
    const after = await expectJson<{ userId: string }[]>(
      await owner.get(`/api/publication/project/${project.id}/blocks`),
    );
    expect(after.map((block) => block.userId)).not.toContain(outsider.id);
  },
);

test(
  "rotating the link retires the old one; unpublishing closes the board",
  covers("rotateProjectPublicationLink", "unpublishProject"),
  async () => {
    const owner = world.as("owner");
    const old = token;
    const rotated = await expectJson<Publication>(
      await owner.post(`/api/publication/project/${project.id}/rotate-link`),
    );
    token = rotated.linkToken ?? "";
    expect(token).not.toBe(old);
    await expectStatus(
      await world.anonymous.get(`/api/public-board/${old}`),
      404,
    );
    await expectJson(await world.anonymous.get(board()));

    const unpublished = await expectJson<Publication>(
      await owner.post(`/api/publication/project/${project.id}/unpublish`),
    );
    expect(unpublished.published).toBe(false);
    await expectStatus(await world.anonymous.get(board()), 404);
  },
);
