import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  activityTable,
  feedbackSurveyStateTable,
  feedbackTable,
  taskTable,
  userTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { enforceRateLimits } from "../../utils/rate-limit";
import { SURVEY_SNOOZE_DAYS } from "../constants";
import {
  countActiveDay,
  type SurveyState,
  surveyGate,
  surveyTrigger,
  utcDay,
} from "../eligibility";
import { feedbackSubmitLimiter, surveyCheckLimiter } from "../limits";
import type { SubmitFeedbackBody } from "../schema";
import { getFeedbackSettings } from "../settings";

export const FEEDBACK_CREATED = "feedback.created";
export const FEEDBACK_DELETED = "feedback.deleted";

const DAY_MS = 24 * 60 * 60 * 1000;
const OWN_FEEDBACK_LIMIT = 500;

const EMPTY_STATE: SurveyState = {
  activeDays: 0,
  lastActiveOn: null,
  lastShownAt: null,
  snoozedUntil: null,
  optedOut: false,
};

async function readSurveyState(userId: string) {
  const [row] = await db
    .select()
    .from(feedbackSurveyStateTable)
    .where(eq(feedbackSurveyStateTable.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function getFeedbackConfig(userId: string) {
  const settings = getFeedbackSettings();
  const state = await readSurveyState(userId);
  return {
    enabled: settings.enabled,
    survey: {
      enabled: settings.enabled && settings.survey.enabled,
      format: settings.survey.format,
      optedOut: state?.optedOut ?? false,
    },
  };
}

export async function submitFeedback(userId: string, body: SubmitFeedbackBody) {
  const settings = getFeedbackSettings();
  if (!settings.enabled) {
    throw new HTTPException(409, {
      message: "Feedback is turned off on this server",
    });
  }
  if (body.kind === "survey" && !settings.survey.enabled) {
    throw new HTTPException(409, { message: "The survey is turned off" });
  }
  await enforceRateLimits([[feedbackSubmitLimiter, userId]]);

  const [row] = await db
    .insert(feedbackTable)
    .values({
      userId,
      kind: body.kind,
      format: body.format,
      score: body.score ?? null,
      comment: body.comment || null,
      pageType: body.pageType ?? null,
      feature: body.kind === "feature" ? (body.feature ?? null) : null,
      appVersion: body.appVersion || null,
      client: body.client ?? null,
    })
    .returning({ id: feedbackTable.id });
  if (!row) {
    throw new HTTPException(500, { message: "Couldn't save the feedback" });
  }

  if (body.kind === "survey") {
    const now = new Date();
    await db
      .insert(feedbackSurveyStateTable)
      .values({ userId, lastAnsweredAt: now, lastShownAt: now })
      .onConflictDoUpdate({
        target: feedbackSurveyStateTable.userId,
        set: { lastAnsweredAt: now, snoozedUntil: null },
      });
  }

  await publishEvent(FEEDBACK_CREATED, { feedbackId: row.id, userId });
  return { id: row.id };
}

/**
 * Tasks this person moved into a completed column since `since`, counted up
 * to `limit` (the trigger only needs to know it was reached). Starts from
 * their own activity rows, which an index orders by person and time.
 */
async function countCompletedTasks(userId: string, since: Date, limit: number) {
  const rows = await db
    .selectDistinct({ taskId: activityTable.taskId })
    .from(activityTable)
    .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
    .where(
      and(
        eq(activityTable.userId, userId),
        eq(activityTable.type, "status_changed"),
        gt(activityTable.createdAt, since),
        gt(taskTable.completedAt, since),
      ),
    )
    .limit(limit);
  return rows.length;
}

/**
 * Whether to show the survey card now. Counts today as an active day, and
 * when the answer is yes records it as asked, so another tab or device
 * doesn't ask too.
 */
export async function checkSurvey(userId: string, now = new Date()) {
  const settings = getFeedbackSettings();
  const format = settings.survey.format;
  if (!settings.enabled || !settings.survey.enabled) {
    return { show: false, format };
  }
  await enforceRateLimits([[surveyCheckLimiter, userId]]);

  const [user] = await db
    .select({ createdAt: userTable.createdAt, kind: userTable.kind })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  if (user?.kind !== "human") return { show: false, format };

  await db
    .insert(feedbackSurveyStateTable)
    .values({ userId })
    .onConflictDoNothing();
  const stored = (await readSurveyState(userId)) ?? { ...EMPTY_STATE };
  const state = countActiveDay(stored, now);

  let show = false;
  const gate = surveyGate({
    settings,
    state,
    accountCreatedAt: user.createdAt,
    now,
  });
  if (!gate) {
    const { tasksCompleted } = settings.survey;
    const since = state.lastShownAt ?? user.createdAt;
    const decision = surveyTrigger({
      settings,
      activeDays: state.activeDays,
      tasksCompleted:
        tasksCompleted > 0
          ? await countCompletedTasks(userId, since, tasksCompleted)
          : 0,
    });
    show = decision.show;
  }

  if (show) {
    // Only the first of two simultaneous checks wins the right to ask.
    const claimed = await db
      .update(feedbackSurveyStateTable)
      .set({ lastShownAt: now, activeDays: 0, lastActiveOn: utcDay(now) })
      .where(
        and(
          eq(feedbackSurveyStateTable.userId, userId),
          stored.lastShownAt
            ? eq(feedbackSurveyStateTable.lastShownAt, stored.lastShownAt)
            : isNull(feedbackSurveyStateTable.lastShownAt),
        ),
      )
      .returning({ userId: feedbackSurveyStateTable.userId });
    return { show: claimed.length > 0, format };
  }

  if (state !== stored) {
    await db
      .update(feedbackSurveyStateTable)
      .set({ activeDays: state.activeDays, lastActiveOn: state.lastActiveOn })
      .where(
        and(
          eq(feedbackSurveyStateTable.userId, userId),
          // Another tab may have counted today already.
          or(
            isNull(feedbackSurveyStateTable.lastActiveOn),
            lt(feedbackSurveyStateTable.lastActiveOn, utcDay(now)),
          ),
        ),
      );
  }
  return { show: false, format };
}

/** Closing the card: ask again after the snooze, not before. */
export async function snoozeSurvey(userId: string, now = new Date()) {
  const snoozedUntil = new Date(now.getTime() + SURVEY_SNOOZE_DAYS * DAY_MS);
  const [row] = await db
    .insert(feedbackSurveyStateTable)
    .values({ userId, snoozedUntil })
    .onConflictDoUpdate({
      target: feedbackSurveyStateTable.userId,
      set: { snoozedUntil },
    })
    .returning();
  return {
    optedOut: row?.optedOut ?? false,
    snoozedUntil: row?.snoozedUntil ?? snoozedUntil,
  };
}

export async function setSurveyPreference(userId: string, optedOut: boolean) {
  const [row] = await db
    .insert(feedbackSurveyStateTable)
    .values({ userId, optedOut })
    .onConflictDoUpdate({
      target: feedbackSurveyStateTable.userId,
      set: { optedOut },
    })
    .returning();
  return { optedOut, snoozedUntil: row?.snoozedUntil ?? null };
}

export async function listOwnFeedback(userId: string) {
  const items = await db
    .select({
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
    })
    .from(feedbackTable)
    .where(eq(feedbackTable.userId, userId))
    .orderBy(desc(feedbackTable.createdAt), desc(feedbackTable.id))
    .limit(OWN_FEEDBACK_LIMIT);
  return { items };
}

export async function deleteOwnFeedback(userId: string) {
  const rows = await db
    .delete(feedbackTable)
    .where(eq(feedbackTable.userId, userId))
    .returning({ id: feedbackTable.id });
  if (rows.length > 0) {
    await publishEvent(FEEDBACK_DELETED, { count: rows.length });
  }
  return { deleted: rows.length };
}
