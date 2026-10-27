import type { BuildProposal } from "@/fetchers/ai/build";

// The editable form of a "talk to build" proposal: every item can be
// unchecked, renamed or reordered before anything is created. `toProposal`
// turns what is still checked back into the API's proposal shape.

type Proposal = BuildProposal;
type ProposalTask = Proposal["tasks"][number];

export type ReviewSubtask = { id: string; title: string; include: boolean };
export type ReviewTask = Omit<ProposalTask, "subtasks"> & {
  id: string;
  include: boolean;
  subtasks: ReviewSubtask[];
};
export type ReviewColumn = Proposal["columns"][number] & {
  id: string;
  include: boolean;
};
export type ReviewLabel = Proposal["labels"][number] & {
  id: string;
  include: boolean;
};
export type ReviewCycle = Proposal["cycles"][number] & { include: boolean };
export type ReviewModule = Proposal["modules"][number] & { include: boolean };

export type ReviewDraft = {
  summary: string;
  project: Proposal["project"];
  columns: ReviewColumn[];
  labels: ReviewLabel[];
  cycles: ReviewCycle[];
  modules: ReviewModule[];
  tasks: ReviewTask[];
};

export function toReview(proposal: Proposal): ReviewDraft {
  return {
    summary: proposal.summary,
    project: proposal.project ? { ...proposal.project } : null,
    columns: proposal.columns.map((column, index) => ({
      ...column,
      id: `column-${index}`,
      include: true,
    })),
    labels: proposal.labels.map((label, index) => ({
      ...label,
      id: `label-${index}`,
      include: true,
    })),
    cycles: proposal.cycles.map((cycle) => ({ ...cycle, include: true })),
    modules: proposal.modules.map((module) => ({ ...module, include: true })),
    tasks: proposal.tasks.map((task, index) => ({
      ...task,
      id: `task-${index}`,
      include: true,
      subtasks: task.subtasks.map((subtask, subIndex) => ({
        id: `task-${index}-${subIndex}`,
        title: subtask.title,
        include: true,
      })),
    })),
  };
}

/** What is still checked, as the proposal `apply` takes. */
export function toProposal(draft: ReviewDraft): Proposal {
  const cycles = draft.cycles.filter(
    (cycle) => cycle.include && cycle.name.trim(),
  );
  const modules = draft.modules.filter(
    (module) => module.include && module.name.trim(),
  );
  const labels = draft.labels.filter(
    (label) => label.include && label.name.trim(),
  );
  const columns = draft.columns.filter(
    (column) => column.include && column.name.trim(),
  );
  const cycleRefs = new Set(cycles.map((cycle) => cycle.ref));
  const moduleRefs = new Set(modules.map((module) => module.ref));
  const labelNames = new Set(labels.map((label) => label.name.trim()));
  const excludedColumns = new Set(
    draft.columns
      .filter((column) => !column.include)
      .map((column) => column.name.trim().toLowerCase()),
  );

  return {
    summary: draft.summary,
    project: draft.project
      ? {
          name: draft.project.name.trim(),
          key: draft.project.key.trim(),
          description: draft.project.description,
        }
      : null,
    columns: columns.map(({ name }) => ({ name: name.trim() })),
    labels: labels.map(({ name, color }) => ({ name: name.trim(), color })),
    cycles: cycles.map(({ include: _include, ...cycle }) => ({
      ...cycle,
      name: cycle.name.trim(),
      // A cycle needs both dates or neither.
      ...(cycle.startDate && cycle.endDate
        ? {}
        : { startDate: null, endDate: null }),
    })),
    modules: modules.map(({ include: _include, ...module }) => ({
      ...module,
      name: module.name.trim(),
    })),
    tasks: draft.tasks
      .filter((task) => task.include && task.title.trim())
      .map(({ id: _id, include: _include, ...task }) => ({
        ...task,
        title: task.title.trim(),
        column:
          task.column && !excludedColumns.has(task.column.toLowerCase())
            ? task.column
            : null,
        labels: task.labels.filter((name) => labelNames.has(name)),
        cycleRef:
          task.cycleRef && cycleRefs.has(task.cycleRef) ? task.cycleRef : null,
        moduleRef:
          task.moduleRef && moduleRefs.has(task.moduleRef)
            ? task.moduleRef
            : null,
        subtasks: task.subtasks
          .filter((subtask) => subtask.include && subtask.title.trim())
          .map((subtask) => ({ title: subtask.title.trim() })),
      })),
  };
}

/** How many things `apply` will create (the progress total). */
export function countItems(proposal: Proposal): number {
  return (
    (proposal.project ? 1 : 0) +
    proposal.columns.length +
    proposal.cycles.length +
    proposal.modules.length +
    proposal.tasks.reduce((sum, task) => sum + 1 + task.subtasks.length, 0)
  );
}

/** Moves a task up (-1) or down (+1); out-of-range moves change nothing. */
export function moveTask(
  tasks: readonly ReviewTask[],
  index: number,
  delta: -1 | 1,
): ReviewTask[] {
  const target = index + delta;
  if (index < 0 || index >= tasks.length) return [...tasks];
  if (target < 0 || target >= tasks.length) return [...tasks];
  const next = [...tasks];
  const [task] = next.splice(index, 1);
  if (task) next.splice(target, 0, task);
  return next;
}

/** Whether a reviewed proposal can be created at all. */
export function canCreate(draft: ReviewDraft): boolean {
  if (
    draft.project &&
    (!draft.project.name.trim() || !draft.project.key.trim())
  )
    return false;
  return countItems(toProposal(draft)) > (draft.project ? 1 : 0);
}
