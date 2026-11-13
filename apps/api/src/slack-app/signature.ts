import { createHmac, timingSafeEqual } from "node:crypto";

// Slack signs every HTTP Events, Interactivity and slash command request:
// `v0=` + HMAC-SHA256(signingSecret, `v0:<timestamp>:<raw body>`). A request
// older or newer than five minutes is refused, so a captured request can't
// be replayed later.

export const SLACK_SIGNATURE_MAX_AGE_SECONDS = 5 * 60;

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: "missing" | "stale" | "mismatch" };

export function computeSlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
): string {
  const digest = createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex");
  return `v0=${digest}`;
}

export function verifySlackSignature(input: {
  signingSecret: string;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  rawBody: string;
  /** Seconds since the epoch; injectable for tests. */
  now?: number;
}): SignatureCheck {
  const { timestamp, signature } = input;
  if (!timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) {
    return { ok: false, reason: "missing" };
  }
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > SLACK_SIGNATURE_MAX_AGE_SECONDS) {
    return { ok: false, reason: "stale" };
  }
  const expected = Buffer.from(
    computeSlackSignature(input.signingSecret, timestamp, input.rawBody),
  );
  const received = Buffer.from(signature);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}
