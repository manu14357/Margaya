import { createHash } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { openWithKey, sealedParts, sealWithKey } from "../utils/secret-box";

// Notification secrets use the shared AES-256-GCM secret box with their own
// key (NOTIFICATION_SECRET_ENCRYPTION_KEY) and prefix, so values stored
// before the secret box existed stay readable.

const SECRET_PREFIX = "enc:v1:";

function getSecretEncryptionKey() {
  const rawKey = process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY?.trim();
  if (!rawKey) {
    return null;
  }

  return createHash("sha256").update(rawKey).digest();
}

export const SECRET_KEY_MISSING_MESSAGE =
  "Notification secrets (webhook signing secrets, ntfy and Gotify tokens) are stored encrypted, and this instance has no NOTIFICATION_SECRET_ENCRYPTION_KEY. Ask your administrator to set it (any long random value, e.g. openssl rand -hex 32) and restart Margaya; everything else here works without it.";

// A missing key is instance configuration, not a server fault: 503 with what
// to change, and only for the requests that need it.
function requireSecretEncryptionKey() {
  const key = getSecretEncryptionKey();
  if (!key) {
    throw new HTTPException(503, { message: SECRET_KEY_MISSING_MESSAGE });
  }

  return key;
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(SECRET_PREFIX);
}

function isValidEncryptedSecret(value: string): boolean {
  try {
    decryptSecret(value);
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  if (isEncryptedSecret(value) && isValidEncryptedSecret(value)) {
    return value;
  }

  return sealWithKey(requireSecretEncryptionKey(), SECRET_PREFIX, value);
}

export function decryptSecret(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined || value === null || !isEncryptedSecret(value)) {
    return value;
  }

  if (!sealedParts(value, SECRET_PREFIX)) {
    throw new HTTPException(500, {
      message: "Invalid encrypted notification secret payload",
    });
  }

  const key = requireSecretEncryptionKey();
  try {
    return openWithKey(key, SECRET_PREFIX, value);
  } catch {
    throw new HTTPException(500, {
      message: "Failed to decrypt notification secret",
    });
  }
}
