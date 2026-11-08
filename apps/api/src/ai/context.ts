import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  activityTable,
  pageTable,
  projectTable,
  taskTable,
  userTable,
} from "../database/schema";
import { hiddenFromUserAndKey, PROJECT_NOT_FOUND } from "../project/visibility";
import { workspacePermissionChecker } from "../utils/require-workspace-permission";
import { AiError } from "./errors";
import { truncateText, wrapUntrusted } from "./prompt";
import { dataTierOf } from "./router";
import type { DataTier } from "./types";
import { loadWorkspaceAiPolicy } from "./workspace-settings";

// Context assembly: everything a model sees about the workspace comes
// through here, so it only ever holds what the caller may see.
//
// - One workspace per scope; entities from elsewhere read as not found.
// - Restricted projects the caller can't see are hidden (404, never "found
//   something you can't see"), like every other read (project/visibility.ts).
//   So are projects outside the request's project-limited API key.
// - Restricted projects the caller CAN see stay out too unless the workspace
//   turned on "include restricted projects"; then they mark the call
//   `restricted` for the Model Router.
// - Projects with AI off, trashed projects and trashed tasks are left out.
// - Kinds need their read permission (task:read, page:read).

export type AiScope = {
  workspaceId: string;
  userId: string;
  /** Projects AI may read for this caller. */
  projectIds: ReadonlySet<string>;
  /** Of those, the restricted ones (their data is `restricted`). */
  restrictedProjectIds: ReadonlySet<string>;
  /** Visible to the caller but kept out of AI (restricted, or AI off). */
  excludedProjectIds: ReadonlySet<string>;
  can: { readTasks: boolean; readPages: boolean };
};

/**
 * What an item is. Beyond workspace entities: `web` (a web search result),
 * `file` (a file the person attached) and `note` (a memory note).
 */
export type AiContextKind =
  | "task"
  | "comment"
  | "page"
  | "project"
  | "web"
  | "file"
  | "note";

/** One piece of context, with what the answer may cite. */
export type AiContextItem = {
  kind: AiContextKind;
  id: string;
  projectId: string | null;
  /** Short label for citations, e.g. "WEB-12 Fix login". */
  title: string;
  /** Web app path the UI links to (and re-checks on open). */
  url: string;
  /** e.g. "task:WEB-12"; shown in the <untrusted source> attribute. */
  source: string;
  author: string | null;
  text: string;
  dataTier: DataTier;
};

type PermissionCheck = (permissions: Record<string, string[]>) => boolean;

/**
 * The AI scope for a caller and workspace. `can` answers permission
 * questions with the caller's rules (workspacePermissionChecker).
 */
export async function resolveAiScopeFor(input: {
  workspaceId: string;
  userId: string;
  can: PermissionCheck;
  includeRestricted?: boolean;
}): Promise<AiScope> {
  const { workspaceId, userId } = input;
  const includeRestricted =
    input.includeRestricted ??
    (await loadWorkspaceAiPolicy(workspaceId)).includeRestricted;
  const [projects, hidden] = await Promise.all([
    db
      .select({
        id: projectTable.id,
        visibility: projectTable.visibility,
        aiEnabled: projectTable.aiEnabled,
      })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.deletedAt),
        ),
      ),
    hiddenFromUserAndKey(userId, workspaceId),
  ]);
  const hiddenSet = new Set(hidden);
  const projectIds = new Set<string>();
  const restrictedProjectIds = new Set<string>();
  const excludedProjectIds = new Set<string>();
  for (const project of projects) {
    if (hiddenSet.has(project.id)) continue;
    const restricted = project.visibility === "restricted";
    if (!project.aiEnabled || (restricted && !includeRestricted)) {
      excludedProjectIds.add(project.id);
      continue;
    }
    projectIds.add(project.id);
    if (restricted) restrictedProjectIds.add(project.id);
  }
  return {
    workspaceId,
    userId,
    projectIds,
    restrictedProjectIds,
    excludedProjectIds,
    can: {
      readTasks: input.can({ task: ["read"] }),
      readPages: input.can({ page: ["read"] }),
    },
  };
}

/** The AI scope of the request's user in the request's workspace. */
export async function resolveAiScope(c: Context): Promise<AiScope> {
  const workspaceId = c.get("workspaceId") as string | undefined;
  const userId = c.get("userId") as string | undefined;
  if (!workspaceId || !userId) {
    throw new HTTPException(500, { message: "AI scope needs a workspace" });
  }
  return resolveAiScopeFor({
    workspaceId,
    userId,
    can: await workspacePermissionChecker(c),
  });
}

/** The data tier of a project's content under this scope. */
export function projectDataTier(scope: AiScope, projectId: string): DataTier {
  return scope.restrictedProjectIds.has(projectId) ? "restricted" : "private";
}

/**
 * 404 for a project the caller can't see (or of another workspace), and
 * AI_DISABLED for one they see but AI may not read.
 */
export function assertProjectInScope(scope: AiScope, projectId: string): void {
  if (scope.projectIds.has(projectId)) return;
  if (scope.excludedProjectIds.has(projectId)) {
    throw new AiError(
      "AI_DISABLED",
      "AI can't read this project: it has AI turned off, or it is restricted",
    );
  }
  throw new HTTPException(404, { message: PROJECT_NOT_FOUND });
}

/** Keeps only items AI may read; run it again after any retrieval. */
export function filterToScope<T extends { projectId: string | null }>(
  scope: AiScope,
  items: readonly T[],
): T[] {
  return items.filter(
    (item) => item.projectId === null || scope.projectIds.has(item.projectId),
  );
}

function taskKey(slug: string, number: number | null): string {
  return `${slug.toUpperCase()}-${number ?? 0}`;
}

/**
 * A task with its latest comments (newest last). Comments marked internal
 * and public are both included: the caller is a member who can read them.
 */
export async function loadTaskContext(
  scope: AiScope,
  taskId: string,
  options: { comments?: number; maxChars?: number } = {},
): Promise<AiContextItem[]> {
  if (!scope.can.readTasks) {
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }
  const [task] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      number: taskTable.number,
      title: taskTable.title,
      description: taskTable.description,
      status: taskTable.status,
      priority: taskTable.priority,
      dueDate: taskTable.dueDate,
      deletedAt: taskTable.deletedAt,
      slug: projectTable.slug,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(eq(taskTable.id, taskId))
    .limit(1);
  if (!task || task.deletedAt || task.workspaceId !== scope.workspaceId) {
    throw new HTTPException(404, { message: "Task not found" });
  }
  if (!scope.projectIds.has(task.projectId)) {
    if (scope.excludedProjectIds.has(task.projectId)) {
      assertProjectInScope(scope, task.projectId);
    }
    throw new HTTPException(404, { message: "Task not found" });
  }

  const key = taskKey(task.slug, task.number);
  const dataTier = projectDataTier(scope, task.projectId);
  const url = `/dashboard/workspace/${scope.workspaceId}/project/${task.projectId}/task/${task.id}`;
  const facts = [
    `Title: ${task.title}`,
    `Status: ${task.status}`,
    `Priority: ${task.priority}`,
    task.dueDate ? `Due: ${task.dueDate.toISOString().slice(0, 10)}` : null,
    task.description ? `Description:\n${task.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const items: AiContextItem[] = [
    {
      kind: "task",
      id: task.id,
      projectId: task.projectId,
      title: `${key} ${task.title}`,
      url,
      source: `task:${key}`,
      author: null,
      text: truncateText(facts, options.maxChars ?? 12_000),
      dataTier,
    },
  ];

  const limit = options.comments ?? 20;
  if (limit > 0) {
    const comments = await db
      .select({
        id: activityTable.id,
        content: activityTable.content,
        author: userTable.name,
        external: activityTable.externalUserName,
        createdAt: activityTable.createdAt,
      })
      .from(activityTable)
      .leftJoin(userTable, eq(userTable.id, activityTable.userId))
      .where(
        and(
          eq(activityTable.taskId, task.id),
          eq(activityTable.type, "comment"),
        ),
      )
      .orderBy(desc(activityTable.createdAt))
      .limit(limit);
    for (const comment of comments.reverse()) {
      if (!comment.content) continue;
      items.push({
        kind: "comment",
        id: comment.id,
        projectId: task.projectId,
        title: `${key} comment`,
        url,
        source: `comment:${key}`,
        author: comment.author ?? comment.external ?? null,
        text: truncateText(comment.content, 4000),
        dataTier,
      });
    }
  }
  return items;
}

/**
 * A page the caller may read: page:read, public or their own, not
 * archived, and (for project pages) in a project AI may read.
 */
export async function loadPageContext(
  scope: AiScope,
  pageId: string,
  options: { maxChars?: number } = {},
): Promise<AiContextItem> {
  if (!scope.can.readPages) {
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }
  const [page] = await db
    .select({
      id: pageTable.id,
      workspaceId: pageTable.workspaceId,
      projectId: pageTable.projectId,
      title: pageTable.title,
      text: pageTable.contentText,
      archivedAt: pageTable.archivedAt,
      access: pageTable.access,
      ownerId: pageTable.ownerId,
      pagesEnabled: projectTable.pagesEnabled,
    })
    .from(pageTable)
    .leftJoin(projectTable, eq(projectTable.id, pageTable.projectId))
    .where(
      and(
        eq(pageTable.id, pageId),
        eq(pageTable.workspaceId, scope.workspaceId),
        or(eq(pageTable.access, "public"), eq(pageTable.ownerId, scope.userId)),
      ),
    )
    .limit(1);
  if (!page || page.archivedAt || page.pagesEnabled === false) {
    throw new HTTPException(404, { message: "Page not found" });
  }
  if (page.projectId && !scope.projectIds.has(page.projectId)) {
    if (scope.excludedProjectIds.has(page.projectId)) {
      assertProjectInScope(scope, page.projectId);
    }
    throw new HTTPException(404, { message: "Page not found" });
  }
  const title = page.title || "Untitled";
  return {
    kind: "page",
    id: page.id,
    projectId: page.projectId,
    title,
    url: page.projectId
      ? `/dashboard/workspace/${scope.workspaceId}/project/${page.projectId}/pages/${page.id}`
      : `/dashboard/workspace/${scope.workspaceId}/pages/${page.id}`,
    source: `page:${title}`,
    author: null,
    text: truncateText(page.text, options.maxChars ?? 16_000),
    dataTier: page.projectId
      ? projectDataTier(scope, page.projectId)
      : "private",
  };
}

/** Names and descriptions of the projects AI may read (for planning). */
export async function loadProjectsContext(
  scope: AiScope,
  projectIds?: string[],
): Promise<AiContextItem[]> {
  const ids = projectIds
    ? projectIds.filter((id) => scope.projectIds.has(id))
    : [...scope.projectIds];
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: projectTable.id,
      name: projectTable.name,
      slug: projectTable.slug,
      description: projectTable.description,
    })
    .from(projectTable)
    .where(inArray(projectTable.id, ids))
    .orderBy(asc(projectTable.position));
  return rows.map((project) => ({
    kind: "project" as const,
    id: project.id,
    projectId: project.id,
    title: project.name,
    url: `/dashboard/workspace/${scope.workspaceId}/project/${project.id}/board`,
    source: `project:${project.slug.toUpperCase()}`,
    author: null,
    text: [`Name: ${project.name}`, project.description ?? ""]
      .filter(Boolean)
      .join("\n"),
    dataTier: projectDataTier(scope, project.id),
  }));
}

/** The data tier of a set of context items (ai/router.ts). */
export function contextDataTier(items: readonly AiContextItem[]): DataTier {
  return dataTierOf(
    items.map((item) => item.dataTier),
    "private",
  );
}

/**
 * Renders items as <untrusted> blocks in order (most relevant first) within
 * a character budget. Items that don't fit are dropped with a note, never
 * silently.
 */
export function renderContext(
  items: readonly AiContextItem[],
  options: { maxChars?: number } = {},
): string {
  const budget = options.maxChars ?? 60_000;
  const blocks: string[] = [];
  let used = 0;
  let dropped = 0;
  for (const item of items) {
    const block = wrapUntrusted({
      source: item.source,
      author: item.author,
      text: item.text,
      maxChars: Math.max(500, budget - used),
    });
    if (used + block.length > budget && blocks.length > 0) {
      dropped += 1;
      continue;
    }
    blocks.push(block);
    used += block.length;
  }
  if (dropped > 0) {
    blocks.push(`[${dropped} more item(s) left out to fit the context budget]`);
  }
  return blocks.join("\n\n");
}

/** Citations for the UI: what the answer was built from. */
export function citationsOf(items: readonly AiContextItem[]) {
  const seen = new Set<string>();
  const out: { kind: AiContextKind; id: string; title: string; url: string }[] =
    [];
  for (const item of items) {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key) || item.kind === "comment") continue;
    seen.add(key);
    out.push({
      kind: item.kind,
      id: item.id,
      title: item.title,
      url: item.url,
    });
  }
  return out;
}
