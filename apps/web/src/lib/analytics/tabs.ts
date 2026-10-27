import {
  isProjectFeatureEnabled,
  type ProjectFeatureField,
} from "@/constants/project-features";

// The analytics page's tabs (B8 §1.2, §1.6): Overview only in workspace
// scope; Cycles, Modules and Intake only while a scope project has the
// feature on (Intake also needs intake:read); Delivery (forecast and risks)
// only in project scope.

export const ANALYTICS_TABS = [
  "overview",
  "tasks",
  "cycles",
  "modules",
  "intake",
  "delivery",
] as const;

export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];

export type AnalyticsScopeKind = "workspace" | "project";

export function isAnalyticsTab(value: unknown): value is AnalyticsTab {
  return (
    typeof value === "string" &&
    (ANALYTICS_TABS as readonly string[]).includes(value)
  );
}

export function defaultAnalyticsTab(kind: AnalyticsScopeKind): AnalyticsTab {
  return kind === "workspace" ? "overview" : "tasks";
}

type ProjectWithFlags = Partial<Record<ProjectFeatureField, boolean>>;

export function availableAnalyticsTabs(
  kind: AnalyticsScopeKind,
  projects: readonly ProjectWithFlags[],
  { canReadIntake }: { canReadIntake: boolean },
): AnalyticsTab[] {
  const any = (feature: "cycles" | "modules" | "intake") =>
    projects.some((project) => isProjectFeatureEnabled(project, feature));
  return ANALYTICS_TABS.filter((tab) => {
    switch (tab) {
      case "overview":
        return kind === "workspace";
      case "tasks":
        return true;
      case "cycles":
        return any("cycles");
      case "modules":
        return any("modules");
      case "intake":
        return canReadIntake && any("intake");
      case "delivery":
        return kind === "project";
    }
    return false;
  });
}

/** The tab to show: the requested one when available, else the default. */
export function resolveAnalyticsTab(
  requested: unknown,
  available: readonly AnalyticsTab[],
  kind: AnalyticsScopeKind,
): AnalyticsTab {
  if (isAnalyticsTab(requested) && available.includes(requested)) {
    return requested;
  }
  return defaultAnalyticsTab(kind);
}
