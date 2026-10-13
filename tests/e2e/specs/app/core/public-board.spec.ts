import { test } from "../../../fixtures";
import { E2E_WEB_URL } from "../../../helpers/env";
import { uniqueName } from "../../../helpers/ui";
import {
  createProjectViaApi,
  createTaskViaApi,
  expect,
  newUserWithWorkspace,
  workspacePath,
} from "./_support";

// Multi-step flows against shared, often busy dev servers: allow more than
// the default 60 s per test and 30 s per navigation.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 60_000 });

// The project is published from its Publish settings page by a fresh owner;
// anonymous visitors use a separate signed-out browser context.

test("a project published from its Publish page is readable by anonymous visitors until it is unpublished", async ({
  pageAs,
  apiAs,
}) => {
  const { page: owner, workspace } = await newUserWithWorkspace(pageAs);
  const project = await createProjectViaApi(owner.request, workspace.id, {
    name: uniqueName("Public board"),
  });
  const todo = await createTaskViaApi(owner.request, project.id, {
    title: uniqueName("Public todo"),
    status: "to-do",
  });
  const doing = await createTaskViaApi(owner.request, project.id, {
    title: uniqueName("Public doing"),
    status: "in-progress",
  });
  const anonymousApi = await apiAs("anonymous");

  // Not published yet: the Publish page says so and offers Publish.
  await owner.goto(workspacePath(workspace.id));
  await owner.goto(`/dashboard/settings/projects/${project.id}/visibility`);
  await expect(owner.getByText("This project isn't public")).toBeVisible();
  // The settings navigation has a "Publish" item too; use the page's button.
  await owner
    .getByRole("main")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect(owner.getByText("Project published").first()).toBeVisible();
  await expect(owner.getByText("Live", { exact: true })).toBeVisible();

  // The link is a random token, not the project id.
  const link = owner.getByRole("textbox", { name: "Public link" });
  await expect(link).toHaveValue(
    new RegExp(`^${E2E_WEB_URL}/public-project/[A-Za-z0-9_-]{16,64}$`),
  );
  const publicUrl = await link.inputValue();
  const token = publicUrl.split("/").pop() ?? "";
  expect(token).not.toBe(project.id);

  // Anonymous visitor: the board, read-only (nothing is turned on).
  const visitor = await pageAs("anonymous");
  await visitor.goto(publicUrl);
  await expect(
    visitor.getByRole("heading", { name: project.name }),
  ).toBeVisible();
  await expect(visitor.getByText("Public", { exact: true })).toBeVisible();
  await expect(visitor.getByText("Read-only")).toBeVisible();
  for (const column of ["To Do", "In Progress", "In Review", "Done"]) {
    await expect(
      visitor.getByRole("heading", { name: column, exact: true }),
    ).toBeVisible();
  }
  await expect(visitor.getByText(todo.title)).toBeVisible();
  await expect(visitor.getByText(doing.title)).toBeVisible();
  await expect(visitor.getByRole("button", { name: "Add task" })).toHaveCount(
    0,
  );

  // Task details open in a linkable peek.
  await visitor
    .getByRole("button", { name: `View details for task ${todo.title}` })
    .click();
  await expect(visitor).toHaveURL(new RegExp(`\\?task=${todo.number}$`));
  const detail = visitor.getByRole("dialog").filter({ hasText: todo.title });
  await expect(detail).toBeVisible();
  await expect(
    detail.getByText(`${project.slug}-${todo.number}`).first(),
  ).toBeVisible();
  await visitor.keyboard.press("Escape");
  await expect(detail).toBeHidden();

  // The list layout shows the same tasks and lands in the URL.
  await visitor
    .getByRole("tablist", { name: "Layout" })
    .getByRole("tab", { name: "List" })
    .click();
  await expect(visitor).toHaveURL(/layout=list/);
  await expect(visitor.getByText(todo.title)).toBeVisible();
  await expect(visitor.getByText(doing.title)).toBeVisible();

  // The public API serves the board by its token, without a session.
  const board = await anonymousApi.get(`/api/public-board/${token}/tasks`);
  expect(board.status()).toBe(200);
  expect(JSON.stringify(await board.json())).toContain(todo.title);

  // Unpublish from the actions menu: the link stops working.
  await owner.getByRole("button", { name: "More actions" }).click();
  await owner.getByRole("menuitem", { name: "Unpublish…" }).click();
  await owner.getByRole("button", { name: "Unpublish", exact: true }).click();
  await expect(owner.getByText("Board unpublished").first()).toBeVisible();
  await expect(owner.getByText("This project isn't public")).toBeVisible();

  await visitor.reload();
  await expect(visitor.getByText("Project not found")).toBeVisible();
  await expect(visitor.getByText(todo.title)).toHaveCount(0);
  expect((await anonymousApi.get(`/api/public-board/${token}`)).status()).toBe(
    404,
  );
});
