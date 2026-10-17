import { COMMON_PASSWORD_BASES, COMMON_PASSWORDS } from "./common-passwords";

// The server-side rules for a new password (sign-up, reset, change, admin
// set and the recovery CLI). Existing passwords keep working until changed.
// Everything runs locally: no network lookups.

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordPolicyCode =
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_TOO_COMMON"
  | "PASSWORD_MATCHES_EMAIL";

export type PasswordPolicyViolation = {
  code: PasswordPolicyCode;
  message: string;
};

const MESSAGES: Record<PasswordPolicyCode, string> = {
  PASSWORD_TOO_SHORT: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  PASSWORD_TOO_LONG: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
  PASSWORD_TOO_COMMON:
    "This password is too common and easy to guess. Choose another one.",
  PASSWORD_MATCHES_EMAIL: "Your password can't be your email address.",
};

function violation(code: PasswordPolicyCode): PasswordPolicyViolation {
  return { code, message: MESSAGES[code] };
}

/** One character repeated, or a run of consecutive characters (abcdef…, 98765…). */
function isTrivialPattern(value: string): boolean {
  if (new Set(value).size <= 2) return true;
  let ascending = true;
  let descending = true;
  for (let index = 1; index < value.length; index += 1) {
    const step = value.charCodeAt(index) - value.charCodeAt(index - 1);
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
  }
  return ascending || descending;
}

/** A dictionary word dressed up with digits or symbols ("Password2024!"). */
function isDecoratedCommonWord(lower: string): boolean {
  const core = lower.replace(/^[\d\W_]+|[\d\W_]+$/g, "");
  if (core.length === 0) return true;
  return COMMON_PASSWORD_BASES.has(core);
}

/**
 * The first rule a new password breaks, or null when it is acceptable.
 * `email` is the account's address when known.
 */
export function checkNewPassword(
  password: string,
  context: { email?: string | null } = {},
): PasswordPolicyViolation | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return violation("PASSWORD_TOO_SHORT");
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return violation("PASSWORD_TOO_LONG");
  }

  const lower = password.toLowerCase();
  const email = context.email?.trim().toLowerCase();
  if (email) {
    const localPart = email.split("@")[0] ?? "";
    if (lower === email || (localPart.length > 0 && lower === localPart)) {
      return violation("PASSWORD_MATCHES_EMAIL");
    }
  }

  if (
    COMMON_PASSWORDS.has(lower) ||
    isTrivialPattern(lower) ||
    isDecoratedCommonWord(lower)
  ) {
    return violation("PASSWORD_TOO_COMMON");
  }
  return null;
}
