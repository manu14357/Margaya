import { expect, test } from "../../fixtures";
import { openProjectBoard, uniqueName } from "../../helpers/ui";

test("owner creates a task from the seeded project board", async ({
  page,
  seed,
}) => {
  const project = seed.projects.web;
  await openProjectBoard(page, project);
  await expect(page.getByText(project.tasks.hero.title)).toBeVisible();

  const title = uniqueName("Smoke task");
  await page.getByRole("button", { name: "Add task" }).first().click();
  await page.getByPlaceholder("Task title").fill(title);
  await page.getByRole("button", { name: "Create task" }).click();

  await expect(page.getByText(title)).toBeVisible();
});
