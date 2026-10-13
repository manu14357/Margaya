import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  type Task,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";

// Estimates: systems and their values, the active system and remapping, task
// estimates and totals, and the Estimates feature gate (off by default on a
// new project, and on the seeded MOB project).

type Point = {
  id: string;
  estimateId: string;
  value: string;
  numericValue: number | null;
  position: number;
  taskCount: number;
};
type Estimate = {
  id: string;
  projectId: string;
  name: string;
  type: "points" | "categories" | "time" | null;
  isActive: boolean;
  points: Point[];
};

let world: World;
let project: Project;
let task: Task;
let points: Estimate;
let sizes: Estimate;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Estimates");
  project = await createProject(world.as("owner"), world.workspace.id);
  task = await createTask(world.as("owner"), project.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

const pointId = (estimate: Estimate, value: string) =>
  estimate.points.find((point) => point.value === value)?.id ?? "";

test("the Estimates feature gate answers 403 while the feature is off", async ({
  api,
  seed,
}) => {
  const owner = world.as("owner");
  // New projects start with estimates off.
  expect(project.estimatesEnabled).toBe(false);
  await expectStatus(await owner.get(`/api/estimate/${project.id}`), 403);
  await expectStatus(
    await owner.post(`/api/estimate/${project.id}`, {
      data: { name: "Gated", type: "points", values: ["1", "2"] },
    }),
    403,
  );
  await expectStatus(
    await owner.post(`/api/estimate/${project.id}/totals`, {
      data: { taskIds: [task.id] },
    }),
    403,
  );
  await expectStatus(
    await owner.put(`/api/task/estimate/${task.id}`, {
      data: { estimatePointId: null },
    }),
    403,
  );
  // The seeded MOB project has estimates off too (read-only check).
  await expectStatus(
    await api.get(`/api/estimate/${seed.projects.mobile.id}`),
    403,
  );

  await expectJson(
    await owner.patch(`/api/project/${project.id}/features`, {
      data: { estimatesEnabled: true },
    }),
  );
});

test(
  "create estimate systems; the first becomes active",
  covers("createEstimate", "listEstimates"),
  async () => {
    const owner = world.as("owner");
    points = await expectJson<Estimate>(
      await owner.post(`/api/estimate/${project.id}`, {
        data: { name: "Points", type: "points", values: ["8", "1", "3", "2"] },
      }),
    );
    expect(points).toMatchObject({
      name: "Points",
      type: "points",
      isActive: true,
    });
    // Points are ordered by value.
    expect(points.points.map((point) => point.value)).toEqual([
      "1",
      "2",
      "3",
      "8",
    ]);

    sizes = await expectJson<Estimate>(
      await world.as("admin").post(`/api/estimate/${project.id}`, {
        data: { name: "T-shirt", type: "categories", values: ["S", "M", "L"] },
      }),
    );
    expect(sizes.isActive).toBe(false);

    const listed = await expectJson<{
      activeEstimateId: string | null;
      estimates: Estimate[];
    }>(await world.as("viewer").get(`/api/estimate/${project.id}`));
    expect(listed.activeEstimateId).toBe(points.id);
    expect(listed.estimates.map((estimate) => estimate.id)).toEqual([
      points.id,
      sizes.id,
    ]);

    const invalid = await expectJson<{
      message: string;
      errors: { index: number; code: string }[];
    }>(
      await owner.post(`/api/estimate/${project.id}`, {
        data: { name: "Broken", type: "points", values: ["1", "abc", "1"] },
      }),
      400,
    );
    expect(invalid.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["not_numeric", "duplicate"]),
    );
    await expectStatus(
      await owner.post(`/api/estimate/${project.id}`, {
        data: { name: "Points", type: "points", values: ["1", "2"] },
      }),
      409,
    );
    // Estimate systems need project:update, which members lack.
    await expectStatus(
      await world.as("member").post(`/api/estimate/${project.id}`, {
        data: { name: "Member system", type: "points", values: ["1", "2"] },
      }),
      403,
    );
  },
);

test(
  "estimate a task and total the estimates",
  covers("updateTaskEstimate", "getEstimateTotals"),
  async () => {
    const member = world.as("member");
    const estimated = await expectJson<
      Task & { estimatePointId: string | null }
    >(
      await member.put(`/api/task/estimate/${task.id}`, {
        data: { estimatePointId: pointId(points, "3") },
      }),
    );
    expect(estimated.estimatePointId).toBe(pointId(points, "3"));
    const second = await createTask(world.as("owner"), project.id, {
      status: "done",
      estimatePointId: pointId(points, "5") || pointId(points, "8"),
    });

    const totals = await expectJson<{
      enabled: boolean;
      estimateId: string | null;
      isNumeric: boolean;
      taskCount: number;
      estimatedTaskCount: number;
      total: number | null;
      completed: number | null;
    }>(
      await world.as("viewer").post(`/api/estimate/${project.id}/totals`, {
        data: { taskIds: [task.id, second.id] },
      }),
    );
    expect(totals).toMatchObject({
      enabled: true,
      estimateId: points.id,
      isNumeric: true,
      taskCount: 2,
      estimatedTaskCount: 2,
      total: 11,
      completed: 8,
    });

    // Values of an inactive system are refused.
    await expectStatus(
      await member.put(`/api/task/estimate/${task.id}`, {
        data: { estimatePointId: pointId(sizes, "M") },
      }),
      400,
    );
    await expectStatus(
      await world.as("viewer").put(`/api/task/estimate/${task.id}`, {
        data: { estimatePointId: null },
      }),
      403,
    );
    await expectStatus(
      await member.put("/api/task/estimate/e2e-unknown-task", {
        data: { estimatePointId: null },
      }),
      [400, 404],
    );
  },
);

test(
  "rename a system and edit its values",
  covers(
    "updateEstimate",
    "createEstimatePoint",
    "updateEstimatePoint",
    "reorderEstimatePoints",
    "deleteEstimatePoint",
  ),
  async () => {
    const owner = world.as("owner");
    const renamed = await expectJson<Estimate>(
      await owner.put(`/api/estimate/${project.id}/${sizes.id}`, {
        data: { name: "Sizes" },
      }),
    );
    expect(renamed.name).toBe("Sizes");

    const withXl = await expectJson<Estimate>(
      await owner.post(`/api/estimate/${project.id}/${sizes.id}/points`, {
        data: { value: "XL" },
      }),
    );
    expect(withXl.points.map((point) => point.value)).toEqual([
      "S",
      "M",
      "L",
      "XL",
    ]);

    const edited = await expectJson<Estimate>(
      await owner.put(
        `/api/estimate/${project.id}/${sizes.id}/points/${pointId(withXl, "XL")}`,
        { data: { value: "Extra large" } },
      ),
    );
    expect(edited.points.map((point) => point.value)).toContain("Extra large");

    const order = [...edited.points].reverse().map((point) => point.id);
    const reordered = await expectJson<Estimate>(
      await owner.put(
        `/api/estimate/${project.id}/${sizes.id}/points/reorder`,
        {
          data: { pointIds: order },
        },
      ),
    );
    expect(reordered.points.map((point) => point.id)).toEqual(order);
    // Points systems are always ordered by value.
    await expectStatus(
      await owner.put(
        `/api/estimate/${project.id}/${points.id}/points/reorder`,
        {
          data: { pointIds: points.points.map((point) => point.id) },
        },
      ),
      400,
    );

    const afterDelete = await expectJson<{
      estimate: Estimate;
      movedTaskCount: number;
      clearedTaskCount: number;
    }>(
      await owner.delete(
        `/api/estimate/${project.id}/${sizes.id}/points/${pointId(edited, "Extra large")}`,
      ),
    );
    expect(
      afterDelete.estimate.points.map((point) => point.value),
    ).not.toContain("Extra large");

    // A value in use needs a replacement or clear=true.
    const inUse = await expectJson<{ message: string; taskCount: number }>(
      await owner.delete(
        `/api/estimate/${project.id}/${points.id}/points/${pointId(points, "3")}`,
      ),
      409,
    );
    expect(inUse.taskCount).toBe(1);
    const moved = await expectJson<{ movedTaskCount: number }>(
      await owner.delete(
        `/api/estimate/${project.id}/${points.id}/points/${pointId(points, "3")}`,
        {
          params: { replacementPointId: pointId(points, "2") },
        },
      ),
    );
    expect(moved.movedTaskCount).toBe(1);
    const refreshed = await expectJson<
      Task & { estimatePointId: string | null }
    >(await owner.get(`/api/task/${task.id}`));
    expect(refreshed.estimatePointId).toBe(pointId(points, "2"));
    await expectStatus(
      await owner.delete(
        `/api/estimate/${project.id}/${points.id}/points/${pointId(points, "1")}`,
        {
          params: { replacementPointId: pointId(points, "2"), clear: "true" },
        },
      ),
      400,
    );
  },
);

test(
  "activate another system with a mapping, then delete the old one",
  covers("activateEstimate", "deleteEstimate"),
  async () => {
    const owner = world.as("owner");
    const current = await expectJson<{ estimates: Estimate[] }>(
      await owner.get(`/api/estimate/${project.id}`),
    );
    const latestSizes = current.estimates.find(
      (estimate) => estimate.id === sizes.id,
    );
    const latestPoints = current.estimates.find(
      (estimate) => estimate.id === points.id,
    );
    expect(latestSizes && latestPoints).toBeTruthy();
    const mapping = (latestPoints?.points ?? []).map((point) => ({
      fromPointId: point.id,
      toPointId:
        point.value === "2" ? pointId(latestSizes as Estimate, "M") : null,
    }));

    const switched = await expectJson<{
      estimate: Estimate;
      previousEstimateId: string | null;
      remappedTaskCount: number;
      clearedTaskCount: number;
    }>(
      await owner.post(`/api/estimate/${project.id}/${sizes.id}/activate`, {
        data: { mapping },
      }),
    );
    expect(switched.estimate.isActive).toBe(true);
    expect(switched.previousEstimateId).toBe(points.id);
    expect(switched.remappedTaskCount).toBe(1);
    const remapped = await expectJson<
      Task & { estimatePointId: string | null }
    >(await owner.get(`/api/task/${task.id}`));
    expect(remapped.estimatePointId).toBe(
      pointId(latestSizes as Estimate, "M"),
    );

    await expectStatus(
      await owner.post(`/api/estimate/${project.id}/${points.id}/activate`, {
        data: { mapping: [{ fromPointId: "e2e-unknown", toPointId: null }] },
      }),
      400,
    );

    const deleted = await expectJson<{
      deletedEstimateId: string;
      clearedTaskCount: number;
    }>(await owner.delete(`/api/estimate/${project.id}/${points.id}`));
    expect(deleted.deletedEstimateId).toBe(points.id);
    await expectStatus(
      await owner.delete(`/api/estimate/${project.id}/${points.id}`),
      404,
    );
    await expectStatus(
      await world
        .as("member")
        .delete(`/api/estimate/${project.id}/${sizes.id}`),
      403,
    );
  },
);
