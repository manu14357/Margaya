import { openSecret, sealSecret } from "../utils/secret-box";

// Slack credentials are bearer secrets: the bot token (xoxb-), the app-level
// token for Socket Mode (xapp-) and the HTTP signing secret. They are sealed
// with the shared secret box (keyed from AUTH_SECRET per purpose), returned
// to clients only as a masked hint, and never logged.

export const SLACK_SECRET_PURPOSE = "slack-app-credential";

export function sealSlackSecret(value: string): string {
  return sealSecret(SLACK_SECRET_PURPOSE, value);
}

/** Opens a sealed credential; throws `SecretUnreadableError`. */
export function openSlackSecret(sealed: string): string {
  return openSecret(SLACK_SECRET_PURPOSE, sealed);
}

/** "xoxb-…a1b2": the prefix and the last four characters only. */
export function maskSlackSecret(value: string | null | undefined): string {
  if (!value) return "";
  const dash = value.indexOf("-");
  const prefix = dash > 0 && dash <= 5 ? value.slice(0, dash + 1) : "";
  if (value.length <= 8) return `${prefix}••••`;
  return `${prefix}…${value.slice(-4)}`;
}

/** The masked hint of a sealed value, or "" when it can't be opened. */
export function maskSealedSlackSecret(sealed: string | null): string {
  if (!sealed) return "";
  try {
    return maskSlackSecret(openSlackSecret(sealed));
  } catch {
    return "";
  }
}
