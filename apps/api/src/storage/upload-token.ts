import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveAuthSecret } from "../utils/auth-secret";

// The local store's stand-in for a presigned PUT: the API signs the key,
// content type, size and expiry it approved, and the upload route accepts
// bytes only for exactly that grant. Signed with AUTH_SECRET, so a token
// can't be forged or altered, and it expires like a presigned URL.

export type UploadGrant = {
  key: string;
  contentType: string;
  size: number;
  /** Unix time in milliseconds. */
  expiresAt: number;
};

const CONTEXT = "margaya-local-upload:v1";
const MAX_TOKEN_LENGTH = 4096;

function sign(payload: string) {
  return createHmac("sha256", resolveAuthSecret())
    .update(`${CONTEXT}\n${payload}`)
    .digest("base64url");
}

export function signUploadToken(grant: UploadGrant): string {
  const payload = Buffer.from(
    JSON.stringify({
      k: grant.key,
      t: grant.contentType,
      s: grant.size,
      e: grant.expiresAt,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The grant a token carries, or null when it is forged, altered or expired. */
export function verifyUploadToken(
  token: string,
  now = Date.now(),
): UploadGrant | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const { k, t, s, e } = (parsed ?? {}) as Record<string, unknown>;
  if (
    typeof k !== "string" ||
    typeof t !== "string" ||
    typeof s !== "number" ||
    typeof e !== "number" ||
    !Number.isSafeInteger(s) ||
    s <= 0
  ) {
    return null;
  }
  if (e <= now) return null;
  return { key: k, contentType: t, size: s, expiresAt: e };
}
