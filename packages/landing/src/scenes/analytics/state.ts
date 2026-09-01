export type AnalyticsDimension = "status" | "priority" | "assignee" | "label";

export const DIMENSIONS: readonly AnalyticsDimension[] = [
  "status",
  "priority",
  "assignee",
  "label",
];

export type AnalyticsState = {
  xAxis: AnalyticsDimension;
  menuOpen: boolean;
  /**
   * False right after the x-axis changes: the bars render flat, then grow
   * on the next frame, so the change reads as the chart rebuilding.
   */
  grown: boolean;
};

export type AnalyticsAction =
  | { type: "openMenu" }
  | { type: "closeMenu" }
  | { type: "select"; xAxis: AnalyticsDimension }
  | { type: "grow" };

export const initialAnalyticsState: AnalyticsState = {
  xAxis: "priority",
  menuOpen: false,
  grown: true,
};

export function analyticsReducer(
  state: AnalyticsState,
  action: AnalyticsAction,
): AnalyticsState {
  switch (action.type) {
    case "openMenu":
      return { ...state, menuOpen: true };
    case "closeMenu":
      return { ...state, menuOpen: false };
    case "select":
      if (action.xAxis === state.xAxis) return { ...state, menuOpen: false };
      return { xAxis: action.xAxis, menuOpen: false, grown: false };
    case "grow":
      return { ...state, grown: true };
  }
}

/** The task counts behind each grouping (46 tasks; labels can repeat). */
export const ANALYTICS_DATA: Record<
  AnalyticsDimension,
  readonly { key: string; value: number }[]
> = {
  status: [
    { key: "backlog", value: 6 },
    { key: "todo", value: 11 },
    { key: "inProgress", value: 8 },
    { key: "inReview", value: 4 },
    { key: "done", value: 17 },
  ],
  priority: [
    { key: "urgent", value: 3 },
    { key: "high", value: 9 },
    { key: "medium", value: 14 },
    { key: "low", value: 12 },
    { key: "none", value: 8 },
  ],
  assignee: [
    { key: "adam", value: 12 },
    { key: "mira", value: 10 },
    { key: "jonas", value: 9 },
    { key: "priya", value: 8 },
    { key: "sam", value: 7 },
  ],
  label: [
    { key: "feature", value: 14 },
    { key: "bug", value: 9 },
    { key: "design", value: 8 },
    { key: "docs", value: 6 },
  ],
};

export function totalOf(xAxis: AnalyticsDimension) {
  return ANALYTICS_DATA[xAxis].reduce((sum, entry) => sum + entry.value, 0);
}
