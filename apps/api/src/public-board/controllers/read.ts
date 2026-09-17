import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  columnTable,
  externalLinkTable,
  labelTable,
  taskTable,
} from "../../database/schema";
import { voteState } from "../../publication/votes";
import { REACTION_EMOJI } from "../../reaction/emoji";
import { assigneeDetailsOfTasks } from "../../task/assignees";
import {
  boardDescription,
  descriptionDeferred,
  getDescriptionPage,
} from "../../task/description-pages";
import { PLANNED_STATUS } from "../../task/scope";
import { formatTaskKey } from "../../task-activity/task-snapshot";
import { STALE_RESULTS } from "../../task-query/cursor";
import { runTaskQuery, TASK_QUERY_TIMEOUT } from "../../task-query/run";
import { resolveBoardTask, visibleOnBoard } from "../board";
import {
  boardListCacheKey,
  readBoardListCache,
  writeBoardListCache,
} from "../cache";
import { boardRowCounts, taskReactionGroups } from "../counts";
import { guestsAllowed, viewerCan } from "../participation";
import {
  type BoardListQuery,
  boardSorts,
  boardTaskQuery,
  type PublicPerson,
  publicTaskRow,
} from "../query";
import type { PublicViewer, ResolvedBoard } from "../types";

// Public board reads (B12 §3.4 Q1-Q4).

export const BOARD_CHANGED = "The board changed; reload it";
export const BOARD_TOO_SLOW = "The board took too long to load; try again";
const MAX_BOARD_LABELS = 200;

/** Non-triage columns in position order. */
async function boardColumns(projectId: string) {
  return db
    .select({
      slug: columnTable.slug,
      name: columnTable.name,
      icon: columnTable.icon,
      group: columnTable.group,
      isFinal: columnTable.isFinal,
    })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, projectId),
        ne(columnTable.group, "triage"),
      ),
    )
    .orderBy(asc(columnTable.position), asc(columnTable.id));
}

/** Labels used by at least one visible task; the workspace label's color wins. */
async function boardLabels(board: ResolvedBoard) {
  const used = await db
    .selectDistinctOn([labelTable.name], {
      name: labelTable.name,
      color: labelTable.color,
    })
    .from(labelTable)
    .innerJoin(taskTable, eq(taskTable.id, labelTable.taskId))
    .where(and(visibleOnBoard(board), isNull(labelTable.deletionStartedAt)))
    .orderBy(asc(labelTable.name), asc(labelTable.createdAt))
    .limit(MAX_BOARD_LABELS);
  if (used.length === 0) return [];
  const workspaceColors = new Map(
    (
      await db
        .select({ name: labelTable.name, color: labelTable.color })
        .from(labelTable)
        .where(
          and(
            eq(labelTable.workspaceId, board.workspaceId),
            isNull(labelTable.taskId),
            inArray(
              labelTable.name,
              used.map((label) => label.name),
            ),
          ),
        )
        .orderBy(asc(labelTable.createdAt))
    ).map((label) => [label.name, label.color]),
  );
  return used.map((label) => ({
    name: label.name,
    color: workspaceColors.get(label.name) ?? label.color,
  }));
}

/** Q1. */
export async function getPublicBoard(
  board: ResolvedBoard,
  viewer: PublicViewer,
) {
  const [columns, labels] = await Promise.all([
    boardColumns(board.projectId),
    boardLabels(board),
  ]);
  const { settings } = board;
  return {
    project: {
      name: board.project.name,
      slug: board.project.slug,
      icon: board.project.icon,
      description: board.project.description,
      descriptionDeferred: board.project.descriptionDeferred,
    },
    board: {
      layouts: settings.layouts,
      defaultLayout: settings.defaultLayout,
      comments: settings.commentsEnabled,
      reactions: settings.reactionsEnabled,
      votes: settings.votesEnabled,
      requests: settings.requestsEnabled && board.intakeEnabled,
      guestsAllowed: guestsAllowed(board),
      showAssignees: settings.showAssignees,
      showBacklog: settings.showBacklog,
    },
    participation: board.instance.participation,
    columns: [
      ...(settings.showBacklog
        ? [
            {
              slug: PLANNED_STATUS,
              name: "Backlog",
              icon: null,
              group: "backlog",
              isFinal: false,
            },
          ]
        : []),
      ...columns,
    ],
    labels,
    sorts: boardSorts(settings.votesEnabled),
    reactionSet: settings.reactionsEnabled ? [...REACTION_EMOJI] : [],
    viewer: {
      kind: viewer.kind,
      name: viewer.kind === "visitor" ? null : viewer.name,
      image: viewer.kind === "visitor" ? null : viewer.image,
      isMember: board.viewerIsMember,
      blocked: board.viewerBlocked,
      can: viewerCan(viewer, board),
    },
    instance: {
      name: board.instance.instanceName,
      guestSignInAvailable: board.instance.guestAccessActive,
      signUpAvailable: board.instance.signUpAvailable,
    },
  };
}

function mapEngineError(error: unknown): never {
  if (error instanceof HTTPException) {
    if (error.message === STALE_RESULTS) {
      throw new HTTPException(400, { message: BOARD_CHANGED });
    }
    if (error.message === TASK_QUERY_TIMEOUT) {
      throw new HTTPException(503, { message: BOARD_TOO_SLOW });
    }
  }
  throw error;
}

function people(
  assignees: { name: string; image: string | null }[] | undefined,
): PublicPerson[] {
  return (assignees ?? []).map(({ name, image }) => ({ name, image }));
}

async function loadTaskPage(board: ResolvedBoard, query: BoardListQuery) {
  const columns = await boardColumns(board.projectId);
  const request = boardTaskQuery(
    {
      workspaceId: board.workspaceId,
      projectId: board.projectId,
      showBacklog: board.settings.showBacklog,
      votesEnabled: board.settings.votesEnabled,
      columnSlugs: columns.map((column) => column.slug),
    },
    query,
  );
  const result = await runTaskQuery(request, {
    workspaceId: board.workspaceId,
    userId: "",
    publicContext: true,
  }).catch(mapEngineError);

  const shown = new Set([
    ...(board.settings.showBacklog ? [PLANNED_STATUS] : []),
    ...columns.map((column) => column.slug),
  ]);
  const groups = result.groups
    .filter((group) => shown.has(group.key))
    .map((group) => ({
      key: group.key,
      count: group.count,
      taskIds: group.taskIds ?? [],
      nextCursor: group.nextCursor,
    }));
  const ids = groups.flatMap((group) => group.taskIds);
  const [counts, assignees] = await Promise.all([
    boardRowCounts(board, ids),
    board.settings.showAssignees ? assigneeDetailsOfTasks(ids) : null,
  ]);
  const tasks: Record<string, ReturnType<typeof publicTaskRow>> = {};
  for (const id of ids) {
    const row = result.tasks[id];
    if (!row) continue;
    tasks[id] = publicTaskRow(row, {
      assignees: assignees ? people(assignees.get(id)) : undefined,
      counts: counts.get(id) ?? {},
    });
  }
  return { groups, tasks, totalCount: result.totalCount };
}

/** Q2: viewer-agnostic, so cached (the board was resolved first). */
export async function listPublicBoardTasks(
  board: ResolvedBoard,
  query: BoardListQuery,
) {
  const key = boardListCacheKey(board.token, board.updatedAt, query);
  const cached =
    readBoardListCache<Awaited<ReturnType<typeof loadTaskPage>>>(key);
  if (cached) return cached;
  const page = await loadTaskPage(board, query);
  writeBoardListCache(key, page);
  return page;
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Q3. */
export async function getPublicBoardTask(
  board: ResolvedBoard,
  viewer: PublicViewer,
  rawNumber: string,
) {
  const task = await resolveBoardTask(board, rawNumber);
  const { settings } = board;
  const [details, labels, links, assignees, votes, reactions, comments] =
    await Promise.all([
      db
        .select({
          description: boardDescription,
          descriptionDeferred,
        })
        .from(taskTable)
        .where(eq(taskTable.id, task.id))
        .limit(1),
      db
        .select({ name: labelTable.name, color: labelTable.color })
        .from(labelTable)
        .where(
          and(
            eq(labelTable.taskId, task.id),
            isNull(labelTable.deletionStartedAt),
          ),
        )
        .orderBy(asc(labelTable.name)),
      db
        .select()
        .from(externalLinkTable)
        .where(eq(externalLinkTable.taskId, task.id))
        .orderBy(asc(externalLinkTable.createdAt), asc(externalLinkTable.id)),
      settings.showAssignees ? assigneeDetailsOfTasks([task.id]) : null,
      settings.votesEnabled ? voteState(task.id, viewer.userId) : null,
      settings.reactionsEnabled
        ? taskReactionGroups(task.id, viewer.userId)
        : null,
      settings.commentsEnabled
        ? boardRowCounts(
            {
              settings: {
                ...settings,
                votesEnabled: false,
                reactionsEnabled: false,
              },
            },
            [task.id],
          )
        : null,
    ]);
  const description = details[0];
  const can = viewerCan(viewer, board);

  return {
    id: task.id,
    number: task.number,
    key: formatTaskKey(board.project.slug, task.number),
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    startDate: task.startDate,
    labels,
    ...(assignees ? { assignees: people(assignees.get(task.id)) } : {}),
    column:
      task.status === PLANNED_STATUS
        ? { name: "Backlog", icon: null, group: "backlog", isFinal: false }
        : {
            name: task.columnName ?? task.status,
            icon: task.columnIcon ?? null,
            group: task.columnGroup ?? "unstarted",
            isFinal: task.columnIsFinal ?? false,
          },
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    description: description?.description ?? null,
    descriptionDeferred: description?.descriptionDeferred ?? false,
    externalLinks: links.map((link) => ({
      id: link.id,
      resourceType: link.resourceType,
      externalId: link.externalId,
      url: link.url,
      title: link.title,
      metadata: parseMetadata(link.metadata),
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    })),
    ...(votes ? { votes } : {}),
    ...(reactions ? { reactions } : {}),
    ...(comments ? { commentCount: comments.get(task.id)?.comments ?? 0 } : {}),
    can: { comment: can.comment, react: can.react, vote: can.vote },
  };
}

/** Q4. */
export async function getPublicBoardTaskDescription(
  board: ResolvedBoard,
  rawNumber: string,
  query: { offset: number; version?: string },
) {
  const task = await resolveBoardTask(board, rawNumber);
  return getDescriptionPage(task.id, {
    ...query,
    publicProjectId: board.projectId,
  });
}

/** Ids and numbers of the given tasks that are visible on the board now. */
export async function visibleTaskNumbers(
  board: ResolvedBoard,
  taskIds: readonly string[],
) {
  const result = new Map<string, number | null>();
  if (taskIds.length === 0) return result;
  const rows = await db
    .select({ id: taskTable.id, number: taskTable.number })
    .from(taskTable)
    .where(and(visibleOnBoard(board), inArray(taskTable.id, [...taskIds])));
  for (const row of rows) result.set(row.id, row.number);
  return result;
}
