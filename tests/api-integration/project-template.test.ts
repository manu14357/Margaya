import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { encodeScope } from "../../apps/api/src/api-key/scope";
import db from "../../apps/api/src/database";
import * as schema from "../../apps/api/src/database/schema";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { createApiKey } from "./helpers/api-keys";
import { mockAuthenticatedSession } from "./helpers/auth";
import { json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type Created = {
  id: string;
  slug: string;
  lastTaskNumber: number;
  leadUserId: string | null;
  cyclesEnabled: boolean;
  viewsEnabled: boolean;
  template?: {
    id: string;
    version: number;
    locale: string;
    sampleTaskCount: number;
    skipped: { kind: string; key: string; reason: string }[];
  };
};

async function scene() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const workspaceId = owner.workspace.id;
  const member = await addWorkspaceMember(workspaceId, "member");
  const otherMember = await addWorkspaceMember(workspaceId, "member");
  const admin = await addWorkspaceMember(workspaceId, "admin");
  const viewer = await addWorkspaceMember(workspaceId, "viewer");
  const { app } = createApp();
  const as = async (
    user: { id: string },
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    mockAuthenticatedSession(user as never);
    const init: RequestInit =
      body === undefined ? { method, headers } : json(method, body);
    if (body !== undefined) {
      init.headers = {
        ...(init.headers as Record<string, string>),
        ...headers,
      };
    }
    return app.request(`/api${path}`, init);
  };
  const create = (user: { id: string }, body: Record<string, unknown>) =>
    as(user, "POST", "/project", {
      workspaceId,
      name: "From template",
      icon: "FolderKanban",
      ...body,
    });
  return { owner, member, otherMember, admin, viewer, workspaceId, as, create };
}

const settingsEvents: Record<string, unknown>[] = [];
await subscribeToEvent<Record<string, unknown>>(
  "workspace.settings_updated",
  async (data) => {
    settingsEvents.push(data);
  },
);

async function rows<T>(query: Promise<T[]>) {
  return query;
}

describe("creating a project from a template", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lets a member (project:create only) create kanban without example tasks", async () => {
    const s = await scene();
    const started = performance.now();
    const response = await s.create(s.member, {
      slug: "KAN",
      template: { id: "kanban" },
    });
    const elapsed = Math.round(performance.now() - started);
    expect(response.status, await response.clone().text()).toBe(200);
    console.info(`kanban without samples: ${elapsed} ms`);
    const project = (await response.json()) as Created;
    expect(project.template).toEqual({
      id: "kanban",
      version: 1,
      locale: "en-US",
      sampleTaskCount: 0,
      skipped: [],
    });
    expect(project).toMatchObject({
      leadUserId: s.member.id,
      viewsEnabled: true,
      cyclesEnabled: false,
      lastTaskNumber: 0,
    });

    const columns = await db
      .select()
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, project.id))
      .orderBy(asc(schema.columnTable.position));
    expect(columns.map((c) => [c.slug, c.group, c.isFinal])).toEqual([
      ["backlog", "backlog", false],
      ["ready", "unstarted", false],
      ["in-progress", "started", false],
      ["in-review", "started", false],
      ["done", "completed", true],
      ["won-t-do", "cancelled", true],
    ]);

    const labels = await db
      .select({ name: schema.labelTable.name, color: schema.labelTable.color })
      .from(schema.labelTable)
      .where(
        and(
          eq(schema.labelTable.workspaceId, s.workspaceId),
          isNull(schema.labelTable.taskId),
        ),
      );
    expect(labels.map((l) => l.name).sort()).toEqual([
      "Expedite",
      "Fixed date",
      "Waiting",
    ]);

    const views = await rows(
      db
        .select()
        .from(schema.savedViewTable)
        .where(eq(schema.savedViewTable.projectId, project.id)),
    );
    expect(views).toHaveLength(4);
    const expedite = views.find((v) => v.name === "Expedite lane");
    expect(expedite?.filters.root).toEqual({
      key: "label",
      operator: "in",
      values: ["name:Expedite"],
    });

    const rules = await db
      .select()
      .from(schema.automationRuleTable)
      .where(eq(schema.automationRuleTable.projectId, project.id));
    expect(rules.map((r) => r.triggerType).sort()).toEqual([
      "due_date_passed",
      "label_added",
    ]);
    const templates = await db
      .select()
      .from(schema.taskTemplateTable)
      .where(eq(schema.taskTemplateTable.projectId, project.id));
    expect(templates).toHaveLength(2);
    const expediteTemplate = templates.find((t) => t.priority === "urgent");
    expect(expediteTemplate?.labelIds).toHaveLength(1);

    const pages = await db
      .select()
      .from(schema.pageTable)
      .where(eq(schema.pageTable.projectId, project.id));
    expect(pages.map((p) => p.title).sort()).toEqual([
      "Board policies",
      "Flow review notes",
    ]);
    expect(
      pages.find((p) => p.title === "Board policies")?.contentMarkdown,
    ).toContain("What Ready means");

    const [automation] = await db
      .select()
      .from(schema.projectAutomationTable)
      .where(eq(schema.projectAutomationTable.projectId, project.id));
    expect(automation?.flowAlertsEnabled).toBe(true);

    const tasks = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, project.id));
    expect(tasks).toEqual([]);

    const detail = await s.as(s.member, "GET", `/project/${project.id}`);
    expect(
      ((await detail.json()) as { hasSampleData: boolean }).hasSampleData,
    ).toBe(false);

    // The application is recorded for every templated create.
    const [application] = await db
      .select()
      .from(schema.projectTemplateApplicationTable)
      .where(eq(schema.projectTemplateApplicationTable.projectId, project.id));
    expect(application).toMatchObject({
      templateId: "kanban",
      templateVersion: 1,
      sampleTaskIds: [],
      appliedBy: s.member.id,
    });

    // Labels are reused by name in the next project.
    const second = await s.create(s.member, {
      slug: "KAN2",
      template: { id: "kanban" },
    });
    expect(second.status).toBe(200);
    const allLabels = await db
      .select()
      .from(schema.labelTable)
      .where(
        and(
          eq(schema.labelTable.workspaceId, s.workspaceId),
          isNull(schema.labelTable.taskId),
        ),
      );
    expect(allLabels).toHaveLength(3);
  });

  it("writes example tasks in German with feature overrides", async () => {
    const s = await scene();
    const started = performance.now();
    const response = await s.create(s.member, {
      slug: "KDE",
      template: { id: "kanban", sampleData: true, locale: "de-DE" },
      features: { cycles: true, views: false },
    });
    const elapsed = Math.round(performance.now() - started);
    expect(response.status, await response.clone().text()).toBe(200);
    console.info(`kanban with samples: ${elapsed} ms`);
    const project = (await response.json()) as Created;
    expect(project.template).toMatchObject({
      locale: "de-DE",
      sampleTaskCount: 9,
    });
    expect(project).toMatchObject({
      cyclesEnabled: true,
      viewsEnabled: false,
      lastTaskNumber: 9,
    });

    const columns = await db
      .select({ name: schema.columnTable.name, slug: schema.columnTable.slug })
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, project.id))
      .orderBy(asc(schema.columnTable.position));
    expect(columns[2]?.name).toBe("In Bearbeitung");

    const tasks = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, project.id))
      .orderBy(asc(schema.taskTable.number));
    expect(tasks.map((t) => t.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const columnSlugs = new Set(columns.map((c) => c.slug));
    for (const task of tasks) expect(columnSlugs.has(task.status)).toBe(true);
    const assigned = await db
      .select()
      .from(schema.taskAssigneeTable)
      .where(eq(schema.taskAssigneeTable.userId, s.member.id));
    expect(assigned.length).toBeGreaterThanOrEqual(2);

    const relations = await db
      .select({ type: schema.taskRelationTable.relationType })
      .from(schema.taskRelationTable);
    expect(relations.map((r) => r.type).sort()).toEqual([
      "blocks",
      "subtask",
      "subtask",
    ]);
    const recurrences = await db.select().from(schema.taskRecurrenceTable);
    expect(recurrences).toHaveLength(1);
    expect(recurrences[0]?.frequency).toBe("yearly");

    const copies = await db
      .select()
      .from(schema.labelTable)
      .where(isNotNull(schema.labelTable.taskId));
    expect(copies).toHaveLength(3);

    const activity = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.type, "create"));
    expect(activity).toHaveLength(9);
    expect(activity[0]?.eventData).toEqual({
      templateId: "kanban",
      sample: true,
    });
    // No per-task events: nobody was notified about example tasks.
    const notifications = await db.select().from(schema.notificationTable);
    expect(notifications).toEqual([]);

    const detail = await s.as(s.member, "GET", `/project/${project.id}`);
    expect(
      ((await detail.json()) as { hasSampleData: boolean }).hasSampleData,
    ).toBe(true);
  });

  it("applies feature switches to a blank project too", async () => {
    const s = await scene();
    const response = await s.create(s.member, {
      slug: "BLK",
      features: { intake: true, cycles: false },
    });
    expect(response.status).toBe(200);
    const [project] = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.slug, "BLK"));
    expect(project).toMatchObject({
      intakeEnabled: true,
      cyclesEnabled: false,
      viewsEnabled: true,
    });
    const columns = await db
      .select()
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, project?.id ?? ""));
    expect(columns).toHaveLength(4);
  });

  it("rejects a template with fromProjectId, unknown templates and missing rights", async () => {
    const s = await scene();
    const { project } = await createProjectFixture({
      workspaceId: s.workspaceId,
      slug: "src",
    });
    const both = await s.create(s.member, {
      slug: "BTH",
      fromProjectId: project.id,
      template: { id: "kanban" },
    });
    expect(both.status).toBe(400);
    expect(await both.text()).toBe(
      "Choose a template or a source project, not both",
    );

    const unknown = await s.create(s.member, {
      slug: "UNK",
      template: { id: "no-such" },
    });
    expect(unknown.status).toBe(404);

    const viewer = await s.create(s.viewer, {
      slug: "VWR",
      template: { id: "kanban" },
    });
    expect(viewer.status).toBe(403);

    // project:create without task:create or label:create.
    const limited = await addWorkspaceMember(s.workspaceId, "project-maker");
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: s.workspaceId,
      role: "project-maker",
      permission: JSON.stringify({
        project: ["read", "create"],
        task: ["read"],
      }),
    });
    const samples = await s.create(limited, {
      slug: "LIM",
      template: { id: "kanban", sampleData: true },
    });
    expect(samples.status).toBe(403);

    const noLabels = await s.create(limited, {
      slug: "LIM2",
      template: { id: "kanban" },
    });
    expect(noLabels.status, await noLabels.clone().text()).toBe(200);
    const created = (await noLabels.json()) as Created;
    expect(created.template?.skipped).toEqual(
      expect.arrayContaining([
        { kind: "label", key: "expedite", reason: "permission" },
        { kind: "label", key: "fixed-date", reason: "permission" },
        { kind: "label", key: "waiting", reason: "permission" },
        { kind: "automationRule", key: "0", reason: "permission" },
        { kind: "automationRule", key: "1", reason: "permission" },
      ]),
    );
    const projects = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.workspaceId, s.workspaceId));
    // src and LIM2 only: the refused requests wrote nothing.
    expect(projects.map((p) => p.slug).sort()).toEqual(["LIM2", "src"]);
  });

  it("answers 409 on a taken key without writing anything", async () => {
    const s = await scene();
    expect(
      (await s.create(s.member, { slug: "DUP", template: { id: "kanban" } }))
        .status,
    ).toBe(200);
    const again = await s.create(s.member, {
      slug: "dup",
      template: { id: "kanban", sampleData: true },
    });
    expect(again.status).toBe(409);
    const applications = await db
      .select()
      .from(schema.projectTemplateApplicationTable);
    expect(applications).toHaveLength(1);
  });
});

describe("removing example tasks", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lets the applier or task:delete remove them, once, as one trash batch", async () => {
    const s = await scene();
    const response = await s.create(s.member, {
      slug: "SMP",
      template: { id: "kanban", sampleData: true },
    });
    const project = (await response.json()) as Created;
    const path = `/project-template/project/${project.id}/remove-sample-data`;

    // Another member: neither task:delete nor the applier.
    expect((await s.as(s.otherMember, "POST", path)).status).toBe(403);
    expect((await s.as(s.viewer, "POST", path)).status).toBe(403);

    // A sample task moved to another project stays there.
    const { project: elsewhere } = await createProjectFixture({
      workspaceId: s.workspaceId,
      slug: "else",
    });
    const [moved] = await db
      .select()
      .from(schema.taskTable)
      .where(
        and(
          eq(schema.taskTable.projectId, project.id),
          eq(schema.taskTable.number, 7),
        ),
      );
    await db
      .update(schema.taskTable)
      .set({ projectId: elsewhere.id })
      .where(eq(schema.taskTable.id, moved?.id ?? ""));

    // The member who applied it has no task:delete but may remove them.
    const removed = await s.as(s.member, "POST", path);
    expect(removed.status, await removed.clone().text()).toBe(200);
    const result = (await removed.json()) as {
      removedTaskCount: number;
      trashBatchId: string;
    };
    expect(result.removedTaskCount).toBe(8);
    const trashed = await db
      .select()
      .from(schema.taskTable)
      .where(isNotNull(schema.taskTable.deletedAt));
    expect(new Set(trashed.map((t) => t.trashBatchId))).toEqual(
      new Set([result.trashBatchId]),
    );
    const stayed = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, moved?.id ?? ""));
    expect(stayed[0]?.deletedAt).toBeNull();

    const detail = await s.as(s.member, "GET", `/project/${project.id}`);
    expect(
      ((await detail.json()) as { hasSampleData: boolean }).hasSampleData,
    ).toBe(false);

    // Again: nothing more to do.
    const again = await s.as(s.admin, "POST", path);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({
      removedTaskCount: 0,
      trashBatchId: null,
    });
  });

  it("trashes only recorded example tasks still in this project", async () => {
    const s = await scene();
    const project = (await (
      await s.create(s.member, {
        slug: "OWN",
        template: { id: "kanban", sampleData: true },
      })
    ).json()) as Created;
    const path = `/project-template/project/${project.id}/remove-sample-data`;
    const examples = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, project.id))
      .orderBy(asc(schema.taskTable.number));
    const [parent, movedChild] = examples;
    if (!parent || !movedChild) throw new Error("no example tasks");

    // A teammate's own task, re-parented under an example task.
    const [teammates] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Teammate work",
        status: "to-do",
        number: 100,
      })
      .returning();
    if (!teammates) throw new Error("no task");
    // An example made a sub-task of another example, then moved away.
    const { project: elsewhere } = await createProjectFixture({
      workspaceId: s.workspaceId,
      slug: "away",
    });
    await db
      .update(schema.taskTable)
      .set({ projectId: elsewhere.id })
      .where(eq(schema.taskTable.id, movedChild.id));
    await db.insert(schema.taskRelationTable).values([
      {
        sourceTaskId: parent.id,
        targetTaskId: teammates.id,
        relationType: "subtask",
      },
      {
        sourceTaskId: parent.id,
        targetTaskId: movedChild.id,
        relationType: "subtask",
      },
    ]);

    const removed = await s.as(s.member, "POST", path);
    expect(removed.status, await removed.clone().text()).toBe(200);
    expect(
      ((await removed.json()) as { removedTaskCount: number }).removedTaskCount,
    ).toBe(examples.length - 1);

    const after = await db
      .select({
        id: schema.taskTable.id,
        deletedAt: schema.taskTable.deletedAt,
      })
      .from(schema.taskTable)
      .where(
        inArray(schema.taskTable.id, [teammates.id, movedChild.id, parent.id]),
      );
    const deletedAt = new Map(after.map((row) => [row.id, row.deletedAt]));
    expect(deletedAt.get(teammates.id)).toBeNull();
    expect(deletedAt.get(movedChild.id)).toBeNull();
    expect(deletedAt.get(parent.id)).not.toBeNull();
  });

  it("refuses an applier who lost task:create, by key scope or by role", async () => {
    const s = await scene();
    const project = (await (
      await s.create(s.member, {
        slug: "DEM",
        template: { id: "kanban", sampleData: true },
      })
    ).json()) as Created;
    const path = `/project-template/project/${project.id}/remove-sample-data`;

    // The applier's own key, limited to reading tasks.
    const key = await createApiKey(
      s.member,
      encodeScope({
        access: "custom",
        areas: { task: "read", project: "write" },
      }) ?? undefined,
    );
    const byKey = await s.as(s.member, "POST", path, undefined, key.headers);
    expect(byKey.status, await byKey.clone().text()).toBe(403);

    // Demoted to viewer after applying the template.
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "viewer" })
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, s.workspaceId),
          eq(schema.workspaceUserTable.userId, s.member.id),
        ),
      );
    expect((await s.as(s.member, "POST", path)).status).toBe(403);

    const live = await db
      .select({ id: schema.taskTable.id })
      .from(schema.taskTable)
      .where(
        and(
          eq(schema.taskTable.projectId, project.id),
          isNull(schema.taskTable.deletedAt),
        ),
      );
    expect(live).toHaveLength(9);
  });

  it("allows task:delete holders and 404s for a project without examples", async () => {
    const s = await scene();
    const project = (await (
      await s.create(s.member, {
        slug: "ADM",
        template: { id: "kanban", sampleData: true },
      })
    ).json()) as Created;
    const byAdmin = await s.as(
      s.admin,
      "POST",
      `/project-template/project/${project.id}/remove-sample-data`,
    );
    expect(byAdmin.status).toBe(200);
    expect(
      ((await byAdmin.json()) as { removedTaskCount: number }).removedTaskCount,
    ).toBe(9);

    const plain = (await (
      await s.create(s.member, { slug: "PLN", template: { id: "kanban" } })
    ).json()) as Created;
    const none = await s.as(
      s.admin,
      "POST",
      `/project-template/project/${plain.id}/remove-sample-data`,
    );
    expect(none.status).toBe(404);
  });
});

describe("catalog routes", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lists, previews with ETags and answers 404", async () => {
    const s = await scene();
    const list = await s.as(s.viewer, "GET", "/project-template?locale=fr-FR");
    expect(list.status).toBe(200);
    const etag = list.headers.get("etag");
    expect(etag).toBeTruthy();
    const catalog = (await list.json()) as {
      locale: string;
      categories: { id: string; name: string }[];
      templates: {
        id: string;
        name: string;
        counts: { sampleTasks: number };
      }[];
    };
    expect(catalog.locale).toBe("fr-FR");
    expect(catalog.categories).toHaveLength(17);
    const kanban = catalog.templates.find((t) => t.id === "kanban");
    expect(kanban?.counts.sampleTasks).toBe(9);

    const cached = await s.as(
      s.viewer,
      "GET",
      "/project-template?locale=fr-FR",
      undefined,
      {
        "if-none-match": etag ?? "",
      },
    );
    expect(cached.status).toBe(304);

    const filtered = await s.as(
      s.viewer,
      "GET",
      "/project-template?category=finance",
    );
    const financeTemplates = (
      (await filtered.json()) as { templates: { categories: string[] }[] }
    ).templates;
    expect(financeTemplates.length).toBeGreaterThan(0);
    for (const template of financeTemplates) {
      expect(template.categories).toContain("finance");
    }

    expect(filtered.headers.get("etag")).toMatch(/-c:finance"$/);
    // Only known category ids: the value is echoed into the ETag header.
    for (const category of ["no-such", "finance%22%2C%20x", "FINANCE"]) {
      const bad = await s.as(
        s.viewer,
        "GET",
        `/project-template?category=${category}`,
      );
      expect(bad.status, category).toBe(400);
      expect(bad.headers.get("etag")).toBeNull();
    }

    const preview = await s.as(
      s.viewer,
      "GET",
      "/project-template/kanban",
      undefined,
      {
        "accept-language": "de-DE,de;q=0.9",
      },
    );
    expect(preview.status).toBe(200);
    const body = (await preview.json()) as {
      statuses: { name: string; group: string }[];
      automations: { trigger: string }[];
      intakeForm: boolean;
      sampleTasks: unknown[];
      views: { name: string; layout: string }[];
    };
    expect(body.statuses).toHaveLength(6);
    expect(body.statuses[2]?.name).toBe("In Bearbeitung");
    expect(body.intakeForm).toBe(false);
    expect(body.automations).toHaveLength(2);
    expect(body.sampleTasks).toHaveLength(7);
    expect(body.views.map((v) => v.layout)).toContain("board");

    expect((await s.as(s.viewer, "GET", "/project-template/nope")).status).toBe(
      404,
    );
  });

  it("lists starters and refuses unknown ones and non-empty workspaces", async () => {
    const s = await scene();
    const list = await s.as(s.owner.user, "GET", "/project-template/starters");
    expect(list.status).toBe(200);
    const unknown = await s.as(
      s.owner.user,
      "POST",
      `/workspace/${s.workspaceId}/starter`,
      {
        starterId: "no-such",
      },
    );
    expect(unknown.status).toBe(404);
    const viewer = await s.as(
      s.viewer,
      "POST",
      `/workspace/${s.workspaceId}/starter`,
      {
        starterId: "software-team",
      },
    );
    expect(viewer.status).toBe(403);
  });

  it("stores a starter's time zone in its canonical spelling and announces it", async () => {
    const fresh = await createWorkspaceMember({ role: "owner" });
    const { app } = createApp();
    mockAuthenticatedSession(fresh.user as never);
    const zoneOf = async () => {
      const [row] = await db
        .select({ timezone: schema.workspaceTable.timezone })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, fresh.workspace.id));
      return row?.timezone;
    };
    settingsEvents.length = 0;
    const response = await app.request(
      `/api/workspace/${fresh.workspace.id}/starter`,
      json("POST", { starterId: "software-team", timezone: "europe/berlin" }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await zoneOf()).toBe("Europe/Berlin");
    await new Promise((resolve) => setImmediate(resolve));
    expect(settingsEvents).toEqual([
      expect.objectContaining({
        workspaceId: fresh.workspace.id,
        userId: fresh.user.id,
        changed: ["timezone"],
      }),
    ]);

    // The workspace has projects now: 409, and the zone stays.
    settingsEvents.length = 0;
    const again = await app.request(
      `/api/workspace/${fresh.workspace.id}/starter`,
      json("POST", { starterId: "software-team", timezone: "Asia/Tokyo" }),
    );
    expect(again.status).toBe(409);
    expect(await zoneOf()).toBe("Europe/Berlin");
    await new Promise((resolve) => setImmediate(resolve));
    expect(settingsEvents).toEqual([]);
  });
});
