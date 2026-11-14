import { and, asc, eq, like } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { settleAuditWrites } from "../../apps/api/src/audit-log/record";
import db, { schema } from "../../apps/api/src/database";
import {
  auditLogTable,
  projectMemberTable,
} from "../../apps/api/src/database/schema";
import { settleBoardActivity } from "../../apps/api/src/whiteboard/activity";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  allowPublicPages,
  json,
  setWhiteboardsEnabled,
  sticky,
  type WhiteboardScene,
  whiteboardScene,
} from "./helpers/whiteboards";

type ActivityPage = {
  items: Array<{
    id: string;
    action: string;
    actor: { id: string; name: string; image: string | null } | null;
    title: string | null;
    createdAt: string;
  }>;
  nextCursor: string | null;
};

let s: WhiteboardScene;

beforeEach(async () => {
  await resetTestDatabase();
  s = await whiteboardScene();
});

async function settle() {
  await settleBoardActivity();
  await settleAuditWrites();
}

async function auditRows(whiteboardId: string) {
  await settle();
  return (
    db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.targetId, whiteboardId),
          like(auditLogTable.action, "whiteboard.%"),
        ),
      )
      // Entries of one request share the instant; the action breaks the tie.
      .orderBy(asc(auditLogTable.createdAt), asc(auditLogTable.action))
  );
}

async function history(user: WhiteboardScene["ben"], id: string) {
  await settle();
  return s.ok<ActivityPage>(user, `/whiteboard/${id}/activity`);
}

const addSticky = (user: WhiteboardScene["ben"], id: string, text: string) =>
  s.ok(
    user,
    `/whiteboard/${id}/elements`,
    json("POST", { elements: [sticky(text)] }),
  );

async function editedRows(whiteboardId: string) {
  await settle();
  return db
    .select()
    .from(schema.whiteboardActivityTable)
    .where(
      and(
        eq(schema.whiteboardActivityTable.whiteboardId, whiteboardId),
        eq(schema.whiteboardActivityTable.action, "edited"),
      ),
    );
}

describe("whiteboard audit log and history", () => {
  it("records every lifecycle change in the audit log and the board history", async () => {
    await allowPublicPages(s.workspaceId, true);
    const board = await s.create(s.ben, { title: "Sprint 12" });
    const id = board.id;
    await s.ok(
      s.ben,
      `/whiteboard/${id}`,
      json("PATCH", { title: "Sprint 13", icon: "🎯" }),
    );
    await s.ok(s.ben, `/whiteboard/${id}/lock`, { method: "POST" });
    await s.ok(s.ben, `/whiteboard/${id}/lock`, { method: "DELETE" });
    await s.ok(s.admin, `/whiteboard/${id}/publication`, { method: "POST" });
    await s.ok(s.admin, `/whiteboard/${id}/publication`, { method: "DELETE" });
    await s.ok(s.ben, `/whiteboard/${id}/archive`, { method: "POST" });
    await s.ok(s.ben, `/whiteboard/${id}/unarchive`, { method: "POST" });
    await s.trash(s.ben, id);
    await s.ok(s.ben, `/trash/whiteboard/${id}/restore`, { method: "POST" });

    const audit = await auditRows(id);
    expect(audit.map((row) => row.action)).toEqual([
      "whiteboard.created",
      "whiteboard.icon_changed",
      "whiteboard.renamed",
      "whiteboard.locked",
      "whiteboard.unlocked",
      "whiteboard.published",
      "whiteboard.unpublished",
      "whiteboard.archived",
      "whiteboard.unarchived",
      "whiteboard.archived",
      "whiteboard.trashed",
      "whiteboard.restored",
    ]);
    expect(audit[0]).toMatchObject({
      workspaceId: s.workspaceId,
      actorType: "user",
      actorUserId: s.ben.id,
      actorName: "Ben",
      targetType: "whiteboard",
      targetId: id,
      targetLabel: "Sprint 12",
      metadata: { projectId: s.project.id, title: "Sprint 12" },
    });
    expect(audit[2]).toMatchObject({
      targetLabel: "Sprint 13",
      metadata: { title: "Sprint 13" },
    });
    expect(audit[5]).toMatchObject({ actorUserId: s.admin.id });

    const page = await history(s.viewer, id);
    expect(page.nextCursor).toBeNull();
    const actions = page.items.map((item) => item.action);
    expect(actions.slice(0, 9)).toEqual([
      "restored",
      "trashed",
      "archived",
      "unarchived",
      "archived",
      "unpublished",
      "published",
      "unlocked",
      "locked",
    ]);
    // One request renamed and changed the icon: the same instant.
    expect(actions.slice(9, 11).sort()).toEqual(["icon_changed", "renamed"]);
    expect(actions).toHaveLength(12);
    expect(page.items.at(-1)).toMatchObject({
      action: "created",
      actor: { id: s.ben.id, name: "Ben" },
      title: "Sprint 12",
    });
    expect(
      page.items.find((item) => item.action === "published"),
    ).toMatchObject({ actor: { id: s.admin.id, name: "Ada" } });

    // Deleting for good: the audit log keeps it, the history goes with the board.
    await s.ok(s.ben, `/whiteboard/${id}`, { method: "DELETE" });
    await s.ok(s.admin, `/trash/whiteboard/${id}`, { method: "DELETE" });
    const after = await auditRows(id);
    expect(after.at(-1)).toMatchObject({
      action: "whiteboard.purged",
      actorUserId: s.admin.id,
      targetLabel: "Sprint 13",
      metadata: { projectId: s.project.id, title: "Sprint 13" },
    });
    const left = await db
      .select()
      .from(schema.whiteboardActivityTable)
      .where(eq(schema.whiteboardActivityTable.whiteboardId, id));
    expect(left).toEqual([]);
  });

  it("never records board content, and content saves stay out of the audit log", async () => {
    const board = await s.create(s.ben, {
      title: "Plans",
      elements: [sticky("top secret launch date")],
    });
    await addSticky(s.ben, board.id, "another secret");
    const audit = await auditRows(board.id);
    expect(audit.map((row) => row.action)).toEqual(["whiteboard.created"]);
    const rows = await db
      .select()
      .from(schema.whiteboardActivityTable)
      .where(eq(schema.whiteboardActivityTable.whiteboardId, board.id));
    expect(JSON.stringify([audit, rows])).not.toContain("secret");
  });

  it("writes at most one edited entry per person per board every 10 minutes", async () => {
    const board = await s.create(s.ben, { title: "Retro" });
    const other = await s.create(s.ben, { title: "Other" });
    await addSticky(s.ben, board.id, "one");
    await addSticky(s.ben, board.id, "two");
    await addSticky(s.ben, board.id, "three");
    expect(await editedRows(board.id)).toHaveLength(1);

    // Another person, and the same person on another board, count apart.
    await addSticky(s.cara, board.id, "cara");
    await addSticky(s.ben, other.id, "elsewhere");
    expect(
      (await editedRows(board.id)).map((row) => row.actorId).sort(),
    ).toEqual([s.ben.id, s.cara.id].sort());
    expect(await editedRows(other.id)).toHaveLength(1);

    // Nine minutes on, still within the window.
    const backdate = async (minutes: number) =>
      db
        .update(schema.whiteboardActivityTable)
        .set({ createdAt: new Date(Date.now() - minutes * 60_000) })
        .where(eq(schema.whiteboardActivityTable.whiteboardId, board.id));
    await backdate(9);
    await addSticky(s.ben, board.id, "four");
    expect(await editedRows(board.id)).toHaveLength(2);

    // Past ten minutes, the next edit is recorded again.
    await backdate(11);
    await addSticky(s.ben, board.id, "five");
    const rows = await editedRows(board.id);
    expect(rows.filter((row) => row.actorId === s.ben.id)).toHaveLength(2);

    const page = await history(s.ben, board.id);
    expect(page.items[0]).toMatchObject({
      action: "edited",
      actor: { id: s.ben.id, name: "Ben" },
    });
  });

  it("pages the history newest first with a cursor", async () => {
    const board = await s.create(s.ben, { title: "Busy" });
    const base = Date.now() - 60 * 60_000;
    await db.insert(schema.whiteboardActivityTable).values(
      Array.from({ length: 60 }, (_, index) => ({
        whiteboardId: board.id,
        workspaceId: s.workspaceId,
        actorId: s.cara.id,
        action: index % 2 ? "locked" : "unlocked",
        metadata: { title: "Busy" },
        createdAt: new Date(base + index * 1000),
      })),
    );
    // An action this build doesn't list stays out of the response.
    await db.insert(schema.whiteboardActivityTable).values({
      whiteboardId: board.id,
      workspaceId: s.workspaceId,
      actorId: s.cara.id,
      action: "future_thing",
    });
    const first = await history(s.viewer, board.id);
    expect(first.items).toHaveLength(50);
    expect(first.items[0]?.action).toBe("created");
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await s.ok<ActivityPage>(
      s.viewer,
      `/whiteboard/${board.id}/activity?cursor=${first.nextCursor}`,
    );
    expect(second.items).toHaveLength(11);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items];
    expect(new Set(all.map((item) => item.id)).size).toBe(61);
    const times = all.map((item) => Date.parse(item.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(all.map((item) => item.action)).not.toContain("future_thing");

    const bad = await s.call(
      s.viewer,
      `/whiteboard/${board.id}/activity?cursor=nonsense`,
    );
    expect(bad.status).toBe(400);
  });

  it("guards the history like the board: permission, feature, restricted projects", async () => {
    const board = await s.create(s.ben, { title: "Guarded" });
    for (const user of [s.viewer, s.cara, s.admin, s.owner]) {
      const response = await s.call(user, `/whiteboard/${board.id}/activity`);
      expect(response.status, user.name).toBe(200);
    }

    await setWhiteboardsEnabled(s.project.id, false);
    expect(
      (await s.call(s.viewer, `/whiteboard/${board.id}/activity`)).status,
    ).toBe(403);
    await setWhiteboardsEnabled(s.project.id, true);

    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, s.project.id));
    expect(
      (await s.call(s.cara, `/whiteboard/${board.id}/activity`)).status,
    ).toBe(404);
    expect(
      (await s.call(s.admin, `/whiteboard/${board.id}/activity`)).status,
    ).toBe(200);
    await db.insert(projectMemberTable).values({
      projectId: s.project.id,
      userId: s.cara.id,
      role: "member",
    });
    expect(
      (await s.call(s.cara, `/whiteboard/${board.id}/activity`)).status,
    ).toBe(200);

    // A trashed board's history is as hidden as the board.
    await s.trash(s.admin, board.id);
    expect(
      (await s.call(s.admin, `/whiteboard/${board.id}/activity`)).status,
    ).toBe(404);
  });

  it("keeps the history inside its workspace", async () => {
    const board = await s.create(s.ben, { title: "Ours" });
    const other = await createWorkspaceMember({ role: "owner" });
    expect(
      (await s.call(other.user, `/whiteboard/${board.id}/activity`)).status,
    ).toBe(404);

    // The other workspace's own boards never show ours.
    const { project } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    const theirs = await s.ok<{ id: string }>(
      other.user,
      "/whiteboard",
      json("POST", { projectId: project.id, title: "Theirs" }),
      201,
    );
    const page = await history(other.user, theirs.id);
    expect(page.items.map((item) => item.title)).toEqual(["Theirs"]);
    const audit = await auditRows(board.id);
    expect(audit.every((row) => row.workspaceId === s.workspaceId)).toBe(true);
  });
});
