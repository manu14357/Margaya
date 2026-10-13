import { test } from "../../../fixtures";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { uniqueName } from "../../../helpers/ui";
import {
  createWorkspaceViaApi,
  expect,
  newUserWithWorkspace,
  signUpViaApi,
  workspacePath,
} from "./_support";

// Multi-step flows against shared, often busy dev servers: allow more than
// the default 60 s per test and 30 s per navigation.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 60_000 });

// Workspaces here belong to users created by the test, so renaming, switching
// and deleting never touch the seeded "E2E Workspace" or the owner's session.

type OrgSummary = {
  id: string;
  name: string;
  description?: string | null;
  metadata?: unknown;
};

async function listWorkspaces(page: import("@playwright/test").Page) {
  const response = await page.request.get(
    `${E2E_API_URL}/api/auth/organization/list`,
    { headers: { Origin: E2E_WEB_URL } },
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as OrgSummary[];
}

function descriptionOf(workspace: OrgSummary | undefined) {
  if (typeof workspace?.description === "string") return workspace.description;
  const metadata =
    typeof workspace?.metadata === "string"
      ? JSON.parse(workspace.metadata)
      : workspace?.metadata;
  return (metadata as { description?: string } | null)?.description;
}

function workspaceSwitcher(
  page: import("@playwright/test").Page,
  name: string,
) {
  // The shell names the switcher "Switch workspace: <name>".
  return page
    .getByRole("button", { name: `Switch workspace: ${name}`, exact: true })
    .first();
}

test.describe("onboarding", () => {
  test("a new user without a workspace creates one and lands in it", async ({
    pageAs,
  }) => {
    const page = await pageAs("anonymous");
    await signUpViaApi(page.request);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(
      page.getByRole("heading", { name: "Create workspace" }),
    ).toBeVisible();

    // An empty name is refused before anything is sent.
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByText("Workspace name is required")).toBeVisible();

    const name = uniqueName("Onboarded WS");
    await page.getByLabel("Workspace name").fill(name);
    await page.getByLabel("Description (optional)").fill("Built by e2e");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByText("Step 2 of 4")).toBeVisible();

    // The project and invite steps are optional; skipping both finishes
    // the flow in the new workspace.
    await expect(
      page.getByRole("heading", { name: "Start your first project" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(
      page.getByRole("heading", { name: "Invite people" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).click();

    await expect(page).toHaveURL(/\/dashboard\/workspace\/[^/]+$/, {
      timeout: 15_000,
    });
    await expect(workspaceSwitcher(page, name)).toBeVisible();
    // The workspace opens on Home.
    await expect(
      page.getByRole("heading", { name: /^Good (morning|afternoon|evening),/ }),
    ).toBeVisible();

    const workspaces = await listWorkspaces(page);
    expect(workspaces.map((workspace) => workspace.name)).toEqual([name]);
    expect(page.url()).toContain(workspacePath(workspaces[0]?.id ?? "missing"));
  });
});

test.describe("workspace switcher", () => {
  test("switches between the user's workspaces and remembers the choice", async ({
    pageAs,
  }) => {
    const { page, workspace: first } = await newUserWithWorkspace(pageAs, {
      workspaceName: uniqueName("First WS"),
    });
    const second = await createWorkspaceViaApi(
      page.request,
      uniqueName("Second WS"),
    );

    await page.goto(workspacePath(first.id));
    await expect(workspaceSwitcher(page, first.name)).toBeVisible();

    await workspaceSwitcher(page, first.name).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByText("Workspaces")).toBeVisible();
    // The current workspace is listed but not selectable.
    await expect(
      menu.getByRole("menuitem", { name: new RegExp(first.name) }),
    ).toBeDisabled();
    await menu.getByRole("menuitem", { name: new RegExp(second.name) }).click();

    await expect(page).toHaveURL(new RegExp(`${workspacePath(second.id)}$`));
    await expect(workspaceSwitcher(page, second.name)).toBeVisible();

    // The active workspace is stored on the session: /dashboard reopens it.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(new RegExp(`${workspacePath(second.id)}$`));

    await workspaceSwitcher(page, second.name).click();
    await page.getByRole("menuitem", { name: new RegExp(first.name) }).click();
    await expect(page).toHaveURL(new RegExp(`${workspacePath(first.id)}$`));
    await expect(workspaceSwitcher(page, first.name)).toBeVisible();
  });

  test("adds a workspace from the switcher menu", async ({ pageAs }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    await page.goto(workspacePath(workspace.id));

    await workspaceSwitcher(page, workspace.name).click();
    await page.getByRole("menuitem", { name: "Add workspace" }).click();

    // Toasts are role=dialog too. This dialog's accessible name is
    // "Breadcrumb" (its title wraps a breadcrumb nav), so match its text.
    const dialog = page
      .getByRole("dialog")
      .filter({ hasText: "Create a new workspace" });
    await expect(dialog).toBeVisible();
    const name = uniqueName("Added WS");
    await dialog.getByPlaceholder("Workspace name").fill(name);
    await dialog.getByRole("button", { name: "Create workspace" }).click();

    await expect(
      page.getByText("Workspace created successfully"),
    ).toBeVisible();
    await expect(workspaceSwitcher(page, name)).toBeVisible();
    const created = (await listWorkspaces(page)).find(
      (candidate) => candidate.name === name,
    );
    expect(created).toBeDefined();
    await expect(page).toHaveURL(
      new RegExp(workspacePath(created?.id ?? "missing")),
    );
  });
});

test.describe("workspace general settings", () => {
  test("renames the workspace and updates its description", async ({
    pageAs,
  }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    await page.goto(workspacePath(workspace.id));
    await expect(workspaceSwitcher(page, workspace.name)).toBeVisible();
    await page.goto("/dashboard/settings/workspace/general");

    const nameInput = page.getByLabel("Workspace name");
    await expect(nameInput).toHaveValue(workspace.name);
    // Let the page's initial workspace fetches settle before editing.
    await page.waitForLoadState("networkidle");

    // Typed like a user: the form autosaves a second after the last key.
    const renamed = uniqueName("Renamed WS");
    await nameInput.clear();
    await nameInput.pressSequentially(renamed, { delay: 15 });
    await expect(
      page.getByText("Workspace updated successfully"),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await listWorkspaces(page)).find((w) => w.id === workspace.id)?.name,
      )
      .toBe(renamed);

    // Reload before the next edit, so each save is checked on its own
    // (app-core.md bug 4 was an intermittent revert here).
    await page.reload();
    await expect(page.getByLabel("Workspace name")).toHaveValue(renamed);
    await page.waitForLoadState("networkidle");
    await page
      .getByLabel("Description")
      .pressSequentially("Where the core specs live", { delay: 15 });
    await expect
      .poll(async () =>
        descriptionOf(
          (await listWorkspaces(page)).find((w) => w.id === workspace.id),
        ),
      )
      .toBe("Where the core specs live");
    expect(
      (await listWorkspaces(page)).find((w) => w.id === workspace.id)?.name,
    ).toBe(renamed);

    await page.reload();
    await expect(page.getByLabel("Workspace name")).toHaveValue(renamed);
    await expect(page.getByLabel("Description")).toHaveValue(
      "Where the core specs live",
    );

    await page.goto(workspacePath(workspace.id));
    await expect(workspaceSwitcher(page, renamed)).toBeVisible();
  });

  test("a too-short name is rejected and never saved", async ({ pageAs }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    await page.goto(workspacePath(workspace.id));
    await page.goto("/dashboard/settings/workspace/general");
    const nameInput = page.getByLabel("Workspace name");
    await expect(nameInput).toHaveValue(workspace.name);

    await nameInput.fill("X");
    await expect(
      page.getByText("Workspace name must be at least 2 characters"),
    ).toBeVisible();
    await nameInput.fill("");
    await expect(page.getByText("Workspace name is required")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Workspace name")).toHaveValue(workspace.name);
    expect(
      (await listWorkspaces(page)).find((w) => w.id === workspace.id)?.name,
    ).toBe(workspace.name);
  });

  // Regression test for app-core.md bug 2 (one-step edits were dropped).
  test("a name pasted in one step is saved", async ({ pageAs }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    await page.goto(workspacePath(workspace.id));
    await page.goto("/dashboard/settings/workspace/general");
    const nameInput = page.getByLabel("Workspace name");
    await expect(nameInput).toHaveValue(workspace.name);

    const renamed = uniqueName("Pasted WS");
    await nameInput.fill(renamed);
    await expect(
      page.getByText("Workspace updated successfully"),
    ).toBeVisible();
  });

  test("the owner deletes a workspace after confirming", async ({ pageAs }) => {
    const { page, workspace: keep } = await newUserWithWorkspace(pageAs, {
      workspaceName: uniqueName("Keep WS"),
    });
    const doomed = await createWorkspaceViaApi(
      page.request,
      uniqueName("Doomed WS"),
    );

    await page.goto(workspacePath(doomed.id));
    await expect(workspaceSwitcher(page, doomed.name)).toBeVisible();
    await page.goto("/dashboard/settings/workspace/general");
    await expect(page.getByLabel("Workspace name")).toHaveValue(doomed.name);

    await page.getByRole("button", { name: "Delete workspace" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Delete workspace?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(doomed.name)).toBeVisible();
    await dialog.getByRole("button", { name: "Delete workspace" }).click();

    await expect(
      page.getByText("Workspace deleted successfully"),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(workspacePath(keep.id)));
    const remaining = await listWorkspaces(page);
    expect(remaining.map((w) => w.id)).toEqual([keep.id]);
  });
});
