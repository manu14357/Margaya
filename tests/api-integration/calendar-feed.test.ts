import type { User } from "better-auth/types";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  calendarFeedTable,
  projectMemberTable,
} from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { endMemberAccess } from "../../apps/api/src/workspace/end-member-access";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  assignTask,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Calendar (ICS) subscription feeds: managing them needs a session and
// workspace access; fetching one needs only its secret URL token, and every
// fetch re-checks membership and restricted-project visibility.

const DAY_MS = 86_400_000;
const soon = (days: number) => new Date(Date.now() + days * DAY_MS);

type Created = { id: string; url: string; webcalUrl: string; kind: string };

async function seed() {
  const { user: owner, workspace } = await createWorkspaceMember({
    role: "owner",
  });
  const member = await addWorkspaceMember(workspace.id, "member");
  const guest = await addWorkspaceMember(workspace.id, "guest");
  const { project: open } = await createProjectFixture({
    workspaceId: workspace.id,
    name: "Open project",
    slug: "OPN",
  });
  const { project: secret } = await createProjectFixture({
    workspaceId: workspace.id,
    name: "Secret project",
    slug: "SEC",
  });
  await db
    .update(schema.projectTable)
    .set({ visibility: "restricted" })
    .where(eq(schema.projectTable.id, secret.id));

  // Clear of the numbers the API hands out, and unique per project.
  let nextNumber = 900;
  const insertTask = async (
    projectId: string,
    title: string,
    values: Partial<typeof schema.taskTable.$inferInsert> = {},
  ) => {
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title,
        status: "to-do",
        number: nextNumber++,
        ...values,
      })
      .returning();
    if (!task) throw new Error("task not created");
    return task;
  };

  const mine = await insertTask(open.id, "Zebra mine", { dueDate: soon(3) });
  const undated = await insertTask(open.id, "Zebra undated");
  const others = await insertTask(open.id, "Zebra others", {
    dueDate: soon(4),
  });
  const hidden = await insertTask(secret.id, "Zebra hidden", {
    dueDate: soon(5),
  });
  const milestone = await insertTask(open.id, "Zebra milestone", {
    dueDate: soon(6),
    isMilestone: true,
  });
  await assignTask(mine.id, [member.id, guest.id]);
  await assignTask(undated.id, [member.id]);
  await assignTask(others.id, [owner.id]);
  // Assigned, but in a restricted project the member is not in.
  await assignTask(hidden.id, [member.id]);

  const [cycle] = await db
    .insert(schema.cycleTable)
    .values({
      projectId: open.id,
      name: "Zebra cycle",
      startDate: soon(-2).toISOString().slice(0, 10),
      endDate: soon(10).toISOString().slice(0, 10),
    })
    .returning();

  return {
    workspace,
    owner,
    member,
    guest,
    open,
    secret,
    milestone,
    cycle,
  };
}

describe("calendar feeds", () => {
  const { app } = createApp();

  beforeEach(async () => {
    await resetTestDatabase();
  });

  const as = (user: User) => mockAuthenticatedSession(user);

  async function createWorkspaceFeed(
    user: User,
    workspaceId: string,
    kind: "my_tasks" | "planning",
  ) {
    as(user);
    return app.request(
      `/api/calendar-feed/workspace/${workspaceId}`,
      json("POST", { kind, name: "My tasks" }),
    );
  }

  async function fetchFeed(url: string, init?: RequestInit) {
    mockAnonymousSession();
    return app.request(new URL(url).pathname, init);
  }

  it("refuses anonymous management calls", async () => {
    const s = await seed();
    mockAnonymousSession();
    expect(
      (await app.request(`/api/calendar-feed/workspace/${s.workspace.id}`))
        .status,
    ).toBe(401);
    expect(
      (
        await app.request(
          `/api/calendar-feed/workspace/${s.workspace.id}`,
          json("POST", { kind: "my_tasks", name: "x" }),
        )
      ).status,
    ).toBe(401);
  });

  it("serves my dated tasks as all-day events, without hidden projects", async () => {
    const s = await seed();
    const response = await createWorkspaceFeed(
      s.member,
      s.workspace.id,
      "my_tasks",
    );
    expect(response.status).toBe(200);
    const created = (await response.json()) as Created;
    expect(created.url).toMatch(
      /\/api\/calendar-feed\/mgcal_[^/]+\/feed\.ics$/,
    );
    expect(created.webcalUrl.startsWith("webcal://")).toBe(true);

    const feed = await fetchFeed(created.url);
    expect(feed.status).toBe(200);
    expect(feed.headers.get("content-type")).toContain("text/calendar");
    expect(feed.headers.get("cache-control")).toContain("private");
    const body = await feed.text();
    expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(body).toContain("Zebra mine");
    expect(body).toContain("DTSTART;VALUE=DATE:");
    expect(body).not.toContain("Zebra undated");
    expect(body).not.toContain("Zebra others");
    expect(body).not.toContain("Zebra hidden");
    expect(body).not.toContain("Zebra cycle");

    // Joining the restricted project brings its task in.
    await db
      .insert(projectMemberTable)
      .values({ projectId: s.secret.id, userId: s.member.id, role: "member" });
    expect(await (await fetchFeed(created.url)).text()).toContain(
      "Zebra hidden",
    );
  });

  it("answers 304 for an unchanged feed", async () => {
    const s = await seed();
    const created = (await (
      await createWorkspaceFeed(s.member, s.workspace.id, "my_tasks")
    ).json()) as Created;
    const first = await fetchFeed(created.url);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const again = await fetchFeed(created.url, {
      headers: { "If-None-Match": etag ?? "" },
    });
    expect(again.status).toBe(304);
  });

  it("serves milestones and cycles in the planning feed", async () => {
    const s = await seed();
    const created = (await (
      await createWorkspaceFeed(s.member, s.workspace.id, "planning")
    ).json()) as Created;
    const body = await (await fetchFeed(created.url)).text();
    expect(body).toContain("Zebra milestone");
    expect(body).toContain("Zebra cycle");
    expect(body).not.toContain("Zebra mine");
  });

  it("regenerating replaces the URL and revoking ends it", async () => {
    const s = await seed();
    const first = (await (
      await createWorkspaceFeed(s.member, s.workspace.id, "my_tasks")
    ).json()) as Created;
    const second = (await (
      await createWorkspaceFeed(s.member, s.workspace.id, "my_tasks")
    ).json()) as Created;
    expect(second.id).toBe(first.id);
    expect(second.url).not.toBe(first.url);
    expect((await fetchFeed(first.url)).status).toBe(404);
    expect((await fetchFeed(second.url)).status).toBe(200);

    as(s.member);
    const list = (await (
      await app.request(`/api/calendar-feed/workspace/${s.workspace.id}`)
    ).json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    // Only the token's first characters are listed, never the token.
    const token = new URL(second.url).pathname.split("/")[3] ?? "";
    expect(token).toMatch(/^mgcal_/);
    expect(JSON.stringify(list)).not.toContain(token);
    expect(list[0]?.tokenStart).toBe(token.slice(0, 10));

    // Someone else's feed reads as missing.
    as(s.owner);
    expect(
      (
        await app.request(`/api/calendar-feed/${first.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);

    as(s.member);
    expect(
      (
        await app.request(`/api/calendar-feed/${first.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    expect((await fetchFeed(second.url)).status).toBe(404);
  });

  it("hides restricted projects from project feeds", async () => {
    const s = await seed();
    as(s.member);
    expect(
      (
        await app.request(
          `/api/calendar-feed/project/${s.secret.id}`,
          json("POST", { name: "Secret" }),
        )
      ).status,
    ).toBe(404);

    const response = await app.request(
      `/api/calendar-feed/project/${s.open.id}`,
      json("POST", { name: "Open" }),
    );
    expect(response.status).toBe(200);
    const created = (await response.json()) as Created;
    const body = await (await fetchFeed(created.url)).text();
    expect(body).toContain("Zebra others");
    expect(body).toContain("Zebra cycle");

    // Restricting the project later ends the feed for non-members.
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, s.open.id));
    expect((await fetchFeed(created.url)).status).toBe(404);
  });

  it("limits a guest's feed to their projects", async () => {
    const s = await seed();
    const created = (await (
      await createWorkspaceFeed(s.guest, s.workspace.id, "my_tasks")
    ).json()) as Created;
    expect(await (await fetchFeed(created.url)).text()).not.toContain(
      "Zebra mine",
    );

    await db
      .insert(projectMemberTable)
      .values({ projectId: s.open.id, userId: s.guest.id, role: "member" });
    expect(await (await fetchFeed(created.url)).text()).toContain("Zebra mine");

    as(s.guest);
    expect(
      (
        await app.request(
          `/api/calendar-feed/project/${s.secret.id}`,
          json("POST", { name: "Secret" }),
        )
      ).status,
    ).toBe(404);
  });

  it("stops serving a removed member and forgets their feeds", async () => {
    const s = await seed();
    const created = (await (
      await createWorkspaceFeed(s.member, s.workspace.id, "my_tasks")
    ).json()) as Created;
    expect((await fetchFeed(created.url)).status).toBe(200);

    await db
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, s.workspace.id),
          eq(schema.workspaceUserTable.userId, s.member.id),
        ),
      );
    expect((await fetchFeed(created.url)).status).toBe(404);

    await endMemberAccess({
      workspaceId: s.workspace.id,
      userId: s.member.id,
      byThemselves: false,
    });
    const rows = await db
      .select()
      .from(calendarFeedTable)
      .where(eq(calendarFeedTable.userId, s.member.id));
    expect(rows).toHaveLength(0);
  });

  it("answers 404 for unknown or malformed tokens", async () => {
    mockAnonymousSession();
    expect(
      (await app.request("/api/calendar-feed/not-a-token/feed.ics")).status,
    ).toBe(404);
    expect(
      (await app.request(`/api/calendar-feed/mgcal_${"a".repeat(43)}/feed.ics`))
        .status,
    ).toBe(404);
  });
});
