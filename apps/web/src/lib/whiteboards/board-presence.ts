import { collabColorHex, collabColorKey } from "@/lib/pages/collab-colors";

export type BoardPresence = {
  userId: string;
  name: string;
  image: string | null;
  /** The CSS colour their cursor and selection use on the canvas. */
  color: string;
};

// Colours a collaborator may announce: hex or rgb(a) only, so nothing from a
// socket can smuggle a url() or an expression into a style.
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i;

export function isSafeCssColor(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= 32 && SAFE_COLOR.test(value)
  );
}

/** A stable colour for a user on boards (the pages palette, as hex). */
export function boardColorFor(userId: string): string {
  return collabColorHex(collabColorKey(userId));
}

/**
 * Other people on the board, from awareness states: the local client left
 * out, one entry per user, workspace members only. Names and pictures come
 * from the member list, never from what a socket says.
 */
export function presenceFromBoardStates(
  states: ReadonlyMap<number, Record<string, unknown>>,
  localClientId: number,
  getMember: (userId: string) => { name: string; image: string | null } | null,
): BoardPresence[] {
  const seen = new Set<string>();
  const presence: BoardPresence[] = [];
  for (const [clientId, state] of states) {
    if (clientId === localClientId) continue;
    const user = state?.user as { id?: unknown; color?: unknown } | undefined;
    if (!user || typeof user.id !== "string" || seen.has(user.id)) continue;
    const member = getMember(user.id);
    if (!member) continue;
    seen.add(user.id);
    presence.push({
      userId: user.id,
      name: member.name,
      image: member.image,
      color: isSafeCssColor(user.color) ? user.color : boardColorFor(user.id),
    });
  }
  return presence;
}
