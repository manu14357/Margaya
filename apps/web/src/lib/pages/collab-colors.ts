// Collaborator colors. Only palette keys travel over the page socket (the
// server accepts nothing else); the CSS color comes from Tailwind's palette
// variables, with the same values as a fallback. Caret rendering maps keys
// to those fallback hex values, see `withCaretColors`.

export const COLLAB_COLOR_KEYS = [
  "blue",
  "emerald",
  "amber",
  "purple",
  "rose",
  "orange",
  "teal",
  "cyan",
] as const;

export type CollabColorKey = (typeof COLLAB_COLOR_KEYS)[number];

const FALLBACKS: Record<CollabColorKey, string> = {
  blue: "#3b82f6",
  emerald: "#10b981",
  amber: "#f59e0b",
  purple: "#a855f7",
  rose: "#f43f5e",
  orange: "#f97316",
  teal: "#14b8a6",
  cyan: "#06b6d4",
};

export function isCollabColorKey(value: unknown): value is CollabColorKey {
  return (
    typeof value === "string" &&
    (COLLAB_COLOR_KEYS as readonly string[]).includes(value)
  );
}

/** A stable color for a user id (FNV-1a hash over the palette). */
export function collabColorKey(userId: string): CollabColorKey {
  let hash = 0x811c9dc5;
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= userId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return COLLAB_COLOR_KEYS[(hash >>> 0) % COLLAB_COLOR_KEYS.length];
}

export function collabColorValue(key: CollabColorKey): string {
  return `var(--color-${key}-500, ${FALLBACKS[key]})`;
}

type AwarenessState = Record<string, unknown> | null;

export type CaretAwareness = {
  getStates(): Map<number, AwarenessState>;
};

/**
 * Awareness states as the caret renderer reads them: each user's palette key
 * becomes a 6-digit hex `color` (the only format y-tiptap accepts without a
 * console warning) and travels on as `colorKey`. Copies; the live states
 * keep the key the page socket requires.
 */
export function caretAwarenessStates(
  states: Map<number, AwarenessState>,
): Map<number, AwarenessState> {
  const result = new Map<number, AwarenessState>();
  for (const [clientId, state] of states) {
    const user = state?.user;
    if (!state || !user || typeof user !== "object") {
      result.set(clientId, state);
      continue;
    }
    const fields = user as Record<string, unknown>;
    const colorKey = isCollabColorKey(fields.color)
      ? fields.color
      : collabColorKey(String(fields.id ?? ""));
    result.set(clientId, {
      ...state,
      user: { ...fields, color: FALLBACKS[colorKey], colorKey },
    });
  }
  return result;
}

/**
 * The awareness handed to the caret extension: reads of `getStates()` see
 * renderable colors; everything else (listeners, the local cursor and user
 * fields) goes to the live awareness unchanged.
 */
export function withCaretColors<T extends CaretAwareness>(awareness: T): T {
  return new Proxy(awareness, {
    get(target, property) {
      if (property === "getStates") {
        return () => caretAwarenessStates(target.getStates());
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** The CSS color of a caret or selection, from a caret-rendered user. */
export function caretColorValue(user: Record<string, unknown>): string {
  const key = isCollabColorKey(user.colorKey)
    ? user.colorKey
    : collabColorKey(String(user.id ?? ""));
  return collabColorValue(key);
}
