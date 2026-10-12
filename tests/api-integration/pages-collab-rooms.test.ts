import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { loadPageState } from "../../apps/api/src/page/collab/meta";
import {
  flushAllPageRooms,
  loadedPageRoom,
  shutdownPageRooms,
} from "../../apps/api/src/page/collab/rooms";
import {
  CollabClient,
  headersFor,
  mockSessions,
  startServer,
  type TestServer,
  terminateClients,
  waitFor,
} from "./helpers/collab";
import { resetTestDatabase } from "./helpers/database";
import {
  json,
  type PageJson,
  type PageScene,
  type PageVersionJson,
  pageRow,
  pageScene,
} from "./helpers/pages";

let server: TestServer;
let s: PageScene;

async function ok<T = PageJson>(response: Promise<Response>): Promise<T> {
  const result = await response;
  expect(result.status, await result.clone().text()).toBe(200);
  return (await result.json()) as T;
}

const createPage = (
  user: PageScene["ben"],
  body: Record<string, unknown> = {},
) => ok(server.rest(user, `/project/${s.project.id}`, json("POST", body)));

const open = (user: PageScene["ben"], pageId: string) =>
  CollabClient.open(server.baseUrl, pageId, headersFor(user));

async function clearStoredState(pageId: string) {
  await db
    .update(schema.pageTable)
    .set({ contentYjs: null })
    .where(eq(schema.pageTable.id, pageId));
}

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

describe("page rooms: loading", () => {
  it("repairs a row without a Yjs state from its markdown exactly once", async () => {
    const page = await createPage(s.ben, { content: "Hello **world**" });
    await clearStoredState(page.id);

    const [ben, cara] = await Promise.all([
      open(s.ben, page.id),
      open(s.cara, page.id),
    ]);
    expect(ben.markdown()).toBe("Hello **world**");
    expect(cara.markdown()).toBe("Hello **world**");
    const row = await pageRow(page.id);
    expect(row?.contentYjs).not.toBeNull();

    // Concurrent loads (as on two instances) store and return one state.
    const other = await createPage(s.ben, { content: "Second *page*" });
    await clearStoredState(other.id);
    const [first, second] = await Promise.all([
      loadPageState(other.id),
      loadPageState(other.id),
    ]);
    if (first.status !== "ok" || second.status !== "ok") {
      throw new Error("Load failed");
    }
    expect(Buffer.from(first.state).equals(Buffer.from(second.state))).toBe(
      true,
    );
    const stored = await pageRow(other.id);
    expect(
      Buffer.from(stored?.contentYjs ?? []).equals(Buffer.from(first.state)),
    ).toBe(true);
  });

  it("refreshes the room's meta from the row a persist locks", async () => {
    const page = await createPage(s.ben);
    const ben = await open(s.ben, page.id);
    // Locked behind the room's back: no event reaches it.
    await db
      .update(schema.pageTable)
      .set({ isLocked: true })
      .where(eq(schema.pageTable.id, page.id));
    ben.write("typed before the lock was known");
    await waitFor(() => loadedPageRoom(page.id)?.isDirty, {
      message: "the room to be dirty",
    });
    await flushAllPageRooms();
    await waitFor(() => ben.state()?.canWrite === false, {
      message: "the locked state",
    });
    expect(ben.state()?.isLocked).toBe(true);
  });
});

describe("page rooms: server changes", () => {
  it("delivers a REST content replace to connected clients", async () => {
    const page = await createPage(s.ben, { content: "Old" });
    const ben = await open(s.ben, page.id);
    await ok(
      server.rest(
        s.cara,
        `/${page.id}/content`,
        json("PUT", { markdown: "Replaced **text**" }),
      ),
    );
    await waitFor(() => ben.control("replaced"), { message: "replaced" });
    expect(ben.control("replaced")).toEqual({
      kind: "replaced",
      actorId: s.cara.id,
    });
    expect(ben.markdown()).toBe("Replaced **text**");
    const row = await pageRow(page.id);
    expect(row?.contentMarkdown).toBe("Replaced **text**");
    expect(row?.updatedById).toBe(s.cara.id);
  });

  it("delivers a version restore to connected clients", async () => {
    const page = await createPage(s.ben);
    await ok(
      server.rest(
        s.ben,
        `/${page.id}/content`,
        json("PUT", { markdown: "one" }),
      ),
    );
    const ben = await open(s.ben, page.id);
    ben.write("two");
    await waitFor(() => loadedPageRoom(page.id)?.isDirty, {
      message: "the edit reaching the room",
    });
    const [version] = await ok<PageVersionJson[]>(
      server.rest(s.cara, `/${page.id}/versions`),
    );
    if (!version) throw new Error("No version");
    await ok(
      server.rest(s.cara, `/${page.id}/versions/${version.id}/restore`, {
        method: "POST",
      }),
    );
    await waitFor(() => ben.control("restored"), { message: "restored" });
    expect(ben.control("restored")).toEqual({
      kind: "restored",
      versionId: version.id,
      actorId: s.cara.id,
    });
    expect(ben.markdown()).toBe("one");
    // Ben's unsaved edit was saved first (attributed to him), so the restore
    // can be undone.
    const versions = await ok<PageVersionJson[]>(
      server.rest(s.ben, `/${page.id}/versions`),
    );
    expect(versions.some((entry) => entry.ownerId === s.ben.id)).toBe(true);
  });

  it("duplicates the live document", async () => {
    const page = await createPage(s.ben, { title: "Live" });
    const ben = await open(s.ben, page.id);
    ben.write("not saved yet");
    await waitFor(() => loadedPageRoom(page.id)?.isDirty, {
      message: "the edit reaching the room",
    });
    const copy = await ok(
      server.rest(s.cara, `/${page.id}/duplicate`, { method: "POST" }),
    );
    expect(copy.contentMarkdown).toContain("not saved yet");
  });
});

describe("page rooms: shutdown", () => {
  it("persists dirty rooms, then closes sockets with 4503", async () => {
    const page = await createPage(s.ben);
    const ben = await open(s.ben, page.id);
    ben.write("saved at shutdown");
    await waitFor(() => loadedPageRoom(page.id)?.isDirty, {
      message: "the edit reaching the room",
    });
    await shutdownPageRooms();
    expect(await ben.closed()).toBe(4503);
    expect((await pageRow(page.id))?.contentMarkdown).toContain(
      "saved at shutdown",
    );
    expect(loadedPageRoom(page.id)).toBeUndefined();
  });
});
