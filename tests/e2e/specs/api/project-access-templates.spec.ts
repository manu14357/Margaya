import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  signUpUser,
  type Task,
  type TestUser,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Restricted projects (who reaches a project, and losing or regaining it),
// task templates, repeat rules, Trello/Linear/Asana imports (Linear's CSV
// works offline), changing a pending invitation's role, and per-user web
// preferences (on a throwaway account).

type ProjectMember = {
  userId: string;
  role: string;
  addedAt: string;
  name: string;
  email: string;
  image: string | null;
};

type ProjectAccess = {
  visibility: "open" | "restricted";
  leadUserId: string | null;
  members: ProjectMember[];
  canManage: boolean;
};

type TaskTemplate = {
  id: string;
  projectId: string;
  name: string;
  titlePattern: string;
  description: string;
  columnId: string | null;
  column: { id: string; name: string; slug: string } | null;
  priority: string | null;
  labels: { id: string; name: string; color: string }[];
  assigneeIds: string[];
  estimatePointId: string | null;
  subtasks: string[];
  position: number;
  createdAt: string;
  updatedAt: string;
};

type Recurrence = {
  taskId: string;
  frequency: string;
  interval: number;
  weekdays: number[];
  monthDay: number | null;
  trigger: string;
  anchorDate: string;
  endDate: string | null;
  maxOccurrences: number | null;
  occurrenceCount: number;
  nextDate: string | null;
};

type Board = {
  data: { columns: { slug: string; tasks: { id: string; title: string }[] }[] };
};

const UNKNOWN_ID = "e2e-does-not-exist-0000";

let world: World;
let outsider: TestUser;
let restricted: Project;
let restrictedTask: Task;
let work: Project;
let workTask: Task;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Access");
  outsider = await signUpUser("Access outsider");
  const owner = world.as("owner");
  restricted = await createProject(owner, world.workspace.id);
  restrictedTask = await createTask(owner, restricted.id);
  work = await createProject(owner, world.workspace.id);
  workTask = await createTask(owner, work.id, { dueDate: "2031-03-05" });
});

test.afterAll(async () => {
  await outsider?.ctx.dispose();
  await world?.dispose();
});

async function access(actor: Parameters<World["as"]>[0], projectId: string) {
  return world.as(actor).get(`/api/project/${projectId}/access`);
}

/** What `actor` gets for the project and its task: 200 or 404. */
async function reach(actor: "member" | "admin" | "viewer") {
  const ctx = world.as(actor);
  const [project, task] = await Promise.all([
    ctx.get(`/api/project/${restricted.id}`),
    ctx.get(`/api/task/${restrictedTask.id}`),
  ]);
  return [project.status(), task.status()];
}

test(
  "a restricted project hides itself from workspace members until they are added",
  covers(
    "getProjectAccess",
    "updateProjectVisibility",
    "addProjectMember",
    "updateProjectMember",
    "removeProjectMember",
  ),
  async () => {
    const owner = world.as("owner");
    const memberId = world.users.member.id;

    const open = await expectJson<ProjectAccess>(
      await access("viewer", restricted.id),
    );
    expect(open).toMatchObject({ visibility: "open", canManage: false });
    expect(open.members).toEqual([]);
    expect(
      (await expectJson<ProjectAccess>(await access("owner", restricted.id)))
        .canManage,
    ).toBe(true);
    expect(await reach("member")).toEqual([200, 200]);

    // Only project:share (owner, admin) or the lead may change access.
    await expectStatus(
      await world
        .as("member")
        .put(`/api/project/${restricted.id}/access/visibility`, {
          data: { visibility: "restricted" },
        }),
      403,
    );
    await expectStatus(
      await owner.put(`/api/project/${restricted.id}/access/visibility`, {
        data: { visibility: "secret" },
      }),
      400,
    );

    const locked = await expectJson<ProjectAccess>(
      await owner.put(`/api/project/${restricted.id}/access/visibility`, {
        data: { visibility: "restricted" },
      }),
    );
    expect(locked.visibility).toBe("restricted");
    // Whoever restricts the project keeps access as a project admin.
    expect(locked.members).toEqual([
      expect.objectContaining({
        userId: world.users.owner.id,
        role: "admin",
        email: world.users.owner.email,
      }),
    ]);

    // A plain member outside it: 404 everywhere, never 403.
    expect(await reach("member")).toEqual([404, 404]);
    expect(await reach("viewer")).toEqual([404, 404]);
    await expectStatus(await access("member", restricted.id), 404);
    await expectStatus(
      await world.as("member").get(`/api/task-recurrence/${restrictedTask.id}`),
      404,
    );
    const listed = await expectJson<{ id: string }[]>(
      await world
        .as("member")
        .get(`/api/project?workspaceId=${world.workspace.id}`),
    );
    expect(listed.map((project) => project.id)).not.toContain(restricted.id);
    // Workspace admins see every project.
    expect(await reach("admin")).toEqual([200, 200]);

    // Adding the member gives access back.
    const added = await expectJson<ProjectAccess>(
      await owner.post(`/api/project/${restricted.id}/access/members`, {
        data: { userId: memberId, role: "member" },
      }),
    );
    expect(added.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: memberId, role: "member" }),
      ]),
    );
    expect(await reach("member")).toEqual([200, 200]);
    expect(await reach("viewer")).toEqual([404, 404]);
    const seenByMember = await expectJson<ProjectAccess>(
      await access("member", restricted.id),
    );
    expect(seenByMember).toMatchObject({
      visibility: "restricted",
      canManage: false,
    });

    await expectStatus(
      await owner.post(`/api/project/${restricted.id}/access/members`, {
        data: { userId: memberId, role: "member" },
      }),
      409,
    );
    await expectStatus(
      await owner.post(`/api/project/${restricted.id}/access/members`, {
        data: { userId: outsider.id, role: "member" },
      }),
      400,
    );
    await expectStatus(
      await owner.post(`/api/project/${restricted.id}/access/members`, {
        data: { userId: world.users.viewer.id, role: "no-such-role" },
      }),
      400,
    );
    await expectStatus(
      await world
        .as("member")
        .post(`/api/project/${restricted.id}/access/members`, {
          data: { userId: world.users.viewer.id, role: "viewer" },
        }),
      403,
    );

    // A project role caps the workspace role: as a project viewer the
    // member can still read but no longer create tasks there.
    const capped = await expectJson<ProjectAccess>(
      await owner.patch(
        `/api/project/${restricted.id}/access/members/${memberId}`,
        { data: { role: "viewer" } },
      ),
    );
    expect(capped.members.find((m) => m.userId === memberId)?.role).toBe(
      "viewer",
    );
    expect(await reach("member")).toEqual([200, 200]);
    await expectStatus(
      await world.as("member").post(`/api/task/${restricted.id}`, {
        data: {
          title: uniqueName("Capped"),
          description: "",
          priority: "low",
          status: "to-do",
        },
      }),
      403,
    );
    await expectStatus(
      await owner.patch(
        `/api/project/${restricted.id}/access/members/${memberId}`,
        { data: { role: "no-such-role" } },
      ),
      400,
    );
    await expectStatus(
      await owner.patch(
        `/api/project/${restricted.id}/access/members/${world.users.viewer.id}`,
        { data: { role: "member" } },
      ),
      404,
    );

    // Removing them takes access away at once.
    const removed = await expectJson<ProjectAccess>(
      await owner.delete(
        `/api/project/${restricted.id}/access/members/${memberId}`,
      ),
    );
    expect(removed.members.map((m) => m.userId)).not.toContain(memberId);
    expect(await reach("member")).toEqual([404, 404]);
    await expectStatus(
      await owner.delete(
        `/api/project/${restricted.id}/access/members/${memberId}`,
      ),
      404,
    );

    // Opening it again: workspace roles count again, the list is kept.
    const reopened = await expectJson<ProjectAccess>(
      await owner.put(`/api/project/${restricted.id}/access/visibility`, {
        data: { visibility: "open" },
      }),
    );
    expect(reopened.visibility).toBe("open");
    expect(reopened.members.map((m) => m.userId)).toContain(
      world.users.owner.id,
    );
    expect(await reach("member")).toEqual([200, 200]);
    expect(await reach("viewer")).toEqual([200, 200]);
  },
);

test("project access: unknown ids, anonymous and outsiders", async () => {
  const owner = world.as("owner");
  const memberId = world.users.member.id;
  await expectStatus(await access("owner", UNKNOWN_ID), 404);
  await expectStatus(
    await owner.put(`/api/project/${UNKNOWN_ID}/access/visibility`, {
      data: { visibility: "restricted" },
    }),
    404,
  );
  await expectStatus(
    await owner.post(`/api/project/${UNKNOWN_ID}/access/members`, {
      data: { userId: memberId, role: "member" },
    }),
    404,
  );
  await expectStatus(
    await owner.patch(`/api/project/${UNKNOWN_ID}/access/members/${memberId}`, {
      data: { role: "viewer" },
    }),
    404,
  );
  await expectStatus(
    await owner.delete(`/api/project/${UNKNOWN_ID}/access/members/${memberId}`),
    404,
  );
  await expectStatus(await access("anonymous", restricted.id), 401);
  await expectStatus(
    await outsider.ctx.get(`/api/project/${restricted.id}/access`),
    403,
  );
});

test(
  "task templates: create, list, update, apply and delete",
  covers(
    "listTaskTemplates",
    "createTaskTemplate",
    "updateTaskTemplate",
    "deleteTaskTemplate",
    "applyTaskTemplate",
  ),
  async () => {
    const owner = world.as("owner");
    const name = uniqueName("Bug report");
    const created = await expectJson<TaskTemplate>(
      await owner.post("/api/task-template", {
        data: {
          projectId: work.id,
          name,
          titlePattern: "Bug: {title}",
          description: "Steps to reproduce",
          priority: "high",
          assigneeIds: [world.users.member.id],
          subtasks: ["Reproduce", "Fix"],
        },
      }),
    );
    expect(created).toMatchObject({
      projectId: work.id,
      name,
      titlePattern: "Bug: {title}",
      description: "Steps to reproduce",
      priority: "high",
      assigneeIds: [world.users.member.id],
      subtasks: ["Reproduce", "Fix"],
      columnId: null,
      labels: [],
    });

    const listed = await expectJson<TaskTemplate[]>(
      await world.as("viewer").get(`/api/task-template/project/${work.id}`),
    );
    expect(listed.map((template) => template.id)).toContain(created.id);

    await expectStatus(
      await owner.post("/api/task-template", {
        data: { projectId: work.id, name: name.toUpperCase() },
      }),
      409,
    );
    await expectStatus(
      await world.as("member").post("/api/task-template", {
        data: { projectId: work.id, name: uniqueName("Member template") },
      }),
      403,
    );
    await expectStatus(
      await owner.post("/api/task-template", {
        data: { projectId: work.id, name: uniqueName("Bad"), columnId: "nope" },
      }),
      400,
    );
    await expectStatus(
      await owner.post("/api/task-template", {
        data: { projectId: UNKNOWN_ID, name: uniqueName("Ghost") },
      }),
      400,
    );
    await expectStatus(
      await owner.get(`/api/task-template/project/${UNKNOWN_ID}`),
      400,
    );

    const renamed = `${name} v2`;
    const updated = await expectJson<TaskTemplate>(
      await owner.patch(`/api/task-template/${created.id}`, {
        data: { name: renamed, priority: "urgent" },
      }),
    );
    expect(updated).toMatchObject({
      id: created.id,
      name: renamed,
      priority: "urgent",
      subtasks: ["Reproduce", "Fix"],
    });
    await expectStatus(
      await owner.patch(`/api/task-template/${created.id}`, { data: {} }),
      400,
    );
    await expectStatus(
      await world.as("member").patch(`/api/task-template/${created.id}`, {
        data: { name: "Not mine" },
      }),
      403,
    );
    await expectStatus(
      await owner.patch(`/api/task-template/${UNKNOWN_ID}`, {
        data: { name: "Ghost" },
      }),
      404,
    );

    const task = await expectJson<
      Task & { subtaskIds: string[]; assigneeIds: string[] }
    >(
      await world.as("member").post(`/api/task-template/${created.id}/apply`, {
        data: { title: "Login fails" },
      }),
    );
    expect(task).toMatchObject({
      projectId: work.id,
      title: "Bug: Login fails",
      priority: "urgent",
    });
    expect(task.subtaskIds).toHaveLength(2);
    const fetched = await expectJson<Task & { description: string }>(
      await world.as("viewer").get(`/api/task/${task.id}`),
    );
    expect(fetched.title).toBe("Bug: Login fails");
    expect(fetched.description).toContain("Steps to reproduce");

    await expectStatus(
      await world.as("viewer").post(`/api/task-template/${created.id}/apply`, {
        data: { title: "Viewer" },
      }),
      403,
    );
    await expectStatus(
      await world.as("member").post(`/api/task-template/${created.id}/apply`, {
        data: { title: "Wrong column", status: "no-such-column" },
      }),
      400,
    );
    await expectStatus(
      await world.as("member").post(`/api/task-template/${UNKNOWN_ID}/apply`, {
        data: { title: "Ghost" },
      }),
      404,
    );
    await expectStatus(
      await world
        .as("anonymous")
        .post(`/api/task-template/${created.id}/apply`, {
          data: { title: "Anon" },
        }),
      401,
    );

    await expectStatus(
      await world.as("member").delete(`/api/task-template/${created.id}`),
      403,
    );
    expect(
      await expectJson<{ id: string }>(
        await owner.delete(`/api/task-template/${created.id}`),
      ),
    ).toEqual({ id: created.id });
    const after = await expectJson<TaskTemplate[]>(
      await owner.get(`/api/task-template/project/${work.id}`),
    );
    expect(after.map((template) => template.id)).not.toContain(created.id);
    await expectStatus(
      await owner.delete(`/api/task-template/${created.id}`),
      404,
    );
  },
);

test(
  "task repeat rules: set, read and remove",
  covers("getTaskRecurrence", "setTaskRecurrence", "removeTaskRecurrence"),
  async () => {
    const member = world.as("member");
    const url = `/api/task-recurrence/${workTask.id}`;
    expect(await expectJson(await world.as("viewer").get(url))).toEqual({
      recurrence: null,
    });

    const set = await expectJson<{ recurrence: Recurrence }>(
      await member.put(url, {
        data: { frequency: "weekly", interval: 2, weekdays: [1, 3] },
      }),
    );
    expect(set.recurrence).toMatchObject({
      taskId: workTask.id,
      frequency: "weekly",
      interval: 2,
      weekdays: [1, 3],
      monthDay: null,
      trigger: "completion",
      endDate: null,
      maxOccurrences: null,
      occurrenceCount: 1,
    });
    expect(set.recurrence.anchorDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const read = await expectJson<{ recurrence: Recurrence }>(
      await world.as("viewer").get(url),
    );
    expect(read.recurrence).toMatchObject({ frequency: "weekly", interval: 2 });

    const replaced = await expectJson<{ recurrence: Recurrence }>(
      await member.put(url, {
        data: { frequency: "monthly", monthDay: 15, maxOccurrences: 6 },
      }),
    );
    expect(replaced.recurrence).toMatchObject({
      frequency: "monthly",
      monthDay: 15,
      weekdays: [],
      maxOccurrences: 6,
    });

    await expectStatus(
      await member.put(url, { data: { frequency: "daily", weekdays: [1] } }),
      400,
    );
    await expectStatus(
      await member.put(url, {
        data: {
          frequency: "daily",
          endDate: "2032-01-01",
          maxOccurrences: 3,
        },
      }),
      400,
    );
    await expectStatus(
      await world.as("viewer").put(url, { data: { frequency: "daily" } }),
      403,
    );
    await expectStatus(await world.as("viewer").delete(url), 403);
    await expectStatus(await world.as("anonymous").get(url), 401);

    expect(await expectJson(await member.delete(url))).toEqual({
      recurrence: null,
    });
    expect(await expectJson(await member.get(url))).toEqual({
      recurrence: null,
    });
    // Removing a rule that is not there does nothing.
    expect(await expectJson(await member.delete(url))).toEqual({
      recurrence: null,
    });

    const unknown = `/api/task-recurrence/${UNKNOWN_ID}`;
    await expectStatus(await member.get(unknown), 404);
    await expectStatus(
      await member.put(unknown, { data: { frequency: "daily" } }),
      404,
    );
    await expectStatus(await member.delete(unknown), 404);
  },
);

test(
  "external import: preview and import a Linear CSV export",
  covers("previewExternalImport", "importExternalItems"),
  async () => {
    const project = await createProject(world.as("owner"), world.workspace.id);
    const prefix = uniqueName("Linear");
    const csv = [
      "ID,Title,Status,Priority,Assignee",
      `ENG-1,${prefix} first,To Do,High,${world.users.member.email}`,
      `ENG-2,${prefix} second,Done,Low,ghost@nowhere.test`,
    ].join("\n");
    const member = world.as("member");

    const preview = await expectJson<{
      source: string;
      itemCount: number;
      statuses: { name: string; count: number; suggestedStatus: string }[];
      priorities: { name: string; suggestedPriority: string }[];
      people: { name: string; member: { id: string; name: string } | null }[];
      totals: { alreadyImported: number };
      permissions: { update: boolean; comments: boolean };
    }>(
      await member.post(`/api/external-import/linear/${project.id}/preview`, {
        data: { content: csv },
      }),
    );
    expect(preview).toMatchObject({ source: "linear", itemCount: 2 });
    expect(preview.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "To Do", suggestedStatus: "to-do" }),
        expect.objectContaining({ name: "Done", suggestedStatus: "done" }),
      ]),
    );
    expect(preview.priorities).toEqual(
      expect.arrayContaining([
        { name: "High", count: 1, suggestedPriority: "high" },
        { name: "Low", count: 1, suggestedPriority: "low" },
      ]),
    );
    const matched = preview.people.find(
      (person) => person.name === world.users.member.email,
    );
    expect(matched?.member?.id).toBe(world.users.member.id);
    expect(
      preview.people.find((person) => person.name === "ghost@nowhere.test")
        ?.member,
    ).toBeNull();
    // A member may import but not post comments as other authors.
    expect(preview.permissions).toEqual({ update: true, comments: false });
    expect(preview.totals.alreadyImported).toBe(0);
    // The preview never reveals member emails.
    expect(JSON.stringify(preview.people)).not.toContain(
      world.users.viewer.email,
    );

    const result = await expectJson<{
      total: number;
      created: number;
      skipped: number;
      failed: number;
      unmatchedPeople: string[];
    }>(
      await member.post(`/api/external-import/linear/${project.id}`, {
        data: { content: csv },
      }),
    );
    expect(result).toMatchObject({ total: 2, created: 2, failed: 0 });
    expect(result.unmatchedPeople).toEqual(["ghost@nowhere.test"]);

    const board = await expectJson<Board>(
      await world.as("viewer").get(`/api/task/tasks/${project.id}`),
    );
    const titles = board.data.columns.flatMap((column) =>
      column.tasks.map((task) => task.title),
    );
    expect(titles).toEqual(
      expect.arrayContaining([`${prefix} first`, `${prefix} second`]),
    );

    // A re-run skips what came in before.
    const again = await expectJson<{ created: number; skipped: number }>(
      await member.post(`/api/external-import/linear/${project.id}`, {
        data: { content: csv },
      }),
    );
    expect(again).toMatchObject({ created: 0, skipped: 2 });

    await expectStatus(
      await member.post(`/api/external-import/linear/${project.id}/preview`, {
        data: { content: "just,some\nother,csv" },
      }),
      400,
    );
    await expectStatus(
      await member.post(`/api/external-import/trello/${project.id}/preview`, {
        data: { content: "{not json" },
      }),
      400,
    );
    await expectStatus(
      await world
        .as("viewer")
        .post(`/api/external-import/linear/${project.id}/preview`, {
          data: { content: csv },
        }),
      403,
    );
    await expectStatus(
      await world
        .as("viewer")
        .post(`/api/external-import/linear/${project.id}`, {
          data: { content: csv },
        }),
      403,
    );
    await expectStatus(
      await world
        .as("anonymous")
        .post(`/api/external-import/linear/${project.id}`, {
          data: { content: csv },
        }),
      401,
    );
  },
);

test(
  "a pending invitation's role can be changed by those who may invite",
  covers("updateInvitationRole"),
  async () => {
    const owner = world.as("owner");
    const invite = async (email: string) =>
      expectJson<{ id: string; role: string }>(
        await owner.post("/api/auth/organization/invite-member", {
          data: {
            email,
            role: "member",
            organizationId: world.workspace.id,
          },
        }),
      );
    const pending = await invite(
      `e2e-invite-${Date.now().toString(36)}@margaya.test`,
    );

    const changed = await expectJson<{
      id: string;
      role: string;
      status: string;
      workspaceId: string;
    }>(
      await world.as("admin").patch(`/api/invitation/${pending.id}/role`, {
        data: { role: "viewer" },
      }),
    );
    expect(changed).toMatchObject({
      id: pending.id,
      role: "viewer",
      status: "pending",
      workspaceId: world.workspace.id,
    });

    await expectStatus(
      await world.as("member").patch(`/api/invitation/${pending.id}/role`, {
        data: { role: "admin" },
      }),
      403,
    );
    await expectStatus(
      await outsider.ctx.patch(`/api/invitation/${pending.id}/role`, {
        data: { role: "admin" },
      }),
      403,
    );
    await expectStatus(
      await world.as("anonymous").patch(`/api/invitation/${pending.id}/role`, {
        data: { role: "admin" },
      }),
      401,
    );
    await expectStatus(
      await owner.patch(`/api/invitation/${pending.id}/role`, {
        data: { role: "no-such-role" },
      }),
      400,
    );
    await expectStatus(
      await owner.patch(`/api/invitation/${pending.id}/role`, {
        data: { role: "" },
      }),
      400,
    );
    await expectStatus(
      await owner.patch(`/api/invitation/${UNKNOWN_ID}/role`, {
        data: { role: "viewer" },
      }),
      404,
    );

    // Once accepted, the invitation is no longer pending.
    const joiner = await signUpUser("Access joiner");
    try {
      const accepted = await invite(joiner.email);
      await expectJson(
        await joiner.ctx.post("/api/auth/organization/accept-invitation", {
          data: { invitationId: accepted.id },
        }),
      );
      await expectStatus(
        await owner.patch(`/api/invitation/${accepted.id}/role`, {
          data: { role: "viewer" },
        }),
        409,
      );
    } finally {
      await joiner.ctx.dispose();
    }
  },
);

test(
  "user preferences are stored per user and merged on update",
  covers("getUserPreferences", "updateUserPreferences"),
  async () => {
    // A throwaway account: never change a seeded user's preferences.
    const user = await signUpUser("Prefs");
    try {
      expect(
        await expectJson(await user.ctx.get("/api/user/preferences")),
      ).toEqual({ preferences: null });

      const first = await expectJson<{ preferences: Record<string, unknown> }>(
        await user.ctx.patch("/api/user/preferences", {
          data: {
            theme: "dark",
            weekStartsOn: 1,
            sidebarLayout: {
              railOrder: ["projects", "home"],
              railHidden: ["analytics"],
              panelOrder: ["favorites"],
              panelHidden: [],
            },
          },
        }),
      );
      expect(first.preferences).toMatchObject({
        theme: "dark",
        weekStartsOn: 1,
        sidebarLayout: { railOrder: ["projects", "home"] },
      });

      // Keys left out keep their stored value.
      const second = await expectJson<{ preferences: Record<string, unknown> }>(
        await user.ctx.patch("/api/user/preferences", {
          data: { showLabels: false, sidebarLayout: null },
        }),
      );
      expect(second.preferences).toMatchObject({
        theme: "dark",
        weekStartsOn: 1,
        showLabels: false,
      });
      expect(second.preferences.sidebarLayout ?? null).toBeNull();

      const read = await expectJson<{ preferences: Record<string, unknown> }>(
        await user.ctx.get("/api/user/preferences"),
      );
      expect(read.preferences).toMatchObject({
        theme: "dark",
        showLabels: false,
      });
      // Preferences are per user.
      expect(
        await expectJson(await world.as("viewer").get("/api/user/preferences")),
      ).toEqual({ preferences: null });

      await expectStatus(
        await user.ctx.patch("/api/user/preferences", {
          data: { notAPreference: true },
        }),
        400,
      );
      await expectStatus(
        await user.ctx.patch("/api/user/preferences", {
          data: { theme: "neon" },
        }),
        400,
      );
      await expectStatus(
        await user.ctx.patch("/api/user/preferences", {
          data: { weekStartsOn: 3 },
        }),
        400,
      );
      await expectStatus(
        await world.as("anonymous").get("/api/user/preferences"),
        401,
      );
      await expectStatus(
        await world
          .as("anonymous")
          .patch("/api/user/preferences", { data: { theme: "light" } }),
        401,
      );
    } finally {
      await user.ctx.dispose();
    }
  },
);

// Kept last: the files run serially, so a failure here skips nothing else.
test("external import answers 404 for an unknown project", async () => {
  const member = world.as("member");
  const content = "ID,Title,Status\nENG-1,Ghost,To Do";
  await expectStatus(
    await member.post(`/api/external-import/linear/${UNKNOWN_ID}/preview`, {
      data: { content },
    }),
    404,
  );
  await expectStatus(
    await member.post(`/api/external-import/linear/${UNKNOWN_ID}`, {
      data: { content },
    }),
    404,
  );
});
