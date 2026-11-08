import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { resetTestDatabase } from "./helpers/database";
import { json, type SavedViewJson, viewScene } from "./helpers/views";

const events: Array<{ type: string; data: Record<string, unknown> }> = [];
for (const type of ["view.created", "view.updated", "view.deleted"]) {
  await subscribeToEvent<Record<string, unknown>>(type, async (data) => {
    events.push({ type, data });
  });
}

describe("API integration: saved views", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    events.length = 0;
  });

  it("creates project and workspace views with the scope's defaults", async () => {
    const { create, ben, project, workspaceId } = await viewScene();

    const projectView = await create(ben, {
      projectId: project.id,
      name: "  Bugs  ",
    });
    expect(projectView).toMatchObject({
      workspaceId,
      projectId: project.id,
      name: "Bugs",
      description: "",
      filters: { version: 1, root: null, archived: "exclude" },
      display: {
        layout: "list",
        groupBy: "status",
        subGroupBy: null,
        orderBy: { field: "manual", direction: "asc" },
        showSubTasks: true,
        showEmptyGroups: false,
      },
      access: "workspace",
      isLocked: false,
      lockedBy: null,
      ownerId: ben.id,
      owner: { id: ben.id, name: "Ben" },
      canEdit: true,
      canDelete: true,
    });
    expect(projectView.displayProperties).toEqual({
      key: true,
      status: true,
      priority: true,
      assignee: true,
      labels: true,
      startDate: false,
      dueDate: true,
      estimate: true,
      cycle: true,
      modules: true,
      subTaskCount: true,
      checklist: true,
      createdAt: false,
      updatedAt: false,
      linkCount: false,
      attachmentCount: false,
      customFields: [],
    });

    const workspaceView = await create(ben, { name: "Everything" });
    expect(workspaceView).toMatchObject({
      projectId: null,
      display: {
        layout: "spreadsheet",
        groupBy: null,
        orderBy: { field: "createdAt", direction: "desc" },
      },
    });

    expect(events).toEqual([
      {
        type: "view.created",
        data: expect.objectContaining({
          viewId: projectView.id,
          workspaceId,
          projectId: project.id,
          userId: ben.id,
          access: "workspace",
        }),
      },
      {
        type: "view.created",
        data: expect.objectContaining({
          viewId: workspaceView.id,
          projectId: null,
        }),
      },
    ]);
  });

  it("stores filters, display and properties the engine can run, as sent", async () => {
    const { create, ben, project, insertCycle, insertWorkspaceLabel } =
      await viewScene();
    const cycle = await insertCycle(project.id);
    const label = await insertWorkspaceLabel("Bug");
    const root = {
      op: "and",
      children: [
        { key: "assignee", operator: "in", values: ["me", "none"] },
        { key: "label", operator: "notIn", values: [label.id, "name:Old"] },
        { key: "cycle", operator: "in", values: ["current", cycle.id] },
        { key: "status", operator: "in", values: ["to-do", "planned"] },
        {
          op: "or",
          children: [
            { key: "dueDate", operator: "in", values: ["thisWeek", "none"] },
            {
              key: "createdAt",
              operator: "withinLast",
              amount: 2,
              unit: "weeks",
            },
          ],
        },
      ],
    };

    const view = await create(ben, {
      projectId: project.id,
      description: "Mine",
      filters: { root, archived: "include" },
      display: {
        layout: "board",
        groupBy: "priority",
        subGroupBy: "assignee",
        orderBy: { field: "dueDate" },
        showEmptyGroups: true,
      },
      displayProperties: { startDate: true, labels: false },
      access: "private",
    });

    expect(view.filters).toEqual({ version: 1, root, archived: "include" });
    expect(view.display).toEqual({
      layout: "board",
      groupBy: "priority",
      subGroupBy: "assignee",
      orderBy: { field: "dueDate", direction: "asc" },
      showSubTasks: true,
      showEmptyGroups: true,
    });
    expect(view.displayProperties).toMatchObject({
      startDate: true,
      labels: false,
      key: true,
    });
    expect(view.access).toBe("private");
  });

  it("validates names and descriptions", async () => {
    const { call, ben, workspaceId } = await viewScene();
    const post = (body: Record<string, unknown>) =>
      call(ben, "", json("POST", { workspaceId, ...body }));

    const blank = await post({ name: "   " });
    expect(blank.status).toBe(400);
    expect(await blank.text()).toContain("Give the view a name");
    expect((await post({})).status).toBe(400);
    expect((await post({ name: "x".repeat(256) })).status).toBe(400);
    expect((await post({ name: "x".repeat(255) })).status).toBe(200);
    expect(
      (await post({ name: "Long", description: "d".repeat(2001) })).status,
    ).toBe(400);
    expect((await post({ name: "Extra", color: "red" })).status).toBe(400);
  });

  it("rejects filters and display options the engine or the scope can't use", async () => {
    const { call, ben, workspaceId, project } = await viewScene();
    const post = async (body: Record<string, unknown>) => {
      const response = await call(
        ben,
        "",
        json("POST", { workspaceId, name: "V", ...body }),
      );
      return { status: response.status, text: await response.text() };
    };
    const inProject = (body: Record<string, unknown>) =>
      post({ projectId: project.id, ...body });

    expect(
      await inProject({
        filters: { root: { key: "color", operator: "in", values: ["red"] } },
      }),
    ).toEqual({ status: 400, text: "Unsupported filter: color" });
    expect(
      await inProject({
        filters: {
          root: { key: "priority", operator: "on", date: "2026-01-01" },
        },
      }),
    ).toEqual({ status: 400, text: "Operator on is not valid for priority" });
    expect(
      await inProject({
        filters: {
          root: { key: "dueDate", operator: "on", date: "2026-02-30" },
        },
      }),
    ).toEqual({ status: 400, text: "Invalid date" });
    const deep = {
      op: "and",
      children: [
        {
          op: "and",
          children: [
            {
              op: "and",
              children: [
                {
                  op: "and",
                  children: [
                    { key: "priority", operator: "in", values: ["high"] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const tooDeep = await inProject({ filters: { root: deep } });
    expect(tooDeep.status).toBe(400);
    expect(tooDeep.text).toContain("Filters are too complex");
    expect(
      await inProject({
        display: { groupBy: "priority", subGroupBy: "priority" },
      }),
    ).toEqual({ status: 400, text: "Group and sub-group must differ" });
    expect(
      await inProject({ display: { groupBy: null, subGroupBy: "priority" } }),
    ).toEqual({ status: 400, text: "Group and sub-group must differ" });
    expect(
      (await inProject({ displayProperties: { mystery: true } })).status,
    ).toBe(400);

    // Workspace views span projects.
    expect(
      await post({
        filters: { root: { key: "status", operator: "in", values: ["to-do"] } },
      }),
    ).toEqual({
      status: 400,
      text: "Workspace views can't filter by status; use group instead",
    });
    expect(await post({ display: { groupBy: "status" } })).toEqual({
      status: 400,
      text: "Group by status needs a single project",
    });
    expect(await post({ display: { layout: "calendar" } })).toEqual({
      status: 400,
      text: "Workspace views use the list, board, spreadsheet or gantt layout",
    });
    expect(
      await post({ displayProperties: { customFields: ["field-1"] } }),
    ).toEqual({
      status: 400,
      text: "Custom field columns need a project view",
    });
    expect((await inProject({ display: { layout: "gantt" } })).status).toBe(
      200,
    );
    expect((await post({ display: { layout: "gantt" } })).status).toBe(200);
  });

  it("only stores references to rows of the view's workspace and project", async () => {
    const scene = await viewScene();
    const { call, ben, workspaceId, project } = scene;
    const other = await scene.project2();
    const outsider = await viewScene();
    const post = async (body: Record<string, unknown>) => {
      const response = await call(
        ben,
        "",
        json("POST", { workspaceId, name: "V", ...body }),
      );
      return { status: response.status, text: await response.text() };
    };
    const condition = (key: string, values: string[], extra = {}) => ({
      filters: { root: { key, operator: "in", values, ...extra } },
    });

    const cycle = await scene.insertCycle(project.id);
    const otherCycle = await scene.insertCycle(other.id, "Other sprint");
    const module = await scene.insertModule(project.id);
    const otherModule = await scene.insertModule(other.id, "Other");
    const point = await scene.insertEstimatePoint(project.id);
    const otherPoint = await scene.insertEstimatePoint(other.id);
    const field = await scene.insertCustomField(project.id);
    const otherField = await scene.insertCustomField(other.id);
    const label = await scene.insertWorkspaceLabel("Bug");
    const foreignLabel = await scene.insertWorkspaceLabel(
      "Bug",
      outsider.workspaceId,
    );
    const task = await scene.insertTask(other.id);
    const foreignTask = await outsider.insertTask(outsider.project.id);

    const accepted: Array<Record<string, unknown>> = [
      condition("cycle", [cycle.id]),
      condition("module", [module.id]),
      condition("estimate", [point.id]),
      condition("customField", ["x"], { fieldId: field.id }),
      condition("label", [label.id]),
      condition("parent", [task.id]),
      condition("project", [other.id]),
      condition("assignee", [scene.cara.id, scene.viewer.id]),
      condition("createdBy", [scene.owner.id]),
      condition("status", ["in-review"]),
      { displayProperties: { customFields: [field.id] } },
    ];
    for (const body of accepted) {
      const result = await post({ projectId: project.id, ...body });
      expect(result.status, JSON.stringify(body)).toBe(200);
    }

    const rejected: Array<[Record<string, unknown>, string]> = [
      [condition("cycle", [otherCycle.id]), "cycle"],
      [condition("module", [otherModule.id]), "module"],
      [condition("estimate", [otherPoint.id]), "estimate"],
      [
        condition("customField", ["x"], { fieldId: otherField.id }),
        "custom field",
      ],
      [condition("label", [foreignLabel.id]), "label"],
      [condition("label", ["missing-label"]), "label"],
      [condition("parent", [foreignTask.id]), "parent task"],
      [condition("project", [outsider.project.id]), "project"],
      [condition("assignee", [outsider.owner.id]), "assignee"],
      [condition("createdBy", ["user-gone"]), "creator"],
      [condition("status", ["shipped"]), "status"],
    ];
    for (const [body, noun] of rejected) {
      expect(await post({ projectId: project.id, ...body })).toEqual({
        status: 400,
        text: `Filter references an unknown ${noun}`,
      });
    }
    expect(
      await post({
        projectId: project.id,
        displayProperties: { customFields: [otherField.id] },
      }),
    ).toEqual({
      status: 400,
      text: "Display properties reference an unknown custom field",
    });

    // Workspace views may name rows of any project of the workspace, never
    // of another workspace.
    expect((await post(condition("cycle", [otherCycle.id]))).status).toBe(200);
    expect((await post(condition("estimate", [otherPoint.id]))).status).toBe(
      200,
    );
    expect(await post(condition("module", ["gone"]))).toEqual({
      status: 400,
      text: "Filter references an unknown module",
    });
  });

  it("checks subscriber values like the engine does", async () => {
    const { call, ben, cara, workspaceId } = await viewScene();
    const { isFilterKeyRegistered } = await import(
      "../../apps/api/src/task-query/keys"
    );
    const post = async (values: string[]) => {
      const response = await call(
        ben,
        "",
        json("POST", {
          workspaceId,
          name: "Watching",
          filters: { root: { key: "subscriber", operator: "in", values } },
        }),
      );
      return { status: response.status, text: await response.text() };
    };

    if (!isFilterKeyRegistered("subscriber")) {
      expect(await post(["me"])).toEqual({
        status: 400,
        text: "Unsupported filter: subscriber",
      });
      return;
    }
    expect((await post(["me"])).status).toBe(200);
    expect((await post([cara.id])).status).toBe(400);
  });

  it("lists shared views and the caller's own private ones, never anyone else's", async () => {
    const { create, list, ben, cara, admin, project } = await viewScene();
    await create(ben, { projectId: project.id, name: "View 10" });
    await create(ben, {
      projectId: project.id,
      name: "view 2",
      access: "private",
    });
    await create(cara, {
      projectId: project.id,
      name: "Cara's",
      access: "private",
    });
    await create(cara, { name: "Across" });

    const names = (views: SavedViewJson[]) => views.map((view) => view.name);
    expect(names(await list(ben, `&projectId=${project.id}`))).toEqual([
      "view 2",
      "View 10",
    ]);
    expect(names(await list(cara, `&projectId=${project.id}`))).toEqual([
      "Cara's",
      "View 10",
    ]);
    // Admins follow the same privacy rule.
    expect(names(await list(admin, `&projectId=${project.id}`))).toEqual([
      "View 10",
    ]);
    expect(names(await list(ben))).toEqual(["Across"]);
    expect(
      names(await list(ben, `&projectId=${project.id}&mine=true`)),
    ).toEqual(["view 2", "View 10"]);
    expect(
      names(await list(cara, `&projectId=${project.id}&mine=true`)),
    ).toEqual(["Cara's"]);
    expect(
      names(await list(ben, `&projectId=${project.id}&search=10`)),
    ).toEqual(["View 10"]);
    expect(
      names(await list(ben, `&projectId=${project.id}&search=%25`)),
    ).toEqual([]);
  });

  it("answers 404 for someone else's private view and for unknown ids", async () => {
    const { create, call, ben, cara, admin, project } = await viewScene();
    const secret = await create(ben, {
      projectId: project.id,
      name: "Secret",
      access: "private",
    });

    expect((await call(ben, `/${secret.id}`)).status).toBe(200);
    for (const user of [cara, admin]) {
      for (const [path, init] of [
        [`/${secret.id}`, undefined],
        [`/${secret.id}`, json("PATCH", { name: "Mine now" })],
        [`/${secret.id}/lock`, { method: "POST" }],
        [`/${secret.id}/duplicate`, json("POST", {})],
        [`/${secret.id}`, { method: "DELETE" }],
      ] as const) {
        const response = await call(user, path, init);
        expect(response.status, path).toBe(404);
        expect(await response.text()).toBe("View not found");
      }
    }
    expect((await call(ben, "/missing-view")).status).toBe(404);
  });

  it("lets the owner and admins update, merging partial changes", async () => {
    const { create, call, ben, cara, admin, project } = await viewScene();
    const view = await create(ben, {
      projectId: project.id,
      name: "Board",
      filters: {
        root: { key: "priority", operator: "in", values: ["high"] },
      },
      display: { layout: "board", groupBy: "priority", subGroupBy: "assignee" },
    });
    const patch = async (user: typeof ben, body: Record<string, unknown>) => {
      const response = await call(user, `/${view.id}`, json("PATCH", body));
      return {
        status: response.status,
        body:
          response.status === 200
            ? ((await response.json()) as SavedViewJson)
            : await response.text(),
      };
    };

    const renamed = await patch(ben, { name: "Board v2", description: "Hot" });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({
      name: "Board v2",
      description: "Hot",
    });

    // Partial display: the rest is kept; a stale sub-group is dropped.
    const regrouped = await patch(ben, { display: { groupBy: "assignee" } });
    expect((regrouped.body as SavedViewJson).display).toMatchObject({
      layout: "board",
      groupBy: "assignee",
      subGroupBy: null,
    });
    const archived = await patch(ben, { filters: { archived: "only" } });
    expect((archived.body as SavedViewJson).filters).toEqual({
      version: 1,
      root: { key: "priority", operator: "in", values: ["high"] },
      archived: "only",
    });
    const cleared = await patch(ben, { filters: { root: null } });
    expect((cleared.body as SavedViewJson).filters.root).toBeNull();
    const props = await patch(ben, { displayProperties: { createdAt: true } });
    expect((props.body as SavedViewJson).displayProperties).toMatchObject({
      createdAt: true,
      key: true,
    });

    expect(await patch(cara, { name: "Hijack" })).toEqual({
      status: 403,
      body: "Only the view's owner or an admin can change it",
    });
    const byAdmin = await patch(admin, { name: "Admin's edit" });
    expect(byAdmin.status).toBe(200);
    expect(await patch(admin, { access: "private" })).toEqual({
      status: 403,
      body: "Only the owner can make a view private",
    });
    const madePrivate = await patch(ben, { access: "private" });
    expect((madePrivate.body as SavedViewJson).access).toBe("private");
    expect((await patch(admin, { name: "Gone" })).status).toBe(404);

    expect((await patch(ben, {})).status).toBe(400);
    expect(
      (
        await patch(ben, {
          filters: { root: { key: "nope", operator: "in", values: ["x"] } },
        })
      ).status,
    ).toBe(400);
  });

  it("publishes nothing for an update that changes nothing", async () => {
    const { create, call, ben, project } = await viewScene();
    const view = await create(ben, {
      projectId: project.id,
      name: "Same",
      filters: {
        root: {
          op: "and",
          children: [{ key: "priority", operator: "in", values: ["high"] }],
        },
      },
    });
    events.length = 0;

    const response = await call(
      ben,
      `/${view.id}`,
      json("PATCH", {
        name: "Same",
        filters: {
          root: {
            children: [{ values: ["high"], operator: "in", key: "priority" }],
            op: "and",
          },
        },
        display: { layout: "list", groupBy: "status" },
        displayProperties: { key: true },
        access: "workspace",
      }),
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as SavedViewJson).updatedAt).toBe(
      view.updatedAt,
    );
    expect(events).toEqual([]);

    await call(ben, `/${view.id}`, json("PATCH", { name: "Other" }));
    expect(events).toEqual([
      {
        type: "view.updated",
        data: expect.objectContaining({
          viewId: view.id,
          changes: ["name"],
        }),
      },
    ]);
  });

  it("makes a locked view read-only until it is unlocked", async () => {
    const { create, call, ben, cara, admin, project } = await viewScene();
    const view = await create(ben, { projectId: project.id, name: "Frozen" });
    events.length = 0;

    const locked = await call(ben, `/${view.id}/lock`, { method: "POST" });
    expect(locked.status).toBe(200);
    expect(await locked.json()).toMatchObject({
      isLocked: true,
      lockedBy: { id: ben.id, name: "Ben" },
      canEdit: true,
    });
    // Locking again changes nothing.
    expect(
      (await call(ben, `/${view.id}/lock`, { method: "POST" })).status,
    ).toBe(200);
    expect(events.map((event) => event.data.changes)).toEqual([["isLocked"]]);

    const update = await call(ben, `/${view.id}`, json("PATCH", { name: "X" }));
    expect(update.status).toBe(409);
    expect(await update.text()).toBe(
      "This view is locked. Unlock it to make changes.",
    );
    const remove = await call(ben, `/${view.id}`, { method: "DELETE" });
    expect(remove.status).toBe(409);
    expect(await remove.text()).toBe(
      "This view is locked. Unlock it before deleting it.",
    );
    // Someone who could not edit it gets 403, not the lock's 409.
    expect(
      (await call(cara, `/${view.id}`, json("PATCH", { name: "X" }))).status,
    ).toBe(403);
    const caraUnlock = await call(cara, `/${view.id}/unlock`, {
      method: "POST",
    });
    expect(caraUnlock.status).toBe(403);

    // Duplicating a locked view gives an unlocked copy.
    const copy = await call(cara, `/${view.id}/duplicate`, json("POST", {}));
    expect(await copy.json()).toMatchObject({
      isLocked: false,
      lockedBy: null,
    });

    const unlocked = await call(admin, `/${view.id}/unlock`, {
      method: "POST",
    });
    expect(await unlocked.json()).toMatchObject({
      isLocked: false,
      lockedBy: null,
    });
    expect(
      (await call(ben, `/${view.id}`, json("PATCH", { name: "Thawed" })))
        .status,
    ).toBe(200);
  });

  it("duplicates a visible view into a view the caller owns", async () => {
    const { create, call, ben, cara, project } = await viewScene();
    const source = await create(ben, {
      projectId: project.id,
      name: "Triage",
      description: "Daily",
      filters: {
        root: { key: "priority", operator: "in", values: ["urgent"] },
        archived: "include",
      },
      display: { layout: "spreadsheet", groupBy: null },
    });
    events.length = 0;

    const response = await call(
      cara,
      `/${source.id}/duplicate`,
      json("POST", {}),
    );
    expect(response.status).toBe(200);
    const copy = (await response.json()) as SavedViewJson;
    expect(copy).toMatchObject({
      projectId: project.id,
      name: "Triage (copy)",
      description: "Daily",
      filters: source.filters,
      display: source.display,
      displayProperties: source.displayProperties,
      access: "workspace",
      ownerId: cara.id,
      isLocked: false,
      canEdit: true,
    });
    expect(copy.id).not.toBe(source.id);
    expect(events).toEqual([
      {
        type: "view.created",
        data: expect.objectContaining({ viewId: copy.id, userId: cara.id }),
      },
    ]);

    const named = await call(
      cara,
      `/${source.id}/duplicate`,
      json("POST", { name: "Mine" }),
    );
    expect(((await named.json()) as SavedViewJson).name).toBe("Mine");
    // A body is optional.
    const bare = await call(cara, `/${source.id}/duplicate`, {
      method: "POST",
    });
    expect(bare.status).toBe(200);

    const long = await create(ben, { name: "n".repeat(255) });
    const longCopy = await call(ben, `/${long.id}/duplicate`, json("POST", {}));
    expect(((await longCopy.json()) as SavedViewJson).name).toHaveLength(255);
  });

  it("deletes a view with its favorites and recent visits", async () => {
    const { create, call, app, ben, cara, workspaceId, project } =
      await viewScene();
    const view = await create(ben, { projectId: project.id, name: "Old" });
    for (const [path, body] of [
      ["/api/favorite", { workspaceId, entityType: "view", entityId: view.id }],
      [
        "/api/recent-visit",
        { workspaceId, entityType: "view", entityId: view.id },
      ],
    ] as const) {
      const response = await app.request(path, json("POST", body));
      expect(response.status, await response.clone().text()).toBe(200);
    }
    events.length = 0;

    expect((await call(cara, `/${view.id}`, { method: "DELETE" })).status).toBe(
      403,
    );
    const deleted = await call(ben, `/${view.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({
      id: view.id,
      projectId: project.id,
    });
    expect((await call(ben, `/${view.id}`)).status).toBe(404);

    const references = await db
      .select()
      .from(schema.favoriteTable)
      .where(eq(schema.favoriteTable.entityId, view.id));
    const visits = await db
      .select()
      .from(schema.recentVisitTable)
      .where(eq(schema.recentVisitTable.entityId, view.id));
    expect([...references, ...visits]).toEqual([]);
    expect(events).toEqual([
      {
        type: "view.deleted",
        data: expect.objectContaining({
          viewId: view.id,
          projectId: project.id,
          userId: ben.id,
        }),
      },
    ]);
  });

  it("purges private views whose owner is gone, and keeps shared ones", async () => {
    const { create, list, ben, cara, admin, project } = await viewScene();
    const shared = await create(cara, { projectId: project.id, name: "Kept" });
    await create(cara, {
      projectId: project.id,
      name: "Orphan",
      access: "private",
    });
    await db.delete(schema.userTable).where(eq(schema.userTable.id, cara.id));

    const views = await list(ben, `&projectId=${project.id}`);
    expect(views.map((view) => view.name)).toEqual(["Kept"]);
    expect(views[0]).toMatchObject({
      ownerId: null,
      owner: null,
      canEdit: false,
    });
    expect((await list(admin, `&projectId=${project.id}`))[0]?.canEdit).toBe(
      true,
    );
    const rows = await db.select().from(schema.savedViewTable);
    expect(rows.map((row) => row.id)).toEqual([shared.id]);
  });

  it("scopes list and create to projects of the workspace", async () => {
    const { call, ben, workspaceId } = await viewScene();
    const outsider = await viewScene();

    const listed = await call(
      ben,
      `?workspaceId=${workspaceId}&projectId=${outsider.project.id}`,
    );
    expect(listed.status).toBe(404);
    expect(await listed.text()).toBe("Project not found");
    const created = await call(
      ben,
      "",
      json("POST", {
        workspaceId,
        projectId: outsider.project.id,
        name: "Sneaky",
      }),
    );
    expect(created.status).toBe(404);
    // Their workspace itself is off limits.
    expect(
      (await call(ben, `?workspaceId=${outsider.workspaceId}`)).status,
    ).toBe(403);
  });
});
