import type { Session, User } from "better-auth/types";
import { vi } from "vitest";
import { auth } from "../../../apps/api/src/auth";

function createSession(userId: string): Session {
  const now = new Date();

  return {
    id: `session-${userId}`,
    token: `token-${userId}`,
    userId,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
    ipAddress: null,
    userAgent: null,
  };
}

// `auth` is a facade over the current Better Auth instance, and `auth.api`
// returns that instance's api object, so these spies hold while the instance
// stays the same. Saving new OAuth credentials (instance settings) rebuilds it;
// a test that does so must spy again afterwards.
export function mockAuthenticatedSession(user: User) {
  return vi.spyOn(auth.api, "getSession").mockResolvedValue({
    session: createSession(user.id),
    user,
  });
}

export function mockAnonymousSession() {
  return vi.spyOn(auth.api, "getSession").mockResolvedValue(null);
}
