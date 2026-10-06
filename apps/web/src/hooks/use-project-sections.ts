import { useLocation } from "@tanstack/react-router";
import { useMemo } from "react";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  getVisibleProjectSections,
  type ProjectSectionId,
  resolveActiveSection,
  shouldShowSectionStrip,
} from "@/lib/project-sections";

/**
 * The sections a project shows, the active one, and whether the strip is
 * worth rendering. Nothing shows until the project has loaded, so plain
 * projects never flash a strip.
 */
export function useProjectSections({
  projectId,
  workspaceId,
  activeSection,
}: {
  projectId: string;
  workspaceId: string;
  activeSection?: ProjectSectionId;
}) {
  const location = useLocation();
  const { isEnabled, project } = useProjectFeatures({
    projectId,
    workspaceId,
  });
  const { canReadAnalytics, isCheckingPermissions } = useWorkspacePermission();
  // Capability-gated sections wait for the permission check, so they never
  // flash in and out.
  const canReadAnalyticsNow = !isCheckingPermissions && canReadAnalytics();

  const sections = useMemo(
    () =>
      project
        ? getVisibleProjectSections(
            isEnabled,
            undefined,
            (capability) =>
              capability === "readAnalytics" && canReadAnalyticsNow,
          )
        : [],
    [project, isEnabled, canReadAnalyticsNow],
  );

  return {
    sections,
    showStrip: shouldShowSectionStrip(sections),
    activeSection: activeSection ?? resolveActiveSection(location.pathname),
  };
}
