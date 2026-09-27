import { create } from "zustand";

export type TaskCommandId =
  | "status"
  | "priority"
  | "assignees"
  | "labels"
  | "dueDate"
  | "estimate"
  | "cycle"
  | "module"
  | "assignSelf"
  | "subscribe"
  | "copyKey"
  | "copyTitle"
  | "copyLink"
  | "copyBranch"
  | "archive"
  | "delete";

/** One thing that can be done to the open task, from a key or the palette. */
export type TaskCommand = {
  id: TaskCommandId;
  label: string;
  /** Keys shown next to it, e.g. ["s"] or ["Ctrl", "."]. */
  keys?: readonly string[];
  /** Opens a picker: the palette lets itself close first. */
  picker?: boolean;
  /** Checked when the palette opens: false hides the command. */
  isAvailable?: () => boolean;
  run: () => void;
};

type OpenTaskState = {
  /** The open task (sheet or page) that owns `commands`. */
  taskId: string | null;
  /** Its key and title, for the palette's group label. */
  title: string | null;
  commands: readonly TaskCommand[];
  publish: (entry: {
    taskId: string;
    title: string | null;
    commands: readonly TaskCommand[];
  }) => void;
  /** Clears the entry, unless another task has taken over since. */
  clear: (taskId: string) => void;
};

/**
 * The open task's commands, published by the sheet or the task page while
 * it is open, so the command palette can offer a "This task" group.
 */
const useOpenTaskStore = create<OpenTaskState>()((set, get) => ({
  taskId: null,
  title: null,
  commands: [],
  publish: ({ taskId, title, commands }) => set({ taskId, title, commands }),
  clear: (taskId) => {
    if (get().taskId !== taskId) return;
    set({ taskId: null, title: null, commands: [] });
  },
}));

export default useOpenTaskStore;
