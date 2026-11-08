import { asAnonymous, expect, test } from "../../../fixtures";
import {
  addMember,
  createProject,
  createTask,
  createWorkspace,
  expectJson,
  expectStatus,
  signUpUser,
} from "../../../helpers/api-kit";
import { signInViaUI, uniqueName } from "../../../helpers/ui";

// A guest reaches the projects they are added to and nothing else in the
// workspace. Everything runs on fresh accounts and workspaces this file creates.

async function guestWorld() {
  const owner = await signUpUser("Guest owner");
  const guest = await signUpUser("Guest person");
  const workspace = await createWorkspace(owner.ctx);
  await addMember(owner.ctx, workspace.id, guest, "guest");
  const shared = await createProject(owner.ctx, workspace.id, {
    name: uniqueName("Shared"),
  });
  const hidden = await createProject(owner.ctx, workspace.id, {
    name: uniqueName("Hidden"),
  });
  await expectJson(
    await owner.ctx.post(`/api/project/${shared.id}/access/members`, {
      data: { userId: guest.id, role: "viewer" },
    }),
  );
  const dispose = () => Promise.all([owner.ctx.dispose(), guest.ctx.dispose()]);
  return { owner, guest, workspace, shared, hidden, dispose };
}

test("a guest's API answers stop at the projects they were added to", async () => {
  const { guest, owner, workspace, shared, hidden, dispose } =
    await guestWorld();
  const params = { workspaceId: workspace.id };

  const projects = await expectJson<{ id: string }[]>(
    await guest.ctx.get("/api/project", { params }),
  );
  expect(projects.map((project) => project.id)).toEqual([shared.id]);

  await expectStatus(await guest.ctx.get(`/api/project/${hidden.id}`), 404);
  for (const path of [
    `/api/workspace/${workspace.id}/members`,
    `/api/label/workspace/${workspace.id}`,
    "/api/analytics/overview",
    "/api/view",
    "/api/task-export",
    "/api/audit-log",
  ]) {
    await expectStatus(await guest.ctx.get(path, { params }), 404);
  }

  const { members } = await expectJson<{ members: { userId: string }[] }>(
    await guest.ctx.get("/api/auth/organization/list-members", {
      params: { organizationId: workspace.id },
    }),
  );
  expect(members.map((member) => member.userId)).toEqual([guest.id]);

  // Removing them from their last project leaves them with nothing.
  await expectJson(
    await owner.ctx.delete(
      `/api/project/${shared.id}/access/members/${guest.id}`,
    ),
  );
  await expectStatus(await guest.ctx.get(`/api/project/${shared.id}`), 404);

  await dispose();
});

test.describe("in the app", () => {
  test.use(asAnonymous);

  test("a guest lands on their projects, without the workspace's screens", async ({
    page,
  }) => {
    const { owner, guest, workspace, shared, hidden, dispose } =
      await guestWorld();
    const task = await createTask(owner.ctx, shared.id, {
      title: uniqueName("Client task"),
    });
    const workspacePath = `/dashboard/workspace/${workspace.id}`;

    await signInViaUI(page, guest);

    // Home sends a guest to their projects, where only theirs are listed.
    await page.goto(workspacePath);
    await expect(page).toHaveURL(new RegExp(`${workspacePath}/projects`));
    await expect(page.getByText(shared.name).first()).toBeVisible();
    await expect(page.getByText(hidden.name)).toHaveCount(0);

    // The rail offers no workspace destinations.
    await expect(page.getByRole("link", { name: "Analytics" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Home" })).toHaveCount(0);

    // Workspace screens and settings send them back.
    await page.goto(`${workspacePath}/members`);
    await expect(page).toHaveURL(new RegExp(`${workspacePath}/projects`));
    await page.goto("/dashboard/settings/workspace/general");
    await expect(page).toHaveURL(/\/dashboard\/settings\/account\/information/);

    // Their project works.
    await page.goto(`${workspacePath}/project/${shared.id}/board`);
    await expect(page.getByText(task.title).first()).toBeVisible();

    await dispose();
  });

  test("a guest with no project yet is told what to do", async ({ page }) => {
    const owner = await signUpUser("Guest owner two");
    const guest = await signUpUser("Guest waiting");
    const workspace = await createWorkspace(owner.ctx);
    await addMember(owner.ctx, workspace.id, guest, "guest");
    await createProject(owner.ctx, workspace.id);

    await signInViaUI(page, guest);
    await page.goto(`/dashboard/workspace/${workspace.id}/projects`);
    await expect(
      page.getByText("You haven't been added to a project yet."),
    ).toBeVisible();

    await Promise.all([owner.ctx.dispose(), guest.ctx.dispose()]);
  });
});

test.describe("for an owner", () => {
  test.use(asAnonymous);

  test("adds a guest to an open project from its settings", async ({
    page,
  }) => {
    const owner = await signUpUser("Guest adder");
    const guest = await signUpUser("Guest added");
    const colleague = await signUpUser("Guest colleague");
    const workspace = await createWorkspace(owner.ctx);
    await addMember(owner.ctx, workspace.id, guest, "guest");
    await addMember(owner.ctx, workspace.id, colleague, "member");
    const project = await createProject(owner.ctx, workspace.id);
    await expectStatus(await guest.ctx.get(`/api/project/${project.id}`), 404);

    await signInViaUI(page, owner);
    await page.goto(`/dashboard/settings/projects/${project.id}/general`);
    await expect(
      page.getByText("Guests reach only the projects"),
    ).toBeVisible();

    await page.getByRole("button", { name: "Add member" }).click();
    // In an open project only guests are offered: colleagues already reach it.
    await expect(page.getByText(colleague.name)).toHaveCount(0);
    await page.getByText(guest.name).click();
    await expect(
      page.getByRole("combobox", { name: `Project role of ${guest.name}` }),
    ).toBeVisible();

    await expectJson(await guest.ctx.get(`/api/project/${project.id}`));

    await Promise.all([
      owner.ctx.dispose(),
      guest.ctx.dispose(),
      colleague.ctx.dispose(),
    ]);
  });
});
