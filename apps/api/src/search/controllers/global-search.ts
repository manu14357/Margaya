import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import db from "../../database";
import {
  projectTable,
  userTable,
  workspaceTable,
  workspaceUserTable,
} from "../../database/schema";
import { searchPages } from "../../page/search-pages";
import {
  hiddenForCurrentRequest,
  notHiddenProject,
} from "../../project/visibility";
import { taskDetailActivitySummary } from "../../task-activity/search-summary";
import {
  type CommentHit,
  computedScore,
  findActivities,
  findComments,
  findTaskByKey,
  findTasks,
  type SourceScope,
  type TaskHit,
} from "../sources";
import { parseTextQuery, type SearchSnippet } from "../text-query";
import {
  type PlanningSearchResult,
  searchCycles,
  searchIntake,
  searchModules,
  searchViews,
} from "./planning-search";

type SearchParams = {
  query: string;
  userEmail?: string;
  userId?: string;
  type?:
    | "all"
    | "tasks"
    | "projects"
    | "workspaces"
    | "comments"
    | "activities"
    | "pages"
    | "cycles"
    | "modules"
    | "views"
    | "intake";
  workspaceId?: string;
  projectId?: string;
  limit?: number;
  /** The caller holds page:read in the workspace; pages are left out otherwise. */
  canReadPages?: boolean;
  /** cycle:read, module:read and view:read; each kind is left out without it. */
  canReadCycles?: boolean;
  canReadModules?: boolean;
  canReadViews?: boolean;
  /** "all" with intake:read, "own" with only intake:create, else none. */
  intakeVisibility?: "all" | "own" | "none";
};

type SearchResult = {
  id: string;
  type:
    | "task"
    | "project"
    | "workspace"
    | "comment"
    | "activity"
    | "page"
    | PlanningSearchResult["type"];
  title: string;
  description?: string;
  content?: string;
  projectId?: string;
  projectName?: string;
  workspaceId?: string;
  workspaceName?: string;
  userId?: string;
  userName?: string;
  createdAt: Date;
  relevanceScore: number;
  taskNumber?: number;
  projectSlug?: string;
  priority?: string;
  status?: string;
  /** For comment and activity results: the task they belong to. */
  taskId?: string;
  /** Highlighted body text around the match (`ts_headline`). */
  snippet?: SearchSnippet;
};

function toDisplayCase(value: string) {
  return value
    .replace(/[-_]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getActivitySearchContent(
  type: string,
  content: string | null,
  eventData: unknown,
) {
  if (content) return content;
  if (!eventData || typeof eventData !== "object" || Array.isArray(eventData)) {
    return undefined;
  }

  const data = eventData as Record<string, unknown>;

  switch (type) {
    case "status_changed":
      if (data.statusHidden === true) {
        return "changed status in another project";
      }
      return `changed status from ${toDisplayCase(String(data.oldStatus ?? ""))} to ${toDisplayCase(String(data.newStatus ?? ""))}`;
    case "priority_changed":
      return `changed priority from ${toDisplayCase(String(data.oldPriority ?? ""))} to ${toDisplayCase(String(data.newPriority ?? ""))}`;
    case "unassigned":
      // Rows from before per-person assignees name nobody.
      if (data.isSelfUnassigned) return "unassigned themselves";
      return data.oldAssignee
        ? `unassigned ${String(data.oldAssignee)}`
        : "unassigned the task";
    case "assignee_changed":
      return data.isSelfAssigned
        ? "assigned the task to themselves"
        : `assigned the task to ${String(data.newAssignee ?? "someone")}`;
    case "due_date_changed":
      if (!data.newDueDate) {
        return "cleared the due date";
      }
      if (!data.oldDueDate) {
        return `set due date to ${String(data.newDueDate)}`;
      }
      return `changed due date from ${String(data.oldDueDate)} to ${String(data.newDueDate)}`;
    case "title_changed":
      return `changed title from "${String(data.oldTitle ?? "")}" to "${String(data.newTitle ?? "")}"`;
    case "task":
      return "created the task";
    default:
      return taskDetailActivitySummary(type, data);
  }
}

function taskResult(task: TaskHit): SearchResult {
  return {
    id: task.id,
    type: "task",
    title: task.title,
    description: task.description || undefined,
    projectId: task.projectId,
    projectName: task.projectName || undefined,
    projectSlug: task.projectSlug || undefined,
    workspaceId: task.workspaceId || undefined,
    workspaceName: task.workspaceName || undefined,
    userId: task.userId || undefined,
    userName: task.userName || undefined,
    createdAt: task.createdAt,
    relevanceScore: task.score,
    taskNumber: task.taskNumber || undefined,
    priority: task.priority || undefined,
    status: task.status,
    snippet: task.snippet,
  };
}

function activityResult(activity: CommentHit): SearchResult {
  const isComment = activity.type === "comment";
  return {
    id: activity.id,
    type: isComment ? "comment" : "activity",
    title: isComment
      ? `Comment on ${activity.taskTitle || "task"}`
      : `${activity.type} on ${activity.taskTitle || "task"}`,
    content: getActivitySearchContent(
      activity.type,
      activity.content,
      activity.eventData,
    ),
    projectId: activity.projectId || undefined,
    projectName: activity.projectName || undefined,
    projectSlug: activity.projectSlug || undefined,
    workspaceId: activity.workspaceId || undefined,
    workspaceName: activity.workspaceName || undefined,
    userId: activity.userId || undefined,
    userName: activity.userName || undefined,
    createdAt: activity.createdAt,
    relevanceScore: activity.score,
    taskNumber: activity.taskNumber || undefined,
    taskId: activity.taskId,
    snippet: activity.snippet,
  };
}

/**
 * Ranked full-text search (see search/text-query.ts) over everything the
 * caller may open. An exact task key ("WEB-12") scores 10 and comes first;
 * title matches score 3 and body matches 2, each plus a rank below 1.
 */
async function globalSearch(params: SearchParams): Promise<{
  results: SearchResult[];
  totalCount: number;
  searchQuery: string;
}> {
  const {
    query,
    userId,
    userEmail,
    type = "all",
    workspaceId,
    projectId,
    limit = 20,
  } = params;

  let resolvedUserId = userId;
  if (!resolvedUserId && userEmail) {
    const user = await db
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.email, userEmail))
      .limit(1);

    if (user.length > 0 && user[0]) {
      resolvedUserId = user[0].id;
    }
  }

  if (!resolvedUserId) {
    return { results: [], totalCount: 0, searchQuery: query };
  }

  const userWorkspaces = await db
    .select({ workspaceId: workspaceUserTable.workspaceId })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.userId, resolvedUserId));

  const accessibleWorkspaceIds = userWorkspaces
    .map((w) => w.workspaceId)
    .filter(Boolean);

  if (accessibleWorkspaceIds.length === 0) {
    return { results: [], totalCount: 0, searchQuery: query };
  }
  const workspaceIds = workspaceId ? [workspaceId] : accessibleWorkspaceIds;

  const text = parseTextQuery(query);
  const results: SearchResult[] = [];
  // Each kind is an independent read, so they run concurrently on the pool;
  // their results are appended in the order below.
  const sections: Promise<SearchResult[]>[] = [];

  // Projects the caller may not see, and those outside a project-limited API
  // key (project/visibility.ts).
  const hidden = (
    await Promise.all(workspaceIds.map((id) => hiddenForCurrentRequest(id)))
  ).flat();
  if (projectId && hidden.includes(projectId)) {
    return { results: [], totalCount: 0, searchQuery: query };
  }

  const scope: SourceScope = {
    workspaceIds,
    hidden,
    projectId,
    query: text,
    limit,
  };

  // Trashed projects read as gone (C7).
  const workspaceFilter = and(
    inArray(projectTable.workspaceId, workspaceIds),
    isNull(projectTable.deletedAt),
    notHiddenProject(projectTable.id, hidden),
  );

  if (type === "all" || type === "tasks") {
    sections.push(
      (async () => {
        const [byKey, byText] = await Promise.all([
          findTaskByKey(scope),
          findTasks(scope),
        ]);
        const seen = new Set(byKey.map((task) => task.id));
        return [...byKey, ...byText.filter((task) => !seen.has(task.id))].map(
          taskResult,
        );
      })(),
    );
  }

  if (type === "all" || type === "projects") {
    sections.push(
      (async () => {
        const { match, score } = computedScore(
          sql`${projectTable.name}`,
          sql`${projectTable.description}`,
          text,
        );
        const projects = await db
          .select({
            id: projectTable.id,
            name: projectTable.name,
            description: projectTable.description,
            slug: projectTable.slug,
            workspaceId: projectTable.workspaceId,
            workspaceName: workspaceTable.name,
            createdAt: projectTable.createdAt,
            relevanceScore: score.as("relevanceScore"),
          })
          .from(projectTable)
          .leftJoin(
            workspaceTable,
            eq(projectTable.workspaceId, workspaceTable.id),
          )
          .where(and(workspaceFilter, match))
          .orderBy(desc(score), desc(projectTable.createdAt))
          .limit(limit);

        return projects.map(
          (project): SearchResult => ({
            id: project.id,
            type: "project",
            title: project.name,
            description: project.description || undefined,
            projectId: project.id,
            projectSlug: project.slug || undefined,
            workspaceId: project.workspaceId,
            workspaceName: project.workspaceName || undefined,
            createdAt: project.createdAt,
            relevanceScore: Number(project.relevanceScore),
          }),
        );
      })(),
    );
  }

  if (type === "all" || type === "workspaces") {
    sections.push(
      (async () => {
        const { match, score } = computedScore(
          sql`${workspaceTable.name}`,
          sql`${workspaceTable.description}`,
          text,
        );
        const workspaces = await db
          .select({
            id: workspaceTable.id,
            name: workspaceTable.name,
            description: workspaceTable.description,
            createdAt: workspaceTable.createdAt,
            relevanceScore: score.as("relevanceScore"),
          })
          .from(workspaceTable)
          .where(and(inArray(workspaceTable.id, accessibleWorkspaceIds), match))
          .orderBy(desc(score), desc(workspaceTable.createdAt))
          .limit(limit);

        return workspaces.map(
          (workspace): SearchResult => ({
            id: workspace.id,
            type: "workspace",
            title: workspace.name,
            description: workspace.description || undefined,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            createdAt: workspace.createdAt,
            relevanceScore: Number(workspace.relevanceScore),
          }),
        );
      })(),
    );
  }

  if (type === "all" || type === "comments") {
    sections.push(findComments(scope).then((rows) => rows.map(activityResult)));
  }

  if (type === "all" || type === "activities") {
    sections.push(
      findActivities(scope).then((rows) => rows.map(activityResult)),
    );
  }

  if (
    (type === "all" || type === "pages") &&
    params.canReadPages &&
    workspaceId
  ) {
    sections.push(
      searchPages({
        userId: resolvedUserId,
        workspaceId,
        projectId,
        query,
        limit,
        hidden,
      }),
    );
  }

  if (workspaceId) {
    const planningScope = { workspaceId, projectId, query, limit, hidden };
    if ((type === "all" || type === "cycles") && params.canReadCycles) {
      sections.push(searchCycles(planningScope));
    }
    if ((type === "all" || type === "modules") && params.canReadModules) {
      sections.push(searchModules(planningScope));
    }
    if ((type === "all" || type === "views") && params.canReadViews) {
      sections.push(searchViews({ ...planningScope, userId: resolvedUserId }));
    }
    const intakeVisibility = params.intakeVisibility ?? "none";
    if ((type === "all" || type === "intake") && intakeVisibility !== "none") {
      sections.push(
        searchIntake({
          ...planningScope,
          userId: resolvedUserId,
          ownOnly: intakeVisibility === "own",
        }),
      );
    }
  }

  for (const section of await Promise.all(sections)) {
    results.push(...section);
  }

  results.sort((a, b) => {
    if (a.relevanceScore !== b.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const finalResults = results.slice(0, limit);

  return {
    results: finalResults,
    totalCount: results.length,
    searchQuery: query,
  };
}

export default globalSearch;
