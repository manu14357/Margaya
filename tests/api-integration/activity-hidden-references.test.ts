import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAiGatewayState,
  setAiProviderFactory,
} from "../../apps/api/src/ai/gateway";
import { setFakeResponder } from "../../apps/api/src/ai/provider/fake";
import type { ChatRequest } from "../../apps/api/src/ai/types";
import { saveWorkspaceAiSettings } from "../../apps/api/src/ai/workspace-settings";
import { taskHistoryLines } from "../../apps/api/src/ai-writing/task-summary";
import { encodeScope } from "../../apps/api/src/api-key/scope";
import db, { schema } from "../../apps/api/src/database";
import {
  cycleTable,
  cycleTaskTable,
  moduleTable,
  moduleTaskTable,
  projectMemberTable,
} from "../../apps/api/src/database/schema";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { createApiKey } from "./helpers/api-keys";
import { addPerson } from "./helpers/assignees";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  activityRows,
  json,
  settledActivity,
  taskDetailScene,
} from "./helpers/task-detail";

// Activity rows keep snapshots of other tasks and projects: keys, titles, ids
// and names. Whoever can't see the project a snapshot names must not read it,
// from any reader, and stored rows stay whole for those who can.

const HIDDEN_TITLE = "Zebracorn acquisition";
const HIDDEN_PROJECT = "Narwhal vault";
const HIDDEN_SLUG = "nrw";

type Row = {
  id: string;
  type: string;
  eventData: Record<string, unknown>;
};
type Request = (path: string, init?: RequestInit) => Promise<Response>;

async function scene() {
  const s = await taskDetailScene();
  const { project: secret } = await createProjectFixture({
    workspaceId: s.workspace.id,
    name: HIDDEN_PROJECT,
    slug: HIDDEN_SLUG,
  });
  await db
    .update(schema.projectTable)
    .set({ visibility: "restricted" })
    .where(eq(schema.projectTable.id, secret.id));

  // Alice is in the restricted project, Bob and the guest are not.
  const alice = await addPerson(s.workspace.id, "Alice");
  const bob = await addPerson(s.workspace.id, "Bob");
  const guest = await addPerson(s.workspace.id, "Gus", "guest");
  await db.insert(projectMemberTable).values({
    projectId: secret.id,
    userId: alice.id,
    role: "member",
  });
  const added = await s.as(s.admin)(
    `/project/${s.project.id}/access/members`,
    json("POST", { userId: guest.id, role: "viewer" }),
  );
  expect(added.status, await added.clone().text()).toBe(200);

  // Limited to the open project; its owner can see everything.
  const key = await createApiKey(
    s.admin,
    encodeScope({ access: "full", projectIds: [s.project.id] }) ?? undefined,
  );
  const withKey: Request = (path, init = {}) =>
    s.app.request(`/api${path}`, {
      ...init,
      headers: { ...init.headers, ...key.headers },
    });

  const outsiders: [string, Request][] = [
    ["a member outside the project", s.as(bob)],
    ["a guest", s.as(guest)],
    ["a project-limited API key", withKey],
  ];
  const insiders: [string, Request][] = [
    ["a workspace admin", s.as(s.admin)],
    ["a project member", s.as(alice)],
  ];

  const hiddenTask = await s.createTask({
    projectId: secret.id,
    title: HIDDEN_TITLE,
  });

  /** Everything that would identify the hidden project and task. */
  const expectNoTrace = (text: string, who: string) => {
    for (const trace of [
      "Zebracorn",
      "zebracorn",
      "Narwhal",
      `${HIDDEN_SLUG.toUpperCase()}-`,
      secret.id,
      hiddenTask.id,
    ]) {
      expect(text, `${who} reads ${trace}`).not.toContain(trace);
    }
  };

  return {
    ...s,
    secret,
    alice,
    bob,
    guest,
    key,
    outsiders,
    insiders,
    hiddenTask,
    expectNoTrace,
  };
}

async function feed(request: Request, taskId: string) {
  const response = await request(`/activity/${taskId}`);
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return { text, rows: JSON.parse(text) as Row[] };
}

type SearchJson = {
  results: { type: string; content?: string; taskId?: string }[];
};

async function searchActivities(
  request: Request,
  workspaceId: string,
  q: string,
  type = "activities",
) {
  const response = await request(
    `/search?q=${encodeURIComponent(q)}&type=${type}&workspaceId=${workspaceId}&limit=50`,
  );
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return { text, body: JSON.parse(text) as SearchJson };
}

async function hiddenPlanning(projectId: string, taskId?: string) {
  const [cycle] = await db
    .insert(cycleTable)
    .values({ projectId, name: "Zebracorn sprint" })
    .returning();
  const [module] = await db
    .insert(moduleTable)
    .values({ projectId, name: "Zebracorn module" })
    .returning();
  if (!cycle || !module) throw new Error("Failed to seed planning");
  if (taskId) {
    await db.insert(cycleTaskTable).values({ taskId, cycleId: cycle.id });
    await db.insert(moduleTaskTable).values({ taskId, moduleId: module.id });
  }
  return { cycle, module };
}

function ofType(rows: Row[], type: string) {
  return rows.filter((row) => row.type === type);
}

function storedData(rows: Awaited<ReturnType<typeof activityRows>>) {
  return rows.map((row) => row.eventData);
}

const HIDDEN_OTHER = {
  otherTaskId: null,
  otherTaskKey: null,
  otherTaskTitle: null,
  otherProjectId: null,
  otherTaskHidden: true,
};

const HIDDEN_PARENT = {
  id: null,
  key: null,
  title: null,
  projectId: null,
  hidden: true,
};

beforeEach(async () => {
  await resetTestDatabase();
});

describe("activity feed: references to projects the reader can't see", () => {
  it("redacts both sides of a relation, also after the link is removed", async () => {
    const s = await scene();
    const visible = await s.createTask({ title: "Visible task" });
    const created = await s.as(s.alice)(
      "/task-relation",
      json("POST", {
        sourceTaskId: s.hiddenTask.id,
        targetTaskId: visible.id,
        relationType: "blocking",
      }),
    );
    expect(created.status, await created.clone().text()).toBe(200);
    const relation = (await created.json()) as { id: string };
    await settledActivity(visible.id, "relation_added");
    const removed = await s.as(s.alice)(`/task-relation/${relation.id}`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
    await settledActivity(visible.id, "relation_removed");

    const stored = await activityRows(visible.id, "relation_added");
    expect(stored[0]?.eventData).toMatchObject({
      otherTaskId: s.hiddenTask.id,
      otherTaskKey: `NRW-${s.hiddenTask.number}`,
      otherTaskTitle: HIDDEN_TITLE,
      otherProjectId: s.secret.id,
    });

    for (const [who, request] of s.outsiders) {
      const { text, rows } = await feed(request, visible.id);
      s.expectNoTrace(text, who);
      expect(ofType(rows, "relation_added")[0]?.eventData, who).toEqual({
        relation: "blocked_by",
        ...HIDDEN_OTHER,
      });
      expect(ofType(rows, "relation_removed")[0]?.eventData, who).toEqual({
        relation: "blocked_by",
        ...HIDDEN_OTHER,
      });
    }

    for (const [who, request] of s.insiders) {
      const { rows } = await feed(request, visible.id);
      expect(ofType(rows, "relation_added")[0]?.eventData, who).toEqual(
        stored[0]?.eventData,
      );
      expect(ofType(rows, "relation_removed")[0]?.eventData, who).toMatchObject(
        { otherTaskTitle: HIDDEN_TITLE },
      );
    }

    // The read changed nothing.
    expect(
      storedData(await activityRows(visible.id, "relation_added")),
    ).toEqual(storedData(stored));
  });

  it("leaves references to projects the reader can see alone", async () => {
    const s = await scene();
    const a = await s.createTask({ title: "Alpha" });
    const b = await s.createTask({ title: "Bravo" });
    await s.as(s.alice)(
      "/task-relation",
      json("POST", {
        sourceTaskId: a.id,
        targetTaskId: b.id,
        relationType: "related",
      }),
    );
    await settledActivity(b.id, "relation_added");
    for (const [who, request] of s.outsiders) {
      const { rows } = await feed(request, b.id);
      expect(ofType(rows, "relation_added")[0]?.eventData, who).toEqual({
        relation: "related",
        otherTaskId: a.id,
        otherTaskKey: `WEB-${a.number}`,
        otherTaskTitle: "Alpha",
        otherProjectId: a.projectId,
      });
    }
  });

  it("redacts the hidden side of a moved row, with its project and status", async () => {
    const s = await scene();
    const task = await s.createTask({ title: "Travelling task" });
    const move = (destinationProjectId: string) =>
      s.as(s.admin)(
        `/task/move/${task.id}`,
        json("PUT", { destinationProjectId }),
      );
    expect((await move(s.secret.id)).status).toBe(200);
    await settledActivity(task.id, "moved");
    const { cycle, module } = await hiddenPlanning(s.secret.id, task.id);
    expect((await move(s.project.id)).status).toBe(200);
    const stored = await settledActivity(task.id, "moved", 2);
    await settledActivity(task.id, "cycle_changed");
    await settledActivity(task.id, "module_removed");
    expect(stored[0]?.eventData).toMatchObject({
      toProjectId: s.secret.id,
      toProjectName: HIDDEN_PROJECT,
    });

    const intoHidden = {
      fromProjectId: s.project.id,
      fromProjectName: s.project.name,
      toProjectId: null,
      toProjectName: null,
      toProjectHidden: true,
      oldStatus: "to-do",
      newStatus: null,
    };
    const outOfHidden = {
      fromProjectId: null,
      fromProjectName: null,
      fromProjectHidden: true,
      toProjectId: s.project.id,
      toProjectName: s.project.name,
      oldStatus: null,
      newStatus: "to-do",
    };
    for (const [who, request] of s.outsiders) {
      const { text, rows } = await feed(request, task.id);
      s.expectNoTrace(text, who);
      // Newest first.
      expect(
        ofType(rows, "moved").map((row) => row.eventData),
        who,
      ).toEqual([outOfHidden, intoHidden]);

      // The move also takes the task out of the cycle and module it left.
      expect(text, who).not.toContain(cycle.id);
      expect(text, who).not.toContain(module.id);
      expect(ofType(rows, "cycle_changed")[0]?.eventData, who).toEqual({
        oldCycleId: null,
        oldCycleName: null,
        oldCycleProjectId: null,
        oldCycleHidden: true,
        newCycleId: null,
        newCycleName: null,
        newCycleProjectId: null,
      });
      expect(ofType(rows, "module_removed")[0]?.eventData, who).toEqual({
        moduleId: null,
        moduleName: null,
        moduleProjectId: null,
        moduleHidden: true,
      });
    }
    for (const [who, request] of s.insiders) {
      const { rows } = await feed(request, task.id);
      expect(ofType(rows, "moved")[0]?.eventData, who).toMatchObject({
        fromProjectId: s.secret.id,
        fromProjectName: HIDDEN_PROJECT,
      });
      expect(ofType(rows, "cycle_changed")[0]?.eventData, who).toMatchObject({
        oldCycleId: cycle.id,
        oldCycleName: "Zebracorn sprint",
        oldCycleProjectId: s.secret.id,
      });
      expect(ofType(rows, "module_removed")[0]?.eventData, who).toEqual({
        moduleId: module.id,
        moduleName: "Zebracorn module",
        moduleProjectId: s.secret.id,
      });
    }

    // Search reads the same text: no match for them, a match for insiders.
    for (const request of [s.as(s.bob), s.as(s.guest)]) {
      const { body } = await searchActivities(
        request,
        s.workspace.id,
        "Zebracorn",
      );
      expect(body.results).toEqual([]);
    }
    for (const [who, request] of s.insiders) {
      const { body } = await searchActivities(
        request,
        s.workspace.id,
        "Zebracorn",
      );
      expect(
        body.results.map((hit) => hit.taskId),
        who,
      ).toContain(task.id);
    }
  });

  it("resolves cycle and module rows that store no project, or hides them", async () => {
    const s = await scene();
    const task = await s.createTask({ title: "Planned task" });
    const secret = await hiddenPlanning(s.secret.id);
    const [openCycle] = await db
      .insert(cycleTable)
      .values({ projectId: s.project.id, name: "Open sprint" })
      .returning();
    const [openModule] = await db
      .insert(moduleTable)
      .values({ projectId: s.project.id, name: "Open module" })
      .returning();
    if (!openCycle || !openModule) throw new Error("Failed to seed");
    const row = (type: string, eventData: Record<string, unknown>) => ({
      taskId: task.id,
      type,
      userId: s.admin.id,
      eventData,
    });
    // Written before rows stored their project.
    await db.insert(schema.activityTable).values([
      row("cycle_changed", {
        oldCycleId: secret.cycle.id,
        oldCycleName: "Zebracorn sprint",
        newCycleId: openCycle.id,
        newCycleName: "Open sprint",
      }),
      row("cycle_changed", {
        oldCycleId: "purged-cycle",
        oldCycleName: "Purged sprint",
        newCycleId: null,
        newCycleName: null,
      }),
      row("module_added", {
        moduleId: secret.module.id,
        moduleName: "Zebracorn module",
      }),
      row("module_added", {
        moduleId: openModule.id,
        moduleName: "Open module",
      }),
      row("module_removed", {
        moduleId: "purged-module",
        moduleName: "Purged module",
      }),
    ]);

    const cycleRow = (rows: Row[], newCycleId: string | null) =>
      ofType(rows, "cycle_changed").find(
        (one) => one.eventData.newCycleId === newCycleId,
      )?.eventData;
    const addedModules = (rows: Row[]) =>
      ofType(rows, "module_added").map((one) => one.eventData);
    const HIDDEN_MODULE = {
      moduleId: null,
      moduleName: null,
      moduleProjectId: null,
      moduleHidden: true,
    };

    for (const [who, request] of s.outsiders) {
      const { text, rows } = await feed(request, task.id);
      s.expectNoTrace(text, who);
      expect(text, who).not.toContain(secret.cycle.id);
      expect(text, who).not.toContain(secret.module.id);
      expect(cycleRow(rows, openCycle.id), who).toEqual({
        oldCycleId: null,
        oldCycleName: null,
        oldCycleProjectId: null,
        oldCycleHidden: true,
        newCycleId: openCycle.id,
        newCycleName: "Open sprint",
      });
      expect(addedModules(rows), who).toEqual(
        expect.arrayContaining([
          HIDDEN_MODULE,
          { moduleId: openModule.id, moduleName: "Open module" },
        ]),
      );
    }

    // Someone who can see the project still reads its name.
    for (const [who, request] of s.insiders) {
      const { rows } = await feed(request, task.id);
      expect(cycleRow(rows, openCycle.id), who).toMatchObject({
        oldCycleId: secret.cycle.id,
        oldCycleName: "Zebracorn sprint",
      });
      expect(addedModules(rows), who).toContainEqual({
        moduleId: secret.module.id,
        moduleName: "Zebracorn module",
      });
    }

    // A purged cycle or module can't be traced, so nobody reads it.
    for (const [who, request] of [...s.insiders, ...s.outsiders]) {
      const { text, rows } = await feed(request, task.id);
      expect(text, who).not.toContain("Purged");
      expect(text, who).not.toContain("purged-");
      expect(cycleRow(rows, null), who).toMatchObject({
        oldCycleName: null,
        oldCycleHidden: true,
      });
      expect(ofType(rows, "module_removed")[0]?.eventData, who).toEqual(
        HIDDEN_MODULE,
      );
    }

    const hits = async (request: Request, q: string) =>
      (await searchActivities(request, s.workspace.id, q)).body.results.map(
        (hit) => hit.taskId,
      );
    for (const request of [s.as(s.bob), s.as(s.guest)]) {
      expect(await hits(request, "Zebracorn")).toEqual([]);
      expect(await hits(request, "Purged")).toEqual([]);
      expect(await hits(request, "Open sprint")).toContain(task.id);
    }
    expect(await hits(s.as(s.admin), "Zebracorn")).toContain(task.id);
    expect(await hits(s.as(s.admin), "Purged")).toEqual([]);
  });

  it("keeps a deleted cycle's and module's names for rows that store their project", async () => {
    const s = await scene();
    const task = await s.createTask({ title: "Planned task" });
    const [cycle] = await db
      .insert(cycleTable)
      .values({ projectId: s.project.id, name: "Open sprint" })
      .returning();
    const [module] = await db
      .insert(moduleTable)
      .values({ projectId: s.project.id, name: "Open module" })
      .returning();
    if (!cycle || !module) throw new Error("Failed to seed");
    await db
      .insert(cycleTaskTable)
      .values({ taskId: task.id, cycleId: cycle.id });
    await db
      .insert(moduleTaskTable)
      .values({ taskId: task.id, moduleId: module.id });
    const deletedCycle = await s.as(s.admin)(`/cycle/${cycle.id}`, {
      method: "DELETE",
    });
    expect(deletedCycle.status, await deletedCycle.clone().text()).toBe(200);
    const deletedModule = await s.as(s.admin)(`/module/${module.id}`, {
      method: "DELETE",
    });
    expect(deletedModule.status, await deletedModule.clone().text()).toBe(200);

    const { rows } = await feed(s.as(s.bob), task.id);
    expect(ofType(rows, "cycle_changed")[0]?.eventData).toEqual({
      oldCycleId: cycle.id,
      oldCycleName: "Open sprint",
      oldCycleProjectId: s.project.id,
      newCycleId: null,
      newCycleName: null,
      newCycleProjectId: null,
      reason: "cycle_deleted",
    });
    expect(ofType(rows, "module_removed")[0]?.eventData).toEqual({
      moduleId: module.id,
      moduleName: "Open module",
      moduleProjectId: s.project.id,
      reason: "module_deleted",
    });
  });

  it("redacts what a task's own rows say about the project it left", async () => {
    const s = await scene();
    const task = await s.createTask({
      projectId: s.secret.id,
      title: "Travelling task",
    });
    const row = (
      type: string,
      eventData: Record<string, unknown>,
      userId: string | null = s.admin.id,
    ) => ({ taskId: task.id, type, userId, eventData });
    const before = [
      row("status_changed", {
        oldStatus: "to-do",
        newStatus: "zebracorn-review",
      }),
      row("intake_accepted", {
        columnName: "Zebracorn intake",
        status: "zebracorn-intake",
      }),
      row("intake_duplicate", {
        duplicateOfTaskId: s.hiddenTask.id,
        duplicateKey: `NRW-${s.hiddenTask.number}`,
        duplicateTitle: HIDDEN_TITLE,
        note: "Same request",
      }),
      row(
        "label_added",
        {
          name: "bug",
          color: "red",
          automation: {
            rule: "custom",
            ruleId: "rule-hidden",
            ruleName: "Zebracorn rule",
          },
        },
        null,
      ),
    ];
    await db.insert(schema.activityTable).values(before);
    const moved = await s.as(s.admin)(
      `/task/move/${task.id}`,
      json("PUT", { destinationProjectId: s.project.id }),
    );
    expect(moved.status).toBe(200);
    await settledActivity(task.id, "moved");
    // Written in the project the task is in now: nothing to hide.
    await db.insert(schema.activityTable).values([
      row("status_changed", { oldStatus: "to-do", newStatus: "in-progress" }),
      row(
        "label_removed",
        {
          name: "bug",
          color: "red",
          automation: {
            rule: "custom",
            ruleId: "rule-open",
            ruleName: "Open rule",
          },
        },
        null,
      ),
    ]);

    const statusRows = (rows: Row[]) =>
      ofType(rows, "status_changed").map((one) => one.eventData);
    for (const [who, request] of s.outsiders) {
      const { text, rows } = await feed(request, task.id);
      s.expectNoTrace(text, who);
      expect(text, who).not.toContain("rule-hidden");
      expect(statusRows(rows), who).toEqual(
        expect.arrayContaining([
          { oldStatus: null, newStatus: null, statusHidden: true },
          { oldStatus: "to-do", newStatus: "in-progress" },
        ]),
      );
      expect(ofType(rows, "intake_accepted")[0]?.eventData, who).toEqual({
        columnName: null,
        status: null,
        columnHidden: true,
      });
      expect(ofType(rows, "intake_duplicate")[0]?.eventData, who).toEqual({
        duplicateOfTaskId: null,
        duplicateKey: null,
        duplicateTitle: null,
        duplicateHidden: true,
        note: "Same request",
      });
      expect(ofType(rows, "label_added")[0]?.eventData, who).toEqual({
        name: "bug",
        color: "red",
        automation: {
          rule: "custom",
          ruleId: null,
          ruleName: null,
          hidden: true,
        },
      });
      expect(ofType(rows, "label_removed")[0]?.eventData, who).toMatchObject({
        automation: { ruleId: "rule-open", ruleName: "Open rule" },
      });
    }

    for (const [who, request] of s.insiders) {
      const { rows } = await feed(request, task.id);
      expect(statusRows(rows), who).toContainEqual(before[0]?.eventData);
      expect(ofType(rows, "intake_accepted")[0]?.eventData, who).toEqual(
        before[1]?.eventData,
      );
      expect(ofType(rows, "intake_duplicate")[0]?.eventData, who).toEqual(
        before[2]?.eventData,
      );
      expect(ofType(rows, "label_added")[0]?.eventData, who).toEqual(
        before[3]?.eventData,
      );
    }

    for (const request of [s.as(s.bob), s.as(s.guest)]) {
      for (const q of ["zebracorn", "Zebracorn rule", "NRW"]) {
        const { body } = await searchActivities(request, s.workspace.id, q);
        expect(body.results, q).toEqual([]);
      }
      const { text, body } = await searchActivities(
        request,
        s.workspace.id,
        "Travelling",
      );
      s.expectNoTrace(text, "the searcher");
      expect(body.results.map((hit) => hit.content)).toContain(
        "changed status in another project",
      );
    }
    const { body } = await searchActivities(
      s.as(s.alice),
      s.workspace.id,
      "zebracorn",
    );
    expect(body.results.map((hit) => hit.taskId)).toContain(task.id);
  });

  it("redacts the project a copied project's tasks came from", async () => {
    const s = await scene();
    const task = await s.createTask({ title: "Copied task" });
    await db.insert(schema.activityTable).values({
      taskId: task.id,
      type: "create",
      userId: s.admin.id,
      eventData: { copiedFromProjectId: s.secret.id },
    });
    for (const [who, request] of s.outsiders) {
      const { text, rows } = await feed(request, task.id);
      s.expectNoTrace(text, who);
      expect(ofType(rows, "create")[0]?.eventData, who).toEqual({
        copiedFromProjectId: null,
        copiedFromHidden: true,
      });
    }
    const { rows } = await feed(s.as(s.alice), task.id);
    expect(ofType(rows, "create")[0]?.eventData).toEqual({
      copiedFromProjectId: s.secret.id,
    });
    const { body } = await searchActivities(
      s.as(s.bob),
      s.workspace.id,
      s.secret.id,
    );
    expect(body.results).toEqual([]);
  });

  it("redacts both copy rows", async () => {
    const s = await scene();
    const original = await s.createTask({ title: "Visible original" });
    const copyOut = await s.as(s.admin)(
      `/task-copy/${s.hiddenTask.id}`,
      json("POST", { projectId: s.project.id, title: "Visible copy" }),
    );
    expect(copyOut.status, await copyOut.clone().text()).toBe(200);
    const { task: copy } = (await copyOut.json()) as { task: { id: string } };
    const copyIn = await s.as(s.admin)(
      `/task-copy/${original.id}`,
      json("POST", { projectId: s.secret.id, title: "Zebracorn copy" }),
    );
    expect(copyIn.status, await copyIn.clone().text()).toBe(200);
    const [from] = await settledActivity(copy.id, "copied_from");
    const [to] = await settledActivity(original.id, "copied_to");
    if (!from) throw new Error("no copied_from row");
    expect(from.eventData).toMatchObject({
      sourceTaskTitle: HIDDEN_TITLE,
      sourceProjectId: s.secret.id,
    });
    expect(to?.eventData).toMatchObject({
      copyTaskTitle: "Zebracorn copy",
      copyProjectId: s.secret.id,
    });

    for (const [who, request] of s.outsiders) {
      const onCopy = await feed(request, copy.id);
      s.expectNoTrace(onCopy.text, who);
      expect(ofType(onCopy.rows, "copied_from")[0]?.eventData, who).toEqual({
        sourceTaskId: null,
        sourceTaskKey: null,
        sourceTaskTitle: null,
        sourceProjectId: null,
        sourceTaskHidden: true,
        included: (from.eventData as { included: string[] }).included,
      });
      const onOriginal = await feed(request, original.id);
      s.expectNoTrace(onOriginal.text, who);
      expect(ofType(onOriginal.rows, "copied_to")[0]?.eventData, who).toEqual({
        copyTaskId: null,
        copyTaskKey: null,
        copyTaskTitle: null,
        copyProjectId: null,
        copyTaskHidden: true,
      });
    }
    for (const [who, request] of s.insiders) {
      const onCopy = await feed(request, copy.id);
      expect(ofType(onCopy.rows, "copied_from")[0]?.eventData, who).toEqual(
        from.eventData,
      );
      const onOriginal = await feed(request, original.id);
      expect(ofType(onOriginal.rows, "copied_to")[0]?.eventData, who).toEqual(
        to?.eventData,
      );
    }
  });

  // A parent stays in its child's project, so these rows only name another
  // project once one of the two tasks has moved.
  it("redacts parent rows of a task that moved out of the project", async () => {
    const s = await scene();
    const kid = await s.createTask({
      projectId: s.secret.id,
      title: "Moved child",
    });
    const nextParent = await s.createTask({ title: "Visible parent" });
    const setParent = (parentTaskId: string) =>
      s.as(s.admin)(
        `/task-relation/parent/${kid.id}`,
        json("PUT", { parentTaskId }),
      );
    const first = await setParent(s.hiddenTask.id);
    expect(first.status, await first.clone().text()).toBe(200);
    await settledActivity(kid.id, "parent_changed");
    const moved = await s.as(s.admin)(
      `/task/move/${kid.id}`,
      json("PUT", { destinationProjectId: s.project.id }),
    );
    expect(moved.status, await moved.clone().text()).toBe(200);
    await settledActivity(kid.id, "moved");
    const second = await setParent(nextParent.id);
    expect(second.status, await second.clone().text()).toBe(200);
    await settledActivity(kid.id, "parent_changed", 2);

    const visibleParent = {
      id: nextParent.id,
      key: `WEB-${nextParent.number}`,
      title: "Visible parent",
      projectId: s.project.id,
    };
    for (const [who, request] of s.outsiders) {
      const { text, rows } = await feed(request, kid.id);
      s.expectNoTrace(text, who);
      // Newest first: hidden to visible, then none to hidden.
      expect(
        ofType(rows, "parent_changed").map((row) => row.eventData),
        who,
      ).toEqual([
        { oldParent: HIDDEN_PARENT, newParent: visibleParent },
        { oldParent: null, newParent: HIDDEN_PARENT },
      ]);
    }
    for (const [who, request] of s.insiders) {
      const { rows } = await feed(request, kid.id);
      expect(ofType(rows, "parent_changed")[0]?.eventData, who).toMatchObject({
        oldParent: { id: s.hiddenTask.id, title: HIDDEN_TITLE },
      });
    }
  });

  it("redacts sub-task rows of a parent that moved out of the project", async () => {
    const s = await scene();
    const parent = await s.createTask({
      projectId: s.secret.id,
      title: "Moved parent",
    });
    const setParent = (parentTaskId: string | null) =>
      s.as(s.admin)(
        `/task-relation/parent/${s.hiddenTask.id}`,
        json("PUT", { parentTaskId }),
      );
    const linked = await setParent(parent.id);
    expect(linked.status, await linked.clone().text()).toBe(200);
    await settledActivity(parent.id, "subtask_added");
    const moved = await s.as(s.admin)(
      `/task/move/${parent.id}`,
      json("PUT", { destinationProjectId: s.project.id }),
    );
    expect(moved.status, await moved.clone().text()).toBe(200);
    await settledActivity(parent.id, "moved");
    const unlinked = await setParent(null);
    expect(unlinked.status, await unlinked.clone().text()).toBe(200);
    await settledActivity(parent.id, "subtask_removed");

    for (const [who, request] of s.outsiders) {
      const { text, rows } = await feed(request, parent.id);
      s.expectNoTrace(text, who);
      expect(ofType(rows, "subtask_added")[0]?.eventData, who).toEqual(
        HIDDEN_OTHER,
      );
      expect(ofType(rows, "subtask_removed")[0]?.eventData, who).toEqual(
        HIDDEN_OTHER,
      );
    }
    for (const [who, request] of s.insiders) {
      const { rows } = await feed(request, parent.id);
      expect(ofType(rows, "subtask_added")[0]?.eventData, who).toMatchObject({
        otherTaskId: s.hiddenTask.id,
        otherTaskTitle: HIDDEN_TITLE,
      });
    }
  });

  it("redacts recurrence rows of a task that moved out of the project", async () => {
    const s = await scene();
    const task = await s.createTask({ title: "Repeating task" });
    await db.insert(schema.activityTable).values([
      {
        taskId: task.id,
        type: "recurred_from",
        userId: s.admin.id,
        eventData: {
          sourceTaskId: s.hiddenTask.id,
          sourceTaskKey: `NRW-${s.hiddenTask.number}`,
          sourceTaskTitle: HIDDEN_TITLE,
          projectId: s.secret.id,
          date: "2026-11-01",
          reason: "schedule",
        },
      },
      {
        taskId: task.id,
        type: "recurred_to",
        userId: s.admin.id,
        eventData: {
          nextTaskId: s.hiddenTask.id,
          nextTaskKey: `NRW-${s.hiddenTask.number}`,
          nextTaskTitle: HIDDEN_TITLE,
          projectId: s.secret.id,
          date: "2026-11-01",
          reason: "completion",
        },
      },
    ]);
    for (const [who, request] of s.outsiders) {
      const { text, rows } = await feed(request, task.id);
      s.expectNoTrace(text, who);
      expect(ofType(rows, "recurred_from")[0]?.eventData, who).toEqual({
        sourceTaskId: null,
        sourceTaskKey: null,
        sourceTaskTitle: null,
        projectId: null,
        sourceTaskHidden: true,
        date: "2026-11-01",
        reason: "schedule",
      });
      expect(ofType(rows, "recurred_to")[0]?.eventData, who).toEqual({
        nextTaskId: null,
        nextTaskKey: null,
        nextTaskTitle: null,
        projectId: null,
        nextTaskHidden: true,
        date: "2026-11-01",
        reason: "completion",
      });
    }
    const { rows } = await feed(s.as(s.alice), task.id);
    expect(ofType(rows, "recurred_from")[0]?.eventData).toMatchObject({
      sourceTaskTitle: HIDDEN_TITLE,
    });
  });

  it("fails closed when it can't tell whose project a row names", async () => {
    const s = await scene();
    const foreign = await createWorkspaceMember({ userName: "Foreign" });
    const { project: foreignProject } = await createProjectFixture({
      workspaceId: foreign.workspace.id,
      name: "Foreign project",
      slug: "frn",
    });
    const task = await s.createTask({ title: "Old task" });
    const relation = (eventData: Record<string, unknown>) => ({
      taskId: task.id,
      type: "relation_added",
      userId: s.admin.id,
      eventData: { relation: "related", ...eventData },
    });
    await db.insert(schema.activityTable).values([
      // A legacy link into another workspace.
      relation({
        otherTaskId: "foreign-task",
        otherTaskKey: "FRN-1",
        otherTaskTitle: "Foreign title",
        otherProjectId: foreignProject.id,
      }),
      // A project purged since: its visibility is gone with it.
      relation({
        otherTaskId: "purged-task",
        otherTaskKey: "PRG-1",
        otherTaskTitle: "Purged title",
        otherProjectId: "purged-project",
      }),
      // No project at all.
      relation({ otherTaskKey: "UNK-1", otherTaskTitle: "Unknown title" }),
    ]);
    // Not even a workspace admin reads these.
    const { text, rows } = await feed(s.as(s.admin), task.id);
    for (const trace of [
      "Foreign title",
      "FRN-1",
      foreignProject.id,
      "Purged title",
      "purged-project",
      "Unknown title",
    ]) {
      expect(text).not.toContain(trace);
    }
    for (const row of ofType(rows, "relation_added")) {
      expect(row.eventData).toEqual({ relation: "related", ...HIDDEN_OTHER });
    }
  });
});

describe("member and personal activity lists", () => {
  it("redacts by what the viewer can see, not by what the author could", async () => {
    const s = await scene();
    const visible = await s.createTask({ title: "Visible task" });
    await s.as(s.alice)(
      "/task-relation",
      json("POST", {
        sourceTaskId: s.hiddenTask.id,
        targetTaskId: visible.id,
        relationType: "blocking",
      }),
    );
    await settledActivity(visible.id, "relation_added");

    const list = (request: Request) =>
      request(
        `/activity/member/${s.alice.id}?workspaceId=${s.workspace.id}&limit=50`,
      );
    const asBob = await list(s.as(s.bob));
    const bobText = await asBob.text();
    expect(asBob.status, bobText).toBe(200);
    s.expectNoTrace(bobText, "Bob");
    const bobItems = (JSON.parse(bobText) as { items: Row[] }).items;
    expect(ofType(bobItems, "relation_added")[0]?.eventData).toEqual({
      relation: "blocked_by",
      ...HIDDEN_OTHER,
    });

    const asAlice = await s.as(s.alice)(
      `/activity/mine?workspaceId=${s.workspace.id}&limit=50`,
    );
    const aliceItems = ((await asAlice.json()) as { items: Row[] }).items;
    expect(
      aliceItems.find(
        (item) =>
          item.type === "relation_added" && item.eventData.otherTaskHidden,
      ),
    ).toBeUndefined();
    expect(aliceItems.some((item) => item.type === "relation_added")).toBe(
      true,
    );
  });

  it("redacts someone's own rows once they lose the project", async () => {
    const s = await scene();
    const visible = await s.createTask({ title: "Visible task" });
    await db.insert(projectMemberTable).values({
      projectId: s.secret.id,
      userId: s.bob.id,
      role: "member",
    });
    await s.as(s.bob)(
      "/task-relation",
      json("POST", {
        sourceTaskId: s.hiddenTask.id,
        targetTaskId: visible.id,
        relationType: "blocking",
      }),
    );
    await settledActivity(visible.id, "relation_added");
    await db
      .delete(projectMemberTable)
      .where(eq(projectMemberTable.userId, s.bob.id));

    const mine = await s.as(s.bob)(
      `/activity/mine?workspaceId=${s.workspace.id}&limit=50`,
    );
    const text = await mine.text();
    expect(mine.status, text).toBe(200);
    s.expectNoTrace(text, "Bob");
    const items = (JSON.parse(text) as { items: Row[] }).items;
    expect(ofType(items, "relation_added")[0]?.eventData).toEqual({
      relation: "blocked_by",
      ...HIDDEN_OTHER,
    });
  });
});

describe("search over activity", () => {
  async function searchScene() {
    const s = await scene();
    const visible = await s.createTask({ title: "Visible task" });
    await s.as(s.admin)(
      "/task-relation",
      json("POST", {
        sourceTaskId: s.hiddenTask.id,
        targetTaskId: visible.id,
        relationType: "blocking",
      }),
    );
    await settledActivity(visible.id, "relation_added");
    const moved = await s.createTask({
      projectId: s.secret.id,
      title: "Travelling task",
    });
    const move = await s.as(s.admin)(
      `/task/move/${moved.id}`,
      json("PUT", { destinationProjectId: s.project.id }),
    );
    expect(move.status).toBe(200);
    await settledActivity(moved.id, "moved");
    const search = async (request: Request, q: string, type = "activities") => {
      const response = await request(
        `/search?q=${encodeURIComponent(q)}&type=${type}&workspaceId=${s.workspace.id}&limit=50`,
      );
      const text = await response.text();
      expect(response.status, text).toBe(200);
      return { text, body: JSON.parse(text) as SearchJson };
    };
    return { ...s, visible, moved, search };
  }

  it("doesn't match a row on what the searcher can't see", async () => {
    const s = await searchScene();
    for (const request of [s.as(s.bob), s.as(s.guest)]) {
      for (const q of ["Zebracorn", "Narwhal", HIDDEN_SLUG, s.secret.id]) {
        const { body } = await s.search(request, q);
        expect(body.results, q).toEqual([]);
      }
    }
    // Everything else about the hidden project stays out as well.
    const all = await s.search(s.as(s.bob), "Zebracorn", "all");
    expect(all.body.results).toEqual([]);
  });

  it("doesn't match a cycle, module or status the searcher can't see", async () => {
    const s = await searchScene();
    const task = await s.createTask({
      projectId: s.secret.id,
      title: "Planned task",
    });
    await hiddenPlanning(s.secret.id, task.id);
    await db.insert(schema.activityTable).values({
      taskId: task.id,
      type: "status_changed",
      userId: s.admin.id,
      eventData: { oldStatus: "to-do", newStatus: "okapi-review" },
    });
    const moved = await s.as(s.admin)(
      `/task/move/${task.id}`,
      json("PUT", { destinationProjectId: s.project.id }),
    );
    expect(moved.status).toBe(200);
    await settledActivity(task.id, "moved");

    const hits = async (request: Request, q: string) =>
      (await s.search(request, q)).body.results.map((hit) => hit.taskId);
    for (const request of [s.as(s.bob), s.as(s.guest)]) {
      expect(await hits(request, "sprint")).not.toContain(task.id);
      expect(await hits(request, "okapi")).not.toContain(task.id);
    }
    for (const request of [s.as(s.admin), s.as(s.alice)]) {
      expect(await hits(request, "sprint")).toContain(task.id);
      expect(await hits(request, "okapi")).toContain(task.id);
    }
  });

  it("still matches it for someone who can", async () => {
    const s = await searchScene();
    for (const request of [s.as(s.admin), s.as(s.alice)]) {
      const byTitle = await s.search(request, "Zebracorn");
      expect(byTitle.body.results.map((hit) => hit.taskId)).toContain(
        s.visible.id,
      );
      const hit = byTitle.body.results.find(
        (result) => result.taskId === s.visible.id,
      );
      expect(hit?.content).toContain(HIDDEN_TITLE);
      expect(hit?.content).toContain("NRW-");
      const byProject = await s.search(request, "Narwhal");
      expect(byProject.body.results.map((one) => one.taskId)).toContain(
        s.moved.id,
      );
    }
  });

  it("says another project in the result text instead of naming it", async () => {
    const s = await searchScene();
    for (const request of [s.as(s.bob), s.as(s.guest)]) {
      const { text, body } = await s.search(request, "Visible");
      s.expectNoTrace(text, "the searcher");
      const hit = body.results.find(
        (result) =>
          result.taskId === s.visible.id && result.content?.includes("blocked"),
      );
      expect(hit?.content).toBe(
        "marked this task as blocked by a task in another project",
      );
    }
  });
});

describe("routes a project-limited key can't reach", () => {
  it("refuses the workspace-wide readers, so only the task feed needs its list", async () => {
    const s = await scene();
    const w = s.workspace.id;
    const [, , limited] = s.outsiders;
    if (!limited) throw new Error("no key");
    const [, withKey] = limited;
    for (const path of [
      `/activity/mine?workspaceId=${w}`,
      `/activity/member/${s.alice.id}?workspaceId=${w}`,
      `/search?q=Zebracorn&workspaceId=${w}`,
    ]) {
      expect((await withKey(path)).status, path).toBe(403);
    }
    const summary = await withKey(
      "/ai/writing/summarize?stream=false",
      json("POST", { workspaceId: w, kind: "task", id: s.hiddenTask.id }),
    );
    expect(summary.status).toBe(403);
  });
});

describe("AI task summaries", () => {
  const AI_ENV = ["MARGAYA_AI_ENABLED", "MARGAYA_AI_PROVIDER"] as const;

  beforeEach(() => {
    resetRateLimitMemory();
    resetAiGatewayState();
  });

  afterEach(() => {
    for (const name of AI_ENV) delete process.env[name];
    setAiProviderFactory(null);
    setFakeResponder(null);
    resetAiGatewayState();
  });

  async function aiScene() {
    process.env.MARGAYA_AI_ENABLED = "true";
    process.env.MARGAYA_AI_PROVIDER = "fake";
    const s = await scene();
    await saveWorkspaceAiSettings(
      s.workspace.id,
      { enabled: true },
      s.admin.id,
    );
    const prompts: string[] = [];
    setFakeResponder((request: ChatRequest) => {
      const last = request.messages.at(-1)?.content;
      const text = typeof last === "string" ? last : "";
      prompts.push(text);
      return { text: "summary" };
    });
    const { project: side } = await createProjectFixture({
      workspaceId: s.workspace.id,
      name: "Quokka side",
      slug: "qka",
    });
    const sideTask = await s.createTask({
      projectId: side.id,
      title: "Quokka launch",
    });
    const visible = await s.createTask({ title: "Visible task" });
    const link = (sourceTaskId: string) =>
      s.as(s.admin)(
        "/task-relation",
        json("POST", {
          sourceTaskId,
          targetTaskId: visible.id,
          relationType: "blocking",
        }),
      );
    await link(s.hiddenTask.id);
    await link(sideTask.id);
    await settledActivity(visible.id, "relation_added", 2);
    const moved = await s.as(s.admin)(
      `/task/move/${visible.id}`,
      json("PUT", { destinationProjectId: s.secret.id }),
    );
    expect(moved.status).toBe(200);
    await settledActivity(visible.id, "moved");
    await hiddenPlanning(s.secret.id, visible.id);
    await db.insert(schema.activityTable).values({
      taskId: visible.id,
      type: "status_changed",
      userId: s.admin.id,
      eventData: { oldStatus: "to-do", newStatus: "zebracorn-review" },
    });
    const back = await s.as(s.admin)(
      `/task/move/${visible.id}`,
      json("PUT", { destinationProjectId: s.project.id }),
    );
    expect(back.status).toBe(200);
    await settledActivity(visible.id, "moved", 2);
    const summarize = async (request: Request) => {
      const response = await request(
        "/ai/writing/summarize?stream=false",
        json("POST", {
          workspaceId: s.workspace.id,
          kind: "task",
          id: visible.id,
        }),
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const prompt = prompts.at(-1);
      if (!prompt) throw new Error("no prompt");
      return prompt;
    };
    return { ...s, side, sideTask, visible, summarize };
  }

  it("keeps what the caller can't see out of the prompt", async () => {
    const s = await aiScene();
    const prompt = await s.summarize(s.as(s.bob));
    s.expectNoTrace(prompt, "the prompt");
    expect(prompt).toContain("task-history");
    expect(prompt).toContain("Quokka launch");
    expect(prompt).toContain("otherTaskHidden");
    expect(prompt).toContain("fromProjectHidden");
    expect(prompt).toContain("oldCycleHidden");
    expect(prompt).toContain("moduleHidden");
    expect(prompt).toContain("statusHidden");
  });

  it("keeps a restricted project out of an open task's prompt, whoever asks", async () => {
    const s = await aiScene();
    await saveWorkspaceAiSettings(
      s.workspace.id,
      { includeRestricted: true },
      s.admin.id,
    );
    // The call is private tier (the task's), so the router would send a
    // restricted project's title to a cloud model.
    const prompt = await s.summarize(s.as(s.admin));
    s.expectNoTrace(prompt, "the prompt");
    expect(prompt).toContain("Quokka launch");
  });

  it("keeps a project with AI off out of the prompt", async () => {
    const s = await aiScene();
    await db
      .update(schema.projectTable)
      .set({ aiEnabled: false })
      .where(eq(schema.projectTable.id, s.side.id));
    const prompt = await s.summarize(s.as(s.admin));
    expect(prompt).not.toContain("Quokka");
  });

  it("names a task's own restricted project in its own history", async () => {
    const s = await scene();
    const sibling = await s.createTask({
      projectId: s.secret.id,
      title: "Zebracorn sibling",
    });
    await s.as(s.alice)(
      "/task-relation",
      json("POST", {
        sourceTaskId: sibling.id,
        targetTaskId: s.hiddenTask.id,
        relationType: "related",
      }),
    );
    await settledActivity(s.hiddenTask.id, "relation_added");
    const lines = await taskHistoryLines(s.hiddenTask.id, {
      workspaceId: s.workspace.id,
      projectIds: new Set([s.secret.id]),
      restrictedProjectIds: new Set([s.secret.id]),
    });
    expect(lines.join("\n")).toContain("Zebracorn sibling");
  });
});

describe("MCP list_task_activity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("goes through the same redaction", async () => {
    const s = await scene();
    const visible = await s.createTask({ title: "Visible task" });
    await s.as(s.alice)(
      "/task-relation",
      json("POST", {
        sourceTaskId: s.hiddenTask.id,
        targetTaskId: visible.id,
        relationType: "blocking",
      }),
    );
    await settledActivity(visible.id, "relation_added");
    // The tools call the API over HTTP; route those calls into this app.
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      s.app.request(new Request(input, init)),
    );

    const protocolVersion = "2026-07-28";
    const response = await s.app.request("/api/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-method": "tools/call",
        "mcp-name": "list_task_activity",
        "mcp-protocol-version": protocolVersion,
        ...s.key.headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "list_task_activity",
          arguments: { taskId: visible.id },
          _meta: {
            "io.modelcontextprotocol/protocolVersion": protocolVersion,
            "io.modelcontextprotocol/clientInfo": { name: "it", version: "1" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    const raw = await response.text();
    expect(response.status, raw).toBe(200);
    expect(raw).toContain("otherTaskHidden");
    s.expectNoTrace(raw, "the tool");
  });
});
