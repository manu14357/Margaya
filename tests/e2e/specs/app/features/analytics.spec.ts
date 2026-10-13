import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { authFile } from "../../../helpers/auth";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { createApiContext } from "../../../helpers/http";
import {
  createProject,
  createTask,
  deleteProject,
  type TestProject,
} from "../../../helpers/task-data";
import { uniqueName } from "../../../helpers/ui";
import {
  expect,
  projectPath,
  toastText,
  workspaceId,
  workspaceSectionPath,
} from "./_support";

// Analytics: the workspace and project dashboards, the custom chart builder
// and its CSV export, and the permission gate for viewers.

test.describe.configure({ timeout: 240_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject;

async function ownerApi() {
  return createApiContext({
    apiURL: E2E_API_URL,
    clientURL: E2E_WEB_URL,
    storageState: authFile("owner"),
  });
}

test.beforeAll(async () => {
  const api = await ownerApi();
  project = await createProject(api, { name: uniqueName("Analytics") });
  const tasks: { status: string; priority: "high" | "low" | "urgent" }[] = [
    { status: "to-do", priority: "high" },
    { status: "to-do", priority: "high" },
    { status: "to-do", priority: "low" },
    { status: "in-progress", priority: "urgent" },
  ];
  for (const [index, task] of tasks.entries()) {
    await createTask(api, project.id, {
      title: `Analytics task ${index + 1}`,
      ...task,
    });
  }
  await api.dispose();
});

test.afterAll(async () => {
  if (!project) return;
  const api = await ownerApi();
  await deleteProject(api, project.id);
  await api.dispose();
});

/** The card of an analytics section, found by its heading. */
function section(page: Page, title: string) {
  return page
    .locator("[data-slot=card]")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .first();
}

test("the workspace dashboard shows its overview and task charts", async ({
  page,
}) => {
  await page.goto(workspaceSectionPath("analytics"));
  const tabs = page.getByRole("navigation", { name: "Analytics" });
  await expect(tabs).toBeVisible({ timeout: 90_000 });
  for (const name of ["Overview", "Tasks", "Cycles", "Modules"]) {
    await expect(tabs.getByRole("tab", { name })).toBeVisible();
  }
  await expect(page.getByText("Open tasks").first()).toBeVisible();
  await expect(section(page, "Project progress")).toBeVisible();
  await expect(section(page, "Tasks by group")).toBeVisible();
  await expect(
    section(page, "Tasks by group").getByRole("img", {
      name: /tasks in \d+ groups/,
    }),
  ).toBeVisible();

  await tabs.getByRole("tab", { name: "Tasks" }).click();
  await expect(page).toHaveURL(/tab=tasks/);
  const chart = section(page, "Custom chart");
  await expect(chart).toBeVisible();
  await expect(
    chart.getByRole("img", { name: /^Tasks by Priority: \d+ buckets/ }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(section(page, "Created vs completed")).toBeVisible();
});

test("the project dashboard charts the project's tasks, the builder regroups them and the table exports as CSV", async ({
  page,
}) => {
  await page.goto(projectPath(project.id, "analytics"));
  const chart = section(page, "Custom chart");
  await expect(chart).toBeVisible({ timeout: 90_000 });
  await expect(
    chart.getByRole("img", {
      name: /^Tasks by Priority: 3 buckets, highest High with 2$/,
    }),
  ).toBeVisible({ timeout: 30_000 });

  // Regroup by status.
  await chart.getByRole("combobox", { name: "X-axis" }).click();
  await page.getByRole("option", { name: "Status", exact: true }).click();
  await expect(chart.getByRole("combobox", { name: "X-axis" })).toHaveText(
    /Status/,
  );
  await expect(
    chart.getByRole("img", {
      name: /^Tasks by Status: \d+ buckets, highest To Do with 3$/,
    }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(new RegExp(`/project/${project.id}/analytics`));

  // Export the table behind the chart.
  const downloadPromise = page.waitForEvent("download");
  await chart.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/tasks-by-status.*\.csv$/);
  await expect(toastText(page, /^Exported \d+ rows?$/)).toBeVisible();
  const file = await download.path();
  const csv = (await readFile(file, "utf8")).trimStart();
  const lines = csv.trim().split(/\r?\n/);
  expect(lines.length).toBeGreaterThanOrEqual(3);
  // Every cell is quoted: "To Do","3".
  const cells = (label: string) =>
    lines
      .find((line) => line.startsWith(`"${label}",`))
      ?.split(",")
      .map((cell) => cell.replace(/^"|"$/g, ""));
  expect(cells("To Do")).toEqual(["To Do", "3"]);
  expect(cells("In Progress")).toEqual(["In Progress", "1"]);
});

test("a viewer has no access to analytics", async ({ pageAs, apiAs }) => {
  const viewer = await pageAs("viewer");
  await viewer.goto(workspaceSectionPath("analytics"));
  await expect(
    viewer.getByText("You don't have access to analytics"),
  ).toBeVisible({ timeout: 90_000 });
  await expect(
    viewer.getByText("Ask a workspace admin for the Analytics permission."),
  ).toBeVisible();
  await expect(
    viewer.getByRole("heading", { name: "Custom chart" }),
  ).toHaveCount(0);

  await viewer.goto(projectPath(project.id, "analytics"));
  await expect(
    viewer.getByText("You don't have access to analytics"),
  ).toBeVisible({ timeout: 90_000 });

  const viewerApi = await apiAs("viewer");
  const response = await viewerApi.get("/api/analytics/overview", {
    params: { workspaceId: workspaceId() },
  });
  expect(response.status()).toBe(403);
});
