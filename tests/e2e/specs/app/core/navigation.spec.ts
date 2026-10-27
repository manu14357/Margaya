import type { Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { uniqueName } from "../../../helpers/ui";
import type { SeedManifest } from "../../../seed/seed";
import {
  boardPath,
  createProjectViaApi,
  createTaskViaApi,
  dragTo,
  expect,
  newUserWithWorkspace,
  projectsPath,
  taskPath,
  workspacePath,
} from "./_support";

// Multi-step flows against shared, often busy dev servers: allow more than
// the default 60 s per test and 30 s per navigation.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 60_000 });

const ORIGIN = { Origin: E2E_WEB_URL };

async function openWorkspace(page: Page, seed: SeedManifest) {
  await page.goto(projectsPath(seed.workspace.id));
  await expect(
    page.getByRole("cell", { name: seed.projects.web.name }).first(),
  ).toBeVisible();
}

function searchDialog(page: Page) {
  return page.getByRole("dialog").filter({
    has: page.getByPlaceholder("Search tasks, pages, projects, comments..."),
  });
}

/** The command bar (Ctrl K, or the top bar's field). */
function paletteDialog(page: Page) {
  return page.getByRole("dialog").filter({
    has: page.getByRole("combobox", { name: "Search or jump to…" }),
  });
}

function paletteInput(page: Page) {
  return paletteDialog(page)
    .first()
    .getByRole("combobox", { name: "Search or jump to…" });
}

test.describe("global search", () => {
  // Read-only searches over the seeded workspace, as its owner.
  test("finds a task by title and opens it", async ({ page, seed }) => {
    const hero = seed.projects.web.tasks.hero;
    await openWorkspace(page, seed);

    // The top bar's field opens the command bar; its Search command opens
    // the global search.
    await page
      .getByRole("button", { name: "Search or jump to…" })
      .first()
      .click();
    await paletteDialog(page)
      .first()
      .getByRole("option", { name: /^Search/ })
      .click();
    const dialog = searchDialog(page).first();
    const input = dialog.getByPlaceholder(
      "Search tasks, pages, projects, comments...",
    );
    await expect(input).toBeFocused();
    await input.fill("la");
    await expect(
      dialog.getByText("Type at least 3 characters to search"),
    ).toBeVisible();

    await input.fill("landing page hero");
    const result = dialog.getByRole("option", { name: `task: ${hero.title}` });
    await expect(result).toBeVisible();
    await expect(dialog.getByText("Tasks", { exact: true })).toBeVisible();
    await result.click();

    await expect(page).toHaveURL(
      new RegExp(taskPath(seed.workspace.id, seed.projects.web.id, hero.id)),
    );
    await expect(page.getByPlaceholder("Click to add a title")).toHaveValue(
      hero.title,
    );
  });

  // Regression test for app-core.md bug 7 (key matches were filtered out).
  test("finds a task by its key from the / shortcut", async ({
    page,
    seed,
  }) => {
    const web = seed.projects.web;
    const task = web.tasks["login-bug"];
    await openWorkspace(page, seed);

    await page.keyboard.press("/");
    const dialog = searchDialog(page).first();
    await expect(dialog).toBeVisible();
    await dialog
      .getByPlaceholder("Search tasks, pages, projects, comments...")
      .fill(`${web.slug}-${task.number}`);
    const result = dialog.getByRole("option", { name: `task: ${task.title}` });
    await expect(result).toBeVisible();
    // An exact key match ranks first.
    await expect(dialog.getByRole("option").first()).toHaveAccessibleName(
      `task: ${task.title}`,
    );
    await result.click();
    await expect(page).toHaveURL(
      new RegExp(taskPath(seed.workspace.id, web.id, task.id)),
    );
  });

  test("the search page finds a task by its key", async ({ page, seed }) => {
    const web = seed.projects.web;
    const task = web.tasks["login-bug"];
    await page.goto(`${workspacePath(seed.workspace.id)}/search`);
    const input = page.getByPlaceholder(
      "Search tasks by title or short ID (e.g. DEP-23)...",
    );
    await expect(input).toBeVisible();
    await input.fill(`${web.slug}-${task.number}`);
    const result = page.getByRole("button", { name: new RegExp(task.title) });
    await expect(result).toBeVisible();
    await expect(page.getByText(/\d+ results? found/)).toBeVisible();
    await result.click();
    // The task opens in its side sheet over the project board.
    await expect(page).toHaveURL(
      new RegExp(`/project/${web.id}/board\\?taskId=${task.id}`),
    );
    await expect(page.getByPlaceholder("Click to add a title")).toHaveValue(
      task.title,
    );
  });

  test("finds projects and reports empty results", async ({ page, seed }) => {
    await openWorkspace(page, seed);
    await page.keyboard.press("/");
    const dialog = searchDialog(page).first();
    const input = dialog.getByPlaceholder(
      "Search tasks, pages, projects, comments...",
    );
    await input.fill("Website Relaunch");
    await expect(
      dialog.getByRole("option", {
        name: `project: ${seed.projects.web.name}`,
      }),
    ).toBeVisible();

    await input.fill(`zzq-${Date.now().toString(36)}-nothing`);
    await expect(dialog.getByText("No results found.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

test.describe("command palette", () => {
  test("opens with Ctrl+K, lists its commands and filters them", async ({
    page,
    seed,
  }) => {
    await openWorkspace(page, seed);
    await page.keyboard.press("Control+k");
    const palette = paletteDialog(page).first();
    await expect(palette).toBeVisible();
    for (const command of [
      "Projects",
      "Search",
      "Members",
      "Create task",
      "Create project",
      "Light theme",
      "Dark theme",
      "System theme",
      "High contrast light theme",
      "High contrast dark theme",
      "Keyboard shortcuts",
    ]) {
      await expect(
        palette.getByRole("option", { name: new RegExp(`^${command}`) }),
      ).toBeVisible();
    }
    await expect(palette.getByText("Suggestions")).toBeVisible();
    await expect(palette.getByText("Commands")).toBeVisible();

    await paletteInput(page).fill("theme");
    // Light, dark, system and the two high-contrast themes.
    await expect(palette.getByRole("option", { name: /theme/i })).toHaveCount(
      5,
    );
    await expect(
      palette.getByRole("option", { name: /^Create task/ }),
    ).toHaveCount(0);

    await paletteInput(page).fill("qqqq");
    await expect(palette.getByText("No results found.")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });

  test("runs theme, create-project and shortcuts commands", async ({
    page,
    seed,
  }) => {
    await openWorkspace(page, seed);
    const html = page.locator("html");

    await page.keyboard.press("Control+k");
    let palette = paletteDialog(page).first();
    await palette.getByRole("option", { name: /^Light theme/ }).click();
    await expect(palette).toBeHidden();
    await expect(html).toHaveClass(/\blight\b/);

    await page.keyboard.press("Control+k");
    palette = paletteDialog(page).first();
    await palette.getByRole("option", { name: /^Dark theme/ }).click();
    await expect(html).toHaveClass(/\bdark\b/);

    await page.keyboard.press("Control+k");
    await paletteDialog(page)
      .first()
      .getByRole("option", { name: /^Create project/ })
      .click();
    const create = page.getByRole("dialog", { name: "Create a new project" });
    await expect(create).toBeVisible();
    await create.getByRole("button", { name: "Cancel" }).click();
    await expect(create).toBeHidden();

    await page.keyboard.press("Control+k");
    await paletteDialog(page)
      .first()
      .getByRole("option", { name: /^Keyboard shortcuts/ })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Keyboard shortcuts" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+k");
    await paletteDialog(page)
      .first()
      .getByRole("option", { name: /^Projects/ })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`${projectsPath(seed.workspace.id)}$`),
    );
  });

  // Regression test for app-core.md bug 6 (it opened a missing route).
  test("the Members command opens the members page", async ({ page, seed }) => {
    await openWorkspace(page, seed);
    await page.keyboard.press("Control+k");
    await paletteDialog(page)
      .first()
      .getByRole("option", { name: /^Members/ })
      .click();
    await expect(page).toHaveURL(/\/members$/);
    await expect(page.getByText(seed.users.viewer.email)).toBeVisible();
  });
});

test.describe("keyboard shortcuts help", () => {
  test("? opens the shortcut list, which can be searched", async ({
    page,
    seed,
  }) => {
    await openWorkspace(page, seed);
    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toBeVisible();
    await expect(
      help.getByText("Speed up your workflow with keyboard shortcuts"),
    ).toBeVisible();
    for (const category of ["General", "Create", "Views", "Navigation"]) {
      await expect(help.getByRole("heading", { name: category })).toBeVisible();
    }
    await expect(help.getByText("Open command palette")).toBeVisible();
    await expect(help.getByText("Create task")).toBeVisible();

    await help.getByPlaceholder("Search shortcuts...").fill("palette");
    await expect(help.getByText("Open command palette")).toBeVisible();
    await expect(help.getByText("Create task")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();
  });
});

test.describe("favorites", () => {
  function favoritesGroup(page: Page) {
    return page
      .locator("[data-sidebar=group]")
      .filter({ has: page.getByText("Favorites", { exact: true }) });
  }

  test("stars projects, reorders and removes them in the sidebar", async ({
    pageAs,
  }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    // At 720 px the sidebar scrolls and the favorites sit in dnd-kit's
    // bottom auto-scroll zone, which scrolls the list away under the drag.
    await page.setViewportSize({ width: 1280, height: 1000 });
    const first = await createProjectViaApi(page.request, workspace.id, {
      name: uniqueName("Fav one"),
    });
    const second = await createProjectViaApi(page.request, workspace.id, {
      name: uniqueName("Fav two"),
    });

    await page.goto(boardPath(workspace.id, first.id));
    await expect(
      page.getByRole("button", { name: "Add task" }).first(),
    ).toBeVisible();
    await expect(favoritesGroup(page)).toHaveCount(0);

    // Star the open project from its header.
    const star = page.getByRole("button", { name: "Add to favorites" });
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await star.click();
    await expect(page.getByText("Added to favorites")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove from favorites" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      favoritesGroup(page).getByRole("button", { name: first.name }),
    ).toBeVisible();

    // Star the other one from the sidebar project menu.
    const row = page
      .locator("[data-sidebar=menu-item]")
      .filter({
        has: page.getByRole("button", { name: second.name, exact: true }),
      })
      .last();
    await row.hover();
    await row.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Add to favorites" }).click();
    await expect(
      favoritesGroup(page).getByRole("button", { name: second.name }),
    ).toBeVisible();

    const favoriteNames = () =>
      favoritesGroup(page)
        .locator("[data-sidebar=menu-button]")
        .allInnerTexts()
        .then((texts) => texts.map((text) => text.trim()))
        .catch(() => [] as string[]);
    // The newest favorite goes to the top.
    await expect.poll(favoriteNames).toEqual([second.name, first.name]);

    // Drag the first back above the second.
    const reordered = page.waitForResponse(
      (response) =>
        response.url().includes("/api/favorite/reorder") &&
        response.request().method() === "PUT",
    );
    await dragTo(
      page,
      favoritesGroup(page).getByRole("button", { name: first.name }),
      favoritesGroup(page).getByRole("button", { name: second.name }),
    );
    expect((await reordered).ok()).toBe(true);
    await expect.poll(favoriteNames).toEqual([first.name, second.name]);
    await page.reload();
    await expect.poll(favoriteNames).toEqual([first.name, second.name]);

    // Clicking a favorite opens it.
    await favoritesGroup(page)
      .getByRole("button", { name: second.name })
      .click();
    await expect(page).toHaveURL(
      new RegExp(boardPath(workspace.id, second.id)),
    );

    // Remove one from its favorites menu, the other with the header star.
    const favoriteRow = favoritesGroup(page)
      .locator("[data-sidebar=menu-item]")
      .filter({ hasText: first.name });
    await favoriteRow.hover();
    await favoriteRow.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Remove from favorites" }).click();
    await expect(page.getByText("Removed from favorites")).toBeVisible();
    await expect.poll(favoriteNames).toEqual([second.name]);

    await page.getByRole("button", { name: "Remove from favorites" }).click();
    await expect(favoritesGroup(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add to favorites" }),
    ).toBeVisible();
  });
});

test.describe("recents", () => {
  test("opened tasks and projects show up under Recents on Home", async ({
    pageAs,
  }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    const project = await createProjectViaApi(page.request, workspace.id);
    const task = await createTaskViaApi(page.request, project.id, {
      title: uniqueName("Recent task"),
    });

    const recents = async () => {
      const response = await page.request.get(
        `${E2E_API_URL}/api/recent-visit`,
        {
          params: { workspaceId: workspace.id },
          headers: ORIGIN,
        },
      );
      expect(response.status()).toBe(200);
      return JSON.stringify(await response.json());
    };
    expect(await recents()).not.toContain(`"entityId":"${task.id}"`);

    const recorded = page.waitForResponse(
      (response) =>
        response.url().includes("/api/recent-visit") &&
        response.request().method() === "POST" &&
        (response.request().postData() ?? "").includes(task.id),
    );
    await page.goto(taskPath(workspace.id, project.id, task.id));
    await expect(page.getByPlaceholder("Click to add a title")).toHaveValue(
      task.title,
    );
    expect((await recorded).ok()).toBe(true);

    await expect.poll(recents).toContain(`"entityId":"${task.id}"`);

    const projectRecorded = page.waitForResponse(
      (response) =>
        response.url().includes("/api/recent-visit") &&
        response.request().method() === "POST" &&
        (response.request().postData() ?? "").includes(
          '"entityType":"project"',
        ),
    );
    await page.goto(boardPath(workspace.id, project.id));
    expect((await projectRecorded).ok()).toBe(true);
    await expect.poll(recents).toContain(`"entityId":"${project.id}"`);

    // Home lists both under Recents, newest first; the task opens from there.
    await page.goto(workspacePath(workspace.id));
    const widget = page.getByRole("region", { name: "Recents" });
    const projectLink = widget.getByRole("link", {
      name: new RegExp(project.name),
    });
    const taskLink = widget.getByRole("link", { name: new RegExp(task.title) });
    await expect(projectLink).toBeVisible();
    await expect(taskLink).toBeVisible();
    await expect(taskLink).toContainText(`${project.slug}-${task.number}`);
    await expect(widget.getByRole("link").first()).toContainText(project.name);

    await widget.getByRole("tab", { name: "Tasks" }).click();
    await expect(taskLink).toBeVisible();
    await expect(projectLink).toHaveCount(0);

    await taskLink.click();
    await expect(page).toHaveURL(new RegExp(`taskId=${task.id}`));
    await expect(page.getByPlaceholder("Click to add a title")).toHaveValue(
      task.title,
    );
  });
});
