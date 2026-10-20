import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { AiContextItem, AiScope } from "../ai/context";
import { filterToScope, projectDataTier } from "../ai/context";
import db from "../database";
import {
  intakeItemTable,
  labelTable,
  projectTable,
  taskTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import { isIntakeStatus, isOpenIntakeStatus } from "../intake/status";
import { usersWhoCanSeeProject } from "../project/visibility";
import {
  searchWorkspace,
  type WorkspaceSearchHit,
} from "../search/search-workspace";
import { assigneesOfTasks } from "../task/assignees";

// What the Triage Copilot may suggest from: only real options the caller
// could pick by hand. Retrieval runs as the caller (searchWorkspace filters
// restricted projects, trashed tasks and unaccepted intake), and every hit
// is filtered to the AI scope again.

const MAX_LABELS = 150;
const MAX_PEOPLE = 60;
const MAX_PROJECTS = 30;
const SIMILAR_LIMIT = 10;
const DUPLICATE_LIMIT = 6;

export type TriageTask = {
  id: string;
  projectId: string;
  key: string;
  title: string;
  description: string;
  priority: string;
  labelNames: string[];
  assigneeIds: string[];
  /** Open intake request: triage with intake:triage, no move. */
  isIntake: boolean;
};

export type CandidateLabel = { id: string; name: string; color: string };
export type CandidatePerson = {
  id: string;
  name: string;
  image: string | null;
};
export type CandidateProject = { id: string; name: string; slug: string };
export type SimilarTask = {
  id: string;
  projectId: string;
  key: string;
  title: string;
  status: string | null;
  labelNames: string[];
  assigneeIds: string[];
  /** 3 or more: the whole title matched (searchWorkspace scores). */
  score: number;
  /** Found by the exact-title query: a duplicate candidate. */
  titleMatch: boolean;
};

export type TriageCandidates = {
  labels: CandidateLabel[];
  people: CandidatePerson[];
  projects: CandidateProject[];
  similar: SimilarTask[];
};

function taskKey(slug: string | null, number: number | null | undefined) {
  return `${(slug ?? "").toUpperCase()}-${number ?? 0}`;
}

/** The task being triaged (access already checked by loadTaskContext). */
export async function loadTriageTask(taskId: string): Promise<TriageTask> {
  const [task] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      number: taskTable.number,
      title: taskTable.title,
      description: taskTable.description,
      priority: taskTable.priority,
      slug: projectTable.slug,
      intakeStatus: intakeItemTable.status,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(intakeItemTable, eq(intakeItemTable.taskId, taskTable.id))
    .where(eq(taskTable.id, taskId))
    .limit(1);
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  const [labels, assignees] = await Promise.all([
    db
      .select({ name: labelTable.name })
      .from(labelTable)
      .where(eq(labelTable.taskId, taskId)),
    assigneesOfTasks([taskId]),
  ]);
  return {
    id: task.id,
    projectId: task.projectId,
    key: taskKey(task.slug, task.number),
    title: task.title,
    description: task.description ?? "",
    priority: task.priority ?? "no-priority",
    labelNames: labels.map((label) => label.name),
    assigneeIds: assignees.get(taskId) ?? [],
    isIntake:
      isIntakeStatus(task.intakeStatus) &&
      isOpenIntakeStatus(task.intakeStatus),
  };
}

/** Words worth matching on: letters or digits, three or more, no repeats. */
export function keywordQuery(text: string, maxWords = 8): string {
  const seen = new Set<string>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
    seen.add(word);
    if (seen.size >= maxWords) break;
  }
  return [...seen].join(" or ");
}

export async function workspaceLabels(workspaceId: string) {
  return db
    .select({
      id: labelTable.id,
      name: labelTable.name,
      color: labelTable.color,
    })
    .from(labelTable)
    .where(
      and(
        eq(labelTable.workspaceId, workspaceId),
        isNull(labelTable.taskId),
        isNull(labelTable.deletionStartedAt),
      ),
    )
    .orderBy(asc(labelTable.name))
    .limit(MAX_LABELS);
}

/**
 * People who could take the task: workspace members other than viewers
 * who can see its project, those seen on similar tasks first. With
 * `humansOnly`, AI agents (user kind "agent") are left out.
 */
export async function assignablePeople(
  workspaceId: string,
  projectId: string,
  preferred: ReadonlySet<string>,
  options: { humansOnly?: boolean } = {},
): Promise<CandidatePerson[]> {
  const members = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      image: userTable.image,
    })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        ne(workspaceUserTable.role, "viewer"),
        options.humansOnly ? eq(userTable.kind, "human") : undefined,
      ),
    )
    .orderBy(asc(userTable.name))
    .limit(500);
  const visible = await usersWhoCanSeeProject(
    projectId,
    members.map((member) => member.id),
  );
  return members
    .filter((member) => visible.has(member.id))
    .sort(
      (a, b) =>
        Number(preferred.has(b.id)) - Number(preferred.has(a.id)) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, MAX_PEOPLE);
}

function taskHits(
  scope: AiScope,
  hits: readonly WorkspaceSearchHit[],
  selfId: string,
) {
  return filterToScope(
    scope,
    hits.filter(
      (hit) => hit.type === "task" && hit.taskId && hit.taskId !== selfId,
    ),
  );
}

/** Existing tasks like this one, with their labels and assignees. */
export async function similarTasks(
  scope: AiScope,
  task: Pick<TriageTask, "id" | "title" | "description">,
): Promise<SimilarTask[]> {
  const search = (query: string, limit: number) =>
    query
      ? searchWorkspace({
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          query,
          types: ["task"],
          limit,
        })
      : Promise.resolve([]);
  const [exact, related] = await Promise.all([
    search(task.title.trim(), DUPLICATE_LIMIT),
    search(
      keywordQuery(`${task.title} ${task.description.slice(0, 400)}`),
      SIMILAR_LIMIT,
    ),
  ]);
  const byId = new Map<
    string,
    { hit: WorkspaceSearchHit; titleMatch: boolean }
  >();
  for (const hit of taskHits(scope, exact, task.id)) {
    byId.set(hit.taskId as string, { hit, titleMatch: true });
  }
  for (const hit of taskHits(scope, related, task.id)) {
    const id = hit.taskId as string;
    if (!byId.has(id)) byId.set(id, { hit, titleMatch: false });
  }
  const ids = [...byId.keys()];
  if (ids.length === 0) return [];
  const [labels, assignees] = await Promise.all([
    db
      .select({ taskId: labelTable.taskId, name: labelTable.name })
      .from(labelTable)
      .where(inArray(labelTable.taskId, ids)),
    assigneesOfTasks(ids),
  ]);
  const labelsByTask = new Map<string, string[]>();
  for (const label of labels) {
    if (!label.taskId) continue;
    const list = labelsByTask.get(label.taskId) ?? [];
    list.push(label.name);
    labelsByTask.set(label.taskId, list);
  }
  return [...byId.entries()].map(([id, { hit, titleMatch }]) => ({
    id,
    projectId: hit.projectId as string,
    key: taskKey(hit.projectSlug, hit.taskNumber),
    title: hit.title,
    status: hit.status ?? null,
    labelNames: labelsByTask.get(id) ?? [],
    assigneeIds: assignees.get(id) ?? [],
    score: hit.score,
    titleMatch,
  }));
}

export async function loadTriageCandidates(
  scope: AiScope,
  task: TriageTask,
): Promise<TriageCandidates> {
  const similar = await similarTasks(scope, task);
  const preferred = new Set(similar.flatMap((item) => item.assigneeIds));
  const projectIds = [...scope.projectIds];
  const [labels, people, projects] = await Promise.all([
    workspaceLabels(scope.workspaceId),
    // Triage suggests people: no project setting asks for agents as
    // assignees, and their work history isn't evidence of who should own it.
    assignablePeople(scope.workspaceId, task.projectId, preferred, {
      humansOnly: true,
    }),
    projectIds.length > 0
      ? db
          .select({
            id: projectTable.id,
            name: projectTable.name,
            slug: projectTable.slug,
          })
          .from(projectTable)
          .where(
            and(
              inArray(projectTable.id, projectIds),
              isNull(projectTable.archivedAt),
            ),
          )
          .orderBy(asc(projectTable.position))
          .limit(MAX_PROJECTS)
      : Promise.resolve([]),
  ]);
  return { labels, people, projects, similar };
}

/** Similar tasks as context items (they decide data tier and AI checks). */
export function similarContextItems(
  scope: AiScope,
  similar: readonly SimilarTask[],
): AiContextItem[] {
  return similar.map((item) => ({
    kind: "task" as const,
    id: item.id,
    projectId: item.projectId,
    title: `${item.key} ${item.title}`,
    url: `/dashboard/workspace/${scope.workspaceId}/project/${item.projectId}/task/${item.id}`,
    source: `task:${item.key}`,
    author: null,
    text: item.title,
    dataTier: projectDataTier(scope, item.projectId),
  }));
}
