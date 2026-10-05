import { useNavigate } from "@tanstack/react-router";
import { Archive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useArchiveProject } from "@/hooks/mutations/project/use-archive-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";

type ProjectArchivedNoticeProps = {
  project:
    | { id: string; workspaceId: string; archivedAt?: string | null }
    | null
    | undefined;
};

/** The strip under an archived project's header: Restore, View in Archives. */
export default function ProjectArchivedNotice({
  project,
}: ProjectArchivedNoticeProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canUpdateProjects, isCheckingPermissions } = useWorkspacePermission();
  const archiveProject = useArchiveProject();

  if (!project?.archivedAt) return null;
  const canRestore = !isCheckingPermissions && canUpdateProjects();

  const restore = () =>
    archiveProject.mutate(
      {
        projectId: project.id,
        workspaceId: project.workspaceId,
        archive: false,
      },
      {
        onSuccess: () => toast.success(t("common:projectArchived.restored")),
        onError: () => toast.error(t("workspace:archives.toast.restoreError")),
      },
    );

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-border/80 border-b bg-muted/60 px-4 py-1.5 text-muted-foreground text-xs"
    >
      <Archive className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        {t("common:projectArchived.message")}
      </span>
      <div className="flex items-center gap-1">
        {canRestore && (
          <Button
            variant="outline"
            size="xs"
            loading={archiveProject.isPending}
            onClick={restore}
          >
            {t("common:projectArchived.restore")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            navigate({
              to: "/dashboard/workspace/$workspaceId/archives",
              params: { workspaceId: project.workspaceId },
              search: { tab: "projects" },
            })
          }
        >
          {t("common:projectArchived.viewInArchives")}
        </Button>
      </div>
    </div>
  );
}
