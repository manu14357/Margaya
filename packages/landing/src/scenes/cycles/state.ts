import type { Priority } from "../../replica";

export type CycleTaskStatus = "todo" | "inProgress" | "done";

export type CycleTask = {
  id: string;
  number: number;
  title: string;
  status: CycleTaskStatus;
  priority: Priority;
  points: number;
  assignees: string[];
};

export type CyclesState = {
  tasks: CycleTask[];
  /** The burn-down line is revealed (it draws itself once). */
  drawn: boolean;
  /** The task whose status popover is open. */
  menuFor: string | null;
};

export type CyclesAction =
  | { type: "draw" }
  | { type: "openStatus"; id: string }
  | { type: "closeStatus" }
  | { type: "setStatus"; id: string; status: CycleTaskStatus };

/** Tasks done before the visible ones, so the cycle reads as mid-way. */
export const EARLIER_DONE = 4;
/** Remaining tasks on each elapsed day before today. */
export const HISTORY = [11, 11, 10, 10, 9, 8, 7, 6] as const;
/** Days from the first to the last day of the cycle. */
export const CYCLE_DAYS = 14;

export function cycleCounts(tasks: readonly CycleTask[]) {
  const done =
    EARLIER_DONE + tasks.filter((task) => task.status === "done").length;
  const started = tasks.filter((task) => task.status === "inProgress").length;
  const unstarted = tasks.filter((task) => task.status === "todo").length;
  const scope = done + started + unstarted;
  return {
    done,
    started,
    unstarted,
    scope,
    remaining: scope - done,
    percent: scope > 0 ? Math.round((done / scope) * 100) : 0,
  };
}

/** The burn-down series: the history, then today's remaining count. */
export function burnSeries(tasks: readonly CycleTask[]): number[] {
  return [...HISTORY, cycleCounts(tasks).remaining];
}

/** Completed and total points, counting the earlier tasks as 8 points. */
export function pointTotals(tasks: readonly CycleTask[]) {
  const earlier = 8;
  const total = earlier + tasks.reduce((sum, task) => sum + task.points, 0);
  const completed =
    earlier +
    tasks
      .filter((task) => task.status === "done")
      .reduce((sum, task) => sum + task.points, 0);
  return { completed, total };
}

export function cyclesReducer(
  state: CyclesState,
  action: CyclesAction,
): CyclesState {
  switch (action.type) {
    case "draw":
      return { ...state, drawn: true };
    case "openStatus":
      return {
        ...state,
        menuFor: state.menuFor === action.id ? null : action.id,
      };
    case "closeStatus":
      return { ...state, menuFor: null };
    case "setStatus":
      return {
        ...state,
        menuFor: null,
        tasks: state.tasks.map((task) =>
          task.id === action.id ? { ...task, status: action.status } : task,
        ),
      };
  }
}
