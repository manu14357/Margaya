import { AiError } from "../ai/errors";
import { oneLine } from "./prompt";
import type {
  WhiteboardAiGroups,
  WhiteboardAiIdeas,
  WhiteboardAiSummary,
} from "./response";
import { WHITEBOARD_AI_LIMITS as L } from "./schema";

// Model answers are checked before anyone sees them: wrong shapes, unknown
// refs, duplicates and oversized text are dropped or cut, never trusted.

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function resolveIdeas(value: unknown, count: number): WhiteboardAiIdeas {
  const answer = (value ?? {}) as { title?: unknown; ideas?: unknown };
  const seen = new Set<string>();
  const ideas: string[] = [];
  for (const raw of Array.isArray(answer.ideas) ? answer.ideas : []) {
    const idea = oneLine(text(raw), L.ideaLength).replace(/^[-*•\d.)\s]+/, "");
    const key = idea.toLocaleLowerCase();
    if (!idea || seen.has(key)) continue;
    seen.add(key);
    ideas.push(idea);
    if (ideas.length >= count) break;
  }
  if (ideas.length === 0) {
    throw new AiError("AI_PROVIDER_ERROR", "The AI model returned no ideas");
  }
  return { title: oneLine(text(answer.title), L.titleLength), ideas };
}

/**
 * Every note lands in exactly one group: a ref the model repeats keeps its
 * first group, unknown refs are dropped, and notes it left out are gathered
 * in a last group without a title.
 */
export function resolveGroups(
  value: unknown,
  refs: ReadonlyMap<string, string>,
): WhiteboardAiGroups {
  const answer = (value ?? {}) as { groups?: unknown };
  const used = new Set<string>();
  const groups: WhiteboardAiGroups["groups"] = [];
  for (const raw of Array.isArray(answer.groups) ? answer.groups : []) {
    if (groups.length >= L.groupsMax) break;
    const group = (raw ?? {}) as { title?: unknown; refs?: unknown };
    const elementIds: string[] = [];
    for (const ref of Array.isArray(group.refs) ? group.refs : []) {
      const id = refs.get(text(ref).trim());
      if (!id || used.has(id)) continue;
      used.add(id);
      elementIds.push(id);
    }
    if (elementIds.length === 0) continue;
    const title = oneLine(text(group.title), L.groupTitleLength);
    groups.push({ title: title || null, elementIds });
  }
  const rest = [...refs.values()].filter((id) => !used.has(id));
  if (groups.length === 0) {
    throw new AiError("AI_PROVIDER_ERROR", "The AI model returned no themes");
  }
  if (rest.length > 0) groups.push({ title: null, elementIds: rest });
  return { groups };
}

export function resolveSummary(
  value: unknown,
  elementCount: number,
): WhiteboardAiSummary {
  const answer = (value ?? {}) as { title?: unknown; summary?: unknown };
  const summary = text(answer.summary)
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, L.summaryLength)
    .trim();
  if (!summary) {
    throw new AiError("AI_PROVIDER_ERROR", "The AI model returned no summary");
  }
  return {
    title: oneLine(text(answer.title), L.titleLength),
    summary,
    elementCount,
  };
}
