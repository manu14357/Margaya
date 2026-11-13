import type { Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { readJson } from "../../../helpers/http";
import { uniqueName } from "../../../helpers/ui";
import {
  createProjectViaApi,
  expect,
  initialsOf,
  newUserWithWorkspace,
  projectsPath,
  sidebar,
  workspacePath,
} from "./_support";

// Changes made on one device show on another without a reload: the same
// person in two browser contexts (as a second browser, or the desktop app,
// would be), with no project socket open on the watching side. Everything
// is created here, so seeded data stays untouched.

test.describe.configure({ timeout: 120_000 });

const ORIGIN = { Origin: E2E_WEB_URL };

/** A second "device": a new browser context with the same session. */
async function secondDevice(page: Page): Promise<Page> {
  const browser = page.context().browser();
  if (!browser) throw new Error("No browser for a second context");
  const context = await browser.newContext({
    baseURL: E2E_WEB_URL,
    storageState: await page.context().storageState(),
  });
  return context.newPage();
}

test("a profile change reaches the person's other device", async ({
  pageAs,
}) => {
  const { page, workspace } = await newUserWithWorkspace(pageAs);
  const other = await secondDevice(page);
  await other.goto(workspacePath(workspace.id));
  const accountButton = other.getByRole("button", { name: "Account menu" });
  await expect(accountButton).toBeVisible();

  const name = "Rita Realtime";
  await readJson(
    await page.request.post(`${E2E_API_URL}/api/auth/update-user`, {
      data: { name },
      headers: ORIGIN,
    }),
    "update user",
  );

  // USER_PROFILE_UPDATED on the user socket reloads the session.
  await expect(accountButton).toContainText(initialsOf(name));
  await other.context().close();
});

test("a project rename reaches another device's sidebar", async ({
  pageAs,
}) => {
  const { page, workspace } = await newUserWithWorkspace(pageAs);
  const project = await createProjectViaApi(page.request, workspace.id);
  const other = await secondDevice(page);
  await other.goto(projectsPath(workspace.id));
  await expect(sidebar(other).getByText(project.name)).toBeVisible();

  const renamed = uniqueName("Renamed project");
  await readJson(
    await page.request.put(`${E2E_API_URL}/api/project/${project.id}`, {
      params: { workspaceId: workspace.id },
      data: {
        name: renamed,
        icon: "Layout",
        slug: project.slug,
        description: "",
        isPublic: false,
      },
      headers: ORIGIN,
    }),
    "rename project",
  );

  // PROJECTS_UPDATED reaches tabs without the project's socket.
  await expect(sidebar(other).getByText(renamed)).toBeVisible();
  await expect(sidebar(other).getByText(project.name)).toBeHidden();
  await other.context().close();
});

test("a new project appears on another device without a reload", async ({
  pageAs,
}) => {
  const { page, workspace } = await newUserWithWorkspace(pageAs);
  const other = await secondDevice(page);
  await other.goto(projectsPath(workspace.id));
  await expect(sidebar(other)).toBeVisible();

  const project = await createProjectViaApi(page.request, workspace.id);
  await expect(sidebar(other).getByText(project.name)).toBeVisible();
  await other.context().close();
});
