import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import type {
  AwarenessEntry,
  AwarenessGuardContext,
  AwarenessVerdict,
} from "../../page/collab/awareness-guard";
import { COLLAB_LIMITS } from "../../page/collab/limits";

// Validates awareness updates on a board socket. A state may carry `user`
// ({ id, name, color, image }), `cursor` (null or { x, y } in board units),
// `selectedIds`, `laser` (null or a trail of [x, y]), `following` (null or
// a user id) and `viewport` (null or { centerX, centerY, zoom }, which lets
// others follow this view). `user.id` must be the connection's own user, and the name and
// avatar are replaced with the account's, so nobody can pose as someone
// else in the presence list.

export const BOARD_AWARENESS_LIMITS = {
  /** One entry's JSON; selections of many elements make boards' larger. */
  entryBytes: 64 * 1024,
  selectedIds: 2000,
  idLength: 64,
  laserPoints: 500,
  colorLength: 32,
  coordinate: 1e9,
  maxZoom: 100,
} as const;

export type BoardIdentity = {
  userId: string;
  name: string;
  image: string | null;
};

const STATE_KEYS = new Set([
  "user",
  "cursor",
  "selectedIds",
  "laser",
  "following",
  "viewport",
]);
const USER_KEYS = new Set(["id", "name", "color", "image"]);
// A CSS colour of the simple kinds the editor uses: a palette key, a hex
// value or an rgb()/hsl() call. Nothing that could break out of a style.
const COLOR_PATTERN =
  /^(#[0-9a-fA-F]{3,8}|[a-z]+|(rgb|rgba|hsl|hsla)\([0-9.,%\s]+\))$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= BOARD_AWARENESS_LIMITS.coordinate
  );
}

function isShortId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= BOARD_AWARENESS_LIMITS.idLength
  );
}

/** Decodes an awareness update. Throws on malformed input or an oversized entry. */
export function decodeBoardAwareness(update: Uint8Array): AwarenessEntry[] {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  const entries: AwarenessEntry[] = [];
  for (let index = 0; index < count; index++) {
    const clientId = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    const json = decoding.readVarString(decoder);
    if (Buffer.byteLength(json, "utf8") > BOARD_AWARENESS_LIMITS.entryBytes) {
      throw new Error("Awareness entry too large");
    }
    entries.push({ clientId, clock, state: JSON.parse(json) });
  }
  return entries;
}

export function encodeBoardAwareness(entries: readonly AwarenessEntry[]) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, entries.length);
  for (const { clientId, clock, state } of entries) {
    encoding.writeVarUint(encoder, clientId);
    encoding.writeVarUint(encoder, clock);
    encoding.writeVarString(encoder, JSON.stringify(state));
  }
  return encoding.toUint8Array(encoder);
}

/** Why a non-null state is invalid for `userId`, or null when it is valid. */
export function invalidBoardAwarenessState(
  state: unknown,
  userId: string,
): string | null {
  if (!isPlainObject(state)) return "state must be an object";
  for (const key of Object.keys(state)) {
    if (!STATE_KEYS.has(key)) return `unknown key ${key}`;
  }
  const { user, cursor, selectedIds, laser, following, viewport } = state;
  if (user === undefined) {
    // The provider's initial `{}` carries nothing to spoof.
    return Object.keys(state).length === 0 ? null : "user is required";
  }
  if (!isPlainObject(user)) return "user must be an object";
  for (const key of Object.keys(user)) {
    if (!USER_KEYS.has(key)) return `unknown user key ${key}`;
  }
  if (user.id !== userId) return "user.id must be the connection's user";
  if (
    typeof user.color !== "string" ||
    user.color.length > BOARD_AWARENESS_LIMITS.colorLength ||
    !COLOR_PATTERN.test(user.color)
  ) {
    return "user.color must be a simple colour";
  }
  if (cursor !== undefined && cursor !== null) {
    if (!isPlainObject(cursor)) return "cursor must be an object";
    const keys = Object.keys(cursor);
    if (
      keys.length !== 2 ||
      !isCoordinate(cursor.x) ||
      !isCoordinate(cursor.y)
    ) {
      return "cursor must hold x and y";
    }
  }
  if (selectedIds !== undefined) {
    if (
      !Array.isArray(selectedIds) ||
      selectedIds.length > BOARD_AWARENESS_LIMITS.selectedIds ||
      !selectedIds.every(isShortId)
    ) {
      return "selectedIds must be element ids";
    }
  }
  if (laser !== undefined && laser !== null) {
    if (
      !Array.isArray(laser) ||
      laser.length > BOARD_AWARENESS_LIMITS.laserPoints ||
      !laser.every(
        (point) =>
          Array.isArray(point) &&
          point.length === 2 &&
          isCoordinate(point[0]) &&
          isCoordinate(point[1]),
      )
    ) {
      return "laser must be a list of points";
    }
  }
  if (following !== undefined && following !== null && !isShortId(following)) {
    return "following must be a user id";
  }
  if (viewport !== undefined && viewport !== null) {
    if (!isPlainObject(viewport)) return "viewport must be an object";
    const keys = Object.keys(viewport);
    if (
      keys.length !== 3 ||
      !isCoordinate(viewport.centerX) ||
      !isCoordinate(viewport.centerY) ||
      typeof viewport.zoom !== "number" ||
      !Number.isFinite(viewport.zoom) ||
      viewport.zoom <= 0 ||
      viewport.zoom > BOARD_AWARENESS_LIMITS.maxZoom
    ) {
      return "viewport must hold centerX, centerY and zoom";
    }
  }
  return null;
}

/**
 * Decides what to do with a board awareness update; the same verdicts and
 * client-id rules as the page socket (entries the room would ignore are
 * skipped, other users' client ids are refused).
 */
export function checkBoardAwareness(
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
    const invalid = invalidBoardAwarenessState(state, context.userId);
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

/** The update with each state's name and avatar taken from the account. */
export function withAccountIdentity(
  entries: readonly AwarenessEntry[],
  identity: BoardIdentity,
): AwarenessEntry[] {
  return entries.map((entry) => {
    const state = entry.state;
    // Echoes of other people's states are left alone: their clocks are
    // stale, so the room ignores them anyway.
    if (
      !isPlainObject(state) ||
      !isPlainObject(state.user) ||
      state.user.id !== identity.userId
    ) {
      return entry;
    }
    return {
      ...entry,
      state: {
        ...state,
        user: {
          ...state.user,
          name: identity.name,
          image: identity.image,
        },
      },
    };
  });
}
