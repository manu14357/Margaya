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

/**
 * Opens a create dialog the palette hosts. "New task" opens the full dialog
 * on every page, boards included; a board's capture bar has `C` instead.
 */
export function requestCreate(kind: PaletteCreateKind) {
  usePaletteRequests.getState().requestCreate(kind);
}
