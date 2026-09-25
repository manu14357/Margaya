import type { TaskCommand } from "@/components/task/task-shortcuts/open-task-store";

export type TaskGroupItem = {
  value: string;
  label: string;
  shortcut?: string;
  /**
   * Runs only once the palette has fully closed: a picker opened earlier
   * is closed again when the palette hands focus back.
   */
  afterClose?: boolean;
  onRun: () => void;
};

/**
 * The palette rows of the open task's commands. A command that cannot run
 * right now (its picker is not on screen) is left out.
 */
export function openTaskGroupItems(
  commands: readonly TaskCommand[],
): TaskGroupItem[] {
  return commands
    .filter((command) => !command.isAvailable || command.isAvailable())
    .map((command) => ({
      value: `task-command:${command.id}`,
      label: command.label,
      shortcut: command.keys?.join(" "),
      afterClose: command.picker === true,
      onRun: command.run,
    }));
}
