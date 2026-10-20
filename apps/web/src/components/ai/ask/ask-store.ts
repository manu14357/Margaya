import { create } from "zustand";

/**
 * Opens the one mounted Ask panel (routes/_layout.tsx) from the command
 * palette, the top bar and Ctrl/⌘ J. `projectId` scopes answers to the
 * project Ask was opened in; `question` is asked right away when given.
 * Each request carries a fresh id so asking the same thing twice runs
 * twice. `slot` is the full-page AI route's container: while it is
 * mounted the same panel (and conversation) renders there at full width;
 * `returnTo` is the page it was opened from, where closing it goes back to.
 */
type AskPanelState = {
  open: boolean;
  projectId: string | null;
  request: { id: number; question: string } | null;
  slot: HTMLElement | null;
  returnTo: string | null;
  openAsk: (options?: { projectId?: string | null; question?: string }) => void;
  setOpen: (open: boolean) => void;
  setProjectId: (projectId: string | null) => void;
  setSlot: (slot: HTMLElement | null) => void;
  setReturnTo: (returnTo: string | null) => void;
};

let nextId = 0;

export const useAskPanel = create<AskPanelState>((set) => ({
  open: false,
  projectId: null,
  request: null,
  slot: null,
  returnTo: null,
  openAsk: (options = {}) => {
    const question = options.question?.trim() ?? "";
    nextId += 1;
    set({
      open: true,
      projectId: options.projectId ?? null,
      request: question ? { id: nextId, question } : null,
    });
  },
  setOpen: (open) => set({ open }),
  setProjectId: (projectId) => set({ projectId }),
  setSlot: (slot) => set({ slot }),
  setReturnTo: (returnTo) => set({ returnTo }),
}));

export function openAsk(options?: {
  projectId?: string | null;
  question?: string;
}) {
  useAskPanel.getState().openAsk(options);
}

/** Ctrl/⌘ J: opens the docked chat, or closes it when it is open. */
export function toggleAsk(projectId: string | null) {
  const state = useAskPanel.getState();
  if (state.open) state.setOpen(false);
  else state.openAsk({ projectId });
}
