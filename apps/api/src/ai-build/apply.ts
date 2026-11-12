import type { InternalApi } from "./dispatch";
import type { BuildItemKind, BuildReport } from "./response";
import type { BuildProposal } from "./schema";
import type { BuildLedger } from "./undo";

// Creates a reviewed proposal, one item at a time, through the ordinary
// create routes (dispatch.ts) under the caller's own permissions. A failed
// item is reported and the rest carries on; only a new project that could
// not be created stops the run, since everything else goes into it.

export type BuildProgress = {
  done: number;
  total: number;
  kind: BuildItemKind;
  name: string;
  ok: boolean;
};

type Column = { name: string; slug: string; position: number };
type Label = { name: string; color: string };
type Created = { id: string };
type CreatedProject = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  isPublic?: boolean | null;
};
type EstimateList = {
  activeEstimateId: string | null;
  estimates: {
    id: string;
    type: string;
    points: { id: string; numericValue: number | null }[];
  }[];
};

/** How many progress steps a proposal takes (project, columns, ...). */
export function buildStepCount(
  proposal: BuildProposal,
  newProject: boolean,
): number {
  return (
    (newProject ? 1 : 0) +
    proposal.columns.length +
    proposal.cycles.length +
    proposal.modules.length +
    proposal.tasks.reduce((sum, task) => sum + 1 + task.subtasks.length, 0)
  );
}

/** The point of a points system closest to an estimate (ties: the lower). */
export function closestPoint(
  points: readonly { id: string; numericValue: number | null }[],
  estimate: number,
): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const point of points) {
    if (point.numericValue === null) continue;
    const distance = Math.abs(point.numericValue - estimate);
    if (!best || distance < best.distance) best = { id: point.id, distance };
  }
  return best?.id ?? null;
}

const MAX_KEY_ATTEMPTS = 5;
const CYCLE_BATCH = 200;

export async function applyBuild(input: {
  call: InternalApi;
  workspaceId: string;
  projectId: string | null;
  proposal: BuildProposal;
  /** Collects the ids of what is created, for undo. */
  ledger: BuildLedger;
  onProgress?: (progress: BuildProgress) => void | Promise<void>;
}): Promise<BuildReport> {
  const { call, workspaceId, proposal, ledger } = input;
  const newProject = !input.projectId;
  const report: BuildReport = {
    projectId: input.projectId,
    total: buildStepCount(proposal, newProject),
    done: 0,
    created: {
      project: false,
      columns: 0,
      cycles: 0,
      modules: 0,
      tasks: 0,
      subtasks: 0,
      labels: 0,
    },
    estimatesSkipped: false,
    failures: [],
  };
  const fail = (
    kind: BuildItemKind,
    name: string,
    result: { status: number; message: string },
  ) => {
    report.failures.push({
      kind,
      name: name.slice(0, 255),
      status: result.status,
      message: result.message,
    });
  };
  const step = async (kind: BuildItemKind, name: string, ok: boolean) => {
    report.done += 1;
    await input.onProgress?.({
      done: report.done,
      total: report.total,
      kind,
      name: name.slice(0, 255),
      ok,
    });
  };

  // 1. The project.
  let projectId = input.projectId;
  if (!projectId) {
    const project = proposal.project;
    if (!project) {
      fail("project", "", { status: 400, message: "No project to create" });
      return report;
    }
    let lastError = { status: 500, message: "Project not created" };
    let createdProject: CreatedProject | null = null;
    for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS && !projectId; attempt++) {
      // Keys are unique per workspace: KEY, KEY2, KEY3, ...
      const key =
        attempt === 0
          ? project.key
          : `${[...project.key].slice(0, 7).join("")}${attempt + 1}`;
      const created = await call<CreatedProject>("POST", "/project", {
        name: project.name,
        workspaceId,
        icon: "Layout",
        slug: key,
      });
      if (created.ok) {
        projectId = created.data.id;
        createdProject = created.data;
        break;
      }
      lastError = created;
      if (created.status !== 409) break;
    }
    if (!projectId) {
      fail("project", project.name, lastError);
      await step("project", project.name, false);
      return report;
    }
    report.projectId = projectId;
    report.created.project = true;
    ledger.project = projectId;
    if (project.description.trim() && createdProject) {
      // The create route takes no description; the update route does.
      const described = await call("PUT", `/project/${projectId}`, {
        name: createdProject.name,
        icon: createdProject.icon ?? "Layout",
        slug: createdProject.slug,
        description: project.description,
        isPublic: createdProject.isPublic ?? false,
      });
      if (!described.ok) fail("project", project.name, described);
    }
    await step("project", project.name, true);
  }

  // 2. Columns: reuse names that exist, add the rest at the end.
  const columns = await call<Column[]>("GET", `/column/${projectId}`);
  const slugByName = new Map<string, string>();
  let entrySlug = "to-do";
  if (columns.ok) {
    const sorted = [...columns.data].sort((a, b) => a.position - b.position);
    if (sorted[0]) entrySlug = sorted[0].slug;
    for (const column of sorted) {
      slugByName.set(column.name.toLowerCase(), column.slug);
    }
  }
  for (const column of proposal.columns) {
    const existing = slugByName.get(column.name.toLowerCase());
    if (existing) {
      await step("column", column.name, true);
      continue;
    }
    const created = await call<Column & Created>(
      "POST",
      `/column/${projectId}`,
      { name: column.name },
    );
    if (created.ok) {
      slugByName.set(column.name.toLowerCase(), created.data.slug);
      report.created.columns += 1;
      ledger.columns.push(created.data.id);
    } else {
      fail("column", column.name, created);
    }
    await step("column", column.name, created.ok);
  }

  // 3. Label colors: an existing workspace label keeps its color.
  const colorByName = new Map<string, string>();
  for (const label of proposal.labels) {
    colorByName.set(label.name.toLowerCase(), label.color);
  }
  const workspaceLabels = await call<Label[]>(
    "GET",
    `/label/workspace/${workspaceId}`,
  );
  if (workspaceLabels.ok && Array.isArray(workspaceLabels.data)) {
    for (const label of workspaceLabels.data) {
      colorByName.set(label.name.toLowerCase(), label.color);
    }
  }

  // 4. Cycles and modules.
  const cycleIds = new Map<string, string>();
  for (const cycle of proposal.cycles) {
    const created = await call<Created>("POST", `/cycle/project/${projectId}`, {
      name: cycle.name,
      ...(cycle.description ? { description: cycle.description } : {}),
      startDate: cycle.startDate,
      endDate: cycle.endDate,
    });
    if (created.ok) {
      cycleIds.set(cycle.ref, created.data.id);
      report.created.cycles += 1;
      ledger.cycles.push(created.data.id);
    } else {
      fail("cycle", cycle.name, created);
    }
    await step("cycle", cycle.name, created.ok);
  }
  const moduleIds = new Map<string, string>();
  for (const module of proposal.modules) {
    const created = await call<Created>(
      "POST",
      `/module/project/${projectId}`,
      {
        name: module.name,
        ...(module.description ? { description: module.description } : {}),
      },
    );
    if (created.ok) {
      moduleIds.set(module.ref, created.data.id);
      report.created.modules += 1;
      ledger.modules.push(created.data.id);
    } else {
      fail("module", module.name, created);
    }
    await step("module", module.name, created.ok);
  }

  // 5. Estimates map onto the active points system, when there is one.
  let points: EstimateList["estimates"][number]["points"] | null = null;
  if (proposal.tasks.some((task) => task.estimate !== null)) {
    const estimates = await call<EstimateList>("GET", `/estimate/${projectId}`);
    const active = estimates.ok
      ? estimates.data.estimates.find(
          (estimate) => estimate.id === estimates.data.activeEstimateId,
        )
      : undefined;
    if (active?.type === "points") points = active.points;
    else report.estimatesSkipped = true;
  }

  // 6. Tasks, their labels, modules and sub-tasks.
  const cycleTasks = new Map<string, string[]>();
  for (const task of proposal.tasks) {
    const estimatePointId =
      points && task.estimate !== null
        ? closestPoint(points, task.estimate)
        : null;
    const created = await call<Created>("POST", `/task/${projectId}`, {
      title: task.title,
      description: task.description,
      // The model wrote the task: it carries the AI-generated label.
      aiAssist: { feature: "talk_to_build" },
      priority: task.priority,
      status:
        (task.column && slugByName.get(task.column.toLowerCase())) || entrySlug,
      ...(estimatePointId ? { estimatePointId } : {}),
    });
    if (!created.ok) {
      fail("task", task.title, created);
      await step("task", task.title, false);
      // Its sub-tasks can't be created without it.
      for (const subtask of task.subtasks) {
        fail("subtask", subtask.title, {
          status: created.status,
          message: "Its parent task was not created",
        });
        await step("subtask", subtask.title, false);
      }
      continue;
    }
    const taskId = created.data.id;
    report.created.tasks += 1;
    ledger.tasks.push(taskId);

    for (const name of task.labels) {
      const label = await call("POST", "/label", {
        name,
        color: colorByName.get(name.toLowerCase()) ?? "gray",
        workspaceId,
        taskId,
      });
      if (label.ok) report.created.labels += 1;
      else fail("label", `${task.title}: ${name}`, label);
    }

    const moduleId = task.moduleRef ? moduleIds.get(task.moduleRef) : undefined;
    if (moduleId) {
      const linked = await call("PUT", `/module/task/${taskId}`, {
        addModuleIds: [moduleId],
      });
      if (!linked.ok) fail("module_tasks", task.title, linked);
    }
    const cycleId = task.cycleRef ? cycleIds.get(task.cycleRef) : undefined;
    if (cycleId) {
      cycleTasks.set(cycleId, [...(cycleTasks.get(cycleId) ?? []), taskId]);
    }
    await step("task", task.title, true);

    for (const subtask of task.subtasks) {
      const child = await call<Created>("POST", `/task/${projectId}`, {
        title: subtask.title,
        description: "",
        aiAssist: { feature: "talk_to_build" },
        priority: "no-priority",
        status: entrySlug,
        parentId: taskId,
      });
      if (child.ok) {
        report.created.subtasks += 1;
        ledger.subtasks.push(child.data.id);
      } else {
        fail("subtask", subtask.title, child);
      }
      await step("subtask", subtask.title, child.ok);
    }
  }

  // 7. Cycle membership, in batches the route accepts.
  for (const [cycleId, taskIds] of cycleTasks) {
    for (let i = 0; i < taskIds.length; i += CYCLE_BATCH) {
      const added = await call("POST", `/cycle/${cycleId}/tasks`, {
        taskIds: taskIds.slice(i, i + CYCLE_BATCH),
      });
      const name =
        proposal.cycles.find((cycle) => cycleIds.get(cycle.ref) === cycleId)
          ?.name ?? cycleId;
      if (!added.ok) fail("cycle_tasks", name, added);
    }
  }

  return report;
}
