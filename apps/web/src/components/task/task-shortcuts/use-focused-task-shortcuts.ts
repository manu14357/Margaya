import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import { useUpdateTaskAssignees } from "@/hooks/mutations/task/use-update-task-assignees";
import { useActiveShortcutPrefix } from "@/hooks/use-keyboard-shortcuts";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { copyTaskKey, copyTaskLink } from "@/lib/copy-task-reference";
import { generateLink } from "@/lib/generate-link";
import { taskKeyPath, taskUrl } from "@/lib/task-key";
import { toast } from "@/lib/toast";
import useBulkSelectionStore from "@/store/bulk-selection";
import {
  resolveTaskShortcut,
  shouldHandleTaskShortcut,
  TASK_SURFACE_ATTRIBUTE,
} from "./task-shortcut-keys";

/** What the focused row knows about its task. */
export type FocusedTask = {
  taskId: string;
  projectId: string;
  workspaceId: string;
  /** WEB-12, when the row knows it. */
  key: string | null;
  assigneeIds: readonly string[];
};

/**
 * The open-task keys that need no picker (`i`, copy key, copy link), for
 * the focused row of the list or spreadsheet. The pickers stay the row's
 * own triage keys; with a task open in the sheet, the sheet takes the keys.
 */
export function useFocusedTaskShortcuts(
  resolve: (taskId: string) => FocusedTask | null,
) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const activePrefix = useActiveShortcutPrefix();
  const { canAssignTasks, isCheckingPermissions } = useWorkspacePermission();
  const canAssign = !isCheckingPermissions && canAssignTasks();
  const { mutateAsync: updateAssignees } = useUpdateTaskAssignees();
  const state = useRef({ resolve, activePrefix, canAssign, userId: user?.id });
  state.current = { resolve, activePrefix, canAssign, userId: user?.id };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveTaskShortcut(event);
      if (
        action !== "assignSelf" &&
        action !== "copyKey" &&
        action !== "copyLink"
      ) {
        return;
      }
      if (document.querySelector(`[${TASK_SURFACE_ATTRIBUTE}]`)) return;
      const current = state.current;
      if (
        !shouldHandleTaskShortcut(event, {
          activePrefix: current.activePrefix,
        })
      ) {
        return;
      }
      const focusedId = useBulkSelectionStore.getState().focusedTaskId;
      const task = focusedId ? current.resolve(focusedId) : null;
      if (!task) return;

      if (action === "copyKey") {
        if (!task.key) return;
        event.preventDefault();
        void copyTaskKey(task.key, t);
        return;
      }
      if (action === "copyLink") {
        event.preventDefault();
        void copyTaskLink(
          task.key
            ? generateLink(taskKeyPath(task.workspaceId, task.key))
            : taskUrl(task),
          t,
        );
        return;
      }

      const userId = current.userId;
      if (!current.canAssign || !userId) return;
      event.preventDefault();
      const assigned = task.assigneeIds.includes(userId);
      void updateAssignees({
        taskId: task.taskId,
        projectId: task.projectId,
        workspaceId: task.workspaceId,
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
      );
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [t, updateAssignees]);
}
