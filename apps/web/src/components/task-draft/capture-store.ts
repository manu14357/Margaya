import { create } from "zustand";

/**
 * Focus requests for the capture bars on a board or list. `C`, the shell's
 * Create button (requestCreate("task")) and a collapsed list group ask for a
 * project's column; the bar that matches focuses itself. Each request has a
 * fresh id so repeating one re-focuses.
 */
type CaptureFocusRequest = { id: number; projectId: string; status: string };

type CaptureFocusState = {
  request: CaptureFocusRequest | null;
  focus: (projectId: string, status: string) => void;
};

let nextId = 0;

const useCaptureFocus = create<CaptureFocusState>((set) => ({
  request: null,
  focus: (projectId, status) => {
    nextId += 1;
    set({ request: { id: nextId, projectId, status } });
  },
}));

export default useCaptureFocus;

export function focusCapture(projectId: string, status: string) {
  useCaptureFocus.getState().focus(projectId, status);
}
