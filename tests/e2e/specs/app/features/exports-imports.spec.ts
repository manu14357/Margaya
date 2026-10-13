import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { readJson } from "../../../helpers/http";
import {
  createProject,
  createTask,
  deleteProject,
  listBoard,
  type TestProject,
} from "../../../helpers/task-data";
import { localDay, pickCalendarDay } from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";
import { newUserWithWorkspace, workspacePath } from "../core/_support";
import { expect, toastText } from "./_support";

// Workspace exports (background CSV files), the CSV import wizard with
// column mapping, and API keys with a custom expiry and "Last used".

test.describe.configure({ timeout: 300_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject | undefined;

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
  project = undefined;
});

test("a CSV export runs in the background, becomes ready, downloads and is deleted", async ({
  page,
  api,
}) => {
  project = await createProject(api, { name: uniqueName("Export") });
  const titles = [uniqueName("Exported one"), uniqueName("Exported two")];
  for (const title of titles) await createTask(api, project.id, { title });

  await page.goto("/dashboard/settings/workspace/exports");
  await expect(
    page.getByRole("heading", { name: "Exports", exact: true }),
  ).toBeVisible({
    timeout: 90_000,
  });
  await page.getByRole("button", { name: "New export" }).click();
  const dialog = page.getByRole("dialog", { name: "New export" });
  const projects = dialog.getByRole("button", { name: "Projects" });
  await expect(projects).toHaveText(/All projects/);
  await projects.click();
  const picker = page.locator("[data-slot='popover-popup'][data-open]").last();
  await picker
    .getByRole("textbox", { name: "Search projects" })
    .fill(project.name);
  await picker.getByRole("button", { name: project.name }).click();
  await expect(
    picker.getByRole("button", { name: project.name }),
  ).toHaveAttribute("aria-pressed", "true");
  await projects.click();
  await expect(picker).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(projects).not.toHaveText(/All projects/);
  await expect(dialog.getByRole("combobox", { name: "Format" })).toHaveText(
    /CSV/,
  );
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(
    toastText(page, "Export started. We'll let you know when it's ready."),
  ).toBeVisible();
  await expect(dialog).toBeHidden();

  // The history shows the row; poll until it is ready.
  const row = page
    .getByRole("row")
    .filter({ hasText: `CSV · ${project.name}` })
    .first();
  await expect(row).toBeVisible();
  await expect(async () => {
    if (!(await row.getByText("Ready").isVisible())) await page.reload();
    await expect(row.getByText("Ready")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 120_000, intervals: [2_000, 5_000] });
  await expect(row).toContainText("2");

  const downloadButton = row.getByRole("button", { name: /^Download / });
  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const csv = (await readFile(await download.path(), "utf8")).trimStart();
  for (const title of titles) expect(csv).toContain(title);
  expect(csv.split(/\r?\n/)[0]).toMatch(/title/i);

  // Delete the export.
  await row.getByRole("button", { name: /^Delete / }).click();
  const confirm = page.getByRole("alertdialog", {
    name: "Delete this export?",
  });
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(toastText(page, "Export deleted")).toBeVisible();
  await expect(row).toHaveCount(0);
});

test("a CSV import maps columns, shows its warnings and creates the tasks", async ({
  page,
  api,
  seed,
}) => {
  project = await createProject(api, { name: uniqueName("Import") });
  const columns = project.columns.filter(
    (column) => column.group !== "backlog",
  );
  const first = columns[0]?.name ?? "To Do";
  const second = columns[1]?.name ?? first;
  const [a, b, c] = [
    uniqueName("Imported A"),
    uniqueName("Imported B"),
    uniqueName("Imported C"),
  ];
  // "Headline" and "Stage" are no known header names, so they need mapping.
  const csv = [
    "Headline,Stage,Priority,Assignee emails,Due date",
    `${a},${first},high,${seed.users.member.email},2026-12-01`,
    `${b},Somewhere else,low,ghost@nowhere.test,not a date`,
    `${c},${second},urgent,,`,
    `,${first},low,,`,
  ].join("\n");

  await page.goto(`/dashboard/settings/projects/${project.id}/general`);
  await page.getByRole("button", { name: "Import tasks" }).click();
  const chooser = page.getByRole("dialog", { name: "Import tasks" });
  await expect(
    chooser.getByText("Upload a Margaya JSON export or a CSV file."),
  ).toBeVisible();
  await chooser.locator("input[type=file]").setInputFiles({
    name: "tasks.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });

  const wizard = page.getByRole("dialog", { name: "Import from CSV" });
  await expect(wizard).toBeVisible();
  await expect(wizard.getByText("4 rows")).toBeVisible();
  await wizard.getByRole("button", { name: "Next" }).click();

  // Map the two columns with unfamiliar names.
  const titleSelect = wizard.getByRole("combobox", { name: "Title" });
  await expect(titleSelect).toHaveText("Don't import");
  await expect(wizard.getByRole("button", { name: "Next" })).toBeDisabled();
  await expect(wizard.getByRole("combobox", { name: "Priority" })).toHaveText(
    "Priority",
  );
  // Pick from the select list that is open, then wait for it to close.
  // Closed select popups stay mounted for a while; only the open one carries
  // data-open.
  const openList = page.locator("[data-slot=select-popup][data-open]");
  const choose = async (select: typeof titleSelect, name: string) => {
    await expect(openList).toHaveCount(0);
    await select.click();
    await expect(openList).toHaveCount(1);
    await openList.getByRole("option", { name, exact: true }).click();
    await expect(select).toHaveText(name);
  };
  await choose(titleSelect, "Headline");
  const statusSelect = wizard.getByRole("combobox", { name: "Status" });
  await choose(statusSelect, "Stage");
  await expect(statusSelect).toHaveText("Stage");
  await wizard.getByRole("button", { name: "Next" }).click();

  // The review lists what will happen.
  await expect(wizard.getByText("3 tasks will be imported")).toBeVisible();
  await expect(wizard.getByText("1 row skipped (no title)")).toBeVisible();
  await expect(
    wizard.getByText(
      "1 status doesn't match a column. Those tasks go to the Backlog.",
    ),
  ).toBeVisible();
  await expect(
    wizard.getByText(
      "1 person isn't a workspace member. Those tasks stay unassigned.",
    ),
  ).toBeVisible();
  await expect(
    wizard.getByText("1 date couldn't be read. Left empty."),
  ).toBeVisible();

  await wizard.getByRole("button", { name: "Import", exact: true }).click();
  await expect(wizard.getByText("Imported 3 tasks")).toBeVisible({
    timeout: 60_000,
  });
  await wizard.getByRole("button", { name: "Done" }).click();
  await expect(wizard).toBeHidden();

  const board = await listBoard(api, project.id);
  const tasks = [
    ...board.columns.flatMap((column) => column.tasks),
    ...board.plannedTasks,
  ];
  const byTitle = (title: string) => tasks.find((task) => task.title === title);
  expect(byTitle(a)?.priority).toBe("high");
  expect(byTitle(a)?.assigneeIds ?? []).toContain(seed.users.member.id);
  expect(byTitle(b)?.assigneeIds ?? []).toEqual([]);
  expect(byTitle(b)?.dueDate ?? null).toBeNull();
  expect(byTitle(c)?.priority).toBe("urgent");
  expect(tasks).toHaveLength(3);
});

type StoredKey = { name: string; expiresAt: string | null };

/** Opens Developer settings as a brand-new user who owns a workspace. */
async function openDeveloperSettings(
  pageAs: Parameters<typeof newUserWithWorkspace>[0],
) {
  const session = await newUserWithWorkspace(pageAs);
  const { page, workspace } = session;
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: E2E_WEB_URL,
  });
  await page.goto(workspacePath(workspace.id));
  await page.goto("/dashboard/settings/account/developer");
  await expect(
    page.getByRole("heading", { name: "Developer settings" }),
  ).toBeVisible({ timeout: 90_000 });
  return session;
}

/** Creates a key that expires at the end of `expiry`; returns its value. */
async function createKeyExpiringOn(
  page: Page,
  keyName: string,
  expiry: Date,
): Promise<string> {
  await page.getByRole("button", { name: "Create API key" }).click();
  const create = page.getByRole("dialog", { name: "Create API key" });
  await create.getByLabel("Name").fill(keyName);
  await create.getByRole("combobox").click();
  await page.getByRole("option", { name: "Custom date…" }).click();
  await expect(
    create.getByText("Choose a date between tomorrow and one year from today"),
  ).toBeVisible();
  const picker = create.getByRole("button", { name: "Expires at the end of" });
  await expect(picker).toHaveText(/Pick a date/);
  await picker.click();
  await pickCalendarDay(
    page.locator("[data-slot='popover-popup']").last(),
    expiry,
  );
  await create.getByRole("button", { name: "Create", exact: true }).click();

  const created = page.getByRole("dialog", { name: "API key created" });
  const key = (await created.locator("code").innerText()).trim();
  await created.getByRole("button", { name: "Copy", exact: true }).click();
  await created.getByRole("button", { name: "Done" }).click();
  await expect(created).toBeHidden();
  return key;
}

async function storedKey(page: Page, keyName: string): Promise<StoredKey> {
  const listed = await readJson<StoredKey[] | { apiKeys: StoredKey[] }>(
    await page.request.get(`${E2E_API_URL}/api/auth/api-key/list`, {
      headers: { Origin: E2E_WEB_URL },
    }),
    "list api keys",
  );
  const keys = Array.isArray(listed) ? listed : listed.apiKeys;
  const stored = keys.find((entry) => entry.name === keyName);
  if (!stored) throw new Error(`API key ${keyName} is not listed`);
  return stored;
}

/** "Oct 17, 2026" or "17 Oct 2026": the table uses the runtime's locale. */
function shortDayPattern(day: Date): RegExp {
  const month = day.toLocaleString("en-US", { month: "short" });
  const date = day.getDate();
  const year = day.getFullYear();
  return new RegExp(`${month} ${date}, ${year}|${date} ${month} ${year}`);
}

/** The last millisecond of `day`, local time. */
function endOfLocalDay(day: Date): number {
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}

test("an API key with a custom expiry shows when it was last used", async ({
  pageAs,
  request,
}) => {
  const { page, workspace } = await openDeveloperSettings(pageAs);
  const keyName = `Expiring key ${Date.now().toString(36)}`;
  const expiry = localDay(10);
  const key = await createKeyExpiringOn(page, keyName, expiry);

  const row = page.getByRole("row").filter({ hasText: keyName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Never");

  // The stored expiry is a few minutes before the end of the chosen day: the
  // client leaves a safety margin for request latency (see the slow-request
  // test below).
  const stored = await storedKey(page, keyName);
  const expiresAt = new Date(stored.expiresAt ?? 0).getTime();
  expect(expiresAt).toBeLessThanOrEqual(endOfLocalDay(expiry));
  expect(endOfLocalDay(expiry) - expiresAt).toBeLessThan(10 * 60_000);

  // Use it, then the table shows when.
  const used = await request.get(`${E2E_API_URL}/api/project`, {
    params: { workspaceId: workspace.id },
    headers: { "x-api-key": key },
  });
  expect(used.status()).toBe(200);
  // The API records it first; then one reload shows it.
  await expect
    .poll(
      async () =>
        (await storedKey(page, keyName)) as StoredKey & {
          lastRequest?: string | null;
        },
      { timeout: 30_000 },
    )
    .toHaveProperty("lastRequest", expect.any(String));
  await page.reload();
  await expect(row.locator("time")).toBeVisible({ timeout: 90_000 });
  await expect(row).not.toContainText("Never");

  await row.getByRole("button", { name: `Delete ${keyName}` }).click();
  await page
    .getByRole("alertdialog", { name: "Delete API key?" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(toastText(page, "API key deleted successfully")).toBeVisible();
  await expect(row).toHaveCount(0);
});

test("a custom API key expiry stays on the chosen day when the request is slow", async ({
  pageAs,
}) => {
  const { page } = await openDeveloperSettings(pageAs);
  // A slow network (or a busy server) delays the create request by 3 s.
  await page.route("**/api/auth/api-key/create", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await route.continue();
  });
  const keyName = `Slow key ${Date.now().toString(36)}`;
  const expiry = localDay(10);
  await createKeyExpiringOn(page, keyName, expiry);
  await page.unroute("**/api/auth/api-key/create");

  const stored = await storedKey(page, keyName);
  try {
    expect(new Date(stored.expiresAt ?? 0).getTime()).toBeLessThanOrEqual(
      endOfLocalDay(expiry),
    );
    await expect(
      page.getByRole("row").filter({ hasText: keyName }),
    ).toContainText(shortDayPattern(expiry), { timeout: 5_000 });
  } finally {
    const listed = await readJson<
      | { id: string; name: string }[]
      | { apiKeys: { id: string; name: string }[] }
    >(
      await page.request.get(`${E2E_API_URL}/api/auth/api-key/list`, {
        headers: { Origin: E2E_WEB_URL },
      }),
      "list api keys",
    );
    const keys = Array.isArray(listed) ? listed : listed.apiKeys;
    const id = keys.find((entry) => entry.name === keyName)?.id;
    if (id) {
      await page.request.post(`${E2E_API_URL}/api/auth/api-key/delete`, {
        data: { keyId: id },
        headers: { Origin: E2E_WEB_URL },
      });
    }
  }
});
