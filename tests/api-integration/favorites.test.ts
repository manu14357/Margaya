import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type Favorite = {
  id: string;
  entityType: string;
  entityId: string;
  position: number;
  entity: { name: string; key: string | null; isArchived: boolean };
};

const favoriteEvents: Array<Record<string, unknown>> = [];
await subscribeToEvent<Record<string, unknown>>(
  "favorite.changed",
  async (data) => {
    favoriteEvents.push(data);
  },
);

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function context(role = "member") {
  const member = await createWorkspaceMember({ role });
  mockAuthenticatedSession(member.user);
  const { app } = createApp();
  const workspaceId = member.workspace.id;

  const addFavorite = (entityId: string, entityType = "project") =>
    app.request(
      "/api/favorite",
      json("POST", { workspaceId, entityType, entityId }),
    );
  const list = async () => {
    const response = await app.request(
      `/api/favorite?workspaceId=${workspaceId}`,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as Favorite[];
  };
  const project = async (slug: string) =>
    (await createProjectFixture({ workspaceId, slug, name: slug })).project;

  return { ...member, app, workspaceId, addFavorite, list, project };
}

describe("API integration: favorites", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    favoriteEvents.length = 0;
  });

  it("adds a project favorite once and lists new favorites first", async () => {
    const { addFavorite, list, project, user, workspaceId } = await context();
    const alpha = await project("alpha");
    const beta = await project("beta");

    const first = await addFavorite(alpha.id);
    expect(first.status).toBe(200);
    const created = (await first.json()) as Favorite;
    expect(created).toMatchObject({
      entityType: "project",
      entityId: alpha.id,
      position: 0,
      entity: { name: "alpha", key: "alpha", isArchived: false },
    });

    const again = await addFavorite(alpha.id);
    expect(((await again.json()) as Favorite).id).toBe(created.id);

    await addFavorite(beta.id);
    expect((await list()).map((f) => f.entityId)).toEqual([beta.id, alpha.id]);

    // The repeated add changed nothing, so only two events fired.
    expect(favoriteEvents).toEqual([
      expect.objectContaining({ userId: user.id, workspaceId }),
      expect.objectContaining({ userId: user.id, workspaceId }),
    ]);
  });

  it("reorders favorites and keeps omitted ones in their rank", async () => {
    const { app, addFavorite, list, project, workspaceId } = await context();
    const ids: string[] = [];
    for (const slug of ["a", "b", "c"]) {
      const favorite = (await (
        await addFavorite((await project(slug)).id)
      ).json()) as Favorite;
      ids.push(favorite.id);
    }
    // Newest first: c, b, a.
    const [a, b, c] = ids as [string, string, string];

    const response = await app.request(
      `/api/favorite/reorder?workspaceId=${workspaceId}`,
      json("PUT", { favoriteIds: [a, c] }),
    );
    expect(response.status).toBe(200);
    const reordered = (await response.json()) as Favorite[];
    expect(reordered.map((f) => f.id)).toEqual([a, b, c]);
    expect(reordered.map((f) => f.position)).toEqual([0, 1, 2]);
    expect((await list()).map((f) => f.id)).toEqual([a, b, c]);
  });

  it("refuses to reorder or delete another user's favorites", async () => {
    const { app, addFavorite, project, workspaceId } = await context();
    const own = (await (
      await addFavorite((await project("mine")).id)
    ).json()) as Favorite;
    const other = await addWorkspaceMember(workspaceId, "member");

    mockAuthenticatedSession(other);
    const reorder = await app.request(
      `/api/favorite/reorder?workspaceId=${workspaceId}`,
      json("PUT", { favoriteIds: [own.id] }),
    );
    expect(reorder.status).toBe(400);
    expect(await reorder.text()).toBe(
      `Favorite ${own.id} does not belong to you`,
    );

    const remove = await app.request(
      `/api/favorite/${own.id}?workspaceId=${workspaceId}`,
      { method: "DELETE" },
    );
    expect(remove.status).toBe(404);

    const otherList = await app.request(
      `/api/favorite?workspaceId=${workspaceId}`,
    );
    expect(await otherList.json()).toEqual([]);
  });

  it("removes favorites by id and by entity", async () => {
    const { app, addFavorite, list, project, workspaceId } = await context();
    const alpha = await project("alpha");
    const beta = await project("beta");
    const favorite = (await (await addFavorite(alpha.id)).json()) as Favorite;
    await addFavorite(beta.id);

    const byId = await app.request(
      `/api/favorite/${favorite.id}?workspaceId=${workspaceId}`,
      { method: "DELETE" },
    );
    expect(await byId.json()).toEqual({ removed: true });

    const byEntity = () =>
      app.request(
        `/api/favorite/entity/project/${beta.id}?workspaceId=${workspaceId}`,
        { method: "DELETE" },
      );
    expect(await (await byEntity()).json()).toEqual({ removed: true });
    expect(await (await byEntity()).json()).toEqual({ removed: false });
    expect(await list()).toEqual([]);
  });

  it("rejects entities from other workspaces and unsupported types", async () => {
    const { addFavorite } = await context();
    const other = await createWorkspaceMember();
    const { project: foreign } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });

    const crossWorkspace = await addFavorite(foreign.id);
    expect(crossWorkspace.status).toBe(404);
    expect(await crossWorkspace.text()).toBe("Entity not found");

    // Every entity type is supported now that pages have a resolver.
    const page = await addFavorite("some-page", "page");
    expect(page.status).toBe(404);
    expect(await page.text()).toBe("Entity not found");

    const view = await addFavorite("some-view", "view");
    expect(view.status).toBe(404);
    expect(await view.text()).toBe("Entity not found");

    const module = await addFavorite("some-module", "module");
    expect(module.status).toBe(404);
    expect(await module.text()).toBe("Entity not found");

    const cycle = await addFavorite("some-cycle", "cycle");
    expect(cycle.status).toBe(404);
    expect(await cycle.text()).toBe("Entity not found");

    const task = await addFavorite("some-task", "task");
    expect(task.status).toBe(400);
  });

  it("hides archived projects until they are restored", async () => {
    const { app, addFavorite, list, project } = await context("owner");
    const kept = await project("kept");
    const archived = await project("gone");
    await addFavorite(kept.id);
    await addFavorite(archived.id);

    await app.request(`/api/project/${archived.id}/archive`, { method: "PUT" });
    expect((await list()).map((f) => f.entityId)).toEqual([kept.id]);

    const third = await project("third");
    await app.request(`/api/project/${third.id}/archive`, { method: "PUT" });
    const refused = await addFavorite(third.id);
    expect(refused.status).toBe(409);

    await app.request(`/api/project/${archived.id}/unarchive`, {
      method: "PUT",
    });
    expect((await list()).map((f) => f.entityId)).toEqual([
      archived.id,
      kept.id,
    ]);
  });

  it("drops favorites when their project is deleted", async () => {
    const { addFavorite, list, project, user } = await context();
    const doomed = await project("doomed");
    await addFavorite(doomed.id);

    await db
      .delete(schema.projectTable)
      .where(eq(schema.projectTable.id, doomed.id));

    expect(await list()).toEqual([]);
    const rows = await db
      .select()
      .from(schema.favoriteTable)
      .where(eq(schema.favoriteTable.userId, user.id));
    expect(rows).toHaveLength(0);
  });

  it("caps favorites at 100 per user and workspace", async () => {
    const { addFavorite, project, user, workspaceId } = await context();
    await db.insert(schema.favoriteTable).values(
      Array.from({ length: 100 }, (_, index) => ({
        userId: user.id,
        workspaceId,
        entityType: "project" as const,
        entityId: `placeholder-${index}`,
        position: index,
      })),
    );

    const response = await addFavorite((await project("one-too-many")).id);

    expect(response.status).toBe(409);
    expect(await response.text()).toBe("You can have up to 100 favorites");
  });

  it("lets viewers favorite and keeps non-members out", async () => {
    const { app, addFavorite, project, workspaceId } = await context("viewer");

    expect((await addFavorite((await project("seen")).id)).status).toBe(200);

    const outsider = await createWorkspaceMember();
    mockAuthenticatedSession(outsider.user);
    const response = await app.request(
      `/api/favorite?workspaceId=${workspaceId}`,
    );
    expect(response.status).toBe(403);
  });
});
