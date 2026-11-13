import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import {
  coMemberIds,
  entityReferenceHolders,
  workspaceMemberIds,
} from "../../apps/api/src/ws/audience";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Who hears a workspace-wide realtime hint: drawn from membership and the
// person's own rows, never from outside the workspace.

const published: Array<{ name: string; data: Record<string, unknown> }> = [];
for (const name of ["label.changed", "project.reordered"]) {
  await subscribeToEvent<Record<string, unknown>>(name, async (data) => {
    published.push({ name, data });
  });
}

beforeEach(async () => {
  await resetTestDatabase();
  published.length = 0;
});

describe("realtime audiences", () => {
  it("lists a workspace's members and nobody from another workspace", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const teammate = await addWorkspaceMember(workspace.id, "guest");
    const outsider = await createWorkspaceMember();

    const members = await workspaceMemberIds(workspace.id);
    expect(new Set(members)).toEqual(new Set([user.id, teammate.id]));
    expect(members).not.toContain(outsider.user.id);
  });

  it("finds co-members across every workspace the person is in", async () => {
    const first = await createWorkspaceMember();
    const second = await createWorkspaceMember();
    const firstTeammate = await addWorkspaceMember(first.workspace.id);
    const secondTeammate = await addWorkspaceMember(second.workspace.id);
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: second.workspace.id,
      userId: first.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    const stranger = await createWorkspaceMember();

    const ids = new Set(await coMemberIds(first.user.id));
    expect(ids).toEqual(
      new Set([
        first.user.id,
        firstTeammate.id,
        second.user.id,
        secondTeammate.id,
      ]),
    );
    expect(ids.has(stranger.user.id)).toBe(false);
  });

  it("finds the holders of favorites and recent visits of an entity", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const visitor = await addWorkspaceMember(workspace.id);
    await addWorkspaceMember(workspace.id);
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await db.insert(schema.favoriteTable).values({
      userId: user.id,
      workspaceId: workspace.id,
      projectId: project.id,
      entityType: "project",
      entityId: project.id,
    });
    await db.insert(schema.recentVisitTable).values({
      userId: visitor.id,
      workspaceId: workspace.id,
      projectId: project.id,
      entityType: "project",
      entityId: project.id,
    });

    const holders = await entityReferenceHolders("project", [project.id]);
    expect(holders).toHaveLength(2);
    expect(holders).toEqual(
      expect.arrayContaining([
        { userId: user.id, workspaceId: workspace.id },
        { userId: visitor.id, workspaceId: workspace.id },
      ]),
    );
    expect(await entityReferenceHolders("project", [])).toEqual([]);
  });
});

describe("events behind the hints", () => {
  it("a workspace label rename publishes label.changed", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(user);
    const { app } = createApp();
    const created = await app.request("/api/label", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Bug",
        color: "#ff0000",
        workspaceId: workspace.id,
      }),
    });
    expect(created.status).toBe(200);
    const label = (await created.json()) as { id: string };

    const renamed = await app.request(`/api/label/${label.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Defect", color: "#00ff00" }),
    });
    expect(renamed.status).toBe(200);
    await expect
      .poll(() => published.filter((e) => e.name === "label.changed").length)
      .toBe(2);
    expect(published[0]?.data.workspaceId).toBe(workspace.id);
  });

  it("reordering projects publishes project.reordered", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(user);
    const { project: first } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const { project: second } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const { app } = createApp();
    const response = await app.request(
      `/api/project/reorder?workspaceId=${workspace.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          projects: [
            { id: second.id, position: 0 },
            { id: first.id, position: 1 },
          ],
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(published).toContainEqual({
      name: "project.reordered",
      data: expect.objectContaining({ workspaceId: workspace.id }),
    });
  });
});
