import * as decoding from "lib0/decoding";
import { COLLAB_COLORS, COLLAB_LIMITS } from "./limits";

// Validates awareness updates from a connection (spec §5.4). A state may
// carry only `user` ({ id, color }: the connection's own user id and a
// palette key) and `cursor` (null or { anchor, head }). Names, avatars and
// styles are never taken from awareness: the web resolves them by user id.

export type AwarenessEntry = {
  clientId: number;
  clock: number;
  state: unknown;
};

export type AwarenessGuardContext = {
  /** The connection's user id. */
  userId: string;
  /** Client ids this connection already controls. */
  controlled: ReadonlySet<number>;
  /**
   * The room's known clock for a client id and whether it holds a state;
   * undefined when the id is unknown.
   */
  known(clientId: number): { clock: number; hasState: boolean } | undefined;
  /** The user id of another local connection controlling the client id. */
  controlledByOther(clientId: number): string | undefined;
};

export type AwarenessVerdict =
  /** Apply the update; `claimed` lists client ids that become controlled. */
  | { kind: "apply"; claimed: number[] }
  /** Nothing in it would change the room's awareness. */
  | { kind: "ignore" }
  /** An invalid entry: drop the whole message. */
  | { kind: "drop"; reason: string }
  /** The connection would control too many client ids: close it. */
  | { kind: "too-many-clients" };

const COLORS = new Set<string>(COLLAB_COLORS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Decodes an awareness update. Throws on malformed input or an oversized entry. */
export function decodeAwarenessUpdate(update: Uint8Array): AwarenessEntry[] {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  const entries: AwarenessEntry[] = [];
  for (let index = 0; index < count; index++) {
    const clientId = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    const json = decoding.readVarString(decoder);
    if (Buffer.byteLength(json, "utf8") > COLLAB_LIMITS.awarenessEntryBytes) {
      throw new Error("Awareness entry too large");
    }
    entries.push({ clientId, clock, state: JSON.parse(json) });
  }
  return entries;
}

/** Why a non-null state is invalid for `userId`, or null when it is valid. */
export function invalidAwarenessState(
  state: unknown,
  userId: string,
): string | null {
  if (!isPlainObject(state)) return "state must be an object";
  for (const key of Object.keys(state)) {
    if (key !== "user" && key !== "cursor") return `unknown key ${key}`;
  }
  const { user, cursor } = state;
  if (user === undefined) {
    // An empty state (the provider's initial `{}`) carries nothing to spoof.
    return Object.keys(state).length === 0 ? null : "user is required";
  }
  if (!isPlainObject(user)) return "user must be an object";
  for (const key of Object.keys(user)) {
    if (key !== "id" && key !== "color") return `unknown user key ${key}`;
  }
  if (user.id !== userId) return "user.id must be the connection's user";
  if (typeof user.color !== "string" || !COLORS.has(user.color)) {
    return "user.color must be a palette key";
  }
  if (cursor !== undefined && cursor !== null) {
    if (!isPlainObject(cursor)) return "cursor must be an object";
    const keys = Object.keys(cursor);
    if (
      keys.length !== 2 ||
      !Object.hasOwn(cursor, "anchor") ||
      !Object.hasOwn(cursor, "head")
    ) {
      return "cursor must hold anchor and head";
    }
  }
  return null;
}

/**
 * Decides what to do with an awareness update. Entries the room would
 * ignore (an older or equal clock) are skipped: the stock provider echoes
 * every state it receives, other users' included.
 */
export function checkAwarenessUpdate(
  entries: readonly AwarenessEntry[],
  context: AwarenessGuardContext,
): AwarenessVerdict {
  const claimed: number[] = [];
  let fresh = 0;
  for (const { clientId, clock, state } of entries) {
    const known = context.known(clientId);
    const current = known?.clock ?? 0;
    const changes =
      clock > current ||
      (clock === current && state === null && Boolean(known?.hasState));
    if (!changes) continue;
    fresh++;

    if (state === null) {
      if (!context.controlled.has(clientId)) {
        return { kind: "drop", reason: "not a client of this connection" };
      }
      continue;
    }
    const invalid = invalidAwarenessState(state, context.userId);
    if (invalid) return { kind: "drop", reason: invalid };
    if (context.controlled.has(clientId)) continue;
    const other = context.controlledByOther(clientId);
    if (other !== undefined && other !== context.userId) {
      return { kind: "drop", reason: "client id belongs to another user" };
    }
    if (!claimed.includes(clientId)) claimed.push(clientId);
  }
  if (
    context.controlled.size + claimed.length >
    COLLAB_LIMITS.clientIdsPerConnection
  ) {
    return { kind: "too-many-clients" };
  }
  if (fresh === 0) return { kind: "ignore" };
  return { kind: "apply", claimed };
}
