import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { feedbackTable, userTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { recordInstanceAudit } from "../../instance-admin/audit";
import { decodeKeyset, encodeKeyset } from "../../publication/keyset";
import { CSV_BOM, csvLine } from "../../task-export/encoders/csv";
import { enforceRateLimits } from "../../utils/rate-limit";
import type { FeedbackFormat, FeedbackKind } from "../constants";
import { feedbackAdminDeleteLimiter } from "../limits";
import type { AdminFeedbackFilter } from "../schema";
import { getFeedbackSettings } from "../settings";
import {
  fullDistribution,
  summarizeScores,
  type WeekScoreCount,
  weeklyTrend,
} from "../summary";
import { FEEDBACK_DELETED } from "./user";

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_FEEDBACK_EXPORT_ROWS = 10_000;

// The cursor key: created_at in UTC with microseconds (JavaScript dates keep
// only milliseconds).
const createdAtKey = sql<string>`to_char(${feedbackTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function since(days: number, now = new Date()) {
  return new Date(now.getTime() - days * DAY_MS);
}

export function feedbackFilterConditions(filter: AdminFeedbackFilter): SQL[] {
  const conditions: SQL[] = [];
  if (filter.kind) conditions.push(eq(feedbackTable.kind, filter.kind));
  if (filter.format) conditions.push(eq(feedbackTable.format, filter.format));
  if (filter.score !== undefined) {
    conditions.push(eq(feedbackTable.score, filter.score));
  }
  if (filter.hasComment === "true") {
    conditions.push(isNotNull(feedbackTable.comment));
  } else if (filter.hasComment === "false") {
    conditions.push(isNull(feedbackTable.comment));
  }
  if (filter.days) {
    conditions.push(gte(feedbackTable.createdAt, since(filter.days)));
  }
  if (filter.search) {
    const pattern = likePattern(filter.search);
    const match = or(
      ilike(feedbackTable.comment, pattern),
      ilike(userTable.name, pattern),
      ilike(userTable.email, pattern),
    );
    if (match) conditions.push(match);
  }
  return conditions;
}

const adminColumns = {
  id: feedbackTable.id,
  kind: feedbackTable.kind,
  format: feedbackTable.format,
  score: feedbackTable.score,
  comment: feedbackTable.comment,
  pageType: feedbackTable.pageType,
  feature: feedbackTable.feature,
  appVersion: feedbackTable.appVersion,
  client: feedbackTable.client,
  createdAt: feedbackTable.createdAt,
  userId: userTable.id,
  userName: userTable.name,
  userEmail: userTable.email,
};

type AdminRow = {
  [K in keyof typeof adminColumns]:
    | (typeof adminColumns)[K]["_"]["data"]
    | null;
};

function toAdminFeedback(row: AdminRow & { id: string; createdAt: Date }) {
  const { userId, userName, userEmail, ...rest } = row;
  return {
    ...rest,
    kind: rest.kind as FeedbackKind,
    format: rest.format as FeedbackFormat,
    user: { id: userId ?? "", name: userName ?? "", email: userEmail ?? "" },
  };
}

/** Newest first, filtered, a page at a time. */
export async function listAdminFeedback(
  query: AdminFeedbackFilter & { cursor?: string; limit: number },
) {
  const conditions = feedbackFilterConditions(query);
  if (query.cursor) {
    const cursor = decodeKeyset(query.cursor);
    conditions.push(
      sql`(${feedbackTable.createdAt}, ${feedbackTable.id}) < ((${cursor.at}::timestamp at time zone 'UTC'), ${cursor.id}::text)`,
    );
  }
  const rows = await db
    .select({ ...adminColumns, cursorKey: createdAtKey })
    .from(feedbackTable)
    .innerJoin(userTable, eq(userTable.id, feedbackTable.userId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(feedbackTable.createdAt), desc(feedbackTable.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(({ cursorKey: _cursorKey, ...row }) =>
      toAdminFeedback(row),
    ),
    nextCursor:
      rows.length > query.limit && last
        ? encodeKeyset(last.cursorKey, last.id)
        : null,
  };
}

const CSV_HEADER = [
  "time",
  "source",
  "scale",
  "score",
  "comment",
  "page_type",
  "feature",
  "app_version",
  "client",
  "name",
  "email",
];

/** The filtered answers as CSV, newest first, at most 10,000 rows. */
export async function exportAdminFeedbackCsv(filter: AdminFeedbackFilter) {
  const conditions = feedbackFilterConditions(filter);
  const rows = await db
    .select(adminColumns)
    .from(feedbackTable)
    .innerJoin(userTable, eq(userTable.id, feedbackTable.userId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(feedbackTable.createdAt), desc(feedbackTable.id))
    .limit(MAX_FEEDBACK_EXPORT_ROWS);
  let csv = CSV_BOM + csvLine(CSV_HEADER);
  for (const row of rows) {
    csv += csvLine([
      row.createdAt.toISOString(),
      row.kind,
      row.format,
      row.score,
      row.comment ?? "",
      row.pageType ?? "",
      row.feature ?? "",
      row.appVersion ?? "",
      row.client ?? "",
      row.userName ?? "",
      row.userEmail ?? "",
    ]);
  }
  return csv;
}

/** Averages, the happy share, NPS, the distribution and a weekly trend. */
export async function getAdminFeedbackSummary(query: {
  format?: FeedbackFormat;
  kind?: FeedbackKind;
  days: number;
}) {
  const format = query.format ?? getFeedbackSettings().survey.format;
  const from = since(query.days);
  const inPeriod = gte(feedbackTable.createdAt, from);
  const scored = and(
    inPeriod,
    eq(feedbackTable.format, format),
    isNotNull(feedbackTable.score),
    query.kind ? eq(feedbackTable.kind, query.kind) : undefined,
  );
  const week = sql<string>`to_char(date_trunc('week', ${feedbackTable.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;

  const [scoreRows, weekRows, kindRows] = await Promise.all([
    db
      .select({ score: feedbackTable.score, count: count() })
      .from(feedbackTable)
      .where(scored)
      .groupBy(feedbackTable.score),
    db
      .select({ week, score: feedbackTable.score, count: count() })
      .from(feedbackTable)
      .where(scored)
      .groupBy(week, feedbackTable.score),
    db
      .select({
        kind: feedbackTable.kind,
        count: count(),
        comments: count(feedbackTable.comment),
      })
      .from(feedbackTable)
      .where(inPeriod)
      .groupBy(feedbackTable.kind),
  ]);

  const scores = scoreRows.map((row) => ({
    score: row.score ?? 0,
    count: Number(row.count),
  }));
  const weeks: WeekScoreCount[] = weekRows.map((row) => ({
    week: row.week,
    score: row.score ?? 0,
    count: Number(row.count),
  }));
  const byKind = { general: 0, survey: 0, feature: 0 };
  let comments = 0;
  for (const row of kindRows) {
    byKind[row.kind as FeedbackKind] = Number(row.count);
    comments += Number(row.comments);
  }

  return {
    format,
    days: query.days,
    ...summarizeScores(format, scores),
    total: byKind.general + byKind.survey + byKind.feature,
    comments,
    byKind,
    distribution: fullDistribution(format, scores),
    trend: weeklyTrend(format, weeks),
  };
}

export async function deleteAdminFeedback(id: string, adminId: string) {
  await enforceRateLimits([[feedbackAdminDeleteLimiter, adminId]]);
  const [row] = await db
    .delete(feedbackTable)
    .where(eq(feedbackTable.id, id))
    .returning({ id: feedbackTable.id });
  if (!row) throw new HTTPException(404, { message: "No such feedback" });
  await recordInstanceAudit({
    action: "feedback.deleted",
    target: { type: "feedback", id: row.id },
    metadata: { count: 1 },
  });
  await publishEvent(FEEDBACK_DELETED, { count: 1 });
  return { deleted: 1 };
}

/** Deletes answers older than N days (0: every answer). */
export async function purgeAdminFeedback(
  olderThanDays: number,
  adminId: string,
) {
  await enforceRateLimits([[feedbackAdminDeleteLimiter, adminId]]);
  const rows = await db
    .delete(feedbackTable)
    .where(
      olderThanDays > 0
        ? lt(feedbackTable.createdAt, since(olderThanDays))
        : undefined,
    )
    .returning({ id: feedbackTable.id });
  if (rows.length > 0) {
    await recordInstanceAudit({
      action: "feedback.deleted",
      target: { type: "feedback", id: null, label: null },
      metadata: { count: rows.length, olderThanDays },
    });
    await publishEvent(FEEDBACK_DELETED, { count: rows.length });
  }
  return { deleted: rows.length };
}
