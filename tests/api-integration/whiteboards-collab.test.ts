import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  flushAllWhiteboardRooms,
  shutdownWhiteboardRooms,
} from "../../apps/api/src/whiteboard/collab/rooms";
import {
  headersFor,
  mockSessions,
  ORIGIN,
  startServer,
  type TestServer,
  waitFor,
} from "./helpers/collab";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import {
  BoardClient,
  boardRow,
  json,
  setWhiteboardsEnabled,
  sticky,
  terminateBoardClients,
  type WhiteboardScene,
  whiteboardScene,
} from "./helpers/whiteboards";

let server: TestServer;
let s: WhiteboardScene;

const open = (user: WhiteboardScene["ben"], id: string) =>
  BoardClient.open(server.baseUrl, id, headersFor(user));

beforeEach(async () => {
  await resetTestDatabase();
  s = await whiteboardScene();
  await mockSessions([s.owner, s.admin, s.ben, s.cara, s.viewer]);
  server = await startServer();
});

afterEach(async () => {
  terminateBoardClients();
  await shutdownWhiteboardRooms(1000);
  await server.close();
  vi.restoreAllMocks();
});

/** REST as a cookie session, so the mocked session lookup stays in place. */
function rest(user: WhiteboardScene["ben"], path: string, init?: RequestInit) {
  return s.app.request(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      cookie: `test-session=${user.id}`,
    },
  });
}

async function createBoard(
  user: WhiteboardScene["ben"],
  elements: unknown[] = [],
) {
  const response = await rest(
    user,
    "/whiteboard",
    json("POST", { projectId: s.project.id, elements }),
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as { id: string };
}

describe("whiteboard socket handshake", () => {
  it("answers like the REST routes before upgrading", async () => {
    const board = await createBoard(s.ben);
    const outsider = await createWorkspaceMember({ role: "owner" });
    await mockSessions([
      s.owner,
      s.admin,
      s.ben,
      s.cara,
      s.viewer,
      outsider.user,
    ]);

    const missing = await BoardClient.connect(
      server.baseUrl,
      "nope",
      headersFor(s.ben),
    );
    expect(missing.status).toBe(404);
    const foreign = await BoardClient.connect(
      server.baseUrl,
      board.id,
      headersFor(outsider.user),
    );
    expect(foreign.status).toBe(404);
    const anonymous = await BoardClient.connect(server.baseUrl, board.id, {
      origin: ORIGIN,
    });
    expect(anonymous.status).toBe(401);
    const badOrigin = await BoardClient.connect(server.baseUrl, board.id, {
      ...headersFor(s.ben),
      origin: "https://evil.example",
    });
    expect(badOrigin.status).toBe(403);

    await setWhiteboardsEnabled(s.project.id, false);
    const off = await BoardClient.connect(
      server.baseUrl,
      board.id,
      headersFor(s.ben),
    );
    expect(off.status).toBe(403);
  });
});

describe("whiteboard room", () => {
  it("makes two clients converge and persists the content", async () => {
    const board = await createBoard(s.ben, [sticky("seed")]);
    const ben = await open(s.ben, board.id);
    const cara = await open(s.cara, board.id);
    expect(ben.control("state")).toMatchObject({ canWrite: true });
    expect(ben.doc.getMap("elements").size).toBe(1);

    const a = sticky("from ben");
    const b = sticky("from cara");
    ben.put(a.id, a);
    cara.put(b.id, b);
    await waitFor(
      () =>
        ben.element(b.id) &&
        cara.element(a.id) &&
        ben.doc.getMap("elements").size === 3,
      { message: "convergence" },
    );
    expect(ben.doc.getMap("elements").toJSON()).toEqual(
      cara.doc.getMap("elements").toJSON(),
    );

    await flushAllWhiteboardRooms();
    const row = await boardRow(board.id);
    expect(row?.elementCount).toBe(3);
    expect(row?.contentText).toContain("from cara");
    await waitFor(() => ben.control("saved"), { message: "saved notice" });

    // REST reads the live room's content.
    const content = await rest(s.viewer, `/whiteboard/${board.id}/content`);
    const body = (await content.json()) as { elements: { text?: string }[] };
    expect(body.elements.map((element) => element.text).sort()).toEqual([
      "from ben",
      "from cara",
      "seed",
    ]);
  });

  it("never applies a viewer's edits", async () => {
    const board = await createBoard(s.ben);
    const ben = await open(s.ben, board.id);
    const vic = await open(s.viewer, board.id);
    expect(vic.control("state")).toMatchObject({ canWrite: false });
    const note = sticky("viewer note");
    vic.put(note.id, note);
    await waitFor(() => vic.control("offline-rejected"), {
      message: "the rejection notice",
    });
    // A writer's later edit arrives; the viewer's never does.
    const marker = sticky("marker");
    ben.put(marker.id, marker);
    await waitFor(() => vic.element(marker.id), { message: "the marker" });
    expect(ben.element(note.id)).toBeUndefined();
    await flushAllWhiteboardRooms();
    expect((await boardRow(board.id))?.contentText).not.toContain(
      "viewer note",
    );
  });

  it("closes write access when the board is locked", async () => {
    const board = await createBoard(s.ben);
    const ben = await open(s.ben, board.id);
    const locked = await rest(s.ben, `/whiteboard/${board.id}/lock`, {
      method: "POST",
    });
    expect(locked.status).toBe(200);
    await waitFor(() => ben.control("state")?.isLocked, {
      message: "the locked state",
    });
    expect(ben.control("state")?.canWrite).toBe(false);
    const late = sticky("after lock");
    ben.put(late.id, late);
    await waitFor(() => ben.control("offline-rejected"), {
      message: "the rejection",
    });
    await flushAllWhiteboardRooms();
    expect((await boardRow(board.id))?.contentText).not.toContain("after lock");
  });

  it("strips invalid elements for everyone, and repairs what it can", async () => {
    const board = await createBoard(s.ben);
    const ben = await open(s.ben, board.id);
    const cara = await open(s.cara, board.id);
    const good = sticky("kept");
    ben.doc.transact(() => {
      ben.put("junk", {
        id: "junk",
        type: "iframe",
        src: "javascript:alert(1)",
      });
      ben.put(good.id, { ...good, link: "javascript:alert(1)", extra: true });
    });
    await waitFor(() => cara.element(good.id), { message: "the good element" });
    await waitFor(() => ben.element("junk") === undefined, {
      message: "the repair on the sender",
    });
    for (const client of [ben, cara]) {
      expect(client.element("junk")).toBeUndefined();
      expect(client.element(good.id)).toMatchObject({ link: null });
      expect(client.element(good.id)).not.toHaveProperty("extra");
    }
    await flushAllWhiteboardRooms();
    const row = await boardRow(board.id);
    expect(row?.elementCount).toBe(1);
    const stored = new Y.Doc();
    Y.applyUpdate(stored, new Uint8Array(row?.contentYjs ?? []));
    expect(stored.getMap("elements").has("junk")).toBe(false);
  });

  it("delivers REST element writes to open sockets", async () => {
    const board = await createBoard(s.ben);
    const cara = await open(s.cara, board.id);
    const note = sticky("from an agent");
    const response = await rest(
      s.ben,
      `/whiteboard/${board.id}/elements`,
      json("POST", { elements: [note] }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    await waitFor(() => cara.element(note.id), { message: "the REST write" });
    expect((await boardRow(board.id))?.contentText).toContain("from an agent");
  });

  it("closes sockets with 4404 when the board goes to the trash", async () => {
    const board = await createBoard(s.ben);
    const ben = await open(s.ben, board.id);
    expect(
      (await rest(s.ben, `/whiteboard/${board.id}/archive`, { method: "POST" }))
        .status,
    ).toBe(200);
    await waitFor(() => ben.control("state")?.isArchived, {
      message: "the archived state",
    });
    expect(
      (await rest(s.ben, `/whiteboard/${board.id}`, { method: "DELETE" }))
        .status,
    ).toBe(200);
    await waitFor(() => ben.closeCode, { message: "the close" });
    expect(ben.closeCode).toBe(4404);
  });
});
