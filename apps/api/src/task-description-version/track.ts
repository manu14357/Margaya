import { desc, eq, inArray } from "drizzle-orm";
import db from "../database";
import { taskDescriptionVersionTable } from "../database/schema";
import {
  decideVersionAction,
  sameDescription,
  versionsBeyondLimit,
} from "./rules";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const newestFirst = [
  desc(taskDescriptionVersionTable.savedAt),
  desc(taskDescriptionVersionTable.id),
] as const;

async function pruneVersions(tx: Transaction, taskId: string) {
  const rows = await tx
    .select({ id: taskDescriptionVersionTable.id })
    .from(taskDescriptionVersionTable)
    .where(eq(taskDescriptionVersionTable.taskId, taskId))
    .orderBy(...newestFirst);
  const excess = versionsBeyondLimit(rows.map((row) => row.id));
  if (excess.length > 0) {
    await tx
      .delete(taskDescriptionVersionTable)
      .where(inArray(taskDescriptionVersionTable.id, excess));
  }
}

/**
 * Records a description write in the task's history. The first change of a
 * task without history also keeps the text it replaces (unattributed, at the
 * task's last update), so that text can be restored. Then the new text
 * updates the author's newest version (same author, under ten minutes, not
 * a restore) or becomes a new one, and only the newest 50 are kept. Two
 * racing saves may both insert; that is acceptable.
 */
export async function recordDescriptionVersion({
  taskId,
  previous,
  previousSavedAt,
  next,
  authorId,
  forceNew = false,
  now = new Date(),
}: {
  taskId: string;
  previous: string | null;
  /** When the previous text was last written (the task's updatedAt). */
  previousSavedAt: Date | null;
  next: string;
  authorId: string | null;
  forceNew?: boolean;
  now?: Date;
}) {
  if (sameDescription(previous, next)) return;

  await db.transaction(async (tx) => {
    const [newest] = await tx
      .select({
        id: taskDescriptionVersionTable.id,
        authorId: taskDescriptionVersionTable.authorId,
        savedAt: taskDescriptionVersionTable.savedAt,
      })
      .from(taskDescriptionVersionTable)
      .where(eq(taskDescriptionVersionTable.taskId, taskId))
      .orderBy(...newestFirst)
      .limit(1);

    if (!newest && previous) {
      const before =
        previousSavedAt && previousSavedAt.getTime() < now.getTime()
          ? previousSavedAt
          : new Date(now.getTime() - 1);
      await tx.insert(taskDescriptionVersionTable).values({
        taskId,
        authorId: null,
        content: previous,
        savedAt: before,
        createdAt: before,
      });
    }

    const decision = decideVersionAction({ newest, authorId, now, forceNew });
    if (decision.action === "update") {
      await tx
        .update(taskDescriptionVersionTable)
        .set({ content: next, savedAt: now })
        .where(eq(taskDescriptionVersionTable.id, decision.id));
      return;
    }

    await tx.insert(taskDescriptionVersionTable).values({
      taskId,
      authorId,
      content: next,
      savedAt: now,
      createdAt: now,
    });
    await pruneVersions(tx, taskId);
  });
}
