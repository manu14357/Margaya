import { createContext, useContext, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import type { BoardController } from "./controller";
import type { EditorState } from "./store";

// React access to the controller. Chrome components read slices of the
// store with a selector so a cursor move never re-renders the toolbar.

export const EditorContext = createContext<BoardController | null>(null);

export function useController(): BoardController {
  const controller = useContext(EditorContext);
  if (!controller)
    throw new Error("useController outside the whiteboard editor");
  return controller;
}

export function useEditorState<T>(selector: (state: EditorState) => T): T {
  const controller = useController();
  return useStore(controller.store, selector);
}

/** Re-renders when collaborators' presence changes. */
export function usePresenceVersion(controller: BoardController): number {
  return useSyncExternalStore(
    (listener) => controller.subscribePresence(listener),
    () => controller.presenceVersion,
    () => 0,
  );
}
