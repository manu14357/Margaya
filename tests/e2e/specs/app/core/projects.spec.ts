import type { Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { uniqueName } from "../../../helpers/ui";
import {
  boardPath,
  createProjectViaApi,
  createTaskViaApi,
  dragTo,
  expect,
  newUserWithWorkspace,
  projectsPath,
  uniqueKey,
  workspacePath,
} from "./_support";

// Multi-step flows against shared, often busy dev servers: allow more than
// the default 60 s per test and 30 s per navigation.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 60_000 });

// Projects live in a workspace owned by a user created for the test.

const ORIGIN = { Origin: E2E_WEB_URL };

type ListedProject = { id: string; name: string; slug: string };

async function listProjects(
  page: Page,
  workspaceId: string,
  includeArchived = false,
): Promise<ListedProject[]> {
  const response = await page.request.get(`${E2E_API_URL}/api/project`, {
    params: {
      workspaceId,
      ...(includeArchived ? { includeArchived: "true" } : {}),
    },
    headers: ORIGIN,
  });
  expect(response.status()).toBe(200);
  return response.json();
}

async function projectById(page: Page, workspaceId: string, id: string) {
  const response = await page.request.get(`${E2E_API_URL}/api/project/${id}`, {
    params: { workspaceId },
    headers: ORIGIN,
  });
  if (!response.ok()) return undefined;
  return (await response.json()) as ListedProject & { description: string };
}

/** The Projects group of the sidebar. */
function sidebarProjects(page: Page) {
  return page
    .locator("[data-sidebar=group]")
    .filter({ has: page.getByText("Projects", { exact: true }) })
    .last();
}

function sidebarProject(page: Page, name: string) {
  return sidebarProjects(page).getByRole("button", { name, exact: true });
}

async function openSidebarMenu(page: Page, name: string) {
  const row = sidebarProjects(page)
    .locator("[data-sidebar=menu-item]")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
  await row.hover();
  await row.getByRole("button", { name: "More" }).click();
}

function createProjectDialog(page: Page) {
  return page.getByRole("dialog", { name: "Create a new project" });
}

test.describe("create", () => {
  test("creates a project from the sidebar with a generated key", async ({
    pageAs,
  }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    await page.goto(projectsPath(workspace.id));
    await expect(page.getByText("No projects yet")).toBeVisible();

    // The group header's action; an empty list repeats it as a row.
    await sidebarProjects(page)
      .getByRole("button", { name: "Add project" })
      .first()
      .click();
    const dialog = createProjectDialog(page);
    await expect(dialog).toBeVisible();
    const create = dialog.getByRole("button", { name: "Create project" });
    await expect(create).toBeDisabled();

    const name = `Garden Tools ${Date.now().toString(36)}`;
    await dialog.getByPlaceholder("Project name").fill(name);
    // Initials of the first three words.
    const key = dialog.getByPlaceholder("PRO", { exact: true });
    await expect(key).toHaveValue(/^GT/);
    await expect(
      dialog.getByText(/Used for ticket IDs \(e\.g\., GT/),
    ).toBeVisible();
    await key.fill("GTL");
    await create.click();

    await expect(page.getByText("Project created successfully")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/project\/[^/]+\/board$/);
    await expect(sidebarProject(page, name)).toBeVisible();
    // A new project starts with the default workflow columns.
    for (const column of ["To Do", "In Progress", "In Review", "Done"]) {
      await expect(
        page.getByText(column, { exact: true }).first(),
      ).toBeVisible();
    }

    const [project] = await listProjects(page, workspace.id);
    expect(project).toMatchObject({ name, slug: "GTL" });
  });

  test("a key already used in the workspace is refused next to the field", async ({
    pageAs,
  }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    const taken = await createProjectViaApi(page.request, workspace.id, {
      slug: uniqueKey("K"),
    });
    await page.goto(boardPath(workspace.id, taken.id));
    await expect(sidebarProject(page, taken.name)).toBeVisible();

    await sidebarProjects(page)
      .getByRole("button", { name: "Add project" })
      .click();
    const dialog = createProjectDialog(page);
    await dialog.getByPlaceholder("Project name").fill(uniqueName("Clash"));
    // Keys are unique ignoring case.
    await dialog
      .getByPlaceholder("PRO", { exact: true })
      .fill(taken.slug.toLowerCase());
    await dialog.getByRole("button", { name: "Create project" }).click();

    const error = dialog.getByRole("alert");
    await expect(error).toHaveText(
      `A project with the key ${taken.slug} already exists in this workspace`,
    );
    await expect(
      dialog.getByPlaceholder("PRO", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(await listProjects(page, workspace.id)).toHaveLength(1);

    // Editing the key clears the error, and a free key goes through.
    const free = uniqueKey("F");
    await dialog.getByPlaceholder("PRO", { exact: true }).fill(free);
    await expect(error).toBeHidden();
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByText("Project created successfully")).toBeVisible();
    expect(
      (await listProjects(page, workspace.id)).map((project) => project.slug),
    ).toContain(free);
  });
});

test.describe("edit", () => {
  test("renames a project, changes its key and description in settings", async ({
    pageAs,
  }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    const project = await createProjectViaApi(page.request, workspace.id);
    const task = await createTaskViaApi(page.request, project.id);
    const other = await createProjectViaApi(page.request, workspace.id);

    await page.goto(boardPath(workspace.id, project.id));
    await expect(page.getByText(task.title)).toBeVisible();
    await page.goto(`/dashboard/settings/projects/${project.id}/general`);
    await expect(page.getByLabel("Project name")).toHaveValue(project.name);
    await expect(page.getByLabel("Key")).toHaveValue(project.slug);

    const renamed = uniqueName("Renamed project");
    await page.getByLabel("Project name").fill(renamed);
    await expect(page.getByText("Project updated successfully")).toBeVisible();
    await expect
      .poll(
        async () => (await projectById(page, workspace.id, project.id))?.name,
      )
      .toBe(renamed);
    // Each edit starts from a fresh page, so this test checks every field on
    // its own; consecutive edits have their own test below.
    // reverts the first one (app-core.md, bug 5).
    await page.reload();
    await expect(page.getByLabel("Project name")).toHaveValue(renamed);

    // Another project's key is rejected on the field.
    await page.getByLabel("Key").fill(other.slug);
    await expect(
      page.getByText(
        `A project with the key ${other.slug} already exists in this workspace`,
      ),
    ).toBeVisible();
    const newKey = uniqueKey("N");
    await page.getByLabel("Key").fill(newKey);
    await expect
      .poll(
        async () => (await projectById(page, workspace.id, project.id))?.slug,
      )
      .toBe(newKey);

    await page.reload();
    await expect(page.getByLabel("Key")).toHaveValue(newKey);
    await page.getByLabel("Description").fill("Edited by the core specs");
    await expect
      .poll(
        async () =>
          (await projectById(page, workspace.id, project.id))?.description,
      )
      .toBe("Edited by the core specs");

    await page.reload();
    await expect(page.getByLabel("Project name")).toHaveValue(renamed);
    await expect(page.getByLabel("Key")).toHaveValue(newKey);
    await expect(page.getByLabel("Description")).toHaveValue(
      "Edited by the core specs",
    );

    // The board, sidebar and task ids follow the new name and key.
    await page.goto(boardPath(workspace.id, project.id));
    await expect(sidebarProject(page, renamed)).toBeVisible();
    await expect(page.getByText(`${newKey}-${task.number}`)).toBeVisible();
  });
});

test.describe("edit, consecutive saves", () => {
  // Regression test for app-core.md bug 5 (a second edit reverted the first).
  test("a rename survives a following description edit", async ({ pageAs }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    const project = await createProjectViaApi(page.request, workspace.id);
    await page.goto(workspacePath(workspace.id));
    await page.goto(`/dashboard/settings/projects/${project.id}/general`);
    await expect(page.getByLabel("Project name")).toHaveValue(project.name);

    const renamed = uniqueName("Renamed project");
    await page.getByLabel("Project name").fill(renamed);
    await expect
      .poll(
        async () => (await projectById(page, workspace.id, project.id))?.name,
      )
      .toBe(renamed);
    await page.getByLabel("Description").fill("Second edit");
    await expect
      .poll(
        async () =>
          (await projectById(page, workspace.id, project.id))?.description,
      )
      .toBe("Second edit");

    expect((await projectById(page, workspace.id, project.id))?.name).toBe(
      renamed,
    );
  });
});

test.describe("archive", () => {
  // The web app has no archive control yet; the API archives and the UI
  // must hide and restore the project accordingly.
  test("an archived project leaves the sidebar and list, and returns when unarchived", async ({
    pageAs,
  }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    const kept = await createProjectViaApi(page.request, workspace.id);
    const archived = await createProjectViaApi(page.request, workspace.id);

    await page.goto(projectsPath(workspace.id));
    await expect(sidebarProject(page, archived.name)).toBeVisible();
    await expect(page.getByRole("cell", { name: archived.name })).toBeVisible();

    const archive = await page.request.put(
      `${E2E_API_URL}/api/project/${archived.id}/archive`,
      { headers: ORIGIN },
    );
    expect(archive.status()).toBe(200);
    expect((await archive.json()).archivedAt).toBeTruthy();

    await page.goto(projectsPath(workspace.id));
    await expect(page.getByRole("cell", { name: kept.name })).toBeVisible();
    await expect(page.getByRole("cell", { name: archived.name })).toHaveCount(
      0,
    );
    await expect(sidebarProject(page, kept.name)).toBeVisible();
    await expect(sidebarProject(page, archived.name)).toHaveCount(0);
    expect(
      (await listProjects(page, workspace.id)).map((project) => project.id),
    ).toEqual([kept.id]);
    expect(
      (await listProjects(page, workspace.id, true)).map(
        (project) => project.id,
      ),
    ).toEqual(expect.arrayContaining([kept.id, archived.id]));

    const unarchive = await page.request.put(
      `${E2E_API_URL}/api/project/${archived.id}/unarchive`,
      { headers: ORIGIN },
    );
    expect(unarchive.status()).toBe(200);
    expect((await unarchive.json()).archivedAt).toBeNull();

    await page.goto(projectsPath(workspace.id));
    await expect(sidebarProject(page, archived.name)).toBeVisible();
    await expect(page.getByRole("cell", { name: archived.name })).toBeVisible();
  });
});

test.describe("delete", () => {
  test("deletes a project from its settings danger zone", async ({
    pageAs,
  }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    const kept = await createProjectViaApi(page.request, workspace.id);
    const doomed = await createProjectViaApi(page.request, workspace.id);

    await page.goto(workspacePath(workspace.id));
    await page.goto(`/dashboard/settings/projects/${doomed.id}/general`);
    await expect(page.getByLabel("Project name")).toHaveValue(doomed.name);
    await page.getByRole("button", { name: "Delete project" }).click();

    const dialog = page.getByRole("alertdialog", { name: "Delete project?" });
    await expect(
      dialog.getByText(
        `"${doomed.name}" and its tasks move to the trash. You can restore them from Recently deleted in workspace settings until they are deleted permanently.`,
      ),
    ).toBeVisible();
    // Cancel keeps it.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(await listProjects(page, workspace.id)).toHaveLength(2);

    await page.getByRole("button", { name: "Delete project" }).click();
    await dialog.getByRole("button", { name: "Delete project" }).click();
    await expect(page.getByText("Project moved to the trash")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(workspacePath(workspace.id)));
    await expect(sidebarProject(page, doomed.name)).toHaveCount(0);
    expect(
      (await listProjects(page, workspace.id, true)).map(
        (project) => project.id,
      ),
    ).toEqual([kept.id]);
  });

  test("deletes a project from the sidebar menu", async ({ pageAs }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    await createProjectViaApi(page.request, workspace.id);
    const doomed = await createProjectViaApi(page.request, workspace.id);

    // The context panel lists projects on the Projects destination.
    await page.goto(projectsPath(workspace.id));
    await openSidebarMenu(page, doomed.name);
    await page.getByRole("menuitem", { name: "Delete project" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Delete project?" });
    await expect(
      dialog.getByText(
        "The project and its tasks move to the trash. You can restore them from Recently deleted in workspace settings until they are deleted permanently.",
      ),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Delete project" }).click();

    await expect(page.getByText("Project moved to the trash")).toBeVisible();
    await expect(sidebarProject(page, doomed.name)).toHaveCount(0);
    expect(
      (await listProjects(page, workspace.id)).map((project) => project.id),
    ).not.toContain(doomed.id);
  });
});

test.describe("sidebar", () => {
  test("reorders projects by dragging and keeps the order", async ({
    pageAs,
  }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    const alpha = await createProjectViaApi(page.request, workspace.id, {
      name: uniqueName("Alpha"),
    });
    const bravo = await createProjectViaApi(page.request, workspace.id, {
      name: uniqueName("Bravo"),
    });
    const charlie = await createProjectViaApi(page.request, workspace.id, {
      name: uniqueName("Charlie"),
    });

    await page.goto(projectsPath(workspace.id));
    // Tolerates a dev-server reload between polls.
    const names = () =>
      sidebarProjects(page)
        .locator("[data-sidebar=menu-item][data-margaya-sortable]")
        .allInnerTexts()
        // Each row also carries the sr-only "More" of its menu button.
        .then((texts) =>
          texts.map((text) => (text.split(/\r?\n/)[0] ?? "").trim()),
        )
        .catch(() => [] as string[]);
    await expect.poll(names).toEqual([alpha.name, bravo.name, charlie.name]);
    // Rows become draggable once the permission check has answered.
    await expect(
      sidebarProjects(page).getByRole("button", { name: "Add project" }),
    ).toBeVisible();

    const reordered = page.waitForResponse(
      (response) =>
        response.url().includes("/api/project/reorder") &&
        response.request().method() === "PUT",
    );
    await dragTo(
      page,
      sidebarProject(page, charlie.name),
      sidebarProject(page, alpha.name),
    );
    expect((await reordered).status()).toBe(200);
    await expect.poll(names).toEqual([charlie.name, alpha.name, bravo.name]);

    await page.reload();
    await expect.poll(names).toEqual([charlie.name, alpha.name, bravo.name]);
    expect(
      (await listProjects(page, workspace.id)).map((project) => project.id),
    ).toEqual([charlie.id, alpha.id, bravo.id]);

    // A plain click still opens the project.
    await sidebarProject(page, bravo.name).click();
    await expect(page).toHaveURL(new RegExp(boardPath(workspace.id, bravo.id)));
  });
});
