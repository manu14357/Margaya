import { shortcuts } from "@/constants/shortcuts";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { toggleAsk, useAskPanel } from "./ask-store";
import { useAskAvailability, useRouteProjectId } from "./use-ask-availability";

/**
 * Ctrl/⌘ J opens or closes the docked Ask chat (on the full-page chat it
 * focuses the composer instead). Nothing while AI is off here.
 */
export function AskHotkey() {
  const routeProjectId = useRouteProjectId();
  const { available, projectId } = useAskAvailability(routeProjectId);
  useRegisterShortcuts({
    modifierShortcuts: {
      [shortcuts.ask.prefix]: {
        [shortcuts.ask.toggle]: () => {
          if (!available) return;
          const slot = useAskPanel.getState().slot;
          if (slot) {
            slot.querySelector<HTMLTextAreaElement>("textarea")?.focus();
            return;
          }
          toggleAsk(projectId);
        },
      },
    },
  });
  return null;
}
