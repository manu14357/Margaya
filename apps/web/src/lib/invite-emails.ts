import { z } from "zod/v4";

// One submit sends at most this many invitations, one request at a time.
export const MAX_INVITES_PER_SUBMIT = 50;

/**
 * Splits a pasted list on commas, semicolons, spaces and new lines. Valid
 * addresses keep their first spelling and are de-duplicated ignoring case.
 */
export function parseEmailList(text: string): {
  valid: string[];
  invalid: string[];
} {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const email = raw.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (z.email().safeParse(email).success) valid.push(email);
    else invalid.push(email);
  }
  return { valid, invalid };
}

export type InviteFailure = { email: string; message: string };

export type InviteBatchResult = {
  sent: { email: string; id?: string }[];
  failed: InviteFailure[];
};

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Sends invitations one after another, so a hosted rate limit (a handful per
 * minute) fails the tail cleanly instead of racing. A 429 stops the batch:
 * that address and every later one are reported with `rateLimitedMessage`.
 */
export async function sendInvitesInSequence(
  emails: string[],
  send: (email: string) => Promise<{ id?: string } | null | undefined>,
  {
    onProgress,
    fallbackMessage,
    rateLimitedMessage,
  }: {
    onProgress?: (done: number, total: number) => void;
    fallbackMessage: string;
    rateLimitedMessage: string;
  },
): Promise<InviteBatchResult> {
  const result: InviteBatchResult = { sent: [], failed: [] };
  for (const [index, email] of emails.entries()) {
    onProgress?.(index, emails.length);
    try {
      const invitation = await send(email);
      result.sent.push({ email, id: invitation?.id });
    } catch (error) {
      if (statusOf(error) === 429) {
        for (const rest of emails.slice(index)) {
          result.failed.push({ email: rest, message: rateLimitedMessage });
        }
        break;
      }
      result.failed.push({
        email,
        message:
          error instanceof Error && error.message
            ? error.message
            : fallbackMessage,
      });
    }
  }
  onProgress?.(emails.length, emails.length);
  return result;
}

/** The invitation went out, but the projects it adds were refused. */
export class InvitationProjectsError extends Error {}
