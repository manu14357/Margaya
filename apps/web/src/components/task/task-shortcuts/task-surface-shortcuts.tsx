import { useEffect, useRef } from "react";
import { useActiveShortcutPrefix } from "@/hooks/use-keyboard-shortcuts";
import useOpenTaskStore, {
  type TaskCommand,
  type TaskCommandId,
} from "./open-task-store";
import {
  resolveTaskShortcut,
  shouldHandleTaskShortcut,
  type TaskShortcutAction,
} from "./task-shortcut-keys";
import { useTaskCommands } from "./use-task-commands";

const COMMAND_OF: Record<TaskShortcutAction, TaskCommandId> = {
  status: "status",
  priority: "priority",
  assignees: "assignees",
  labels: "labels",
  dueDate: "dueDate",
  assignSelf: "assignSelf",
  copyKey: "copyKey",
  copyLink: "copyLink",
  copyBranch: "copyBranch",
  delete: "delete",
};

/**
 * The command a key press runs on the open task, or null when the key is
 * not a task shortcut, the user may not do it, or it cannot run now.
 */
export function taskCommandForKey(
  event: KeyboardEvent,
  commands: readonly TaskCommand[],
  activePrefix: string | null,
): TaskCommand | null {
  const action = resolveTaskShortcut(event);
  if (!action) return null;
  if (!shouldHandleTaskShortcut(event, { activePrefix })) return null;
  // Commands exist only when permitted (see useTaskCommands).
  const command = commands.find((entry) => entry.id === COMMAND_OF[action]);
  if (!command || (command.isAvailable && !command.isAvailable())) return null;
  return command;
}

type TaskSurfaceShortcutsProps = {
  taskId: string | undefined;
  projectId: string;
  workspaceId: string;
};

/**
 * Mounted by the task sheet and the task page: the open task's keys
 * (s, p, a, l, d, i and the Ctrl/⌘ chords), and its commands for the
 * palette's "This task" group. Renders nothing.
 */
export default function TaskSurfaceShortcuts({
  taskId,
  projectId,
  workspaceId,
}: TaskSurfaceShortcutsProps) {
  const { commands, title } = useTaskCommands({
    taskId,
    projectId,
    workspaceId,
  });
  const activePrefix = useActiveShortcutPrefix();
  const state = useRef({ commands, activePrefix });
  state.current = { commands, activePrefix };

  useEffect(() => {
    if (!taskId) return;
    useOpenTaskStore.getState().publish({ taskId, title, commands });
  }, [taskId, title, commands]);

  useEffect(() => {
    if (!taskId) return;
    return () => useOpenTaskStore.getState().clear(taskId);
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    // Capture phase, ahead of the app-wide single keys: `p` here opens the
    // priority picker instead of starting the `p …` project sequence.
    const onKeyDown = (event: KeyboardEvent) => {
      const command = taskCommandForKey(
        event,
        state.current.commands,
        state.current.activePrefix,
      );
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      command.run();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [taskId]);

  return null;
}
