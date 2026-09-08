import { parseMentionIds } from "../utils/parse-mentions";

// Old content, not the mention index, defines "newly mentioned": that keeps
// notifications right for content written before the index existed and for
// people who were not members when they were first mentioned.

/** Users mentioned in `next` but not in `previous`, minus the actor. */
export function newlyMentionedIds(
  previous: string | null | undefined,
  next: string | null | undefined,
  actorId: string | null | undefined,
): string[] {
  const before = new Set(parseMentionIds(previous));
  return parseMentionIds(next).filter(
    (id) => id !== actorId && !before.has(id),
  );
}
