import { and, eq } from "drizzle-orm";
import type { WSContext } from "hono/ws";
import { beforeEach, describe, expect, it } from "vitest";
import { PROJECTS_MARKER } from "../../apps/api/src/api-key/scope";
import { settleAuditWrites } from "../../apps/api/src/audit-log/record";
import db, { schema } from "../../apps/api/src/database";
import {
  instanceAuditLogTable,
  projectMemberTable,
} from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import {
  addConnection,
  initializeWebSocketAdapter,
  PROJECT_ACCESS_REVOKED_CLOSE_CODE,
  removeConnection,
} from "../../apps/api/src/ws";
import { createApiKey } from "./helpers/api-keys";
import { auditRows } from "./helpers/audit-log";
import { createProjectFixture } from "./helpers/fixtures";
import {
  authPost,
  resetInstanceState,
  signUpWithSession,
} from "./helpers/instance-admin";

// What removing someone from a workspace does to their credentials: it ends
// them when nothing else is left, and otherwise only what belonged to this
// workspace. Sessions and keys are account-wide, and other workspaces aren't
// this workspace's admins' to break.

type App = ReturnType<typeof createApp>["app"];
type Signed = Awaited<ReturnType<typeof signUpWithSession>>;

let app: App;
let owner: Signed;
let person: Signed;
let workspaceId: string;
let projectId: string;

async function createWorkspace(name: string, cookie: string) {
  const response = await authPost(
    app,
    "/organization/create",
    { name, slug: name.toLowerCase().replace(/\s+/g, "-") },
    { cookie },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as { id: string }).id;
}

async function join(id: string, userId: string, role = "member") {
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: id,
    userId,
    role,
    joinedAt: new Date(),
  });
}

async function remove(from: string, userId: string, cookie = owner.cookie) {
  const [member] = await db
    .select({ id: schema.workspaceUserTable.id })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, from),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    );
  const response = await authPost(
    app,
    "/organization/remove-member",
    { memberIdOrEmail: member?.id, organizationId: from },
    { cookie },
  );
  expect(response.status, await response.clone().text()).toBe(200);
}

const signedIn = async (cookie: string) => {
  const response = await app.request("/api/auth/get-session", {
    headers: { cookie },
  });
  return (await response.json()) !== null;
};

const listProjects = (id: string, headers: Record<string, string>) =>
  app.request(`/api/project?workspaceId=${id}`, { headers });

const getProject = (id: string, headers: Record<string, string>) =>
  app.request(`/api/project/${id}`, { headers });

async function keyRow(id: string) {
  const [row] = await db
    .select()
    .from(schema.apikeyTable)
    .where(eq(schema.apikeyTable.id, id));
  return row;
}

async function rowCount(
  table: typeof schema.sessionTable | typeof schema.apikeyTable,
  column: typeof schema.sessionTable.userId | typeof schema.apikeyTable.userId,
  userId: string,
) {
  const rows = await db.select().from(table).where(eq(column, userId));
  return rows.length;
}

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  initializeWebSocketAdapter();
  app = createApp().app;
  // The first account becomes the instance admin; keep that out of the way.
  await signUpWithSession(app, "first@example.com");
  owner = await signUpWithSession(app, "owner@example.com");
  person = await signUpWithSession(app, "person@example.com");
  workspaceId = await createWorkspace("Removal Co", owner.cookie);
  await join(workspaceId, person.user.id);
  const { project } = await createProjectFixture({ workspaceId });
  projectId = project.id;
});

describe("removed from their only workspace", () => {
  it("ends every session and API key", async () => {
    const full = await createApiKey(person.user);
    const limited = await createApiKey(person.user, {
      "margaya:access": ["full"],
      [PROJECTS_MARKER]: [projectId],
    });
    expect((await listProjects(workspaceId, full.headers)).status).toBe(200);
    expect(await signedIn(person.cookie)).toBe(true);

    await remove(workspaceId, person.user.id);

    expect(await signedIn(person.cookie)).toBe(false);
    expect(
      await rowCount(
        schema.sessionTable,
        schema.sessionTable.userId,
        person.user.id,
      ),
    ).toBe(0);
    expect(await keyRow(full.id)).toBeUndefined();
    expect(await keyRow(limited.id)).toBeUndefined();
    expect((await listProjects(workspaceId, full.headers)).status).toBe(401);

    // The workspace and the instance can both see what happened.
    const revoked = await auditRows(workspaceId, "api_key.revoked");
    expect(revoked.map((row) => row.targetId).sort()).toEqual(
      [full.id, limited.id].sort(),
    );
    expect(revoked[0]).toMatchObject({
      actorUserId: owner.user.id,
      metadata: { reason: "member_removed" },
    });
    await settleAuditWrites();
    const [ended] = await db
      .select()
      .from(instanceAuditLogTable)
      .where(eq(instanceAuditLogTable.action, "user.sessions_revoked"));
    expect(ended).toMatchObject({
      actorUserId: owner.user.id,
      targetId: person.user.id,
      targetLabel: "person@example.com",
      metadata: { sessions: 1, reason: "member_removed" },
    });
  });

  it("still lets them sign in afterwards", async () => {
    await remove(workspaceId, person.user.id);
    const signIn = await authPost(app, "/sign-in/email", {
      email: "person@example.com",
      password: "correct horse battery staple",
    });
    expect(signIn.status).toBe(200);
  });
});

describe("still in another workspace", () => {
  let otherWorkspace: string;
  let otherProject: string;

  beforeEach(async () => {
    otherWorkspace = await createWorkspace("Other Co", owner.cookie);
    await join(otherWorkspace, person.user.id);
    otherProject = (await createProjectFixture({ workspaceId: otherWorkspace }))
      .project.id;
  });

  it("loses this workspace at once and keeps the other one", async () => {
    const full = await createApiKey(person.user);
    await db
      .update(schema.sessionTable)
      .set({ activeOrganizationId: workspaceId })
      .where(eq(schema.sessionTable.userId, person.user.id));

    await remove(workspaceId, person.user.id);

    const cookie = { cookie: person.cookie };
    expect(await signedIn(person.cookie)).toBe(true);
    expect((await listProjects(workspaceId, cookie)).status).toBe(403);
    expect((await listProjects(otherWorkspace, cookie)).status).toBe(200);
    expect((await listProjects(workspaceId, full.headers)).status).toBe(403);
    expect((await listProjects(otherWorkspace, full.headers)).status).toBe(200);
    expect((await getProject(projectId, full.headers)).status).toBeGreaterThan(
      399,
    );
    expect(await keyRow(full.id)).toBeDefined();
    expect(await auditRows(workspaceId, "api_key.revoked")).toHaveLength(0);

    const [session] = await db
      .select({ active: schema.sessionTable.activeOrganizationId })
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, person.user.id));
    expect(session?.active).toBeNull();
  });

  it("deletes a key limited to this workspace's projects", async () => {
    const limited = await createApiKey(person.user, {
      "margaya:access": ["full"],
      [PROJECTS_MARKER]: [projectId],
    });
    await remove(workspaceId, person.user.id);
    // An emptied list would have read as "no project limit" and widened it.
    expect(await keyRow(limited.id)).toBeUndefined();
    expect((await listProjects(otherWorkspace, limited.headers)).status).toBe(
      401,
    );
    expect(await auditRows(workspaceId, "api_key.revoked")).toHaveLength(1);
  });

  it("narrows a key that also covers projects elsewhere", async () => {
    const both = await createApiKey(person.user, {
      "margaya:access": ["full"],
      [PROJECTS_MARKER]: [projectId, otherProject],
    });
    await remove(workspaceId, person.user.id);

    const row = await keyRow(both.id);
    expect(JSON.parse(row?.permissions ?? "{}")).toEqual({
      "margaya:access": ["full"],
      [PROJECTS_MARKER]: [otherProject],
    });
    expect((await getProject(otherProject, both.headers)).status).toBe(200);
    expect((await getProject(projectId, both.headers)).status).toBe(404);
  });
});

describe("cases that keep the credentials", () => {
  it("leaves an instance admin's alone: their access never came from here", async () => {
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, person.user.id));
    const full = await createApiKey(person.user);

    await remove(workspaceId, person.user.id);

    expect(await signedIn(person.cookie)).toBe(true);
    expect(await keyRow(full.id)).toBeDefined();
  });

  it("leaves someone who chose to leave signed in", async () => {
    const full = await createApiKey(person.user);
    const limited = await createApiKey(person.user, {
      "margaya:access": ["full"],
      [PROJECTS_MARKER]: [projectId],
    });
    const left = await authPost(
      app,
      "/organization/leave",
      { organizationId: workspaceId },
      { cookie: person.cookie },
    );
    expect(left.status, await left.clone().text()).toBe(200);

    expect(await signedIn(person.cookie)).toBe(true);
    expect(await keyRow(full.id)).toBeDefined();
    expect((await listProjects(workspaceId, full.headers)).status).toBe(403);
    // A key that can only reach this workspace is useless either way.
    expect(await keyRow(limited.id)).toBeUndefined();
  });

  it("treats removing yourself like leaving", async () => {
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "admin" })
      .where(eq(schema.workspaceUserTable.userId, person.user.id));
    await remove(workspaceId, person.user.id, person.cookie);
    expect(await signedIn(person.cookie)).toBe(true);
  });
});

describe("what a later invitation would bring back", () => {
  it("removes their restricted-project membership", async () => {
    await db.insert(projectMemberTable).values({
      projectId,
      userId: person.user.id,
      role: "member",
    });
    const { project: elsewhere } = await createProjectFixture({
      workspaceId: await createWorkspace("Elsewhere Co", owner.cookie),
    });
    await db.insert(projectMemberTable).values({
      projectId: elsewhere.id,
      userId: person.user.id,
      role: "member",
    });

    await remove(workspaceId, person.user.id);

    const rows = await db
      .select({ projectId: projectMemberTable.projectId })
      .from(projectMemberTable)
      .where(eq(projectMemberTable.userId, person.user.id));
    expect(rows.map((row) => row.projectId)).toEqual([elsewhere.id]);
  });
});

describe("open sockets", () => {
  it("closes the removed person's project socket and keeps the others'", async () => {
    const socket = (closed: number[]) =>
      ({
        send: () => {},
        close: (code: number) => closed.push(code),
      }) as unknown as WSContext;
    const closed: number[] = [];
    const ownerClosed: number[] = [];
    const conn = addConnection(
      projectId,
      socket(closed),
      person.user.id,
      person.user.id,
    );
    const ownerConn = addConnection(
      projectId,
      socket(ownerClosed),
      owner.user.id,
      owner.user.id,
    );
    try {
      await remove(workspaceId, person.user.id);
      // Broadcasts are batched for 100 ms, then re-checked.
      await expect
        .poll(() => closed, { timeout: 3000 })
        .toContain(PROJECT_ACCESS_REVOKED_CLOSE_CODE);
      expect(ownerClosed).toEqual([]);
    } finally {
      removeConnection(projectId, conn);
      removeConnection(projectId, ownerConn);
    }
  });
});
