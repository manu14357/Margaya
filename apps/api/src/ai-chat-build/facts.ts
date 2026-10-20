import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { AiScope } from "../ai/context";
import db from "../database";
import {
  agentTable,
  columnTable,
  cycleTable,
  labelTable,
  moduleTable,
  projectTable,
  taskTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";

// What a plan is checked against: the projects AI may read for the caller
// (with their columns), cycles, modules, labels, members, agents and the
// tasks the plan mentions. Everything is loaded under the caller's AI scope,
// so a plan can't name, or even learn of, anything they can't see.

export type FactProject = {
  id: string;
  name: string;
  key: string;
  restricted: boolean;
  archived: boolean;
  cyclesEnabled: boolean;
  modulesEnabled: boolean;
  pagesEnabled: boolean;
  columns: { slug: string; name: string }[];
};

export type FactTask = {
  id: string;
  projectId: string;
  key: string;
  title: string;
  status: string;
};

export type PlanFacts = {
  workspaceId: string;
  projects: FactProject[];
  members: { id: string; name: string }[];
  agents: { id: string; userId: string; name: string; enabled: boolean }[];
  cycles: {
    id: string;
    projectId: string;
    name: string;
    startDate: string | null;
    endDate: string | null;
  }[];
  modules: { id: string; projectId: string; name: string }[];
  labels: { name: string; color: string }[];
  tasks: FactTask[];
};

const LIMITS = {
  projects: 40,
  members: 300,
  cycles: 120,
  modules: 120,
  labels: 80,
  tasks: 200,
} as const;

const TASK_KEY = /^([\p{L}\p{N}_-]+)-(\d+)$/u;

export function taskKeyOf(slug: string, number: number | null): string {
  return `${slug.toUpperCase()}-${number ?? 0}`;
}

/**
 * The live tasks of the scope that `refs` name, by id or key ("WEB-12").
 * Refs that match nothing are simply absent.
 */
export async function loadTasks(
  scope: AiScope,
  refs: readonly string[],
): Promise<FactTask[]> {
  const projectIds = [...scope.projectIds];
  const wanted = [
    ...new Set(refs.map((ref) => ref.trim()).filter(Boolean)),
  ].slice(0, LIMITS.tasks);
  if (projectIds.length === 0 || wanted.length === 0) return [];
  const keyFilters = wanted.flatMap((ref) => {
    const match = TASK_KEY.exec(ref.normalize("NFKC"));
    if (!match?.[1] || !match[2]) return [];
    return [
      and(
        sql`lower(${projectTable.slug}) = lower(${match[1]})`,
        eq(taskTable.number, Number(match[2])),
      ),
    ];
  });
  const rows = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      number: taskTable.number,
      title: taskTable.title,
      status: taskTable.status,
      slug: projectTable.slug,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(
        inArray(taskTable.projectId, projectIds),
        isNull(taskTable.deletedAt),
        eq(projectTable.workspaceId, scope.workspaceId),
        or(inArray(taskTable.id, wanted), ...keyFilters),
      ),
    )
    .limit(LIMITS.tasks);
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    key: taskKeyOf(row.slug, row.number),
    title: row.title,
    status: row.status,
  }));
}

/** The workspace facts of a plan, for the caller's AI scope. */
export async function loadPlanFacts(
  scope: AiScope,
  options: { focusProjectId?: string | null; taskRefs?: readonly string[] },
): Promise<PlanFacts> {
  const workspaceId = scope.workspaceId;
  const scoped = [...scope.projectIds];
  const projectRows = scoped.length
    ? await db
        .select({
          id: projectTable.id,
          name: projectTable.name,
          slug: projectTable.slug,
          archivedAt: projectTable.archivedAt,
          cyclesEnabled: projectTable.cyclesEnabled,
          modulesEnabled: projectTable.modulesEnabled,
          pagesEnabled: projectTable.pagesEnabled,
        })
        .from(projectTable)
        .where(inArray(projectTable.id, scoped))
        .orderBy(
          // The project the chat is about comes first, then board order.
          desc(sql`${projectTable.id} = ${options.focusProjectId ?? ""}`),
          asc(projectTable.position),
        )
        .limit(LIMITS.projects)
    : [];
  const projectIds = projectRows.map((project) => project.id);

  const [columns, cycles, modules, labels, members, agents, tasks] =
    await Promise.all([
      projectIds.length
        ? db
            .select({
              projectId: columnTable.projectId,
              slug: columnTable.slug,
              name: columnTable.name,
            })
            .from(columnTable)
            .where(inArray(columnTable.projectId, projectIds))
            .orderBy(asc(columnTable.position))
        : [],
      projectIds.length
        ? db
            .select({
              id: cycleTable.id,
              projectId: cycleTable.projectId,
              name: cycleTable.name,
              startDate: cycleTable.startDate,
              endDate: cycleTable.endDate,
            })
            .from(cycleTable)
            .where(
              and(
                inArray(cycleTable.projectId, projectIds),
                isNull(cycleTable.archivedAt),
              ),
            )
            .orderBy(desc(cycleTable.startDate))
            .limit(LIMITS.cycles)
        : [],
      projectIds.length
        ? db
            .select({
              id: moduleTable.id,
              projectId: moduleTable.projectId,
              name: moduleTable.name,
            })
            .from(moduleTable)
            .where(
              and(
                inArray(moduleTable.projectId, projectIds),
                isNull(moduleTable.archivedAt),
              ),
            )
            .limit(LIMITS.modules)
        : [],
      db
        .selectDistinct({ name: labelTable.name, color: labelTable.color })
        .from(labelTable)
        .where(
          and(
            eq(labelTable.workspaceId, workspaceId),
            isNull(labelTable.taskId),
          ),
        )
        .limit(LIMITS.labels),
      db
        .select({ id: userTable.id, name: userTable.name })
        .from(workspaceUserTable)
        .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
        .leftJoin(agentTable, eq(agentTable.userId, userTable.id))
        .where(
          and(
            eq(workspaceUserTable.workspaceId, workspaceId),
            isNull(agentTable.id),
          ),
        )
        .orderBy(asc(userTable.name))
        .limit(LIMITS.members),
      db
        .select({
          id: agentTable.id,
          userId: agentTable.userId,
          name: agentTable.name,
          enabled: agentTable.enabled,
        })
        .from(agentTable)
        .where(eq(agentTable.workspaceId, workspaceId))
        .orderBy(asc(agentTable.name)),
      loadTasks(scope, options.taskRefs ?? []),
    ]);

  const columnsByProject = new Map<string, { slug: string; name: string }[]>();
  for (const column of columns) {
    const list = columnsByProject.get(column.projectId) ?? [];
    list.push({ slug: column.slug, name: column.name });
    columnsByProject.set(column.projectId, list);
  }

  return {
    workspaceId,
    projects: projectRows.map((project) => ({
      id: project.id,
      name: project.name,
      key: project.slug.toUpperCase(),
      restricted: scope.restrictedProjectIds.has(project.id),
      archived: Boolean(project.archivedAt),
      cyclesEnabled: project.cyclesEnabled,
      modulesEnabled: project.modulesEnabled,
      pagesEnabled: project.pagesEnabled,
      columns: columnsByProject.get(project.id) ?? [],
    })),
    members,
    agents,
    cycles,
    modules,
    labels,
    tasks,
  };
}

function line(label: string, values: string[]): string | null {
  return values.length > 0 ? `${label}: ${values.join("; ")}` : null;
}

/** The facts as text for the planner prompt (ids the model must use). */
export function renderFacts(facts: PlanFacts): string {
  const projects = facts.projects.map((project) => {
    const cycles = facts.cycles
      .filter((cycle) => cycle.projectId === project.id)
      .slice(0, 12)
      .map(
        (cycle) =>
          `${cycle.name} [id ${cycle.id}${cycle.startDate ? `, ${cycle.startDate}..${cycle.endDate ?? ""}` : ""}]`,
      );
    const modules = facts.modules
      .filter((module) => module.projectId === project.id)
      .slice(0, 12)
      .map((module) => `${module.name} [id ${module.id}]`);
    return [
      `- Project "${project.name}" key ${project.key} [id ${project.id}]${project.archived ? " (archived)" : ""}`,
      `  statuses (slug=name): ${project.columns.map((column) => `${column.slug}=${column.name}`).join(", ") || "to-do, in-progress, in-review, done"}`,
      project.cyclesEnabled
        ? cycles.length > 0
          ? `  cycles: ${cycles.join("; ")}`
          : null
        : "  cycles are turned off",
      project.modulesEnabled
        ? modules.length > 0
          ? `  modules: ${modules.join("; ")}`
          : null
        : "  modules are turned off",
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    projects.length > 0
      ? `Projects:\n${projects.join("\n")}`
      : "Projects: none visible.",
    line(
      "Members (name [id])",
      facts.members.map((member) => `${member.name} [${member.id}]`),
    ),
    line(
      "Agents (name [agentId])",
      facts.agents
        .filter((agent) => agent.enabled)
        .map((agent) => `${agent.name} [${agent.id}]`),
    ),
    line(
      "Workspace labels",
      facts.labels.map((label) => label.name),
    ),
    line(
      "Mentioned tasks",
      facts.tasks.map(
        (task) =>
          `${task.key} "${task.title}" [id ${task.id}] status ${task.status}`,
      ),
    ),
  ]
    .filter(Boolean)
    .join("\n");
}
