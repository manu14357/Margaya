import { beforeEach, describe, expect, it } from "vitest";
import { isFilterKeyRegistered } from "../../apps/api/src/task-query/keys";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { assignTask } from "./helpers/fixtures";
import { json, type SavedViewJson, viewScene } from "./helpers/views";

type Favorite = {
  entityType: string;
  entityId: string;
  entity: {
    type: string;
    name: string;
    icon: string | null;
    projectId: string | null;
    feature: string | null;
    details: Record<string, unknown> | null;
  };
};

const FEATURE_OFF = "The Views feature is turned off for this project.";

describe("API integration: saved view feature gate, favorites and built-ins", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("answers 403 on every project-view route while views are off", async () => {
    const { app, create, call, ben, owner, workspaceId, project } =
      await viewScene();
    const view = await create(ben, { projectId: project.id, name: "Gated" });
    const workspaceView = await create(ben, { name: "Free" });

    mockAuthenticatedSession(owner);
    const off = await app.request(
      `/api/project/${project.id}/features`,
      json("PATCH", { viewsEnabled: false }),
    );
    expect(off.status).toBe(200);

    const routes: Array<[string, RequestInit | undefined]> = [
      [`?workspaceId=${workspaceId}&projectId=${project.id}`, undefined],
      ["", json("POST", { workspaceId, projectId: project.id, name: "New" })],
      [`/${view.id}`, undefined],
      [`/${view.id}`, json("PATCH", { name: "Renamed" })],
      [`/${view.id}/lock`, { method: "POST" }],
      [`/${view.id}/unlock`, { method: "POST" }],
      [`/${view.id}/duplicate`, json("POST", {})],
      [`/${view.id}`, { method: "DELETE" }],
    ];
    for (const [path, init] of routes) {
      const response = await call(ben, path, init);
      expect(response.status, `${init?.method ?? "GET"} ${path}`).toBe(403);
      expect(await response.text()).toBe(FEATURE_OFF);
    }

    // Workspace views are never gated.
    expect((await call(ben, `/${workspaceView.id}`)).status).toBe(200);
    expect(
      (
        await call(
          ben,
          `/${workspaceView.id}`,
          json("PATCH", { name: "Still" }),
        )
      ).status,
    ).toBe(200);
    expect((await call(ben, `?workspaceId=${workspaceId}`)).status).toBe(200);

    mockAuthenticatedSession(owner);
    await app.request(
      `/api/project/${project.id}/features`,
      json("PATCH", { viewsEnabled: true }),
    );
    expect((await call(ben, `/${view.id}`)).status).toBe(200);
  });

  it("resolves favorites and recent visits for the caller only", async () => {
    const { app, create, call, ben, cara, workspaceId, project } =
      await viewScene();
    const shared = await create(ben, {
      projectId: project.id,
      name: "Shared",
      display: { layout: "board" },
    });
    const secret = await create(ben, {
      name: "Secret",
      access: "private",
    });

    const favorite = (entityId: string) =>
      app.request(
        "/api/favorite",
        json("POST", { workspaceId, entityType: "view", entityId }),
      );
    const visit = (entityId: string) =>
      app.request(
        "/api/recent-visit",
        json("POST", { workspaceId, entityType: "view", entityId }),
      );
    const favorites = async () => {
      const response = await app.request(
        `/api/favorite?workspaceId=${workspaceId}`,
      );
      expect(response.status).toBe(200);
      return (await response.json()) as Favorite[];
    };

    // Ben sees both, and gets the view's summary.
    mockAuthenticatedSession(ben);
    expect((await favorite(shared.id)).status).toBe(200);
    expect((await favorite(secret.id)).status).toBe(200);
    expect((await visit(secret.id)).status).toBe(200);
    expect(await favorites()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: shared.id,
          entity: expect.objectContaining({
            type: "view",
            name: "Shared",
            icon: "Layers",
            projectId: project.id,
            feature: "views",
            details: {
              access: "workspace",
              layout: "board",
              isLocked: false,
              ownerId: ben.id,
            },
          }),
        }),
        expect.objectContaining({
          entityId: secret.id,
          entity: expect.objectContaining({
            projectId: null,
            feature: null,
          }),
        }),
      ]),
    );

    // Cara can't reach Ben's private view through favorites or recents.
    mockAuthenticatedSession(cara);
    const denied = await favorite(secret.id);
    expect(denied.status).toBe(404);
    expect(await denied.text()).toBe("Entity not found");
    expect((await visit(secret.id)).status).toBe(404);
    expect((await favorite(shared.id)).status).toBe(200);
    expect((await visit(shared.id)).status).toBe(200);
    expect((await favorites()).map((row) => row.entityId)).toEqual([shared.id]);

    // Once Ben makes it private, it disappears from Cara's favorites.
    const madePrivate = await call(
      ben,
      `/${shared.id}`,
      json("PATCH", { access: "private" }),
    );
    expect(madePrivate.status).toBe(200);
    mockAuthenticatedSession(cara);
    expect(await favorites()).toEqual([]);
    const recents = await app.request(
      `/api/recent-visit?workspaceId=${workspaceId}`,
    );
    expect(await recents.json()).toEqual([]);
    mockAuthenticatedSession(ben);
    expect(await favorites()).toHaveLength(2);
  });

  it("hides project view favorites while views are off", async () => {
    const { app, create, owner, workspaceId, project } = await viewScene();
    const view = await create(owner, { projectId: project.id, name: "Mine" });
    mockAuthenticatedSession(owner);
    await app.request(
      "/api/favorite",
      json("POST", { workspaceId, entityType: "view", entityId: view.id }),
    );
    const favorites = async () =>
      (await (
        await app.request(`/api/favorite?workspaceId=${workspaceId}`)
      ).json()) as Favorite[];
    const setViews = (viewsEnabled: boolean) =>
      app.request(
        `/api/project/${project.id}/features`,
        json("PATCH", { viewsEnabled }),
      );

    expect(await favorites()).toHaveLength(1);
    await setViews(false);
    expect(await favorites()).toEqual([]);
    await setViews(true);
    expect(await favorites()).toHaveLength(1);
  });

  it("lists the built-in workspace views", async () => {
    const { call, viewer, workspaceId } = await viewScene();
    const outsider = await viewScene();

    const response = await call(viewer, `/built-in?workspaceId=${workspaceId}`);
    expect(response.status).toBe(200);
    const views = (await response.json()) as Array<{
      key: string;
      name: string;
      baseFilter: unknown;
      filters: unknown;
      display: SavedViewJson["display"];
    }>;
    const expected = ["all", "assigned", "created"];
    if (isFilterKeyRegistered("subscriber")) expected.push("subscribed");
    expect(views.map((view) => view.key)).toEqual(expected);
    expect(views[0]).toMatchObject({
      name: "All tasks",
      baseFilter: null,
      filters: { version: 1, root: null, archived: "exclude" },
      display: {
        layout: "spreadsheet",
        groupBy: null,
        orderBy: { field: "createdAt", direction: "desc" },
      },
    });
    expect(views[1]?.baseFilter).toEqual({
      key: "assignee",
      operator: "in",
      values: ["me"],
    });

    expect(
      (await call(viewer, `/built-in?workspaceId=${outsider.workspaceId}`))
        .status,
    ).toBe(403);
  });

  it("stores filters that run unchanged as a task query, for whoever opens them", async () => {
    const { app, create, ben, cara, workspaceId, project, insertTask } =
      await viewScene();
    const mine = await insertTask(project.id, "Ben's");
    const hers = await insertTask(project.id, "Cara's");
    await assignTask(mine.id, [ben.id]);
    await assignTask(hers.id, [cara.id]);
    const view = await create(ben, {
      projectId: project.id,
      name: "Assigned to me",
      filters: {
        root: { key: "assignee", operator: "in", values: ["me"] },
      },
    });

    const run = async () => {
      const response = await app.request(
        "/api/task-query",
        json("POST", {
          workspaceId,
          scope: { projectIds: [project.id] },
          filters: view.filters.root,
          archived: view.filters.archived,
          display: {
            groupBy: view.display.groupBy,
            orderBy: view.display.orderBy,
          },
        }),
      );
      expect(response.status).toBe(200);
      const result = (await response.json()) as {
        tasks: Record<string, { title: string }>;
      };
      return Object.values(result.tasks).map((task) => task.title);
    };

    mockAuthenticatedSession(ben);
    expect(await run()).toEqual(["Ben's"]);
    mockAuthenticatedSession(cara);
    expect(await run()).toEqual(["Cara's"]);
  });
});
