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

// Per-user navigation state (favorites and recent visits) and workspace
// search. Favorites and visits are per caller, so another member never sees
// them.

type Favorite = {
  id: string;
  workspaceId: string;
  entityType: string;
  entityId: string;
  position: number;
  entity: { type: string; id: string; name: string; isArchived: boolean };
};
type Visit = {
  id: string;
  entityType: string;
  entityId: string;
  entity: { name: string };
};

let world: World;
let projectA: Project;
let projectB: Project;
let task: Task;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Favorites");
  const owner = world.as("owner");
  projectA = await createProject(owner, world.workspace.id, {
    name: uniqueName("Favorite A"),
  });
  projectB = await createProject(owner, world.workspace.id, {
    name: uniqueName("Favorite B"),
  });
  task = await createTask(owner, projectA.id, {
    title: `Searchable ${Date.now().toString(36)} zebra`,
    description: "Find me by my description",
  });
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "favorite projects and a cycle, reorder them and remove them",
  covers(
    "createFavorite",
    "listFavorites",
    "reorderFavorites",
    "deleteFavoriteByEntity",
    "deleteFavorite",
  ),
  async () => {
    const member = world.as("member");
    const workspaceId = world.workspace.id;
    const favA = await expectJson<Favorite>(
      await member.post("/api/favorite", {
        data: { workspaceId, entityType: "project", entityId: projectA.id },
      }),
    );
    expect(favA.entity).toMatchObject({
      type: "project",
      id: projectA.id,
      name: projectA.name,
    });
    const favB = await expectJson<Favorite>(
      await member.post("/api/favorite", {
        data: { workspaceId, entityType: "project", entityId: projectB.id },
      }),
    );
    const cycle = await expectJson<{ id: string; name: string }>(
      await member.post(`/api/cycle/project/${projectA.id}`, {
        data: { name: uniqueName("Fav cycle") },
      }),
    );
    const favCycle = await expectJson<Favorite>(
      await member.post("/api/favorite", {
        data: { workspaceId, entityType: "cycle", entityId: cycle.id },
      }),
    );
    // Adding again returns the existing favorite.
    const again = await expectJson<Favorite>(
      await member.post("/api/favorite", {
        data: { workspaceId, entityType: "project", entityId: projectA.id },
      }),
    );
    expect(again.id).toBe(favA.id);

    // Newest on top.
    const listed = await expectJson<Favorite[]>(
      await member.get("/api/favorite", { params: { workspaceId } }),
    );
    expect(listed.map((favorite) => favorite.id)).toEqual([
      favCycle.id,
      favB.id,
      favA.id,
    ]);
    // Favorites are personal.
    expect(
      await expectJson<Favorite[]>(
        await world
          .as("admin")
          .get("/api/favorite", { params: { workspaceId } }),
      ),
    ).toEqual([]);

    const reordered = await expectJson<Favorite[]>(
      await member.put("/api/favorite/reorder", {
        params: { workspaceId },
        data: { favoriteIds: [favA.id, favB.id, favCycle.id] },
      }),
    );
    expect(reordered.map((favorite) => favorite.id)).toEqual([
      favA.id,
      favB.id,
      favCycle.id,
    ]);
    await expectStatus(
      await member.put("/api/favorite/reorder", {
        params: { workspaceId },
        data: { favoriteIds: ["e2e-unknown-favorite"] },
      }),
      400,
    );

    const byEntity = await expectJson<{ removed: boolean }>(
      await member.delete(`/api/favorite/entity/project/${projectB.id}`, {
        params: { workspaceId },
      }),
    );
    expect(byEntity.removed).toBe(true);
    const nothing = await expectJson<{ removed: boolean }>(
      await member.delete(`/api/favorite/entity/project/${projectB.id}`, {
        params: { workspaceId },
      }),
    );
    expect(nothing.removed).toBe(false);

    const byId = await expectJson<{ removed: boolean }>(
      await member.delete(`/api/favorite/${favA.id}`, {
        params: { workspaceId },
      }),
    );
    expect(byId.removed).toBe(true);
    await expectStatus(
      await member.delete(`/api/favorite/${favA.id}`, {
        params: { workspaceId },
      }),
      404,
    );
    // Another user's favorite is not found for me.
    await expectStatus(
      await world
        .as("admin")
        .delete(`/api/favorite/${favCycle.id}`, { params: { workspaceId } }),
      404,
    );

    await expectStatus(
      await member.post("/api/favorite", {
        data: { workspaceId, entityType: "task", entityId: task.id },
      }),
      400,
    );
    await expectStatus(
      await member.post("/api/favorite", {
        data: {
          workspaceId,
          entityType: "project",
          entityId: "e2e-unknown-project",
        },
      }),
      404,
    );
  },
);

test(
  "record visits and list them newest first",
  covers("recordRecentVisit", "listRecentVisits"),
  async () => {
    const viewer = world.as("viewer");
    const workspaceId = world.workspace.id;
    const first = await expectJson<Visit>(
      await viewer.post("/api/recent-visit", {
        data: { workspaceId, entityType: "project", entityId: projectB.id },
      }),
    );
    expect(first.entity.name).toBe(projectB.name);
    await expectJson(
      await viewer.post("/api/recent-visit", {
        data: { workspaceId, entityType: "task", entityId: task.id },
      }),
    );
    // Revisiting moves it back to the top.
    await expectJson(
      await viewer.post("/api/recent-visit", {
        data: { workspaceId, entityType: "project", entityId: projectB.id },
      }),
    );

    const visits = await expectJson<Visit[]>(
      await viewer.get("/api/recent-visit", { params: { workspaceId } }),
    );
    expect(visits.map((visit) => visit.entityId)).toEqual([
      projectB.id,
      task.id,
    ]);
    const tasksOnly = await expectJson<Visit[]>(
      await viewer.get("/api/recent-visit", {
        params: { workspaceId, entityType: "task", limit: "5" },
      }),
    );
    expect(tasksOnly.map((visit) => visit.entityId)).toEqual([task.id]);

    await expectStatus(
      await viewer.get("/api/recent-visit", {
        params: { workspaceId, limit: "0" },
      }),
      400,
    );
    await expectStatus(
      await viewer.post("/api/recent-visit", {
        data: { workspaceId, entityType: "task", entityId: "e2e-unknown-task" },
      }),
      404,
    );
  },
);

test(
  "search tasks, projects and comments in a workspace",
  covers("globalSearch"),
  async () => {
    const member = world.as("member");
    await expectJson(
      await member.post(`/api/comment/${task.id}`, {
        data: { content: "A comment about giraffes" },
      }),
    );
    type Results = {
      results: { type: string; id: string; title?: string }[];
      totalCount: number;
      searchQuery: string;
    };
    const found = await expectJson<Results>(
      await member.get("/api/search", {
        params: { q: "zebra", workspaceId: world.workspace.id },
      }),
    );
    expect(found.searchQuery).toBe("zebra");
    expect(
      found.results.some(
        (result) => result.type === "task" && result.id === task.id,
      ),
    ).toBe(true);

    const projects = await expectJson<Results>(
      await member.get("/api/search", {
        params: {
          q: projectB.name,
          type: "projects",
          workspaceId: world.workspace.id,
        },
      }),
    );
    expect(projects.results.map((result) => result.id)).toContain(projectB.id);
    expect(projects.results.every((result) => result.type === "project")).toBe(
      true,
    );

    const comments = await expectJson<Results>(
      await member.get("/api/search", {
        params: {
          q: "giraffes",
          type: "comments",
          workspaceId: world.workspace.id,
        },
      }),
    );
    expect(comments.totalCount).toBeGreaterThanOrEqual(1);

    await expectStatus(
      await member.get("/api/search", {
        params: { q: "", workspaceId: world.workspace.id },
      }),
      400,
    );
    await expectStatus(
      await member.get("/api/search", {
        params: {
          q: "zebra",
          type: "everything",
          workspaceId: world.workspace.id,
        },
      }),
      400,
    );
  },
);
