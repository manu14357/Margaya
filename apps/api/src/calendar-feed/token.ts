import { createHash, randomBytes } from "node:crypto";

// Feed tokens are 256 random bits, so a fast hash is enough: there is nothing
// to brute-force. Only the hash is stored; the URL is shown once.

const PREFIX = "mgcal_";
const TOKEN_PATTERN = /^mgcal_[A-Za-z0-9_-]{43}$/;
const START_LENGTH = PREFIX.length + 4;

export function generateFeedToken(): string {
  return `${PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashFeedToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The visible start of a token, to tell feeds apart in settings. */
export function feedTokenStart(token: string): string {
  return token.slice(0, START_LENGTH);
}

/** Cheap shape check before any database lookup. */
export function isFeedTokenShape(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}
