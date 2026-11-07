import { expect, test } from "../../../fixtures";
import {
  createWorkspace,
  expectJson,
  expectStatus,
  signUpUser,
  type TestUser,
  type Workspace,
} from "../../../helpers/api-kit";
import { browserContextFor } from "../../../helpers/notifications";
import { toast } from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// Build with AI end to end on the fake provider: the owner of a fresh
// workspace turns AI on in its settings, drafts a plan from the command
// palette, creates it, then undoes it from the same dialog.
//
// The instance must have AI on with the fake provider, which only an
// operator can set (MARGAYA_AI_ENABLED=true, MARGAYA_AI_PROVIDER=fake). The
// default e2e API keeps AI off for the AI-off specs, so this spec skips
// there. The fake model answers the plan given in the prompt's
// [[fake:json ...]] marker, so nothing leaves the machine.

test.describe.configure({ timeout: 240_000 });

type Project = { id: string; name: string };
type Board = {
  data: {
    columns: { tasks: { title: string }[] }[];
  };
};

let owner: TestUser;
let workspace: Workspace;

test.beforeAll(async () => {
  owner = await signUpUser("AI build");
  workspace = await createWorkspace(owner.ctx, "E2E AI build");
});

test.afterAll(async () => {
  await owner?.ctx.dispose();
});

test("a plan built with AI can be undone", async ({ browser }) => {
  const availability = await expectJson<{
    instanceEnabled: boolean;
    provider: string | null;
  }>(
    await owner.ctx.get("/api/ai/availability", {
      params: { workspaceId: workspace.id },
    }),
  );
  test.skip(
    !availability.instanceEnabled || availability.provider !== "fake",
    "Needs an API with MARGAYA_AI_ENABLED=true and MARGAYA_AI_PROVIDER=fake",
  );

  const projectName = uniqueName("AI relaunch");
  const plan = {
    summary: "A small relaunch",
    project: { name: projectName, key: "RL", description: "Relaunch" },
    columns: [],
    labels: [],
    cycles: [],
    modules: [],
    tasks: [
      {
        title: "Write the launch post",
        priority: "high",
        subtasks: [{ title: "Outline the post" }],
      },
      { title: "Update the pricing page", priority: "medium", subtasks: [] },
    ],
  };

  const context = await browserContextFor(browser, owner);
  try {
    const page = await context.newPage();

    // AI is opt-in per workspace: the owner turns it on in settings.
    await page.goto("/dashboard/settings/workspace/ai");
    const enable = page.getByRole("switch", { name: "Turn on AI" });
    await expect(enable).toBeVisible({ timeout: 60_000 });
    await expect(enable).not.toBeChecked();
    await enable.click();
    await expect(toast(page, "AI is on for this workspace")).toBeVisible();
    await expect(enable).toBeChecked();

    await page.goto(`/dashboard/workspace/${workspace.id}`);
    await expect(
      page.getByRole("button", { name: "Account menu", exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press("Control+k");
    await page
      .getByRole("dialog")
      .filter({
        has: page.getByRole("combobox", { name: "Search or jump to…" }),
      })
      .getByRole("option", { name: /^Build with AI/ })
      .click();

    const dialog = page.getByRole("dialog", { name: "Build with AI" });
    await dialog
      .getByRole("textbox", { name: "What should we plan?" })
      .fill(`Plan the relaunch [[fake:json ${JSON.stringify(plan)}]]`);
    await dialog.getByRole("button", { name: "Draft plan" }).click();
    await expect(
      dialog.getByText(
        "Review the plan. Uncheck, edit or reorder anything, then create it.",
      ),
    ).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue(
      projectName,
    );

    // The project, two tasks and a sub-task.
    await dialog.getByRole("button", { name: "Create 4 items" }).click();
    await expect(dialog.getByText("Done. 3 tasks were created.")).toBeVisible({
      timeout: 60_000,
    });

    const projects = await expectJson<Project[]>(
      await owner.ctx.get("/api/project", {
        params: { workspaceId: workspace.id },
      }),
    );
    const built = projects.find((project) => project.name === projectName);
    expect(built, "the built project is listed").toBeTruthy();
    // Sub-tasks are on the board too.
    const board = await expectJson<Board>(
      await owner.ctx.get(`/api/task/tasks/${built?.id}`),
    );
    expect(
      board.data.columns
        .flatMap((column) => column.tasks)
        .map((task) => task.title)
        .sort(),
    ).toEqual([
      "Outline the post",
      "Update the pricing page",
      "Write the launch post",
    ]);

    await dialog.getByRole("button", { name: "Undo plan" }).click();
    await expect(
      dialog.getByText("The plan was undone. Deleted items are in the trash."),
    ).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByRole("button", { name: "Undo plan" })).toHaveCount(
      0,
    );

    // The new project went to the trash with everything in it.
    await expectStatus(await owner.ctx.get(`/api/project/${built?.id}`), 404);
    const trash = await expectJson<{
      items: { id: string; taskCount: number }[];
    }>(
      await owner.ctx.get("/api/trash/projects", {
        params: { workspaceId: workspace.id },
      }),
    );
    expect(trash.items).toContainEqual(
      expect.objectContaining({ id: built?.id, taskCount: 3 }),
    );
    expect(
      (
        await expectJson<Project[]>(
          await owner.ctx.get("/api/project", {
            params: { workspaceId: workspace.id },
          }),
        )
      ).map((project) => project.id),
    ).not.toContain(built?.id);
  } finally {
    await context.close();
  }
});
