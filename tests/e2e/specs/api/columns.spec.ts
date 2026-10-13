import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";

// Board columns: list, create, reorder, update and delete, with their
// validation (reserved and duplicate slugs, triage, isFinal vs group) and the
// project:update permission that members lack.

type Column = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  position: number;
  group: string;
  isFinal: boolean;
  icon: string | null;
  color: string | null;
};

let world: World;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Columns");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

test("list a new project's default columns", covers("getColumns"), async () => {
  const columns = await expectJson<Column[]>(
    await world.as("viewer").get(`/api/column/${project.id}`),
  );
  expect(columns.map((column) => column.slug)).toEqual([
    "to-do",
    "in-progress",
    "in-review",
    "done",
  ]);
  expect(columns.map((column) => column.position)).toEqual([0, 1, 2, 3]);
  expect(columns.find((column) => column.slug === "done")).toMatchObject({
    group: "completed",
    isFinal: true,
  });
  const withTriage = await expectJson<Column[]>(
    await world.as("viewer").get(`/api/column/${project.id}`, {
      params: { includeTriage: "true" },
    }),
  );
  expect(withTriage.length).toBeGreaterThanOrEqual(columns.length);
  await expectStatus(
    await world.as("viewer").get(`/api/column/${project.id}`, {
      params: { includeTriage: "maybe" },
    }),
    400,
  );
});

test(
  "create, update, reorder and delete a column",
  covers("createColumn", "updateColumn", "reorderColumns", "deleteColumn"),
  async () => {
    const admin = world.as("admin");
    const created = await expectJson<Column>(
      await admin.post(`/api/column/${project.id}`, {
        data: { name: "QA Review", group: "started", color: "orange" },
      }),
    );
    expect(created).toMatchObject({
      name: "QA Review",
      slug: "qa-review",
      group: "started",
      isFinal: false,
      color: "orange",
      position: 4,
    });

    await expectStatus(
      await admin.post(`/api/column/${project.id}`, {
        data: { name: "QA Review" },
      }),
      409,
    );
    await expectStatus(
      await admin.post(`/api/column/${project.id}`, {
        data: { name: "Intake", group: "triage" },
      }),
      400,
    );
    await expectStatus(
      await admin.post(`/api/column/${project.id}`, {
        data: { name: "Contradiction", group: "started", isFinal: true },
      }),
      400,
    );

    const updated = await expectJson<Column>(
      await admin.put(`/api/column/${created.id}`, {
        data: { name: "Quality", icon: "Bug", color: null },
      }),
    );
    expect(updated).toMatchObject({
      name: "Quality",
      icon: "Bug",
      color: null,
    });
    const closed = await expectJson<Column>(
      await admin.put(`/api/column/${created.id}`, { data: { isFinal: true } }),
    );
    expect(closed).toMatchObject({ isFinal: true, group: "completed" });

    const columns = await expectJson<Column[]>(
      await admin.get(`/api/column/${project.id}`),
    );
    const reversed = [...columns].reverse();
    const reordered = await expectJson<Column[]>(
      await admin.put(`/api/column/reorder/${project.id}`, {
        data: {
          columns: reversed.map((column, position) => ({
            id: column.id,
            position,
          })),
        },
      }),
    );
    expect(reordered.map((column) => column.id)).toEqual(
      reversed.map((column) => column.id),
    );

    // A column of another project is refused.
    const foreign = await createProject(world.as("owner"), world.workspace.id);
    const foreignColumns = await expectJson<Column[]>(
      await admin.get(`/api/column/${foreign.id}`),
    );
    await expectStatus(
      await admin.put(`/api/column/reorder/${project.id}`, {
        data: { columns: [{ id: foreignColumns[0]?.id, position: 0 }] },
      }),
      400,
    );

    // A column with open tasks cannot be deleted until they move.
    const task = await createTask(world.as("owner"), project.id, {
      status: "qa-review",
    });
    await expectStatus(await admin.delete(`/api/column/${created.id}`), 409);
    await expectJson(
      await admin.put(`/api/task/status/${task.id}`, {
        data: { status: "to-do" },
      }),
    );
    const deleted = await expectJson<Column>(
      await admin.delete(`/api/column/${created.id}`),
    );
    expect(deleted.id).toBe(created.id);
    const after = await expectJson<Column[]>(
      await admin.get(`/api/column/${project.id}`),
    );
    expect(after.map((column) => column.id)).not.toContain(created.id);
    await expectJson(
      await world.as("owner").delete(`/api/project/${foreign.id}`),
    );
  },
);

test("members cannot change the workflow", async () => {
  const member = world.as("member");
  const columns = await expectJson<Column[]>(
    await member.get(`/api/column/${project.id}`),
  );
  const first = columns[0];
  expect(first).toBeTruthy();
  await expectStatus(
    await member.post(`/api/column/${project.id}`, {
      data: { name: "Member column" },
    }),
    403,
  );
  await expectStatus(
    await member.put(`/api/column/${first?.id}`, { data: { name: "Renamed" } }),
    403,
  );
  await expectStatus(
    await member.put(`/api/column/reorder/${project.id}`, {
      data: { columns: [{ id: first?.id, position: 0 }] },
    }),
    403,
  );
  await expectStatus(await member.delete(`/api/column/${first?.id}`), 403);
  await expectStatus(
    await world.as("admin").post(`/api/column/${project.id}`, { data: {} }),
    400,
  );
});
