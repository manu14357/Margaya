import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { encodeScope } from "../../apps/api/src/api-key/scope";
import db, { schema } from "../../apps/api/src/database";
import { projectMemberTable } from "../../apps/api/src/database/schema";
import { createApiKey } from "./helpers/api-keys";
import { addPerson } from "./helpers/assignees";
import { mockAnonymousSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  allowPublicPages,
  setWhiteboardsEnabled,
  sticky,
  type WhiteboardJson,
  type WhiteboardScene,
  whiteboardScene,
} from "./helpers/whiteboards";

type WorkspaceBoard = Omit<WhiteboardJson, "capabilities"> & {
  project: { id: string; name: string; slug: string; icon: string | null };
};

let s: WhiteboardScene;
let other: Awaited<ReturnType<typeof createProjectFixture>>["project"];

beforeEach(async () => {
  await resetTestDatabase();
  s = await whiteboardScene();
  ({ project: other } = await createProjectFixture({
    workspaceId: s.workspaceId,
    name: "Mobile",
    icon: "Smartphone",
    slug: `mob${randomUUID().slice(0, 4)}`,
  }));
});

const list = (
  user: WhiteboardScene["ben"],
  query = "",
  workspaceId = s.workspaceId,
) =>
  s.ok<{ whiteboards: WorkspaceBoard[] }>(
    user,
    `/whiteboard/workspace/${workspaceId}${query}`,
  );

const titles = (result: { whiteboards: WorkspaceBoard[] }) =>
  result.whiteboards.map((board) => board.title);

describe("listWorkspaceWhiteboards", () => {
  it("lists boards of every project, newest first, with their projects", async () => {
    const web = await s.create(s.ben, {
      title: "Web retro",
      elements: [sticky("Ship onboarding")],
    });
    await s.create(s.cara, { title: "Mobile map" }, other.id);

    const result = await list(s.viewer);
    expect(titles(result)).toEqual(["Mobile map", "Web retro"]);
    expect(result.whiteboards[0]?.project).toEqual({
      id: other.id,
      name: "Mobile",
      slug: other.slug,
      icon: "Smartphone",
    });
    expect(result.whiteboards[1]).toMatchObject({
      id: web.id,
      projectId: s.project.id,
      elementCount: 1,
      createdBy: { id: s.ben.id, name: "Ben" },
    });
    expect(result.whiteboards[1]).not.toHaveProperty("contentText");
    expect(result.whiteboards[1]).not.toHaveProperty("capabilities");

    // Board text is searchable, and LIKE wildcards are taken literally.
    expect(titles(await list(s.viewer, "?q=onboard"))).toEqual(["Web retro"]);
    expect(titles(await list(s.viewer, "?q=%25"))).toEqual([]);
  });

  it("lists archived boards only when asked", async () => {
    const board = await s.create(s.ben, { title: "Old plan" });
    await s.create(s.ben, { title: "Live plan" }, other.id);
    await s.ok(s.ben, `/whiteboard/${board.id}/archive`, { method: "POST" });

    expect(titles(await list(s.viewer))).toEqual(["Live plan"]);
    expect(titles(await list(s.viewer, "?archived=true"))).toEqual([
      "Old plan",
    ]);
    // Boards in the trash never show.
    await s.ok(s.ben, `/whiteboard/${board.id}`, { method: "DELETE" });
    expect(titles(await list(s.viewer, "?archived=true"))).toEqual([]);
  });

  it("leaves out projects with Whiteboards off or in the trash", async () => {
    await s.create(s.ben, { title: "Web board" });
    await s.create(s.ben, { title: "Mobile board" }, other.id);

    await setWhiteboardsEnabled(other.id, false);
    expect(titles(await list(s.owner))).toEqual(["Web board"]);
    await setWhiteboardsEnabled(other.id, true);
    expect(titles(await list(s.owner))).toEqual(["Mobile board", "Web board"]);

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, s.project.id));
    expect(titles(await list(s.owner))).toEqual(["Mobile board"]);
  });

  it("hides restricted projects from people outside them", async () => {
    await s.create(s.ben, { title: "Web board" });
    await s.create(s.ben, { title: "Secret board" }, other.id);
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, other.id));

    expect(titles(await list(s.cara))).toEqual(["Web board"]);
    // Admins reach restricted projects; project members do too.
    expect(titles(await list(s.admin))).toEqual(["Secret board", "Web board"]);
    await db.insert(projectMemberTable).values({
      projectId: other.id,
      userId: s.cara.id,
      role: "member",
    });
    expect(titles(await list(s.cara))).toEqual(["Secret board", "Web board"]);
  });

  it("shows a public link only where the caller may manage the board", async () => {
    await allowPublicPages(s.workspaceId, true);
    const board = await s.create(s.ben, { title: "Shared" }, other.id);
    await s.ok(s.owner, `/whiteboard/${board.id}/publication`, {
      method: "POST",
    });

    const [own] = (await list(s.ben)).whiteboards;
    expect(own?.publicToken).toEqual(expect.any(String));
    const [theirs] = (await list(s.cara)).whiteboards;
    expect(theirs?.publicToken).toBeNull();
    expect(theirs?.publishedAt).not.toBeNull();

    // A viewer role in a restricted project caps the creator's rights there.
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, other.id));
    await db.insert(projectMemberTable).values({
      projectId: other.id,
      userId: s.ben.id,
      role: "viewer",
    });
    const [capped] = (await list(s.ben)).whiteboards;
    expect(capped?.id).toBe(board.id);
    expect(capped?.publicToken).toBeNull();
  });

  it("needs a signed-in member with whiteboard:read", async () => {
    await s.create(s.ben, { title: "Web board" });

    mockAnonymousSession();
    const anonymous = await s.app.request(
      `/api/whiteboard/workspace/${s.workspaceId}`,
    );
    expect(anonymous.status).toBe(401);

    const outsider = await createWorkspaceMember({
      role: "owner",
      userName: "Otto",
    });
    const foreign = await s.call(
      outsider.user,
      `/whiteboard/workspace/${s.workspaceId}`,
    );
    expect(foreign.status).toBe(403);
    // Their own workspace has no boards of ours.
    expect(
      (await list(outsider.user, "", outsider.workspace.id)).whiteboards,
    ).toEqual([]);

    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: s.workspaceId,
      role: "reporter",
      permission: JSON.stringify({ workspace: ["read"], task: ["read"] }),
    });
    const reporter = await addPerson(s.workspaceId, "Rae", "reporter");
    const denied = await s.call(
      reporter,
      `/whiteboard/workspace/${s.workspaceId}`,
    );
    expect(denied.status).toBe(403);
  });

  it("honours API key scopes, and refuses project-limited keys and guests", async () => {
    await s.create(s.ben, { title: "Web board" });
    mockAnonymousSession();

    const full = await createApiKey(s.ben);
    const allowed = await s.app.request(
      `/api/whiteboard/workspace/${s.workspaceId}`,
      { headers: full.headers },
    );
    expect(allowed.status, await allowed.clone().text()).toBe(200);

    const narrow = await createApiKey(s.ben, { task: ["read"] });
    const refused = await s.app.request(
      `/api/whiteboard/workspace/${s.workspaceId}`,
      { headers: narrow.headers },
    );
    expect(refused.status).toBe(403);

    // Workspace-wide routes fail closed for keys limited to some projects.
    const scoped = await createApiKey(
      s.ben,
      encodeScope({ access: "full", projectIds: [other.id] }) ?? undefined,
    );
    const limited = await s.app.request(
      `/api/whiteboard/workspace/${s.workspaceId}`,
      { headers: scoped.headers },
    );
    expect(limited.status).toBe(403);

    // Guests reach their projects only, never workspace-wide lists.
    const guest = await addPerson(s.workspaceId, "Gus", "guest");
    expect(
      (await s.call(guest, `/whiteboard/workspace/${s.workspaceId}`)).status,
    ).toBe(404);
  });

  it("is not captured by the board id routes", async () => {
    // "workspace" is not read as a board id by /{id}/... routes.
    const board = await s.create(s.ben, { title: "Web board" });
    expect(titles(await list(s.viewer))).toEqual(["Web board"]);
    const stray = await s.call(s.viewer, "/whiteboard/workspace");
    expect(stray.status).toBe(404);
    expect(board.id).not.toBe("workspace");
  });
});
