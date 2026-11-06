import { test } from "../../../fixtures";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { readJson } from "../../../helpers/http";
import { isoDayOffset } from "../../../helpers/task-data";
import { uniqueName } from "../../../helpers/ui";
import { createProjectViaApi, newUserWithWorkspace } from "../core/_support";
import { expect } from "./_support";

// Your work and Home lead with a person's own tasks; the statistics stay one
// tab away. A fresh workspace keeps other specs' tasks out of the counts.

test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

test("Home lists what is due today and Your work opens on Assigned", async ({
  pageAs,
}) => {
  const { page, user, workspace } = await newUserWithWorkspace(pageAs);
  const base = `/dashboard/workspace/${workspace.id}`;
  const dueToday = page.getByRole("region", { name: "Due today" });

  await page.goto(base);
  await expect(
    dueToday.getByText("Nothing assigned to you is due today."),
  ).toBeVisible({ timeout: 90_000 });

  const project = await createProjectViaApi(page.request, workspace.id);
  const createTask = async (title: string, dueDate: string) =>
    readJson<{ id: string; title: string }>(
      await page.request.post(`${E2E_API_URL}/api/task/${project.id}`, {
        data: {
          title,
          description: "",
          priority: "high",
          status: "to-do",
          assigneeIds: [user.id],
          dueDate,
        },
        headers: { Origin: E2E_WEB_URL },
      }),
      `create task ${title}`,
    );
  const today: { id: string; title: string }[] = [];
  for (let index = 0; index < 7; index += 1) {
    today.push(await createTask(uniqueName("Due today"), isoDayOffset(0)));
  }
  const later = await createTask(uniqueName("Due later"), isoDayOffset(2));

  await page.reload();
  await expect(dueToday.getByRole("listitem")).toHaveCount(6, {
    timeout: 60_000,
  });
  await expect(dueToday.getByText(later.title)).toHaveCount(0);

  // A row opens the task in the side sheet.
  await dueToday.getByRole("listitem").first().getByRole("link").click();
  await expect(page).toHaveURL(/taskId=/);
  await page.goto(base);

  // Seven are due and six fit, so the rest are one link away.
  await dueToday.getByRole("link", { name: "View all 7" }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/my-work`));
  const tabs = page.getByRole("navigation", { name: "Your work views" });
  await expect(tabs.getByRole("tab", { name: "Assigned" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  for (const task of today) {
    await expect(page.getByText(task.title).first()).toBeVisible();
  }
  await expect(page.getByText(later.title)).toHaveCount(0);

  // A bare link opens on Assigned, with Summary after the task lists.
  await page.goto(`${base}/my-work`);
  await expect(tabs.getByRole("tab", { name: "Assigned" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const names = await tabs.getByRole("tab").allTextContents();
  expect(names[0]).toContain("Assigned");
  expect(names.indexOf("Summary")).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "By state" })).toHaveCount(0);

  // Summary keeps its own URL, so it survives a reload.
  await tabs.getByRole("tab", { name: "Summary" }).click();
  await expect(page).toHaveURL(/tab=summary/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "By state" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page.getByRole("button", { name: /^Assigned and open 8$/ }),
  ).toBeVisible();
});
