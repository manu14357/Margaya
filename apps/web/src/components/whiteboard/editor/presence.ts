import type { Awareness } from "y-protocols/awareness";
import type { CollaboratorIdentity } from "./types";

// What this editor publishes in the awareness state, and how it reads the
// other clients' states. Everything is in board coordinates. Remote states are
// untrusted: every field is checked before it is drawn.

export type PublishedViewport = {
  /** The board point at the centre of the collaborator's screen. */
  centerX: number;
  centerY: number;
  zoom: number;
};

export type LocalPresence = {
  user: CollaboratorIdentity | null;
  cursor: { x: number; y: number } | null;
  selectedIds: string[];
  laser: [number, number][] | null;
  following: string | null;
  viewport: PublishedViewport | null;
};

export type RemotePresence = {
  clientId: number;
  user: CollaboratorIdentity;
  cursor: { x: number; y: number } | null;
  selectedIds: readonly string[];
  laser: readonly (readonly [number, number])[] | null;
  viewport: PublishedViewport | null;
};

const MAX_REMOTE_SELECTION = 500;
const MAX_LASER_POINTS = 200;
const COLOR_PATTERN =
  /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function readUser(raw: unknown): CollaboratorIdentity | null {
  if (!raw || typeof raw !== "object") return null;
  const user = raw as Record<string, unknown>;
  if (typeof user.id !== "string" || typeof user.name !== "string") return null;
  const color =
    typeof user.color === "string" && COLOR_PATTERN.test(user.color)
      ? user.color
      : "#6b7280";
  return {
    id: user.id.slice(0, 64),
    name: user.name.slice(0, 80),
    color,
    image: typeof user.image === "string" ? user.image : null,
  };
}

function readPoint(raw: unknown): { x: number; y: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const point = raw as Record<string, unknown>;
  return finite(point.x) && finite(point.y) ? { x: point.x, y: point.y } : null;
}

function readLaser(raw: unknown): [number, number][] | null {
  if (!Array.isArray(raw)) return null;
  const points: [number, number][] = [];
  for (const entry of raw.slice(-MAX_LASER_POINTS)) {
    if (Array.isArray(entry) && finite(entry[0]) && finite(entry[1]))
      points.push([entry[0], entry[1]]);
  }
  return points.length > 0 ? points : null;
}

function readViewport(raw: unknown): PublishedViewport | null {
  if (!raw || typeof raw !== "object") return null;
  const viewport = raw as Record<string, unknown>;
  if (
    !finite(viewport.centerX) ||
    !finite(viewport.centerY) ||
    !finite(viewport.zoom)
  )
    return null;
  if (viewport.zoom <= 0) return null;
  return {
    centerX: viewport.centerX,
    centerY: viewport.centerY,
    zoom: viewport.zoom,
  };
}

/** One parsed entry per other client that announced a user. */
export function readRemotePresence(
  states: Map<number, Record<string, unknown>>,
  localClientId: number,
): RemotePresence[] {
  const result: RemotePresence[] = [];
  for (const [clientId, state] of states) {
    if (clientId === localClientId || !state) continue;
    const user = readUser(state.user);
    if (!user) continue;
    const selected = Array.isArray(state.selectedIds)
      ? state.selectedIds
          .filter((id): id is string => typeof id === "string")
          .slice(0, MAX_REMOTE_SELECTION)
      : [];
    result.push({
      clientId,
      user,
      cursor: readPoint(state.cursor),
      selectedIds: selected,
      laser: readLaser(state.laser),
      viewport: readViewport(state.viewport),
    });
  }
  return result;
}

/**
 * Coalesces local presence updates. Cursor moves arrive at pointer rate; the
 * network only needs a few per second, and the final position always goes out.
 */
export class PresencePublisher {
  private pending: Partial<LocalPresence> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last = 0;

  constructor(
    private readonly awareness: Awareness | null,
    private readonly intervalMs = 50,
  ) {}

  set(patch: Partial<LocalPresence>, immediate = false): void {
    if (!this.awareness) return;
    Object.assign(this.pending, patch);
    const now = Date.now();
    if (immediate || now - this.last >= this.intervalMs) {
      this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(
        () => this.flush(),
        this.intervalMs - (now - this.last),
      );
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.awareness) return;
    const patch = this.pending;
    this.pending = {};
    if (Object.keys(patch).length === 0) return;
    this.last = Date.now();
    const current = (this.awareness.getLocalState() ?? {}) as Record<
      string,
      unknown
    >;
    this.awareness.setLocalState({ ...current, ...patch });
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.awareness) return;
    const current = this.awareness.getLocalState();
    if (current) {
      this.awareness.setLocalState({
        ...current,
        cursor: null,
        selectedIds: [],
        laser: null,
        following: null,
        viewport: null,
      });
    }
  }
}
