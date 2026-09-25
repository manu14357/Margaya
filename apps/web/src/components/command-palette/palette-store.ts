import { create } from "zustand";

export type PaletteCreateKind = "task" | "project" | "workspace";

/**
 * Requests to the one mounted CommandPalette (routes/_layout.tsx) from the
 * shell: the top bar's command field, the rail's Create menu and the mobile
 * tab bar. Each request carries a fresh id so repeating one re-triggers it;
 * the palette keeps its own open state, so nothing leaks between mounts.
 */
type PaletteRequests = {
  openRequest: { id: number; query: string } | null;
  createRequest: { id: number; kind: PaletteCreateKind } | null;
  openPalette: (query?: string) => void;
  requestCreate: (kind: PaletteCreateKind) => void;
};

let nextId = 0;

const usePaletteRequests = create<PaletteRequests>((set) => ({
  openRequest: null,
  createRequest: null,
  openPalette: (query = "") => {
    nextId += 1;
    set({ openRequest: { id: nextId, query } });
  },
  requestCreate: (kind) => {
    nextId += 1;
    set({ createRequest: { id: nextId, kind } });
  },
}));

export default usePaletteRequests;

/** Opens the command palette, optionally pre-filled (e.g. "#" for tasks). */
export function openCommandPalette(query?: string) {
  usePaletteRequests.getState().openPalette(query);
}

let taskCaptureHost: (() => void) | null = null;

/**
 * A board or list with a capture bar takes "create task" requests (canopy
 * slice 5): the bar focuses instead of the dialog opening. Returns the
 * unregister function.
 */
export function registerTaskCapture(open: () => void): () => void {
  taskCaptureHost = open;
  return () => {
    if (taskCaptureHost === open) taskCaptureHost = null;
  };
}

/** Opens a create dialog the palette hosts (or the page's capture bar). */
export function requestCreate(kind: PaletteCreateKind) {
  if (kind === "task" && taskCaptureHost) {
    taskCaptureHost();
    return;
  }
  usePaletteRequests.getState().requestCreate(kind);
}
