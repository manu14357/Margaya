import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import { shortcuts } from "@/constants/shortcuts";
import useToggleTaskSubscription from "@/hooks/mutations/subscription/use-toggle-task-subscription";
import { useArchiveTask } from "@/hooks/mutations/task/use-archive-task";
import { useUpdateTaskAssignees } from "@/hooks/mutations/task/use-update-task-assignees";
import useGetGiteaIntegration from "@/hooks/queries/gitea-integration/use-get-gitea-integration";
import useGetGithubIntegration from "@/hooks/queries/github-integration/use-get-github-integration";
import useTaskSubscription from "@/hooks/queries/subscription/use-task-subscription";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { copyTaskKey, copyTaskLink } from "@/lib/copy-task-reference";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { assigneesOfTask } from "@/lib/task-assignees";
import {
  copyTaskBranch,
  DEFAULT_BRANCH_PATTERN,
  taskBranchName,
} from "@/lib/task-branch";
import { formatTaskKey, shareableTaskUrl } from "@/lib/task-key";
import { toast } from "@/lib/toast";
import {
  hasTaskDelete,
  hasTaskPicker,
  openTaskDelete,
  openTaskPicker,
  type TaskPickerProperty,
} from "./open-task-property";
import type { TaskCommand } from "./open-task-store";

type Options = {
  taskId: string | undefined;
  /** The project the task is shown in; the task's own project wins. */
  projectId: string;
  workspaceId: string;
};

const keys = shortcuts.taskDetails;

/**
 * Everything the open task offers to keys and the palette, already filtered
 * by permissions and project features. Pickers open the property grid's own
 * popovers; the rest run the same mutations as the sheet's buttons.
 */
export function useTaskCommands({ taskId, projectId, workspaceId }: Options): {
  commands: TaskCommand[];
  title: string | null;
} {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: loaded } = useGetTask(taskId ?? "");
  const task = loaded && loaded.id === taskId ? loaded : undefined;
  const ownProjectId = task?.projectId ?? projectId;
  const { project, isEnabled } = useProjectFeatures({
    projectId: ownProjectId,
    workspaceId,
  });
  const permissions = useWorkspacePermission();
  const ready = !permissions.isCheckingPermissions;
  const canUpdate = ready && permissions.canUpdateTasks();
  const canAssign = ready && permissions.canAssignTasks();
  const canLabel = ready && permissions.canUpdateLabels();
  const canCycle = ready && permissions.canUpdateCycles();
  const canModule = ready && permissions.canUpdateModules();
  const canDelete = ready && permissions.canDeleteTasks();
  const { data: subscription } = useTaskSubscription(taskId);
  const { mutate: toggleSubscription } = useToggleTaskSubscription(
    taskId ?? "",
  );
  const { mutateAsync: setArchived } = useArchiveTask();
  const { mutateAsync: updateAssignees } = useUpdateTaskAssignees();
  const { data: githubIntegration } = useGetGithubIntegration(ownProjectId);
  const { data: giteaIntegration } = useGetGiteaIntegration(ownProjectId);
  const branchPattern =
    githubIntegration?.branchPattern ||
    giteaIntegration?.branchPattern ||
    DEFAULT_BRANCH_PATTERN;

  const slug = project?.id === ownProjectId ? project.slug : undefined;
  const key =
    slug && task?.number != null ? formatTaskKey(slug, task.number) : null;

  const commands = useMemo<TaskCommand[]>(() => {
    if (!task || !taskId) return [];
    const can = {
      update: canUpdate,
      assign: canAssign,
      labels: canLabel,
      cycles: canCycle,
      modules: canModule,
      delete: canDelete,
    };
    const mod = keys.modifier;
    const list: TaskCommand[] = [];

    const picker = (
      id: TaskPickerProperty,
      label: string,
      allowed: boolean,
      shortcutKeys?: readonly string[],
    ) => {
      if (!allowed) return;
      list.push({
        id,
        label,
        keys: shortcutKeys,
        picker: true,
        isAvailable: () => hasTaskPicker(id),
        run: () => void openTaskPicker(id),
      });
    };

    picker("status", t("tasks:commands.status"), can.update, [keys.status]);
    picker("priority", t("tasks:commands.priority"), can.update, [
      keys.priority,
    ]);
    picker("assignees", t("tasks:commands.assignees"), can.assign, [
      keys.assignee,
    ]);
    picker("labels", t("tasks:commands.labels"), can.labels, [keys.labels]);
    picker("dueDate", t("tasks:commands.dueDate"), can.update, [keys.dueDate]);
    picker(
      "estimate",
      t("tasks:commands.estimate"),
      can.update && isEnabled("estimates"),
    );
    picker(
      "cycle",
      t("tasks:commands.cycle"),
      can.cycles && isEnabled("cycles"),
    );
    picker(
      "module",
      t("tasks:commands.module"),
      can.modules && isEnabled("modules"),
    );

    if (can.assign && user?.id) {
      const userId = user.id;
      const assigned = assigneesOfTask(task).includes(userId);
      list.push({
        id: "assignSelf",
        label: assigned
          ? t("tasks:commands.unassignSelf")
          : t("tasks:commands.assignSelf"),
        keys: [keys.assignSelf],
        run: () =>
          void updateAssignees({
            taskId,
            projectId: ownProjectId,
            workspaceId,
            ...(assigned ? { remove: [userId] } : { add: [userId] }),
          }).then(
            () =>
              toast.success(
                assigned
                  ? t("tasks:commands.unassignedSelf")
                  : t("tasks:commands.assignedSelf"),
              ),
            (error: unknown) =>
              toast.error(
                error instanceof Error && error.message
                  ? error.message
                  : t("tasks:assignees.updateError"),
              ),
          ),
      });
    }

    if (subscription) {
      list.push({
        id: "subscribe",
        label: subscription.subscribed
          ? t("tasks:subscription.unsubscribe")
          : t("tasks:subscription.subscribe"),
        run: () => toggleSubscription(!subscription.subscribed),
      });
    }

    if (key) {
      list.push({
        id: "copyKey",
        label: t("tasks:actions.copyKey"),
        keys: [mod, keys.copyKey],
        run: () => void copyTaskKey(key, t),
      });
    }
    list.push({
      id: "copyTitle",
      label: t("tasks:commands.copyTitle"),
      run: () =>
        void copyToClipboard(task.title).then((copied) =>
          copied
            ? toast.success(t("tasks:commands.titleCopied"))
            : toast.error(t("tasks:taskKey.clipboardError")),
        ),
    });
    list.push({
      id: "copyLink",
      label: t("tasks:actions.copyLink"),
      keys: [mod, "Shift", keys.copyLink],
      run: () =>
        void copyTaskLink(
          shareableTaskUrl({
            workspaceId,
            projectId: ownProjectId,
            taskId,
            slug,
            number: task.number,
          }),
          t,
        ),
    });
    const branch = taskBranchName(branchPattern, slug, task.number, task.title);
    if (branch) {
      list.push({
        id: "copyBranch",
        label: t("tasks:properties.copyTaskBranch"),
        keys: [mod, "Shift", keys.copyBranch],
        run: () => void copyTaskBranch(branch, t),
      });
    }

    if (can.update) {
      const archived = Boolean(task.archivedAt);
      list.push({
        id: "archive",
        label: archived
          ? t("tasks:archive.restore")
          : t("tasks:actions.archive"),
        run: () =>
          void setArchived({
            taskId,
            projectId: ownProjectId,
            archived: !archived,
          }).then(
            () =>
              toast.success(
                t(
                  archived
                    ? "tasks:archive.restored"
                    : "tasks:archive.archived",
                ),
              ),
            (error: unknown) =>
              toast.error(
                error instanceof Error && error.message
                  ? error.message
                  : t(
                      archived
                        ? "tasks:archive.restoreError"
                        : "tasks:archive.error",
                    ),
              ),
          ),
      });
    }

    if (can.delete) {
      list.push({
        id: "delete",
        label: t("tasks:delete.action"),
        keys: [mod, keys.delete],
        picker: true,
        isAvailable: hasTaskDelete,
        run: () => void openTaskDelete(),
      });
    }

    return list;
  }, [
    task,
    taskId,
    canUpdate,
    canAssign,
    canLabel,
    canCycle,
    canModule,
    canDelete,
    t,
    isEnabled,
    user?.id,
    updateAssignees,
    ownProjectId,
    workspaceId,
    subscription,
    toggleSubscription,
    key,
    slug,
    branchPattern,
    setArchived,
  ]);

  const title = task ? [key, task.title].filter(Boolean).join(" ") : null;
  return { commands, title };
}
