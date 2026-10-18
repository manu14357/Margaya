import { LayoutTemplate } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApplyTaskTemplate } from "@/hooks/mutations/task-template/use-apply-task-template";
import { useTaskTemplates } from "@/hooks/queries/task-template/use-task-templates";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { patternMakesTitle } from "@/lib/task-template";
import { toast } from "@/lib/toast";
import TemplateMenu from "./template-menu";

/**
 * The quick add's template menu: creates the typed title from a template,
 * in the bar's column, on the server. Renders nothing while the project
 * has no templates.
 */
export default function CaptureTemplateButton({
  projectId,
  workspaceId,
  status,
  title,
  onCreated,
  onOpenChange,
}: {
  projectId: string;
  workspaceId: string;
  /** The column slug the bar creates in. */
  status: string;
  /** The typed title (without capture tokens). */
  title: string;
  onCreated: (task: { id: string; projectId: string }) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data: templates } = useTaskTemplates(workspaceId, projectId);
  const { canUpdateTasks } = useWorkspacePermission();
  const { mutateAsync: apply, isPending } = useApplyTaskTemplate();
  if (!templates || templates.length === 0) return null;

  // Sub-tasks are linked under the task, which needs task:update.
  const canLinkSubtasks = canUpdateTasks();

  return (
    <TemplateMenu
      templates={templates}
      align="end"
      onOpenChange={onOpenChange}
      isDisabled={(template) =>
        (!title.trim() && !patternMakesTitle(template.titlePattern)) ||
        (template.subtasks.length > 0 && !canLinkSubtasks)
      }
      onPick={async (template) => {
        try {
          const task = await apply({
            templateId: template.id,
            projectId,
            workspaceId,
            input: { title: title.trim() || undefined, status },
          });
          onCreated({ id: task.id, projectId });
        } catch (error) {
          toast.error(
            error instanceof Error && error.message
              ? error.message
              : t("common:modals.createTask.createError"),
          );
        }
      }}
      trigger={
        <button
          type="button"
          disabled={isPending}
          aria-label={t("templates:use.quickAdd")}
          title={t("templates:use.quickAdd")}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <LayoutTemplate className="size-3.5" />
        </button>
      }
    />
  );
}
