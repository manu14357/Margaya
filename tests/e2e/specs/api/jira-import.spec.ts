import { expect, test } from "../../fixtures";
import {
  createProject,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { listBoard } from "../../helpers/task-data";

// Jira CSV import: a preview reads the export, the import creates tasks and
// skips issues it imported before.

type Preview = {
  issueCount: number;
  statuses: { name: string; count: number; suggestedStatus: string }[];
  priorities: { name: string; count: number; suggestedPriority: string }[];
};
type Result = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
};

const CSV = [
  "Summary,Issue key,Issue id,Issue Type,Status,Priority,Description",
  "Import the login page,JRA-1,10001,Bug,To Do,High,The button is misaligned",
  "Import the dashboard,JRA-2,10002,Story,Done,Low,",
].join("\n");

let world: World;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Jira");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "a Jira CSV is previewed, imported and skipped on a re-run",
  covers("previewJiraImport", "importJiraIssues"),
  async () => {
    const owner = world.as("owner");
    const preview = await expectJson<Preview>(
      await owner.post(`/api/jira-import/${project.id}/preview`, {
        data: { content: CSV },
      }),
    );
    expect(preview.issueCount).toBe(2);
    expect(preview.statuses.map((status) => status.name).sort()).toEqual([
      "Done",
      "To Do",
    ]);
    expect(
      preview.priorities.find((priority) => priority.name === "High")
        ?.suggestedPriority,
    ).toBe("high");

    // Viewers cannot create tasks, so they cannot import either.
    await expectStatus(
      await world.as("viewer").post(`/api/jira-import/${project.id}/preview`, {
        data: { content: CSV },
      }),
      403,
    );
    await expectStatus(
      await owner.post(`/api/jira-import/${project.id}/preview`, {
        data: { content: "just,some\nother,file" },
      }),
      400,
    );

    const first = await expectJson<Result>(
      await owner.post(`/api/jira-import/${project.id}`, {
        data: { content: CSV },
      }),
    );
    expect(first).toMatchObject({ total: 2, created: 2, failed: 0 });
    const board = await listBoard(owner, project.id);
    const titles = board.columns.flatMap((column) =>
      column.tasks.map((task) => task.title),
    );
    expect(titles).toEqual(
      expect.arrayContaining(["Import the login page", "Import the dashboard"]),
    );

    const again = await expectJson<Result>(
      await owner.post(`/api/jira-import/${project.id}`, {
        data: { content: CSV },
      }),
    );
    expect(again).toMatchObject({ total: 2, created: 0, skipped: 2 });
  },
);
