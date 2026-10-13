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

// Tasks: CRUD, single-field updates, assignees, archive, move, copy, import
// and export, bulk operations, long descriptions and the task query engine,
// with the role matrix (viewer reads; member cannot delete or assign).

type Board = {
  data: {
    columns: {
      slug: string;
      tasks: { id: string; descriptionDeferred?: boolean }[];
    }[];
    archivedTasks: { id: string }[];
    plannedTasks: { id: string }[];
  };
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
};

let world: World;
let project: Project;
let other: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Tasks");
  project = await createProject(world.as("owner"), world.workspace.id);
  other = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

const ids = (tasks: { id: string }[]) => tasks.map((task) => task.id);

test(
  "create a task, read it and find it on the board",
  covers("createTask", "getTask", "listTasks"),
  async () => {
    const { member } = world.users;
    const title = uniqueName("Task");
    const task = await expectJson<Task>(
      await world.as("owner").post(`/api/task/${project.id}`, {
        data: {
          title,
          description: "Created over HTTP",
          priority: "high",
          status: "to-do",
          dueDate: "2031-03-04T00:00:00.000Z",
          assigneeIds: [member.id],
        },
      }),
    );
    expect(task).toMatchObject({
      title,
      projectId: project.id,
      status: "to-do",
      priority: "high",
      assigneeIds: [member.id],
      createdBy: world.users.owner.id,
      number: 1,
    });
    expect(task.dueDate).toBe("2031-03-04T00:00:00.000Z");

    const fetched = await expectJson<
      Task & { assignees: { id: string; name: string }[] }
    >(await world.as("viewer").get(`/api/task/${task.id}`));
    expect(fetched.assignees).toEqual([
      expect.objectContaining({ id: member.id, name: member.name }),
    ]);

    const board = await expectJson<Board>(
      await world.as("viewer").get(`/api/task/tasks/${project.id}`),
    );
    const toDo = board.data.columns.find((column) => column.slug === "to-do");
    expect(ids(toDo?.tasks ?? [])).toContain(task.id);
    expect(board.pagination.total).toBeGreaterThanOrEqual(1);

    // Filters and paging.
    const filtered = await expectJson<Board>(
      await world.as("viewer").get(`/api/task/tasks/${project.id}`, {
        params: { priority: "low" },
      }),
    );
    expect(
      filtered.data.columns.flatMap((column) => ids(column.tasks)),
    ).not.toContain(task.id);
    await expectStatus(
      await world.as("viewer").get(`/api/task/tasks/${project.id}`, {
        params: { limit: "1000" },
      }),
      400,
    );
  },
);

test("task roles: viewer cannot create; member creates but cannot delete or assign", async () => {
  const body = {
    title: uniqueName("Role task"),
    description: "",
    priority: "low",
    status: "to-do",
  };
  await expectStatus(
    await world.as("viewer").post(`/api/task/${project.id}`, { data: body }),
    403,
  );
  // Assignees at creation only need task:create.
  const task = await expectJson<Task>(
    await world.as("member").post(`/api/task/${project.id}`, {
      data: { ...body, assigneeIds: [world.users.admin.id] },
    }),
  );
  expect(task.assigneeIds).toEqual([world.users.admin.id]);

  await expectStatus(
    await world.as("member").put(`/api/task/assignees/${task.id}`, {
      data: { assigneeIds: [world.users.member.id] },
    }),
    403,
  );
  await expectStatus(
    await world.as("member").delete(`/api/task/${task.id}`),
    403,
  );
  await expectStatus(
    await world
      .as("viewer")
      .put(`/api/task/title/${task.id}`, { data: { title: "x" } }),
    403,
  );
  await expectJson(await world.as("admin").delete(`/api/task/${task.id}`));
});

test("task validation: bad priority, missing title, unknown column, outside assignee", async ({
  seed,
}) => {
  const owner = world.as("owner");
  await expectStatus(
    await owner.post(`/api/task/${project.id}`, {
      data: {
        title: "x",
        description: "",
        priority: "critical",
        status: "to-do",
      },
    }),
    400,
  );
  await expectStatus(
    await owner.post(`/api/task/${project.id}`, {
      data: { description: "", priority: "low", status: "to-do" },
    }),
    400,
  );
  const task = await createTask(owner, project.id);
  const invalidStatus = await expectStatus(
    await owner.put(`/api/task/status/${task.id}`, {
      data: { status: "no-such-column" },
    }),
    400,
  );
  expect(invalidStatus).toContain("Invalid status");
  // A user who is not a member of this workspace cannot be assigned.
  await expectStatus(
    await owner.put(`/api/task/assignees/${task.id}`, {
      data: { assigneeIds: [seed.users.viewer.id] },
    }),
    403,
  );
  await expectStatus(await owner.get("/api/task/e2e-unknown-task"), 400);
  await expectJson(await owner.delete(`/api/task/${task.id}`));
});

test(
  "single-field updates: title, description, priority, status and due date",
  covers(
    "updateTaskTitle",
    "updateTaskDescription",
    "updateTaskPriority",
    "updateTaskStatus",
    "updateTaskDueDate",
  ),
  async () => {
    const member = world.as("member");
    const task = await createTask(world.as("owner"), project.id);

    const title = uniqueName("Renamed");
    expect(
      (
        await expectJson<Task>(
          await member.put(`/api/task/title/${task.id}`, { data: { title } }),
        )
      ).title,
    ).toBe(title);

    const described = await expectJson<Task & { description: string }>(
      await member.put(`/api/task/description/${task.id}`, {
        data: { description: "New description" },
      }),
    );
    expect(described.description).toBe("New description");

    expect(
      (
        await expectJson<Task>(
          await member.put(`/api/task/priority/${task.id}`, {
            data: { priority: "urgent" },
          }),
        )
      ).priority,
    ).toBe("urgent");
    await expectStatus(
      await member.put(`/api/task/priority/${task.id}`, {
        data: { priority: "whenever" },
      }),
      400,
    );

    const moved = await expectJson<Task & { completedAt: string | null }>(
      await member.put(`/api/task/status/${task.id}`, {
        data: { status: "done" },
      }),
    );
    expect(moved.status).toBe("done");
    expect(moved.completedAt).not.toBeNull();
    const reopened = await expectJson<Task & { completedAt: string | null }>(
      await member.put(`/api/task/status/${task.id}`, {
        data: { status: "in-progress" },
      }),
    );
    expect(reopened.completedAt).toBeNull();

    const due = await expectJson<Task>(
      await member.put(`/api/task/due-date/${task.id}`, {
        data: { dueDate: "2031-05-01T00:00:00.000Z" },
      }),
    );
    expect(due.dueDate).toBe("2031-05-01T00:00:00.000Z");
    const cleared = await expectJson<Task>(
      await member.put(`/api/task/due-date/${task.id}`, { data: {} }),
    );
    expect(cleared.dueDate).toBeNull();
    await expectStatus(
      await member.put(`/api/task/due-date/${task.id}`, {
        data: { dueDate: "not a date" },
      }),
      400,
    );

    // Each change is recorded in the activity feed.
    const activity = await expectJson<{ type: string }[]>(
      await member.get(`/api/activity/${task.id}`),
    );
    expect(activity.map((entry) => entry.type)).toEqual(
      expect.arrayContaining(["status_changed", "priority_changed"]),
    );
  },
);

test("replace every field of a task", covers("updateTask"), async () => {
  const owner = world.as("owner");
  const task = await createTask(owner, project.id);
  const title = uniqueName("Full update");
  const updated = await expectJson<
    Task & { description: string; startDate: string | null }
  >(
    await owner.put(`/api/task/${task.id}`, {
      data: {
        title,
        description: "Replaced",
        priority: "low",
        status: "in-review",
        projectId: project.id,
        position: 0,
        startDate: "2031-01-01T00:00:00.000Z",
        dueDate: "2031-01-31T00:00:00.000Z",
        assigneeIds: [world.users.admin.id, world.users.member.id],
      },
    }),
  );
  expect(updated).toMatchObject({
    title,
    description: "Replaced",
    priority: "low",
    status: "in-review",
    startDate: "2031-01-01T00:00:00.000Z",
    dueDate: "2031-01-31T00:00:00.000Z",
    assigneeIds: [world.users.admin.id, world.users.member.id],
  });
  // Changing assignees through the full update needs task:assign.
  await expectStatus(
    await world.as("member").put(`/api/task/${task.id}`, {
      data: {
        title,
        priority: "low",
        status: "in-review",
        projectId: project.id,
        position: 0,
        assigneeIds: [world.users.member.id],
      },
    }),
    403,
  );
  await expectStatus(
    await owner.put(`/api/task/${task.id}`, { data: { title } }),
    400,
  );
});

test(
  "assignees: replace with one, set a list, add and remove",
  covers("updateTaskAssignee", "setTaskAssignees", "updateTaskAssignees"),
  async () => {
    const admin = world.as("admin");
    const { owner, member, viewer } = world.users;
    const task = await createTask(world.as("owner"), project.id);

    const single = await expectJson<Task>(
      await admin.put(`/api/task/assignee/${task.id}`, {
        data: { userId: member.id },
      }),
    );
    expect(single.assigneeIds).toEqual([member.id]);

    const list = await expectJson<Task>(
      await admin.put(`/api/task/assignees/${task.id}`, {
        data: { assigneeIds: [member.id, owner.id, viewer.id] },
      }),
    );
    // People who stay keep their order; new people go last.
    expect(list.assigneeIds).toEqual([member.id, owner.id, viewer.id]);

    const patched = await expectJson<Task>(
      await admin.patch(`/api/task/assignees/${task.id}`, {
        data: { add: [world.users.admin.id], remove: [owner.id] },
      }),
    );
    expect(patched.assigneeIds).toEqual([
      member.id,
      viewer.id,
      world.users.admin.id,
    ]);

    await expectStatus(
      await admin.patch(`/api/task/assignees/${task.id}`, {
        data: { add: [member.id], remove: [member.id] },
      }),
      400,
    );
    await expectStatus(
      await admin.patch(`/api/task/assignees/${task.id}`, { data: {} }),
      400,
    );

    const none = await expectJson<Task>(
      await admin.put(`/api/task/assignee/${task.id}`, {
        data: { userId: null },
      }),
    );
    expect(none.assigneeIds).toEqual([]);
    const empty = await expectJson<Task>(
      await admin.put(`/api/task/assignees/${task.id}`, {
        data: { assigneeIds: [] },
      }),
    );
    expect(empty.assigneeIds).toEqual([]);
    await expectStatus(
      await admin.put("/api/task/assignee/e2e-unknown-task", {
        data: { userId: null },
      }),
      [400, 404],
    );
  },
);

test(
  "archive and restore a task",
  covers("archiveTask", "unarchiveTask"),
  async () => {
    const member = world.as("member");
    const task = await createTask(world.as("owner"), project.id);
    const archived = await expectJson<Task>(
      await member.post(`/api/task/archive/${task.id}`),
    );
    expect(archived.archivedAt).not.toBeNull();

    const board = await expectJson<Board>(
      await member.get(`/api/task/tasks/${project.id}`),
    );
    expect(ids(board.data.archivedTasks)).toContain(task.id);
    expect(
      board.data.columns.flatMap((column) => ids(column.tasks)),
    ).not.toContain(task.id);

    // Archiving again changes nothing.
    await expectJson(await member.post(`/api/task/archive/${task.id}`));
    const restored = await expectJson<Task>(
      await member.post(`/api/task/unarchive/${task.id}`),
    );
    expect(restored.archivedAt).toBeNull();
    expect(restored.status).toBe(task.status);
    await expectStatus(
      await world.as("viewer").post(`/api/task/archive/${task.id}`),
      403,
    );
  },
);

test("move a task to another project", covers("moveTask"), async () => {
  const owner = world.as("owner");
  const task = await createTask(owner, project.id, {
    title: uniqueName("Mover"),
  });
  const moved = await expectJson<{ task: Task; sourceProjectId?: string }>(
    await owner.put(`/api/task/move/${task.id}`, {
      data: {
        destinationProjectId: other.id,
        destinationStatus: "in-progress",
      },
    }),
  );
  expect(moved.task).toMatchObject({
    id: task.id,
    projectId: other.id,
    status: "in-progress",
  });
  const board = await expectJson<Board>(
    await owner.get(`/api/task/tasks/${other.id}`),
  );
  const column = board.data.columns.find(
    (entry) => entry.slug === "in-progress",
  );
  expect(ids(column?.tasks ?? [])).toContain(task.id);

  await expectStatus(
    await owner.put(`/api/task/move/${task.id}`, {
      data: { destinationProjectId: "e2e-unknown-project" },
    }),
    404,
  );
  await expectStatus(
    await world.as("viewer").put(`/api/task/move/${task.id}`, {
      data: { destinationProjectId: project.id },
    }),
    403,
  );
});

test(
  "copy a task with its description and assignees",
  covers("copyTask"),
  async () => {
    const owner = world.as("owner");
    const task = await createTask(owner, project.id, {
      title: uniqueName("Original"),
      description: "Copy me",
      assigneeIds: [world.users.member.id],
    });
    const copied = await expectJson<{
      task: Task & { description: string };
      key: string;
      skipped: string[];
    }>(
      await world.as("member").post(`/api/task-copy/${task.id}`, {
        data: { include: ["description", "assignees"] },
      }),
    );
    expect(copied.task.id).not.toBe(task.id);
    expect(copied.task).toMatchObject({
      title: `${task.title} (copy)`,
      description: "Copy me",
      assigneeIds: [world.users.member.id],
      projectId: project.id,
    });
    expect(copied.key).toBe(`${project.slug}-${copied.task.number}`);

    const elsewhere = await expectJson<{ task: Task }>(
      await owner.post(`/api/task-copy/${task.id}`, {
        data: { projectId: other.id, title: "Copied elsewhere" },
      }),
    );
    expect(elsewhere.task).toMatchObject({
      projectId: other.id,
      title: "Copied elsewhere",
    });

    await expectStatus(
      await world.as("viewer").post(`/api/task-copy/${task.id}`, { data: {} }),
      403,
    );
    await expectStatus(
      await owner.post(`/api/task-copy/${task.id}`, {
        data: { include: ["everything"] },
      }),
      400,
    );
    await expectStatus(
      await owner.post(`/api/task-copy/${task.id}`, {
        data: { projectId: "e2e-unknown" },
      }),
      404,
    );
  },
);

test(
  "export a project's tasks and import them into another",
  covers("exportTasks", "importTasks"),
  async () => {
    const owner = world.as("owner");
    const source = await createProject(owner, world.workspace.id);
    const titles = [uniqueName("Export A"), uniqueName("Export B")];
    for (const title of titles) {
      await createTask(owner, source.id, { title, priority: "high" });
    }
    const exported = await expectJson<{
      project: { name: string; slug: string; exportedAt: string };
      tasks: {
        title: string;
        status: string;
        priority: string;
        labels: unknown[];
      }[];
    }>(await world.as("viewer").get(`/api/task/export/${source.id}`));
    expect(exported.project).toMatchObject({
      name: source.name,
      slug: source.slug,
    });
    expect(exported.tasks.map((task) => task.title).sort()).toEqual(
      [...titles].sort(),
    );

    const target = await createProject(owner, world.workspace.id);
    const imported = await expectJson<{
      results: {
        total: number;
        successful: number;
        failed: number;
        tasks: { success: boolean }[];
      };
    }>(
      await world.as("member").post(`/api/task/import/${target.id}`, {
        data: {
          tasks: exported.tasks.map(({ title, status, priority }) => ({
            title,
            status,
            priority,
            assigneeIds: [world.users.admin.id],
          })),
        },
      }),
    );
    expect(imported.results).toMatchObject({
      total: 2,
      successful: 2,
      failed: 0,
    });
    const board = await expectJson<Board>(
      await owner.get(`/api/task/tasks/${target.id}`),
    );
    expect(board.pagination.total).toBe(2);

    await expectStatus(
      await world.as("viewer").post(`/api/task/import/${target.id}`, {
        data: { tasks: [{ title: "x", status: "to-do" }] },
      }),
      403,
    );
    await expectStatus(
      await owner.post(`/api/task/import/${target.id}`, {
        data: { tasks: [{ status: "to-do" }] },
      }),
      400,
    );
    await expectJson(await owner.delete(`/api/project/${source.id}`));
    await expectJson(await owner.delete(`/api/project/${target.id}`));
  },
);

test("bulk operations", covers("bulkUpdateTasks"), async () => {
  const owner = world.as("owner");
  const tasks = [
    await createTask(owner, project.id),
    await createTask(owner, project.id),
  ];
  const taskIds = ids(tasks);

  const priority = await expectJson<{ success: boolean; updatedCount: number }>(
    await world.as("member").patch("/api/task/bulk", {
      data: { taskIds, operation: "updatePriority", value: "urgent" },
    }),
  );
  expect(priority).toEqual({ success: true, updatedCount: 2 });
  for (const id of taskIds) {
    expect(
      (await expectJson<Task>(await owner.get(`/api/task/${id}`))).priority,
    ).toBe("urgent");
  }

  await expectJson(
    await world.as("admin").patch("/api/task/bulk", {
      data: { taskIds, operation: "addAssignee", value: world.users.member.id },
    }),
  );
  for (const id of taskIds) {
    expect(
      (await expectJson<Task>(await owner.get(`/api/task/${id}`))).assigneeIds,
    ).toContain(world.users.member.id);
  }
  // Members lack task:assign and task:delete.
  await expectStatus(
    await world.as("member").patch("/api/task/bulk", {
      data: {
        taskIds,
        operation: "removeAssignee",
        value: world.users.member.id,
      },
    }),
    403,
  );
  await expectStatus(
    await world
      .as("member")
      .patch("/api/task/bulk", { data: { taskIds, operation: "delete" } }),
    403,
  );
  await expectStatus(
    await owner.patch("/api/task/bulk", {
      data: { taskIds, operation: "explode" },
    }),
    400,
  );
  await expectStatus(
    await owner.patch("/api/task/bulk", {
      data: { taskIds: ["e2e-unknown-task"], operation: "archive" },
    }),
    [403, 404],
  );

  const deleted = await expectJson<{ updatedCount: number }>(
    await owner.patch("/api/task/bulk", {
      data: { taskIds, operation: "delete" },
    }),
  );
  expect(deleted.updatedCount).toBe(2);
  await expectStatus(await owner.get(`/api/task/${taskIds[0]}`), [400, 404]);
});

test("delete a task", covers("deleteTask"), async () => {
  const task = await createTask(world.as("owner"), project.id);
  const deleted = await expectJson<Task>(
    await world.as("admin").delete(`/api/task/${task.id}`),
  );
  expect(deleted.id).toBe(task.id);
  await expectStatus(
    await world.as("admin").get(`/api/task/${task.id}`),
    [400, 404],
  );
});

test(
  "long descriptions are paged and searchable outside the board",
  covers("getTaskDescriptionPage", "findDeferredTaskDescriptions"),
  async () => {
    const owner = world.as("owner");
    const token = `needle${Date.now().toString(36)}`;
    // Past the 64 KB board limit, with the search token beyond the first page.
    const description = `${"lorem ipsum dolor sit amet ".repeat(2600)}${token} tail`;
    const task = await createTask(owner, project.id, { description });

    const board = await expectJson<Board>(
      await owner.get(`/api/task/tasks/${project.id}`),
    );
    const onBoard = board.data.columns
      .flatMap((column) => column.tasks)
      .find((entry) => entry.id === task.id);
    expect(onBoard?.descriptionDeferred).toBe(true);

    let offset = 0;
    let version: string | undefined;
    let assembled = "";
    for (let page = 0; page < 10; page += 1) {
      const chunk = await expectJson<{
        content: string;
        version: string;
        nextOffset: number | null;
      }>(
        await world.as("viewer").get(`/api/task/${task.id}/description`, {
          params: version
            ? { offset: String(offset), version }
            : { offset: String(offset) },
        }),
      );
      version ??= chunk.version;
      expect(chunk.version).toBe(version);
      assembled += chunk.content;
      if (chunk.nextOffset === null) break;
      offset = chunk.nextOffset;
    }
    expect(assembled).toBe(description);

    const matches = await expectJson<{
      ids: string[];
      nextCursor: string | null;
    }>(
      await world
        .as("viewer")
        .get(`/api/task/description-matches/${project.id}`, {
          params: { query: token },
        }),
    );
    expect(matches.ids).toEqual([task.id]);
    expect(matches.nextCursor).toBeNull();

    // A stale version after an edit asks the reader to start over.
    await expectJson(
      await owner.put(`/api/task/description/${task.id}`, {
        data: { description: `${description} edited` },
      }),
    );
    await expectStatus(
      await owner.get(`/api/task/${task.id}/description`, {
        params: { offset: "32768", version: version ?? "0" },
      }),
      409,
    );
    await expectStatus(
      await owner.get(`/api/task/${task.id}/description`, {
        params: { version: "abc" },
      }),
      400,
    );
    await expectStatus(
      await owner.get(`/api/task/description-matches/${project.id}`, {
        params: { query: "" },
      }),
      400,
    );
  },
);

test("query tasks across projects", covers("queryTasks"), async () => {
  const owner = world.as("owner");
  const high = await createTask(owner, other.id, {
    title: uniqueName("Query high"),
    priority: "high",
    assigneeIds: [world.users.member.id],
  });
  const low = await createTask(owner, other.id, {
    title: uniqueName("Query low"),
    priority: "low",
  });

  const rows = await expectJson<{
    mode: string;
    totalCount: number;
    groups: { key: string; count: number; taskIds: string[] }[];
    tasks: Record<string, { id: string; title: string; key: string }>;
  }>(
    await world.as("viewer").post("/api/task-query", {
      data: {
        workspaceId: world.workspace.id,
        scope: { projectIds: [other.id] },
        filters: { key: "priority", operator: "in", values: ["high"] },
      },
    }),
  );
  expect(rows.mode).toBe("rows");
  const found = rows.groups.flatMap((group) => group.taskIds);
  expect(found).toContain(high.id);
  expect(found).not.toContain(low.id);
  expect(rows.tasks[high.id]?.key).toBe(`${other.slug}-${high.number}`);

  // "me" resolves to the caller.
  const mine = await expectJson<{ ids: string[] }>(
    await world.as("member").post("/api/task-query", {
      data: {
        workspaceId: world.workspace.id,
        scope: { projectIds: [other.id] },
        filters: { key: "assignee", operator: "in", values: ["me"] },
        mode: "ids",
      },
    }),
  );
  expect(mine.ids).toContain(high.id);
  expect(mine.ids).not.toContain(low.id);

  const counts = await expectJson<{ groups: { key: string; count: number }[] }>(
    await owner.post("/api/task-query", {
      data: {
        workspaceId: world.workspace.id,
        scope: { projectIds: [other.id] },
        mode: "counts",
        display: { groupBy: "priority" },
      },
    }),
  );
  expect(
    counts.groups.find((group) => group.key === "high")?.count,
  ).toBeGreaterThanOrEqual(1);

  const invalid = await expectStatus(
    await owner.post("/api/task-query", {
      data: {
        workspaceId: world.workspace.id,
        filters: { key: "nope", operator: "in", values: ["x"] },
      },
    }),
    400,
  );
  expect(invalid).toContain("Unsupported filter");
  await expectStatus(
    await owner.post("/api/task-query", {
      data: {
        workspaceId: world.workspace.id,
        scope: { projectIds: ["e2e-unknown"] },
      },
    }),
    404,
  );
});

test(
  "description image uploads need object storage",
  covers("createTaskImageUpload", "finalizeTaskImageUpload"),
  async () => {
    const owner = world.as("owner");
    const task = await createTask(owner, project.id);
    const upload = await owner.put(`/api/task/image-upload/${task.id}`, {
      data: {
        filename: "diagram.png",
        contentType: "image/png",
        size: 1024,
        surface: "description",
      },
    });
    // The e2e API runs without S3 (allowlisted in coverage.spec.ts).
    test.skip(
      upload.status() === 200,
      "S3 storage is configured; happy path not written",
    );
    const message = await expectStatus(upload, 503);
    expect(message).toMatch(/not configured/i);

    await expectStatus(
      await world.as("viewer").put(`/api/task/image-upload/${task.id}`, {
        data: {
          filename: "diagram.png",
          contentType: "image/png",
          size: 1024,
          surface: "description",
        },
      }),
      403,
    );
    await expectStatus(
      await owner.put(`/api/task/image-upload/${task.id}`, {
        data: {
          filename: "diagram.png",
          contentType: "image/png",
          size: 1024,
          surface: "sidebar",
        },
      }),
      400,
    );
    // Validation runs before storage is touched.
    await expectStatus(
      await owner.post(`/api/task/image-upload/${task.id}/finalize`, {
        data: {
          key: "k",
          filename: "diagram.png",
          contentType: "image/png",
          size: 0,
          surface: "description",
        },
      }),
      400,
    );
  },
);

test("finalizing an image upload without object storage fails cleanly", async () => {
  // The e2e API has no S3: finalizing answers the documented 503 with what to
  // configure, not a 500.
  const owner = world.as("owner");
  const task = await createTask(owner, project.id);
  const message = await expectStatus(
    await owner.post(`/api/task/image-upload/${task.id}/finalize`, {
      data: {
        key: "someone-elses/key.png",
        filename: "diagram.png",
        contentType: "image/png",
        size: 1024,
        surface: "description",
      },
    }),
    503,
  );
  expect(message).toContain("S3 uploads are not configured");
});
