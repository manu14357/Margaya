import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { enforceRateLimits, type RateLimiter } from "../utils/rate-limit";
import { actionLimits, clientIp } from "./limits";
import {
  type ParticipationAction,
  participationDecision,
} from "./participation";
import type { PublicViewer, ResolvedBoard } from "./types";

// Middleware for the public board router (B12 §3.4).

/** Every public response: never indexed, never cached by intermediaries. */
export function publicResponseHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header("X-Robots-Tag", "noindex");
    c.header("Cache-Control", "no-store");
  };
}

/** The per-IP limit every route counts first (public-read or public-write). */
export function perIpLimit(limiter: RateLimiter): MiddlewareHandler {
  return async (c, next) => {
    await enforceRateLimits([[limiter, clientIp(c)]]);
    return next();
  };
}

/** §3.8: who may take part, then the per-user, guest and per-board limits. */
export function requireParticipation(
  action: ParticipationAction,
): MiddlewareHandler {
  return async (c, next) => {
    const viewer = c.get("viewer") as PublicViewer;
    const board = c.get("board") as ResolvedBoard;
    const decision = participationDecision(viewer, board, action);
    if (!decision.ok) {
      throw new HTTPException(decision.status, { message: decision.message });
    }
    await enforceRateLimits(
      actionLimits(action, {
        userId: viewer.userId ?? "",
        ip: clientIp(c),
        projectId: board.projectId,
        guest: viewer.kind === "guest",
      }),
    );
    return next();
  };
}
