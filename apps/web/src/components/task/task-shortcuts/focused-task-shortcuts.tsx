import {
  type FocusedTask,
  useFocusedTaskShortcuts,
} from "./use-focused-task-shortcuts";

/** Mounts the focused row's task keys (see useFocusedTaskShortcuts). */
export default function FocusedTaskShortcuts({
  resolve,
}: {
  resolve: (taskId: string) => FocusedTask | null;
}) {
  useFocusedTaskShortcuts(resolve);
  return null;
}
