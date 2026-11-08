import type { APIRequestContext } from "@playwright/test";
import { test } from "../../../fixtures";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { readJson } from "../../../helpers/http";
import { uniqueName } from "../../../helpers/ui";
import {
  createProjectViaApi,
  createTaskViaApi,
  newUserWithWorkspace,
  workspacePath,
} from "../core/_support";
import { expect } from "./_support";

// The optional dashboards: a timeline across projects, a saved report pinned
// to Home, and who is overloaded. Each test has its own user and workspace,
// because Home is personal.

test.describe.configure({ timeout: 240_000 });
test.use({ navigationTimeout: 120_000 });

const ORIGIN = { Origin: E2E_WEB_URL };

async function createTask(
  request: APIRequestContext,
  projectId: string,
  fields: { title: string; dueDate?: string; assigneeIds?: string[] },
) {
  return readJson<{ id: string; title: string }>(
    await request.post(`${E2E_API_URL}/api/task/${projectId}`, {
      data: {
        description: "",
        priority: "medium",
        status: "to-do",
        ...fields,
      },
      headers: ORIGIN,
    }),
    `create task ${fields.title}`,
  );
}

async function saveReport(
  request: APIRequestContext,
  workspaceId: string,
  name: string,
) {
  return readJson<{ id: string; name: string }>(
    await request.post(`${E2E_API_URL}/api/analytics-report`, {
      data: { workspaceId, name, config: { xAxis: "priority" } },
      headers: ORIGIN,
    }),
    "save a report",
  );
}

test("a workspace view shows dated tasks of every project on a timeline", async ({
  pageAs,
}) => {
  const { page, workspace } = await newUserWithWorkspace(pageAs);
  const first = await createProjectViaApi(page.request, workspace.id, {
    name: uniqueName("Timeline web"),
  });
  const second = await createProjectViaApi(page.request, workspace.id, {
    name: uniqueName("Timeline api"),
  });
  const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const dated = await createTask(page.request, first.id, {
    title: uniqueName("Dated in web"),
    dueDate: soon,
  });
  const datedOther = await createTask(page.request, second.id, {
    title: uniqueName("Dated in api"),
    dueDate: soon,
  });
  const undated = await createTask(page.request, first.id, {
    title: uniqueName("Undated"),
  });

  await page.goto(`${workspacePath(workspace.id)}/views`);
  await page.getByRole("button", { name: "Gantt", exact: true }).click();

  await expect(page.getByRole("heading", { name: first.name })).toBeVisible();
  await expect(page.getByRole("heading", { name: second.name })).toBeVisible();
  const rail = page.getByRole("button", { name: new RegExp(dated.title) });
  await expect(rail.first()).toBeVisible();
  await expect(page.getByText(datedOther.title).first()).toBeVisible();
  await expect(page.getByText(undated.title)).toHaveCount(0);

  // A task opens from the timeline.
  await rail.first().click();
  await expect(page).toHaveURL(/taskId=/);
});

test("a saved report can be pinned to Home and unpinned again", async ({
  pageAs,
}) => {
  const { page, workspace } = await newUserWithWorkspace(pageAs);
  const project = await createProjectViaApi(page.request, workspace.id);
  await createTaskViaApi(page.request, project.id);
  const report = await saveReport(
    page.request,
    workspace.id,
    uniqueName("Priorities"),
  );
  const pinnedWidget = page.getByRole("region", { name: "Pinned reports" });

  // Nobody gets the widget before pinning something.
  await page.goto(workspacePath(workspace.id));
  await expect(
    page.getByRole("button", { name: "Manage widgets" }),
  ).toBeVisible();
  await expect(pinnedWidget).toHaveCount(0);

  await page.goto(`${workspacePath(workspace.id)}/analytics?tab=tasks`);
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await page
    .getByRole("button", { name: `Actions for ${report.name}` })
    .click();
  await page.getByRole("menuitem", { name: "Pin to Home" }).click();
  await expect(page.getByText("Pinned to Home")).toBeVisible();

  await page.goto(workspacePath(workspace.id));
  await expect(pinnedWidget).toBeVisible();
  await expect(pinnedWidget.getByText(report.name)).toBeVisible();
  await expect(pinnedWidget.getByRole("img").first()).toBeVisible();

  // It stays after a reload, and unpinning takes the widget away.
  await page.reload();
  await expect(pinnedWidget.getByText(report.name)).toBeVisible();
  await pinnedWidget
    .getByRole("button", { name: `Unpin ${report.name} from Home` })
    .click();
  await expect(pinnedWidget).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Manage widgets" }),
  ).toBeVisible();
  await expect(pinnedWidget).toHaveCount(0);
});

test("Analytics shows open work per person", async ({ pageAs }) => {
  const { page, workspace, user } = await newUserWithWorkspace(pageAs);
  const project = await createProjectViaApi(page.request, workspace.id);
  for (const title of ["One", "Two"]) {
    await createTask(page.request, project.id, {
      title: uniqueName(title),
      assigneeIds: [user.id],
    });
  }

  const workload = await readJson<{
    unit: string;
    members: { userId: string | null; tasks: number; check: unknown }[];
  }>(
    await page.request.get(`${E2E_API_URL}/api/analytics/workload`, {
      params: { workspaceId: workspace.id },
      headers: ORIGIN,
    }),
    "read the workload",
  );
  expect(workload.unit).toBe("tasks");
  expect(workload.members.find((m) => m.userId === user.id)).toMatchObject({
    tasks: 2,
    check: { status: "unknown" },
  });

  await page.goto(`${workspacePath(workspace.id)}/analytics`);
  await expect(page.getByText("Open tasks by assignee")).toBeVisible();
  await expect(page.getByText(/Usual is what each person/)).toBeVisible();
  // The toggle of the section whose title is Workload.
  const section = page
    .locator("[data-slot=card]")
    .filter({ hasText: "Open tasks by assignee" });
  await section.getByRole("button", { name: "Table" }).click();
  await expect(
    section.getByRole("cell", { name: "No recent history" }),
  ).toBeVisible();
});
