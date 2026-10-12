import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { backfillRolePermissions } from "../../apps/api/src/utils/backfill-role-permissions";
import { mockAnonymousSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { addWorkspaceMember } from "./helpers/fixtures";
import { json, type SavedViewJson, viewScene } from "./helpers/views";

async function permissionScene() {
  const scene = await viewScene();
  const { create, ben, cara, project, workspaceId } = scene;
  const bens = await create(ben, { projectId: project.id, name: "Ben's" });
  const caras = await create(cara, { projectId: project.id, name: "Cara's" });
  const reads: Record<string, [string, RequestInit | undefined]> = {
    listViews: [
      `?workspaceId=${workspaceId}&projectId=${project.id}`,
      undefined,
    ],
    getView: [`/${caras.id}`, undefined],
  };
  const writes: Record<string, [string, RequestInit]> = {
    createView: [
      "",
      json("POST", { workspaceId, projectId: project.id, name: "New" }),
    ],
    duplicateView: [`/${caras.id}/duplicate`, json("POST", {})],
    updateView: [`/${bens.id}`, json("PATCH", { name: "Renamed" })],
    lockView: [`/${bens.id}/lock`, { method: "POST" }],
    unlockView: [`/${bens.id}/unlock`, { method: "POST" }],
    deleteView: [`/${bens.id}`, { method: "DELETE" }],
  };
  return { ...scene, bens, caras, reads, writes };
}

describe("API integration: saved view permissions", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("requires a session", async () => {
    const { app, workspaceId } = await viewScene();
    mockAnonymousSession();
    const response = await app.request(`/api/view?workspaceId=${workspaceId}`);
    expect(response.status).toBe(401);
  });

  it("lets viewers read views but not change them", async () => {
    const { call, viewer, reads, writes } = await permissionScene();
    for (const [name, [path, init]] of Object.entries(reads)) {
      const response = await call(viewer, path, init);
      expect(response.status, name).toBe(200);
      if (name === "getView") {
        expect(await response.json()).toMatchObject({
          canEdit: false,
          canDelete: false,
        });
      }
    }
    for (const [name, [path, init]] of Object.entries(writes)) {
      const response = await call(viewer, path, init);
      expect(response.status, name).toBe(403);
      expect(await response.text(), name).toBe("Insufficient permissions");
    }
  });

  it("lets members manage their own views only", async () => {
    const { call, ben, bens, caras, writes } = await permissionScene();

    const own = await call(ben, `/${bens.id}`);
    expect(await own.json()).toMatchObject({ canEdit: true, canDelete: true });
    const theirs = await call(ben, `/${caras.id}`);
    expect(await theirs.json()).toMatchObject({
      canEdit: false,
      canDelete: false,
    });

    for (const [name, [path, init]] of Object.entries(writes)) {
      const response = await call(ben, path, init);
      expect(response.status, `${name}: ${await response.text()}`).toBe(200);
    }

    const refusals: Array<[string, RequestInit, string]> = [
      [
        `/${caras.id}`,
        json("PATCH", { name: "Mine" }),
        "Only the view's owner or an admin can change it",
      ],
      [
        `/${caras.id}/lock`,
        { method: "POST" },
        "Only the view's owner or an admin can change it",
      ],
      [
        `/${caras.id}`,
        { method: "DELETE" },
        "Only the view's owner or an admin can delete it",
      ],
    ];
    for (const [path, init, message] of refusals) {
      const response = await call(ben, path, init);
      expect(response.status, path).toBe(403);
      expect(await response.text()).toBe(message);
    }
  });

  it("lets admins and owners manage anyone's shared views", async () => {
    const { call, admin, owner, caras, list, project } =
      await permissionScene();
    for (const user of [admin, owner]) {
      const views = await list(user, `&projectId=${project.id}`);
      expect(views.every((view) => view.canEdit && view.canDelete)).toBe(true);
    }
    for (const [path, init] of [
      [`/${caras.id}`, json("PATCH", { name: "Curated" })],
      [`/${caras.id}/lock`, { method: "POST" }],
      [`/${caras.id}/unlock`, { method: "POST" }],
    ] as const) {
      expect((await call(admin, path, init)).status, path).toBe(200);
    }
    const locked = await call(owner, `/${caras.id}/lock`, { method: "POST" });
    expect(((await locked.json()) as SavedViewJson).lockedBy?.id).toBe(
      owner.id,
    );
    await call(owner, `/${caras.id}/unlock`, { method: "POST" });
    expect(
      (await call(admin, `/${caras.id}`, { method: "DELETE" })).status,
    ).toBe(200);
  });

  it("follows custom role statements", async () => {
    const { call, workspaceId, reads, writes, caras } = await permissionScene();
    await db.insert(schema.workspaceRoleTable).values([
      {
        workspaceId,
        role: "reporter",
        permission: JSON.stringify({ task: ["read"], project: ["read"] }),
      },
      {
        workspaceId,
        role: "curator",
        permission: JSON.stringify({ view: ["read", "delete"] }),
      },
    ]);
    const reporter = await addWorkspaceMember(workspaceId, "reporter");
    for (const [name, [path, init]] of Object.entries({
      ...reads,
      ...writes,
    })) {
      const response = await call(reporter, path, init);
      expect(response.status, name).toBe(403);
    }
    // The built-ins are task lists: task:read is enough.
    expect(
      (await call(reporter, `/built-in?workspaceId=${workspaceId}`)).status,
    ).toBe(200);

    // view:delete makes someone an admin of views, but the routes that
    // change a view still ask for view:update.
    const curator = await addWorkspaceMember(workspaceId, "curator");
    const read = await call(curator, `/${caras.id}`);
    expect(await read.json()).toMatchObject({ canEdit: true, canDelete: true });
    expect(
      (await call(curator, `/${caras.id}`, json("PATCH", { name: "X" })))
        .status,
    ).toBe(403);
  });

  it("keeps other workspaces out", async () => {
    const { call, reads, writes } = await permissionScene();
    const outsider = await viewScene();
    for (const [name, [path, init]] of Object.entries({
      ...reads,
      ...writes,
    })) {
      const response = await call(outsider.owner, path, init);
      expect(response.status, name).toBe(403);
      expect(await response.text(), name).not.toContain("Cara");
    }
  });

  it("backfills the view resource into existing default roles once", async () => {
    const { call, ben, workspaceId, project } = await viewScene();
    // Rows as seeded before views existed.
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId,
      role: "member",
      permission: JSON.stringify({
        project: ["create", "read"],
        task: ["create", "read", "update"],
        workspace: ["read"],
      }),
    });
    await db
      .delete(schema.rolePermissionBackfillTable)
      .where(eq(schema.rolePermissionBackfillTable.resource, "view"));
    const listPath = `?workspaceId=${workspaceId}&projectId=${project.id}`;
    expect((await call(ben, listPath)).status).toBe(403);

    const result = await backfillRolePermissions();
    expect(result?.pending).toContain("view");
    const [row] = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.role, "member"));
    expect(JSON.parse(row?.permission ?? "{}").view).toEqual([
      "create",
      "read",
      "update",
    ]);
    expect((await call(ben, listPath)).status).toBe(200);
    expect(await backfillRolePermissions()).toBeNull();
  });
});
