import * as decoding from "lib0/decoding";
import {
  type CollabColorKey,
  isCollabColorKey,
} from "@/lib/pages/collab-colors";

// The page socket's Margaya additions to the standard Yjs protocol: the
// server-to-client control message (type 100) and the close codes (§5.7,
// §5.8).

export const CONTROL_MESSAGE_TYPE = 100;

export type OfflineRejectedReason = "locked" | "archived" | "readOnly";

export type ControlMessage =
  | {
      kind: "state";
      canWrite: boolean;
      isLocked: boolean;
      isArchived: boolean;
      access: "public" | "private";
      projectId: string | null;
      contentVersion: number;
    }
  | { kind: "saved"; at: string; contentVersion: number }
  | { kind: "save-error" }
  | { kind: "offline-rejected"; reason: OfflineRejectedReason }
  | { kind: "restored"; versionId: string; actorId: string }
  | { kind: "replaced"; actorId: string }
  | { kind: "too-large"; limitBytes: number };

const KINDS = new Set([
  "state",
  "saved",
  "save-error",
  "offline-rejected",
  "restored",
  "replaced",
  "too-large",
]);

/** Reads the JSON payload after the message type; null when unknown. */
export function readControlMessage(
  decoder: decoding.Decoder,
): ControlMessage | null {
  try {
    const value = JSON.parse(decoding.readVarString(decoder)) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const kind = (value as { kind?: unknown }).kind;
    if (typeof kind !== "string" || !KINDS.has(kind)) return null;
    return value as ControlMessage;
  } catch {
    return null;
  }
}

/**
 * What a close means for the UI. 4400–4499, 1003, 1008 and 1009 are
 * terminal; anything else is a network blip the provider retries.
 */
export type TerminalKind =
  | "signedOut"
  | "notVisible"
  | "gone"
  | "tooLarge"
  | "roomFull"
  | "protocol";

export function isTerminalClose(code: number): boolean {
  return (
    (code >= 4400 && code < 4500) ||
    code === 1003 ||
    code === 1008 ||
    code === 1009
  );
}

export function terminalKind(code: number): TerminalKind {
  switch (code) {
    case 4401:
      return "signedOut";
    case 4403:
      return "notVisible";
    case 4404:
      return "gone";
    case 4413:
    case 1009:
      return "tooLarge";
    case 4429:
      return "roomFull";
    default:
      return "protocol";
  }
}

export type PresenceEntry = { userId: string; color: CollabColorKey };

/**
 * Other people on the page, from awareness states: the local client left
 * out, one entry per user, and only known members.
 */
export function presenceFromStates(
  states: ReadonlyMap<number, Record<string, unknown>>,
  localClientId: number,
  isKnownUser: (userId: string) => boolean,
): PresenceEntry[] {
  const seen = new Set<string>();
  const presence: PresenceEntry[] = [];
  for (const [clientId, state] of states) {
    if (clientId === localClientId) continue;
    const user = state?.user as { id?: unknown; color?: unknown } | undefined;
    if (!user || typeof user.id !== "string" || seen.has(user.id)) continue;
    if (!isKnownUser(user.id)) continue;
    seen.add(user.id);
    presence.push({
      userId: user.id,
      color: isCollabColorKey(user.color) ? user.color : "blue",
    });
  }
  return presence;
}
