import { ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeleteTaskTemplate } from "@/hooks/mutations/task-template/use-delete-task-template";
import { useTaskTemplates } from "@/hooks/queries/task-template/use-task-templates";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import { toast } from "@/lib/toast";
import type { TaskTemplate } from "@/types/task-template";
import TaskTemplateDialog from "./task-template-dialog";

/**
 * Settings → Projects → Workflow → "Task templates": the project's
 * templates as a compact list. People who can edit the project manage them;
 * everyone else reads them.
 */
export default function TaskTemplates({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const { data, isPending, isError, refetch } = useTaskTemplates(
    workspaceId,
    projectId,
  );
  const { canUpdateProjects, isCheckingPermissions } = useWorkspacePermission();
  const canEdit = !isCheckingPermissions && canUpdateProjects();
  const { mutateAsync: remove } = useDeleteTaskTemplate();
  const [editing, setEditing] = useState<TaskTemplate | "new" | null>(null);
  const [deleting, setDeleting] = useState<TaskTemplate | null>(null);

  const confirmDelete = async () => {
    const target = deleting;
    if (!target) return;
    setDeleting(null);
    try {
      await remove({ workspaceId, projectId, id: target.id });
      toast.success(t("templates:settings.toast.deleted"));
    } catch {
      toast.error(t("templates:settings.toast.deleteError"));
    }
  };

  let body: React.ReactNode;
  if (isPending || !workspaceId) {
    body = (
      <div className="space-y-2">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  } else if (isError || !data) {
    body = (
      <div className="flex items-center gap-3 text-muted-foreground text-sm">
        <span>{t("templates:settings.loadError")}</span>
        <Button variant="outline" size="xs" onClick={() => refetch()}>
          {t("templates:settings.retry")}
        </Button>
      </div>
    );
  } else if (data.length === 0) {
    body = (
      <p className="text-muted-foreground text-sm">
        {t("templates:settings.empty")}
      </p>
    );
  } else {
    body = (
      <ul
        aria-label={t("templates:settings.title")}
        className="divide-y divide-border/80 rounded-md border border-border bg-card"
      >
        {data.map((template) => (
          <TemplateRow
            key={template.id}
            template={template}
            canEdit={canEdit}
            onEdit={() => setEditing(template)}
            onDelete={() => setDeleting(template)}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-3">
      {body}
      {canEdit ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!workspaceId}
          onClick={() => setEditing("new")}
        >
          <Plus aria-hidden />
          {t("templates:settings.add")}
        </Button>
      ) : (
        !isCheckingPermissions && (
          <p className="text-muted-foreground text-xs">
            {t("templates:settings.noPermission")}
          </p>
        )
      )}

      <TaskTemplateDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        workspaceId={workspaceId}
        projectId={projectId}
        template={editing === "new" ? null : editing}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("templates:settings.deleteTitle", {
                name: deleting?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("templates:settings.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button type="button" variant="outline" size="sm" />}
            >
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void confirmDelete()}
            >
              {t("templates:settings.deleteConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TemplateRow({
  template,
  canEdit,
  onEdit,
  onDelete,
}: {
  template: TaskTemplate;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const summary = [
    template.titlePattern,
    template.column?.name,
    template.subtasks.length > 0
      ? t("templates:settings.subtaskCount", {
          count: template.subtasks.length,
        })
      : null,
  ].filter(Boolean);

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium text-sm">{template.name}</span>
          {template.priority && template.priority !== "no-priority" && (
            <span
              className="shrink-0"
              role="img"
              aria-label={t(`tasks:priority.${template.priority as "low"}`)}
            >
              {getPriorityIcon(template.priority)}
            </span>
          )}
          {template.labels.map((label) => (
            <span
              key={label.id}
              className="hidden shrink-0 items-center gap-1 text-muted-foreground text-xs sm:inline-flex"
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: resolveLabelColor(label.color) }}
              />
              {label.name}
            </span>
          ))}
        </div>
        {summary.length > 0 && (
          <p className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
            {template.subtasks.length > 0 && (
              <ListChecks aria-hidden className="size-3 shrink-0" />
            )}
            <span className="truncate">{summary.join(" · ")}</span>
          </p>
        )}
      </div>
      {canEdit && (
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("templates:settings.editAria", {
              name: template.name,
            })}
            onClick={onEdit}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive-foreground"
            aria-label={t("templates:settings.deleteAria", {
              name: template.name,
            })}
            onClick={onDelete}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      )}
    </li>
  );
}
