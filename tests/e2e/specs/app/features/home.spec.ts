import { test } from "../../../fixtures";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { readJson } from "../../../helpers/http";
import {
  createProjectViaApi,
  createTaskViaApi,
  newUserWithWorkspace,
} from "../core/_support";
import { expect } from "./_support";

// "Your work": the Recent activity panel lists the caller's own activity.

test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

test("Your work lists the user's recent activity, newest first", async ({
  pageAs,
}) => {
  const { page, workspace } = await newUserWithWorkspace(pageAs);
  const myWork = `/dashboard/workspace/${workspace.id}/my-work?tab=summary`;

  await page.goto(myWork);
  await expect(page.getByText("Recent activity")).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText("No activity yet")).toBeVisible();

  const project = await createProjectViaApi(page.request, workspace.id);
  const task = await createTaskViaApi(page.request, project.id, {
    title: "Write the onboarding guide",
  });
  const comment = "First draft is up for review";
  await readJson(
    await page.request.post(`${E2E_API_URL}/api/comment/${task.id}`, {
      data: { content: comment },
      headers: { Origin: E2E_WEB_URL },
    }),
    "add comment",
  );

  await page.reload();
  const list = page.getByRole("list", { name: "Recent activity" });
  await expect(list).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("No activity yet")).toHaveCount(0);
  const entries = list.getByRole("listitem");
  // Newest first: the comment, then the task's creation.
  const newest = entries.first();
  await expect(newest).toContainText("Commented:");
  await expect(newest).toContainText(comment);
  const link = newest.getByRole("link", {
    name: `${project.slug}-${task.number} Write the onboarding guide`,
  });
  await expect(link).toBeVisible();
  expect(await entries.count()).toBeGreaterThanOrEqual(2);

  await link.click();
  await expect(page).toHaveURL(
    new RegExp(`/project/${project.id}/task/${task.id}`),
  );
});
