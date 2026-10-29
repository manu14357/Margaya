import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  type AiContextItem,
  filterToScope,
  loadPageContext,
  loadTaskContext,
  renderContext,
  resolveAiScope,
} from "../ai/context";
import { aiComplete } from "../ai/gateway";
import { buildSystemPrompt } from "../ai/prompt";
import { userLocale } from "../ai-translate/locale";
import db from "../database";
import {
  pageReferenceTable,
  pageTable,
  projectTable,
  taskRelationTable,
  taskTable,
} from "../database/schema";
import { generateBranchName } from "../plugins/github/utils/branch-matcher";
import { hiddenProjectIds } from "../project/visibility";
import { relationPerspective } from "../task-relation/types";
import { workspacePermissionChecker } from "../utils/require-workspace-permission";
import { HANDOFF_MARKER } from "./marker";

// The brief a coding agent receives. It is built from what the sender may
// see, and never from restricted projects other than the task's own: issue
// bodies leave Margaya. Comments are left out (other people wrote them).

const MAX_RELATED = 15;
const MAX_PAGES = 5;
const PAGE_EXCERPT = 1500;
const DESCRIPTION_MAX = 12_000;
export const BRIEF_MAX = 30_000;

export type HandoffTask = {
  id: string;
  number: number | null;
  title: string;
  description: string | null;
  status: string;
  projectId: string;
  projectSlug: string;
  workspaceId: string;
};

export function taskKeyOf(task: Pick<HandoffTask, "projectSlug" | "number">) {
  return `${task.projectSlug.toUpperCase()}-${task.number ?? 0}`;
}

export async function loadHandoffTask(taskId: string): Promise<HandoffTask> {
  const [task] = await db
    .select({
      id: taskTable.id,
      number: taskTable.number,
      title: taskTable.title,
      description: taskTable.description,
      status: taskTable.status,
      projectId: taskTable.projectId,
      projectSlug: projectTable.slug,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(
        eq(taskTable.id, taskId),
        isNull(taskTable.deletedAt),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  return task;
}

// Credential-looking values: provider tokens, bearer tokens, JWTs, private
// keys and "password = …" style assignments.
const TOKEN_PATTERN =
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|sk_live_[A-Za-z0-9]{8,}|rk_live_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|whsec_[A-Za-z0-9]{10,}|margaya_[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;
const ASSIGNMENT_PATTERN =
  /\b((?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\s*[:=]\s*)["']?[^\s"'`]{6,}["']?/gi;

export const SECRET_PLACEHOLDER = "[secret removed]";

/** Removes credential-looking values and the given known secrets. */
export function stripSecrets(text: string, known: string[] = []): string {
  let out = text;
  for (const secret of known) {
    if (secret && secret.length >= 6)
      out = out.split(secret).join(SECRET_PLACEHOLDER);
  }
  return out
    .replace(PRIVATE_KEY_PATTERN, SECRET_PLACEHOLDER)
    .replace(TOKEN_PATTERN, SECRET_PLACEHOLDER)
    .replace(ASSIGNMENT_PATTERN, `$1${SECRET_PLACEHOLDER}`);
}

/**
 * Acceptance criteria written in the description: a section headed
 * "Acceptance criteria" (any heading level or a bold/plain line), or else
 * its checklist items. Returns the items and the description without that
 * section.
 */
export function extractAcceptanceCriteria(description: string): {
  criteria: string[];
  rest: string;
} {
  const lines = description.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    /^\s*(?:#{1,6}\s*|\*\*)?\s*acceptance criteria\s*:?\s*(?:\*\*)?\s*:?\s*$/i.test(
      line,
    ),
  );
  const itemOf = (line: string) =>
    line.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "").trim();
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && !/^\s*#{1,6}\s/.test(lines[end] ?? "")) {
      end += 1;
    }
    const criteria = lines
      .slice(start + 1, end)
      .filter((line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line))
      .map(itemOf)
      .filter(Boolean);
    if (criteria.length > 0) {
      const rest = [...lines.slice(0, start), ...lines.slice(end)]
        .join("\n")
        .trim();
      return { criteria, rest };
    }
  }
  const criteria = lines
    .filter((line) => /^\s*[-*+]\s+\[[ xX]\]\s+/.test(line))
    .map(itemOf)
    .filter(Boolean);
  return { criteria, rest: description.trim() };
}

type RelatedTask = {
  id: string;
  key: string;
  title: string;
  status: string;
  relation: string;
  projectId: string;
};

type LinkedPage = {
  id: string;
  title: string;
  excerpt: string;
  projectId: string | null;
};

/**
 * Related tasks and linked pages the sender may see, without restricted
 * projects other than the task's own.
 */
async function loadNeighbours(
  c: Context,
  task: HandoffTask,
): Promise<{ related: RelatedTask[]; pages: LinkedPage[] }> {
  const userId = c.get("userId") as string;
  const can = await workspacePermissionChecker(c);
  const hidden = new Set(await hiddenProjectIds(userId, task.workspaceId));
  const projects = await db
    .select({
      id: projectTable.id,
      visibility: projectTable.visibility,
      pagesEnabled: projectTable.pagesEnabled,
      deletedAt: projectTable.deletedAt,
    })
    .from(projectTable)
    .where(eq(projectTable.workspaceId, task.workspaceId));
  const allowed = new Set(
    projects
      .filter(
        (project) =>
          !project.deletedAt &&
          !hidden.has(project.id) &&
          (project.id === task.projectId ||
            project.visibility !== "restricted"),
      )
      .map((project) => project.id),
  );
  const pagesOff = new Set(
    projects.filter((project) => !project.pagesEnabled).map((p) => p.id),
  );

  const relations = await db
    .select()
    .from(taskRelationTable)
    .where(
      or(
        eq(taskRelationTable.sourceTaskId, task.id),
        eq(taskRelationTable.targetTaskId, task.id),
      ),
    )
    .limit(MAX_RELATED * 3);
  const otherIds = [
    ...new Set(
      relations.map((relation) =>
        relation.sourceTaskId === task.id
          ? relation.targetTaskId
          : relation.sourceTaskId,
      ),
    ),
  ];
  const others = otherIds.length
    ? await db
        .select({
          id: taskTable.id,
          number: taskTable.number,
          title: taskTable.title,
          status: taskTable.status,
          projectId: taskTable.projectId,
          slug: projectTable.slug,
        })
        .from(taskTable)
        .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
        .where(
          and(inArray(taskTable.id, otherIds), isNull(taskTable.deletedAt)),
        )
    : [];
  const byId = new Map(others.map((other) => [other.id, other]));
  const related: RelatedTask[] = [];
  for (const relation of relations) {
    const viewerIsSource = relation.sourceTaskId === task.id;
    const other = byId.get(
      viewerIsSource ? relation.targetTaskId : relation.sourceTaskId,
    );
    if (!other || !allowed.has(other.projectId)) continue;
    let name = relationPerspective(relation.relationType, viewerIsSource);
    if (relation.relationType === "subtask") {
      name = viewerIsSource ? "sub-task" : "parent";
    }
    related.push({
      id: other.id,
      key: `${other.slug.toUpperCase()}-${other.number ?? 0}`,
      title: other.title,
      status: other.status,
      relation: name.replaceAll("_", " "),
      projectId: other.projectId,
    });
    if (related.length >= MAX_RELATED) break;
  }

  const pages: LinkedPage[] = [];
  if (can({ page: ["read"] })) {
    const rows = await db
      .select({
        id: pageTable.id,
        title: pageTable.title,
        markdown: pageTable.contentMarkdown,
        text: pageTable.contentText,
        projectId: pageTable.projectId,
        archivedAt: pageTable.archivedAt,
      })
      .from(pageReferenceTable)
      .innerJoin(pageTable, eq(pageTable.id, pageReferenceTable.pageId))
      .where(
        and(
          eq(pageReferenceTable.entityType, "task"),
          eq(pageReferenceTable.entityId, task.id),
          eq(pageTable.workspaceId, task.workspaceId),
          or(eq(pageTable.access, "public"), eq(pageTable.ownerId, userId)),
        ),
      )
      .limit(MAX_PAGES * 2);
    for (const row of rows) {
      if (row.archivedAt) continue;
      if (
        row.projectId &&
        (!allowed.has(row.projectId) || pagesOff.has(row.projectId))
      )
        continue;
      const body = (row.markdown || row.text).trim();
      pages.push({
        id: row.id,
        title: row.title || "Untitled",
        excerpt:
          body.length > PAGE_EXCERPT
            ? `${body.slice(0, PAGE_EXCERPT).trimEnd()} …`
            : body,
        projectId: row.projectId,
      });
      if (pages.length >= MAX_PAGES) break;
    }
  }
  return { related, pages };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()} …` : text;
}

/** The deterministic brief: task, acceptance criteria, related work, pages. */
export function renderBrief(input: {
  task: HandoffTask;
  related: RelatedTask[];
  pages: LinkedPage[];
}): string {
  const { task, related, pages } = input;
  const { criteria, rest } = extractAcceptanceCriteria(task.description ?? "");
  const parts = [
    "## Task",
    `**${taskKeyOf(task)}** · ${task.title}`,
    "",
    rest ? truncate(rest, DESCRIPTION_MAX) : "_No description._",
  ];
  if (criteria.length > 0) {
    parts.push("", "## Acceptance criteria");
    for (const item of criteria) parts.push(`- [ ] ${item}`);
  }
  if (related.length > 0) {
    parts.push("", "## Related tasks");
    for (const item of related) {
      parts.push(
        `- ${item.key} · ${item.title} (${item.relation}, ${item.status})`,
      );
    }
  }
  if (pages.length > 0) {
    parts.push("", "## Linked pages");
    for (const page of pages) {
      parts.push("", `### ${page.title}`, "", page.excerpt || "_Empty page._");
    }
  }
  return parts.join("\n").trim();
}

const BRIEF_INSTRUCTIONS = `You write the brief that a coding agent (an automated software engineer working in the code repository) receives in an issue.
Use only the task, related tasks and pages you are given. Write Markdown with these sections:
"## Goal": one or two sentences.
"## Context": the facts the agent needs, briefly.
"## Acceptance criteria": a checklist ("- [ ] ..."). Keep criteria the task states; when it states none, propose a few and end each proposed one with "(proposed)".
"## Related work": only when related tasks or pages matter.
Do not invent requirements, file names, APIs or numbers. Never include credentials, tokens, keys, passwords or personal contact details. Keep it under 450 words.`;

export type PreparedBrief = {
  title: string;
  body: string;
  aiUsed: boolean;
  related: number;
  pages: number;
};

/** The editable brief for a task, optionally condensed through the gateway. */
export async function prepareBrief(
  c: Context,
  task: HandoffTask,
  options: { useAi: boolean; locale?: string | null },
): Promise<PreparedBrief> {
  const { related, pages } = await loadNeighbours(c, task);
  const title = `${taskKeyOf(task)}: ${task.title}`.slice(0, 250);
  const plain = stripSecrets(renderBrief({ task, related, pages }));
  if (!options.useAi) {
    return {
      title,
      body: truncate(plain, BRIEF_MAX),
      aiUsed: false,
      related: related.length,
      pages: pages.length,
    };
  }

  // The AI scope re-checks everything: AI-off and (unless the workspace
  // allows it) restricted projects stay out of the prompt.
  const scope = await resolveAiScope(c);
  const items: AiContextItem[] = await loadTaskContext(scope, task.id, {
    comments: 0,
  });
  const relatedItems = filterToScope(
    scope,
    related.map((item) => ({
      kind: "task" as const,
      id: item.id,
      projectId: item.projectId,
      title: `${item.key} ${item.title}`,
      url: `/dashboard/workspace/${task.workspaceId}/project/${item.projectId}/task/${item.id}`,
      source: `task:${item.key}`,
      author: null,
      text: `Relation: ${item.relation}\nStatus: ${item.status}\nTitle: ${item.title}`,
      dataTier: scope.restrictedProjectIds.has(item.projectId)
        ? ("restricted" as const)
        : ("private" as const),
    })),
  );
  items.push(...relatedItems);
  for (const page of pages) {
    try {
      items.push(await loadPageContext(scope, page.id, { maxChars: 4000 }));
    } catch {
      // A page AI may not read stays out of the prompt.
    }
  }
  // Credentials never reach the model either.
  const cleaned = items.map((item) => ({
    ...item,
    text: stripSecrets(item.text),
  }));
  const userId = c.get("userId") as string;
  const result = await aiComplete({
    workspaceId: task.workspaceId,
    userId,
    feature: "coding_handoff",
    tier: "balanced",
    context: cleaned,
    system: buildSystemPrompt({
      instructions: BRIEF_INSTRUCTIONS,
      locale: options.locale ?? (await userLocale(userId)),
    }),
    messages: [
      {
        role: "user",
        content: `${renderContext(cleaned, { maxChars: 40_000 })}\n\nWrite the brief for ${taskKeyOf(task)}.`,
      },
    ],
    maxTokens: 1500,
    effort: "low",
  });
  const body = stripSecrets(result.text.trim()) || plain;
  return {
    title,
    body: truncate(body, BRIEF_MAX),
    aiUsed: true,
    related: related.length,
    pages: pages.length,
  };
}

/** The branch name the project's integration links pull requests from. */
export function suggestedBranch(
  config: { branchPattern?: string; customBranchRegex?: string },
  task: HandoffTask,
): string | null {
  if (config.customBranchRegex) return null;
  return generateBranchName(
    config.branchPattern || "{slug}-{number}",
    task.projectSlug,
    task.number ?? 0,
    task.title,
  );
}

/** The issue body: mention line, the (edited) brief, delivery notes. */
export function composeIssueBody(input: {
  mentionLine: string;
  brief: string;
  taskKey: string;
  taskUrl: string;
  branch: string | null;
  knownSecrets: string[];
}): string {
  const delivery = [
    "---",
    "**Delivery**",
    `- Margaya task: [${input.taskKey}](${input.taskUrl})`,
    input.branch
      ? `- Branch: \`${input.branch}\` (Margaya links pull requests from this branch).`
      : null,
    "- Reference this issue in the pull request description (for example with “Closes #” and this issue's number), so the pull request is linked to the task.",
    "- Do not merge; a person reviews and merges the pull request.",
  ].filter(Boolean);
  const body = [
    input.mentionLine,
    stripSecrets(input.brief.trim(), input.knownSecrets),
    delivery.join("\n"),
    HANDOFF_MARKER,
  ]
    .filter((part) => part?.trim())
    .join("\n\n");
  return body;
}
