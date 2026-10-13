import type { APIRequestContext, Page } from "@playwright/test";
import { asRole, test } from "../../../fixtures";
import { projectBoardPath, uniqueName } from "../../../helpers/ui";
import type { SeedManifest } from "../../../seed/seed";
import { expect, projectsPath, taskPath, workspacePath } from "./_support";

// Multi-step flows against shared, often busy dev servers: allow more than
// the default 60 s per test and 30 s per navigation.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 60_000 });

// Read-mostly checks of what each seeded role can see and do in the UI, with
// one API call per role proving the server enforces the same rule. The only
// writes are tasks the member creates, which the owner deletes again.

function heroTaskPath(seed: SeedManifest) {
  const web = seed.projects.web;
  return taskPath(seed.workspace.id, web.id, web.tasks.hero.id);
}

async function openProjects(page: Page, seed: SeedManifest) {
  await page.goto(projectsPath(seed.workspace.id));
  await expect(
    page.getByRole("cell", { name: seed.projects.web.name }).first(),
  ).toBeVisible();
}

async function openWebBoard(page: Page, seed: SeedManifest) {
  await page.goto(projectBoardPath(seed.projects.web));
  await expect(
    page.getByText(seed.projects.web.tasks.hero.title).first(),
  ).toBeVisible({ timeout: 30_000 });
}

async function openTask(page: Page, seed: SeedManifest) {
  await page.goto(heroTaskPath(seed));
  const title = page.getByPlaceholder("Click to add a title");
  await expect(title).toHaveValue(seed.projects.web.tasks.hero.title);
  return title;
}

async function openWorkspaceGeneral(page: Page, seed: SeedManifest) {
  await page.goto("/dashboard/settings/workspace/general");
  const name = page.getByLabel("Workspace name");
  await expect(name).toHaveValue(seed.workspace.name);
  return name;
}

async function openFeatures(page: Page, seed: SeedManifest) {
  await page.goto(
    `/dashboard/settings/projects/${seed.projects.web.id}/features`,
  );
  const cycles = page.getByRole("switch", { name: "Cycles" });
  await expect(cycles).toBeVisible();
  return cycles;
}

async function createTaskStatus(api: APIRequestContext, seed: SeedManifest) {
  const response = await api.post(`/api/task/${seed.projects.web.id}`, {
    data: {
      title: uniqueName("Permission probe"),
      description: "",
      priority: "low",
      status: "to-do",
    },
  });
  const status = response.status();
  if (response.ok()) {
    const { id } = await response.json();
    return { status, id: id as string };
  }
  return { status, id: null };
}

test.describe("viewer", () => {
  test.use(asRole("viewer"));

  test("cannot create projects or tasks", async ({
    page,
    seed,
    apiAs,
    api,
  }) => {
    await openProjects(page, seed);
    await expect(
      page.getByRole("button", { name: "Create project" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add project" })).toHaveCount(
      0,
    );

    await openWebBoard(page, seed);
    await expect(page.getByRole("button", { name: "Add task" })).toHaveCount(0);

    // The API refuses too; the hidden button is not the only guard.
    const probe = await createTaskStatus(await apiAs("viewer"), seed);
    if (probe.id) await api.delete(`/api/task/${probe.id}`);
    expect(probe.status).toBe(403);
  });

  test("sees tasks read-only", async ({ page, seed }) => {
    const title = await openTask(page, seed);
    await expect(title).toHaveAttribute("readonly", "");
  });

  test("cannot change workspace settings, members, roles or features", async ({
    page,
    seed,
  }) => {
    const name = await openWorkspaceGeneral(page, seed);
    await expect(name).toBeDisabled();
    await expect(page.getByLabel("Description")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Delete workspace" }),
    ).toHaveCount(0);

    await page.goto("/dashboard/settings/workspace/roles");
    await expect(
      page.getByText(
        "You need admin or owner permissions to manage workspace roles.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "New role" })).toHaveCount(0);

    const cycles = await openFeatures(page, seed);
    await expect(cycles).toBeDisabled();
    await expect(
      page.getByText(
        "Only people who can manage this project can change features.",
      ),
    ).toBeVisible();

    await page.goto(`${workspacePath(seed.workspace.id)}/members`);
    await expect(page.getByText(seed.users.owner.email)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Invite member" }),
    ).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Remove member" }),
    ).toHaveCount(0);
  });
});

test.describe("member", () => {
  test.use(asRole("member"));

  test("creates a task on the board", async ({ page, seed, api }) => {
    await openWebBoard(page, seed);
    const title = uniqueName("Member task");
    await page.getByRole("button", { name: "Add task" }).first().click();
    await page.getByPlaceholder("Task title").fill(title);
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/task/${seed.projects.web.id}`),
    );
    await page.getByRole("button", { name: "Create task" }).click();
    const response = await created;
    expect(response.status()).toBe(200);
    const { id } = await response.json();

    try {
      await expect(page.getByText("Task created successfully")).toBeVisible();
      await expect(page.getByText(title)).toBeVisible();
    } finally {
      await api.delete(`/api/task/${id}`);
    }
  });

  test("can edit tasks and create projects", async ({ page, seed }) => {
    const title = await openTask(page, seed);
    await expect(title).not.toHaveAttribute("readonly");

    await openProjects(page, seed);
    await expect(
      page.getByRole("button", { name: "Create project" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add project" }),
    ).toBeVisible();
  });

  test("cannot manage workspace settings, members, roles or features", async ({
    page,
    seed,
    apiAs,
  }) => {
    const name = await openWorkspaceGeneral(page, seed);
    await expect(name).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Delete workspace" }),
    ).toHaveCount(0);

    await page.goto("/dashboard/settings/workspace/roles");
    await expect(
      page.getByText(
        "You need admin or owner permissions to manage workspace roles.",
      ),
    ).toBeVisible();

    const cycles = await openFeatures(page, seed);
    await expect(cycles).toBeDisabled();

    await page.goto(`${workspacePath(seed.workspace.id)}/members`);
    await expect(page.getByText(seed.users.owner.email)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Invite member" }),
    ).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);

    // The server agrees: no project settings changes for a member.
    const member = await apiAs("member");
    const features = await member.patch(
      `/api/project/${seed.projects.web.id}/features`,
      { data: { cyclesEnabled: true } },
    );
    expect(features.status()).toBe(403);
  });

  test("the project menu offers no delete", async ({ page, seed }) => {
    await openProjects(page, seed);
    const row = page.locator("[data-sidebar=menu-item]").filter({
      has: page.getByRole("button", {
        name: seed.projects.mobile.name,
        exact: true,
      }),
    });
    await row.hover();
    await row.getByRole("button", { name: "More" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Project settings" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Delete project" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  });
});

test.describe("admin", () => {
  test.use(asRole("admin"));

  test("manages workspace settings but cannot delete the workspace", async ({
    page,
    seed,
  }) => {
    const name = await openWorkspaceGeneral(page, seed);
    await expect(name).toBeEnabled();
    await expect(page.getByLabel("Description")).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Delete workspace" }),
    ).toHaveCount(0);

    const cycles = await openFeatures(page, seed);
    await expect(cycles).toBeEnabled();
    await expect(
      page.getByText(
        "Only people who can manage this project can change features.",
      ),
    ).toHaveCount(0);
  });

  test("invites members, changes roles and edits workspace roles", async ({
    page,
    seed,
  }) => {
    await page.goto(`${workspacePath(seed.workspace.id)}/members`);
    await expect(
      page.getByRole("button", { name: "Invite member" }),
    ).toBeVisible();
    const viewerRow = page
      .getByRole("row")
      .filter({ hasText: seed.users.viewer.email });
    await expect(viewerRow.getByRole("combobox")).toHaveText("Viewer");
    const ownerRow = page
      .getByRole("row")
      .filter({ hasText: seed.users.owner.email });
    await expect(ownerRow.getByRole("combobox")).toHaveCount(0);
    await expect(ownerRow).toContainText("Owner");
    const selfRow = page
      .getByRole("row")
      .filter({ hasText: seed.users.admin.email });
    await expect(selfRow).toContainText("(You)");
    await expect(selfRow.getByRole("combobox")).toHaveCount(0);

    await page.goto("/dashboard/settings/workspace/roles");
    await expect(page.getByText("Workspace roles")).toBeVisible();
    await expect(page.getByRole("button", { name: "New role" })).toBeVisible();
  });

  test("creates tasks and edits them", async ({ page, seed }) => {
    await openWebBoard(page, seed);
    await expect(
      page.getByRole("button", { name: "Add task" }).first(),
    ).toBeVisible();
    const title = await openTask(page, seed);
    await expect(title).not.toHaveAttribute("readonly");
  });
});

test.describe("owner", () => {
  test("has every workspace capability, including deleting it", async ({
    page,
    seed,
  }) => {
    const name = await openWorkspaceGeneral(page, seed);
    await expect(name).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Delete workspace" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Transfer ownership" }),
    ).toBeVisible();

    await openProjects(page, seed);
    await expect(
      page.getByRole("button", { name: "Create project" }),
    ).toBeVisible();

    await page.goto(`${workspacePath(seed.workspace.id)}/members`);
    await expect(
      page.getByRole("button", { name: "Invite member" }),
    ).toBeVisible();
    for (const role of ["admin", "member", "viewer"] as const) {
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: seed.users[role].email })
          .getByRole("combobox"),
      ).toBeVisible();
    }
  });
});
