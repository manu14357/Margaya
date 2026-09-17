import type { Context } from "hono";
import { createRateLimiter, type RateLimiter } from "../utils/rate-limit";
import type { ParticipationAction } from "./participation";

// The public board's rate limits (B12 §3.10). Constants for now
// (configurable limits are deferred). Reads are counted before the board
// lookup, so token guessing is bounded too.

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function limiter(name: string, windowSeconds: number, max: number) {
  return createRateLimiter({ name, windowSeconds, max });
}

export const PUBLIC_LIMITS = {
  read: limiter("public-read", MINUTE, 300),
  write: limiter("public-write", MINUTE, 60),
  commentMinute: limiter("public-comment", MINUTE, 6),
  commentHour: limiter("public-comment-hour", HOUR, 60),
  commentGuest: limiter("public-comment-guest", HOUR, 20),
  commentEdit: limiter("public-comment-edit", MINUTE, 30),
  reaction: limiter("public-reaction", MINUTE, 60),
  vote: limiter("public-vote", MINUTE, 60),
  requestHour: limiter("public-request", HOUR, 5),
  requestDay: limiter("public-request-day", DAY, 20),
  requestIp: limiter("public-request-ip", DAY, 20),
  boardComments: limiter("board-comments", HOUR, 300),
  boardRequests: limiter("board-requests", HOUR, 100),
} satisfies Record<string, RateLimiter>;

/** The client IP the client-IP middleware resolved, or one shared bucket. */
export function clientIp(c: Context): string {
  return c.req.header("x-margaya-client-ip")?.trim() || "unknown";
}

type Subjects = {
  userId: string;
  ip: string;
  projectId: string;
  guest: boolean;
};

/** The per-user, guest and per-board limits an action counts against. */
export function actionLimits(
  action: ParticipationAction,
  { userId, ip, projectId, guest }: Subjects,
): Array<[RateLimiter, string | null]> {
  switch (action) {
    case "comment":
      return [
        [PUBLIC_LIMITS.commentMinute, userId],
        [PUBLIC_LIMITS.commentHour, userId],
        [PUBLIC_LIMITS.commentGuest, guest ? ip : null],
        [PUBLIC_LIMITS.boardComments, projectId],
      ];
    case "manageOwnComment":
      return [[PUBLIC_LIMITS.commentEdit, userId]];
    case "react":
      return [[PUBLIC_LIMITS.reaction, userId]];
    case "vote":
      return [[PUBLIC_LIMITS.vote, userId]];
    case "request":
      return [
        [PUBLIC_LIMITS.requestHour, userId],
        [PUBLIC_LIMITS.requestDay, userId],
        [PUBLIC_LIMITS.requestIp, ip],
        [PUBLIC_LIMITS.boardRequests, projectId],
      ];
    case "manageOwnRequest":
      return [];
  }
}
