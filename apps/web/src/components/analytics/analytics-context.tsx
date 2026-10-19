import { createContext, type ReactNode, useContext } from "react";
import type { Project } from "@/types/project";

export type AnalyticsScopeProject = Pick<
  Project,
  | "id"
  | "name"
  | "slug"
  | "icon"
  | "cyclesEnabled"
  | "modulesEnabled"
  | "intakeEnabled"
  | "estimatesEnabled"
>;

/** Where an analytics page runs; every section reads it. */
export type AnalyticsScope = {
  kind: "workspace" | "project";
  workspaceId: string;
  /** Project scope: the project. */
  projectId?: string;
  /**
   * The ids sent to the API; undefined means every non-archived project
   * of the workspace.
   */
  projectIds?: string[];
  /** Query and storage key of the scope (lib/analytics/scope-key). */
  scopeKey: string;
  /** The projects in scope, with their feature flags. */
  projects: AnalyticsScopeProject[];
  /** The workspace or project slug, for export file names. */
  slug: string;
  /** Workspace scope: every project the project selector offers. */
  selectableProjects?: AnalyticsScopeProject[];
  /** Workspace scope: changes the project selection ([] for all). */
  setProjectIds?: (ids: string[]) => void;
};

const AnalyticsScopeContext = createContext<AnalyticsScope | null>(null);

export function AnalyticsScopeProvider({
  value,
  children,
}: {
  value: AnalyticsScope;
  children: ReactNode;
}) {
  return (
    <AnalyticsScopeContext.Provider value={value}>
      {children}
    </AnalyticsScopeContext.Provider>
  );
}

export function useAnalyticsScope(): AnalyticsScope {
  const scope = useContext(AnalyticsScopeContext);
  if (!scope) throw new Error("useAnalyticsScope needs AnalyticsScopeProvider");
  return scope;
}
