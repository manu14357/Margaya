import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { migratePublications } from "../../apps/api/src/migrations/publication-migration";
import { setPublicBoardInstanceState } from "../../apps/api/src/public-board/instance-state";
import { addPerson } from "./helpers/assignees";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture } from "./helpers/fixtures";
import {
  clearPublishedEvents,
  publishedEvents,
  recordEvents,
  setIntakeEnabled,
} from "./helpers/intake";
import {
  boardScene,
  json,
  jsonStrings,
  resetPublicBoardState,
} from "./helpers/public-board";

type Publication = {
  projectId: string;
  published: boolean;
  linkToken: string | null;
  path: string | null;
  layouts: string[];
  defaultLayout: string;
  commentsEnabled: boolean;
  requestsEnabled: boolean;
  showAssignees: boolean;
  canManage: boolean;
};

const EVENTS = [
  "publication.published",
  "publication.unpublished",
  "publication.updated",
  "publication.link_rotated",
];

beforeEach(async () => {
  await resetTestDatabase();
  resetPublicBoardState();
  recordEvents(...EVENTS);
  clearPublishedEvents();
});
afterAll(() => setPublicBoardInstanceState(null));

async function call<T>(response: Promise<Response>, status = 200) {
  const resolved = await response;
  expect(resolved.status, await resolved.clone().text()).toBe(status);
  return (await resolved.json()) as T;
}

describe("project publication", () => {
  it("publishes once, keeps token and settings across unpublish, rotates links", async () => {
    const s = await boardScene();
    const owner = s.as(s.owner);
    const base = `/publication/project/${s.project.id}`;

    const before = await call<Publication>(owner(base));
    expect(before).toMatchObject({ published: false, linkToken: null });

    const published = await call<Publication>(
      owner(`${base}/publish`, json("POST", { commentsEnabled: true })),
    );
    expect(published.published).toBe(true);
    expect(published.linkToken).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(published.path).toBe(`/public-project/${published.linkToken}`);
    expect(published.commentsEnabled).toBe(true);
    const [project] = await db
      .select({ isPublic: schema.projectTable.isPublic })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, s.project.id));
    expect(project?.isPublic).toBe(true);

    await call<Publication>(owner(`${base}/publish`, json("POST", {})));
    expect(publishedEvents("publication.published")).toHaveLength(1);

    const unpublished = await call<Publication>(
      owner(`${base}/unpublish`, { method: "POST" }),
    );
    expect(unpublished).toMatchObject({
      published: false,
      linkToken: published.linkToken,
      commentsEnabled: true,
    });
    const again = await call<Publication>(
      owner(`${base}/publish`, json("POST", {})),
    );
    expect(again.linkToken).toBe(published.linkToken);

    const rotated = await call<Publication>(
      owner(`${base}/rotate-link`, { method: "POST" }),
    );
    expect(rotated.linkToken).not.toBe(published.linkToken);
    expect(
      (await s.as(null)(`/public-board/${published.linkToken}`)).status,
    ).toBe(404);
    expect(
      (await s.as(null)(`/public-board/${rotated.linkToken}`)).status,
    ).toBe(200);

    // No event carries a token.
    for (const event of publishedEvents()) {
      const strings = jsonStrings(event.data);
      expect(strings).not.toContain(published.linkToken);
      expect(strings).not.toContain(rotated.linkToken);
    }
    expect(publishedEvents("publication.link_rotated")).toHaveLength(1);
  });

  it("validates settings", async () => {
    const s = await boardScene();
    const patch = (body: unknown) =>
      s.as(s.owner)(
        `/publication/project/${s.project.id}`,
        json("PATCH", body),
      );
    expect((await patch({ layouts: [] })).status).toBe(400);
    expect(
      (await patch({ layouts: ["list"], defaultLayout: "board" })).status,
    ).toBe(400);
    const moved = await call<Publication>(patch({ layouts: ["list"] }));
    expect(moved).toMatchObject({ layouts: ["list"], defaultLayout: "list" });
    expect((await patch({ bogus: true })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    await setIntakeEnabled(s.project.id, false);
    const requests = await patch({ requestsEnabled: true });
    expect(requests.status).toBe(409);
    expect(await requests.text()).toBe("Turn on Intake for this project first");
    // Settings saved before publishing stay unpublished.
    const saved = await call<Publication>(patch({ commentsEnabled: true }));
    expect(saved).toMatchObject({ published: false, commentsEnabled: true });
  });

  it("refuses publishing when boards are off or the project is archived", async () => {
    const s = await boardScene();
    resetPublicBoardState({ publicBoards: false });
    const off = await s.as(s.owner)(
      `/publication/project/${s.project.id}/publish`,
      json("POST", {}),
    );
    expect(off.status).toBe(409);
    expect(await off.text()).toBe(
      "Public boards are turned off on this server",
    );
    resetPublicBoardState();
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, s.project.id));
    const archived = await s.as(s.owner)(
      `/publication/project/${s.project.id}/publish`,
      json("POST", {}),
    );
    expect(archived.status).toBe(409);
  });

  it("needs project:share to manage and project:read to look", async () => {
    const s = await boardScene();
    const viewer = await addPerson(s.workspaceId, "Vic", "viewer");
    const base = `/publication/project/${s.project.id}`;
    for (const user of [viewer, s.member]) {
      const read = await call<Publication>(s.as(user)(base));
      expect(read.canManage).toBe(false);
      for (const [path, init] of [
        [`${base}/publish`, json("POST", {})],
        [`${base}/unpublish`, { method: "POST" }],
        [base, json("PATCH", { commentsEnabled: true })],
        [`${base}/rotate-link`, { method: "POST" }],
      ] as const) {
        expect((await s.as(user)(path, init)).status).toBe(403);
      }
    }
    const admin = await addPerson(s.workspaceId, "Al", "admin");
    expect(
      (await s.as(admin)(`${base}/publish`, json("POST", {}))).status,
    ).toBe(200);
    expect((await s.as(s.outsider)(base)).status).toBe(403);
  });

  it("answers 404 for an unknown project on every project route", async () => {
    const s = await boardScene();
    const owner = s.as(s.owner);
    const base = `/publication/project/${randomUUID()}`;
    for (const [path, init] of [
      [base, undefined],
      [base, json("PATCH", { commentsEnabled: true })],
      [`${base}/publish`, json("POST", {})],
      [`${base}/unpublish`, { method: "POST" }],
      [`${base}/rotate-link`, { method: "POST" }],
      [`${base}/comments`, undefined],
      [`${base}/blocks`, undefined],
      [`${base}/blocks/${s.member.id}`, json("PUT", {})],
      [`${base}/blocks/${s.member.id}`, { method: "DELETE" }],
    ] as const) {
      const response = await owner(path, init);
      expect(response.status, `${init?.method ?? "GET"} ${path}`).toBe(404);
      expect(await response.text()).toContain("Project not found");
    }
  });

  it("maps the legacy isPublic flag to publish and unpublish", async () => {
    const s = await boardScene();
    const put = (isPublic: boolean) =>
      s.as(s.owner)(
        `/project/${s.project.id}`,
        json("PUT", {
          name: s.project.name,
          icon: s.project.icon,
          slug: s.project.slug,
          description: "",
          isPublic,
        }),
      );
    expect((await put(true)).status).toBe(200);
    const on = await call<Publication>(
      s.as(s.owner)(`/publication/project/${s.project.id}`),
    );
    expect(on).toMatchObject({
      published: true,
      linkToken: s.project.id,
      showAssignees: true,
    });
    expect(publishedEvents("publication.published")).toHaveLength(1);
    expect((await put(false)).status).toBe(200);
    const off = await call<Publication>(
      s.as(s.owner)(`/publication/project/${s.project.id}`),
    );
    expect(off).toMatchObject({ published: false, linkToken: s.project.id });
    expect(publishedEvents("publication.unpublished")).toHaveLength(1);
  });

  it("cascades with the project", async () => {
    const s = await boardScene();
    await s.publish();
    await db
      .delete(schema.projectTable)
      .where(eq(schema.projectTable.id, s.project.id));
    expect(await db.select().from(schema.projectPublicationTable)).toHaveLength(
      0,
    );
  });
});

describe("publication backfill", () => {
  it("gives projects public before B12 a board at their old link, once", async () => {
    const s = await boardScene();
    await db
      .update(schema.projectTable)
      .set({ isPublic: true })
      .where(eq(schema.projectTable.id, s.project.id));
    const first = await migratePublications();
    expect(first.backfilled).toBe(1);
    const [row] = await db
      .select()
      .from(schema.projectPublicationTable)
      .where(eq(schema.projectPublicationTable.projectId, s.project.id));
    expect(row).toMatchObject({
      linkToken: s.project.id,
      showAssignees: true,
      commentsEnabled: false,
      reactionsEnabled: false,
      votesEnabled: false,
      requestsEnabled: false,
      allowGuests: false,
      showBacklog: false,
      layouts: ["board", "list"],
      defaultLayout: "board",
    });
    expect(row?.publishedAt).not.toBeNull();
    expect((await s.as(null)(`/public-project/${s.project.id}`)).status).toBe(
      200,
    );
    expect((await s.as(null)(`/public-board/${s.project.id}`)).status).toBe(
      200,
    );
    expect(await migratePublications()).toEqual({
      backfilled: 0,
      madePublic: 0,
      madePrivate: 0,
    });
  });

  it("repairs the isPublic mirror both ways", async () => {
    const s = await boardScene();
    await s.publish();
    const { project: other } = await createProjectFixture({
      workspaceId: s.workspaceId,
      slug: `p-${randomUUID()}`,
    });
    await db.insert(schema.projectPublicationTable).values({
      projectId: other.id,
      linkToken: `tok${randomUUID()}`.slice(0, 30),
    });
    await db
      .update(schema.projectTable)
      .set({ isPublic: false })
      .where(eq(schema.projectTable.id, s.project.id));
    await db
      .update(schema.projectTable)
      .set({ isPublic: true })
      .where(eq(schema.projectTable.id, other.id));
    expect(await migratePublications()).toEqual({
      backfilled: 0,
      madePublic: 1,
      madePrivate: 1,
    });
    const rows = await db
      .select({
        id: schema.projectTable.id,
        isPublic: schema.projectTable.isPublic,
      })
      .from(schema.projectTable);
    const byId = new Map(rows.map((row) => [row.id, row.isPublic]));
    expect(byId.get(s.project.id)).toBe(true);
    expect(byId.get(other.id)).toBe(false);
  });
});
