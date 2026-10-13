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

// Time entries: log, read, close a running entry, and the time-tracking
// feature gate (403 while the project's time tracking is off).

type TimeEntry = {
  id: string;
  taskId: string;
  userId: string | null;
  description: string | null;
  startTime: string;
  endTime: string | null;
  duration: number | null;
};

let world: World;
let project: Project;
let task: Task;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Time");
  project = await createProject(world.as("owner"), world.workspace.id);
  task = await createTask(world.as("owner"), project.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "log time, list it, read one entry and close a running one",
  covers(
    "createTimeEntry",
    "getTaskTimeEntries",
    "getTimeEntry",
    "updateTimeEntry",
  ),
  async () => {
    const member = world.as("member");
    const finished = await expectJson<TimeEntry>(
      await member.post("/api/time-entry", {
        data: {
          taskId: task.id,
          startTime: "2031-02-01T09:00:00.000Z",
          endTime: "2031-02-01T10:30:00.000Z",
          description: "Pairing",
        },
      }),
    );
    expect(finished).toMatchObject({
      taskId: task.id,
      userId: world.users.member.id,
      description: "Pairing",
      duration: 90 * 60,
    });

    const running = await expectJson<TimeEntry>(
      await member.post("/api/time-entry", {
        data: { taskId: task.id, startTime: "2031-02-02T09:00:00.000Z" },
      }),
    );
    expect(running.endTime).toBeNull();

    const listed = await expectJson<TimeEntry[]>(
      await world.as("viewer").get(`/api/time-entry/task/${task.id}`),
    );
    expect(listed.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([finished.id, running.id]),
    );

    const one = await expectJson<TimeEntry>(
      await world.as("viewer").get(`/api/time-entry/${finished.id}`),
    );
    expect(one.description).toBe("Pairing");

    const closed = await expectJson<TimeEntry>(
      await member.put(`/api/time-entry/${running.id}`, {
        data: {
          startTime: "2031-02-02T09:00:00.000Z",
          endTime: "2031-02-02T09:45:00.000Z",
          description: "Review",
        },
      }),
    );
    expect(closed).toMatchObject({ duration: 45 * 60, description: "Review" });
    expect(closed.endTime).toBe("2031-02-02T09:45:00.000Z");
  },
);

test("time entry validation and roles", async () => {
  await expectStatus(
    await world.as("viewer").post("/api/time-entry", {
      data: { taskId: task.id, startTime: "2031-02-03T09:00:00.000Z" },
    }),
    403,
  );
  await expectStatus(
    await world.as("member").post("/api/time-entry", {
      data: {
        taskId: task.id,
        startTime: "2031-02-03T10:00:00.000Z",
        endTime: "2031-02-03T09:00:00.000Z",
      },
    }),
    400,
  );
  await expectStatus(
    await world.as("member").post("/api/time-entry", {
      data: { taskId: task.id, startTime: "yesterday" },
    }),
    400,
  );
  await expectStatus(
    await world.as("member").get("/api/time-entry/e2e-unknown-entry"),
    [400, 404],
  );
});

test("time tracking turned off answers 403 and keeps the data", async () => {
  const owner = world.as("owner");
  const entry = await expectJson<TimeEntry>(
    await owner.post("/api/time-entry", {
      data: {
        taskId: task.id,
        startTime: "2031-02-04T09:00:00.000Z",
        endTime: "2031-02-04T09:10:00.000Z",
      },
    }),
  );
  await expectJson(
    await owner.patch(`/api/project/${project.id}/features`, {
      data: { timeTrackingEnabled: false },
    }),
  );
  try {
    await expectStatus(await owner.get(`/api/time-entry/task/${task.id}`), 403);
    await expectStatus(await owner.get(`/api/time-entry/${entry.id}`), 403);
    await expectStatus(
      await owner.post("/api/time-entry", {
        data: { taskId: task.id, startTime: "2031-02-05T09:00:00.000Z" },
      }),
      403,
    );
    await expectStatus(
      await owner.put(`/api/time-entry/${entry.id}`, {
        data: { startTime: "2031-02-04T09:00:00.000Z" },
      }),
      403,
    );
  } finally {
    await expectJson(
      await owner.patch(`/api/project/${project.id}/features`, {
        data: { timeTrackingEnabled: true },
      }),
    );
  }
  const back = await expectJson<TimeEntry>(
    await owner.get(`/api/time-entry/${entry.id}`),
  );
  expect(back.id).toBe(entry.id);
});

test("a time entry can be deleted", covers("deleteTimeEntry"), async () => {
  const member = world.as("member");
  const entry = await expectJson<TimeEntry>(
    await member.post("/api/time-entry", {
      data: {
        taskId: task.id,
        startTime: "2031-02-06T09:00:00.000Z",
        endTime: "2031-02-06T09:20:00.000Z",
      },
    }),
  );
  await expectStatus(
    await world.as("viewer").delete(`/api/time-entry/${entry.id}`),
    403,
  );
  await expectJson(await member.delete(`/api/time-entry/${entry.id}`));
  // Gone: the workspace can no longer be resolved from the id.
  await expectStatus(
    await member.get(`/api/time-entry/${entry.id}`),
    [400, 404],
  );
  const listed = await expectJson<TimeEntry[]>(
    await member.get(`/api/time-entry/task/${task.id}`),
  );
  expect(listed.map((item) => item.id)).not.toContain(entry.id);
});
