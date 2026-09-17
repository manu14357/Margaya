import type { MiddlewareHandler } from "hono";
import { auth } from "../auth";
import { eventContext } from "../events";
import { verifyApiKey } from "../utils/verify-api-key";
import type { PublicViewer } from "./types";

// Resolves who is looking at a public board (B12 §3.5). Never throws for a
// missing or bad credential: reads work for everyone, and the participation
// gate refuses writes.

type SessionUser = {
  id: string;
  name?: string | null;
  image?: string | null;
  isAnonymous?: boolean | null;
  banned?: boolean | null;
  banExpires?: Date | string | null;
};

const VISITOR: PublicViewer = {
  kind: "visitor",
  userId: null,
  name: null,
  image: null,
  banned: false,
  apiKey: false,
  malformedAuth: false,
};

async function sessionUser(headers: Headers): Promise<SessionUser | null> {
  try {
    const session = await auth.api.getSession({ headers });
    return (session?.user as SessionUser | undefined) ?? null;
  } catch {
    return null;
  }
}

function isBanned(user: SessionUser, now: number) {
  if (!user.banned) return false;
  if (!user.banExpires) return true;
  return new Date(user.banExpires).getTime() > now;
}

export async function resolvePublicViewer(
  headers: Headers,
): Promise<PublicViewer> {
  if (headers.get("x-api-key")) return { ...VISITOR, apiKey: true };

  const authorization = headers.get("authorization");
  let user: SessionUser | null;
  if (authorization && /^Bearer\b/i.test(authorization)) {
    const token = authorization.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return { ...VISITOR, malformedAuth: true };
    user = await sessionUser(new Headers({ authorization: `Bearer ${token}` }));
    if (!user) {
      const apiKey = await verifyApiKey(token);
      return apiKey?.valid ? { ...VISITOR, apiKey: true } : VISITOR;
    }
  } else {
    user = await sessionUser(headers);
  }
  if (!user) return VISITOR;

  return {
    kind: user.isAnonymous ? "guest" : "account",
    userId: user.id,
    name: user.name ?? null,
    image: user.image ?? null,
    banned: isBanned(user, Date.now()),
    apiKey: false,
    malformedAuth: false,
  };
}

/**
 * Sets `viewer`, and runs the rest of the chain with the viewer as the
 * event initiator, so the author's own app tabs skip their echo.
 */
export function publicViewer(): MiddlewareHandler {
  return async (c, next) => {
    const viewer = await resolvePublicViewer(c.req.raw.headers);
    c.set("viewer", viewer);
    if (!viewer.userId) return next();
    const windowId = c.req.header("X-Margaya-Window-Id");
    const initiatorId = windowId
      ? `${viewer.userId}:${windowId}`
      : viewer.userId;
    return eventContext.run({ initiatorId }, next);
  };
}
