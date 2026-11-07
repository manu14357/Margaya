import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeScope } from "../../apps/api/src/api-key/scope";
import db, { schema } from "../../apps/api/src/database";
import { projectMemberTable } from "../../apps/api/src/database/schema";
import { COLLAB_LIMITS } from "../../apps/api/src/page/collab/limits";
import { encodeControl } from "../../apps/api/src/page/collab/protocol";
import {
  flushAllPageRooms,
  shutdownPageRooms,
} from "../../apps/api/src/page/collab/rooms";
import { publishMembersChanged } from "../../apps/api/src/workspace/members-realtime";
import { createApiKey } from "./helpers/api-keys";
import {
  CollabClient,
  headersFor,
  mockSessions,
  ORIGIN,
  startServer,
  type TestServer,
  terminateClients,
  waitFor,
} from "./helpers/collab";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  json,
  type PageJson,
  type PageScene,
  pageRow,
  pageScene,
  setPagesEnabled,
} from "./helpers/pages";

let server: TestServer;
let s: PageScene;

async function createPage(
  user: PageScene["ben"],
  body: Record<string, unknown> = {},
) {
  const response = await server.rest(
    user,
    `/project/${s.project.id}`,
    json("POST", body),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as PageJson;
}

async function expectOk(response: Promise<Response>) {
  const result = await response;
  expect(result.status, await result.clone().text()).toBe(200);
  return result;
}

const open = (user: PageScene["ben"], pageId: string) =>
  CollabClient.open(server.baseUrl, pageId, headersFor(user));

beforeEach(async () => {
  await resetTestDatabase();
  s = await pageScene();
  await mockSessions([s.owner, s.admin, s.ben, s.cara, s.viewer]);
  server = await startServer();
});

afterEach(async () => {
  terminateClients();
  await shutdownPageRooms(1000);
  await server.close();
  vi.restoreAllMocks();
});

describe("page socket handshake", () => {
  it("answers like the page routes before upgrading", async () => {
    const page = await createPage(s.ben, { title: "Spec" });
    const secret = await createPage(s.ben, { access: "private" });
    const connect = (pageId: string, headers: Record<string, string>) =>
      CollabClient.connect(server.baseUrl, pageId, headers).then(
        (result) => result.status,
      );

    expect(
      await connect(page.id, {
        ...headersFor(s.cara),
        origin: "https://evil.example.test",
      }),
    ).toBe(403);
    expect(await connect(page.id, { origin: ORIGIN })).toBe(401);
    expect(await connect("missing-page", headersFor(s.cara))).toBe(404);
    // Another user's private page, even for an admin.
    expect(await connect(secret.id, headersFor(s.cara))).toBe(404);
    expect(await connect(secret.id, headersFor(s.admin))).toBe(404);
    expect(await connect(secret.id, headersFor(s.ben))).toBe(101);
    // Viewers may read public pages.
    expect(await connect(page.id, headersFor(s.viewer))).toBe(101);

    // A page of another workspace does not reveal itself.
    const stranger = await createWorkspaceMember();
    await mockSessions([
      s.owner,
      s.admin,
      s.ben,
      s.cara,
      s.viewer,
      stranger.user,
    ]);
    expect(await connect(page.id, headersFor(stranger.user))).toBe(404);

    await setPagesEnabled(s.project.id, false);
    expect(await connect(page.id, headersFor(s.cara))).toBe(403);
  });

  it("greets with the document, then the state control", async () => {
    const page = await createPage(s.ben, { content: "Hello **world**" });
    const ben = await open(s.ben, page.id);
    expect(ben.markdown()).toBe("Hello **world**");
    expect(ben.state()).toEqual({
      kind: "state",
      canWrite: true,
      isLocked: false,
      isArchived: false,
      access: "public",
      projectId: s.project.id,
      contentVersion: 1,
    });
    const viewer = await open(s.viewer, page.id);
    expect(viewer.state()?.canWrite).toBe(false);
    expect(viewer.markdown()).toBe("Hello **world**");
  });
});

describe("page socket editing", () => {
  it("converges concurrent edits and persists them", async () => {
    const page = await createPage(s.ben, { content: "Start" });
    const ben = await open(s.ben, page.id);
    const cara = await open(s.cara, page.id);

    ben.write("from Ben");
    cara.write("from Cara");
    await waitFor(
      () =>
        ben.markdown().includes("from Cara") &&
        cara.markdown().includes("from Ben"),
      { message: "both edits on both clients" },
    );
    expect(ben.markdown()).toBe(cara.markdown());

    await flushAllPageRooms();
    const row = await pageRow(page.id);
    expect(row?.contentMarkdown).toBe(ben.markdown());
    expect(row?.contentVersion).toBeGreaterThan(1);
    expect(row?.contentText).toContain("from Ben");
    await waitFor(() => ben.control("saved"), { message: "saved" });
    expect(ben.control("saved")?.contentVersion).toBe(row?.contentVersion);
  });

  it("refuses a read-only connection's edits with offline-rejected", async () => {
    const page = await createPage(s.ben, { content: "Keep" });
    const ben = await open(s.ben, page.id);
    const viewer = await open(s.viewer, page.id);

    viewer.write("vandalism");
    await waitFor(() => viewer.control("offline-rejected"), {
      message: "offline-rejected",
    });
    expect(viewer.control("offline-rejected")?.reason).toBe("readOnly");
    // A resync (sync step 1) is still answered for read-only sockets.
    ben.write("real edit");
    await waitFor(() => viewer.markdown().includes("real edit"), {
      message: "the viewer receiving edits",
    });
    expect(ben.markdown()).not.toContain("vandalism");
    await flushAllPageRooms();
    expect((await pageRow(page.id))?.contentMarkdown).not.toContain(
      "vandalism",
    );
  });

  it("persists on the last disconnect", async () => {
    const page = await createPage(s.ben);
    const ben = await open(s.ben, page.id);
    const cara = await open(s.cara, page.id);
    ben.write("before leaving");
    // The room has the edit once another client received it.
    await waitFor(() => cara.markdown().includes("before leaving"), {
      message: "the edit reaching the room",
    });
    cara.socket.close();
    await cara.closed();
    ben.socket.close();
    await waitFor(
      async () =>
        (await pageRow(page.id))?.contentMarkdown.includes("before leaving"),
      { message: "the persist after the last disconnect" },
    );
  });
});

describe("page socket protocol guards", () => {
  it("closes text frames, client control messages and oversized frames", async () => {
    const page = await createPage(s.ben);

    const text = await open(s.ben, page.id);
    text.send("hello");
    expect(await text.closed()).toBe(1003);

    const control = await open(s.ben, page.id);
    control.send(encodeControl({ kind: "save-error" }));
    expect(await control.closed()).toBe(1008);

    const huge = await open(s.ben, page.id);
    huge.send(new Uint8Array(1024 * 1024 + 1));
    expect(await huge.closed()).toBe(1009);

    // A frame just under the limit is delivered (and is not valid Yjs).
    const large = await open(s.ben, page.id);
    large.send(new Uint8Array(1024 * 1024 - 16).fill(0xff));
    expect(await large.closed()).toBe(1008);
  });

  it("guards awareness: own user id, palette colors, at most four clients", async () => {
    const page = await createPage(s.ben);
    const ben = await open(s.ben, page.id);
    const cara = await open(s.cara, page.id);

    cara.setAwareness({ user: { id: s.ben.id, color: "blue" } });
    cara.setAwareness({ user: { id: s.cara.id, color: "#ff0000" } });
    cara.setAwareness({
      user: { id: s.cara.id, color: "blue", name: "<b>spoof</b>" },
    });
    cara.setAwareness({ user: { id: s.cara.id, color: "teal" }, cursor: null });
    await waitFor(() => ben.remoteStates.get(cara.doc.clientID), {
      message: "Cara's presence",
    });
    expect(ben.remoteStates.get(cara.doc.clientID)).toEqual({
      user: { id: s.cara.id, color: "teal" },
      cursor: null,
    });

    // Five client ids from one socket.
    const states = new Map<number, Record<string, unknown>>();
    for (let clientId = 1001; clientId <= 1005; clientId++) {
      states.set(clientId, { user: { id: s.cara.id, color: "blue" } });
      cara.awareness.meta.set(clientId, { clock: 1, lastUpdated: Date.now() });
    }
    cara.sendAwareness([...states.keys()], states);
    expect(await cara.closed()).toBe(1008);
    // Cara's presence leaves with her socket.
    await waitFor(() => !ben.awareness.getStates().has(cara.doc.clientID), {
      message: "Cara's presence removed",
    });
  });
});

describe("page socket follows page changes", () => {
  it("switches to read-only when the page is locked", async () => {
    const page = await createPage(s.ben);
    const ben = await open(s.ben, page.id);
    await expectOk(server.rest(s.ben, `/${page.id}/lock`, { method: "POST" }));
    await waitFor(() => ben.state()?.canWrite === false, {
      message: "the locked state",
    });
    expect(ben.state()?.isLocked).toBe(true);

    ben.write("after lock");
    await waitFor(() => ben.control("offline-rejected"), {
      message: "offline-rejected",
    });
    expect(ben.control("offline-rejected")?.reason).toBe("locked");
    await flushAllPageRooms();
    expect((await pageRow(page.id))?.contentMarkdown).not.toContain(
      "after lock",
    );

    await expectOk(
      server.rest(s.ben, `/${page.id}/lock`, { method: "DELETE" }),
    );
    await waitFor(() => ben.state()?.canWrite === true, {
      message: "the unlocked state",
    });
  });

  it("closes other users' sockets with 4403 when the page turns private", async () => {
    const page = await createPage(s.ben);
    const ben = await open(s.ben, page.id);
    const cara = await open(s.cara, page.id);
    await expectOk(
      server.rest(
        s.ben,
        `/${page.id}/access`,
        json("PUT", { access: "private" }),
      ),
    );
    expect(await cara.closed()).toBe(4403);
    await waitFor(() => ben.state()?.access === "private", {
      message: "the private state",
    });
    expect(ben.closeCode).toBeNull();
  });

  it("closes with 4404 when the page is deleted", async () => {
    const page = await createPage(s.ben);
    await expectOk(
      server.rest(s.ben, `/${page.id}/archive`, { method: "POST" }),
    );
    const ben = await open(s.ben, page.id);
    expect(ben.state()).toMatchObject({ canWrite: false, isArchived: true });
    await expectOk(server.rest(s.ben, `/${page.id}`, { method: "DELETE" }));
    expect(await ben.closed()).toBe(4404);
  });

  it("closes with 4404 when Pages are turned off", async () => {
    const page = await createPage(s.ben);
    const ben = await open(s.ben, page.id);
    const response = await s.app.request(
      `/api/project/${s.project.id}/features`,
      {
        ...json("PATCH", { pagesEnabled: false }),
        headers: {
          "content-type": "application/json",
          cookie: `test-session=${s.owner.id}`,
        },
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await ben.closed()).toBe(4404);
    // Re-enabling restores access; the content is untouched.
    await setPagesEnabled(s.project.id, true);
    const again = await open(s.ben, page.id);
    expect(again.state()?.canWrite).toBe(true);
  });

  it("closes with 4401 once the session is gone", async () => {
    const page = await createPage(s.ben);
    const cara = await open(s.cara, page.id);
    await db
      .delete(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, s.cara.id));
    // Any page event revalidates the room's connections.
    await expectOk(server.rest(s.ben, `/${page.id}/lock`, { method: "POST" }));
    expect(await cara.closed()).toBe(4401);
  });

  it("accepts API keys with page:read and closes them with 4401 once revoked", async () => {
    const page = await createPage(s.ben);
    const bearer = (key: { headers: { Authorization: string } }) => ({
      authorization: key.headers.Authorization,
    });
    const scoped = await createApiKey(s.cara, { project: ["read"] });
    const refused = await CollabClient.connect(
      server.baseUrl,
      page.id,
      bearer(scoped),
    );
    expect(refused.status).toBe(403);

    const key = await createApiKey(s.cara);
    const cara = await CollabClient.open(server.baseUrl, page.id, bearer(key));
    expect(cara.state()?.canWrite).toBe(true);
    await db
      .update(schema.apikeyTable)
      .set({ enabled: false })
      .where(eq(schema.apikeyTable.id, key.id));
    await expectOk(server.rest(s.ben, `/${page.id}/lock`, { method: "POST" }));
    expect(await cara.closed()).toBe(4401);
  });

  it("closes a removed member's socket", async () => {
    const page = await createPage(s.ben);
    const cara = await open(s.cara, page.id);
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, s.cara.id));
    await expectOk(server.rest(s.ben, `/${page.id}/lock`, { method: "POST" }));
    expect(await cara.closed()).toBe(4403);
  });

  it("closes a removed member's socket at once, without any page change", async () => {
    const page = await createPage(s.ben);
    const ben = await open(s.ben, page.id);
    const cara = await open(s.cara, page.id);
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, s.cara.id));
    await publishMembersChanged({
      workspaceId: s.workspaceId,
      userId: s.cara.id,
      accessEnded: true,
    });
    expect(await cara.closed()).toBe(4403);
    expect(ben.closeCode).toBeNull();
  });
});

describe("page socket in a restricted project", () => {
  async function restrictProject(projectId: string) {
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, projectId));
  }
  const addToProject = (projectId: string, userId: string, role: string) =>
    db.insert(projectMemberTable).values({ projectId, userId, role });
  const setProjectRole = (user: PageScene["ben"], role: string) =>
    s.app.request(`/api/project/${s.project.id}/access/members/${user.id}`, {
      ...json("PATCH", { role }),
      headers: {
        "content-type": "application/json",
        cookie: `test-session=${s.owner.id}`,
      },
    });

  it("refuses edits from a member capped to viewer, as the REST routes do", async () => {
    const page = await createPage(s.ben, { content: "Keep" });
    await restrictProject(s.project.id);
    await addToProject(s.project.id, s.ben.id, "member");
    await addToProject(s.project.id, s.cara.id, "viewer");

    const rest = await server.rest(
      s.cara,
      `/${page.id}/content`,
      json("PUT", { markdown: "Over REST" }),
    );
    expect(rest.status).toBe(403);

    const cara = await open(s.cara, page.id);
    expect(cara.markdown()).toBe("Keep");
    expect(cara.state()?.canWrite).toBe(false);
    const ben = await open(s.ben, page.id);
    expect(ben.state()?.canWrite).toBe(true);

    cara.write("vandalism");
    await waitFor(() => cara.control("offline-rejected"), {
      message: "offline-rejected",
    });
    ben.write("real edit");
    await waitFor(() => cara.markdown().includes("real edit"), {
      message: "the capped member still reading along",
    });
    expect(ben.markdown()).not.toContain("vandalism");
    await flushAllPageRooms();
    expect((await pageRow(page.id))?.contentMarkdown).not.toContain(
      "vandalism",
    );
  });

  it("follows a change of project role on an open socket", async () => {
    const page = await createPage(s.ben, { content: "Keep" });
    await restrictProject(s.project.id);
    await addToProject(s.project.id, s.ben.id, "member");
    await addToProject(s.project.id, s.cara.id, "member");
    const cara = await open(s.cara, page.id);
    expect(cara.state()?.canWrite).toBe(true);

    expect((await setProjectRole(s.cara, "viewer")).status).toBe(200);
    await waitFor(() => cara.state()?.canWrite === false, {
      message: "read-only after the role dropped",
    });
    cara.write("after the change");
    await waitFor(() => cara.control("offline-rejected"), {
      message: "offline-rejected",
    });
    await flushAllPageRooms();
    expect((await pageRow(page.id))?.contentMarkdown).not.toContain(
      "after the change",
    );

    expect((await setProjectRole(s.cara, "member")).status).toBe(200);
    await waitFor(() => cara.state()?.canWrite === true, {
      message: "writable after the role rose",
    });
  });

  it("notices a changed role at the periodic re-check, from the database", async () => {
    // The room's timer runs inside the request that opened its first socket,
    // whose answers about that socket's user are memoized. They must not count.
    const limits = COLLAB_LIMITS as { revalidateMs: number };
    const interval = limits.revalidateMs;
    limits.revalidateMs = 50;
    try {
      const page = await createPage(s.ben, { content: "Keep" });
      await restrictProject(s.project.id);
      await addToProject(s.project.id, s.cara.id, "member");
      const cara = await open(s.cara, page.id);
      expect(cara.state()?.canWrite).toBe(true);

      // No event: only the timer can notice either of these.
      await db
        .update(projectMemberTable)
        .set({ role: "viewer" })
        .where(eq(projectMemberTable.userId, s.cara.id));
      await waitFor(() => cara.state()?.canWrite === false, {
        message: "read-only after the periodic re-check",
      });

      await db
        .delete(projectMemberTable)
        .where(eq(projectMemberTable.userId, s.cara.id));
      expect(await cara.closed()).toBe(4403);
    } finally {
      limits.revalidateMs = interval;
    }
  });

  it("closes a project-limited key's socket when the page leaves its projects", async () => {
    const page = await createPage(s.ben, { content: "Keep" });
    const key = await createApiKey(
      s.cara,
      encodeScope({ access: "full", projectIds: [s.project.id] }) ?? undefined,
    );
    const limited = await CollabClient.open(server.baseUrl, page.id, {
      authorization: key.headers.Authorization,
    });
    const free = await open(s.cara, page.id);

    const destination = await s.project2();
    await expectOk(
      server.rest(
        s.ben,
        `/${page.id}/move`,
        json("POST", { projectId: destination.id }),
      ),
    );
    expect(await limited.closed()).toBe(4403);
    // The same person's session isn't limited, and stays.
    await waitFor(() => free.state()?.projectId === destination.id, {
      message: "the move reaching the session's socket",
    });
    expect(free.closeCode).toBeNull();
  });

  it("applies the role of the project a page moved into", async () => {
    const page = await createPage(s.ben, { content: "Keep" });
    const cara = await open(s.cara, page.id);
    expect(cara.state()?.canWrite).toBe(true);

    const destination = await s.project2();
    await restrictProject(destination.id);
    await addToProject(destination.id, s.ben.id, "member");
    await addToProject(destination.id, s.cara.id, "viewer");
    await expectOk(
      server.rest(
        s.ben,
        `/${page.id}/move`,
        json("POST", { projectId: destination.id }),
      ),
    );
    await waitFor(() => cara.state()?.canWrite === false, {
      message: "read-only in the new project",
    });
    expect(cara.state()?.projectId).toBe(destination.id);
    expect(cara.closeCode).toBeNull();
  });
});

describe("page socket workspace boundary", () => {
  it("answers 404 for a page of another workspace", async () => {
    const other = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    const [row] = await db
      .insert(schema.pageTable)
      .values({
        workspaceId: other.workspace.id,
        projectId: project.id,
        title: "Elsewhere",
      })
      .returning();
    const { status } = await CollabClient.connect(
      server.baseUrl,
      row?.id ?? "",
      headersFor(s.ben),
    );
    expect(status).toBe(404);
  });
});
