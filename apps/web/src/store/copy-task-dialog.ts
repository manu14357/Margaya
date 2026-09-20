import { create } from "zustand";

export type CopyTaskTarget = {
  taskId: string;
  projectId: string;
  workspaceId: string;
};

/**
 * The task "Make a copy" was asked for. One host renders the dialog, so it
 * outlives the context menu or actions menu that opened it.
 */
const useCopyTaskDialog = create<{
  target: CopyTaskTarget | null;
  open: (target: CopyTaskTarget) => void;
  close: () => void;
}>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));

export default useCopyTaskDialog;
