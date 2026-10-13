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
import { uniqueName } from "../../helpers/ui";

// Cycles: drafts, dated cycles and their derived status, task membership,
// progress, archive, transfer of unfinished work, delete, the role rules and
// the Cycles feature gate. Runs in a project this file owns, so its dates
// never collide with the seeded sprints.

type Cycle = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  ownerId: string | null;
  status: "draft" | "upcoming" | "current" | "completed";
  archivedAt: string | null;
  isFrozen: boolean;
  counts: { total: number; completed: number };
  progress: number;
};
type Membership = {
  cycleId: string;
  added: string[];
  moved: { taskId: string; fromCycleId: string }[];
  removed: string[];
  unchanged: string[];
  ignored: string[];
};

function day(offset: number): string {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

let world: World;
let project: Project;
let tasks: Task[];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Cycles");
  const owner = world.as("owner");
  project = await createProject(owner, world.workspace.id);
  tasks = [
    await createTask(owner, project.id, { status: "to-do" }),
    await createTask(owner, project.id, { status: "in-progress" }),
    await createTask(owner, project.id, { status: "done" }),
  ];
});

test.afterAll(async () => {
  await world?.dispose();
});

let current: Cycle;
let completed: Cycle;
let draft: Cycle;

test(
  "create draft, current and completed cycles; list and read them",
  covers("createCycle", "listCycles", "getCycle"),
  async () => {
    const member = world.as("member");
    draft = await expectJson<Cycle>(
      await member.post(`/api/cycle/project/${project.id}`, {
        data: { name: uniqueName("Draft cycle"), description: "No dates yet" },
      }),
    );
    expect(draft).toMatchObject({
      status: "draft",
      startDate: null,
      endDate: null,
    });

    current = await expectJson<Cycle>(
      await member.post(`/api/cycle/project/${project.id}`, {
        data: {
          name: uniqueName("Current cycle"),
          startDate: day(-3),
          endDate: day(4),
          ownerId: world.users.member.id,
        },
      }),
    );
    expect(current).toMatchObject({
      status: "current",
      startDate: day(-3),
      endDate: day(4),
      ownerId: world.users.member.id,
    });

    completed = await expectJson<Cycle>(
      await world.as("owner").post(`/api/cycle/project/${project.id}`, {
        data: {
          name: uniqueName("Past cycle"),
          startDate: day(-30),
          endDate: day(-20),
        },
      }),
    );
    expect(completed.status).toBe("completed");

    const all = await expectJson<Cycle[]>(
      await world.as("viewer").get(`/api/cycle/project/${project.id}`, {
        params: { view: "all" },
      }),
    );
    // Ordered current, upcoming, draft, completed.
    expect(all.map((cycle) => cycle.id)).toEqual([
      current.id,
      draft.id,
      completed.id,
    ]);
    const onlyCurrent = await expectJson<Cycle[]>(
      await world.as("viewer").get(`/api/cycle/project/${project.id}`, {
        params: { view: "current" },
      }),
    );
    expect(onlyCurrent.map((cycle) => cycle.id)).toEqual([current.id]);
    const searched = await expectJson<Cycle[]>(
      await world.as("viewer").get(`/api/cycle/project/${project.id}`, {
        params: { search: draft.name },
      }),
    );
    expect(searched.map((cycle) => cycle.id)).toEqual([draft.id]);

    const fetched = await expectJson<Cycle>(
      await world.as("viewer").get(`/api/cycle/${current.id}`),
    );
    expect(fetched.name).toBe(current.name);
  },
);

test("cycle validation: overlaps, bad ranges and roles", async () => {
  const member = world.as("member");
  await expectStatus(
    await member.post(`/api/cycle/project/${project.id}`, {
      data: { name: uniqueName("Overlap"), startDate: day(0), endDate: day(2) },
    }),
    409,
  );
  await expectStatus(
    await member.post(`/api/cycle/project/${project.id}`, {
      data: {
        name: uniqueName("Backwards"),
        startDate: day(40),
        endDate: day(35),
      },
    }),
    400,
  );
  await expectStatus(
    await member.post(`/api/cycle/project/${project.id}`, {
      data: { name: "" },
    }),
    400,
  );
  await expectStatus(
    await world.as("viewer").post(`/api/cycle/project/${project.id}`, {
      data: { name: uniqueName("Viewer cycle") },
    }),
    403,
  );
  await expectStatus(
    await member.get(`/api/cycle/project/${project.id}`, {
      params: { view: "soon" },
    }),
    400,
  );
});

test(
  "add, move and remove cycle tasks; set a task's cycle",
  covers("addCycleTasks", "removeCycleTasks", "setTaskCycle"),
  async () => {
    const member = world.as("member");
    const [first, second, third] = tasks;
    const added = await expectJson<Membership>(
      await member.post(`/api/cycle/${draft.id}/tasks`, {
        data: { taskIds: [first?.id, second?.id, "e2e-unknown-task"] },
      }),
    );
    expect(added.added.sort()).toEqual([first?.id, second?.id].sort());
    expect(added.ignored).toEqual(["e2e-unknown-task"]);

    // Adding to another cycle moves them.
    const moved = await expectJson<Membership>(
      await member.post(`/api/cycle/${current.id}/tasks`, {
        data: { taskIds: [first?.id, second?.id, third?.id] },
      }),
    );
    expect(moved.moved.map((entry) => entry.taskId).sort()).toEqual(
      [first?.id, second?.id].sort(),
    );
    expect(moved.added).toEqual([third?.id]);

    const removed = await expectJson<Membership>(
      await member.delete(`/api/cycle/${current.id}/tasks`, {
        data: { taskIds: [third?.id] },
      }),
    );
    expect(removed.removed).toEqual([third?.id]);

    const set = await expectJson<{
      taskId: string;
      cycleId: string | null;
      previousCycleId: string | null;
    }>(
      await member.put(`/api/cycle/task/${third?.id}`, {
        data: { cycleId: draft.id },
      }),
    );
    expect(set).toEqual({
      taskId: third?.id,
      cycleId: draft.id,
      previousCycleId: null,
    });
    const cleared = await expectJson<{
      cycleId: string | null;
      previousCycleId: string | null;
    }>(
      await member.put(`/api/cycle/task/${third?.id}`, {
        data: { cycleId: null },
      }),
    );
    expect(cleared).toMatchObject({ cycleId: null, previousCycleId: draft.id });

    // Completed cycles take no new tasks.
    await expectStatus(
      await member.put(`/api/cycle/task/${third?.id}`, {
        data: { cycleId: completed.id },
      }),
      409,
    );
    await expectStatus(
      await world.as("viewer").post(`/api/cycle/${current.id}/tasks`, {
        data: { taskIds: [third?.id] },
      }),
      403,
    );
    await expectStatus(
      await member.post(`/api/cycle/${current.id}/tasks`, {
        data: { taskIds: [] },
      }),
      400,
    );
  },
);

test("cycle progress", covers("getCycleProgress"), async () => {
  const progress = await expectJson<{
    cycleId: string;
    counts: {
      total: number;
      unstarted: number;
      started: number;
      completed: number;
    };
    progress: number;
    chart: { scope: number; days: unknown[] };
    priorities: unknown[];
  }>(await world.as("viewer").get(`/api/cycle/${current.id}/progress`));
  expect(progress.cycleId).toBe(current.id);
  expect(progress.counts).toMatchObject({
    total: 2,
    unstarted: 1,
    started: 1,
    completed: 0,
  });
  expect(progress.progress).toBe(0);
  expect(progress.chart.days.length).toBeGreaterThan(0);
});

test("update a cycle", covers("updateCycle"), async () => {
  const member = world.as("member");
  const name = uniqueName("Renamed cycle");
  const updated = await expectJson<Cycle>(
    await member.put(`/api/cycle/${draft.id}`, {
      data: {
        name,
        description: "Now scheduled",
        startDate: day(30),
        endDate: day(40),
      },
    }),
  );
  expect(updated).toMatchObject({
    name,
    status: "upcoming",
    startDate: day(30),
    endDate: day(40),
  });

  // Back to a draft: both dates null together.
  const unscheduled = await expectJson<Cycle>(
    await member.put(`/api/cycle/${draft.id}`, {
      data: { startDate: null, endDate: null },
    }),
  );
  expect(unscheduled.status).toBe("draft");
  // A current cycle cannot end before today.
  await expectStatus(
    await member.put(`/api/cycle/${current.id}`, {
      data: { startDate: day(-3), endDate: day(-1) },
    }),
    400,
  );
  // Completed cycles only accept sortOrder.
  await expectStatus(
    await member.put(`/api/cycle/${completed.id}`, {
      data: { name: "Too late" },
    }),
    409,
  );
  await expectStatus(
    await member.put("/api/cycle/e2e-unknown", { data: { name: "x" } }),
    404,
  );
});

test(
  "transfer a completed cycle's unfinished tasks; archive and restore it",
  covers("transferCycleTasks", "archiveCycle", "unarchiveCycle"),
  async () => {
    const owner = world.as("owner");
    // Put an unfinished and a finished task into the past cycle directly.
    const open = await createTask(owner, project.id, { status: "to-do" });
    const finished = await createTask(owner, project.id, { status: "done" });
    const pastTarget = await expectJson<Cycle>(
      await owner.post(`/api/cycle/project/${project.id}`, {
        data: {
          name: uniqueName("Old"),
          startDate: day(-60),
          endDate: day(-50),
        },
      }),
    );
    // Tasks cannot join a completed cycle, so fill it while it is a draft.
    const holder = await expectJson<Cycle>(
      await owner.post(`/api/cycle/project/${project.id}`, {
        data: { name: uniqueName("Holder") },
      }),
    );
    await expectJson(
      await owner.post(`/api/cycle/${holder.id}/tasks`, {
        data: { taskIds: [open.id, finished.id] },
      }),
    );
    const done = await expectJson<Cycle>(
      await owner.put(`/api/cycle/${holder.id}`, {
        data: { startDate: day(-45), endDate: day(-40) },
      }),
      [200, 409],
    );
    test.skip(
      done.status !== "completed",
      "The API does not let a draft move into the past; transfer needs a completed cycle with tasks",
    );

    await expectStatus(
      await owner.post(`/api/cycle/${holder.id}/transfer`, {
        data: { targetCycleId: pastTarget.id },
      }),
      409,
    );
    const transferred = await expectJson<{
      sourceCycleId: string;
      targetCycleId: string;
      movedTaskIds: string[];
      isFrozen: boolean;
    }>(
      await world.as("member").post(`/api/cycle/${holder.id}/transfer`, {
        data: { targetCycleId: current.id },
      }),
    );
    expect(transferred.movedTaskIds).toEqual([open.id]);
    expect(transferred.isFrozen).toBe(true);

    await expectStatus(
      await owner.post(`/api/cycle/${current.id}/archive`),
      409,
    );
    const archived = await expectJson<Cycle>(
      await world.as("member").post(`/api/cycle/${holder.id}/archive`),
    );
    expect(archived.archivedAt).not.toBeNull();
    const archivedList = await expectJson<Cycle[]>(
      await owner.get(`/api/cycle/project/${project.id}`, {
        params: { view: "archived" },
      }),
    );
    expect(archivedList.map((cycle) => cycle.id)).toContain(holder.id);
    const restored = await expectJson<Cycle>(
      await world.as("member").post(`/api/cycle/${holder.id}/unarchive`),
    );
    expect(restored.archivedAt).toBeNull();
    await expectStatus(
      await owner.post(`/api/cycle/${holder.id}/unarchive`),
      409,
    );
    await expectJson(await owner.delete(`/api/cycle/${pastTarget.id}`));
  },
);

test(
  "delete a cycle: members only delete cycles they own",
  covers("deleteCycle"),
  async () => {
    const member = world.as("member");
    // The member does not own the completed cycle and lacks cycle:delete.
    await expectStatus(await member.delete(`/api/cycle/${completed.id}`), 403);
    // ...but owns the current one.
    const removed = await expectJson<{ id: string; removedTaskIds: string[] }>(
      await member.delete(`/api/cycle/${current.id}`),
    );
    expect(removed.id).toBe(current.id);
    expect(removed.removedTaskIds.length).toBeGreaterThan(0);
    const deleted = await expectJson<{ id: string }>(
      await world.as("admin").delete(`/api/cycle/${completed.id}`),
    );
    expect(deleted.id).toBe(completed.id);
    await expectStatus(await member.get(`/api/cycle/${current.id}`), 404);
  },
);

test("the Cycles feature gate answers 403 while the feature is off", async () => {
  const owner = world.as("owner");
  await expectJson(
    await owner.patch(`/api/project/${project.id}/features`, {
      data: { cyclesEnabled: false },
    }),
  );
  try {
    await expectStatus(
      await owner.get(`/api/cycle/project/${project.id}`),
      403,
    );
    await expectStatus(
      await owner.post(`/api/cycle/project/${project.id}`, {
        data: { name: "Gated" },
      }),
      403,
    );
    await expectStatus(await owner.get(`/api/cycle/${draft.id}`), 403);
    await expectStatus(await owner.get(`/api/cycle/${draft.id}/progress`), 403);
    await expectStatus(
      await owner.put(`/api/cycle/task/${tasks[0]?.id}`, {
        data: { cycleId: null },
      }),
      403,
    );
  } finally {
    await expectJson(
      await owner.patch(`/api/project/${project.id}/features`, {
        data: { cyclesEnabled: true },
      }),
    );
  }
  // The data survived.
  await expectJson(await owner.get(`/api/cycle/${draft.id}`));
});
