import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import useBuildWithAiStore from "@/store/build-with-ai";
import type { ProjectWithTasks } from "@/types/project";

/** True when the project has no tasks at all (open, planned or archived). */
export function isEmptyProject(project: ProjectWithTasks | undefined) {
  if (!project) return false;
  return (
    project.columns.every((column) => column.tasks.length === 0) &&
    (project.plannedTasks?.length ?? 0) === 0 &&
    (project.archivedTasks?.length ?? 0) === 0
  );
}

/**
 * A quiet offer above an empty board: describe the work and let AI draft
 * the tasks. Only for empty projects, with AI available and task:create.
 */
export default function BuildWithAiEmptyHint({
  project,
}: {
  project: ProjectWithTasks | undefined;
}) {
  const { t } = useTranslation();
  const projectId = project?.id ?? null;
  const { available } = useAiAvailability(projectId);
  const { canCreateTasks, isCheckingPermissions } = useWorkspacePermission();
  const openBuild = useBuildWithAiStore((state) => state.openBuild);

  if (
    !available ||
    isCheckingPermissions ||
    !canCreateTasks() ||
    !isEmptyProject(project)
  ) {
    return null;
  }

  return (
    <div className="mx-4 mt-3 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2">
      <Sparkles aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-muted-foreground text-sm">
        {t("ai:build.empty.text")}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => openBuild(projectId)}
      >
        {t("ai:build.command")}
      </Button>
    </div>
  );
}
