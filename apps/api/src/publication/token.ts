import { randomBytes } from "node:crypto";

// Public board link tokens (B12 K2): 22 random base62 characters. Backfilled
// boards use their project id, so the format check accepts any 16-64
// characters of A-Z a-z 0-9 _ -.

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const LINK_TOKEN_LENGTH = 22;
// 248 = 4 * 62: bytes at or above it are dropped so every character is
// equally likely (no modulo bias).
const ACCEPT_BELOW = 248;
const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function generateLinkToken(): string {
  let token = "";
  while (token.length < LINK_TOKEN_LENGTH) {
    for (const byte of randomBytes(32)) {
      if (byte >= ACCEPT_BELOW) continue;
      token += ALPHABET[byte % ALPHABET.length];
      if (token.length === LINK_TOKEN_LENGTH) break;
    }
  }
  return token;
}

export function isLinkTokenFormat(value: string): boolean {
  return LINK_TOKEN_PATTERN.test(value);
}

export function publicBoardPath(token: string): string {
  return `/public-project/${token}`;
}
