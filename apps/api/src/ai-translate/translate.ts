import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  type AiContextItem,
  type AiScope,
  assertProjectInScope,
  loadPageContext,
  loadTaskContext,
  projectDataTier,
  resolveAiScope,
} from "../ai/context";
import { AiError } from "../ai/errors";
import { aiCompleteJson } from "../ai/gateway";
import { buildSystemPrompt, languageName, wrapUntrusted } from "../ai/prompt";
import db from "../database";
import {
  activityTable,
  aiTranslationTable,
  pageTable,
  projectTable,
  taskTable,
} from "../database/schema";
import { translationMaxTokens } from "./budget";
import { baseLanguage, userLocale } from "./locale";
import type { TranslateKind } from "./schema";

// Translate-on-read (B8): a comment, a task description or a page in the
// reader's language, on request. The web only offers it when its cheap
// language check says the text is in another language; the model also
// reports the source language, so a same-language text costs one call once
// and is then cached. Translations are cached per source and language and
// keyed by a hash of the source, so an edit never shows a stale one.

export const TRANSLATE_INSTRUCTIONS = `You translate workspace content for a reader.
Translate the text inside the <untrusted> block into the target language named in the request.
- Keep the Markdown structure, links, URLs, @mentions, task keys such as WEB-12, code blocks and inline code exactly as they are.
- Keep product names and proper names. Do not add notes, quotes, greetings or explanations.
- If the text is already in the target language, return it unchanged.
- Report the language of the original as an ISO 639-1 code, or "und" when you can't tell.`;

const TRANSLATE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sourceLanguage", "translation"],
  properties: {
    sourceLanguage: { type: "string" },
    translation: { type: "string" },
  },
} as const;

/** Longer sources are cut (the cut is marked) to bound cost and latency. */
const MAX_SOURCE_CHARS = 30_000;

type Source = {
  text: string;
  item: AiContextItem;
  column: "commentId" | "taskId" | "pageId";
};

export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function commentSource(scope: AiScope, id: string): Promise<Source> {
  if (!scope.can.readTasks) {
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }
  const [row] = await db
    .select({
      content: activityTable.content,
      type: activityTable.type,
      taskId: taskTable.id,
      taskDeletedAt: taskTable.deletedAt,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
    })
    .from(activityTable)
    .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(eq(activityTable.id, id))
    .limit(1);
  if (
    row?.type !== "comment" ||
    row.taskDeletedAt ||
    row.workspaceId !== scope.workspaceId
  ) {
    throw new HTTPException(404, { message: "Comment not found" });
  }
  if (!scope.projectIds.has(row.projectId)) {
    if (scope.excludedProjectIds.has(row.projectId)) {
      assertProjectInScope(scope, row.projectId);
    }
    throw new HTTPException(404, { message: "Comment not found" });
  }
  const text = row.content ?? "";
  return {
    text,
    column: "commentId",
    item: {
      kind: "comment",
      id,
      projectId: row.projectId,
      title: "comment",
      url: `/dashboard/workspace/${scope.workspaceId}/project/${row.projectId}/task/${row.taskId}`,
      source: "comment",
      author: null,
      text,
      dataTier: projectDataTier(scope, row.projectId),
    },
  };
}

async function taskSource(scope: AiScope, id: string): Promise<Source> {
  // Access checks (404 for hidden, AI_DISABLED for excluded projects).
  const [item] = await loadTaskContext(scope, id, { comments: 0 });
  const [task] = await db
    .select({ description: taskTable.description })
    .from(taskTable)
    .where(eq(taskTable.id, id))
    .limit(1);
  const text = task?.description ?? "";
  return {
    text,
    column: "taskId",
    item: { ...(item as AiContextItem), text },
  };
}

async function pageSource(scope: AiScope, id: string): Promise<Source> {
  const item = await loadPageContext(scope, id, { maxChars: 1 });
  const [page] = await db
    .select({ markdown: pageTable.contentMarkdown })
    .from(pageTable)
    .where(eq(pageTable.id, id))
    .limit(1);
  const text = page?.markdown ?? "";
  return { text, column: "pageId", item: { ...item, text } };
}

function loadSource(scope: AiScope, kind: TranslateKind, id: string) {
  if (kind === "comment") return commentSource(scope, id);
  if (kind === "task") return taskSource(scope, id);
  return pageSource(scope, id);
}

function normalizeLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = baseLanguage(value.trim());
  return /^[a-z]{2,3}$/.test(code) && code !== "und" ? code : null;
}

/** Same language: the source's base language equals the reader's. */
export function isSameLanguage(
  sourceLanguage: string | null,
  targetLocale: string,
): boolean {
  return (
    sourceLanguage !== null && sourceLanguage === baseLanguage(targetLocale)
  );
}

function answer(input: {
  kind: TranslateKind;
  id: string;
  targetLocale: string;
  sourceLanguage: string | null;
  text: string;
  cached: boolean;
}) {
  const same = isSameLanguage(input.sourceLanguage, input.targetLocale);
  return {
    kind: input.kind,
    id: input.id,
    targetLocale: input.targetLocale,
    status: same ? ("same_language" as const) : ("translated" as const),
    sourceLanguage: input.sourceLanguage,
    text: same ? null : input.text,
    cached: input.cached,
  };
}

/** POST /ai/translate */
export async function translateContent(
  c: Context,
  input: { kind: TranslateKind; id: string; targetLocale?: string },
) {
  const workspaceId = c.get("workspaceId") as string;
  const userId = c.get("userId") as string;
  const scope = await resolveAiScope(c);
  const source = await loadSource(scope, input.kind, input.id);
  if (!source.text.trim()) {
    throw new HTTPException(400, { message: "There is nothing to translate" });
  }
  const targetLocale = input.targetLocale ?? (await userLocale(userId));
  const hash = contentHash(source.text);
  const column = aiTranslationTable[source.column];

  const [cached] = await db
    .select({
      contentHash: aiTranslationTable.contentHash,
      sourceLanguage: aiTranslationTable.sourceLanguage,
      text: aiTranslationTable.text,
    })
    .from(aiTranslationTable)
    .where(
      and(
        eq(column, input.id),
        eq(aiTranslationTable.targetLocale, targetLocale),
      ),
    )
    .limit(1);
  if (cached && cached.contentHash === hash) {
    return answer({ ...input, targetLocale, ...cached, cached: true });
  }

  const language = languageName(targetLocale);
  const { value } = await aiCompleteJson<{
    sourceLanguage?: unknown;
    translation?: unknown;
  }>({
    workspaceId,
    userId,
    feature: "translate",
    tier: "fast",
    context: [source.item],
    system: buildSystemPrompt({
      instructions: TRANSLATE_INSTRUCTIONS,
      locale: targetLocale,
    }),
    messages: [
      {
        role: "user",
        content: `Target language: ${language} (${targetLocale}).\n\n${wrapUntrusted(
          {
            source: source.item.source,
            text: source.text,
            maxChars: MAX_SOURCE_CHARS,
          },
        )}`,
      },
    ],
    jsonSchema: TRANSLATE_JSON_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: translationMaxTokens(
      Math.min(source.text.length, MAX_SOURCE_CHARS),
      targetLocale,
    ),
    effort: "low",
  });
  const translation =
    typeof value?.translation === "string" ? value.translation.trim() : "";
  const sourceLanguage = normalizeLanguage(value?.sourceLanguage);
  if (!translation) {
    throw new AiError(
      "AI_PROVIDER_ERROR",
      "The AI model returned no translation",
    );
  }

  const row = {
    workspaceId,
    targetLocale,
    contentHash: hash,
    sourceLanguage,
    text: translation,
    createdAt: new Date(),
  };
  await db
    .insert(aiTranslationTable)
    .values({ ...row, [source.column]: input.id })
    .onConflictDoUpdate({
      target: [column, aiTranslationTable.targetLocale],
      set: row,
    });
  return answer({
    ...input,
    targetLocale,
    sourceLanguage,
    text: translation,
    cached: false,
  });
}

/** Drops cached translations of an edited source (the hash also guards). */
export async function forgetTranslations(
  column: "commentId" | "taskId" | "pageId",
  id: string,
): Promise<void> {
  await db.delete(aiTranslationTable).where(eq(aiTranslationTable[column], id));
}
