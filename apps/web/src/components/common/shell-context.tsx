import { createContext, useContext } from "react";
import type { ShellDestination } from "@/components/common/shell-destinations";

export type ShellContextValue = {
  /** The destination the context panel shows. */
  destination: ShellDestination;
  /**
   * Rail behaviour: go to the destination's landing page; on the active
   * destination, toggle the panel instead.
   */
  selectDestination: (destination: ShellDestination) => void;
  /** The element pages portal extra panel content into (ContextPanelSlot). */
  panelSlot: HTMLElement | null;
  /** The main column, beside the rail and panel; bottom bars sit inside it. */
  mainColumn: HTMLElement | null;
};

export const ShellContext = createContext<ShellContextValue | null>(null);

/** The shell's state; null when rendered outside the app shell. */
export function useShell() {
  return useContext(ShellContext);
}
