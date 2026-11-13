import { createHmac, timingSafeEqual } from "node:crypto";
import { secretBoxKey } from "../utils/secret-box";

// The account-link prompt carries a short-lived signed token naming the
// Slack identity (workspace, team, user). Slack shows the prompt only to that
// Slack user; the signed-in Margaya user who opens it and confirms becomes
// the account that Slack user acts as. Stateless: nothing is stored until
// the link is confirmed.

export const LINK_TOKEN_TTL_SECONDS = 15 * 60;

export type LinkClaims = {
  workspaceId: string;
  teamId: string;
  slackUserId: string;
  slackUserName: string | null;
  /** Expiry, seconds since the epoch. */
  exp: number;
};

function sign(payload: string): string {
  return createHmac("sha256", secretBoxKey("slack-link-token"))
    .update(payload)
    .digest("base64url");
}

export function createLinkToken(
  claims: Omit<LinkClaims, "exp">,
  now = Math.floor(Date.now() / 1000),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      w: claims.workspaceId,
      t: claims.teamId,
      u: claims.slackUserId,
      n: claims.slackUserName ?? null,
      e: now + LINK_TOKEN_TTL_SECONDS,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The claims of a valid, unexpired token, or null. */
export function readLinkToken(
  token: string,
  now = Math.floor(Date.now() / 1000),
): LinkClaims | null {
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return null;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (
    typeof value.w !== "string" ||
    typeof value.t !== "string" ||
    typeof value.u !== "string" ||
    typeof value.e !== "number"
  ) {
    return null;
  }
  if (value.e < now) return null;
  return {
    workspaceId: value.w,
    teamId: value.t,
    slackUserId: value.u,
    slackUserName: typeof value.n === "string" ? value.n : null,
    exp: value.e,
  };
}
