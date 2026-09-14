import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { resolveAuthSecret } from "./auth-secret";

// AES-256-GCM sealing for secrets the server must read back later (webhook
// signing secrets, notification tokens). One stored form for every caller:
// `<prefix><iv>.<tag>.<ciphertext>`, each part base64url. Callers choose the
// key and the prefix; `sealSecret`/`openSecret` derive the key from
// AUTH_SECRET per purpose, so no extra environment variable is needed.

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export const SECRET_BOX_PREFIX = "sbx:v1:";
const HKDF_SALT = "margaya-secret-box";

/** Thrown when a sealed value can't be opened: wrong prefix, key or data. */
export class SecretUnreadableError extends Error {
  constructor() {
    super("The secret can't be read with the current key");
    this.name = "SecretUnreadableError";
  }
}

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

/** The three base64url parts after `prefix`, or null when malformed. */
export function sealedParts(
  value: string,
  prefix: string,
): [string, string, string] | null {
  if (!value.startsWith(prefix)) return null;
  const [iv, tag, ciphertext, ...rest] = value.slice(prefix.length).split(".");
  if (!iv || !tag || !ciphertext || rest.length > 0) return null;
  return [iv, tag, ciphertext];
}

/** Seals `plaintext` with a 32-byte key under `prefix`. */
export function sealWithKey(
  key: Buffer,
  prefix: string,
  plaintext: string,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return `${prefix}${encode(iv)}.${encode(cipher.getAuthTag())}.${encode(ciphertext)}`;
}

/** Opens a value sealed by `sealWithKey`; throws `SecretUnreadableError`. */
export function openWithKey(
  key: Buffer,
  prefix: string,
  sealed: string,
): string {
  const parts = sealedParts(sealed, prefix);
  if (!parts) throw new SecretUnreadableError();
  const [iv, tag, ciphertext] = parts;
  try {
    const decipher = createDecipheriv(ALGORITHM, key, decode(iv));
    decipher.setAuthTag(decode(tag));
    return Buffer.concat([
      decipher.update(decode(ciphertext)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretUnreadableError();
  }
}

const derivedKeys = new Map<string, Buffer>();

/**
 * The key for one purpose: HKDF-SHA256 over AUTH_SECRET. Changing
 * AUTH_SECRET makes every value sealed with the old key unreadable.
 */
export function secretBoxKey(
  purpose: string,
  authSecret: string = resolveAuthSecret(),
): Buffer {
  const cacheKey = `${purpose}\u0000${authSecret}`;
  const cached = derivedKeys.get(cacheKey);
  if (cached) return cached;
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      authSecret,
      HKDF_SALT,
      `margaya:${purpose}:v1`,
      KEY_BYTES,
    ),
  );
  // A handful of purposes; the bound only matters if AUTH_SECRET changes
  // repeatedly in one process (tests).
  if (derivedKeys.size >= 16) derivedKeys.clear();
  derivedKeys.set(cacheKey, key);
  return key;
}

/** Seals a secret for `purpose` (for example `webhook-secret`). */
export function sealSecret(purpose: string, plaintext: string): string {
  return sealWithKey(secretBoxKey(purpose), SECRET_BOX_PREFIX, plaintext);
}

/** Opens a secret sealed for `purpose`; throws `SecretUnreadableError`. */
export function openSecret(purpose: string, sealed: string): string {
  return openWithKey(secretBoxKey(purpose), SECRET_BOX_PREFIX, sealed);
}

/** Whether the sealed value opens under the current key. */
export function canOpenSecret(purpose: string, sealed: string): boolean {
  try {
    openSecret(purpose, sealed);
    return true;
  } catch {
    return false;
  }
}
