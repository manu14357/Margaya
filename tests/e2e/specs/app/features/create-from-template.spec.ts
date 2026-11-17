import type { Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import {
  expect,
  newUserWithWorkspace,
  projectsPath,
  uniqueKey,
} from "../core/_support";

// The guided project create flow: the template gallery and its preview,
// Set up, the board's example-task banner and "First steps" strip, the
// keyboard fast path, drafts and the command palette entries. Every test
// runs in a workspace owned by a user created for it.

test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 60_000 });

const ORIGIN = { Origin: E2E_WEB_URL };
const TEMPLATE_ID = "kanban";

type Catalog = { templates: { id: string; name: string }[] };

async function templateName(page: Page, id: string) {
  const response = await page.request.get(
    `${E2E_API_URL}/api/project-template`,
    { params: { locale: "en-US" }, headers: ORIGIN },
  );
  expect(response.status()).toBe(200);
  const catalog = (await response.json()) as Catalog;
  const template = catalog.templates.find((item) => item.id === id);
  expect(template, `template ${id} in the catalog`).toBeDefined();
  return template?.name ?? id;
}

async function projectById(page: Page, workspaceId: string, id: string) {
  const response = await page.request.get(`${E2E_API_URL}/api/project/${id}`, {
    params: { workspaceId },
    headers: ORIGIN,
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    name: string;
    slug: string;
    hasSampleData: boolean;
  };
}

function createDialog(page: Page) {
  // The title carries a visually hidden "Step N of 2:" prefix.
  return page.getByRole("dialog", {
    name: /Create a project|Set up your project/,
  });
}

async function openFromSidebar(page: Page) {
  await page
    .locator("[data-sidebar=group]")
    .filter({ has: page.getByText("Projects", { exact: true }) })
    .last()
    .getByRole("button", { name: "Add project" })
    .first()
    .click();
  const dialog = createDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

function projectIdFromUrl(page: Page) {
  return page.url().match(/\/project\/([^/]+)\/board/)?.[1] ?? "";
}

test("creates a project from a template with example tasks and removes them", async ({
  pageAs,
}) => {
  const { page, workspace } = await newUserWithWorkspace(pageAs);
  const template = await templateName(page, TEMPLATE_ID);
  await page.goto(projectsPath(workspace.id));
  const dialog = await openFromSidebar(page);

  // Search finds the template; selecting it fills the preview.
  await dialog
    .getByRole("searchbox", { name: "Search templates" })
    .fill(template);
  const tile = dialog.getByRole("radio", { name: new RegExp(template) });
  await tile.first().click();
  await expect(tile.first()).toHaveAttribute("aria-checked", "true");
  const preview = dialog.getByRole("region", { name: `Preview: ${template}` });
  await expect(preview).toBeVisible();
  await expect(preview.getByText("Statuses")).toBeVisible();

  await dialog.getByRole("button", { name: "Use template" }).click();
  await expect(
    dialog.getByRole("heading", { name: /Set up your project/ }),
  ).toBeVisible();
  const name = dialog.getByLabel("Project name");
  await expect(name).toHaveValue(template);
  const projectName = `Flow ${uniqueKey("T")}`;
  await name.fill(projectName);

  // Example tasks are off outside onboarding.
  const examples = dialog.getByRole("switch", { name: "Add example tasks" });
  await expect(examples).not.toBeChecked();
  await examples.click();
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/project\/[^/]+\/board$/);
  const projectId = projectIdFromUrl(page);
  expect((await projectById(page, workspace.id, projectId)).hasSampleData).toBe(
    true,
  );

  // The success moment: the first-steps strip offers removing the examples
  // (the banner takes over only once the strip is hidden or done).
  const strip = page.getByRole("region", { name: "First steps" });
  await expect(strip).toBeVisible();
  const banner = page
    .getByRole("status")
    .filter({ hasText: "This project has example tasks." });
  await expect(banner).toBeHidden();
  await strip.getByRole("button", { name: "Remove examples" }).click();
  const confirm = page.getByRole("alertdialog", {
    name: "Remove the example tasks?",
  });
  await confirm.getByRole("button", { name: "Remove examples" }).click();
  await expect(
    page.getByText(/example tasks? moved to the trash/),
  ).toBeVisible();
  await expect(banner).toBeHidden();
  expect((await projectById(page, workspace.id, projectId)).hasSampleData).toBe(
    false,
  );
});

test("the keyboard fast path: Enter on a tile, type the name, Ctrl+Enter", async ({
  pageAs,
}) => {
  const { page, workspace } = await newUserWithWorkspace(pageAs);
  await page.goto(projectsPath(workspace.id));
  const dialog = await openFromSidebar(page);

  // Blank is selected and focusable in the radio group; Enter continues.
  const blank = dialog.getByRole("radio", { name: /Blank project/ });
  await expect(blank).toHaveAttribute("aria-checked", "true");
  await blank.focus();
  await page.keyboard.press("Enter");
  const name = dialog.getByLabel("Project name");
  await expect(name).toBeFocused();
  const projectName = `Fast ${uniqueKey("F")}`;
  await page.keyboard.type(projectName);
  await page.keyboard.press("Control+Enter");

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/project\/[^/]+\/board$/);
  expect(
    (await projectById(page, workspace.id, projectIdFromUrl(page))).name,
  ).toBe(projectName);
});

test("Escape keeps a draft that the next opening restores", async ({
  pageAs,
}) => {
  const { page, workspace } = await newUserWithWorkspace(pageAs);
  await page.goto(projectsPath(workspace.id));
  let dialog = await openFromSidebar(page);
  await dialog.getByRole("button", { name: "Start blank" }).click();
  await dialog.getByLabel("Project name").fill("Half done");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  dialog = await openFromSidebar(page);
  await expect(
    dialog.getByText("Restored your unfinished project."),
  ).toHaveCount(0);
  // The draft reopens on Set up with the typed name.
  await expect(dialog.getByLabel("Project name")).toHaveValue("Half done");
  await dialog.getByRole("button", { name: "Back" }).click();
  await expect(
    dialog.getByText("Restored your unfinished project."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Start over" }).click();
  await dialog.getByRole("button", { name: "Start blank" }).click();
  await expect(dialog.getByLabel("Project name")).toHaveValue("");
});

test("the command palette opens a blank project on Set up", async ({
  pageAs,
}) => {
  const { page, workspace } = await newUserWithWorkspace(pageAs);
  await page.goto(projectsPath(workspace.id));
  // The palette shortcut works once the page is ready.
  await expect(page.getByText("No projects yet")).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("New blank project");
  await page
    .getByRole("option", { name: /^New blank project/ })
    .first()
    .click();
  const dialog = createDialog(page);
  await expect(
    dialog.getByRole("heading", { name: /Set up your project/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+k");
  await page.keyboard.type("New project from template");
  await page
    .getByRole("option", { name: /^New project from template/ })
    .first()
    .click();
  await expect(
    createDialog(page).getByRole("searchbox", { name: "Search templates" }),
  ).toBeFocused();
});
