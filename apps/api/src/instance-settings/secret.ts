import {
  canOpenSecret,
  openSecret,
  SECRET_BOX_PREFIX,
  sealSecret,
} from "../utils/secret-box";

// Instance-setting secrets (SMTP password, OAuth client secrets) use the
// shared secret box with their own purpose, so their key differs from every
// other sealed value. Rotating AUTH_SECRET makes them unreadable; the panel
// then asks the admin to enter them again.

const PURPOSE = "instance-setting";

export const INSTANCE_SECRET_PREFIX = SECRET_BOX_PREFIX;

export function sealInstanceSecret(plaintext: string): string {
  return sealSecret(PURPOSE, plaintext);
}

/** The plaintext, or null when the value can't be opened with the current key. */
export function openInstanceSecret(sealed: string): string | null {
  try {
    return openSecret(PURPOSE, sealed);
  } catch {
    return null;
  }
}

export function canOpenInstanceSecret(sealed: string): boolean {
  return canOpenSecret(PURPOSE, sealed);
}
