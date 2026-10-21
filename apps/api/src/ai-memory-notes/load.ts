import { and, asc, eq, inArray, or, type SQL } from "drizzle-orm";
import db from "../database";
import { aiMemoryNoteTable } from "../database/schema";

// Memory notes for prompts: what the AI should remember for the workspace,
// a project and one person ("our release day is Thursday"). Callers put
// the result in a facts-like block that is never cited.

/** Notes per prompt, oldest first within each scope. */
export const MAX_PROMPT_NOTES = 40;

/**
 * The notes that apply to a call: the workspace's, the project's (when
 * given) and the person's own (when given), in that order. A user note is
 * only ever returned for its owner.
 */
export async function memoryNotesFor(input: {
  workspaceId: string;
  projectId?: string | null;
  userId?: string | null;
}): Promise<string[]> {
  const scopes: SQL[] = [eq(aiMemoryNoteTable.scope, "workspace")];
  if (input.projectId) {
    scopes.push(
      and(
        eq(aiMemoryNoteTable.scope, "project"),
        eq(aiMemoryNoteTable.projectId, input.projectId),
      ) as SQL,
    );
  }
  if (input.userId) {
    scopes.push(
      and(
        eq(aiMemoryNoteTable.scope, "user"),
        eq(aiMemoryNoteTable.userId, input.userId),
      ) as SQL,
    );
  }
  const rows = await db
    .select({
      scope: aiMemoryNoteTable.scope,
      content: aiMemoryNoteTable.content,
    })
    .from(aiMemoryNoteTable)
    .where(
      and(
        eq(aiMemoryNoteTable.workspaceId, input.workspaceId),
        inArray(aiMemoryNoteTable.scope, ["workspace", "project", "user"]),
        or(...scopes),
      ),
    )
    .orderBy(asc(aiMemoryNoteTable.createdAt), asc(aiMemoryNoteTable.id))
    .limit(MAX_PROMPT_NOTES * 3);
  const rank = { workspace: 0, project: 1, user: 2 } as const;
  return rows
    .sort((a, b) => rank[a.scope] - rank[b.scope])
    .map((row) => row.content.trim())
    .filter(Boolean)
    .slice(0, MAX_PROMPT_NOTES);
}

/** The notes as one plain-text block for a prompt (empty: no notes). */
export function formatMemoryNotes(notes: readonly string[]): string {
  if (notes.length === 0) return "";
  return [
    "Things this workspace asked the AI to remember (background, not sources; never cite them):",
    ...notes.map((note) => `- ${note.replace(/[\r\n]+/g, " ")}`),
  ].join("\n");
}
