import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { encodeScope } from "../../apps/api/src/api-key/scope";
import db, { schema } from "../../apps/api/src/database";
import { projectMemberTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { createApiKey } from "./helpers/api-keys";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type User = typeof schema.userTable.$inferSelect;

async function addTask(projectId: string, title: string, number: number) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId, title, status: "to-do", number, position: number })
    .returning();
  return task;
}

async function scene() {
  const { user: owner, workspace } = await createWorkspaceMember({
    role: "owner",
  });
  const member = await addWorkspaceMember(workspace.id, "member");
  const colleague = await addWorkspaceMember(workspace.id, "member");
  const viewer = await addWorkspaceMember(workspace.id, "viewer");
  const { project: alpha } = await createProjectFixture({
    workspaceId: workspace.id,
    name: "Alpha",
    slug: "alp",
  });
  const { project: beta } = await createProjectFixture({
    workspaceId: workspace.id,
    name: "Beta",
    slug: "bet",
  });
  const first = await addTask(alpha.id, "First", 1);
  const second = await addTask(alpha.id, "Second", 2);
  const other = await addTask(beta.id, "Other", 1);

  const { app } = createApp();
  const send = (as: User, path: string, init: RequestInit = {}) => {
    mockAuthenticatedSession(as);
    return app.request(`/api/time-entry${path}`, {
      headers: { "content-type": "application/json" },
      ...init,
    });
  };
  const startTimer = (as: User, taskId: string, startTime?: string) =>
    send(as, "", {
      method: "POST",
      body: JSON.stringify({
        taskId,
        startTime: startTime ?? new Date().toISOString(),
      }),
    });
  const logged = (
    as: User,
    taskId: string,
    startTime: string,
    endTime: string,
  ) =>
    send(as, "", {
      method: "POST",
      body: JSON.stringify({ taskId, startTime, endTime }),
    });
  const stop = (as: User, id: string) =>
    send(as, `/${id}/stop`, { method: "POST" });
  const running = (as: User) =>
    send(as, `/running?workspaceId=${workspace.id}`);
  const report = (as: User, query = "") =>
    send(
      as,
      `/report?workspaceId=${workspace.id}&from=2026-03-01&to=2026-03-31&timeZone=UTC${query}`,
    );

  return {
    app,
    owner,
    member,
    colleague,
    viewer,
    workspace,
    alpha,
    beta,
    first,
    second,
    other,
    startTimer,
    logged,
    stop,
    running,
    report,
    send,
  };
}

const openEntries = (userId: string) =>
  db
    .select({ id: schema.timeEntryTable.id })
    .from(schema.timeEntryTable)
    .where(
      and(
        eq(schema.timeEntryTable.userId, userId),
        isNull(schema.timeEntryTable.endTime),
      ),
    );

beforeEach(async () => {
  await resetTestDatabase();
});

describe("the timer", () => {
  it("starts, reads back with its task, and stops by the server's clock", async () => {
    const { member, first, alpha, startTimer, running, stop } = await scene();

    const startedAt = new Date(Date.now() - 90_000).toISOString();
    const started = await startTimer(member, first.id, startedAt);
    expect(started.status).toBe(200);
    const entry = await started.json();
    expect(entry).toMatchObject({
      endTime: null,
      duration: null,
      stoppedEntries: [],
    });

    const current = await (await running(member)).json();
    expect(current.entry).toMatchObject({
      id: entry.id,
      taskId: first.id,
      taskTitle: "First",
      taskNumber: 1,
      projectId: alpha.id,
      projectSlug: "alp",
    });

    const stopped = await stop(member, entry.id);
    expect(stopped.status).toBe(200);
    const closed = await stopped.json();
    expect(closed.endTime).not.toBeNull();
    expect(closed.duration).toBeGreaterThanOrEqual(90);
    expect(closed.duration).toBeLessThan(120);
    expect((await (await running(member)).json()).entry).toBeNull();
  });

  it("keeps one timer per person: starting another stops the first", async () => {
    const { member, colleague, first, second, startTimer } = await scene();

    const a = await (await startTimer(member, first.id)).json();
    const theirs = await (await startTimer(colleague, first.id)).json();
    const b = await (await startTimer(member, second.id)).json();

    expect(b.stoppedEntries).toEqual([{ id: a.id, taskId: first.id }]);
    expect((await openEntries(member.id)).map((row) => row.id)).toEqual([b.id]);
    // Someone else's timer is untouched.
    expect((await openEntries(colleague.id)).map((row) => row.id)).toEqual([
      theirs.id,
    ]);
  });

  it("holds one timer when two starts arrive together", async () => {
    const { member, first, second, startTimer } = await scene();

    const responses = await Promise.all([
      startTimer(member, first.id),
      startTimer(member, second.id),
      startTimer(member, first.id),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200,
    ]);
    expect(await openEntries(member.id)).toHaveLength(1);
  });

  it("stops every running entry left over from before the rule", async () => {
    const { member, first, second, startTimer } = await scene();
    const leftovers = await db
      .insert(schema.timeEntryTable)
      .values(
        ["2026-01-01T09:00:00Z", "2026-01-02T09:00:00Z"].map((start) => ({
          id: randomUUID(),
          taskId: first.id,
          userId: member.id,
          startTime: new Date(start),
          duration: null,
        })),
      )
      .returning();

    const started = await (await startTimer(member, second.id)).json();

    expect(started.stoppedEntries).toHaveLength(2);
    expect((await openEntries(member.id)).map((row) => row.id)).toEqual([
      started.id,
    ]);
    const closed = await db
      .select()
      .from(schema.timeEntryTable)
      .where(
        inArray(
          schema.timeEntryTable.id,
          leftovers.map((row) => row.id),
        ),
      );
    expect(closed.every((row) => row.duration && row.duration > 0)).toBe(true);
  });

  it("does not touch a running timer when finished time is logged", async () => {
    const { member, first, second, startTimer, logged } = await scene();
    const timer = await (await startTimer(member, first.id)).json();

    const entry = await (
      await logged(
        member,
        second.id,
        "2026-03-01T09:00:00Z",
        "2026-03-01T10:00:00Z",
      )
    ).json();

    expect(entry.stoppedEntries).toEqual([]);
    expect((await openEntries(member.id)).map((row) => row.id)).toEqual([
      timer.id,
    ]);
  });

  it("closes an entry started in the future at its start, with no time", async () => {
    const { member, first, startTimer, stop } = await scene();
    const entry = await (
      await startTimer(member, first.id, "2099-01-01T00:00:00.000Z")
    ).json();

    const closed = await (await stop(member, entry.id)).json();

    expect(closed.duration).toBe(0);
    expect(closed.endTime).toBe("2099-01-01T00:00:00.000Z");
  });

  it("answers with the entry unchanged when it has already stopped", async () => {
    const { member, first, startTimer, stop } = await scene();
    const entry = await (await startTimer(member, first.id)).json();

    const once = await (await stop(member, entry.id)).json();
    const twice = await stop(member, entry.id);

    expect(twice.status).toBe(200);
    expect(await twice.json()).toMatchObject({
      endTime: once.endTime,
      duration: once.duration,
    });
  });

  it("lets only the author, or someone who may delete tasks, stop it", async () => {
    const { owner, member, colleague, viewer, first, startTimer, stop } =
      await scene();
    const entry = await (await startTimer(member, first.id)).json();

    expect((await stop(colleague, entry.id)).status).toBe(403);
    expect((await stop(viewer, entry.id)).status).toBe(403);
    expect(await openEntries(member.id)).toHaveLength(1);

    expect((await stop(owner, entry.id)).status).toBe(200);
    expect(await openEntries(member.id)).toHaveLength(0);
  });

  it("hides an entry from another workspace behind 404", async () => {
    const { member, first, startTimer, stop } = await scene();
    const { user: stranger } = await createWorkspaceMember({ role: "owner" });
    const entry = await (await startTimer(member, first.id)).json();

    expect((await stop(stranger, entry.id)).status).toBe(404);
    expect((await stop(member, "no-such-entry")).status).toBe(404);
    expect(await openEntries(member.id)).toHaveLength(1);
  });

  it("answers 403 to stop while time tracking is off", async () => {
    const { member, first, alpha, startTimer, stop, running } = await scene();
    const entry = await (await startTimer(member, first.id)).json();
    await db
      .update(schema.projectTable)
      .set({ timeTrackingEnabled: false })
      .where(eq(schema.projectTable.id, alpha.id));

    expect((await stop(member, entry.id)).status).toBe(403);
    expect((await (await running(member)).json()).entry).toBeNull();
  });

  it("reads a timer on a trashed task as none, and a new start still closes it", async () => {
    const { member, first, second, startTimer, running } = await scene();
    const entry = await (await startTimer(member, first.id)).json();
    await db
      .update(schema.taskTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.taskTable.id, first.id));

    expect((await (await running(member)).json()).entry).toBeNull();

    const next = await (await startTimer(member, second.id)).json();
    expect(next.stoppedEntries).toEqual([{ id: entry.id, taskId: first.id }]);
  });

  it("refuses the running timer to someone outside the workspace", async () => {
    const { running } = await scene();
    const { user: stranger } = await createWorkspaceMember({ role: "owner" });

    expect((await running(stranger)).status).toBe(403);
  });
});

describe("editing an entry", () => {
  it("changes the range and note, and keeps a running entry running", async () => {
    const { member, first, send, startTimer, logged } = await scene();
    const finished = await (
      await logged(
        member,
        first.id,
        "2026-03-01T09:00:00Z",
        "2026-03-01T10:00:00Z",
      )
    ).json();

    const edited = await send(member, `/${finished.id}`, {
      method: "PUT",
      body: JSON.stringify({
        startTime: "2026-03-01T09:30:00Z",
        endTime: "2026-03-01T11:30:00Z",
        description: "Corrected",
      }),
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({
      duration: 7200,
      description: "Corrected",
    });

    const timer = await (await startTimer(member, first.id)).json();
    const moved = await send(member, `/${timer.id}`, {
      method: "PUT",
      body: JSON.stringify({ startTime: "2026-03-01T12:00:00Z" }),
    });
    expect(await moved.json()).toMatchObject({ endTime: null, duration: null });
  });
});

describe("the project role on an entry", () => {
  const entryOf = async (taskId: string, userId: string) => {
    const [entry] = await db
      .insert(schema.timeEntryTable)
      .values({
        id: randomUUID(),
        taskId,
        userId,
        description: "before",
        startTime: new Date("2026-03-01T09:00:00Z"),
        duration: null,
      })
      .returning();
    if (!entry) throw new Error("no entry");
    return entry;
  };
  const restrict = (projectId: string) =>
    db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, projectId));
  const addToProject = (projectId: string, userId: string, role: string) =>
    db.insert(projectMemberTable).values({ projectId, userId, role });
  const edit = (
    send: Awaited<ReturnType<typeof scene>>["send"],
    as: User,
    id: string,
  ) =>
    send(as, `/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        startTime: "2026-03-01T09:30:00Z",
        description: "after",
      }),
    });
  const stored = async (id: string) => {
    const [row] = await db
      .select()
      .from(schema.timeEntryTable)
      .where(eq(schema.timeEntryTable.id, id));
    return row;
  };

  it("keeps someone capped to viewer from changing their own entry", async () => {
    const { member, first, alpha, send, stop } = await scene();
    const entry = await entryOf(first.id, member.id);
    await restrict(alpha.id);
    await addToProject(alpha.id, member.id, "viewer");

    expect((await edit(send, member, entry.id)).status).toBe(403);
    expect((await stop(member, entry.id)).status).toBe(403);
    expect(
      (await send(member, `/${entry.id}`, { method: "DELETE" })).status,
    ).toBe(403);

    const row = await stored(entry.id);
    expect(row).toMatchObject({ description: "before", endTime: null });
  });

  it("lets a project member change their own entry", async () => {
    const { member, first, alpha, send, stop } = await scene();
    const entry = await entryOf(first.id, member.id);
    await restrict(alpha.id);
    await addToProject(alpha.id, member.id, "member");

    expect((await edit(send, member, entry.id)).status).toBe(200);
    expect((await stop(member, entry.id)).status).toBe(200);
  });

  it("caps a custom role's right to change other people's entries", async () => {
    const { member, first, alpha, workspace, send } = await scene();
    const entry = await entryOf(first.id, member.id);
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: workspace.id,
      role: "auditor",
      permission: JSON.stringify({
        project: ["read"],
        task: ["read", "update", "delete"],
      }),
    });
    const auditor = await addWorkspaceMember(workspace.id, "auditor");
    await restrict(alpha.id);
    await addToProject(alpha.id, member.id, "member");
    await addToProject(alpha.id, auditor.id, "viewer");

    expect((await edit(send, auditor, entry.id)).status).toBe(403);
    expect(
      (await send(auditor, `/${entry.id}`, { method: "DELETE" })).status,
    ).toBe(403);
    expect(await stored(entry.id)).toMatchObject({ description: "before" });

    // A project role that allows the same is no cap.
    await db
      .update(projectMemberTable)
      .set({ role: "auditor" })
      .where(eq(projectMemberTable.userId, auditor.id));
    expect((await edit(send, auditor, entry.id)).status).toBe(200);
  });

  it("applies a guest's project role to their own entries", async () => {
    const { first, other, alpha, beta, workspace, send, stop } = await scene();
    const guest = await addWorkspaceMember(workspace.id, "guest");
    await addToProject(alpha.id, guest.id, "viewer");
    await addToProject(beta.id, guest.id, "member");
    const readOnly = await entryOf(first.id, guest.id);
    const editable = await entryOf(other.id, guest.id);

    expect((await stop(guest, readOnly.id)).status).toBe(403);
    expect((await edit(send, guest, readOnly.id)).status).toBe(403);
    expect((await stop(guest, editable.id)).status).toBe(200);
  });
});

describe("the timer through a project-limited API key", () => {
  const limitedKey = (user: User, projectIds: string[]) =>
    createApiKey(
      user,
      encodeScope({ access: "full", projectIds }) ?? undefined,
    );

  it("leaves timers outside the key's projects running and unnamed", async () => {
    const { app, member, first, second, other, alpha, startTimer } =
      await scene();
    // A timer in another workspace, and one in another project of this one.
    const elsewhere = await createWorkspaceMember({ role: "owner" });
    const { project: foreign } = await createProjectFixture({
      workspaceId: elsewhere.workspace.id,
      slug: "frn",
    });
    const foreignTask = await addTask(foreign.id, "Foreign", 1);
    if (!foreignTask) throw new Error("no task");
    const inBeta = await (await startTimer(member, other.id)).json();
    const [foreignTimer] = await db
      .insert(schema.timeEntryTable)
      .values({
        id: randomUUID(),
        taskId: foreignTask.id,
        userId: member.id,
        startTime: new Date("2026-03-01T09:00:00Z"),
        duration: null,
      })
      .returning();
    const [inAlpha] = await db
      .insert(schema.timeEntryTable)
      .values({
        id: randomUUID(),
        taskId: first.id,
        userId: member.id,
        startTime: new Date("2026-03-01T10:00:00Z"),
        duration: null,
      })
      .returning();

    const key = await limitedKey(member, [alpha.id]);
    const started = await app.request("/api/time-entry", {
      method: "POST",
      headers: { "content-type": "application/json", ...key.headers },
      body: JSON.stringify({
        taskId: second.id,
        startTime: new Date().toISOString(),
      }),
    });
    expect(started.status, await started.clone().text()).toBe(200);
    const body = await started.json();

    expect(body.stoppedEntries).toEqual([
      { id: inAlpha?.id, taskId: first.id },
    ]);
    expect(JSON.stringify(body)).not.toContain(inBeta.id);
    expect(JSON.stringify(body)).not.toContain(foreignTimer?.id);
    expect((await openEntries(member.id)).map((row) => row.id).sort()).toEqual(
      [foreignTimer?.id, inBeta.id, body.id].sort(),
    );
  });

  it("still keeps one timer through a key without a project limit", async () => {
    const { app, member, first, other, startTimer } = await scene();
    const inBeta = await (await startTimer(member, other.id)).json();
    const key = await createApiKey(member);
    const started = await app.request("/api/time-entry", {
      method: "POST",
      headers: { "content-type": "application/json", ...key.headers },
      body: JSON.stringify({
        taskId: first.id,
        startTime: new Date().toISOString(),
      }),
    });
    const body = await started.json();

    expect(body.stoppedEntries).toEqual([{ id: inBeta.id, taskId: other.id }]);
    expect((await openEntries(member.id)).map((row) => row.id)).toEqual([
      body.id,
    ]);
  });
});

describe("time totals", () => {
  async function logged() {
    const context = await scene();
    const { member, colleague, first, other, logged: log } = context;
    // Alpha: member 1h + 30m, colleague 2h. Beta: member 15m.
    await log(member, first.id, "2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z");
    await log(member, first.id, "2026-03-03T09:00:00Z", "2026-03-03T09:30:00Z");
    await log(
      colleague,
      first.id,
      "2026-03-04T09:00:00Z",
      "2026-03-04T11:00:00Z",
    );
    await log(member, other.id, "2026-03-05T09:00:00Z", "2026-03-05T09:15:00Z");
    return context;
  }

  it("adds up time by person and by project", async () => {
    const { owner, member, colleague, alpha, beta, report } = await logged();

    const response = await report(owner);
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      totalSeconds: 3600 + 1800 + 7200 + 900,
      entryCount: 4,
      runningCount: 0,
      timeZone: "UTC",
    });
    expect(
      body.byPerson.map((row: { userId: string; seconds: number }) => [
        row.userId,
        row.seconds,
      ]),
    ).toEqual([
      [colleague.id, 7200],
      [member.id, 3600 + 1800 + 900],
    ]);
    expect(body.byPerson[0].name).toBe("Integration member");
    expect(
      body.byProject.map((row: { projectId: string; seconds: number }) => [
        row.projectId,
        row.seconds,
      ]),
    ).toEqual([
      [alpha.id, 3600 + 1800 + 7200],
      [beta.id, 900],
    ]);
  });

  it("narrows to the selected projects", async () => {
    const { owner, beta, report } = await logged();

    const body = await (await report(owner, `&projectIds=${beta.id}`)).json();

    expect(body.totalSeconds).toBe(900);
    expect(body.byProject).toHaveLength(1);
  });

  it("counts a running entry as running, never as time", async () => {
    const { owner, member, first, send, report } = await logged();
    await send(member, "", {
      method: "POST",
      body: JSON.stringify({
        taskId: first.id,
        startTime: "2026-03-06T09:00:00Z",
      }),
    });

    const body = await (await report(owner)).json();

    expect(body.runningCount).toBe(1);
    expect(body.totalSeconds).toBe(3600 + 1800 + 7200 + 900);
    expect(body.entryCount).toBe(4);
  });

  it("reads the range as local days in the requested zone", async () => {
    const {
      owner,
      member,
      first,
      workspace,
      logged: log,
      send,
    } = await scene();
    // 20:00 on the 31st in UTC is already 1 April in Kolkata (+05:30, 01:30).
    await log(member, first.id, "2026-03-31T20:00:00Z", "2026-03-31T21:00:00Z");
    const inZone = (zone: string) =>
      send(
        owner,
        `/report?workspaceId=${workspace.id}&from=2026-03-01&to=2026-03-31&timeZone=${encodeURIComponent(zone)}`,
      ).then((response) => response.json());

    expect((await inZone("UTC")).totalSeconds).toBe(3600);
    expect((await inZone("Asia/Kolkata")).totalSeconds).toBe(0);
  });

  it("leaves out trashed tasks and projects with time tracking off", async () => {
    const { owner, first, beta, report } = await logged();
    await db
      .update(schema.taskTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.taskTable.id, first.id));
    await db
      .update(schema.projectTable)
      .set({ timeTrackingEnabled: false })
      .where(eq(schema.projectTable.id, beta.id));

    const body = await (await report(owner)).json();

    expect(body.totalSeconds).toBe(0);
    expect(body.byPerson).toEqual([]);
    expect(body.byProject).toEqual([]);
  });

  it("counts people who left without naming them", async () => {
    const { owner, colleague, report } = await logged();
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, colleague.id));

    const body = await (await report(owner)).json();
    const former = body.byPerson.find(
      (row: { userId: string | null }) => row.userId === null,
    );

    expect(former).toMatchObject({ name: null, seconds: 7200, entryCount: 1 });
  });

  it("keeps restricted projects out of the totals of people who can't see them", async () => {
    const { owner, member, beta, report } = await logged();
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, beta.id));

    const seenByMember = await (await report(member)).json();
    const seenByOwner = await (await report(owner)).json();

    expect(seenByMember.byProject).toHaveLength(1);
    expect(seenByMember.totalSeconds).toBe(3600 + 1800 + 7200);
    expect(seenByOwner.byProject).toHaveLength(2);
  });

  it("needs analytics:read, which viewers don't have by default", async () => {
    const { viewer, report } = await logged();

    expect((await report(viewer)).status).toBe(403);
  });

  it("rejects an invalid range and a project from elsewhere", async () => {
    const { owner, workspace, report, send } = await logged();
    const range = (from: string, to: string) =>
      send(owner, `/report?workspaceId=${workspace.id}&from=${from}&to=${to}`);

    expect((await range("2026-13-01", "2026-13-02")).status).toBe(400);
    expect((await range("2026-03-31", "2026-03-01")).status).toBe(400);
    expect((await range("2010-01-01", "2026-01-01")).status).toBe(400);
    expect((await report(owner, "&projectIds=no-such-project")).status).toBe(
      404,
    );
  });
});
