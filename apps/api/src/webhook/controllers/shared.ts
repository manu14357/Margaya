import { randomBytes } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { sealSecret } from "../../utils/secret-box";
import { UnknownWebhookEventError, validatePatterns } from "../catalog";
import { WEBHOOK_SECRET_PURPOSE } from "../types";

export const WEBHOOK_URL_TAKEN = "A webhook for this URL already exists";
export const DELIVERY_NOT_FOUND = "Delivery not found";

/** A new signing secret: whsec_ and 32 random bytes in base64url. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

/** The sealed secret and the columns that describe it. */
export function sealedWebhookSecret(secret: string) {
  return {
    secretCiphertext: sealSecret(WEBHOOK_SECRET_PURPOSE, secret),
    secretLast4: secret.slice(-4),
  };
}

/** Trimmed; empty is stored as null. */
export function normalizeWebhookName(
  name: string | null | undefined,
): string | null {
  const trimmed = name?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/** Validated patterns, or 400 "Unknown event: {value}". */
export function webhookPatterns(events: readonly string[]): string[] {
  try {
    return validatePatterns(events);
  } catch (error) {
    if (error instanceof UnknownWebhookEventError) {
      throw new HTTPException(400, { message: error.message });
    }
    throw error;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}
