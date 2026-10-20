// Stakeholder briefs (ai-brief/): what a brief was computed from, kept so
// the next brief of the same scope can show what changed since.

export const BRIEF_SCOPE_TYPES = ["cycle", "module", "project"] as const;
export type BriefScopeType = (typeof BRIEF_SCOPE_TYPES)[number];

export const BRIEF_AUDIENCES = ["team", "leadership", "client"] as const;
export type BriefAudience = (typeof BRIEF_AUDIENCES)[number];

/** One letter per task group: b(acklog) u(nstarted) s(tarted) d(one) c(ancelled). */
export type BriefTaskState = "b" | "u" | "s" | "d" | "c";

export type BriefSnapshot = {
  /** Scope tasks by id (at most the facts' task limit). */
  tasks: Record<string, BriefTaskState>;
  /** Percent of the non-cancelled scope that is completed. */
  percent: number;
  /** The forecast's 85th percentile date, when there was one. */
  forecastP85: string | null;
  /** Open risk signals by kind. */
  risks: Record<string, number>;
};
