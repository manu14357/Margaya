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
import { covers, skipUnlessDeployed } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Intake: requests submitted into a project's hidden triage column, the
// review queue (snooze, decline, duplicate, reopen, accept), requester edits
// and withdrawal, the intake:create/read/triage permissions (viewers submit
// and read, members also triage) and the Intake feature gate.

type IntakeItem = {
  id: string;
  projectId: string;
  taskId: string;
  status: "pending" | "snoozed" | "accepted" | "declined" | "duplicate";
  snoozedUntil: string | null;
  source: string;
  resolutionNote: string | null;
  submittedBy: { id: string; name: string };
  duplicateOf: { taskId: string; key: string; title: string } | null;
  task?: { title?: string; priority?: string };
};
type IntakePage = {
  items: IntakeItem[];
  total: number;
  hasMore: boolean;
  counts: Record<
    "pending" | "snoozed" | "accepted" | "declined" | "duplicate",
    number
  >;
};
type Board = {
  data: { columns: { slug: string; tasks: { id: string }[] }[] };
};

const INTAKE_OPERATIONS = [
  "listIntakeItems",
  "createIntakeItem",
  "getIntakeSummary",
  "getIntakeItemByTask",
  "getIntakeItem",
  "updateIntakeItem",
  "deleteIntakeItem",
  "acceptIntakeItem",
  "declineIntakeItem",
  "snoozeIntakeItem",
  "unsnoozeIntakeItem",
  "markIntakeItemDuplicate",
  "reopenIntakeItem",
];

let world: World;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Intake");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

test.beforeEach(async () => {
  await skipUnlessDeployed(...INTAKE_OPERATIONS);
});

const submit = async (
  title = uniqueName("Request"),
  actor: "viewer" | "member" = "viewer",
) =>
  expectJson<IntakeItem>(
    await world.as(actor).post(`/api/intake/project/${project.id}`, {
      data: { title, description: "Please look at this", priority: "high" },
    }),
  );

const boardTaskIds = async () => {
  const board = await expectJson<Board>(
    await world.as("owner").get(`/api/task/tasks/${project.id}`),
  );
  return board.data.columns.flatMap((column) =>
    column.tasks.map((task) => task.id),
  );
};

test("the Intake feature gate answers 403 while the feature is off", async () => {
  const owner = world.as("owner");
  // New projects start with intake off.
  await expectStatus(await owner.get(`/api/intake/project/${project.id}`), 403);
  await expectStatus(
    await owner.post(`/api/intake/project/${project.id}`, {
      data: { title: "Gated" },
    }),
    403,
  );
  await expectStatus(
    await owner.get(`/api/intake/project/${project.id}/summary`),
    403,
  );
  await expectJson(
    await owner.patch(`/api/project/${project.id}/features`, {
      data: { intakeEnabled: true },
    }),
  );
});

test(
  "submit a request; it stays off the board and shows in the queue",
  covers(
    "createIntakeItem",
    "listIntakeItems",
    "getIntakeSummary",
    "getIntakeItem",
    "getIntakeItemByTask",
  ),
  async () => {
    const title = uniqueName("Submitted request");
    const item = await submit(title);
    expect(item).toMatchObject({
      projectId: project.id,
      status: "pending",
      source: "in_app",
      resolutionNote: null,
      submittedBy: { id: world.users.viewer.id },
    });
    // Off the board until accepted, but readable as a task.
    expect(await boardTaskIds()).not.toContain(item.taskId);
    const task = await expectJson<{ id: string; title: string }>(
      await world.as("member").get(`/api/task/${item.taskId}`),
    );
    expect(task.title).toBe(title);

    const queue = await expectJson<IntakePage>(
      await world.as("member").get(`/api/intake/project/${project.id}`),
    );
    expect(queue.items.map((entry) => entry.id)).toContain(item.id);
    expect(queue.counts.pending).toBeGreaterThanOrEqual(1);
    const searched = await expectJson<IntakePage>(
      await world.as("member").get(`/api/intake/project/${project.id}`, {
        params: { search: title },
      }),
    );
    expect(searched.items.map((entry) => entry.id)).toEqual([item.id]);

    const summary = await expectJson<{ pending: number; snoozed: number }>(
      await world.as("member").get(`/api/intake/project/${project.id}/summary`),
    );
    expect(summary.pending).toBe(queue.counts.pending);

    expect(
      (
        await expectJson<IntakeItem>(
          await world.as("viewer").get(`/api/intake/item/${item.id}`),
        )
      ).id,
    ).toBe(item.id);
    expect(
      (
        await expectJson<IntakeItem>(
          await world.as("admin").get(`/api/intake/task/${item.taskId}`),
        )
      ).id,
    ).toBe(item.id);
    // An ordinary board task did not come from intake.
    const ordinary = await createTask(world.as("owner"), project.id);
    await expectStatus(
      await world.as("admin").get(`/api/intake/task/${ordinary.id}`),
      404,
    );

    await expectStatus(
      await world
        .as("viewer")
        .post(`/api/intake/project/${project.id}`, { data: { title: "" } }),
      400,
    );
    await expectStatus(
      await world.as("member").get(`/api/intake/project/${project.id}`, {
        params: { tab: "closed", status: "pending" },
      }),
      400,
    );
    await expectStatus(
      await world.as("anonymous").get(`/api/intake/project/${project.id}`),
      401,
    );
    await expectStatus(
      await world.as("member").get("/api/intake/item/e2e-unknown-item"),
      404,
    );
  },
);

test(
  "edit a request as its requester or with task:update",
  covers("updateIntakeItem"),
  async () => {
    const item = await submit();
    const byRequester = await expectJson<IntakeItem>(
      await world.as("viewer").patch(`/api/intake/item/${item.id}`, {
        data: { title: "Clarified by the requester", priority: "urgent" },
      }),
    );
    expect(byRequester.id).toBe(item.id);
    const task = await expectJson<{ title: string; priority: string }>(
      await world.as("member").get(`/api/task/${item.taskId}`),
    );
    expect(task).toMatchObject({
      title: "Clarified by the requester",
      priority: "urgent",
    });

    await expectJson(
      await world.as("member").patch(`/api/intake/item/${item.id}`, {
        data: { description: "Triage notes" },
      }),
    );
    await expectStatus(
      await world
        .as("viewer")
        .patch(`/api/intake/item/${item.id}`, { data: {} }),
      400,
    );
  },
);

test(
  "snooze, unsnooze, decline, reopen and mark as duplicate",
  covers(
    "snoozeIntakeItem",
    "unsnoozeIntakeItem",
    "declineIntakeItem",
    "reopenIntakeItem",
    "markIntakeItemDuplicate",
  ),
  async () => {
    const member = world.as("member");
    const item = await submit();

    const until = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const snoozed = await expectJson<IntakeItem>(
      await member.post(`/api/intake/item/${item.id}/snooze`, {
        data: { until },
      }),
    );
    expect(snoozed.status).toBe("snoozed");
    expect(new Date(snoozed.snoozedUntil ?? 0).toISOString()).toBe(until);
    const summary = await expectJson<{ snoozed: number }>(
      await member.get(`/api/intake/project/${project.id}/summary`),
    );
    expect(summary.snoozed).toBeGreaterThanOrEqual(1);
    await expectStatus(
      await member.post(`/api/intake/item/${item.id}/snooze`, {
        data: { until: new Date(Date.now() - 60_000).toISOString() },
      }),
      400,
    );
    // Viewers submit but do not triage.
    await expectStatus(
      await world.as("viewer").post(`/api/intake/item/${item.id}/unsnooze`),
      403,
    );
    const woke = await expectJson<IntakeItem>(
      await member.post(`/api/intake/item/${item.id}/unsnooze`),
    );
    expect(woke).toMatchObject({ status: "pending", snoozedUntil: null });
    await expectStatus(
      await member.post(`/api/intake/item/${item.id}/unsnooze`),
      409,
    );

    const declined = await expectJson<IntakeItem>(
      await member.post(`/api/intake/item/${item.id}/decline`, {
        data: { note: "Out of scope" },
      }),
    );
    expect(declined).toMatchObject({
      status: "declined",
      resolutionNote: "Out of scope",
    });
    await expectStatus(
      await member.post(`/api/intake/item/${item.id}/decline`, { data: {} }),
      409,
    );
    // The requester cannot edit a closed request.
    await expectStatus(
      await world
        .as("viewer")
        .patch(`/api/intake/item/${item.id}`, { data: { title: "Too late" } }),
      409,
    );
    const closed = await expectJson<IntakePage>(
      await member.get(`/api/intake/project/${project.id}`, {
        params: { tab: "closed" },
      }),
    );
    expect(closed.items.map((entry) => entry.id)).toContain(item.id);

    const reopened = await expectJson<IntakeItem>(
      await member.post(`/api/intake/item/${item.id}/reopen`),
    );
    expect(reopened).toMatchObject({ status: "pending", resolutionNote: null });
    await expectStatus(
      await member.post(`/api/intake/item/${item.id}/reopen`),
      409,
    );

    const original = await createTask(world.as("owner"), project.id, {
      title: uniqueName("Original"),
    });
    const duplicate = await expectJson<IntakeItem>(
      await member.post(`/api/intake/item/${item.id}/duplicate`, {
        data: { duplicateOfTaskId: original.id, note: "Already tracked" },
      }),
    );
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.duplicateOf).toMatchObject({
      taskId: original.id,
      title: original.title,
      key: `${project.slug}-${original.number}`,
    });
    const other = await submit();
    await expectStatus(
      await member.post(`/api/intake/item/${other.id}/duplicate`, {
        data: { duplicateOfTaskId: other.taskId },
      }),
      400,
    );
  },
);

test(
  "accept a request onto the board",
  covers("acceptIntakeItem"),
  async () => {
    const member = world.as("member");
    const item = await submit();
    await expectStatus(
      await member.post(`/api/intake/item/${item.id}/accept`, {
        data: { status: "no-such-column" },
      }),
      400,
    );
    await expectStatus(
      await world.as("viewer").post(`/api/intake/item/${item.id}/accept`, {
        data: { status: "to-do" },
      }),
      403,
    );
    const accepted = await expectJson<IntakeItem>(
      await member.post(`/api/intake/item/${item.id}/accept`, {
        data: { status: "to-do" },
      }),
    );
    expect(accepted.status).toBe("accepted");
    const board = await expectJson<Board>(
      await world.as("viewer").get(`/api/task/tasks/${project.id}`),
    );
    const toDo = board.data.columns.find((column) => column.slug === "to-do");
    expect(toDo?.tasks.map((task) => task.id)).toContain(item.taskId);
    await expectStatus(
      await member.post(`/api/intake/item/${item.id}/accept`, {
        data: { status: "to-do" },
      }),
      409,
    );
  },
);

test("withdraw or delete a request", covers("deleteIntakeItem"), async () => {
  const mine = await submit();
  // Another member without task:delete cannot remove someone else's request.
  await expectStatus(
    await world.as("member").delete(`/api/intake/item/${mine.id}`),
    403,
  );
  const withdrawn = await expectJson<{
    id: string;
    taskId: string;
    projectId: string;
  }>(await world.as("viewer").delete(`/api/intake/item/${mine.id}`));
  expect(withdrawn).toEqual({
    id: mine.id,
    taskId: mine.taskId,
    projectId: project.id,
  });
  await expectStatus(
    await world.as("viewer").get(`/api/intake/item/${mine.id}`),
    404,
  );
  await expectStatus(
    await world.as("owner").get(`/api/task/${mine.taskId}`),
    404,
  );

  // Accepted requests are tasks now: delete the task instead.
  const accepted = await submit(uniqueName("Accepted"), "member");
  await expectJson(
    await world.as("member").post(`/api/intake/item/${accepted.id}/accept`, {
      data: { status: "to-do" },
    }),
  );
  await expectStatus(
    await world.as("admin").delete(`/api/intake/item/${accepted.id}`),
    409,
  );
  const other = await submit();
  expect(
    (
      await expectJson<{ id: string }>(
        await world.as("admin").delete(`/api/intake/item/${other.id}`),
      )
    ).id,
  ).toBe(other.id);
});
