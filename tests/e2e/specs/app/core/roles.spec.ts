import type { Locator, Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import {
  boardPath,
  createProjectViaApi,
  expect,
  newUserWithWorkspace,
  signUpViaApi,
  workspacePath,
} from "./_support";

// Multi-step flows against shared, often busy dev servers: allow more than
// the default 60 s per test and 30 s per navigation.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 60_000 });

// Custom roles are created in a workspace the test owns, so the editable
// default roles of the seeded workspace are never touched.

const ORIGIN = { Origin: E2E_WEB_URL };

/** The switch for `action` inside the `resource` group of a role panel. */
function permissionSwitch(panel: Locator, resource: string, action: string) {
  return panel
    .getByText(resource, { exact: true })
    .locator("xpath=..")
    .getByRole("switch", { name: action, exact: true });
}

function roleTrigger(page: Page, name: string | RegExp) {
  return page.getByRole("button", { name });
}

test("an owner creates a custom role, edits it, assigns it and deletes it", async ({
  pageAs,
}) => {
  const { page, workspace } = await newUserWithWorkspace(pageAs);
  const project = await createProjectViaApi(page.request, workspace.id);

  // A second person joins as a member.
  const teammatePage = await pageAs("anonymous");
  const teammate = await signUpViaApi(teammatePage.request);
  const invitation = await (
    await page.request.post(
      `${E2E_API_URL}/api/auth/organization/invite-member`,
      {
        data: {
          email: teammate.email,
          role: "member",
          organizationId: workspace.id,
        },
        headers: ORIGIN,
      },
    )
  ).json();
  expect(
    (
      await teammatePage.request.post(
        `${E2E_API_URL}/api/auth/organization/accept-invitation`,
        { data: { invitationId: invitation.id }, headers: ORIGIN },
      )
    ).status(),
  ).toBe(200);

  await page.goto(workspacePath(workspace.id));
  await page.goto("/dashboard/settings/workspace/roles");
  await expect(
    page.getByText(
      `Define which actions members can perform in ${workspace.name}.`,
    ),
  ).toBeVisible();
  for (const role of ["Viewer", "Member", "Admin"]) {
    await expect(
      roleTrigger(page, new RegExp(`^${role} Default`)),
    ).toBeVisible();
  }

  const roleName = `reviewer${Date.now().toString(36)}`;

  // Draft: a name and at least one permission are required.
  await page.getByRole("button", { name: "New role" }).click();
  const draft = page.getByRole("region", { name: /New role/ });
  await expect(draft.getByPlaceholder("e.g. reviewer")).toBeVisible();
  await draft.getByPlaceholder("e.g. reviewer").fill("viewer");
  await permissionSwitch(draft, "Tasks", "Read").click();
  await draft.getByRole("button", { name: "Create role" }).click();
  await expect(
    page.getByText("A role with this name already exists"),
  ).toBeVisible();

  await draft.getByPlaceholder("e.g. reviewer").fill(roleName.toUpperCase());
  await permissionSwitch(draft, "Tasks", "Read").click();
  await expect(permissionSwitch(draft, "Tasks", "Read")).not.toBeChecked();
  await draft.getByRole("button", { name: "Create role" }).click();
  await expect(
    page.getByText("At least one permission must be selected"),
  ).toBeVisible();

  await permissionSwitch(draft, "Projects", "Read").click();
  await permissionSwitch(draft, "Tasks", "Read").click();
  await permissionSwitch(draft, "Tasks", "Create").click();
  await expect(permissionSwitch(draft, "Tasks", "Create")).toBeChecked();
  await draft.getByRole("button", { name: "Create role" }).click();
  await expect(page.getByText("Role created")).toBeVisible();

  // Stored lower-cased, with its permission count.
  const trigger = roleTrigger(page, new RegExp(`^${roleName}`, "i"));
  await expect(trigger).toContainText(roleName);
  await expect(trigger).toContainText("3 permissions");

  // Edit: toggling marks the role dirty until it is saved.
  const panel = page.getByRole("region", { name: new RegExp(roleName, "i") });
  await expect(panel.getByText("All changes saved")).toBeVisible();
  await permissionSwitch(panel, "Tasks", "Update").click();
  await expect(panel.getByText("You have unsaved changes")).toBeVisible();
  await panel.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Role updated")).toBeVisible();
  await expect(panel.getByText("All changes saved")).toBeVisible();
  await expect(trigger).toContainText("4 permissions");

  await page.reload();
  await expect(trigger).toContainText("4 permissions");

  // Assign it to the teammate from the members list.
  await page.goto(`${workspacePath(workspace.id)}/members`);
  const row = page.getByRole("row").filter({ hasText: teammate.email });
  await row.getByRole("combobox").click();
  await page
    .getByRole("listbox")
    .getByRole("option", { name: new RegExp(`^${roleName}$`, "i") })
    .click();
  await expect(page.getByText("Role updated")).toBeVisible();

  // The custom role's grants drive the teammate's UI: tasks yes, projects no.
  await teammatePage.goto(boardPath(workspace.id, project.id));
  await expect(
    teammatePage.getByRole("button", { name: "Add task" }).first(),
  ).toBeVisible({ timeout: 30_000 });
  // (A workspace with one project opens straight on its board.)
  await teammatePage.goto(workspacePath(workspace.id));
  await expect(
    teammatePage
      .getByRole("button", { name: project.name, exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    teammatePage.getByRole("button", { name: "Add project" }),
  ).toHaveCount(0);

  // Hand the default role back, then delete the custom one.
  await row.getByRole("combobox").click();
  await page
    .getByRole("listbox")
    .getByRole("option", { name: "Member" })
    .click();
  await expect(row.getByRole("combobox")).toHaveText("Member");

  await page.goto("/dashboard/settings/workspace/roles");
  await trigger.click();
  await panel.getByRole("button", { name: "Delete role" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete role" });
  await expect(
    confirm.getByText(`This will permanently delete the role "${roleName}".`, {
      exact: false,
    }),
  ).toBeVisible();
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Role deleted")).toBeVisible();
  await expect(trigger).toHaveCount(0);
});

test("default roles can be inspected but not deleted", async ({ pageAs }) => {
  const { page, workspace } = await newUserWithWorkspace(pageAs);
  await page.goto(workspacePath(workspace.id));
  await page.goto("/dashboard/settings/workspace/roles");

  await roleTrigger(page, /^Viewer Default/).click();
  const panel = page.getByRole("region", { name: /^Viewer Default/ });
  await expect(
    panel.getByText(
      "Default role: name is reserved and the row can't be deleted.",
    ),
  ).toBeVisible();
  await expect(panel.getByRole("button", { name: "Delete role" })).toHaveCount(
    0,
  );
  await expect(permissionSwitch(panel, "Tasks", "Read")).toBeChecked();
  await expect(permissionSwitch(panel, "Tasks", "Create")).not.toBeChecked();
  await expect(
    panel.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
});
