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
    404,
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

test(
  "a timer runs one at a time, stops, and counts in the totals",
  covers("getRunningTimeEntry", "stopTimeEntry", "getTimeReport"),
  async () => {
    const admin = world.as("admin");
    const second = await createTask(world.as("owner"), project.id);
    const startedAt = new Date(Date.now() - 120_000).toISOString();

    const first = await expectJson<TimeEntry>(
      await admin.post("/api/time-entry", {
        data: { taskId: task.id, startTime: startedAt },
      }),
    );
    const next = await expectJson<
      TimeEntry & { stoppedEntries: { id: string; taskId: string }[] }
    >(
      await admin.post("/api/time-entry", {
        data: { taskId: second.id, startTime: startedAt },
      }),
    );
    expect(next.stoppedEntries).toEqual([{ id: first.id, taskId: task.id }]);

    const running = await expectJson<{
      entry: { id: string; taskId: string } | null;
    }>(
      await admin.get(
        `/api/time-entry/running?workspaceId=${world.workspace.id}`,
      ),
    );
    expect(running.entry).toMatchObject({ id: next.id, taskId: second.id });

    // Someone else's timer can't be stopped by a plain member.
    await expectStatus(
      await world.as("member").post(`/api/time-entry/${next.id}/stop`),
      403,
    );
    const stopped = await expectJson<TimeEntry>(
      await admin.post(`/api/time-entry/${next.id}/stop`),
    );
    expect(stopped.duration).toBeGreaterThanOrEqual(120);

    const day = startedAt.slice(0, 10);
    const report = await expectJson<{
      totalSeconds: number;
      byPerson: { userId: string | null; seconds: number }[];
      byProject: { projectId: string; seconds: number }[];
    }>(
      await admin.get(
        `/api/time-entry/report?workspaceId=${world.workspace.id}&projectIds=${project.id}&from=${day}&to=${day}&timeZone=UTC`,
      ),
    );
    expect(report.totalSeconds).toBeGreaterThanOrEqual(120);
    expect(report.byPerson.map((row) => row.userId)).toContain(
      world.users.admin.id,
    );
    expect(report.byProject.map((row) => row.projectId)).toEqual([project.id]);

    // Viewers have no analytics:read by default.
    await expectStatus(
      await world
        .as("viewer")
        .get(
          `/api/time-entry/report?workspaceId=${world.workspace.id}&from=${day}&to=${day}`,
        ),
      403,
    );
  },
);

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
  // Gone: the id reads as unknown.
  await expectStatus(await member.get(`/api/time-entry/${entry.id}`), 404);
  const listed = await expectJson<TimeEntry[]>(
    await member.get(`/api/time-entry/task/${task.id}`),
  );
  expect(listed.map((item) => item.id)).not.toContain(entry.id);
});
