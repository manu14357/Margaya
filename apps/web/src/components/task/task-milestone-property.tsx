import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { useUpdateTaskMilestone } from "@/hooks/mutations/task/use-update-task-milestone";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";

type TaskMilestonePropertyProps = {
  task: { id: string; projectId: string; isMilestone?: boolean };
};

/** Marks a task as a milestone, which the timeline draws as one date. */
export default function TaskMilestoneProperty({
  task,
}: TaskMilestonePropertyProps): JSX.Element {
  const { t } = useTranslation();
  const { canUpdateTasks } = useWorkspacePermission();
  const updateMilestone = useUpdateTaskMilestone();

  return (
    <div className="flex min-h-7 items-center pl-1.5">
      <Switch
        aria-label={t("tasks:milestone.label")}
        title={t("tasks:milestone.hint")}
        checked={Boolean(task.isMilestone)}
        disabled={!canUpdateTasks()}
        onCheckedChange={(isMilestone) =>
          updateMilestone.mutate(
            { taskId: task.id, projectId: task.projectId, isMilestone },
            { onError: () => toast.error(t("tasks:milestone.updateError")) },
          )
        }
      />
    </div>
  );
}
