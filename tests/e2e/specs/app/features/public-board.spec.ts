import { test } from "../../../fixtures";
import { readJson } from "../../../helpers/http";
import {
  createProject,
  createTask,
  deleteProject,
  type TestProject,
} from "../../../helpers/task-data";
import { escapeRegExp } from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";
import { expect, projectPath } from "./_support";

// Public boards (publication by link token): a published project is readable
// anonymously; signed-in people vote and comment; unpublishing hides it.

test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

type Publication = {
  published: boolean;
  linkToken: string | null;
  path: string | null;
};

let project: TestProject | undefined;

test.afterEach(async ({ api }) => {
  if (project) {
    await api
      .post(`/api/publication/project/${project.id}/unpublish`)
      .catch(() => null);
    await deleteProject(api, project.id);
  }
  project = undefined;
});

test("a published board is public, signed-in people vote and comment, and unpublishing hides it", async ({
  api,
  apiAs,
  pageAs,
}) => {
  project = await createProject(api, { name: uniqueName("Public board") });
  const task = await createTask(api, project.id, {
    title: uniqueName("Public task"),
  });
  const publication = await readJson<Publication>(
    await api.post(`/api/publication/project/${project.id}/publish`, {
      data: { commentsEnabled: true, votesEnabled: true },
    }),
    "publish project",
  );
  expect(publication.published).toBe(true);
  expect(publication.path).toMatch(/^\/public-project\/.+/);
  const token = publication.linkToken ?? "";
  expect(publication.path).toBe(`/public-project/${token}`);

  // Anyone with the link sees the board.
  const visitor = await pageAs("anonymous");
  await visitor.goto(publication.path ?? "/");
  await expect(visitor.getByText(project.name).first()).toBeVisible({
    timeout: 90_000,
  });
  await expect(
    visitor.getByText(new RegExp(escapeRegExp(task.title))).first(),
  ).toBeVisible();

  // Taking part needs an account.
  const anonymous = await apiAs("anonymous");
  expect((await anonymous.get(`/api/public-board/${token}`)).status()).toBe(
    200,
  );
  const anonymousVote = await anonymous.put(
    `/api/public-board/${token}/tasks/${task.number}/vote`,
    { data: { value: 1 } },
  );
  expect(anonymousVote.status()).toBe(401);

  // A signed-in member votes and comments.
  const member = await apiAs("member");
  const vote = await readJson<Record<string, unknown>>(
    await member.put(`/api/public-board/${token}/tasks/${task.number}/vote`, {
      data: { value: 1 },
    }),
    "vote",
  );
  expect(JSON.stringify(vote)).toMatch(/1/);
  const comment = "Looking forward to this one";
  const posted = await member.post(
    `/api/public-board/${token}/tasks/${task.number}/comments`,
    { data: { content: comment } },
  );
  expect(posted.status()).toBe(201);
  const comments = await (
    await anonymous.get(
      `/api/public-board/${token}/tasks/${task.number}/comments`,
    )
  ).text();
  expect(comments).toContain(comment);

  // Unpublished: the link stops working for everyone.
  await readJson(
    await api.post(`/api/publication/project/${project.id}/unpublish`),
    "unpublish project",
  );
  expect((await anonymous.get(`/api/public-board/${token}`)).status()).toBe(
    404,
  );
  await visitor.reload();
  await expect(visitor.getByText("Project not found")).toBeVisible({
    timeout: 60_000,
  });
  await expect(visitor.getByText(task.title)).toHaveCount(0);
});

test("visitors see sign-in prompts, members vote and comment in the peek, and the app shows public comments and votes", async ({
  api,
  pageAs,
}) => {
  project = await createProject(api, { name: uniqueName("Public peek") });
  const task = await createTask(api, project.id, {
    title: uniqueName("Peek task"),
  });
  const publication = await readJson<Publication>(
    await api.post(`/api/publication/project/${project.id}/publish`, {
      data: { commentsEnabled: true, votesEnabled: true },
    }),
    "publish project",
  );
  const peekPath = `${publication.path}?task=${task.number}`;

  // A visitor: the peek opens from its link; voting and commenting ask
  // them to sign in and come back to this exact view.
  const visitor = await pageAs("anonymous");
  await visitor.goto(peekPath);
  const visitorPeek = visitor.getByRole("dialog");
  await expect(
    visitorPeek.getByRole("heading", { name: task.title }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(
    visitorPeek.getByRole("button", { name: "Upvote (0)" }),
  ).toBeDisabled();
  await expect(visitorPeek.getByText("Sign in to take part")).toBeVisible();
  await expect(
    visitorPeek.getByRole("link", { name: "Sign in" }),
  ).toHaveAttribute(
    "href",
    `/auth/sign-in?redirect=${encodeURIComponent(peekPath)}`,
  );

  // A member (not the publisher) votes and comments from the peek.
  const member = await pageAs("member");
  await member.goto(peekPath);
  const peek = member.getByRole("dialog");
  await expect(peek.getByRole("heading", { name: task.title })).toBeVisible({
    timeout: 90_000,
  });
  await peek.getByRole("button", { name: "Upvote (0)" }).click();
  await expect(
    peek.getByRole("button", { name: "Upvote (1)" }),
  ).toHaveAttribute("aria-pressed", "true");
  const comment = uniqueName("Board comment");
  await peek.locator(".ProseMirror").last().click();
  await member.keyboard.type(comment);
  await peek.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(peek.getByText(comment)).toBeVisible();
  await expect(peek.getByText("Comments (1)")).toBeVisible();

  // The owner sees the public comment and the vote summary in the app, and
  // can answer publicly from the task.
  const owner = await pageAs("owner");
  await owner.goto(projectPath(project.id, `task/${task.id}`));
  await expect(owner.getByText(comment)).toBeVisible({ timeout: 90_000 });
  await expect(owner.getByText("▲ 1 · ▼ 0")).toBeVisible();
  await expect(
    owner.getByRole("group", { name: "Comment visibility" }),
  ).toBeVisible();
  await owner.getByRole("button", { name: "Public", exact: true }).click();
  const reply = uniqueName("Team reply");
  await owner
    .getByRole("region", { name: "Comment editor" })
    .locator(".ProseMirror")
    .fill(reply);
  await owner.getByRole("button", { name: "Submit comment" }).click();
  await expect(owner.getByText(reply)).toBeVisible();

  // The public reply reaches the board.
  await expect(async () => {
    await visitor.reload();
    await expect(visitor.getByRole("dialog").getByText(reply)).toBeVisible({
      timeout: 10_000,
    });
  }).toPass({ timeout: 60_000 });
});
