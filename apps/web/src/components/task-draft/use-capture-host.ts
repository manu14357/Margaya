import { useEffect } from "react";
import { registerTaskCapture } from "@/components/command-palette/palette-store";
import { shortcuts } from "@/constants/shortcuts";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getEntryColumn } from "@/lib/column-groups";
import type { ProjectWithTasks } from "@/types/project";
import { focusCapture } from "./capture-store";

/**
 * Makes a board or list the target of "create task": `c` and the shell's
 * Create button focus the capture bar of the project's entry column.
 */
export function useCaptureHost(project: ProjectWithTasks | undefined) {
  const { canCreateTasks } = useWorkspacePermission();
  const canCreate = canCreateTasks();
  const entry = project
    ? (getEntryColumn(project.columns) ?? project.columns[0])
    : undefined;
  const projectId = project?.id;
  const status = entry?.slug;
  const enabled = Boolean(canCreate && projectId && status);

  useEffect(() => {
    if (!enabled || !projectId || !status) return;
    return registerTaskCapture(() => focusCapture(projectId, status));
  }, [enabled, projectId, status]);

  useRegisterShortcuts({
    shortcuts:
      enabled && projectId && status
        ? {
            [shortcuts.capture.open]: () => focusCapture(projectId, status),
          }
        : {},
  });
}
