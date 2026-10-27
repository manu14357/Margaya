import { expect, test } from "../../fixtures";
import {
  createTask,
  projectSettingsPath,
  projectViewPath,
  taskPagePath,
} from "../../helpers/task-data";
import { openTaskPage } from "../../helpers/task-ui";
import { openProjectBoard, uniqueName } from "../../helpers/ui";

// The e2e instance never configures an AI provider, so every AI entry point
// must stay out of the UI.
test.describe("AI is off", () => {
  test("no Ask sparkle and no Build with AI command", async ({
    page,
    seed,
  }) => {
    await openProjectBoard(page, seed.projects.web);
    await expect(page.getByRole("button", { name: "Ask AI" })).toHaveCount(0);

    await page
      .getByRole("button", { name: "Search or jump to…" })
      .first()
      .click();
    const palette = page.getByRole("dialog").filter({
      has: page.getByRole("combobox", { name: "Search or jump to…" }),
    });
    await palette
      .first()
      .getByRole("combobox", { name: "Search or jump to…" })
      .fill("Build");
    await expect(
      palette.first().getByRole("option", { name: /Build with AI/ }),
    ).toHaveCount(0);
  });

  test("the description editor has no AI button", async ({
    page,
    api,
    seed,
  }) => {
    const project = seed.projects.web;
    const task = await createTask(api, project.id, {
      title: uniqueName("AI off smoke"),
    });
    try {
      await openTaskPage(page, taskPagePath(project.id, task.id));
      const editor = page
        .getByRole("region", { name: "Task description editor" })
        .locator("[contenteditable='true']");
      await editor.click();
      await page.keyboard.type("Select this text");
      await page.keyboard.press("ControlOrMeta+a");
      // The formatting bubble is up, without its AI entry. Its task-editor
      // buttons have no accessible names yet, so wait on their class.
      await expect(
        page.locator(".margaya-tiptap-bubble-btn").first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "AI actions" }),
      ).toHaveCount(0);
    } finally {
      await api.delete(`/api/task/${task.id}`).catch(() => undefined);
    }
  });
});

test("the automation rules section loads in project workflow settings", async ({
  page,
  seed,
}) => {
  await page.goto(projectSettingsPath(seed.projects.web.id, "workflow"));
  await expect(page.getByText("Automations", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "New rule" })).toBeVisible();
  await expect(page.getByText("Couldn't load the automations.")).toHaveCount(0);
});

test("a cycle shows its delivery forecast", async ({ page, seed }) => {
  const project = seed.projects.web;
  await page.goto(
    `${projectViewPath(project.id, "cycles")}/${project.cycles.current.id}`,
  );
  const forecast = page.getByRole("region", { name: "Forecast" });
  await expect(forecast).toBeVisible({ timeout: 30_000 });
  await expect(forecast.getByText("Couldn't load the forecast")).toHaveCount(0);
});

test("the agents settings page is reachable", async ({ page }) => {
  await page.goto("/dashboard/settings/workspace/agents");
  await expect(
    page.getByRole("heading", { name: "Agents", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Couldn't load the agents.")).toHaveCount(0);
});
