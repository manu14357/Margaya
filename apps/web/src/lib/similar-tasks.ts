/** Hints start once the title has this many words. */
export const SIMILAR_HINT_MIN_WORDS = 3;

/** The title as the similar-task search takes it, or null when too short. */
export function similarTasksQuery(title: string): string | null {
  const normalized = title.trim().replace(/\s+/g, " ");
  const words = normalized.split(" ").filter((word) => word.length > 0);
  return words.length >= SIMILAR_HINT_MIN_WORDS
    ? normalized.toLowerCase()
    : null;
}
