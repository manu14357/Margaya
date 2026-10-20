import { and, eq, inArray, notInArray } from "drizzle-orm";
import { columnTable, taskTable } from "../database/schema";
import {
  searchWorkspace,
  type WorkspaceSearchHit,
} from "../search/search-workspace";
import { formatTaskKey } from "../task-activity/task-snapshot";
import { boundedTaskRead } from "./bounded-read";
import { taskColumnJoin, taskGroupSql, visibleTaskCondition } from "./scope";

export const SIMILAR_TASKS_LIMIT = 5;
const MIN_WORD_LENGTH = 3;
const MAX_WORDS = 8;

// Words too common in task titles to say two tasks are alike.
const IGNORED_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "onto",
  "that",
  "this",
  "are",
  "was",
  "not",
  "but",
  "our",
  "has",
  "have",
  "when",
  "then",
  "than",
  "add",
  "new",
  "fix",
  "update",
]);

/** The distinct significant words of a title, lower case, at most eight. */
export function similarityWords(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (word) => word.length >= MIN_WORD_LENGTH && !IGNORED_WORDS.has(word),
    );
  return [...new Set(words)].slice(0, MAX_WORDS);
}

/** How many of the words a title must share: at least two, and half. */
export function minimumSharedWords(wordCount: number): number {
  return Math.max(2, Math.ceil(wordCount / 2));
}

type PermissionCheck = (permissions: Record<string, string[]>) => boolean;

/** How many of `words` a title holds as words (or word starts). */
export function sharedTitleWords(words: readonly string[], title: string) {
  const titleWords = title.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return words.filter((word) =>
    titleWords.some((titleWord) => titleWord.startsWith(word)),
  ).length;
}

/**
 * Open tasks of the project like a title being typed, for duplicate hints.
 * Ranked with the workspace full-text search (searchWorkspace), so the
 * caller's visibility applies: a task that matches every word in its title
 * or description, or one whose title shares most of the words. Never
 * blocks creating, and works without AI (the AI re-rank sits on top).
 */
export async function findSimilarTasks(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  text: string;
  can?: PermissionCheck;
  limit?: number;
}) {
  const words = similarityWords(input.text);
  if (words.length < 2) return { tasks: [] };
  const limit = input.limit ?? SIMILAR_TASKS_LIMIT;
  const search = (query: string, size: number) =>
    searchWorkspace({
      userId: input.userId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      types: ["task"],
      query,
      limit: size,
      can: input.can,
    });
  // Every word (title or description; the last one as a prefix while it is
  // typed), and any word (title overlap). The trailing period stops the
  // search from ANDing the last word in as a prefix.
  const [every, any] = await Promise.all([
    search(words.join(" "), 20),
    search(`${words.join(" or ")}.`, 40),
  ]);

  const needed = minimumSharedWords(words.length);
  const ranked = new Map<string, { hit: WorkspaceSearchHit; rank: number }>();
  for (const hit of every) {
    const shared = sharedTitleWords(words, hit.title);
    ranked.set(hit.id, { hit, rank: shared + 0.5 + hit.score / 100 });
  }
  for (const hit of any) {
    if (ranked.has(hit.id)) continue;
    const shared = sharedTitleWords(words, hit.title);
    if (shared < needed) continue;
    ranked.set(hit.id, { hit, rank: shared + hit.score / 100 });
  }
  if (ranked.size === 0) return { tasks: [] };

  // Hints are for open work: leave out done, cancelled and archived tasks.
  const open = await boundedTaskRead(async (tx) => {
    const rows = await tx
      .select({ id: taskTable.id })
      .from(taskTable)
      .leftJoin(columnTable, taskColumnJoin)
      .where(
        and(
          eq(taskTable.projectId, input.projectId),
          inArray(taskTable.id, [...ranked.keys()]),
          visibleTaskCondition,
          notInArray(taskGroupSql, ["completed", "cancelled"]),
        ),
      );
    return new Set(rows.map((row) => row.id));
  }, "Similar task search took too long; retry later");

  const tasks = [...ranked.values()]
    .filter(({ hit }) => open.has(hit.id))
    .sort(
      (a, b) =>
        b.rank - a.rank ||
        b.hit.createdAt.getTime() - a.hit.createdAt.getTime(),
    )
    .slice(0, limit)
    .map(({ hit }) => ({
      id: hit.id,
      number: hit.taskNumber ?? null,
      key: formatTaskKey(hit.projectSlug ?? "", hit.taskNumber ?? null),
      title: hit.title,
      status: hit.status ?? "",
    }));
  return { tasks };
}
