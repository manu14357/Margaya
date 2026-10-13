import type { Locator, Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { uniqueName } from "../../../helpers/ui";
import {
  boardPath,
  createProjectViaApi,
  expect,
  newUserWithWorkspace,
  type Project,
  workspacePath,
} from "./_support";

// Multi-step flows against shared, often busy dev servers: allow more than
// the default 60 s per test and 30 s per navigation.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 60_000 });

// Every test configures a project in a workspace owned by a fresh user.

const ORIGIN = { Origin: E2E_WEB_URL };

async function setUpProject(
  pageAs: Parameters<typeof newUserWithWorkspace>[0],
) {
  const session = await newUserWithWorkspace(pageAs);
  const project = await createProjectViaApi(
    session.page.request,
    session.workspace.id,
  );
  // Settings pages read the active workspace; open it once first.
  await session.page.goto(workspacePath(session.workspace.id));
  return { ...session, project };
}

async function projectFlags(page: Page, project: Project) {
  const read = () =>
    page.request.get(`${E2E_API_URL}/api/project/${project.id}`, {
      params: { workspaceId: project.workspaceId },
      headers: ORIGIN,
    });
  // One retry: the shared dev API occasionally resets a keep-alive socket.
  const response = await read().catch(() => read());
  expect(response.status()).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

function sectionStrip(page: Page) {
  return page.getByRole("navigation", { name: "Project sections" });
}

/** A column row on the workflow page, found through its group picker. */
function columnRow(page: Page, name: string): Locator {
  return page.locator("[draggable=true]").filter({
    has: page.getByRole("combobox", { name: `Choose a group for ${name}` }),
  });
}

test.describe("features", () => {
  const FEATURES = [
    { title: "Cycles", field: "cyclesEnabled", segment: "cycles" },
    { title: "Modules", field: "modulesEnabled", segment: "modules" },
    { title: "Views", field: "viewsEnabled", segment: "views" },
    { title: "Pages", field: "pagesEnabled", segment: "pages" },
    { title: "Intake", field: "intakeEnabled", segment: "intake" },
    { title: "Estimates", field: "estimatesEnabled", segment: null },
    { title: "Time tracking", field: "timeTrackingEnabled", segment: null },
  ] as const;

  for (const feature of FEATURES) {
    test(`${feature.title} can be turned off and on again`, async ({
      pageAs,
    }) => {
      const { page, workspace, project } = await setUpProject(pageAs);
      await page.goto(`/dashboard/settings/projects/${project.id}/features`);
      await expect(
        page.getByRole("heading", { name: "Planning features" }),
      ).toBeVisible();
      await expect(page.getByRole("switch").first()).toBeVisible();
      const toggle = page.getByRole("switch", {
        name: feature.title,
        exact: true,
      });
      test.skip(
        (await toggle.count()) === 0,
        `${feature.title} is not available in the web app yet`,
      );

      const initiallyOn = (await projectFlags(page, project))[feature.field];
      await expect(toggle).toBeChecked({ checked: initiallyOn === true });

      // Settings are reached inside the app, through the sidebar project's
      // menu: full reloads of the dev build are slow.
      const toBoard = async () => {
        await page.goto(boardPath(workspace.id, project.id));
        await expect(
          page.getByRole("button", { name: "Add task" }).first(),
        ).toBeVisible();
      };
      const toFeatures = async () => {
        if (
          page.url().includes(`/dashboard/settings/projects/${project.id}/`)
        ) {
          await page.getByRole("link", { name: "Features" }).click();
        } else {
          await page.goto(
            `/dashboard/settings/projects/${project.id}/features`,
          );
        }
        await expect(page).toHaveURL(/\/features$/);
      };

      const setTo = async (on: boolean) => {
        await toFeatures();
        const current = page.getByRole("switch", {
          name: feature.title,
          exact: true,
        });
        await expect(current).toBeChecked({ checked: !on });
        await current.click();
        if (!on) {
          // Turning off asks first; the data is kept.
          const confirm = page.getByRole("alertdialog", {
            name: `Turn off ${feature.title}?`,
          });
          await expect(
            confirm.getByText(
              `${feature.title} will be hidden for everyone in this project.`,
              { exact: false },
            ),
          ).toBeVisible();
          await confirm.getByRole("button", { name: "Turn off" }).click();
        }
        await expect(
          page.getByText(`${feature.title} turned ${on ? "on" : "off"}`),
        ).toBeVisible();
        await expect(current).toBeChecked({ checked: on });
        await expect
          .poll(async () => (await projectFlags(page, project))[feature.field])
          .toBe(on);
      };

      const expectVisible = async (on: boolean) => {
        if (feature.segment) {
          await toBoard();
          const tab = sectionStrip(page).getByRole("tab", {
            name: feature.title,
          });
          if (on) {
            await expect(tab).toBeVisible();
            await tab.click();
            await expect(page).toHaveURL(
              new RegExp(`/project/${project.id}/${feature.segment}`),
            );
          } else {
            await expect(tab).toHaveCount(0);
            // A direct link explains the feature is off.
            await page.goto(
              `${workspacePath(workspace.id)}/project/${project.id}/${feature.segment}`,
            );
            await expect(
              page.getByRole("button", { name: "Toggle sidebar" }).first(),
            ).toBeVisible();
            await expect(
              page.getByText(`${feature.title} is turned off for this project`),
            ).toBeVisible();
          }
        } else if (feature.field === "estimatesEnabled") {
          await page.getByRole("link", { name: "Estimates" }).click();
          await expect(page).toHaveURL(/\/estimates$/);
          const off = page.getByText(
            "Estimates is turned off for this project",
          );
          if (on) {
            await expect(
              page.getByRole("heading", { name: "Estimates", exact: true }),
            ).toBeVisible();
            await expect(off).toHaveCount(0);
          } else {
            await expect(off).toBeVisible();
          }
        }
      };

      if (initiallyOn) {
        await setTo(false);
        await expectVisible(false);
        await setTo(true);
        await expectVisible(true);
      } else {
        await setTo(true);
        await expectVisible(true);
        await setTo(false);
        await expectVisible(false);
      }
    });
  }

  test("cancelling the turn-off dialog keeps the feature on", async ({
    pageAs,
  }) => {
    const { page, project } = await setUpProject(pageAs);
    await page.goto(`/dashboard/settings/projects/${project.id}/features`);
    const cycles = page.getByRole("switch", { name: "Cycles", exact: true });
    await expect(cycles).toBeChecked();
    await cycles.click();
    const confirm = page.getByRole("alertdialog", { name: "Turn off Cycles?" });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
    await expect(cycles).toBeChecked();
    expect((await projectFlags(page, project)).cyclesEnabled).toBe(true);
  });

  // The project's tab row lists the task layouts, then its sections.
  // Analytics is not a project feature: it shows for anyone with the
  // analytics permission, so the owner keeps it after the layouts.
  test("with every section feature off only the layouts and Analytics remain", async ({
    pageAs,
  }) => {
    const layouts = [/Backlog/, /Board/, /Spreadsheet/, /Calendar/, /Gantt/];
    const { page, workspace, project } = await setUpProject(pageAs);
    await page.goto(boardPath(workspace.id, project.id));
    await expect(sectionStrip(page)).toBeVisible();
    await expect(
      sectionStrip(page).getByRole("tab", { name: "Board" }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      sectionStrip(page).getByRole("tab", { name: "Cycles" }),
    ).toBeVisible();

    const off = await page.request.patch(
      `${E2E_API_URL}/api/project/${project.id}/features`,
      {
        data: {
          cyclesEnabled: false,
          modulesEnabled: false,
          viewsEnabled: false,
          pagesEnabled: false,
          intakeEnabled: false,
        },
        headers: ORIGIN,
      },
    );
    expect(off.status()).toBe(200);

    await page.reload();
    await expect(
      page.getByRole("button", { name: "Add task" }).first(),
    ).toBeVisible();
    await expect(sectionStrip(page).getByRole("tab")).toHaveText([
      ...layouts,
      /Analytics/,
    ]);
  });
});

test.describe("workflow", () => {
  test("adds, renames, regroups and deletes a column", async ({ pageAs }) => {
    const { page, workspace, project } = await setUpProject(pageAs);
    await page.goto(`/dashboard/settings/projects/${project.id}/workflow`);
    await expect(page.getByRole("heading", { name: "Columns" })).toBeVisible();

    const groups: [string, string][] = [
      ["To Do", "Not started"],
      ["In Progress", "Started"],
      ["In Review", "Started"],
      ["Done", "Completed"],
    ];
    for (const [column, group] of groups) {
      await expect(
        page.getByRole("combobox", { name: `Choose a group for ${column}` }),
      ).toHaveText(group);
    }

    // Add a column in the "Started" group.
    const name = `QA ${Date.now().toString(36)}`;
    await page.getByPlaceholder("New column name...").fill(name);
    await page.getByRole("combobox", { name: "Group", exact: true }).click();
    await page.getByRole("option", { name: /^Started/ }).click();
    await page
      .getByRole("button", { name: "Add", exact: true })
      .first()
      .click();
    await expect(page.getByText("Column created")).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: `Choose a group for ${name}` }),
    ).toHaveText("Started");

    // Rename it in place.
    const renamed = `${name} review`;
    const input = columnRow(page, name).getByRole("textbox");
    await input.fill(renamed);
    await input.press("Enter");
    await expect(page.getByText("Column renamed")).toBeVisible();

    await page.reload();
    const picker = page.getByRole("combobox", {
      name: `Choose a group for ${renamed}`,
    });
    await expect(picker).toHaveText("Started");

    // Move it to the Completed group.
    await picker.click();
    await page.getByRole("option", { name: /^Completed/ }).click();
    await expect(page.getByText("Column group updated")).toBeVisible();
    await expect(picker).toHaveText("Completed");

    // It shows on the board.
    await page.goto(boardPath(workspace.id, project.id));
    await expect(page.getByText(renamed, { exact: true })).toBeVisible();

    // Delete it again (the trash button is the row's last button).
    await page.goto(`/dashboard/settings/projects/${project.id}/workflow`);
    await columnRow(page, renamed).getByRole("button").last().click();
    await expect(page.getByText("Column deleted")).toBeVisible();
    await expect(columnRow(page, renamed)).toHaveCount(0);

    const columns = await (
      await page.request.get(`${E2E_API_URL}/api/column/${project.id}`, {
        headers: ORIGIN,
      })
    ).json();
    expect(
      (columns as { name: string }[]).map((column) => column.name),
    ).toEqual(["To Do", "In Progress", "In Review", "Done"]);
  });

  test("sorts columns by group", async ({ pageAs }) => {
    const { page, project } = await setUpProject(pageAs);
    // A backlog column added last sorts to the front.
    const created = await page.request.post(
      `${E2E_API_URL}/api/column/${project.id}`,
      { data: { name: "Icebox", group: "backlog" }, headers: ORIGIN },
    );
    expect(created.status()).toBeLessThan(300);

    await page.goto(`/dashboard/settings/projects/${project.id}/workflow`);
    const pickers = page.getByRole("combobox", {
      name: /^Choose a group for /,
    });
    await expect(pickers).toHaveCount(5);
    await expect(pickers.last()).toHaveAccessibleName(
      "Choose a group for Icebox",
    );

    await page.getByRole("button", { name: "Sort by group" }).click();
    await expect(page.getByText("Columns sorted by group")).toBeVisible();
    await expect(pickers.first()).toHaveAccessibleName(
      "Choose a group for Icebox",
    );
  });

  test("manages custom fields", async ({ pageAs }) => {
    const { page, project } = await setUpProject(pageAs);
    await page.goto(`/dashboard/settings/projects/${project.id}/workflow`);
    await expect(
      page.getByRole("heading", { name: "Custom fields" }),
    ).toBeVisible();
    await expect(
      page.getByText("No custom fields configured yet."),
    ).toBeVisible();

    const fieldName = page.getByPlaceholder("Field name");
    // The innermost row that holds both the name input and its Add button.
    const addField = page
      .locator("div")
      .filter({ has: fieldName })
      .filter({ has: page.getByRole("button", { name: "Add", exact: true }) })
      .last()
      .getByRole("button", { name: "Add", exact: true });

    // A text field.
    await expect(addField).toBeDisabled();
    await fieldName.fill("Customer");
    await addField.click();
    await expect(page.getByText("Custom field created.")).toBeVisible();
    const customer = page.getByRole("listitem").filter({ hasText: "Customer" });
    await expect(customer).toContainText("Text");

    // A dropdown needs options.
    await page.getByTitle("Select field type").click();
    await page.getByRole("button", { name: "Dropdown" }).click();
    await fieldName.fill("Tier");
    await expect(addField).toBeDisabled();
    await page
      .getByPlaceholder("Options separated by commas")
      .fill("Gold, Silver");
    await addField.click();
    const tier = page.getByRole("listitem").filter({ hasText: "Tier" });
    await expect(tier).toContainText("Dropdown");
    await expect(tier).toContainText("2 options");

    await page.reload();
    await expect(customer).toBeVisible();
    await expect(tier).toBeVisible();

    await customer.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Custom field deleted.")).toBeVisible();
    await expect(customer).toHaveCount(0);
    await expect(tier).toBeVisible();
  });

  test("renders the automation rules and saves one", async ({ pageAs }) => {
    const { page, project } = await setUpProject(pageAs);
    await page.goto(`/dashboard/settings/projects/${project.id}/workflow`);
    await expect(
      page.getByRole("heading", { name: "Integration rules" }),
    ).toBeVisible();

    for (const integration of ["GitHub", "Gitea"]) {
      const section = page
        .getByRole("heading", { name: integration, exact: true })
        .locator("xpath=../..");
      for (const event of [
        "Branch push",
        "PR opened",
        "PR merged",
        "Issue opened",
        "Issue closed",
      ]) {
        await expect(
          section
            .getByText(event, { exact: true })
            .locator("xpath=..")
            .getByRole("combobox"),
        ).toHaveText("Select column...");
      }
    }

    const github = page
      .getByRole("heading", { name: "GitHub", exact: true })
      .locator("xpath=../..");
    const merged = github
      .getByText("PR merged", { exact: true })
      .locator("xpath=..")
      .getByRole("combobox");
    await merged.click();
    await page.getByRole("option", { name: "Done" }).click();
    await expect(page.getByText("Workflow rule updated")).toBeVisible();

    await page.reload();
    await expect(merged).toHaveText("Done");
  });
});

test.describe("labels", () => {
  test("creates, renames and deletes a workspace label", async ({ pageAs }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    await page.goto(workspacePath(workspace.id));
    await page.goto("/dashboard/settings/workspace/labels");
    await expect(
      page.getByText("Create, edit, and delete workspace-level labels."),
    ).toBeVisible();

    const name = uniqueName("Needs QA");
    await page.getByRole("button", { name: "Create label" }).click();
    const create = page.getByRole("dialog", { name: "Create label" });
    await create.getByLabel("Label name").fill(name);
    await create.getByTitle("Forest", { exact: true }).click();
    await create.getByRole("button", { name: "Create label" }).click();
    await expect(page.getByText("Label created")).toBeVisible();

    const row = page.getByText(name, { exact: true }).locator("xpath=../..");
    await expect(row).toBeVisible();

    const renamed = `${name} (renamed)`;
    await row.getByRole("button", { name: "Edit label" }).click();
    const edit = page.getByRole("dialog", { name: "Edit label" });
    await edit.getByLabel("Label name").fill(renamed);
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Label updated")).toBeVisible();
    const renamedRow = page
      .getByText(renamed, { exact: true })
      .locator("xpath=../..");
    await expect(renamedRow).toBeVisible();

    await renamedRow.getByRole("button", { name: "Delete" }).click();
    const confirm = page.getByRole("alertdialog", {
      name: "Delete this label?",
    });
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Label deleted")).toBeVisible();
    await expect(page.getByText(renamed, { exact: true })).toHaveCount(0);

    const labels = await (
      await page.request.get(
        `${E2E_API_URL}/api/label/workspace/${workspace.id}`,
        {
          headers: ORIGIN,
        },
      )
    )
      .json()
      .catch(() => []);
    expect(JSON.stringify(labels)).not.toContain(renamed);
  });
});
