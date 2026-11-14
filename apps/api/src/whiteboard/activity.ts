import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  userTable,
  whiteboardActivityTable,
  whiteboardTable,
} from "../database/schema";
import { subscribeToEvent } from "../events";
import { broadcastToProject } from "../ws";
import {
  BOARD_EDIT_WINDOW_MS,
  BOARD_HISTORY_ACTIONS,
  BOARD_LIFECYCLE_EVENTS,
  type BoardHistoryAction,
  boardLifecycleActions,
  editorsToRecord,
} from "./activity-map";

// The board history behind GET /whiteboard/{id}/activity, written from the
// whiteboard events. Rows hold ids and the title at the time, never content.

type BoardEvent = Record<string, unknown>;

const MAX_TITLE = 200;
export const BOARD_ACTIVITY_PAGE_SIZE = 50;
export const INVALID_ACTIVITY_CURSOR = "Invalid cursor";

const str = (value: unknown) =>
  typeof value === "string" && value ? value : null;

const pending = new Set<Promise<void>>();

/** Waits for history writes started so far (tests). */
export async function settleBoardActivity(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}

async function track(work: () => Promise<void>) {
  const task = work();
  pending.add(task);
  try {
    await task;
  } finally {
    pending.delete(task);
  }
}

/**
 * Tells the project's open clients to refetch once the row exists, the
 * initiator's own window included (the event's hint may beat the write).
 * Within the 100 ms batch it merges with that hint.
 */
function hintWritten(projectId: string | null, whiteboardId: string) {
  if (!projectId) return;
  broadcastToProject(projectId, {
    type: "whiteboard.changed",
    projectId,
    whiteboardId,
  });
}

async function boardTitle(whiteboardId: string) {
  const [row] = await db
    .select({ title: whiteboardTable.title })
    .from(whiteboardTable)
    .where(eq(whiteboardTable.id, whiteboardId))
    .limit(1);
  return row ? row.title : null;
}

export async function recordLifecycle(eventName: string, data: BoardEvent) {
  const whiteboardId = str(data.whiteboardId);
  const workspaceId = str(data.workspaceId);
  const actions = boardLifecycleActions(eventName, data).filter(
    (action): action is Exclude<typeof action, "purged"> => action !== "purged",
  );
  if (!whiteboardId || !workspaceId || actions.length === 0) return;
  const title =
    typeof data.title === "string"
      ? data.title
      : await boardTitle(whiteboardId);
  await db.insert(whiteboardActivityTable).values(
    actions.map((action) => ({
      whiteboardId,
      workspaceId,
      actorId: str(data.userId),
      action,
      metadata: { title: title?.slice(0, MAX_TITLE) ?? null },
    })),
  );
  hintWritten(str(data.projectId), whiteboardId);
}

/**
 * An "edited" row for each contributor of a content save who has none on
 * this board in the last ten minutes. The advisory lock keeps two saves of
 * the same board (two servers, or a REST write next to a room) from both
 * writing one.
 */
export async function recordEdits(data: BoardEvent, now = new Date()) {
  const whiteboardId = str(data.whiteboardId);
  const workspaceId = str(data.workspaceId);
  if (!whiteboardId || !workspaceId) return;
  const contributors = [
    ...(Array.isArray(data.contributorIds) ? data.contributorIds : []),
    data.userId,
  ];
  const candidates = editorsToRecord(contributors, [], now);
  if (candidates.length === 0) return;
  const written = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`whiteboard_activity:${whiteboardId}`}))`,
    );
    const recent = await tx
      .select({
        actorId: whiteboardActivityTable.actorId,
        createdAt: whiteboardActivityTable.createdAt,
      })
      .from(whiteboardActivityTable)
      .where(
        and(
          eq(whiteboardActivityTable.whiteboardId, whiteboardId),
          eq(whiteboardActivityTable.action, "edited"),
          inArray(whiteboardActivityTable.actorId, candidates),
          gt(
            whiteboardActivityTable.createdAt,
            new Date(now.getTime() - BOARD_EDIT_WINDOW_MS),
          ),
        ),
      );
    const due = editorsToRecord(candidates, recent, now);
    if (due.length === 0) return 0;
    // Contributors whose account is gone meanwhile are skipped.
    const people = await tx
      .select({ id: userTable.id })
      .from(userTable)
      .where(inArray(userTable.id, due));
    if (people.length === 0) return 0;
    await tx.insert(whiteboardActivityTable).values(
      people.map((person) => ({
        whiteboardId,
        workspaceId,
        actorId: person.id,
        action: "edited",
        createdAt: now,
      })),
    );
    return people.length;
  });
  if (written > 0) hintWritten(str(data.projectId), whiteboardId);
}

for (const eventName of BOARD_LIFECYCLE_EVENTS) {
  void subscribeToEvent<BoardEvent>(eventName, async (data) => {
    if (typeof data !== "object" || data === null) return;
    await track(() => recordLifecycle(eventName, data));
  });
}

void subscribeToEvent<BoardEvent>("whiteboard.content_saved", async (data) => {
  if (typeof data !== "object" || data === null) return;
  await track(() => recordEdits(data));
});

type Cursor = { createdAt: string; id: string };

function encodeCursor(cursor: Cursor) {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString(
    "base64url",
  );
}

function decodeCursor(raw: string): Cursor {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const separator = text.indexOf("|");
  const createdAt = separator > 0 ? text.slice(0, separator) : "";
  const id = separator > 0 ? text.slice(separator + 1) : "";
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) {
    throw new HTTPException(400, { message: INVALID_ACTIVITY_CURSOR });
  }
  return { createdAt, id };
}

// The instant with microseconds, so a cursor never skips a row.
const createdAtKey = sql<string>`to_char(${whiteboardActivityTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** One page of a board's history, newest first. */
export async function listWhiteboardActivity(
  whiteboardId: string,
  cursor?: string,
) {
  const after = cursor ? decodeCursor(cursor) : null;
  const rows = await db
    .select({
      id: whiteboardActivityTable.id,
      action: whiteboardActivityTable.action,
      metadata: whiteboardActivityTable.metadata,
      createdAt: whiteboardActivityTable.createdAt,
      cursorKey: createdAtKey,
      actorId: userTable.id,
      actorName: userTable.name,
      actorImage: userTable.image,
    })
    .from(whiteboardActivityTable)
    .leftJoin(userTable, eq(userTable.id, whiteboardActivityTable.actorId))
    .where(
      and(
        eq(whiteboardActivityTable.whiteboardId, whiteboardId),
        inArray(whiteboardActivityTable.action, [...BOARD_HISTORY_ACTIONS]),
        after
          ? sql`(${whiteboardActivityTable.createdAt}, ${whiteboardActivityTable.id}) < (${after.createdAt}::timestamptz, ${after.id}::text)`
          : undefined,
      ),
    )
    .orderBy(
      sql`${whiteboardActivityTable.createdAt} desc`,
      sql`${whiteboardActivityTable.id} desc`,
    )
    .limit(BOARD_ACTIVITY_PAGE_SIZE + 1);

  const page = rows.slice(0, BOARD_ACTIVITY_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => ({
      id: row.id,
      action: row.action as BoardHistoryAction,
      actor: row.actorId
        ? {
            id: row.actorId,
            name: row.actorName ?? "",
            image: row.actorImage ?? null,
          }
        : null,
      title: row.metadata?.title ?? null,
      createdAt: row.createdAt,
    })),
    nextCursor:
      rows.length > BOARD_ACTIVITY_PAGE_SIZE && last
        ? encodeCursor({ createdAt: last.cursorKey, id: last.id })
        : null,
  };
}
