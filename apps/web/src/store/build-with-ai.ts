import { create } from "zustand";

// Opens "Build with AI" from anywhere (command palette, an empty project).
// One dialog is mounted by the command palette and reads this store.

type BuildWithAiState = {
  open: boolean;
  /** Build into this project; null proposes a new project. */
  projectId: string | null;
  openBuild: (projectId?: string | null) => void;
  close: () => void;
};

const useBuildWithAiStore = create<BuildWithAiState>((set) => ({
  open: false,
  projectId: null,
  openBuild: (projectId) => set({ open: true, projectId: projectId ?? null }),
  close: () => set({ open: false }),
}));

export default useBuildWithAiStore;
