// Project status updates (project-update/): shared vocabulary, also used by
// the database schema for the `health` and `facts` columns.

export const PROJECT_UPDATE_HEALTHS = [
  "on_track",
  "at_risk",
  "off_track",
] as const;
export type ProjectUpdateHealth = (typeof PROJECT_UPDATE_HEALTHS)[number];

export type ProjectUpdateTaskRef = {
  id: string;
  /** e.g. "WEB-12". */
  key: string;
  title: string;
};

export type ProjectUpdateTaskList = {
  total: number;
  /** The first few, for links; `total` counts all of them. */
  tasks: ProjectUpdateTaskRef[];
};

export type ProjectUpdateCycleFact = {
  id: string;
  name: string;
  /** YYYY-MM-DD. */
  endDate: string;
  total: number;
  completed: number;
  percent: number;
};

export type ProjectUpdateRiskFact = {
  kind: string;
  severity: "high" | "medium" | "low";
  total: number;
};

/**
 * The numbers an update was drafted from, computed by the server and kept
 * with the posted update. A model never writes these.
 */
export type ProjectUpdateFacts = {
  generatedAt: string;
  /** Changes are counted from here: the last update, or 7 days back. */
  since: string;
  sinceLastUpdate: boolean;
  counts: {
    total: number;
    open: number;
    completed: number;
    /** Completed share of the tasks that are not cancelled. */
    percent: number;
  };
  completed: ProjectUpdateTaskList;
  /** Tasks whose status changed since `since` (any column move). */
  moved: { total: number };
  added: { total: number };
  overdue: ProjectUpdateTaskList;
  blocked: ProjectUpdateTaskList;
  inProgress: ProjectUpdateTaskList;
  cycles: ProjectUpdateCycleFact[];
  risks: ProjectUpdateRiskFact[];
  /** The delivery forecast's 85% date, when there is one. */
  forecastP85: string | null;
  /** A rule-based health from the numbers above, for the draft. */
  suggestedHealth: ProjectUpdateHealth;
  /** Only the first tasks were read. */
  truncated: boolean;
};

export type ProjectUpdateDraft = {
  health: ProjectUpdateHealth;
  summary: string;
  highlights: string | null;
  blockers: string | null;
  nextSteps: string | null;
};
